import { describe, expect, it } from "vitest";
import { ApiError, CvffApiClient } from "../src/api/client";
import {
  assignApplicationRoles,
  downloadDualLedgerReportCsv,
  getDualLedgerReport,
  getDualLedgerReportCsvName,
  resolveReconciliation,
  submitPartyDecision,
  validateReportWindow,
  validateRoleAssignments,
  CHAIN_ROLES,
  type RoleAssignments,
} from "../src/api/officer";

const BASE_URL = "https://gateway.example.invalid/v1/cvff";
const TOKEN = "test-token";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function makeClient(status: number, payload: unknown): { client: CvffApiClient; recorded: RecordedRequest[] } {
  const recorded: RecordedRequest[] = [];
  const fetchFn: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    recorded.push({ url: String(input), method: init?.method ?? "GET", headers, body: (init?.body as string) ?? null });
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json" },
    });
  }) as typeof fetch;
  return { client: new CvffApiClient({ baseUrl: BASE_URL, token: TOKEN, fetchFn }), recorded };
}

const VALID_ASSIGNMENTS: RoleAssignments = {
  UNDERWRITER_PRIMARY: "uw-primary-1",
  UNDERWRITER_SECONDARY: "uw-secondary-1",
  UNDERWRITER_TERTIARY: "uw-tertiary-1",
  NIMASA_APPROVER: "nimasa-1",
  RECEIVING_BANK: "bank-1",
  BENEFICIARY: "beneficiary-1",
};

describe("officer API request shapes (bound to the Go contract)", () => {
  it("GET /reports/dual-ledger sends RFC 3339 from/to and format=json", async () => {
    const { client, recorded } = makeClient(200, []);
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-02-01T00:00:00.000Z");
    await getDualLedgerReport(client, from, to);
    expect(recorded[0].method).toBe("GET");
    expect(recorded[0].url).toBe(
      `${BASE_URL}/reports/dual-ledger?from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z&format=json`,
    );
    expect(recorded[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("PUT /admin/applications/{id}/roles sends the assignments map verbatim", async () => {
    const { client, recorded } = makeClient(200, { application_id: "app-1", assignments: VALID_ASSIGNMENTS });
    const response = await assignApplicationRoles(client, "app 1", VALID_ASSIGNMENTS);
    expect(recorded[0].method).toBe("PUT");
    expect(recorded[0].url).toBe(`${BASE_URL}/admin/applications/app%201/roles`);
    expect(JSON.parse(recorded[0].body ?? "{}")).toEqual({ assignments: VALID_ASSIGNMENTS });
    expect(response.assignments.BENEFICIARY).toBe("beneficiary-1");
  });

  it("POST /applications/{id}/decisions sends exactly { decision }", async () => {
    const { client, recorded } = makeClient(202, { application_id: "app-1", state: "NIMASA_APPROVAL", signal: "nimasa-decision" });
    const response = await submitPartyDecision(client, "app-1", "APPROVE");
    expect(recorded[0].method).toBe("POST");
    expect(recorded[0].url).toBe(`${BASE_URL}/applications/app-1/decisions`);
    expect(JSON.parse(recorded[0].body ?? "{}")).toEqual({ decision: "APPROVE" });
    expect(response.signal).toBe("nimasa-decision");
  });

  it("POST /admin/applications/{id}/reconciliation sends exactly { resolution }", async () => {
    const { client, recorded } = makeClient(202, {
      application_id: "app-1",
      state: "RECONCILIATION_REQUIRED",
      resolution: "RESUME_DISBURSEMENT",
    });
    const response = await resolveReconciliation(client, "app-1", "RESUME_DISBURSEMENT");
    expect(recorded[0].method).toBe("POST");
    expect(recorded[0].url).toBe(`${BASE_URL}/admin/applications/app-1/reconciliation`);
    expect(JSON.parse(recorded[0].body ?? "{}")).toEqual({ resolution: "RESUME_DISBURSEMENT" });
    expect(response.resolution).toBe("RESUME_DISBURSEMENT");
  });

  it("CSV download requests format=csv on the same window", async () => {
    const { client, recorded } = makeClient(200, "application_id\napp-1\n");
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T00:00:00.000Z");
    await downloadDualLedgerReportCsv(client, from, to);
    expect(recorded[0].url).toContain("format=csv");
    expect(getDualLedgerReportCsvName(from, to)).toBe(
      "cvff-dual-ledger-2026-01-01T00-00-00-000Z-2026-01-31T00-00-00-000Z.csv",
    );
  });

  it("surfaces backend problem titles and status truthfully", async () => {
    const { client } = makeClient(409, {
      type: "about:blank",
      title: "The application already has divergent role assignments.",
      status: 409,
    });
    const failure = await assignApplicationRoles(client, "app-1", VALID_ASSIGNMENTS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as ApiError).message).toBe("The application already has divergent role assignments.");
  });
});

describe("report window validation (mirrors backend rules)", () => {
  it("accepts a bounded half-open window", () => {
    expect(validateReportWindow(new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"))).toBeNull();
  });
  it("rejects inverted and empty windows", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(validateReportWindow(at, at)).toMatch(/strictly before/);
    expect(validateReportWindow(new Date("2026-02-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toMatch(/strictly before/);
  });
  it("rejects windows beyond the approved 366 days", () => {
    expect(validateReportWindow(new Date("2025-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"))).toMatch(/366 days/);
  });
});

describe("role assignment validation (mirrors segregation of duties)", () => {
  it("covers exactly the six chain roles", () => {
    expect(CHAIN_ROLES).toHaveLength(6);
    expect(validateRoleAssignments(VALID_ASSIGNMENTS)).toBeNull();
  });
  it("rejects empty and non-canonical principals", () => {
    expect(validateRoleAssignments({ ...VALID_ASSIGNMENTS, BENEFICIARY: " " })).toMatch(/BENEFICIARY/);
    expect(validateRoleAssignments({ ...VALID_ASSIGNMENTS, RECEIVING_BANK: "not canonical!" })).toMatch(/RECEIVING_BANK/);
  });
  it("rejects one principal holding two roles", () => {
    expect(validateRoleAssignments({ ...VALID_ASSIGNMENTS, NIMASA_APPROVER: "uw-primary-1" })).toMatch(/distinct/);
  });
});
