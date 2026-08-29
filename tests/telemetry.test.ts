import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAMPLE_RATIO,
  initTelemetry,
  isTelemetryEnabled,
  resolveSampleRatio,
} from "../src/telemetry";
import { validateRuntimeConfiguration } from "../src/runtime-config";

describe("telemetry init guard (fail-open)", () => {
  it("is disabled and never throws when no endpoint is configured", async () => {
    const handle = await initTelemetry({ serviceName: "test-portal" });
    expect(handle.enabled).toBe(false);
    expect(handle.reason).toContain("no OTLP endpoint");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("is disabled for an empty/blank endpoint", async () => {
    expect(isTelemetryEnabled({})).toBe(false);
    expect(isTelemetryEnabled({ endpoint: "" })).toBe(false);
    expect(isTelemetryEnabled({ endpoint: "   " })).toBe(false);
    const handle = await initTelemetry({ endpoint: "  ", serviceName: "test-portal" });
    expect(handle.enabled).toBe(false);
  });

  it("resolves (never rejects) in a non-DOM environment even with an endpoint", async () => {
    // Node has no window/document: instrumentations cannot register. The
    // fail-open contract requires a resolved handle either way — enabled or
    // cleanly disabled — and a shutdown that never rejects.
    const handle = await initTelemetry({
      endpoint: "http://127.0.0.1:4318",
      serviceName: "test-portal",
      sessionId: "00000000-0000-4000-8000-000000000000",
    });
    expect(typeof handle.enabled).toBe("boolean");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});

describe("sampler configuration", () => {
  it("defaults to 10%", () => {
    expect(DEFAULT_SAMPLE_RATIO).toBe(0.1);
    expect(resolveSampleRatio(undefined)).toBe(0.1);
  });

  it("honours an explicit ratio", () => {
    expect(resolveSampleRatio(0.25)).toBe(0.25);
    expect(resolveSampleRatio(0)).toBe(0);
    expect(resolveSampleRatio(1)).toBe(1);
  });

  it("degrades malformed values to the default or nearest bound", () => {
    expect(resolveSampleRatio(Number.NaN)).toBe(0.1);
    expect(resolveSampleRatio(2)).toBe(1);
    expect(resolveSampleRatio(-0.5)).toBe(0);
  });

  it("reports the effective ratio on the handle", async () => {
    const handle = await initTelemetry({ serviceName: "test-portal", sampleRatio: 0.3 });
    expect(handle.sampleRatio).toBe(0.3);
  });
});

const baseConfig = {
  application_name: "CVFF Beneficiary Portal",
  oidc: {
    authority: "https://keycloak.example/realms/blueeconomy",
    client_id: "beneficiary-portal",
    redirect_uri: "https://portal.example/",
    scope: "openid profile",
  },
  cvff_api: { base_url: "https://gateway.example/v1/cvff" },
};

describe("runtime config telemetry section", () => {
  it("is optional: absent section validates and leaves telemetry undefined", () => {
    const config = validateRuntimeConfiguration(baseConfig);
    expect(config.telemetry).toBeUndefined();
  });

  it("parses endpoint and defaults sample_ratio to 10%", () => {
    const config = validateRuntimeConfiguration({
      ...baseConfig,
      telemetry: { otlp_endpoint: "https://otel.example:4318" },
    });
    expect(config.telemetry?.otlp_endpoint).toBe("https://otel.example:4318");
    expect(config.telemetry?.sample_ratio).toBe(0.1);
  });

  it("accepts plain HTTP collector endpoints (dev/in-cluster OTLP)", () => {
    const config = validateRuntimeConfiguration({
      ...baseConfig,
      telemetry: { otlp_endpoint: "http://otel-collector.observability:4318", sample_ratio: 0.5 },
    });
    expect(config.telemetry?.sample_ratio).toBe(0.5);
  });

  it("rejects out-of-range sample ratios and credential-bearing URLs", () => {
    expect(() =>
      validateRuntimeConfiguration({ ...baseConfig, telemetry: { otlp_endpoint: "https://otel.example:4318", sample_ratio: 1.5 } }),
    ).toThrow("telemetry.sample_ratio");
    expect(() =>
      validateRuntimeConfiguration({ ...baseConfig, telemetry: { otlp_endpoint: "https://user:pass@otel.example:4318" } }),
    ).toThrow("telemetry.otlp_endpoint");
  });
});
