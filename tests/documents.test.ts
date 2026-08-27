import { describe, expect, it } from "vitest";
import { validateDocumentFile } from "../src/domain/documents";

const RULES = { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf", "image/png"] };

describe("document file validation", () => {
  it("accepts an allowed type within the size limit", () => {
    expect(validateDocumentFile({ name: "registration.pdf", size: 500_000, type: "application/pdf" }, RULES)).toBeNull();
  });

  it("rejects empty, oversize and disallowed-type files", () => {
    expect(validateDocumentFile({ name: "a.pdf", size: 0, type: "application/pdf" }, RULES)).toMatch(/empty/);
    expect(validateDocumentFile({ name: "a.pdf", size: 11 * 1024 * 1024, type: "application/pdf" }, RULES)).toMatch(/limit/);
    expect(validateDocumentFile({ name: "a.exe", size: 100, type: "application/x-msdownload" }, RULES)).toMatch(/not accepted/);
  });

  it("rejects hostile file names", () => {
    expect(validateDocumentFile({ name: "../../etc/passwd", size: 100, type: "application/pdf" }, RULES)).toMatch(/name/);
  });
});
