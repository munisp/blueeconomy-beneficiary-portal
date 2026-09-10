import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CSP/SRI hardening audit test (Phase 17, innovation #17).
 *
 * Phase 15 fixed the service-worker regression by adding `worker-src 'self'`;
 * this test pins that fix and asserts the portal keeps a same-origin-only
 * script policy. The portal ships NO CDN assets (verified by this test), so
 * there is nothing to attach SRI hashes to — if a CDN asset is ever added,
 * this test fails closed until it is removed or given an integrity hash.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8");
const nginxConf = readFileSync(resolve(root, "deploy/nginx.conf"), "utf8");

function metaCsp(html: string): string {
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  expect(match, "index.html must carry a CSP meta policy").not.toBeNull();
  return match![1];
}

describe("CSP hardening", () => {
  it("meta CSP allows the service worker (worker-src 'self')", () => {
    const csp = metaCsp(indexHtml);
    expect(csp).toContain("worker-src 'self'");
  });

  it("nginx CSP header allows the service worker (worker-src 'self')", () => {
    expect(nginxConf).toContain("Content-Security-Policy");
    expect(nginxConf).toContain("worker-src 'self'");
  });

  it("script-src is same-origin only (no CDN script origins)", () => {
    const csp = metaCsp(indexHtml);
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
    const nginxScript = nginxConf.match(/script-src [^;]+;/);
    expect(nginxScript?.[0]).toBe("script-src 'self';");
  });

  it("ships no external (CDN) script or stylesheet references needing SRI", () => {
    const external = indexHtml.match(/<(script|link)[^>]+(src|href)="https?:\/\/[^"]+"/g) ?? [];
    expect(external).toEqual([]);
  });

  it("locks down object/base/frame directives", () => {
    const csp = metaCsp(indexHtml);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(nginxConf).toContain("frame-ancestors 'none'");
    expect(nginxConf).toContain("upgrade-insecure-requests");
  });

  it("service worker stays same-origin and never intercepts cross-origin traffic", () => {
    const sw = readFileSync(resolve(root, "public/sw.js"), "utf8");
    expect(sw).toContain('url.origin !== self.location.origin');
    // fetch handler must only ever respond to GET navigations/assets
    expect(sw).toContain('request.method !== "GET"');
  });
});
