import { useMemo, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { createApplication } from "../api/applications";
import { ApiError } from "../api/client";
import {
  CABOTAGE_ROUTE_LABELS,
  CABOTAGE_ROUTES,
  EMPTY_DRAFT,
  VESSEL_CLASS_LABELS,
  VESSEL_CLASSES,
  draftToPayload,
  mapServerErrors,
  parseAmountKobo,
  validateDraft,
  type ApplicationDraft,
  type DraftErrors,
  type DraftField,
} from "../domain/wizard";
import { formatKoboAsNgn } from "../domain/money";
import { IdempotencyKeyManager, defaultIdempotencyStore } from "../idempotency";

const STEPS = ["Vessel details", "Funding and business", "Review and submit"] as const;

const STEP_FIELDS: DraftField[][] = [
  ["vesselName", "imoNumber", "officialNumber", "vesselClass", "cabotageRoute"],
  ["amountNairaText", "businessName", "businessRcNumber", "businessAddress"],
  [],
];

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; formError: string; fieldErrors: DraftErrors };

export function NewApplicationPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [draft, setDraft] = useState<ApplicationDraft>(EMPTY_DRAFT);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // One draft per mount; the idempotency key survives retries and reloads
  // of this page and is rotated only after a confirmed 2xx submission.
  const idempotency = useMemo(
    () => new IdempotencyKeyManager(crypto.randomUUID(), defaultIdempotencyStore()),
    [],
  );

  const errors = validateDraft(draft);
  const stepFields = STEP_FIELDS[step];
  const stepHasErrors = stepFields.some((field) => errors[field] !== undefined);

  function updateField(field: DraftField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function visibleError(field: DraftField): string | undefined {
    if (!touched) {
      return undefined;
    }
    return errors[field] ?? (submitState.kind === "failed" ? submitState.fieldErrors[field] : undefined);
  }

  function nextStep(): void {
    setTouched(true);
    if (!stepHasErrors) {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
      setTouched(false);
    }
  }

  async function submit(): Promise<void> {
    if (submitState.kind === "submitting") {
      return;
    }
    setTouched(true);
    if (Object.keys(errors).length > 0) {
      setStep(0);
      return;
    }
    setSubmitState({ kind: "submitting" });
    const client = await session.getClient();
    if (client === null) {
      setSubmitState({ kind: "idle" });
      return;
    }
    try {
      // Same key on every retry of this draft: the server deduplicates on it.
      const created = await createApplication(client, draftToPayload(draft), idempotency.key());
      idempotency.rotate();
      navigate({ name: "application-detail", applicationId: created.application_id });
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        const mapped = mapServerErrors(error.problem);
        setSubmitState({
          kind: "failed",
          formError: mapped.formError ?? "The application was rejected. Correct the highlighted fields and resubmit.",
          fieldErrors: mapped.fieldErrors,
        });
        if (Object.keys(mapped.fieldErrors).length > 0) {
          const firstBadStep = STEP_FIELDS.findIndex((fields) =>
            fields.some((field) => mapped.fieldErrors[field] !== undefined),
          );
          if (firstBadStep >= 0) {
            setStep(firstBadStep);
          }
        }
      } else {
        // Network/5xx outcome is ambiguous: the same idempotency key makes
        // a retry safe, so keep the draft and show an honest failure.
        setSubmitState({
          kind: "failed",
          formError: error instanceof Error ? error.message : "Submission failed.",
          fieldErrors: {},
        });
      }
    }
  }

  const amountKobo = parseAmountKobo(draft.amountNairaText);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">New CVFF application</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">{STEPS[step]}</h2>
        <ol className="mt-3 flex gap-2" aria-label="Wizard progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-brand-600" : "bg-slate-200"}`}
              aria-label={`Step ${index + 1}: ${label}${index === step ? " (current)" : ""}`}
            />
          ))}
        </ol>
      </div>

      <section className="card space-y-4">
        {step === 0 && (
          <>
            <Field label="Vessel name" error={visibleError("vesselName")}>
              <input className="field-input" value={draft.vesselName} onChange={(event) => updateField("vesselName", event.target.value)} maxLength={128} />
            </Field>
            <Field label="IMO number (7 digits)" error={visibleError("imoNumber")}>
              <input className="field-input" value={draft.imoNumber} onChange={(event) => updateField("imoNumber", event.target.value)} inputMode="numeric" maxLength={7} placeholder="e.g. 9074729" />
            </Field>
            <Field label="Official registry number" error={visibleError("officialNumber")}>
              <input className="field-input" value={draft.officialNumber} onChange={(event) => updateField("officialNumber", event.target.value)} maxLength={32} />
            </Field>
            <Field label="Vessel class" error={visibleError("vesselClass")}>
              <select className="field-select" value={draft.vesselClass} onChange={(event) => updateField("vesselClass", event.target.value)}>
                <option value="">Select…</option>
                {VESSEL_CLASSES.map((value) => (
                  <option key={value} value={value}>{VESSEL_CLASS_LABELS[value]}</option>
                ))}
              </select>
            </Field>
            <Field label="Primary cabotage trade route" error={visibleError("cabotageRoute")}>
              <select className="field-select" value={draft.cabotageRoute} onChange={(event) => updateField("cabotageRoute", event.target.value)}>
                <option value="">Select…</option>
                {CABOTAGE_ROUTES.map((value) => (
                  <option key={value} value={value}>{CABOTAGE_ROUTE_LABELS[value]}</option>
                ))}
              </select>
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Requested amount (NGN)" error={visibleError("amountNairaText")}>
              <input className="field-input" value={draft.amountNairaText} onChange={(event) => updateField("amountNairaText", event.target.value)} inputMode="decimal" placeholder="e.g. 25000000" />
              {amountKobo !== null && errors.amountNairaText === undefined && (
                <p className="mt-1 text-xs text-slate-500">{formatKoboAsNgn(amountKobo)}</p>
              )}
            </Field>
            <Field label="Registered business name" error={visibleError("businessName")}>
              <input className="field-input" value={draft.businessName} onChange={(event) => updateField("businessName", event.target.value)} maxLength={256} />
            </Field>
            <Field label="CAC registration number (RC)" error={visibleError("businessRcNumber")}>
              <input className="field-input" value={draft.businessRcNumber} onChange={(event) => updateField("businessRcNumber", event.target.value)} maxLength={12} placeholder="RC123456" />
            </Field>
            <Field label="Business address" error={visibleError("businessAddress")}>
              <textarea className="field-textarea" rows={3} value={draft.businessAddress} onChange={(event) => updateField("businessAddress", event.target.value)} maxLength={512} />
            </Field>
          </>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <ReviewRow label="Vessel" value={`${draft.vesselName.trim()} (IMO ${draft.imoNumber.trim()})`} />
            <ReviewRow label="Official number" value={draft.officialNumber.trim()} />
            <ReviewRow label="Vessel class" value={draft.vesselClass === "" ? "—" : VESSEL_CLASS_LABELS[draft.vesselClass]} />
            <ReviewRow label="Cabotage route" value={draft.cabotageRoute === "" ? "—" : CABOTAGE_ROUTE_LABELS[draft.cabotageRoute]} />
            <ReviewRow label="Requested amount" value={amountKobo === null ? "—" : formatKoboAsNgn(amountKobo)} />
            <ReviewRow label="Business" value={`${draft.businessName.trim()} (${draft.businessRcNumber.trim().toUpperCase()})`} />
            <ReviewRow label="Business address" value={draft.businessAddress.trim()} />
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Submitting sends this application to the CVFF service once per confirmed response. If the network drops
              mid-submission, retrying reuses the same idempotency key, so a duplicate application cannot be created.
              After submission you will be asked for supporting documents.
            </p>
          </div>
        )}

        {submitState.kind === "failed" && (
          <div className="rounded border-l-4 border-l-red-800 bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-900">{submitState.formError}</p>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <button className="button button--quiet" onClick={() => (step === 0 ? navigate({ name: "dashboard" }) : setStep((current) => current - 1))}>
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {step < STEPS.length - 1 ? (
          <button className="button" onClick={nextStep}>
            Continue
          </button>
        ) : (
          <button className="button" disabled={submitState.kind === "submitting"} onClick={() => void submit()}>
            {submitState.kind === "submitting" ? "Submitting…" : "Submit application"}
          </button>
        )}
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

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
