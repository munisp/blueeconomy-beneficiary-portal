/**
 * Offline draft outbox for the application wizard (Phase 17, innovation #14).
 *
 * When a submission is attempted while offline (or fails with a network
 * error), the payload plus its Phase-15 idempotency key (stable per draftId)
 * are persisted here. When connectivity returns — via the window "online"
 * event, or via a Background Sync ("cvff-draft-sync") message relayed by the
 * service worker — `flush` re-submits with the SAME idempotency key, so a
 * queued request that secretly reached the server can never create a
 * duplicate application. The entry is removed only after a confirmed 2xx or
 * a definitive 4xx rejection (which means the server saw and refused it).
 *
 * Scope of honesty: the outbox holds exactly one pending submission (the
 * wizard has one draft per session). It never claims a queued application
 * was received by the server — the UI shows "queued, not yet sent".
 */
import type { KeyValueStore } from "../idempotency";

export interface QueuedSubmission {
  /** Stable Phase-15 draft id the idempotency key belongs to. */
  draftId: string;
  /** Idempotency key reused on every flush attempt. */
  idempotencyKey: string;
  /** Opaque create-application payload (already validated client-side). */
  payload: unknown;
  /** ISO time the submission was first queued. */
  queuedAt: string;
}

export interface SubmissionTransport {
  post(payload: unknown, idempotencyKey: string): Promise<unknown>;
}

const OUTBOX_KEY = "cvff.outbox.new-application";

/** Error marker: a definitive client rejection (4xx) — stop retrying. */
export class PermanentSubmissionError extends Error {}

/**
 * Definitive-rejection classifier (Phase 19 H1). The outbox previously
 * stopped retrying only on PermanentSubmissionError, but the real transport
 * (CvffApiClient.createApplication) rejects with ApiError — so every 4xx
 * (422 validation, 401 expired session, 403 forbidden) was misclassified as
 * transient and the poisoned entry was re-POSTed forever. A definitive 4xx
 * means the server saw and refused the submission: clear the entry and
 * surface "rejected". Retry is kept ONLY for genuinely ambiguous outcomes:
 * network failure/timeout (status 0), 5xx, 408 (request timeout) and 429
 * (rate limited) — none of which prove the server rejected the payload.
 */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

export function isDefinitiveRejection(error: unknown): boolean {
  if (error instanceof PermanentSubmissionError) {
    return true;
  }
  // Duck-typed ApiError (src/api/client.ts): { status: number }. Duck-typing
  // keeps this module free of the api/ layer and works across realms/bundles.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return !RETRYABLE_CLIENT_STATUSES.has(status);
  }
  return false;
}

export class DraftOutbox {
  constructor(
    private readonly store: KeyValueStore | null,
    private readonly storageKey: string = OUTBOX_KEY,
  ) {}

  /** Returns the pending queued submission, or null. */
  pending(): QueuedSubmission | null {
    let raw: string | null = null;
    try {
      raw = this.store?.getItem(this.storageKey) ?? null;
    } catch {
      return null;
    }
    if (raw === null || raw.length === 0) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isQueuedSubmission(parsed)) {
        return null; // corrupt entry: never submit data we cannot recognise
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /** Queues a submission. Overwrites any prior entry for the same draft. */
  enqueue(entry: QueuedSubmission): boolean {
    try {
      this.store?.setItem(this.storageKey, JSON.stringify(entry));
      return true;
    } catch {
      return false;
    }
  }

  /** Drops the queued submission after a confirmed outcome. */
  clear(): void {
    try {
      this.store?.removeItem(this.storageKey);
    } catch {
      // Nothing to clean up.
    }
  }

  /**
   * Attempts to deliver the queued submission. Returns:
   *  - "empty"    — nothing queued;
   *  - "synced"   — server confirmed receipt (entry cleared);
   *  - "rejected" — server definitively refused it (entry cleared, caller
   *                 must surface the rejection honestly);
   *  - "pending"  — network/5xx ambiguity, entry kept for the next retry.
   */
  async flush(transport: SubmissionTransport): Promise<"empty" | "synced" | "rejected" | "pending"> {
    const entry = this.pending();
    if (entry === null) {
      return "empty";
    }
    try {
      await transport.post(entry.payload, entry.idempotencyKey);
      this.clear();
      return "synced";
    } catch (error) {
      // Definitive 4xx (incl. ApiError 401/403/422 from the transport): the
      // server saw and refused the submission — clear it and report
      // "rejected" so the UI can demand user action instead of re-POSTing
      // forever. Network/5xx stays "pending" for the next sync.
      if (isDefinitiveRejection(error)) {
        this.clear();
        return "rejected";
      }
      return "pending";
    }
  }
}

function isQueuedSubmission(candidate: unknown): candidate is QueuedSubmission {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.draftId === "string" &&
    typeof record.idempotencyKey === "string" &&
    typeof record.queuedAt === "string" &&
    "payload" in record
  );
}

/** localStorage so the queued draft survives a full browser restart. */
export function defaultOutboxStore(): KeyValueStore | null {
  try {
    const probe = "cvff.outbox.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
