import type { CvffApiClient } from "./client";
import type { CvffState } from "../domain/cvff";

/**
 * Officer/auditor API surface (Phase 22). Request and response shapes mirror
 * the financial-controls service exactly (`internal/cvffapi/http.go`,
 * `pipeline.go`, `report.go`): field names are bound to the Go JSON tags and
 * unknown fields are rejected server-side, so nothing extra is ever sent.
 */

/** The six four-party chain roles bound by PUT /admin/applications/{id}/roles. */
export const CHAIN_ROLES = [
  "UNDERWRITER_PRIMARY",
  "UNDERWRITER_SECONDARY",
  "UNDERWRITER_TERTIARY",
  "NIMASA_APPROVER",
  "RECEIVING_BANK",
  "BENEFICIARY",
] as const;

export type ChainRole = (typeof CHAIN_ROLES)[number];

export type RoleAssignments = Record<ChainRole, string>;

export interface AssignRolesResponse {
  application_id: string;
  assignments: RoleAssignments;
}

export type PartyDecision = "APPROVE" | "REJECT";

export interface DecisionResponse {
  application_id: string;
  state: CvffState;
  signal: string;
}

export type ReconciliationResolution = "RESUME_DISBURSEMENT" | "REJECT";

export interface ReconciliationResponse {
  application_id: string;
  state: CvffState;
  resolution: ReconciliationResolution;
}

/** One row of the auditor dual-ledger report (JSON shape of cvff.DualLedgerReport). */
export interface DualLedgerReportRow {
  application_id: string;
  beneficiary_id: string;
  state: CvffState;
  fee_ngn_minor: number;
  cost_usd_minor: number;
  cost_ngn_equivalent: number;
  ngn_per_usd_micro: number;
  rate_effective_date: string;
  fee_transfer_id: string;
  cost_transfer_id: string;
  disbursed_at: string;
}

/**
 * Client-side mirror of the backend window rules (`reportWindow`): both
 * bounds mandatory, from strictly before to, span at most 366 days. The
 * backend remains authoritative; this only avoids round-trips it will
 * reject with 422.
 */
export const MAX_REPORT_WINDOW_DAYS = 366;

export function validateReportWindow(from: Date, to: Date): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Both report bounds must be valid dates.";
  }
  if (from.getTime() >= to.getTime()) {
    return "The 'from' instant must be strictly before the 'to' instant.";
  }
  if (to.getTime() - from.getTime() > MAX_REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return `The report window exceeds the approved ${MAX_REPORT_WINDOW_DAYS} days.`;
  }
  return null;
}

/**
 * Client-side mirror of cvff.ValidateRoleAssignments: every chain role bound
 * exactly once, no principal holding two roles. Backend re-validates and the
 * PBAC layer additionally enforces segregation of duties.
 */
export function validateRoleAssignments(assignments: RoleAssignments): string | null {
  const seen = new Map<string, ChainRole>();
  for (const role of CHAIN_ROLES) {
    const principal = assignments[role].trim();
    if (principal.length === 0) {
      return `Every chain role must be bound to a principal; ${role} is empty.`;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(principal)) {
      return `${role}: the principal must be canonical identifier text (letters, digits, . _ : -, up to 128 chars).`;
    }
    const held = seen.get(principal);
    if (held !== undefined) {
      return `Principal "${principal}" cannot hold both ${held} and ${role}; the four-party chain requires six distinct parties.`;
    }
    seen.set(principal, role);
  }
  return null;
}

/** GET /reports/dual-ledger?from=&to=&format=json (auditor role). */
export function getDualLedgerReport(client: CvffApiClient, from: Date, to: Date): Promise<DualLedgerReportRow[]> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), format: "json" });
  return client.get<DualLedgerReportRow[]>(`/reports/dual-ledger?${query.toString()}`);
}

/** CSV rendering of the same report, downloaded as a file. */
export function downloadDualLedgerReportCsv(client: CvffApiClient, from: Date, to: Date): Promise<Blob> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), format: "csv" });
  return client.getBlob(`/reports/dual-ledger?${query.toString()}`);
}

/** Deterministic download filename for the CSV rendering of one window. */
export function getDualLedgerReportCsvName(from: Date, to: Date): string {
  const stamp = (date: Date) => date.toISOString().replace(/[:.]/g, "-");
  return `cvff-dual-ledger-${stamp(from)}-${stamp(to)}.csv`;
}

/** PUT /admin/applications/{id}/roles (officer role; idempotent). */
export function assignApplicationRoles(
  client: CvffApiClient,
  applicationId: string,
  assignments: RoleAssignments,
): Promise<AssignRolesResponse> {
  return client.put<AssignRolesResponse>(
    `/admin/applications/${encodeURIComponent(applicationId)}/roles`,
    { assignments },
  );
}

/**
 * POST /applications/{id}/decisions. The backend binds the deciding party
 * from the bearer token and the durable role assignments; the request body
 * is exactly `{ decision }` (unknown fields are rejected).
 */
export function submitPartyDecision(
  client: CvffApiClient,
  applicationId: string,
  decision: PartyDecision,
): Promise<DecisionResponse> {
  return client.post<DecisionResponse>(
    `/applications/${encodeURIComponent(applicationId)}/decisions`,
    { decision },
  );
}

/** POST /admin/applications/{id}/reconciliation (reconciliation officer role). */
export function resolveReconciliation(
  client: CvffApiClient,
  applicationId: string,
  resolution: ReconciliationResolution,
): Promise<ReconciliationResponse> {
  return client.post<ReconciliationResponse>(
    `/admin/applications/${encodeURIComponent(applicationId)}/reconciliation`,
    { resolution },
  );
}
