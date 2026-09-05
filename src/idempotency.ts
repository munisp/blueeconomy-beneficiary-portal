/**
 * Idempotency-key lifecycle for application submissions.
 *
 * One key is minted per logical submission attempt (per draft) with
 * `crypto.randomUUID()` and retained across retries so that a network retry
 * never creates a duplicate application. The key is rotated only after the
 * server acknowledges the submission (2xx) or the draft is abandoned.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = "cvff.idempotency.";

export class IdempotencyKeyManager {
  private readonly storageKey: string;
  private memoryKey: string | null = null;

  constructor(
    draftId: string,
    private readonly store: KeyValueStore | null,
    private readonly randomUuid: () => string = () => crypto.randomUUID(),
  ) {
    this.storageKey = `${STORAGE_PREFIX}${draftId}`;
  }

  /**
   * Returns the stable key for this draft, minting and persisting one on
   * first use. Storage failures degrade to an in-memory key so the retry
   * guarantee still holds for the lifetime of the page.
   */
  key(): string {
    if (this.memoryKey !== null) {
      return this.memoryKey;
    }
    let existing: string | null = null;
    try {
      existing = this.store?.getItem(this.storageKey) ?? null;
    } catch {
      existing = null;
    }
    if (existing !== null && existing.length > 0) {
      this.memoryKey = existing;
      return existing;
    }
    const minted = this.randomUuid();
    this.memoryKey = minted;
    try {
      this.store?.setItem(this.storageKey, minted);
    } catch {
      // In-memory key still guarantees idempotent retries within this page.
    }
    return minted;
  }

  /** Rotates the key after a successful submission or explicit reset. */
  rotate(): void {
    this.memoryKey = null;
    try {
      this.store?.removeItem(this.storageKey);
    } catch {
      // Nothing to clean up; the next key() call mints a fresh value.
    }
  }
}

/** Uses sessionStorage when available so keys survive a page reload mid-retry. */
export function defaultIdempotencyStore(): KeyValueStore | null {
  try {
    const probe = "cvff.idempotency.probe";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const DRAFT_SESSION_KEY = "cvff.draft.new-application";

/**
 * Stable identifier of the in-progress "new application" draft. It survives
 * page reloads and remounts so the idempotency key derived from it also
 * survives, which is what makes a refresh mid-submit safe from duplicates.
 * Rotated only after a confirmed successful submission (or explicit reset).
 */
export function newApplicationDraftId(
  store: KeyValueStore | null,
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  try {
    const existing = store?.getItem(DRAFT_SESSION_KEY) ?? null;
    if (existing !== null && existing.length > 0) {
      return existing;
    }
    const minted = randomUuid();
    store?.setItem(DRAFT_SESSION_KEY, minted);
    return minted;
  } catch {
    // Storage unavailable: fall back to a per-mount id (retry guarantee
    // still holds within this page lifetime).
    return randomUuid();
  }
}

/** Drops the current draft id after a confirmed submission so the next application starts fresh. */
export function resetNewApplicationDraftId(store: KeyValueStore | null): void {
  try {
    store?.removeItem(DRAFT_SESSION_KEY);
  } catch {
    // Nothing to clean up.
  }
}
