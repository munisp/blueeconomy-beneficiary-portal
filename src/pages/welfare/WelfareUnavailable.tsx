/**
 * Fail-closed gate for the welfare surface: rendered when the build-time
 * welfare API configuration is absent or invalid. No substitute endpoint,
 * mock service or local data is ever used.
 */
export function WelfareUnavailable({ reason }: { reason: string }) {
  return (
    <section className="card border-l-4 border-l-red-800" role="alert">
      <p className="eyebrow">Integration gate active</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-800">Seafarer welfare service is not configured</h2>
      <p className="mt-1 text-sm text-slate-600">
        The welfare (MLC 2006) surface refuses to operate without an approved welfare API configuration.
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-slate-100 p-3 text-xs text-slate-700">{reason}</pre>
    </section>
  );
}
