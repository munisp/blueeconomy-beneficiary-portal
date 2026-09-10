/**
 * Live-status channel for application status updates (Phase 17, #9 consumer).
 *
 * Doctrine: polling (with backoff) is the source of truth. When the runtime
 * configuration provides `live_updates.sse_url`, an EventSource is opened as
 * a refresh HINT: any event triggers an immediate poll. Event payloads are
 * never rendered directly, and if the SSE channel errors we degrade to
 * poll-only with an honest "realtime unavailable" state.
 *
 * The backend (geo-service/CVFF chain) currently exposes no SSE endpoint, so
 * deployments without `sse_url` run poll-only — this is documented behaviour,
 * not a silent degradation.
 */

/** Human-readable relative age such as "just now", "2 min ago". */
export function formatAge(nowMs: number, thenMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 10) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds} s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

/**
 * A status view is stale when the last successful refresh is older than
 * twice the configured poll interval (i.e. at least one cycle was missed).
 */
export function isStale(nowMs: number, lastSuccessMs: number | null, pollIntervalMs: number): boolean {
  if (lastSuccessMs === null) {
    return true; // never refreshed: nothing trustworthy to show
  }
  return nowMs - lastSuccessMs > 2 * pollIntervalMs;
}

export type LiveChannelState = "poll-only" | "sse-connected" | "sse-degraded";

/**
 * Opens an SSE hint channel. Returns the channel state callback target and a
 * closer. Never throws: any construction/connection failure degrades to
 * poll-only (fail-closed on honesty, not on availability of the page).
 */
export function openSseHintChannel(
  sseUrl: string | undefined,
  onHint: () => void,
  onState: (state: LiveChannelState) => void,
  eventSourceFactory?: (url: string) => EventSource,
): () => void {
  if (sseUrl === undefined || sseUrl.length === 0) {
    onState("poll-only");
    return () => {};
  }
  let source: EventSource;
  try {
    source = (eventSourceFactory ?? ((url: string) => new EventSource(url)))(sseUrl);
  } catch {
    onState("sse-degraded");
    return () => {};
  }
  source.onopen = () => onState("sse-connected");
  source.onmessage = () => onHint();
  // Any event type is treated as a hint only.
  source.onerror = () => {
    // EventSource auto-reconnects; while errored the channel is degraded and
    // polling alone carries status updates.
    onState("sse-degraded");
  };
  return () => source.close();
}
