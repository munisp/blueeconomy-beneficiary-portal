import { describe, expect, it } from "vitest";
import { classifyBootstrapError } from "../src/auth";

describe("classifyBootstrapError", () => {
  it("classifies oidc-client-ts stale/duplicated callback state errors as session-expired", () => {
    expect(classifyBootstrapError(new Error("No matching state found in storage"))).toBe("session-expired");
    expect(classifyBootstrapError(new Error("no matching state found in storage"))).toBe("session-expired");
    expect(classifyBootstrapError(new Error("No state in storage for the given key"))).toBe("session-expired");
  });

  it("keeps genuine configuration failures fail-closed as configuration errors", () => {
    expect(classifyBootstrapError(new Error("runtime configuration fetch failed: 404"))).toBe("configuration");
    expect(classifyBootstrapError(new Error("oidc.authority is missing"))).toBe("configuration");
    expect(classifyBootstrapError("string failure")).toBe("configuration");
    expect(classifyBootstrapError(null)).toBe("configuration");
    expect(classifyBootstrapError(undefined)).toBe("configuration");
  });
});
