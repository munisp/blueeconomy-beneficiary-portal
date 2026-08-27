/**
 * Bounded exponential-backoff poller used by the status-tracking view.
 * Delays grow from `baseMs` up to `maxMs` (x2 per attempt, capped) and the
 * poller stops when cancelled or when the callback reports a terminal state.
 */

export interface PollerHandle {
  cancel(): void;
}

export interface PollOptions {
  baseMs: number;
  maxMs?: number;
  /** Maximum number of attempts before the poller stops on its own. */
  maxAttempts?: number;
}

export function startPolling(
  tick: (attempt: number) => Promise<{ terminal: boolean }>,
  onError: (message: string) => void,
  options: PollOptions,
): PollerHandle {
  const maxMs = options.maxMs ?? 120_000;
  const maxAttempts = options.maxAttempts ?? 200;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function run(attempt: number): Promise<void> {
    if (cancelled || attempt > maxAttempts) {
      return;
    }
    let terminal = false;
    try {
      terminal = (await tick(attempt)).terminal;
    } catch (error) {
      onError(error instanceof Error ? error.message : "status refresh failed");
    }
    if (cancelled || terminal) {
      return;
    }
    const delay = Math.min(options.baseMs * 2 ** Math.min(attempt, 8), maxMs);
    timer = setTimeout(() => void run(attempt + 1), delay);
  }

  void run(0);
  return {
    cancel() {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
