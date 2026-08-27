import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import {
  getApplication,
  getApplicationEvents,
  type ApplicationDetail,
  type ApprovalEvent,
} from "../api/applications";
import {
  APPROVAL_CHAIN,
  CHAIN_STEP_LABELS,
  isTerminalState,
  slaReading,
} from "../domain/cvff";
import { formatKoboAsNgn } from "../domain/money";
import { startPolling, type PollerHandle } from "../polling";
import { ErrorNotice, LoadingState, SlaCountdown, StatusBadge } from "../components/feedback";

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; application: ApplicationDetail; events: ApprovalEvent[] };

export function ApplicationDetailPage({
  session,
  applicationId,
  navigate,
}: {
  session: SessionContext;
  applicationId: string;
  navigate: (route: Route) => void;
}) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [pollNotice, setPollNotice] = useState<string | null>(null);
  const pollerRef = useRef<PollerHandle | null>(null);

  const refresh = useCallback(async (): Promise<{ terminal: boolean }> => {
    const client = await session.getClient();
    if (client === null) {
      return { terminal: true };
    }
    const [application, events] = await Promise.all([
      getApplication(client, applicationId),
      getApplicationEvents(client, applicationId),
    ]);
    setState({ kind: "ready", application, events });
    setPollNotice(null);
    return { terminal: isTerminalState(application.state) };
  }, [session, applicationId]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const poller = startPolling(
      async () => (cancelled ? { terminal: true } : refresh()),
      (message) => setPollNotice(`Status refresh failed: ${message}. Polling continues with backoff.`),
      { baseMs: session.configuration.cvff_api.poll_interval_ms },
    );
    pollerRef.current = poller;
    return () => {
      cancelled = true;
      poller.cancel();
    };
  }, [refresh, session.configuration.cvff_api.poll_interval_ms]);

  return (
    <div className="space-y-4">
      <button className="button button--quiet" onClick={() => navigate({ name: "dashboard" })}>
        ← Back to dashboard
      </button>

      {state.kind === "loading" && <LoadingState message="Loading the application and its approval history…" />}
      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void refresh()} />}

      {state.kind === "ready" && (
        <>
          <section className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Application {state.application.application_id}</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">{state.application.vessel_name}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  IMO {state.application.imo_number} · official number {state.application.official_number}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusBadge state={state.application.state} />
                {(() => {
                  const reading = slaReading(state.application.state, new Date(state.application.state_entered_at), new Date());
                  return reading !== null ? <SlaCountdown reading={reading} /> : null;
                })()}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-200 pt-4 text-sm sm:grid-cols-2">
              <Description term="Requested amount" value={formatKoboAsNgn(state.application.amount)} />
              <Description term="Business" value={`${state.application.business_name} (${state.application.business_rc_number})`} />
              <Description term="Submitted" value={new Date(state.application.created_at).toLocaleString("en-NG")} />
              <Description term="Last updated" value={new Date(state.application.updated_at).toLocaleString("en-NG")} />
            </dl>
            {!isTerminalState(state.application.state) && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <button
                  className="button button--outline"
                  onClick={() => navigate({ name: "application-documents", applicationId })}
                >
                  Manage supporting documents
                </button>
              </div>
            )}
          </section>

          {pollNotice !== null && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="status">
              {pollNotice}
            </p>
          )}

          <section className="card">
            <p className="eyebrow">Four-party approval chain</p>
            <h3 className="mt-1 text-base font-semibold text-slate-800">Status timeline</h3>
            <ApprovalTimeline application={state.application} events={state.events} />
          </section>

          <section className="card">
            <p className="eyebrow">Event history</p>
            <h3 className="mt-1 text-base font-semibold text-slate-800">Recorded decisions</h3>
            {state.events.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No decisions have been recorded yet. The first entry appears when the primary underwriter acts.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {state.events.map((event) => (
                  <li key={event.approval_id} className="rounded border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">
                        {roleLabel(event.role)} — {event.decision === "APPROVE" ? "Approved" : "Rejected"}
                      </span>
                      <span className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString("en-NG")}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {stateLabel(event.from_state)} → {stateLabel(event.to_state)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Description({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{term}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function ApprovalTimeline({ application, events }: { application: ApplicationDetail; events: ApprovalEvent[] }) {
  const reached = new Map<string, string>();
  for (const event of events) {
    reached.set(event.from_state, event.created_at);
    reached.set(event.to_state, event.created_at);
  }
  const currentIndex = APPROVAL_CHAIN.indexOf(application.state);
  const rejected = application.state === "REJECTED";
  const reconciliation = application.state === "RECONCILIATION_REQUIRED";

  return (
    <ol className="mt-4">
      {APPROVAL_CHAIN.map((stepState, index) => {
        const completed = index < currentIndex || reached.has(stepState) || application.state === "AUDITED";
        const isCurrent = index === currentIndex;
        const markerClass = rejected && isCurrent
          ? "timeline-marker--rejected"
          : completed
            ? "timeline-marker--done"
            : isCurrent
              ? "timeline-marker--current"
              : "";
        return (
          <li key={stepState} className="timeline-step">
            <span className={`timeline-marker ${markerClass}`} aria-hidden="true">
              {completed ? "✓" : isCurrent ? "•" : ""}
            </span>
            <div>
              <p className={`text-sm ${isCurrent ? "font-semibold text-slate-900" : completed ? "text-slate-700" : "text-slate-400"}`}>
                {CHAIN_STEP_LABELS[stepState]}
                {isCurrent && (rejected || reconciliation) && (
                  <span className={`ml-2 badge ${rejected ? "badge--danger" : "badge--warning"}`}>
                    {rejected ? "Rejected" : "Reconciliation required"}
                  </span>
                )}
              </p>
              {reached.has(stepState) && (
                <p className="text-xs text-slate-500">{new Date(reached.get(stepState) as string).toLocaleString("en-NG")}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "UNDERWRITER_PRIMARY":
      return "PLI primary underwriter";
    case "UNDERWRITER_SECONDARY":
      return "PLI secondary underwriter";
    case "UNDERWRITER_TERTIARY":
      return "PLI tertiary underwriter";
    case "NIMASA_APPROVER":
      return "NIMASA approver";
    case "RECEIVING_BANK":
      return "Receiving bank";
    case "BENEFICIARY":
      return "Beneficiary";
    default:
      return role;
  }
}

function stateLabel(state: string): string {
  return CHAIN_STEP_LABELS[state] ?? state;
}
