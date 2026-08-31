import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPLAINT_DRAFT,
  MAX_ATTACHMENTS,
  MAX_NARRATIVE_CHARS,
  RIGHT_TO_REDRESS_NOTICE,
  describeTimelineTransition,
  validateComplaintDraft,
  type ComplaintDraft,
} from "../src/domain/welfare";

const VALID_DRAFT: ComplaintDraft = {
  channel: "onboard_r515",
  category: "rest_hours",
  vesselRef: "IMO 9074729",
  operatorRef: "",
  narrative: "Rest hours were not honoured during the last two port calls.",
  attachments: [{ name: "rest-hour-log.pdf", sha256: "a".repeat(64) }],
  rightToRedressNoticeAck: true,
};

describe("complaint draft validation (mirrors the welfare backend)", () => {
  it("accepts a complete, acknowledged draft", () => {
    expect(validateComplaintDraft(VALID_DRAFT)).toEqual({});
    expect(validateComplaintDraft({ ...VALID_DRAFT, channel: "flagstate_r522", operatorRef: "OP-77" })).toEqual({});
  });

  it("requires a documented channel and MLC category", () => {
    const errors = validateComplaintDraft(EMPTY_COMPLAINT_DRAFT);
    expect(errors.channel).toBeDefined();
    expect(errors.category).toBeDefined();
    const forged = { ...VALID_DRAFT, channel: "radio_call" } as unknown as ComplaintDraft;
    expect(validateComplaintDraft(forged).channel).toBeDefined();
  });

  it("enforces canonical vessel and operator references", () => {
    expect(validateComplaintDraft({ ...VALID_DRAFT, vesselRef: "" }).vesselRef).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, vesselRef: " padded" }).vesselRef).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, vesselRef: "x".repeat(129) }).vesselRef).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, operatorRef: "trailing " }).operatorRef).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, operatorRef: "OP-1" }).operatorRef).toBeUndefined();
  });

  it("enforces the narrative bounds (1-8192 characters)", () => {
    expect(validateComplaintDraft({ ...VALID_DRAFT, narrative: "" }).narrative).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, narrative: "   " }).narrative).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, narrative: "x".repeat(MAX_NARRATIVE_CHARS + 1) }).narrative).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, narrative: "x".repeat(MAX_NARRATIVE_CHARS) }).narrative).toBeUndefined();
  });

  it("accepts digest-only attachments and rejects content-shaped or oversized references", () => {
    expect(
      validateComplaintDraft({ ...VALID_DRAFT, attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({ name: `f${i}`, sha256: "b".repeat(64) })) }).attachments,
    ).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, attachments: [{ name: "", sha256: "a".repeat(64) }] }).attachments).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, attachments: [{ name: "f", sha256: "not-a-digest" }] }).attachments).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, attachments: [{ name: "f", sha256: "A".repeat(64) }] }).attachments).toBeDefined();
    expect(validateComplaintDraft({ ...VALID_DRAFT, attachments: [] }).attachments).toBeUndefined();
  });

  it("fails closed when the right-to-redress notice is not acknowledged", () => {
    const errors = validateComplaintDraft({ ...VALID_DRAFT, rightToRedressNoticeAck: false });
    expect(errors.rightToRedressNoticeAck).toBeDefined();
    // The acknowledgement is the only blocker: everything else is valid.
    expect(Object.keys(errors)).toEqual(["rightToRedressNoticeAck"]);
  });

  it("exposes the mandatory redress notice text for intake display", () => {
    expect(RIGHT_TO_REDRESS_NOTICE).toContain("Regulation 5.1.5(3)");
    expect(RIGHT_TO_REDRESS_NOTICE).toContain("external redress");
    expect(RIGHT_TO_REDRESS_NOTICE).toContain("victimization");
  });
});

describe("timeline transition rendering", () => {
  it("renders intake, governed transitions and disclosures without inventing states", () => {
    expect(describeTimelineTransition("RECEIVED")).toBe("Complaint received");
    expect(describeTimelineTransition("RECEIVED->ACKED")).toBe("Status changed from Received to Acknowledged");
    expect(describeTimelineTransition("ONBOARD_PROCESS->ESCALATED_FLAGSTATE")).toBe(
      "Status changed from On-board process to Escalated to flag state",
    );
    expect(describeTimelineTransition("DISCLOSE:COURT_ORDER")).toContain("identity disclosed");
    expect(describeTimelineTransition("DISCLOSE:COURT_ORDER")).toContain("COURT_ORDER");
    // Unknown shapes are shown verbatim, never reinterpreted.
    expect(describeTimelineTransition("SOMETHING_UNDOCUMENTED")).toBe("SOMETHING_UNDOCUMENTED");
  });
});
