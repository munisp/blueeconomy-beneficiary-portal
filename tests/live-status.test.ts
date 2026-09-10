import { describe, expect, it } from "vitest";
import { formatAge, isStale, openSseHintChannel, type LiveChannelState } from "../src/pwa/liveStatus";
import { validateRuntimeConfiguration } from "../src/runtime-config";

describe("live status staleness (poll-only honest indicator)", () => {
  it("formats ages honestly", () => {
    const now = 1_000_000;
    expect(formatAge(now, now)).toBe("just now");
    expect(formatAge(now, now - 30_000)).toBe("30 s ago");
    expect(formatAge(now, now - 5 * 60_000)).toBe("5 min ago");
    expect(formatAge(now, now - 3 * 3_600_000)).toBe("3 h ago");
  });

  it("marks never-refreshed and missed-cycle views as stale", () => {
    const now = 1_000_000;
    expect(isStale(now, null, 15_000)).toBe(true);
    expect(isStale(now, now - 10_000, 15_000)).toBe(false);
    expect(isStale(now, now - 31_000, 15_000)).toBe(true);
  });
});

describe("SSE hint channel (config-gated)", () => {
  it("is poll-only when no sse_url is configured", () => {
    const states: LiveChannelState[] = [];
    const close = openSseHintChannel(undefined, () => {}, (s) => states.push(s));
    expect(states).toEqual(["poll-only"]);
    close();
  });

  it("reports connected and triggers a refresh hint on message", () => {
    const states: LiveChannelState[] = [];
    let hints = 0;
    const fake = {
      onopen: null as null | (() => void),
      onmessage: null as null | (() => void),
      onerror: null as null | (() => void),
      readyState: 0,
      close: () => undefined,
    };
    const close = openSseHintChannel(
      "https://gateway.example/v1/cvff/status-stream",
      () => (hints += 1),
      (s) => states.push(s),
      () => fake as unknown as EventSource,
    );
    fake.onopen?.();
    fake.onmessage?.();
    expect(states).toContain("sse-connected");
    expect(hints).toBe(1);
    close();
  });

  it("degrades honestly to sse-degraded on error, never fabricating liveness", () => {
    const states: LiveChannelState[] = [];
    const fake = {
      onopen: null as null | (() => void),
      onmessage: null as null | (() => void),
      onerror: null as null | (() => void),
      readyState: 2,
      close: () => undefined,
    };
    openSseHintChannel("https://gateway.example/sse", () => {}, (s) => states.push(s), () => fake as unknown as EventSource);
    fake.onerror?.();
    expect(states).toEqual(["sse-degraded"]);
  });
});

describe("runtime config live_updates validation", () => {
  const base = {
    application_name: "CVFF",
    oidc: {
      authority: "https://idp.example",
      client_id: "portal",
      redirect_uri: "https://portal.example/callback",
      scope: "openid",
    },
    cvff_api: { base_url: "https://gateway.example/v1/cvff" },
  };

  it("defaults to poll-only (no live_updates key)", () => {
    const config = validateRuntimeConfiguration(base);
    expect(config.live_updates).toBeUndefined();
  });

  it("accepts an HTTPS sse_url", () => {
    const config = validateRuntimeConfiguration({ ...base, live_updates: { sse_url: "https://gateway.example/v1/cvff/status-stream" } });
    expect(config.live_updates?.sse_url).toBe("https://gateway.example/v1/cvff/status-stream");
  });

  it("fails closed on a plaintext sse_url", () => {
    expect(() => validateRuntimeConfiguration({ ...base, live_updates: { sse_url: "http://gateway.example/sse" } })).toThrow(
      /live_updates\.sse_url/,
    );
  });

  it("fails closed on a malformed live_updates block", () => {
    expect(() => validateRuntimeConfiguration({ ...base, live_updates: "yes" })).toThrow(/live_updates/);
  });
});
