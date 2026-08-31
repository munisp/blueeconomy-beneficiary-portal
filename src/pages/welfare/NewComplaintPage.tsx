import { useMemo, useState } from "react";
import type { SessionContext } from "../../App";
import type { Route } from "../../router";
import { ApiError } from "../../api/client";
import { submitComplaint, welfareErrorMessage, type ComplaintSubmitResult } from "../../api/welfare";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_CHANNELS,
  COMPLAINT_CHANNEL_LABELS,
  EMPTY_COMPLAINT_DRAFT,
  MAX_ATTACHMENTS,
  MAX_NARRATIVE_CHARS,
  RIGHT_TO_REDRESS_NOTICE,
  validateComplaintDraft,
  type ComplaintCategory,
  type ComplaintChannel,
  type ComplaintDraft,
  type ComplaintDraftField,
  type WelfareAttachmentDraft,
} from "../../domain/welfare";
import { IdempotencyKeyManager, defaultIdempotencyStore } from "../../idempotency";
import { WelfareUnavailable } from "./WelfareUnavailable";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; formError: string }
  | { kind: "submitted"; result: ComplaintSubmitResult };

/**
 * MLC 2006 complaint intake (Reg 5.1.5 on-board / Reg 5.2.2 flag-state).
 * Confidential by design: the narrative travels only in the POST body, never
 * in URLs or logs; attachments are digest-only SHA-256 references computed in
 * the browser — file content is never uploaded because the welfare API
 * accepts descriptors only.
 */
export function NewComplaintPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [draft, setDraft] = useState<ComplaintDraft>(EMPTY_COMPLAINT_DRAFT);
  const [touched, setTouched] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [digesting, setDigesting] = useState(false);

  // One complaint per mount; the idempotency key survives retries and reloads
  // of this page and is rotated only after a confirmed 2xx submission.
  const idempotency = useMemo(() => new IdempotencyKeyManager(crypto.randomUUID(), defaultIdempotencyStore()), []);

  const errors = validateComplaintDraft(draft);
  const hasErrors = Object.keys(errors).length > 0;

  function updateField<K extends ComplaintDraftField>(field: K, value: ComplaintDraft[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function visibleError(field: ComplaintDraftField): string | undefined {
    if (!touched) {
      return undefined;
    }
    return errors[field];
  }

  async function addAttachments(fileList: FileList | null): Promise<void> {
    setAttachmentError(null);
    if (fileList === null || fileList.length === 0) {
      return;
    }
    const room = MAX_ATTACHMENTS - draft.attachments.length;
    const files = Array.from(fileList).slice(0, room);
    if (fileList.length > room) {
      setAttachmentError(`At most ${MAX_ATTACHMENTS} attachment references are accepted; extra files were ignored.`);
    }
    setDigesting(true);
    try {
      const descriptors: WelfareAttachmentDraft[] = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        const sha256 = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        descriptors.push({ name: file.name, sha256 });
      }
      setDraft((current) => ({ ...current, attachments: [...current.attachments, ...descriptors].slice(0, MAX_ATTACHMENTS) }));
    } catch {
      setAttachmentError("The attachment digest could not be computed in this browser; the file was not added.");
    } finally {
      setDigesting(false);
    }
  }

  function removeAttachment(index: number): void {
    setDraft((current) => ({ ...current, attachments: current.attachments.filter((_, position) => position !== index) }));
  }

  async function submit(): Promise<void> {
    if (submitState.kind === "submitting") {
      return;
    }
    setTouched(true);
    if (hasErrors) {
      return;
    }
    setSubmitState({ kind: "submitting" });
    const client = await session.getWelfareClient();
    if (client === null) {
      setSubmitState({ kind: "idle" });
      return; // session expired; App renders the sign-in gate
    }
    try {
      // Same key on every retry of this draft: the server deduplicates on it.
      const result = await submitComplaint(
        client,
        {
          // hasErrors === false guarantees both are closed-enum members.
          channel: draft.channel as ComplaintChannel,
          category: draft.category as ComplaintCategory,
          vesselRef: draft.vesselRef,
          ...(draft.operatorRef.length > 0 ? { operatorRef: draft.operatorRef } : {}),
          narrative: draft.narrative,
          attachments: draft.attachments,
          rightToRedressNoticeAck: true,
        },
        idempotency.key(),
      );
      idempotency.rotate();
      setSubmitState({ kind: "submitted", result });
    } catch (error) {
      // 4xx (validation, missing CoC credential, closed intake) and ambiguous
      // network/5xx outcomes are both shown honestly; the retained idempotency
      // key makes a retry safe.
      setSubmitState({
        kind: "failed",
        formError:
          error instanceof ApiError && error.status === 503
            ? "Complaint intake is temporarily closed by the welfare service (its signed welfare policy or narrative encryption is not configured). Your complaint was NOT recorded — retry later."
            : welfareErrorMessage(error),
      });
    }
  }

  if (session.welfare.kind === "unavailable") {
    return <WelfareUnavailable reason={session.welfare.reason} />;
  }

  if (submitState.kind === "submitted") {
    return (
      <div className="space-y-4">
        <section className="card border-l-4 border-l-emerald-800" aria-live="polite">
          <p className="eyebrow">Complaint recorded</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">Your complaint was submitted to the welfare service</h2>
          <p className="mt-2 text-sm text-slate-700">
            Complaint reference: <span className="font-mono font-semibold">{submitState.result.complaintId}</span>
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Keep this reference to track the complaint. Status transitions are maker-checker governed; your identity
            stays withheld from the respondent unless a legally required disclosure is approved.
          </p>
          <div className="mt-4 flex gap-2">
            <button className="button" onClick={() => navigate({ name: "welfare-complaints" })}>
              Track my complaints
            </button>
            <button
              className="button button--outline"
              onClick={() => {
                setDraft(EMPTY_COMPLAINT_DRAFT);
                setTouched(false);
                setSubmitState({ kind: "idle" });
              }}
            >
              Lodge another complaint
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Seafarer welfare · MLC 2006</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">Lodge a complaint</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          This flow is confidential. Your identity is bound to your verified seafarer credential, withheld from the
          respondent, and the description is encrypted at rest by the welfare service. Attachments are sent as SHA-256
          digests only — no file content leaves your browser.
        </p>
      </div>

      <section className="card space-y-4">
        <Field label="Complaint channel" error={visibleError("channel")}>
          <select className="field-select" value={draft.channel} onChange={(event) => updateField("channel", event.target.value as ComplaintDraft["channel"])}>
            <option value="">Select…</option>
            {COMPLAINT_CHANNELS.map((value) => (
              <option key={value} value={value}>
                {COMPLAINT_CHANNEL_LABELS[value]}
              </option>
            ))}
          </select>
          {draft.channel === "onboard_r515" && (
            <p className="mt-1 text-xs text-slate-500">On-board complaints may be escalated to the flag-state channel when unresolved on board.</p>
          )}
        </Field>

        <Field label="MLC category" error={visibleError("category")}>
          <select className="field-select" value={draft.category} onChange={(event) => updateField("category", event.target.value as ComplaintDraft["category"])}>
            <option value="">Select…</option>
            {COMPLAINT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {COMPLAINT_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Vessel reference" error={visibleError("vesselRef")}>
          <input
            className="field-input"
            value={draft.vesselRef}
            onChange={(event) => updateField("vesselRef", event.target.value)}
            maxLength={128}
            placeholder="e.g. IMO number or registry reference of the vessel"
          />
        </Field>

        <Field label="Operator reference (optional)" error={visibleError("operatorRef")}>
          <input
            className="field-input"
            value={draft.operatorRef}
            onChange={(event) => updateField("operatorRef", event.target.value)}
            maxLength={128}
            placeholder="Leave empty if unknown"
          />
        </Field>

        <Field label="Complaint description" error={visibleError("narrative")}>
          <textarea
            className="field-textarea"
            rows={6}
            value={draft.narrative}
            onChange={(event) => updateField("narrative", event.target.value)}
            maxLength={MAX_NARRATIVE_CHARS}
          />
          <p className="mt-1 text-xs text-slate-500">
            {draft.narrative.length}/{MAX_NARRATIVE_CHARS} characters
          </p>
        </Field>

        <Field label="Attachment references (digest only)" error={visibleError("attachments") ?? attachmentError ?? undefined}>
          <input
            className="field-input"
            type="file"
            multiple
            onChange={(event) => {
              void addAttachments(event.target.files);
              event.target.value = "";
            }}
            disabled={digesting || draft.attachments.length >= MAX_ATTACHMENTS}
          />
          <p className="mt-1 text-xs text-slate-500">
            {digesting
              ? "Computing SHA-256 digests locally…"
              : "Files are hashed in your browser; only the file name and SHA-256 digest are submitted. Keep the original files as evidence."}
          </p>
          {draft.attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {draft.attachments.map((attachment, index) => (
                <li key={`${attachment.sha256}-${index}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                  <span className="truncate font-mono text-slate-700">
                    {attachment.name} · sha256:{attachment.sha256.slice(0, 16)}…
                  </span>
                  <button type="button" className="button button--quiet" onClick={() => removeAttachment(index)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <div className="rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-slate-800">Right to external redress (MLC 2006, Reg 5.1.5(3))</p>
          <p className="mt-1 text-sm text-slate-700">{RIGHT_TO_REDRESS_NOTICE}</p>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.rightToRedressNoticeAck}
              onChange={(event) => updateField("rightToRedressNoticeAck", event.target.checked)}
            />
            I have read and acknowledge the right-to-external-redress notice.
          </label>
          {visibleError("rightToRedressNoticeAck") !== undefined && <p className="field-error">{visibleError("rightToRedressNoticeAck")}</p>}
        </div>

        {submitState.kind === "failed" && (
          <div className="rounded border-l-4 border-l-red-800 bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-900">{submitState.formError}</p>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <button className="button button--quiet" onClick={() => navigate({ name: "welfare-complaints" })}>
          Cancel
        </button>
        <button
          className="button"
          disabled={submitState.kind === "submitting" || digesting || (touched && hasErrors)}
          onClick={() => void submit()}
        >
          {submitState.kind === "submitting" ? "Submitting…" : "Submit complaint"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      {children}
      {error !== undefined && <p className="field-error">{error}</p>}
    </div>
  );
}
