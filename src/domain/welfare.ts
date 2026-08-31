/**
 * Seafarer welfare / MLC 2006 domain vocabulary and client-side validation.
 *
 * Every rule mirrors the welfare module of blueeconomy-credential-verification
 * (src/welfare/routes.ts + src/welfare/service.ts, head 147f223) one-to-one so
 * that an invalid complaint is rejected before it reaches the network; the
 * backend remains authoritative. Enums are closed sets mirroring
 * blueeconomy-contracts proto/blueeconomy/contracts/v1/welfare.proto — the
 * proto UNSPECIFIED zero values have no representation here.
 */

export const COMPLAINT_CHANNELS = ["onboard_r515", "flagstate_r522"] as const;
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];

export const COMPLAINT_CHANNEL_LABELS: Record<ComplaintChannel, string> = {
  onboard_r515: "On-board complaint (MLC Reg 5.1.5)",
  flagstate_r522: "Flag-state / onshore complaint (MLC Reg 5.2.2)",
};

export const COMPLAINT_CATEGORIES = [
  "wages",
  "rest_hours",
  "accommodation",
  "food",
  "medical",
  "harassment_bullying",
  "repatriation",
  "abandonment",
  "other_mlc",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  wages: "Wages",
  rest_hours: "Hours of work or rest",
  accommodation: "Accommodation",
  food: "Food and catering",
  medical: "Medical care",
  harassment_bullying: "Harassment or bullying",
  repatriation: "Repatriation",
  abandonment: "Abandonment",
  other_mlc: "Other MLC entitlement",
};

export const COMPLAINT_STATUSES = [
  "RECEIVED",
  "ACKED",
  "ONBOARD_PROCESS",
  "ESCALATED_FLAGSTATE",
  "REFERRED",
  "RESOLVED",
  "CLOSED",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/**
 * Governed lifecycle per the welfare events doc: RECEIVED -> ACKED ->
 * ONBOARD_PROCESS, with ESCALATED_FLAGSTATE and REFERRED as governed branches
 * and RESOLVED/CLOSED terminal. Transitions are maker-checker approved on the
 * backend; this map exists only to render the timeline honestly.
 */
export const COMPLAINT_TRANSITIONS: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  RECEIVED: ["ACKED"],
  ACKED: ["ONBOARD_PROCESS", "ESCALATED_FLAGSTATE"],
  ONBOARD_PROCESS: ["ESCALATED_FLAGSTATE", "REFERRED", "RESOLVED"],
  ESCALATED_FLAGSTATE: ["REFERRED", "RESOLVED"],
  REFERRED: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  RECEIVED: "Received",
  ACKED: "Acknowledged",
  ONBOARD_PROCESS: "On-board process",
  ESCALATED_FLAGSTATE: "Escalated to flag state",
  REFERRED: "Referred to welfare provider",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export type BadgeTone = "neutral" | "info" | "progress" | "success" | "danger" | "warning";

export function complaintStatusTone(status: ComplaintStatus): BadgeTone {
  switch (status) {
    case "RECEIVED":
      return "neutral";
    case "ACKED":
    case "ONBOARD_PROCESS":
      return "progress";
    case "ESCALATED_FLAGSTATE":
      return "warning";
    case "REFERRED":
      return "info";
    case "RESOLVED":
    case "CLOSED":
      return "success";
  }
}

export const REFERRAL_STATUSES = ["OFFERED", "ACCEPTED", "ENGAGED", "CLOSED"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  OFFERED: "Offered",
  ACCEPTED: "Accepted",
  ENGAGED: "Engaged",
  CLOSED: "Closed",
};

export function referralStatusTone(status: ReferralStatus): BadgeTone {
  switch (status) {
    case "OFFERED":
      return "neutral";
    case "ACCEPTED":
      return "progress";
    case "ENGAGED":
      return "info";
    case "CLOSED":
      return "success";
  }
}

/**
 * The exact right-to-external-redress notice displayed at complaint intake.
 * Acknowledgement is mandatory: the backend fails closed with HTTP 400 when
 * `rightToRedressNoticeAck` is not true (MLC 2006, Regulation 5.1.5(3)).
 */
export const RIGHT_TO_REDRESS_NOTICE =
  "Under the Maritime Labour Convention, 2006 (MLC 2006, Regulation 5.1.5(3)), you have the right to " +
  "external redress: in addition to this complaint procedure, you may lodge your complaint directly with " +
  "the master and, where you consider it necessary, with appropriate external authorities, including the " +
  "flag State. Using this procedure does not waive that right. You are safeguarded against victimization " +
  "for filing a complaint (Regulation 5.1.5(2)): your identity is withheld from the respondent unless " +
  "disclosure becomes legally required, and every disclosure is a governed, maker-checker-approved event " +
  "that appears in your complaint timeline.";

// ------------------------------------------------------------- validation

export interface WelfareAttachmentDraft {
  name: string;
  sha256: string;
}

export interface ComplaintDraft {
  channel: "" | ComplaintChannel;
  category: "" | ComplaintCategory;
  vesselRef: string;
  operatorRef: string;
  narrative: string;
  attachments: WelfareAttachmentDraft[];
  rightToRedressNoticeAck: boolean;
}

export const EMPTY_COMPLAINT_DRAFT: ComplaintDraft = {
  channel: "",
  category: "",
  vesselRef: "",
  operatorRef: "",
  narrative: "",
  attachments: [],
  rightToRedressNoticeAck: false,
};

export type ComplaintDraftField =
  | "channel"
  | "category"
  | "vesselRef"
  | "operatorRef"
  | "narrative"
  | "attachments"
  | "rightToRedressNoticeAck";

export type ComplaintDraftErrors = Partial<Record<ComplaintDraftField, string>>;

export const MAX_NARRATIVE_CHARS = 8192; // service.ts MAX_NARRATIVE_CHARS
export const MAX_ATTACHMENTS = 16; // service.ts assertAttachments
export const MAX_ATTACHMENT_NAME_CHARS = 256;
export const MAX_REFERENCE_CHARS = 128; // service.ts assertCanonical(vesselRef/operatorRef, 128)
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function isCanonicalText(value: string): boolean {
  return value.trim() === value && value.length > 0;
}

/**
 * Mirrors the backend intake rules exactly (service.ts submitComplaint):
 * closed enums, canonical references, bounded narrative, digest-only
 * attachments and the mandatory redress acknowledgement.
 */
export function validateComplaintDraft(draft: ComplaintDraft): ComplaintDraftErrors {
  const errors: ComplaintDraftErrors = {};
  if (draft.channel === "") {
    errors.channel = "Select the complaint channel: on-board (Reg 5.1.5) or flag-state (Reg 5.2.2).";
  } else if (!COMPLAINT_CHANNELS.includes(draft.channel)) {
    errors.channel = "Channel must be onboard_r515 (Reg 5.1.5) or flagstate_r522 (Reg 5.2.2).";
  }
  if (draft.category === "") {
    errors.category = "Select the MLC category that best describes the complaint.";
  } else if (!COMPLAINT_CATEGORIES.includes(draft.category)) {
    errors.category = "Category must be a documented MLC category.";
  }
  if (!isCanonicalText(draft.vesselRef) || draft.vesselRef.length > MAX_REFERENCE_CHARS) {
    errors.vesselRef = `Vessel reference must be 1-${MAX_REFERENCE_CHARS} characters without leading or trailing spaces.`;
  }
  if (draft.operatorRef.length > 0 && (!isCanonicalText(draft.operatorRef) || draft.operatorRef.length > MAX_REFERENCE_CHARS)) {
    errors.operatorRef = `Operator reference must be 1-${MAX_REFERENCE_CHARS} characters without leading or trailing spaces, or left empty.`;
  }
  if (draft.narrative.trim().length === 0) {
    errors.narrative = "Describe the complaint. The narrative is encrypted at rest and never leaves the confidential boundary in clear text.";
  } else if (draft.narrative.length > MAX_NARRATIVE_CHARS) {
    errors.narrative = `The complaint description must be at most ${MAX_NARRATIVE_CHARS} characters (currently ${draft.narrative.length}).`;
  }
  if (draft.attachments.length > MAX_ATTACHMENTS) {
    errors.attachments = `At most ${MAX_ATTACHMENTS} attachment references are accepted.`;
  } else {
    for (const [index, attachment] of draft.attachments.entries()) {
      if (!isCanonicalText(attachment.name) || attachment.name.length > MAX_ATTACHMENT_NAME_CHARS) {
        errors.attachments = `Attachment ${index + 1}: name must be 1-${MAX_ATTACHMENT_NAME_CHARS} characters.`;
        break;
      }
      if (!SHA256_HEX_PATTERN.test(attachment.sha256)) {
        errors.attachments = `Attachment ${index + 1}: only SHA-256 digests are sent; content is never uploaded.`;
        break;
      }
    }
  }
  if (draft.rightToRedressNoticeAck !== true) {
    errors.rightToRedressNoticeAck =
      "You must read and acknowledge the right-to-external-redress notice before the complaint can be submitted.";
  }
  return errors;
}

// ------------------------------------------------------------- timeline

export interface ComplaintTimelineEvent {
  at: string;
  transition: string;
  actorRole: string;
  disclosureEvent: boolean;
}

/**
 * Renders a stored transition string exactly as the welfare module records
 * it: "RECEIVED" at intake, "FROM->TO" for governed status transitions and
 * "DISCLOSE:<reasonCode>" for the rare, maker-checker-approved identity
 * disclosure (always flagged disclosure_event=true). Unknown shapes are
 * shown verbatim — the timeline never invents states.
 */
export function describeTimelineTransition(transition: string): string {
  if (transition.startsWith("DISCLOSE:")) {
    const reasonCode = transition.slice("DISCLOSE:".length);
    return `Complainant identity disclosed to the respondent (legally required disclosure, reason ${reasonCode})`;
  }
  const arrow = transition.indexOf("->");
  if (arrow > 0) {
    const from = transition.slice(0, arrow);
    const to = transition.slice(arrow + 2);
    if (isComplaintStatus(from) && isComplaintStatus(to)) {
      return `Status changed from ${COMPLAINT_STATUS_LABELS[from]} to ${COMPLAINT_STATUS_LABELS[to]}`;
    }
  }
  if (isComplaintStatus(transition)) {
    return `Complaint ${COMPLAINT_STATUS_LABELS[transition].toLowerCase()}`;
  }
  return transition;
}

export function isComplaintStatus(value: string): value is ComplaintStatus {
  return (COMPLAINT_STATUSES as readonly string[]).includes(value);
}
