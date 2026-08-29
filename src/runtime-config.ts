export interface OidcRuntimeConfiguration {
  authority: string;
  client_id: string;
  redirect_uri: string;
  post_logout_redirect_uri?: string;
  scope: string;
}

export interface CvffApiRuntimeConfiguration {
  /**
   * Approved HTTPS base URL of the CVFF beneficiary API behind the platform
   * gateway, e.g. "https://gateway.example/v1/cvff". Resource paths are
   * appended by the API client; no host is ever hardcoded in the bundle.
   */
  base_url: string;
  /** Poll interval floor (ms) for status tracking; backoff multiplies it. */
  poll_interval_ms: number;
  /** Maximum accepted document size in bytes, mirrored client-side. */
  max_document_bytes: number;
  /** Approved document MIME types, mirrored client-side. */
  document_content_types: string[];
}

/**
 * Optional RUM (real-user monitoring) wiring, phase-7 OTel design. The
 * section is OPTIONAL: absent = browser telemetry disabled (the sanctioned
 * fail-open); the portal renders identically either way.
 */
export interface TelemetryRuntimeConfiguration {
  /**
   * OTLP/HTTP base URL of the cluster collector agent reachable from the
   * browser, e.g. "https://otel.example:4318". Plain HTTP is permitted here
   * (unlike business endpoints) because dev/in-cluster collectors are often
   * unencrypted; deployments should still prefer HTTPS via ingress.
   */
  otlp_endpoint: string;
  /** Trace sampling ratio in [0, 1]. Default 0.1 (10%). */
  sample_ratio: number;
}

export interface PortalRuntimeConfiguration {
  application_name: string;
  oidc: OidcRuntimeConfiguration;
  cvff_api: CvffApiRuntimeConfiguration;
  telemetry?: TelemetryRuntimeConfiguration;
}

export const DEFAULT_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_DOCUMENT_CONTENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export async function loadRuntimeConfiguration(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<PortalRuntimeConfiguration> {
  const response = await fetchFn(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`runtime configuration request failed with HTTP ${response.status}`);
  }
  const candidate: unknown = await response.json();
  return validateRuntimeConfiguration(candidate);
}

export function validateRuntimeConfiguration(candidate: unknown): PortalRuntimeConfiguration {
  if (!isRecord(candidate)) {
    throw new Error("runtime configuration must be a JSON object");
  }
  const applicationName = requiredText(candidate, "application_name");
  const oidcCandidate = requiredRecord(candidate, "oidc");
  const oidc: OidcRuntimeConfiguration = {
    authority: validateHttpsUrl(requiredText(oidcCandidate, "authority"), "oidc.authority"),
    client_id: requiredText(oidcCandidate, "client_id"),
    redirect_uri: validateHttpsUrl(requiredText(oidcCandidate, "redirect_uri"), "oidc.redirect_uri"),
    scope: requiredText(oidcCandidate, "scope"),
  };
  const postLogout = optionalText(oidcCandidate, "post_logout_redirect_uri");
  if (postLogout !== undefined) {
    oidc.post_logout_redirect_uri = validateHttpsUrl(postLogout, "oidc.post_logout_redirect_uri");
  }

  const apiCandidate = requiredRecord(candidate, "cvff_api");
  const baseUrl = validateHttpsUrl(requiredText(apiCandidate, "base_url"), "cvff_api.base_url");
  const pollInterval = optionalInteger(apiCandidate, "poll_interval_ms") ?? DEFAULT_POLL_INTERVAL_MS;
  if (pollInterval < 1_000 || pollInterval > 300_000) {
    throw new Error("cvff_api.poll_interval_ms must be between 1000 and 300000");
  }
  const maxDocumentBytes = optionalInteger(apiCandidate, "max_document_bytes") ?? DEFAULT_MAX_DOCUMENT_BYTES;
  if (maxDocumentBytes < 1 || maxDocumentBytes > 64 * 1024 * 1024) {
    throw new Error("cvff_api.max_document_bytes must be between 1 and 67108864");
  }
  const contentTypes = apiCandidate.document_content_types;
  const documentContentTypes =
    contentTypes === undefined
      ? [...DEFAULT_DOCUMENT_CONTENT_TYPES]
      : validateContentTypes(contentTypes);

  const telemetry = candidate.telemetry === undefined ? undefined : validateTelemetryConfiguration(requiredRecord(candidate, "telemetry"));

  return {
    application_name: applicationName,
    oidc,
    cvff_api: {
      base_url: baseUrl.replace(/\/+$/, ""),
      poll_interval_ms: pollInterval,
      max_document_bytes: maxDocumentBytes,
      document_content_types: documentContentTypes,
    },
    ...(telemetry === undefined ? {} : { telemetry }),
  };
}

export const DEFAULT_TELEMETRY_SAMPLE_RATIO = 0.1;

function validateTelemetryConfiguration(candidate: Record<string, unknown>): TelemetryRuntimeConfiguration {
  const endpoint = validateTelemetryUrl(requiredText(candidate, "otlp_endpoint"), "telemetry.otlp_endpoint");
  const sampleRatio = optionalNumber(candidate, "sample_ratio") ?? DEFAULT_TELEMETRY_SAMPLE_RATIO;
  if (sampleRatio < 0 || sampleRatio > 1) {
    throw new Error("telemetry.sample_ratio must be between 0 and 1");
  }
  return { otlp_endpoint: endpoint.replace(/\/+$/, ""), sample_ratio: sampleRatio };
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

/** HTTP(S) URL for the collector endpoint (HTTP allowed: dev/in-cluster OTLP). */
function validateTelemetryUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid HTTP(S) URL`);
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${field} must be an HTTP(S) URL without credentials, query parameters or fragments`);
  }
  return parsed.toString();
}

function validateContentTypes(candidate: unknown): string[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("cvff_api.document_content_types must be a non-empty string array");
  }
  return candidate.map((value, index) => {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(value)) {
      throw new Error(`cvff_api.document_content_types[${index}] must be a MIME type such as application/pdf`);
    }
    return value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = optionalText(record, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw new Error(`${key} must be non-empty text`);
  }
  return value.trim();
}

function optionalInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  return value;
}

function validateHttpsUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${field} must be an HTTPS URL without credentials, query parameters or fragments`);
  }
  return parsed.toString();
}
