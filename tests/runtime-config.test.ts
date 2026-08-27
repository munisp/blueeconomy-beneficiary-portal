import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_CONTENT_TYPES,
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_POLL_INTERVAL_MS,
  loadRuntimeConfiguration,
  validateRuntimeConfiguration,
} from "../src/runtime-config";

const VALID_CONFIG = {
  application_name: "CVFF Beneficiary Portal",
  oidc: {
    authority: "https://keycloak.example.invalid/realms/blueeconomy",
    client_id: "beneficiary-portal",
    redirect_uri: "https://beneficiaries.example.invalid/callback",
    scope: "openid profile",
  },
  cvff_api: {
    base_url: "https://gateway.example.invalid/v1/cvff",
  },
};

describe("runtime configuration validation (fail-closed)", () => {
  it("accepts a minimal valid configuration and applies defaults", () => {
    const config = validateRuntimeConfiguration(VALID_CONFIG);
    expect(config.cvff_api.base_url).toBe("https://gateway.example.invalid/v1/cvff");
    expect(config.cvff_api.poll_interval_ms).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(config.cvff_api.max_document_bytes).toBe(DEFAULT_MAX_DOCUMENT_BYTES);
    expect(config.cvff_api.document_content_types).toEqual(DEFAULT_DOCUMENT_CONTENT_TYPES);
  });

  it("rejects non-object, null and array configurations", () => {
    expect(() => validateRuntimeConfiguration(null)).toThrow();
    expect(() => validateRuntimeConfiguration("config")).toThrow();
    expect(() => validateRuntimeConfiguration([])).toThrow();
  });

  it("rejects a configuration without OIDC settings", () => {
    const { oidc: _removed, ...rest } = VALID_CONFIG;
    expect(() => validateRuntimeConfiguration(rest)).toThrow(/oidc/);
  });

  it("rejects insecure or credentialed URLs", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...VALID_CONFIG,
        oidc: { ...VALID_CONFIG.oidc, authority: "http://insecure.example.invalid" },
      }),
    ).toThrow(/oidc\.authority/);
    expect(() =>
      validateRuntimeConfiguration({
        ...VALID_CONFIG,
        cvff_api: { base_url: "https://user:pass@gateway.example.invalid/v1/cvff" },
      }),
    ).toThrow(/cvff_api\.base_url/);
    expect(() =>
      validateRuntimeConfiguration({
        ...VALID_CONFIG,
        oidc: { ...VALID_CONFIG.oidc, redirect_uri: "https://portal.example.invalid/cb?code=1" },
      }),
    ).toThrow(/oidc\.redirect_uri/);
  });

  it("rejects a missing or malformed API base URL", () => {
    expect(() =>
      validateRuntimeConfiguration({ ...VALID_CONFIG, cvff_api: {} }),
    ).toThrow(/base_url/);
    expect(() =>
      validateRuntimeConfiguration({ ...VALID_CONFIG, cvff_api: { base_url: "not a url" } }),
    ).toThrow(/cvff_api\.base_url/);
  });

  it("rejects out-of-range tuning values", () => {
    expect(() =>
      validateRuntimeConfiguration({ ...VALID_CONFIG, cvff_api: { ...VALID_CONFIG.cvff_api, poll_interval_ms: 10 } }),
    ).toThrow(/poll_interval_ms/);
    expect(() =>
      validateRuntimeConfiguration({ ...VALID_CONFIG, cvff_api: { ...VALID_CONFIG.cvff_api, max_document_bytes: 0 } }),
    ).toThrow(/max_document_bytes/);
  });

  it("rejects malformed document content types", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...VALID_CONFIG,
        cvff_api: { ...VALID_CONFIG.cvff_api, document_content_types: ["PDF"] },
      }),
    ).toThrow(/document_content_types/);
  });

  it("fails closed when the configuration endpoint errors or returns junk", async () => {
    const notFound = async () => new Response("missing", { status: 404 });
    await expect(loadRuntimeConfiguration("/platform-config.json", notFound as typeof fetch)).rejects.toThrow(/404/);

    const junk = async () => new Response("not json", { status: 200 });
    await expect(loadRuntimeConfiguration("/platform-config.json", junk as typeof fetch)).rejects.toThrow();

    const invalid = async () =>
      new Response(JSON.stringify({ application_name: "x" }), { status: 200 });
    await expect(loadRuntimeConfiguration("/platform-config.json", invalid as typeof fetch)).rejects.toThrow();
  });
});
