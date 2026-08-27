import { describe, expect, it } from "vitest";
import {
  APPROVAL_CHAIN,
  CHAIN_STEP_LABELS,
  CVFF_STATES,
  isCvffState,
  isTerminalState,
  slaDeadline,
  slaReading,
  stateBadge,
  tierForState,
  TIER_SLA_BUSINESS_DAYS,
} from "../src/domain/cvff";

describe("CVFF state machine mirror", () => {
  it("covers every backend state exactly once", () => {
    expect(new Set(CVFF_STATES).size).toBe(CVFF_STATES.length);
    expect(CVFF_STATES).toContain("SUBMITTED");
    expect(CVFF_STATES).toContain("UNDERWRITING_PRIMARY");
    expect(CVFF_STATES).toContain("UNDERWRITING_SECONDARY");
    expect(CVFF_STATES).toContain("UNDERWRITING_TERTIARY");
    expect(CVFF_STATES).toContain("NIMASA_APPROVAL");
    expect(CVFF_STATES).toContain("BANK_CONFIRMATION");
    expect(CVFF_STATES).toContain("DISBURSEMENT_PENDING");
    expect(CVFF_STATES).toContain("DISBURSED");
    expect(CVFF_STATES).toContain("AUDITED");
    expect(CVFF_STATES).toContain("REJECTED");
    expect(CVFF_STATES).toContain("RECONCILIATION_REQUIRED");
  });

  it("maps every state to a badge with label, tone and description", () => {
    for (const state of CVFF_STATES) {
      const badge = stateBadge(state);
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.description.length).toBeGreaterThan(0);
      expect(["neutral", "info", "progress", "success", "danger", "warning"]).toContain(badge.tone);
    }
  });

  it("flags REJECTED and AUDITED as the only terminal states", () => {
    expect(isTerminalState("REJECTED")).toBe(true);
    expect(isTerminalState("AUDITED")).toBe(true);
    expect(isTerminalState("DISBURSED")).toBe(false);
    expect(isTerminalState("RECONCILIATION_REQUIRED")).toBe(false);
  });

  it("keeps the approval chain in the backend lifecycle order", () => {
    expect(APPROVAL_CHAIN).toEqual([
      "SUBMITTED",
      "UNDERWRITING_PRIMARY",
      "UNDERWRITING_SECONDARY",
      "UNDERWRITING_TERTIARY",
      "NIMASA_APPROVAL",
      "BANK_CONFIRMATION",
      "DISBURSEMENT_PENDING",
      "DISBURSED",
      "AUDITED",
    ]);
  });

  it("labels every chain step for the timeline", () => {
    for (const step of APPROVAL_CHAIN) {
      expect(CHAIN_STEP_LABELS[step]).toBeTruthy();
    }
  });

  it("rejects unknown state strings", () => {
    expect(isCvffState("FRAUDULENT_STATE")).toBe(false);
    expect(isCvffState(undefined)).toBe(false);
    expect(isCvffState("submitted")).toBe(false);
  });
});

describe("underwriting SLA", () => {
  it("matches the approved per-tier business-day SLAs", () => {
    expect(TIER_SLA_BUSINESS_DAYS.PRIMARY).toBe(5);
    expect(TIER_SLA_BUSINESS_DAYS.SECONDARY).toBe(3);
    expect(TIER_SLA_BUSINESS_DAYS.TERTIARY).toBe(2);
  });

  it("maps underwriting sub-states to tiers and nothing else", () => {
    expect(tierForState("UNDERWRITING_PRIMARY")).toBe("PRIMARY");
    expect(tierForState("UNDERWRITING_SECONDARY")).toBe("SECONDARY");
    expect(tierForState("UNDERWRITING_TERTIARY")).toBe("TERTIARY");
    expect(tierForState("NIMASA_APPROVAL")).toBeNull();
    expect(tierForState("DISBURSED")).toBeNull();
  });

  it("skips weekends when computing the deadline (Friday entry, primary tier)", () => {
    // Friday 2026-08-28 + 5 business days = Friday 2026-09-04.
    const friday = new Date("2026-08-28T10:00:00Z");
    const deadline = slaDeadline("PRIMARY", friday);
    expect(deadline.toISOString()).toBe(new Date("2026-09-04T10:00:00Z").toISOString());
  });

  it("skips weekends for the tertiary tier", () => {
    // Friday + 2 business days = Tuesday.
    const friday = new Date("2026-08-28T10:00:00Z");
    const deadline = slaDeadline("TERTIARY", friday);
    expect(deadline.getDay()).toBe(2);
  });

  it("reports on-track, due-soon and overdue readings", () => {
    const entered = new Date("2026-08-31T09:00:00Z"); // Monday
    const onTrack = slaReading("UNDERWRITING_TERTIARY", entered, new Date("2026-08-31T10:00:00Z"));
    expect(onTrack?.status).toBe("on-track");
    // Tertiary deadline from Monday 09:00 is Wednesday 09:00; Tuesday 10:00 is inside the last 24 h.
    const dueSoon = slaReading("UNDERWRITING_TERTIARY", entered, new Date("2026-09-01T10:00:00Z"));
    expect(dueSoon?.status).toBe("due-soon");
    const overdue = slaReading("UNDERWRITING_TERTIARY", entered, new Date("2026-09-05T10:00:00Z"));
    expect(overdue?.status).toBe("overdue");
    expect(slaReading("SUBMITTED", entered, new Date())).toBeNull();
  });
});
