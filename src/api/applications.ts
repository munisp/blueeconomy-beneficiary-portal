import type { CvffApiClient } from "./client";
import { isCvffState, type CvffState } from "../domain/cvff";
import type { CreateApplicationPayload } from "../domain/wizard";
import type { DocumentType } from "../domain/documents";

/** Application summary as returned by GET /applications. */
export interface ApplicationSummary {
  application_id: string;
  vessel_name: string;
  amount: number;
  currency: string;
  state: CvffState;
  state_entered_at: string;
  created_at: string;
  updated_at: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  imo_number: string;
  official_number: string;
  vessel_class: string;
  cabotage_route: string;
  business_name: string;
  business_rc_number: string;
  business_address: string;
}

/** One immutable decision entry in the observer-friendly audit trail. */
export interface ApprovalEvent {
  approval_id: string;
  application_id: string;
  role: string;
  principal_id: string;
  decision: "APPROVE" | "REJECT";
  from_state: CvffState;
  to_state: CvffState;
  created_at: string;
}

export interface UploadedDocument {
  document_id: string;
  application_id: string;
  document_type: DocumentType;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export function isApplicationSummary(candidate: unknown): candidate is ApplicationSummary {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.application_id === "string" &&
    typeof record.vessel_name === "string" &&
    typeof record.amount === "number" &&
    record.currency === "NGN" &&
    isCvffState(record.state) &&
    typeof record.state_entered_at === "string" &&
    typeof record.created_at === "string"
  );
}

export function listApplications(client: CvffApiClient): Promise<ApplicationSummary[]> {
  return client.get<ApplicationSummary[]>("/applications");
}

export function getApplication(client: CvffApiClient, applicationId: string): Promise<ApplicationDetail> {
  return client.get<ApplicationDetail>(`/applications/${encodeURIComponent(applicationId)}`);
}

export function getApplicationEvents(client: CvffApiClient, applicationId: string): Promise<ApprovalEvent[]> {
  return client.get<ApprovalEvent[]>(`/applications/${encodeURIComponent(applicationId)}/events`);
}

export function listDocuments(client: CvffApiClient, applicationId: string): Promise<UploadedDocument[]> {
  return client.get<UploadedDocument[]>(`/applications/${encodeURIComponent(applicationId)}/documents`);
}

export function createApplication(
  client: CvffApiClient,
  payload: CreateApplicationPayload,
  idempotencyKey: string,
): Promise<ApplicationDetail> {
  return client.post<ApplicationDetail>("/applications", payload, idempotencyKey);
}
