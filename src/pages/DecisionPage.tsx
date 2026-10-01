import { useCallback, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { ApiError } from "../api/client";
import { submitPartyDecision, type DecisionResponse, type PartyDecision } from "../api/officer";
import { ErrorNotice } from "../components/feedback";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "done"; response: DecisionResponse };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status > 0 ? `HTTP ${error.status}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : "The decision could not be delivered.";
}

/**
 * Party decision screen for POST /v1/cvff/applications/{id}/decisions. The
 * deciding party is the authenticated identity: the API binds the caller to
 * the role the current state awaits (403 when the caller is not the assigned
 * party, 409 when no decision is awaited). The request body is exactly
 * `{ decision }` per the backend contract; rationale, if any, is captured in
 * the immutable decision trail by the workflow, not in this payload.
 */
export function DecisionPage({
  session,
  applicationId,
  navigate,
}: {
  session: SessionContext;
  applicationId: string;
  navigate: (route: Route) => void;
}) {
  const [decision, setDecision] = useState<PartyDecision | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const submit = useCallback(async () => {
    if (decision === null) {
      setState({ kind: "error", message: "Choose APPROVE or REJECT before submitting." });
      return;
    }
    const client = await session.getClient();
    if (client === null) {
      return; // session expired; App renders the sign-in gate
    }
    setState({ kind: "submitting" });
    try {
      const response = await submitPartyDecision(client, applicationId, decision);
      setState({ kind: "done", response });
    } catch (error) {
      setState({ kind: "error", message: describeError(error) });
    }
  }, [session, applicationId, decision]);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Four-party decision</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">Record party decision</h2>
        <p className="mt-1 text-sm text-slate-600">
          Application <code className="text-xs">{applicationId}</code>. Your decision is delivered to the disbursement
          workflow only if you are the principal bound to the role the current lifecycle state awaits; the workflow
          activity re-enforces the same binding before advancing the chain.
        </p>
      </div>

      <section className="card">
        <fieldset>
          <legend className="field-label">Decision</legend>
          <div className="mt-2 flex gap-3">
            {(["APPROVE", "REJECT"] as const).map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 px-4 py-2 hover:bg-slate-50">
                <input
                  type="radio"
                  name="decision"
                  checked={decision === value}
                  onChange={() => setDecision(value)}
                />
                <span className="text-sm font-medium text-slate-800">{value}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="button mt-4"
          onClick={() => void submit()}
          disabled={state.kind === "submitting" || state.kind === "done" || decision === null}
        >
          {state.kind === "submitting" ? "Delivering…" : "Submit decision"}
        </button>
      </section>

      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void submit()} />}

      {state.kind === "done" && (
        <section className="card border-l-4 border-l-emerald-700" aria-live="polite">
          <p className="eyebrow">Decision delivered</p>
          <p className="mt-1 text-sm text-slate-700">
            Signal <code className="text-xs">{state.response.signal}</code> accepted for application{" "}
            <code className="text-xs">{state.response.application_id}</code> (state at delivery: {state.response.state}).
          </p>
        </section>
      )}

      <button className="button button--quiet" onClick={() => navigate({ name: "application-detail", applicationId })}>
        ← Back to application
      </button>
    </div>
  );
}
