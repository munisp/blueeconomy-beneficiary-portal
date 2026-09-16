import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { DraftOutbox, PermanentSubmissionError, isDefinitiveRejection, type QueuedSubmission } from "../src/pwa/draftOutbox";
import type { KeyValueStore } from "../src/idempotency";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const ENTRY: QueuedSubmission = {
  draftId: "draft-1",
  idempotencyKey: "key-1",
  payload: { vessel_name: "MV Test" },
  queuedAt: "2026-01-01T00:00:00.000Z",
};

describe("draft outbox (offline background sync)", () => {
  it("is empty by default and round-trips an enqueued entry", () => {
    const outbox = new DraftOutbox(memoryStore());
    expect(outbox.pending()).toBeNull();
    expect(outbox.enqueue(ENTRY)).toBe(true);
    expect(outbox.pending()).toEqual(ENTRY);
  });

  it("flush reports empty when nothing is queued", async () => {
    const outbox = new DraftOutbox(memoryStore());
    expect(await outbox.flush({ post: async () => ({}) })).toBe("empty");
  });

  it("flush delivers with the SAME idempotency key and clears on success", async () => {
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    const seen: Array<{ payload: unknown; key: string }> = [];
    const outcome = await outbox.flush({
      post: async (payload, key) => {
        seen.push({ payload, key });
        return {};
      },
    });
    expect(outcome).toBe("synced");
    expect(seen).toEqual([{ payload: ENTRY.payload, key: ENTRY.idempotencyKey }]);
    expect(outbox.pending()).toBeNull();
  });

  it("keeps the entry after a transient failure so the next sync retries", async () => {
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    let attempts = 0;
    const outcome = await outbox.flush({
      post: async () => {
        attempts += 1;
        throw new Error("network down");
      },
    });
    expect(outcome).toBe("pending");
    expect(attempts).toBe(1);
    expect(outbox.pending()).toEqual(ENTRY);
  });

  it("clears the entry on a definitive (permanent) rejection", async () => {
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    const outcome = await outbox.flush({
      post: async () => {
        throw new PermanentSubmissionError("validation refused");
      },
    });
    expect(outcome).toBe("rejected");
    expect(outbox.pending()).toBeNull();
  });

  // Phase 19 H1 regression: the real transport rejects with ApiError, never
  // PermanentSubmissionError. Definitive 4xx must be treated as permanent
  // (entry cleared, "rejected" surfaced) instead of re-POSTing forever.
  it.each([400, 401, 403, 404, 409, 422])(
    "clears the entry on a definitive ApiError 4xx (HTTP %i) from the transport",
    async (status) => {
      const outbox = new DraftOutbox(memoryStore());
      outbox.enqueue(ENTRY);
      let attempts = 0;
      const outcome = await outbox.flush({
        post: async () => {
          attempts += 1;
          throw new ApiError(status, { title: "refused" }, `HTTP ${status}`);
        },
      });
      expect(outcome).toBe("rejected");
      expect(attempts).toBe(1);
      expect(outbox.pending()).toBeNull();
      // A second flush is a no-op: the poisoned entry is gone for good.
      expect(await outbox.flush({ post: async () => ({}) })).toBe("empty");
    },
  );

  it.each([500, 502, 503])("keeps the entry on server-side 5xx (HTTP %i) for the next retry", async (status) => {
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    const outcome = await outbox.flush({
      post: async () => {
        throw new ApiError(status, null, `HTTP ${status}`);
      },
    });
    expect(outcome).toBe("pending");
    expect(outbox.pending()).toEqual(ENTRY);
  });

  it("keeps the entry on network failure/timeout (ApiError status 0)", async () => {
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    const outcome = await outbox.flush({
      post: async () => {
        throw new ApiError(0, null, "The API could not be reached. No local fallback is used.");
      },
    });
    expect(outcome).toBe("pending");
    expect(outbox.pending()).toEqual(ENTRY);
  });

  it.each([408, 429])("keeps retryable 4xx (HTTP %i) pending — not a definitive rejection", async (status) => {
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    const outcome = await outbox.flush({
      post: async () => {
        throw new ApiError(status, null, `HTTP ${status}`);
      },
    });
    expect(outcome).toBe("pending");
    expect(outbox.pending()).toEqual(ENTRY);
  });

  it("isDefinitiveRejection classifies transport errors honestly", () => {
    expect(isDefinitiveRejection(new PermanentSubmissionError("no"))).toBe(true);
    expect(isDefinitiveRejection(new ApiError(422, null, "HTTP 422"))).toBe(true);
    expect(isDefinitiveRejection(new ApiError(401, null, "HTTP 401"))).toBe(true);
    expect(isDefinitiveRejection(new ApiError(403, null, "HTTP 403"))).toBe(true);
    expect(isDefinitiveRejection(new ApiError(429, null, "HTTP 429"))).toBe(false);
    expect(isDefinitiveRejection(new ApiError(503, null, "HTTP 503"))).toBe(false);
    expect(isDefinitiveRejection(new ApiError(0, null, "network down"))).toBe(false);
    expect(isDefinitiveRejection(new Error("network down"))).toBe(false);
  });

  it("is idempotent across repeated flushes after a mid-flight success", async () => {
    // Simulates: first attempt reached the server but the response was lost;
    // the retry reuses the same key so the server deduplicates.
    const outbox = new DraftOutbox(memoryStore());
    outbox.enqueue(ENTRY);
    const keys: string[] = [];
    await outbox.flush({
      post: async (_payload, key) => {
        keys.push(key);
        throw new Error("response lost");
      },
    });
    await outbox.flush({
      post: async (_payload, key) => {
        keys.push(key);
        return {};
      },
    });
    expect(keys).toEqual(["key-1", "key-1"]);
    expect(outbox.pending()).toBeNull();
  });

  it("never submits a corrupt stored entry", async () => {
    const store = memoryStore();
    store.setItem("cvff.outbox.new-application", "{not json");
    const outbox = new DraftOutbox(store);
    expect(outbox.pending()).toBeNull();
    let called = false;
    await outbox.flush({
      post: async () => {
        called = true;
        return {};
      },
    });
    expect(called).toBe(false);
  });

  it("survives a store that throws (degrades to no-op)", async () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const outbox = new DraftOutbox(throwing);
    expect(outbox.pending()).toBeNull();
    expect(outbox.enqueue(ENTRY)).toBe(false);
    expect(await outbox.flush({ post: async () => ({}) })).toBe("empty");
  });
});
