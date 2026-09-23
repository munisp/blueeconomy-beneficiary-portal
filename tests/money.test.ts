import { describe, expect, it } from "vitest";
import { formatKoboAsNgn } from "../src/domain/money";

describe("NGN formatting", () => {
  it("formats kobo with the naira sign and en-NG grouping", () => {
    const formatted = formatKoboAsNgn(2_500_000_000);
    expect(formatted).toContain("25,000,000.00");
    expect(formatted.replace(/\s/g, " ")).toMatch(/₦/);
  });

  it("rejects unsafe or negative amounts", () => {
    expect(() => formatKoboAsNgn(-100)).toThrow();
    expect(() => formatKoboAsNgn(1.5)).toThrow();
    expect(() => formatKoboAsNgn(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
