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

describe("formatByteSize", () => {
  it("never rounds small files down to 0 KB", async () => {
    const { formatByteSize } = await import("../src/domain/documents");
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1023)).toBe("1023 B");
    expect(formatByteSize(1024)).toBe("1.0 KB");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(500_000)).toBe("488.3 KB");
    expect(formatByteSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatByteSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatByteSize(-5)).toBe("0 B");
  });
});
