import type { ReactNode } from "react";
import { stateBadge, type CvffState, type SlaReading } from "../domain/cvff";

export function StatusBadge({ state }: { state: CvffState }) {
  const badge = stateBadge(state);
  return (
    <span className={`badge badge--${badge.tone}`} title={badge.description}>
      {badge.label}
    </span>
  );
}

export function SlaCountdown({ reading }: { reading: SlaReading }) {
  if (reading.status === "overdue") {
    const days = Math.ceil(-reading.remainingMs / (24 * 60 * 60 * 1000));
    return (
      <span className="badge badge--danger">
        SLA overdue by {days} day{days === 1 ? "" : "s"}
      </span>
    );
  }
  const totalHours = Math.floor(reading.remainingMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const tone = reading.status === "due-soon" ? "warning" : "neutral";
  return (
    <span className={`badge badge--${tone}`} title={`${reading.tier} tier decision due ${reading.deadline.toLocaleString("en-NG")}`}>
      {days > 0 ? `${days}d ${hours}h` : `${hours}h`} of SLA remaining
    </span>
  );
}

export function LoadingState({ message }: { message: string }) {
  return (
    <section className="card" aria-live="polite">
      <p className="eyebrow">Loading</p>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="card" aria-live="polite">
      <p className="eyebrow">Nothing to display</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="card border-l-4 border-l-red-800" role="alert">
      <p className="eyebrow">Request failed</p>
      <p className="mt-1 text-sm text-slate-700">{message}</p>
      {onRetry !== undefined && (
        <button className="button button--outline mt-3" onClick={onRetry}>
          Retry
        </button>
      )}
    </section>
  );
}
