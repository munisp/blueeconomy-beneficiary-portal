import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Phase 19 H3 regression: the service worker must NEVER cache
 * /platform-config.json. It is same-origin GET, so a cache-first handler
 * with unconditional runtime fill would pin installed PWAs to the stale
 * first copy forever — ignoring both the page's cache: "no-store" fetch and
 * nginx's `expires -1`. The ministry portal's SW already excludes it; this
 * test pins the beneficiary SW to the same network-only behaviour.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const swSource = readFileSync(resolve(root, "public/sw.js"), "utf8");

describe("service worker platform-config handling (H3)", () => {
  it("excludes /platform-config.json from every cache path (network-only)", () => {
    expect(swSource).toContain('"/platform-config.json"');
    // The exclusion must be an early network-only return, mirroring the
    // ministry SW: `if (url.pathname === "/platform-config.json") { return; }`
    expect(swSource).toMatch(/url\.pathname === "\/platform-config\.json"\s*\)\s*\{\s*return;/);
  });

  it("exclusion appears before the cache-first runtime fill", () => {
    const exclusion = swSource.indexOf('"/platform-config.json"');
    const runtimeFill = swSource.indexOf("cache.put(request");
    expect(exclusion).toBeGreaterThan(-1);
    expect(runtimeFill).toBeGreaterThan(-1);
    expect(exclusion).toBeLessThan(runtimeFill);
  });
});
