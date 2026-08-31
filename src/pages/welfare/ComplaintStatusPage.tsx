import { useCallback, useEffect, useState } from "react";
import type { SessionContext } from "../../App";
import type { Route } from "../../router";
import { fetchMyComplaints, welfareErrorMessage, type ComplaintView } from "../../api/welfare";
import {
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_CHANNEL_LABELS,
  COMPLAINT_STATUS_LABELS,
  complaintStatusTone,
  describeTimelineTransition,
} from "../../domain/welfare";
import { EmptyState, ErrorNotice, LoadingState } from "../../components/feedback";
import { startPolling } from "../../polling";
import { WelfareUnavailable } from "./WelfareUnavailable";

const POLL_BASE_MS = 15_000;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; complaints: ComplaintView[]; refreshedAt: Date };

/**
 * Complaint status tracking for the authenticated seafarer. Timelines render
 * exactly the governed transition history the welfare module records — no
 * state is invented or smoothed over — and legally required identity
 * disclosures (disclosure_event=true) are flagged explicitly.
 */
export function ComplaintStatusPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async (): Promise<{ terminal: boolean }> => {
    const client = await session.getWelfareClient();
    if (client === null) {
      return { terminal: true }; // session expired; App renders the sign-in gate
    }
    try {
      const response = await fetchMyComplaints(client);
      setState({ kind: "ready", complaints: response.complaints, refreshedAt: new Date() });
      // CLOSED is the only terminal state in the governed lifecycle.
      return { terminal: response.complaints.every((complaint) => complaint.status === "CLOSED") };
    } catch (error) {
      setState({ kind: "error", message: welfareErrorMessage(error) });
      return { terminal: true };
    }
  }, [session]);

  // Bounded backoff polling keeps the timeline fresh and stops once every
  // complaint is closed (or the view is left).
  useEffect(() => {
    const handle = startPolling(() => load(), () => undefined, { baseMs: POLL_BASE_MS });
    return () => handle.cancel();
  }, [load]);

  if (session.welfare.kind === "unavailable") {
    return <WelfareUnavailable reason={session.welfare.reason} />;
  }

  function toggle(complaintId: string): void {
    setExpanded((current) => ({ ...current, [complaintId]: !(current[complaintId] ?? false) }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Seafarer welfare · MLC 2006</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-800">My complaints</h2>
        </div>
        <div className="flex gap-2">
          <button className="button button--outline" onClick={() => void load()}>
            Refresh
          </button>
          <button className="button" onClick={() => navigate({ name: "welfare-complaint-new" })}>
            Lodge a complaint
          </button>
        </div>
      </div>

      {state.kind === "loading" && <LoadingState message="Retrieving your complaints from the welfare service…" />}
      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void load()} />}

      {state.kind === "ready" && state.complaints.length === 0 && (
        <EmptyState title="No complaints on record">
          <p className="mt-1 text-sm text-slate-600">
            The welfare service returned no complaints for your verified seafarer identity. Complaints you lodge appear
            here with their full governed status history.
          </p>
        </EmptyState>
      )}

      {state.kind === "ready" && state.complaints.length > 0 && (
        <>
          <p className="text-xs text-slate-500">Last refreshed {state.refreshedAt.toLocaleString("en-NG")}.</p>
          <ul className="space-y-3">
            {state.complaints.map((complaint) => (
              <ComplaintCard
                key={complaint.complaintId}
                complaint={complaint}
                expanded={expanded[complaint.complaintId] ?? false}
                onToggle={() => toggle(complaint.complaintId)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ComplaintCard({ complaint, expanded, onToggle }: { complaint: ComplaintView; expanded: boolean; onToggle: () => void }) {
  const disclosures = complaint.timeline.filter((event) => event.disclosureEvent);
  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            className="text-left text-base font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-500"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {COMPLAINT_CATEGORY_LABELS[complaint.category]} — {COMPLAINT_CHANNEL_LABELS[complaint.channel]}
          </button>
          <p className="mt-0.5 text-xs text-slate-500">
            Reference <span className="font-mono">{complaint.complaintId}</span> · submitted{" "}
            {new Date(complaint.submittedAt).toLocaleString("en-NG")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`badge badge--${complaintStatusTone(complaint.status)}`}>{COMPLAINT_STATUS_LABELS[complaint.status]}</span>
          {disclosures.length > 0 && <span className="badge badge--danger">Identity disclosed (governed)</span>}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        {complaint.disclosureScope === "withheld"
          ? "Your identity is currently withheld from the respondent (MLC Reg 5.1.5(2))."
          : "Your identity has been disclosed to the respondent under a governed, maker-checker-approved disclosure. See the flagged timeline event."}
      </p>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
          {complaint.narrative !== null && (
            <div>
              <p className="field-label">Your complaint description</p>
              <p className="whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">{complaint.narrative}</p>
            </div>
          )}
          {complaint.attachments.length > 0 && (
            <div>
              <p className="field-label">Attachment references (digests)</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {complaint.attachments.map((attachment, index) => (
                  <li key={`${attachment.sha256}-${index}`} className="font-mono">
                    {attachment.name} · sha256:{attachment.sha256}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="field-label">Status history</p>
            {complaint.timeline.length === 0 ? (
              <p className="text-sm text-slate-500">No transitions have been recorded yet.</p>
            ) : (
              <ol className="space-y-2">
                {complaint.timeline.map((event, index) => (
                  <li key={`${event.at}-${index}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-xs text-slate-500">{new Date(event.at).toLocaleString("en-NG")}</span>
                    <span className="text-slate-800">{describeTimelineTransition(event.transition)}</span>
                    <span className="badge badge--neutral">{event.actorRole}</span>
                    {event.disclosureEvent && (
                      <span className="badge badge--danger">Identity disclosure — legally required, logged</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-slate-200 pt-3">
        <button className="button button--outline" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? "Hide detail" : "Track status"}
        </button>
      </div>
    </li>
  );
}
