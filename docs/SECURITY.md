# Security Posture — BlueEconomy CVFF Beneficiary Portal

Phase-11 security audit and hardening (branch `phase11/security`). Client-only
React SPA served by nginx; authorization is enforced by the CVFF API it calls.

## Controls present (pre-existing)

- **HTTP headers (nginx `deploy/nginx.conf`):** CSP (`default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`,
  `form-action 'self'`, `script-src 'self'`, `style-src 'self'`,
  `font-src 'self'`, `manifest-src 'none'`, `worker-src 'none'`,
  `upgrade-insecure-requests`), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, restrictive
  `Permissions-Policy`, `server_tokens off`.
- **Runtime configuration validation:** all configured URLs must be HTTPS with
  no embedded credentials/query/fragment; invalid config aborts boot
  (fail-closed).
- **OIDC:** authorization-code + PKCE via `oidc-client-ts`; tokens/state in
  `sessionStorage`; `credentials: "omit"` on all API calls (bearer-only).
- **Submission integrity:** per-draft idempotency keys (`crypto.randomUUID()`)
  retained across retries so network retries never duplicate applications;
  keys rotate only after server acknowledgement.
- **Error handling:** `ApiError` surfaces only problem+`title`/HTTP status —
  no stack traces or internal details rendered.
- **Build:** pinned base-image digests; `npm ci --ignore-scripts`;
  unprivileged nginx runtime.

## Fixes applied in Phase 11

1. **Missing HSTS (LOW).** Added `Strict-Transport-Security: max-age=31536000;
   includeSubDomains` to the nginx config (honoured via TLS-terminating
   ingress).
2. **Dependency audit.** `npm audit` (prod and full) against
   registry.npmjs.org: 0 vulnerabilities.

## Audit notes (categories with no findings)

- **Secrets scan:** no private keys, tokens, passwords, or connection strings
  in the working tree; API base URL is runtime-injected.
- **CORS / rate limiting / AuthZ / RLS:** no server-side API in this repo;
  these controls belong to the CVFF backend service.

## Residual recommendations

- CSP `connect-src 'self' https:` is intentionally broad (runtime-configured
  API origin); replace `https:` with the explicit CVFF API origin once stable.
- Consider upload content-type/size pre-validation parity with the backend
  allowlist (currently enforced server-side only).

## Validation

- `npm run build` (tsc -b + vite build): success.
- `npm test` (vitest): 47/47 pass across 7 files.
- `npm audit`: 0 vulnerabilities.
