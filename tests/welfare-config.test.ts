import { describe, expect, it } from "vitest";
import { validateWelfareApiBaseUrl, welfareApiBaseUrlFromEnv, WELFARE_API_BASE_URL_ENV } from "../src/api/welfare-config";

describe("welfare API base URL configuration (fail-closed)", () => {
  it("refuses to operate when the variable is unset or empty", () => {
    expect(() => validateWelfareApiBaseUrl(undefined)).toThrow(WELFARE_API_BASE_URL_ENV);
    expect(() => validateWelfareApiBaseUrl("")).toThrow(WELFARE_API_BASE_URL_ENV);
    expect(() => validateWelfareApiBaseUrl("   ")).toThrow(WELFARE_API_BASE_URL_ENV);
    expect(() => welfareApiBaseUrlFromEnv({})).toThrow(WELFARE_API_BASE_URL_ENV);
  });

  it("rejects non-HTTPS, credentialed, query- and fragment-bearing URLs", () => {
    expect(() => validateWelfareApiBaseUrl("http://welfare.internal/v1/welfare")).toThrow(/HTTPS/);
    expect(() => validateWelfareApiBaseUrl("https://user:pass@gateway.example/v1/welfare")).toThrow(/credentials/);
    expect(() => validateWelfareApiBaseUrl("https://gateway.example/v1/welfare?x=1")).toThrow(/query/);
    expect(() => validateWelfareApiBaseUrl("https://gateway.example/v1/welfare#frag")).toThrow(/fragments/);
    expect(() => validateWelfareApiBaseUrl("not a url")).toThrow(/valid HTTPS URL/);
  });

  it("accepts an approved HTTPS base URL and strips trailing slashes", () => {
    expect(validateWelfareApiBaseUrl("https://gateway.example/v1/welfare")).toBe("https://gateway.example/v1/welfare");
    expect(validateWelfareApiBaseUrl("https://gateway.example/v1/welfare/")).toBe("https://gateway.example/v1/welfare");
  });

  it("accepts loopback HTTP only for local development", () => {
    expect(validateWelfareApiBaseUrl("http://localhost:8080/v1/welfare")).toBe("http://localhost:8080/v1/welfare");
    expect(validateWelfareApiBaseUrl("http://127.0.0.1:8080/v1/welfare")).toBe("http://127.0.0.1:8080/v1/welfare");
    expect(() => validateWelfareApiBaseUrl("http://192.168.1.10/v1/welfare")).toThrow(/HTTPS/);
  });
});
