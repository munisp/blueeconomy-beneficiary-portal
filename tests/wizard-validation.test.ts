import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  MAX_AMOUNT_KOBO,
  MIN_AMOUNT_KOBO,
  draftToPayload,
  isValidImoNumber,
  mapServerErrors,
  parseAmountKobo,
  validateDraft,
  type ApplicationDraft,
} from "../src/domain/wizard";

const VALID_DRAFT: ApplicationDraft = {
  vesselName: "MV Eko Trader",
  imoNumber: "9074729", // real IMO check-digit example (IMO 9074729)
  officialNumber: "NG-LAG-004512",
  vesselClass: "CARGO_COASTER",
  cabotageRoute: "LAGOS_PORT_HARCOURT",
  amountNairaText: "25000000",
  businessName: "Eko Coastal Logistics Limited",
  businessRcNumber: "RC1234567",
  businessAddress: "14 Marina Road, Apapa, Lagos",
};

describe("IMO number validation", () => {
  it("accepts a number with a correct check digit", () => {
    expect(isValidImoNumber("9074729")).toBe(true);
    expect(isValidImoNumber("8814275")).toBe(true);
  });

  it("rejects a bad check digit, wrong length and non-digits", () => {
    expect(isValidImoNumber("9074728")).toBe(false);
    expect(isValidImoNumber("907472")).toBe(false);
    expect(isValidImoNumber("90747290")).toBe(false);
    expect(isValidImoNumber("ABCDEFG")).toBe(false);
    expect(isValidImoNumber("")).toBe(false);
  });
});

describe("amount parsing and bounds", () => {
  it("parses plain and grouped naira into kobo", () => {
    expect(parseAmountKobo("25000000")).toBe(2_500_000_000);
    expect(parseAmountKobo("25,000,000")).toBe(2_500_000_000);
    expect(parseAmountKobo("100.50")).toBe(10_050);
    expect(parseAmountKobo("₦ 1,000")).toBe(100_000);
  });

  it("rejects malformed or unsafe input", () => {
    expect(parseAmountKobo("abc")).toBeNull();
    expect(parseAmountKobo("10.999")).toBeNull();
    expect(parseAmountKobo("-5")).toBeNull();
    expect(parseAmountKobo("")).toBeNull();
    expect(parseAmountKobo("99999999999999999999")).toBeNull();
  });

  it("enforces the CVFF loan bounds", () => {
    expect(validateDraft({ ...VALID_DRAFT, amountNairaText: "1000000" }).amountNairaText).toBeDefined();
    expect(validateDraft({ ...VALID_DRAFT, amountNairaText: "5000000" }).amountNairaText).toBeUndefined();
    expect(validateDraft({ ...VALID_DRAFT, amountNairaText: "5000000000" }).amountNairaText).toBeDefined();
    expect(MIN_AMOUNT_KOBO).toBe(500_000_000);
    expect(MAX_AMOUNT_KOBO).toBe(200_000_000_000);
  });
});

describe("draft validation", () => {
  it("accepts a complete valid draft", () => {
    expect(validateDraft(VALID_DRAFT)).toEqual({});
  });

  it("flags every required field on an empty draft", () => {
    const errors = validateDraft(EMPTY_DRAFT);
    expect(Object.keys(errors).sort()).toEqual([
      "amountNairaText",
      "businessAddress",
      "businessName",
      "businessRcNumber",
      "cabotageRoute",
      "imoNumber",
      "officialNumber",
      "vesselClass",
      "vesselName",
    ]);
  });

  it("validates the CAC RC number format", () => {
    expect(validateDraft({ ...VALID_DRAFT, businessRcNumber: "RC123456" }).businessRcNumber).toBeUndefined();
    expect(validateDraft({ ...VALID_DRAFT, businessRcNumber: "BN123456" }).businessRcNumber).toBeDefined();
    expect(validateDraft({ ...VALID_DRAFT, businessRcNumber: "123" }).businessRcNumber).toBeDefined();
  });
});

describe("payload construction", () => {
  it("produces an NGN kobo payload with canonicalised fields", () => {
    const payload = draftToPayload({ ...VALID_DRAFT, businessRcNumber: "rc1234567" });
    expect(payload.currency).toBe("NGN");
    expect(payload.amount).toBe(2_500_000_000);
    expect(payload.business_rc_number).toBe("RC1234567");
  });

  it("refuses to build a payload from an invalid draft", () => {
    expect(() => draftToPayload(EMPTY_DRAFT)).toThrow();
  });
});

describe("server error mapping", () => {
  it("maps known problem fields onto wizard fields", () => {
    const { fieldErrors, formError } = mapServerErrors({
      title: "Validation failed",
      errors: { imo_number: "unknown IMO", amount: "exceeds applicant ceiling" },
    });
    expect(fieldErrors.imoNumber).toBe("unknown IMO");
    expect(fieldErrors.amountNairaText).toBe("exceeds applicant ceiling");
    expect(formError).toBe("Validation failed");
  });

  it("routes unknown fields to a form-level message", () => {
    const { fieldErrors, formError } = mapServerErrors({ errors: { tenant: "not provisioned" } });
    expect(fieldErrors).toEqual({});
    expect(formError).toContain("tenant");
  });

  it("fails closed on unstructured problem bodies", () => {
    expect(mapServerErrors(null).formError).not.toBeNull();
    expect(mapServerErrors("nope").formError).not.toBeNull();
    expect(mapServerErrors({}).formError).not.toBeNull();
  });
});
