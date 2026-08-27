import { describe, expect, it } from "vitest";
import { IdempotencyKeyManager, type KeyValueStore } from "../src/idempotency";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("IdempotencyKeyManager", () => {
  it("mints one UUID per draft and reuses it across retries", () => {
    let minted = 0;
    const manager = new IdempotencyKeyManager("draft-1", memoryStore(), () => {
      minted += 1;
      return `uuid-${minted}`;
    });
    expect(manager.key()).toBe("uuid-1");
    // Retries after ambiguous failures must reuse the same key.
    expect(manager.key()).toBe("uuid-1");
    expect(manager.key()).toBe("uuid-1");
    expect(minted).toBe(1);
  });

  it("persists the key so a re-created manager (page reload) reuses it", () => {
    const store = memoryStore();
    const first = new IdempotencyKeyManager("draft-2", store, () => "persisted-uuid");
    expect(first.key()).toBe("persisted-uuid");
    const reloaded = new IdempotencyKeyManager("draft-2", store, () => "should-not-be-used");
    expect(reloaded.key()).toBe("persisted-uuid");
  });

  it("rotates to a fresh key after a confirmed submission", () => {
    let minted = 0;
    const manager = new IdempotencyKeyManager("draft-3", memoryStore(), () => `uuid-${++minted}`);
    expect(manager.key()).toBe("uuid-1");
    manager.rotate();
    expect(manager.key()).toBe("uuid-2");
  });

  it("scopes keys per draft id", () => {
    const store = memoryStore();
    const a = new IdempotencyKeyManager("draft-a", store, () => "key-a");
    const b = new IdempotencyKeyManager("draft-b", store, () => "key-b");
    expect(a.key()).toBe("key-a");
    expect(b.key()).toBe("key-b");
    expect(store.data.size).toBe(2);
  });

  it("degrades to an in-memory key when storage throws", () => {
    const brokenStore: KeyValueStore = {
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
    let minted = 0;
    const manager = new IdempotencyKeyManager("draft-4", brokenStore, () => `mem-${++minted}`);
    expect(manager.key()).toBe("mem-1");
    expect(manager.key()).toBe("mem-1");
    manager.rotate();
    expect(manager.key()).toBe("mem-2");
  });

  it("produces RFC-4122-shaped UUIDs with the default generator", () => {
    const manager = new IdempotencyKeyManager("draft-5", memoryStore());
    expect(manager.key()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
