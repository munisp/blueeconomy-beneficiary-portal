import { describe, expect, it } from "vitest";
import { startPolling } from "../src/polling";

describe("backoff poller", () => {
  it("stops after a terminal report", async () => {
    let ticks = 0;
    const handle = startPolling(
      async () => {
        ticks += 1;
        return { terminal: ticks >= 3 };
      },
      () => undefined,
      { baseMs: 5, maxMs: 20 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    handle.cancel();
    expect(ticks).toBe(3);
  });

  it("keeps polling with backoff after errors and reports them", async () => {
    const errors: string[] = [];
    let ticks = 0;
    const handle = startPolling(
      async () => {
        ticks += 1;
        if (ticks === 1) {
          throw new Error("boom");
        }
        return { terminal: true };
      },
      (message) => errors.push(message),
      { baseMs: 5, maxMs: 20 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    handle.cancel();
    expect(errors).toEqual(["boom"]);
    expect(ticks).toBeGreaterThanOrEqual(2);
  });

  it("honours cancellation", async () => {
    let ticks = 0;
    const handle = startPolling(
      async () => {
        ticks += 1;
        return { terminal: false };
      },
      () => undefined,
      { baseMs: 50, maxMs: 60 },
    );
    handle.cancel();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(ticks).toBeLessThanOrEqual(1);
  });
});
