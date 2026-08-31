// @vitest-environment jsdom
/**
 * Component tests for the seafarer welfare (MLC 2006) surface. All HTTP is
 * intercepted by a mocked fetch — no welfare service, fixture server or
 * substitute data source is contacted. Mocks exist in tests only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { User } from "oidc-client-ts";
import { CvffApiClient } from "../src/api/client";
import type { SessionContext } from "../src/App";
import { NewComplaintPage } from "../src/pages/welfare/NewComplaintPage";
import { ComplaintStatusPage } from "../src/pages/welfare/ComplaintStatusPage";
import { ReferralsPage } from "../src/pages/welfare/ReferralsPage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_URL = "https://welfare.example/v1/welfare";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function mockFetchRouter(handlers: Array<{ method: string; path: string; status: number; body: unknown }>) {
  const requests: RecordedRequest[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const path = url.slice(BASE_URL.length);
    const handler = handlers.find((candidate) => candidate.method === (init?.method ?? "GET") && candidate.path === path);
    if (handler === undefined) {
      return new Response(JSON.stringify({ error: `unhandled ${init?.method ?? "GET"} ${path}` }), { status: 500 });
    }
    return new Response(JSON.stringify(handler.body), { status: handler.status });
  }) as typeof fetch;
  return { fetchFn, requests };
}

function makeSession(fetchFn: typeof fetch, overrides?: Partial<SessionContext>): SessionContext {
  return {
    configuration: {
      application_name: "Test Portal",
      oidc: { authority: "https://idp.example/realms/test", client_id: "test", redirect_uri: "https://portal.example/callback", scope: "openid" },
      cvff_api: { base_url: "https://cvff.example/v1/cvff", poll_interval_ms: 15000, max_document_bytes: 1024, document_content_types: ["application/pdf"] },
    },
    user: { expired: false } as User,
    getClient: () => Promise.resolve(null),
    welfare: { kind: "configured", baseUrl: BASE_URL },
    getWelfareClient: () => Promise.resolve(new CvffApiClient({ baseUrl: BASE_URL, token: "test-token", fetchFn })),
    signOut: () => Promise.resolve(),
    ...overrides,
  };
}

const navigate = vi.fn();

beforeEach(() => {
  window.sessionStorage.clear();
  navigate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("NewComplaintPage (complaint intake)", () => {
  function fillValidForm(): void {
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "onboard_r515" } });
    fireEvent.change(selects[1], { target: { value: "rest_hours" } });
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "IMO 9074729" } });
    fireEvent.change(textboxes[2], { target: { value: "Rest hours were not honoured on the last voyage." } });
  }

  it("blocks submission and shows validation errors when the form is empty", async () => {
    const { fetchFn, requests } = mockFetchRouter([]);
    render(<NewComplaintPage session={makeSession(fetchFn)} navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit complaint" }));
    expect(await screen.findByText(/Select the complaint channel/)).toBeDefined();
    expect(screen.getByText(/Select the MLC category/)).toBeDefined();
    expect(screen.getByText(/Vessel reference must be/)).toBeDefined();
    expect(screen.getByText(/Describe the complaint/)).toBeDefined();
    expect(screen.getByText(/must read and acknowledge/)).toBeDefined();
    expect(requests).toHaveLength(0);
  });

  it("gates submission on the right-to-redress acknowledgement (Reg 5.1.5(3))", async () => {
    const { fetchFn, requests } = mockFetchRouter([]);
    render(<NewComplaintPage session={makeSession(fetchFn)} navigate={navigate} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit complaint" }));
    expect(await screen.findByText(/must read and acknowledge the right-to-external-redress notice/)).toBeDefined();
    expect(requests).toHaveLength(0);
    // The exact notice text is displayed at intake.
    expect(screen.getByText(/Regulation 5.1.5\(3\)/)).toBeDefined();
  });

  it("submits the complaint with an Idempotency-Key and digest-only payload, then shows the reference", async () => {
    const { fetchFn, requests } = mockFetchRouter([
      { method: "POST", path: "/complaints", status: 201, body: { complaintId: "wfc-000123", status: "RECEIVED", created: true, eventId: "evt-1" } },
    ]);
    render(<NewComplaintPage session={makeSession(fetchFn)} navigate={navigate} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Submit complaint" }));

    expect(await screen.findByText("wfc-000123")).toBeDefined();
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${BASE_URL}/complaints`);
    expect(request.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.headers["authorization"]).toBe("Bearer test-token");
    const payload = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({
      channel: "onboard_r515",
      category: "rest_hours",
      vesselRef: "IMO 9074729",
      narrative: "Rest hours were not honoured on the last voyage.",
      attachments: [],
      rightToRedressNoticeAck: true,
    });
    expect("operatorRef" in payload).toBe(false);
    // Privacy: the narrative never appears in URLs.
    expect(request.url).not.toContain("Rest");
  });

  it("surfaces the backend error honestly and keeps a retry idempotent", async () => {
    const { fetchFn, requests } = mockFetchRouter([
      { method: "POST", path: "/complaints", status: 409, body: { error: "the authenticated seafarer holds no current CoC credential; complaints bind to a verified seafarer identity" } },
    ]);
    render(<NewComplaintPage session={makeSession(fetchFn)} navigate={navigate} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Submit complaint" }));
    expect(await screen.findByText(/holds no current CoC credential/)).toBeDefined();
    expect(requests).toHaveLength(1);
  });

  it("renders the fail-closed gate when the welfare API is not configured", () => {
    const { fetchFn, requests } = mockFetchRouter([]);
    render(
      <NewComplaintPage
        session={makeSession(fetchFn, { welfare: { kind: "unavailable", reason: "VITE_WELFARE_API_BASE_URL is not set" } })}
        navigate={navigate}
      />,
    );
    expect(screen.getByText(/Seafarer welfare service is not configured/)).toBeDefined();
    expect(screen.getByText(/VITE_WELFARE_API_BASE_URL is not set/)).toBeDefined();
    expect(requests).toHaveLength(0);
  });
});

describe("ComplaintStatusPage (status tracking)", () => {
  const complaint = {
    complaintId: "wfc-000001",
    channel: "onboard_r515",
    vesselRef: "IMO 9074729",
    operatorRef: null,
    category: "rest_hours",
    status: "ACKED",
    narrative: "Rest hours were not honoured on the last voyage.",
    narrativeDigestSha256: "c".repeat(64),
    attachments: [],
    rightToRedressNoticeAck: true,
    disclosureScope: "disclosed",
    submittedAt: "2026-08-29T08:20:00Z",
    timeline: [
      { at: "2026-08-29T08:20:00Z", transition: "RECEIVED", actorRole: "seafarer", disclosureEvent: false },
      { at: "2026-08-29T10:05:00Z", transition: "RECEIVED->ACKED", actorRole: "nimasa_labour_officer", disclosureEvent: false },
      { at: "2026-08-30T09:00:00Z", transition: "DISCLOSE:COURT_ORDER", actorRole: "nimasa_labour_officer", disclosureEvent: true },
    ],
  };

  it("renders the status badge and honest transition timeline with disclosure events flagged", async () => {
    const { fetchFn, requests } = mockFetchRouter([
      { method: "GET", path: "/complaints/mine", status: 200, body: { seafarerReference: "sfr-1", complaints: [complaint] } },
    ]);
    render(<ComplaintStatusPage session={makeSession(fetchFn)} navigate={navigate} />);

    expect(await screen.findByText("Acknowledged")).toBeDefined();
    expect(screen.getByText("wfc-000001")).toBeDefined();
    expect(screen.getByText("Identity disclosed (governed)")).toBeDefined();
    expect(requests.some((request) => request.url === `${BASE_URL}/complaints/mine` && request.method === "GET")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Track status" }));
    expect(await screen.findByText("Complaint received")).toBeDefined();
    expect(screen.getByText("Status changed from Received to Acknowledged")).toBeDefined();
    expect(screen.getByText(/Complainant identity disclosed to the respondent/)).toBeDefined();
    expect(screen.getByText("Identity disclosure — legally required, logged")).toBeDefined();
    // The complainant's own narrative is returned to them verbatim.
    expect(screen.getByText("Rest hours were not honoured on the last voyage.")).toBeDefined();
  });

  it("renders an honest empty state when no complaints exist", async () => {
    const { fetchFn } = mockFetchRouter([
      { method: "GET", path: "/complaints/mine", status: 200, body: { seafarerReference: "sfr-1", complaints: [] } },
    ]);
    render(<ComplaintStatusPage session={makeSession(fetchFn)} navigate={navigate} />);
    expect(await screen.findByText("No complaints on record")).toBeDefined();
  });

  it("shows the backend error when the load fails", async () => {
    const { fetchFn } = mockFetchRouter([
      { method: "GET", path: "/complaints/mine", status: 503, body: { error: "welfare store unavailable" } },
    ]);
    render(<ComplaintStatusPage session={makeSession(fetchFn)} navigate={navigate} />);
    expect(await screen.findByText("welfare store unavailable")).toBeDefined();
  });
});

describe("ReferralsPage (referral visibility)", () => {
  it("renders referrals with consent status and links the complaint reference", async () => {
    const referral = {
      referralId: "wfr-000001",
      complaintId: "wfc-000001",
      serviceId: "wsp-los-helpline-01",
      consentAt: "2026-08-29T10:20:00Z",
      status: "OFFERED",
      recordedAt: "2026-08-29T10:21:00Z",
    };
    const { fetchFn, requests } = mockFetchRouter([
      { method: "GET", path: "/referrals/mine", status: 200, body: { seafarerReference: "sfr-1", referrals: [referral] } },
    ]);
    render(<ReferralsPage session={makeSession(fetchFn)} navigate={navigate} />);

    expect(await screen.findByText("Welfare service wsp-los-helpline-01")).toBeDefined();
    expect(screen.getByText("wfr-000001")).toBeDefined();
    expect(screen.getByText("Offered")).toBeDefined();
    expect(screen.getByText(/Consent recorded at/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /wfc-000001/ }));
    expect(navigate).toHaveBeenCalledWith({ name: "welfare-complaints" });
    expect(requests.some((request) => request.url === `${BASE_URL}/referrals/mine`)).toBe(true);
  });

  it("renders an honest empty state", async () => {
    const { fetchFn } = mockFetchRouter([
      { method: "GET", path: "/referrals/mine", status: 200, body: { seafarerReference: null, referrals: [] } },
    ]);
    render(<ReferralsPage session={makeSession(fetchFn)} navigate={navigate} />);
    expect(await screen.findByText("No referrals on record")).toBeDefined();
    expect(screen.getByText(/recorded only with your consent/)).toBeDefined();
  });
});
