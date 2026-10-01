import { useCallback, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { ApiError } from "../api/client";
import {
  resolveReconciliation,
  type ReconciliationResolution,
  type ReconciliationResponse,
} from "../api/officer";
import { ErrorNotice } from "../components/feedback";

const RESOLUTIONS: { value: ReconciliationResolution; label: string; description: string }[] = [
  {
    value: "RESUME_DISBURSEMENT",
    label: "Resume disbursement",
    description:
      "Returns the application to the interrupted stage so the rail retries after the contradictory or missing evidence has been remediated (e.g. the CBN rate was posted).",
  },
  {
    value: "REJECT",
    label: "Reject application",
    description:
      "Closes the application as REJECTED when the reconciliation evidence shows the disbursement must never proceed. This is terminal.",
  },
];

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "done"; response: ReconciliationResponse };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status > 0 ? `HTTP ${error.status}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : "The resolution could not be delivered.";
}

/**
 * Reconciliation-officer screen for
 * POST /v1/cvff/admin/applications/{id}/reconciliation. Only applications
 * parked in RECONCILIATION_REQUIRED accept a resolution (the API returns 409
 * otherwise, surfaced verbatim).
 */
export function ReconciliationPage({
  session,
  applicationId,
  navigate,
}: {
  session: SessionContext;
  applicationId: string;
  navigate: (route: Route) => void;
}) {
  const [resolution, setResolution] = useState<ReconciliationResolution | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const submit = useCallback(async () => {
    if (resolution === null) {
      setState({ kind: "error", message: "Choose a resolution before submitting." });
      return;
    }
    const client = await session.getClient();
    if (client === null) {
      return; // session expired; App renders the sign-in gate
    }
    setState({ kind: "submitting" });
    try {
      const response = await resolveReconciliation(client, applicationId, resolution);
      setState({ kind: "done", response });
    } catch (error) {
      setState({ kind: "error", message: describeError(error) });
    }
  }, [session, applicationId, resolution]);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Reconciliation officer</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">Resolve reconciliation hold</h2>
        <p className="mt-1 text-sm text-slate-600">
          Application <code className="text-xs">{applicationId}</code>. The fail-closed RECONCILIATION_REQUIRED branch
          is resolved only by the reconciliation officer; no chain principal may clear its own deadlock.
        </p>
      </div>

      <section className="card">
        <fieldset>
          <legend className="field-label">Resolution</legend>
          <div className="mt-2 space-y-3">
            {RESOLUTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded border border-slate-200 p-3 hover:bg-slate-50">
                <input
                  type="radio"
                  name="resolution"
                  className="mt-1"
                  checked={resolution === option.value}
                  onChange={() => setResolution(option.value)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{option.label}</span>
                  <span className="block text-xs text-slate-600">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="button mt-4"
          onClick={() => void submit()}
          disabled={state.kind === "submitting" || state.kind === "done" || resolution === null}
        >
          {state.kind === "submitting" ? "Delivering…" : "Deliver resolution"}
        </button>
      </section>

      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void submit()} />}

      {state.kind === "done" && (
        <section className="card border-l-4 border-l-emerald-700" aria-live="polite">
          <p className="eyebrow">Resolution delivered</p>
          <p className="mt-1 text-sm text-slate-700">
            The workflow accepted <strong>{state.response.resolution}</strong> for application{" "}
            <code className="text-xs">{state.response.application_id}</code> (state at delivery: {state.response.state}).
            The state write is performed by the workflow's resolution activity against the database.
          </p>
        </section>
      )}

      <button className="button button--quiet" onClick={() => navigate({ name: "dashboard" })}>
        ← Back to dashboard
      </button>
    </div>
  );
}
