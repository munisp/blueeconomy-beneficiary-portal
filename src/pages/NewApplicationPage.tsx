import { useEffect, useMemo, useState } from "react";
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
import { IdempotencyKeyManager, defaultIdempotencyStore, newApplicationDraftId, resetNewApplicationDraftId } from "../idempotency";
import { DraftOutbox, defaultOutboxStore } from "../pwa/draftOutbox";
import { isOnline, useOnlineStatus } from "../pwa/online";
import { useTranslator } from "../i18n/react";

const DRAFT_SYNC_TAG = "cvff-draft-sync";

const STEPS = ["Vessel details", "Funding and business", "Review and submit"] as const;
const STEP_KEYS = ["wizard.steps.vessel", "wizard.steps.funding", "wizard.steps.review"] as const;

const STEP_FIELDS: DraftField[][] = [
  ["vesselName", "imoNumber", "officialNumber", "vesselClass", "cabotageRoute"],
  ["amountNairaText", "businessName", "businessRcNumber", "businessAddress"],
  [],
];

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "submitted"; applicationId: string }
  | { kind: "queued"; queuedAt: string }
  | { kind: "failed"; formError: string; fieldErrors: DraftErrors };

export function NewApplicationPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [draft, setDraft] = useState<ApplicationDraft>(EMPTY_DRAFT);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const online = useOnlineStatus();
  const { t } = useTranslator();

  // One draft per browser session: the draft id (and therefore the
  // idempotency key) is persisted in sessionStorage, so refreshing the page
  // mid-submit reuses the same key and cannot create a duplicate. The key is
  // rotated only after a confirmed 2xx submission.
  const idempotencyStore = useMemo(() => defaultIdempotencyStore(), []);
  const draftId = useMemo(() => newApplicationDraftId(idempotencyStore), [idempotencyStore]);
  const idempotency = useMemo(() => new IdempotencyKeyManager(draftId, idempotencyStore), [draftId, idempotencyStore]);
  // Offline outbox survives a full browser restart (localStorage).
  const outbox = useMemo(() => new DraftOutbox(defaultOutboxStore()), []);

  // Background-sync flush: on mount, on regained connectivity, and on the
  // service worker's "cvff-draft-sync" relay (Background Sync API where the
  // browser supports it), attempt to deliver the queued submission with the
  // SAME idempotency key — the server deduplicates, so a queued request that
  // had secretly succeeded can never create a second application.
  useEffect(() => {
    let active = true;
    async function flushOutbox(): Promise<void> {
      if (outbox.pending() === null) {
        return;
      }
      const client = await session.getClient();
      if (client === null || !active) {
        return;
      }
      let createdId: string | null = null;
      let rejectionStatus: number | null = null;
      const outcome = await outbox.flush({
        async post(payload, idempotencyKey) {
          try {
            const created = await createApplication(client, payload as Parameters<typeof createApplication>[1], idempotencyKey);
            createdId = created.application_id;
          } catch (error) {
            if (error instanceof ApiError) {
              rejectionStatus = error.status;
            }
            throw error;
          }
        },
      });
      if (!active) {
        return;
      }
      if (outcome === "synced" && createdId !== null) {
        idempotency.rotate();
        resetNewApplicationDraftId(idempotencyStore);
        setSubmitState({ kind: "submitted", applicationId: createdId });
      } else if (outcome === "rejected") {
        // Definitive 4xx — the server saw and refused the queued submission.
        // Surface "rejected, needs action" honestly instead of re-POSTing
        // forever. An auth rejection (401/403) is a session/permission
        // problem, not a validation problem: say so.
        setSubmitState({
          kind: "failed",
          formError:
            rejectionStatus === 401 || rejectionStatus === 403
              ? "The queued application was refused because your sign-in session had expired or lacks permission (HTTP " + rejectionStatus + "). It has been removed from the outbox. Sign in again and resubmit the draft."
              : "The queued application was definitively rejected by the CVFF service once connectivity returned. It has been removed from the outbox; correct the draft and resubmit.",
          fieldErrors: {},
        });
      }
    }
    void flushOutbox();
    const onOnline = () => void flushOutbox();
    const onSwMessage = (event: MessageEvent) => {
      if (event.data && (event.data as { type?: string }).type === DRAFT_SYNC_TAG) {
        void flushOutbox();
      }
    };
    window.addEventListener("online", onOnline);
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    };
  }, [outbox, session, idempotency, idempotencyStore]);

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
    if (submitState.kind === "submitting" || submitState.kind === "queued") {
      return;
    }
    setTouched(true);
    if (Object.keys(errors).length > 0) {
      setStep(0);
      return;
    }
    const payload = draftToPayload(draft);
    // Offline: queue honestly instead of pretending the request was sent.
    if (!isOnline()) {
      const queuedAt = new Date().toISOString();
      if (outbox.enqueue({ draftId, idempotencyKey: idempotency.key(), payload, queuedAt })) {
        setSubmitState({ kind: "queued", queuedAt });
        void requestBackgroundSync();
      } else {
        setSubmitState({
          kind: "failed",
          formError: "You are offline and this browser could not persist the draft queue. Do not close this page; resubmit when connectivity returns.",
          fieldErrors: {},
        });
      }
      return;
    }
    setSubmitState({ kind: "submitting" });
    const client = await session.getClient();
    if (client === null) {
      // Phase 19 M1: the session expired mid-wizard (silent renew failed).
      // Never silently reset to "idle" — preserve the draft in the outbox
      // and tell the user exactly what happened. After re-sign-in the
      // outbox flush delivers it with the same idempotency key.
      const queuedAt = new Date().toISOString();
      if (outbox.enqueue({ draftId, idempotencyKey: idempotency.key(), payload, queuedAt })) {
        setSubmitState({ kind: "queued", queuedAt });
        setSyncNotice("Your sign-in session expired before the application could be submitted. The complete draft is preserved in this browser's offline outbox and will be submitted automatically after you sign in again.");
        void requestBackgroundSync();
      } else {
        setSubmitState({
          kind: "failed",
          formError: "Your sign-in session expired and this browser could not persist the draft queue. Do not close this page; sign in again and resubmit.",
          fieldErrors: {},
        });
      }
      return;
    }
    try {
      // Same key on every retry of this draft: the server deduplicates on it.
      const created = await createApplication(client, payload, idempotency.key());
      idempotency.rotate();
      resetNewApplicationDraftId(idempotencyStore);
      setSubmitState({ kind: "submitted", applicationId: created.application_id });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Token died mid-request: NOT a validation rejection. Preserve the
        // draft in the outbox; after re-sign-in it flushes with the same key.
        const queuedAt = new Date().toISOString();
        if (outbox.enqueue({ draftId, idempotencyKey: idempotency.key(), payload, queuedAt })) {
          setSubmitState({ kind: "queued", queuedAt });
          setSyncNotice("Your sign-in session expired during submission (HTTP 401). The draft is preserved in the offline outbox and will be submitted automatically after you sign in again.");
          void requestBackgroundSync();
        } else {
          setSubmitState({
            kind: "failed",
            formError: "Your sign-in session expired during submission and this browser could not persist the draft queue. Do not close this page; sign in again and resubmit.",
            fieldErrors: {},
          });
        }
        return;
      }
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
        // Network/5xx outcome is ambiguous: queue the draft with the same
        // idempotency key and sync it when connectivity returns.
        const queuedAt = new Date().toISOString();
        if (outbox.enqueue({ draftId, idempotencyKey: idempotency.key(), payload, queuedAt })) {
          setSubmitState({ kind: "queued", queuedAt });
          setSyncNotice(error instanceof Error ? `Submission did not complete (${error.message}).` : "Submission did not complete.");
          void requestBackgroundSync();
        } else {
          setSubmitState({
            kind: "failed",
            formError: error instanceof Error ? error.message : "Submission failed.",
            fieldErrors: {},
          });
        }
      }
    }
  }

  const amountKobo = parseAmountKobo(draft.amountNairaText);

  if (submitState.kind === "submitted") {
    return (
      <section className="card border-l-4 border-l-green-700" role="status">
        <p className="eyebrow">Application submitted</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">Your CVFF application was received</h2>
        <p className="mt-2 text-sm text-slate-700">
          Reference: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{submitState.applicationId}</code>
        </p>
        <p className="mt-2 max-w-xl text-sm text-slate-600">
          The CVFF service has recorded this application exactly once (retries reuse the same idempotency key). What
          happens next: you will be asked to upload the supporting documents — vessel registration certificate,
          cabotage license and receiving bank account details — after which NIMASA reviews the application and the
          status appears on your dashboard.
        </p>
        <button
          className="button mt-4"
          onClick={() => navigate({ name: "application-detail", applicationId: submitState.applicationId })}
        >
          Open application and add documents
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {!online && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
          {t("offline.banner")}
        </p>
      )}
      {submitState.kind === "queued" && (
        <section className="card border-l-4 border-l-amber-600" role="status">
          <p className="eyebrow">{t("wizard.title")}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">Queued for automatic submission</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-700">{t("offline.draftQueued")}</p>
          <p className="mt-1 text-xs text-slate-500">Queued at {new Date(submitState.queuedAt).toLocaleString()}.</p>
          {syncNotice !== null && <p className="mt-1 text-xs text-slate-500">{syncNotice}</p>}
        </section>
      )}
      <div>
        <p className="eyebrow">{t("wizard.title")}</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">{t(STEP_KEYS[step])}</h2>
        <ol className="mt-3 flex gap-2" aria-label="Wizard progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-brand-600" : "bg-slate-200"}`}
              aria-label={`Step ${index + 1}: ${t(STEP_KEYS[index])}${index === step ? " (current)" : ""}`}
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
          {step === 0 ? "Cancel" : t("wizard.back")}
        </button>
        {step < STEPS.length - 1 ? (
          <button className="button" onClick={nextStep}>
            {t("wizard.next")}
          </button>
        ) : (
          <button
            className="button"
            disabled={submitState.kind === "submitting" || submitState.kind === "queued"}
            onClick={() => void submit()}
          >
            {submitState.kind === "submitting" ? "Submitting…" : submitState.kind === "queued" ? t("offline.draftSyncing") : t("wizard.submit")}
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

/**
 * Asks the service worker for a Background Sync slot so the outbox flush is
 * triggered even if the tab is closed before connectivity returns. Where the
 * browser lacks the Background Sync API, the page-side "online" listener is
 * the (honest) fallback and this resolves to false.
 */
async function requestBackgroundSync(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const syncManager = registration as unknown as { sync?: { register(tag: string): Promise<void> } } | undefined;
    if (syncManager?.sync === undefined) {
      return false;
    }
    await syncManager.sync.register(DRAFT_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}
