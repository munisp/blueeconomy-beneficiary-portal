# Blue Economy CVFF Beneficiary Portal

This private TypeScript/React portal is the **runtime-configured** self-service entry point for vessel operators (beneficiaries) applying for Cabotage Vessel Financing Fund (CVFF) loans on the Blue Economy Platform. It contains no seeded users, sample applications, mock payment data, synthetic dashboards, default API addresses or substitute service responses. If the deployment does not supply a valid configuration, the portal renders a hard error and nothing else.

## What the portal does

- **Sign-in** — OIDC Authorization Code + PKCE against the platform Keycloak realm (`oidc-client-ts`, public client, session-scoped storage). Short-TTL access tokens are refreshed silently on demand; when refresh fails, the user is returned to the sign-in gate.
- **Dashboard** — lists the operator's CVFF applications with status badges mapped one-to-one to the backend state machine and a per-tier underwriting SLA countdown (PRIMARY 5 / SECONDARY 3 / TERTIARY 2 business days, weekends skipped — mirroring `internal/cvff` in `blueeconomy-financial-controls`).
- **New application wizard** — vessel details (name, IMO number with check-digit validation, official registry number, vessel class, cabotage trade route), requested NGN amount, and business details (name, CAC RC number, address). Client-side validation mirrors the API contract; server 4xx problem details are mapped back onto wizard fields.
- **Idempotent submission** — each draft gets one `Idempotency-Key` minted with `crypto.randomUUID()`, persisted in `sessionStorage`, reused verbatim across retries, and rotated only after a confirmed 2xx.
- **Document upload** — vessel registration, cabotage license and bank details with client-side type/size validation, real XHR upload progress, and idempotency-keyed retry. Success is shown only after a genuine 2xx response.
- **Status tracking** — timeline of the four-party approval chain (PLI primary/secondary/tertiary underwriters → NIMASA → receiving bank → disbursement → audit) plus the immutable decision event history, refreshed by bounded exponential-backoff polling that stops on terminal states (AUDITED, REJECTED).

## Deployment configuration (fail-closed)

The deployment must supply a non-secret `/platform-config.json` (same mount pattern as the ministry portal). The portal refuses to operate when the file is absent, invalid JSON, incomplete, or contains insecure (non-HTTPS, credentialed, query-bearing) URLs. Required shape:

```json
{
  "application_name": "CVFF Beneficiary Portal",
  "oidc": {
    "authority": "https://approved-keycloak/realms/blueeconomy",
    "client_id": "approved-public-client-id",
    "redirect_uri": "https://approved-portal-origin/callback",
    "post_logout_redirect_uri": "https://approved-portal-origin/",
    "scope": "openid profile"
  },
  "cvff_api": {
    "base_url": "https://approved-gateway/v1/cvff",
    "poll_interval_ms": 15000,
    "max_document_bytes": 10485760,
    "document_content_types": ["application/pdf", "image/png", "image/jpeg"]
  }
}
```

The JSON above is a **schema illustration only**; it must be replaced at deployment with the real Keycloak realm, registered client, redirect URIs, scopes and the APISIX-approved CVFF route. No corresponding configuration file is committed to this repository.

| Field | Required | Meaning |
| --- | --- | --- |
| `application_name` | yes | Displayed portal title. |
| `oidc.authority` | yes | HTTPS Keycloak realm issuer URL (no credentials/query/fragment). |
| `oidc.client_id` | yes | Registered public client for the authorization-code + PKCE flow. |
| `oidc.redirect_uri` | yes | Registered redirect URI for the code response. |
| `oidc.post_logout_redirect_uri` | no | Registered post-logout URI. |
| `oidc.scope` | yes | Approved scope string. |
| `cvff_api.base_url` | yes | HTTPS base URL of the CVFF beneficiary API behind the gateway. Resource paths (`/applications`, `/applications/{id}`, `/applications/{id}/events`, `/applications/{id}/documents`) are appended by the client. |
| `cvff_api.poll_interval_ms` | no (default 15000) | Base poll interval for status tracking; backoff doubles it to a 120 s ceiling. Range 1000–300000. |
| `cvff_api.max_document_bytes` | no (default 10485760) | Client-side upload size ceiling. Range 1–67108864. |
| `cvff_api.document_content_types` | no (default PDF/PNG/JPEG) | Client-side upload MIME allow-list. The backend remains authoritative. |

## API integration points

All calls are derived from `cvff_api.base_url` and carry the Keycloak access token as a bearer credential; no URL or credential is hardcoded:

| Endpoint | Method | Used by | Notes |
| --- | --- | --- | --- |
| `{base_url}/applications` | GET | Dashboard | Operator's application list. Empty list renders an honest "No applications" state. |
| `{base_url}/applications` | POST | New application wizard | Body: vessel/amount/business payload; header `Idempotency-Key: <uuid>` retained across retries. 4xx problem details (`title`, `errors{field: message}`) are mapped onto wizard fields. |
| `{base_url}/applications/{id}` | GET | Status tracking | Application detail including `state` and `state_entered_at`. |
| `{base_url}/applications/{id}/events` | GET | Status tracking | Immutable approval trail (`role`, `decision`, `from_state`, `to_state`, `created_at`) matching `internal/cvff.Approval`. |
| `{base_url}/applications/{id}/documents` | GET | Documents | Confirmed uploads only. |
| `{base_url}/applications/{id}/documents` | POST | Documents | Multipart (`document_type`, `file`) with `Idempotency-Key` header; success shown only on 2xx. |

The state machine rendered by the portal is exactly the one enforced by `blueeconomy-financial-controls` (`SUBMITTED → UNDERWRITING_PRIMARY → UNDERWRITING_SECONDARY → UNDERWRITING_TERTIARY → NIMASA_APPROVAL → BANK_CONFIRMATION → DISBURSEMENT_PENDING → DISBURSED → AUDITED`, plus fail-closed `REJECTED` and `RECONCILIATION_REQUIRED`).

## Security posture

- Strict CSP in both `index.html` (`<meta>`) and the nginx policy (`default-src 'self'`, no `object-src`, no inline scripts/styles).
- No production source maps (`vite build` with `sourcemap: false`; CI fails if any `.map` file appears in `dist`).
- Tokens live in `sessionStorage` only; API calls use `credentials: "omit"` and `cache: "no-store"`.
- Multi-stage Dockerfile: digest-pinned Node 22.13 build stage, digest-pinned `nginxinc/nginx-unprivileged` runtime, non-root user (101), port 8080, `/healthz` readiness route.
- CI (`permissions: contents: read`, SHA-pinned actions): type-check, build, source-map guard, unit tests, production audit; container build + Trivy FS/image scans failing on HIGH/CRITICAL.

## Runbook

```bash
# Local development (requires Node >= 20; CI and the container use Node 22)
npm ci
npm test
npm run build

# Serve the production build with a mounted configuration
sudo docker build -t blueeconomy-beneficiary-portal:local .
sudo docker run --rm -p 18082:8080 \
  -v /approved/non-secret/platform-config.json:/usr/share/nginx/html/platform-config.json:ro \
  blueeconomy-beneficiary-portal:local
curl --fail http://127.0.0.1:18082/healthz
```

### Operational checks before release

1. Mount the real `/platform-config.json` and confirm the portal renders the configured title; remove the file and confirm the hard integration-gate error appears.
2. Execute an end-to-end sign-in against the approved non-production Keycloak realm and retain the evidence.
3. Submit an application against the non-production CVFF API; repeat the submission after disabling the network mid-flight and confirm the retry reuses the same `Idempotency-Key` and no duplicate is created.
4. Upload a document, interrupt it, retry, and confirm exactly one document record exists.
5. Walk an application through all four-party states and confirm badges, SLA countdowns and the timeline match backend state.

TLS/HSTS, ingress routing, external CSP review, image signing, registry policy, workload identity, audit logging and non-production OIDC evidence remain environment-controlled release gates.
