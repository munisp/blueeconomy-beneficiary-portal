/**
 * Typed HTTP client for the CVFF beneficiary API. Every endpoint is derived
 * from the deployment-provided `cvff_api.base_url`; no host is hardcoded.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly problem: unknown;

  constructor(status: number, problem: unknown, fallback: string) {
    const title =
      typeof problem === "object" && problem !== null && typeof (problem as Record<string, unknown>).title === "string"
        ? ((problem as Record<string, unknown>).title as string)
        : fallback;
    super(title);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class CvffApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return this.request<T>("POST", path, JSON.stringify(body), headers);
  }

  async postForm<T>(path: string, form: FormData, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return this.request<T>("POST", path, form, headers);
  }

  /** Multipart upload with real progress events (see postFormWithProgress). */
  postFormWithProgress<T>(path: string, form: FormData, idempotencyKey: string, onProgress: (fraction: number) => void): Promise<T> {
    return postFormWithProgress<T>({
      baseUrl: this.baseUrl,
      token: this.token,
      path,
      form,
      idempotencyKey,
      onProgress,
    });
  }

  private async request<T>(method: string, path: string, body?: BodyInit, extraHeaders: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...extraHeaders,
        },
        body,
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed: unknown = text.length > 0 ? tryParseJson(text) : null;
      if (!response.ok) {
        throw new ApiError(response.status, parsed, `Request failed with HTTP ${response.status}`);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(0, null, "The request timed out. Check connectivity and retry.");
      }
      throw new ApiError(0, null, "The API could not be reached. No local fallback is used.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { title: text.slice(0, 200) };
  }
}

export interface ProgressUploadOptions {
  baseUrl: string;
  token: string;
  path: string;
  form: FormData;
  idempotencyKey: string;
  onProgress: (fraction: number) => void;
  timeoutMs?: number;
}

/**
 * Multipart upload over XMLHttpRequest so the progress bar reports real
 * transfer events. Resolves only on a genuine 2xx response; every other
 * outcome (4xx/5xx, network drop, timeout, abort) rejects with ApiError so
 * the UI can offer an honest retry with the same idempotency key.
 */
export function postFormWithProgress<T>(options: ProgressUploadOptions): Promise<T> {
  const url = `${options.baseUrl.replace(/\/+$/, "")}${options.path}`;
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.responseType = "text";
    xhr.timeout = options.timeoutMs ?? 120_000;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${options.token}`);
    xhr.setRequestHeader("Idempotency-Key", options.idempotencyKey);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress(Math.min(event.loaded / event.total, 1));
      }
    };
    xhr.onload = () => {
      const parsed: unknown = xhr.responseText.length > 0 ? tryParseJson(xhr.responseText) : null;
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress(1);
        resolve(parsed as T);
        return;
      }
      reject(new ApiError(xhr.status, parsed, `Upload failed with HTTP ${xhr.status}`));
    };
    xhr.onerror = () => {
      reject(new ApiError(0, null, "The upload was interrupted. Retry with the same file; the server deduplicates on the idempotency key."));
    };
    xhr.ontimeout = () => {
      reject(new ApiError(0, null, "The upload timed out. Retry with the same file."));
    };
    xhr.onabort = () => {
      reject(new ApiError(0, null, "The upload was cancelled."));
    };
    xhr.send(options.form);
  });
}
