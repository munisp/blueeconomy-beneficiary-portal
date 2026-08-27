/**
 * Client-side mirror of the CVFF disbursement state machine defined by the
 * financial-controls service (`internal/cvff`). The backend remains
 * authoritative; this module only renders states, badges and SLA arithmetic
 * that match the approved lifecycle exactly.
 */

export const CVFF_STATES = [
  "SUBMITTED",
  "UNDERWRITING_PRIMARY",
  "UNDERWRITING_SECONDARY",
  "UNDERWRITING_TERTIARY",
  "NIMASA_APPROVAL",
  "BANK_CONFIRMATION",
  "DISBURSEMENT_PENDING",
  "DISBURSED",
  "AUDITED",
  "REJECTED",
  "RECONCILIATION_REQUIRED",
] as const;

export type CvffState = (typeof CVFF_STATES)[number];

export function isCvffState(value: unknown): value is CvffState {
  return typeof value === "string" && (CVFF_STATES as readonly string[]).includes(value);
}

/** Ordered happy-path chain used for the timeline view. */
export const APPROVAL_CHAIN: readonly CvffState[] = [
  "SUBMITTED",
  "UNDERWRITING_PRIMARY",
  "UNDERWRITING_SECONDARY",
  "UNDERWRITING_TERTIARY",
  "NIMASA_APPROVAL",
  "BANK_CONFIRMATION",
  "DISBURSEMENT_PENDING",
  "DISBURSED",
  "AUDITED",
];

export type BadgeTone = "neutral" | "info" | "progress" | "success" | "danger" | "warning";

export interface StateBadge {
  label: string;
  tone: BadgeTone;
  description: string;
}

const STATE_BADGES: Record<CvffState, StateBadge> = {
  SUBMITTED: {
    label: "Submitted",
    tone: "info",
    description: "Application received and queued for the primary underwriting tier.",
  },
  UNDERWRITING_PRIMARY: {
    label: "Primary underwriting",
    tone: "progress",
    description: "Primary PLI underwriter is reviewing the application (5 business day SLA).",
  },
  UNDERWRITING_SECONDARY: {
    label: "Secondary underwriting",
    tone: "progress",
    description: "Secondary PLI underwriter is reviewing the application (3 business day SLA).",
  },
  UNDERWRITING_TERTIARY: {
    label: "Tertiary underwriting",
    tone: "progress",
    description: "Tertiary PLI underwriter is reviewing the application (2 business day SLA).",
  },
  NIMASA_APPROVAL: {
    label: "NIMASA approval",
    tone: "progress",
    description: "Awaiting the NIMASA approver's decision.",
  },
  BANK_CONFIRMATION: {
    label: "Bank confirmation",
    tone: "progress",
    description: "Awaiting the receiving bank's confirmation of beneficiary account details.",
  },
  DISBURSEMENT_PENDING: {
    label: "Disbursement pending",
    tone: "progress",
    description: "Awaiting beneficiary confirmation before funds are released.",
  },
  DISBURSED: {
    label: "Disbursed",
    tone: "success",
    description: "Funds disbursed; the application awaits post-disbursement audit.",
  },
  AUDITED: {
    label: "Audited",
    tone: "success",
    description: "Lifecycle complete: disbursement audited and closed.",
  },
  REJECTED: {
    label: "Rejected",
    tone: "danger",
    description: "A party in the approval chain rejected the application. This state is terminal.",
  },
  RECONCILIATION_REQUIRED: {
    label: "Reconciliation required",
    tone: "warning",
    description: "Contradictory or missing evidence requires reconciliation before the application can proceed.",
  },
};

export function stateBadge(state: CvffState): StateBadge {
  return STATE_BADGES[state];
}

export function isTerminalState(state: CvffState): boolean {
  return state === "REJECTED" || state === "AUDITED";
}

export type UnderwritingTier = "PRIMARY" | "SECONDARY" | "TERTIARY";

/** Approved per-tier underwriting SLA in business days. */
export const TIER_SLA_BUSINESS_DAYS: Record<UnderwritingTier, number> = {
  PRIMARY: 5,
  SECONDARY: 3,
  TERTIARY: 2,
};

export function tierForState(state: CvffState): UnderwritingTier | null {
  switch (state) {
    case "UNDERWRITING_PRIMARY":
      return "PRIMARY";
    case "UNDERWRITING_SECONDARY":
      return "SECONDARY";
    case "UNDERWRITING_TERTIARY":
      return "TERTIARY";
    default:
      return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the instant a tier decision is due: the tier-entry time plus the
 * tier's business days, skipping Saturdays and Sundays. Mirrors
 * `SLADeadline` in financial-controls `internal/cvff`.
 */
export function slaDeadline(tier: UnderwritingTier, enteredAt: Date): Date {
  const days = TIER_SLA_BUSINESS_DAYS[tier];
  const deadline = new Date(enteredAt.getTime());
  let added = 0;
  while (added < days) {
    deadline.setTime(deadline.getTime() + DAY_MS);
    const day = deadline.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return deadline;
}

export type SlaStatus = "on-track" | "due-soon" | "overdue";

export interface SlaReading {
  tier: UnderwritingTier;
  enteredAt: Date;
  deadline: Date;
  remainingMs: number;
  status: SlaStatus;
}

/**
 * Computes the SLA reading for the underwriting state an application is
 * currently in, or null when the application is not in underwriting.
 * "due-soon" starts within the last 24 hours before the deadline.
 */
export function slaReading(state: CvffState, stateEnteredAt: Date, now: Date): SlaReading | null {
  const tier = tierForState(state);
  if (tier === null) {
    return null;
  }
  const deadline = slaDeadline(tier, stateEnteredAt);
  const remainingMs = deadline.getTime() - now.getTime();
  const status: SlaStatus = remainingMs < 0 ? "overdue" : remainingMs <= DAY_MS ? "due-soon" : "on-track";
  return { tier, enteredAt: stateEnteredAt, deadline, remainingMs, status };
}

/** Human labels for each party in the four-party approval chain. */
export const CHAIN_STEP_LABELS: Record<string, string> = {
  SUBMITTED: "Application submitted",
  UNDERWRITING_PRIMARY: "PLI primary underwriter",
  UNDERWRITING_SECONDARY: "PLI secondary underwriter",
  UNDERWRITING_TERTIARY: "PLI tertiary underwriter",
  NIMASA_APPROVAL: "NIMASA approval",
  BANK_CONFIRMATION: "Receiving bank confirmation",
  DISBURSEMENT_PENDING: "Beneficiary confirmation",
  DISBURSED: "Disbursement",
  AUDITED: "Post-disbursement audit",
};
