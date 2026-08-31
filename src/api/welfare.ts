/**
 * Typed client for the seafarer welfare (MLC 2006) API exposed by
 * blueeconomy-credential-verification (src/welfare/routes.ts). Consumed
 * routes, all CONFIDENTIAL and bearer-authenticated with the same Keycloak
 * access token as the rest of the portal:
 *
 *   POST {base}/complaints        — complaint intake (seafarer role), requires
 *                                   the Idempotency-Key header; 201 on create,
 *                                   200 on idempotent replay.
 *   GET  {base}/complaints/mine   — the authenticated seafarer's complaints
 *                                   with their governed status timelines.
 *   GET  {base}/referrals/mine    — the authenticated seafarer's welfare
 *                                   referrals with recorded consent.
 *
 * Error responses carry `{ "error": "<message>" }` (http/server.ts). No
 * personal data appears in URLs — only the service-assigned references the
 * backend itself returns.
 */

import { ApiError, type CvffApiClient } from "./client";
import type {
  ComplaintChannel,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintTimelineEvent,
  ReferralStatus,
} from "../domain/welfare";

export interface WelfareAttachment {
  name: string;
  sha256: string;
}

/** Body of POST /complaints (service.ts ComplaintSubmitInput). */
export interface ComplaintSubmitPayload {
  channel: ComplaintChannel;
  category: ComplaintCategory;
  vesselRef: string;
  operatorRef?: string;
  narrative: string;
  attachments: WelfareAttachment[];
  rightToRedressNoticeAck: true;
}

/** Response of POST /complaints (201 created, 200 idempotent replay). */
export interface ComplaintSubmitResult {
  complaintId: string;
  status: ComplaintStatus;
  created: boolean;
  eventId: string;
}

/** Complainant-facing complaint record (service.ts complainantView). */
export interface ComplaintView {
  complaintId: string;
  channel: ComplaintChannel;
  vesselRef: string;
  operatorRef: string | null;
  category: ComplaintCategory;
  status: ComplaintStatus;
  narrative: string | null;
  narrativeDigestSha256: string;
  attachments: WelfareAttachment[];
  rightToRedressNoticeAck: boolean;
  disclosureScope: "withheld" | "disclosed";
  submittedAt: string;
  timeline: ComplaintTimelineEvent[];
}

export interface MyComplaintsResponse {
  seafarerReference: string | null;
  complaints: ComplaintView[];
}

/** Seafarer-facing referral record (service.ts myReferrals). */
export interface ReferralView {
  referralId: string;
  complaintId: string | null;
  serviceId: string;
  /** Timestamp of the mandatory recorded consent for this referral. */
  consentAt: string;
  status: ReferralStatus;
  recordedAt: string;
}

export interface MyReferralsResponse {
  seafarerReference: string | null;
  referrals: ReferralView[];
}

export async function submitComplaint(
  client: CvffApiClient,
  payload: ComplaintSubmitPayload,
  idempotencyKey: string,
): Promise<ComplaintSubmitResult> {
  return client.post<ComplaintSubmitResult>("/complaints", payload, idempotencyKey);
}

export async function fetchMyComplaints(client: CvffApiClient): Promise<MyComplaintsResponse> {
  return client.get<MyComplaintsResponse>("/complaints/mine");
}

export async function fetchMyReferrals(client: CvffApiClient): Promise<MyReferralsResponse> {
  return client.get<MyReferralsResponse>("/referrals/mine");
}

/**
 * Extracts the welfare module's `{error: message}` problem shape; falls back
 * to the generic message for unexpected failures. Messages are service text
 * only — never request payloads.
 */
export function welfareErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const problem = error.problem;
    if (typeof problem === "object" && problem !== null && typeof (problem as Record<string, unknown>).error === "string") {
      return (problem as Record<string, unknown>).error as string;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "The welfare service could not be reached. No local fallback is used.";
}
