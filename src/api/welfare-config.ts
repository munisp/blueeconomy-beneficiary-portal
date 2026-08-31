/**
 * Build-time configuration for the seafarer welfare (MLC 2006) surface.
 *
 * The welfare API base URL comes from the `VITE_WELFARE_API_BASE_URL`
 * environment variable at build time (e.g. "https://approved-gateway/v1/welfare"
 * — the resource paths `/complaints`, `/complaints/mine`, `/referrals/mine`
 * are appended by the client). Following the portal doctrine, the surface
 * fails closed when the variable is unset or insecure: no fallback host is
 * ever fabricated in the bundle.
 */

export const WELFARE_API_BASE_URL_ENV = "VITE_WELFARE_API_BASE_URL";

export interface WelfareEnvLike {
  readonly VITE_WELFARE_API_BASE_URL?: string | undefined;
}

export function welfareApiBaseUrlFromEnv(env: WelfareEnvLike): string {
  return validateWelfareApiBaseUrl(env.VITE_WELFARE_API_BASE_URL);
}

export function validateWelfareApiBaseUrl(candidate: string | undefined): string {
  if (candidate === undefined || candidate.trim().length === 0) {
    throw new Error(
      `${WELFARE_API_BASE_URL_ENV} is not set; the seafarer welfare surface is disabled. ` +
        "Set it to the approved HTTPS base URL of the welfare API (for example https://gateway.example/v1/welfare) at build time.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    throw new Error(`${WELFARE_API_BASE_URL_ENV} must be a valid HTTPS URL`);
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(
      `${WELFARE_API_BASE_URL_ENV} must be an HTTPS URL without credentials, query parameters or fragments (loopback HTTP is accepted only for local development)`,
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}
