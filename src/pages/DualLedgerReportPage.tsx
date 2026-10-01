import { useCallback, useState } from "react";
import type { SessionContext } from "../App";
import type { Route } from "../router";
import { ApiError } from "../api/client";
import {
  downloadDualLedgerReportCsv,
  getDualLedgerReportCsvName,
  getDualLedgerReport,
  validateReportWindow,
  MAX_REPORT_WINDOW_DAYS,
  type DualLedgerReportRow,
} from "../api/officer";
import { formatCentsAsUsd, formatKoboAsNgn, formatMicroRate } from "../domain/money";
import { ErrorNotice, StatusBadge } from "../components/feedback";

type ReportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: DualLedgerReportRow[]; from: Date; to: Date };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status > 0 ? `HTTP ${error.status}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : "The report could not be loaded.";
}

/** YYYY-MM-DDTHH:mm for datetime-local inputs, in UTC to match the RFC 3339 window. */
function toInputValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function defaultWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: toInputValue(from), to: toInputValue(to) };
}

/**
 * Auditor screen for GET /v1/cvff/reports/dual-ledger (realm role
 * `auditor`, PBAC resource cvff.reports.dual-ledger). Renders the JSON rows
 * and offers the CSV rendering of the same window as a download.
 */
export function DualLedgerReportPage({ session, navigate }: { session: SessionContext; navigate: (route: Route) => void }) {
  const [window_, setWindow] = useState(defaultWindow);
  const [state, setState] = useState<ReportState>({ kind: "idle" });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const parseWindow = (): { from: Date; to: Date } | { error: string } => {
    const from = new Date(`${window_.from}:00Z`);
    const to = new Date(`${window_.to}:00Z`);
    const problem = validateReportWindow(from, to);
    return problem === null ? { from, to } : { error: problem };
  };

  const load = useCallback(async () => {
    const parsed = parseWindow();
    if ("error" in parsed) {
      setState({ kind: "error", message: parsed.error });
      return;
    }
    const client = await session.getClient();
    if (client === null) {
      return; // session expired; App renders the sign-in gate
    }
    setState({ kind: "loading" });
    try {
      const rows = await getDualLedgerReport(client, parsed.from, parsed.to);
      setState({ kind: "ready", rows, from: parsed.from, to: parsed.to });
    } catch (error) {
      setState({ kind: "error", message: describeError(error) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, window_]);

  const downloadCsv = useCallback(async () => {
    if (state.kind !== "ready") {
      return;
    }
    const client = await session.getClient();
    if (client === null) {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await downloadDualLedgerReportCsv(client, state.from, state.to);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = getDualLedgerReportCsvName(state.from, state.to);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(describeError(error));
    } finally {
      setDownloading(false);
    }
  }, [session, state]);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Auditor report</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-800">Dual-ledger disbursement report</h2>
        <p className="mt-1 text-sm text-slate-600">
          NGN custodial fee and FX-adjusted USD cost per disbursed application over the half-open window [from, to).
          The window is mandatory and bounded to {MAX_REPORT_WINDOW_DAYS} days by the API.
        </p>
      </div>

      <section className="card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="field-label">From (UTC)</span>
            <input
              className="field-input"
              type="datetime-local"
              value={window_.from}
              onChange={(event) => setWindow({ ...window_, from: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="field-label">To (UTC)</span>
            <input
              className="field-input"
              type="datetime-local"
              value={window_.to}
              onChange={(event) => setWindow({ ...window_, to: event.target.value })}
            />
          </label>
          <button className="button" onClick={() => void load()} disabled={state.kind === "loading"}>
            {state.kind === "loading" ? "Loading…" : "Run report"}
          </button>
          {state.kind === "ready" && (
            <button className="button button--outline" onClick={() => void downloadCsv()} disabled={downloading}>
              {downloading ? "Downloading…" : "Download CSV"}
            </button>
          )}
        </div>
        {downloadError !== null && <p className="field-error mt-2" role="alert">{downloadError}</p>}
      </section>

      {state.kind === "error" && <ErrorNotice message={state.message} onRetry={() => void load()} />}

      {state.kind === "ready" && state.rows.length === 0 && (
        <section className="card" aria-live="polite">
          <p className="eyebrow">Nothing to display</p>
          <p className="mt-1 text-sm text-slate-600">No disbursements were recorded in the selected window.</p>
        </section>
      )}

      {state.kind === "ready" && state.rows.length > 0 && (
        <section className="card overflow-x-auto" aria-live="polite">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Application</th>
                <th className="py-2 pr-4">State</th>
                <th className="py-2 pr-4 text-right">Fee (NGN)</th>
                <th className="py-2 pr-4 text-right">Cost (USD)</th>
                <th className="py-2 pr-4 text-right">Cost (NGN equiv.)</th>
                <th className="py-2 pr-4 text-right">NGN/USD rate</th>
                <th className="py-2 pr-4">Fee transfer</th>
                <th className="py-2 pr-4">Cost transfer</th>
                <th className="py-2">Disbursed at</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.application_id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs">{row.application_id}</td>
                  <td className="py-2 pr-4"><StatusBadge state={row.state} /></td>
                  <td className="py-2 pr-4 text-right">{formatKoboAsNgn(row.fee_ngn_minor)}</td>
                  <td className="py-2 pr-4 text-right">{formatCentsAsUsd(row.cost_usd_minor)}</td>
                  <td className="py-2 pr-4 text-right">{formatKoboAsNgn(row.cost_ngn_equivalent)}</td>
                  <td className="py-2 pr-4 text-right">{formatMicroRate(row.ngn_per_usd_micro)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{row.fee_transfer_id}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{row.cost_transfer_id}</td>
                  <td className="py-2">{new Date(row.disbursed_at).toLocaleString("en-NG")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Window {state.from.toISOString()} → {state.to.toISOString()} (half-open). Rates are recorded at
            disbursement time from the approved CBN rate feed.
          </p>
        </section>
      )}

      <button className="button button--quiet" onClick={() => navigate({ name: "dashboard" })}>
        ← Back to dashboard
      </button>
    </div>
  );
}
