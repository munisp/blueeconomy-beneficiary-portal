import { useCallback, useEffect, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { listApplications, type ApplicationSummary } from "../api/applications";
import { isTerminalState, slaReading } from "../domain/cvff";
import { formatKoboAsNgn } from "../domain/money";
import { EmptyState, ErrorNotice, LoadingState, SlaCountdown, StatusBadge } from "../components/feedback";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; applications: ApplicationSummary[] };

export function DashboardPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [now, setNow] = useState<Date>(() => new Date());

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const client = await session.getClient();
    if (client === null) {
      return; // session expired; App renders the sign-in gate
    }
    try {
      const applications = await listApplications(client);
      setState({ kind: "ready", applications });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "applications could not be loaded" });
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tick once a minute so SLA countdowns stay honest during a long session.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">My CVFF applications</h2>
        </div>
        <button className="button" onClick={() => navigate({ name: "new-application" })}>
          New application
        </button>
      </div>

      {state.kind === "loading" && <LoadingState message="Retrieving your applications from the CVFF service…" />}
      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void load()} />}

      {state.kind === "ready" && state.applications.length === 0 && (
        <EmptyState title="No applications on record">
          <p className="mt-1 text-sm text-slate-600">
            The CVFF service returned no applications for your account. Use “New application” to submit a genuine
            request for Cabotage Vessel Financing Fund support.
          </p>
        </EmptyState>
      )}

      {state.kind === "ready" && state.applications.length > 0 && (
        <ul className="space-y-3">
          {state.applications.map((application) => {
            const reading = slaReading(application.state, new Date(application.state_entered_at), now);
            return (
              <li key={application.application_id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <button
                      className="text-left text-base font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-500"
                      onClick={() => navigate({ name: "application-detail", applicationId: application.application_id })}
                    >
                      {application.vessel_name}
                    </button>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Reference {application.application_id} · submitted {new Date(application.created_at).toLocaleString("en-NG")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge state={application.state} />
                    {reading !== null && <SlaCountdown reading={reading} />}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                  <p className="text-sm text-slate-700">
                    Requested amount: <span className="font-semibold">{formatKoboAsNgn(application.amount)}</span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="button button--outline"
                      onClick={() => navigate({ name: "application-detail", applicationId: application.application_id })}
                    >
                      Track status
                    </button>
                    {!isTerminalState(application.state) && (
                      <button
                        className="button button--outline"
                        onClick={() => navigate({ name: "application-documents", applicationId: application.application_id })}
                      >
                        Documents
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
