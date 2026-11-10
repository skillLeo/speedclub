/**
 * Polling that always works without Pusher (contract §3, 05 §11, ADR-009):
 *
 * - every `intervalMs` (3 s for an open conversation, 15 s for the inbox), counted from the end of the previous run, so two runs
 *   never overlap and a slow answer never piles requests up;
 * - paused while the app is in the background or the web tab is hidden, and while offline; it runs at once when it comes back;
 * - with realtime connected only a 30 s safety net, and at once again when the socket drops;
 * - after failures it backs off (doubling, at most 30 s) and returns to its pace with the first success.
 *
 * The sources are injected, so the scheduler is tested with fake timers; `usePolling` wires TanStack's focus and online managers
 * (AppState and NetInfo on native, visibility and navigator.onLine on web) and the realtime status.
 */

export type Observable<T> = {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
};

export const THREAD_POLL_MS = 3_000;
export const INBOX_POLL_MS = 15_000;
export const REALTIME_SAFETY_NET_MS = 30_000;
export const MAX_BACKOFF_MS = 30_000;

export type PollSchedulerOptions = {
  intervalMs: number;
  run: (signal: AbortSignal) => Promise<void>;
  /** App active and, on web, the tab visible. */
  foreground: Observable<boolean>;
  online?: Observable<boolean>;
  /** The realtime socket is connected. */
  realtime?: Observable<boolean>;
  safetyNetMs?: number;
  maxBackoffMs?: number;
};

export type PollScheduler = {
  start: () => void;
  stop: () => void;
  /** Run now, for example after sending or on a realtime event. A run under way is followed by one more. */
  poke: () => void;
  /** The pause before the next run, as it stands now. */
  nextDelay: () => number;
};

const ALWAYS: Observable<boolean> = { get: () => true, subscribe: () => () => undefined };
const NEVER: Observable<boolean> = { get: () => false, subscribe: () => () => undefined };

export function createPollScheduler(options: PollSchedulerOptions): PollScheduler {
  const online = options.online ?? ALWAYS;
  const realtime = options.realtime ?? NEVER;
  const safetyNet = options.safetyNetMs ?? REALTIME_SAFETY_NET_MS;
  const maxBackoff = options.maxBackoffMs ?? MAX_BACKOFF_MS;

  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flight: AbortController | null = null;
  let again = false;
  let failures = 0;
  let wasRealtime = realtime.get();
  let unsubscribe: (() => void)[] = [];

  const active = () => started && options.foreground.get() && online.get();

  const nextDelay = () => {
    const base = realtime.get() ? Math.max(safetyNet, options.intervalMs) : options.intervalMs;
    if (failures === 0) return base;
    return Math.max(base, Math.min(options.intervalMs * 2 ** failures, maxBackoff));
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delay: number) => {
    clearTimer();
    if (active()) timer = setTimeout(tick, delay);
  };

  const abortFlight = () => {
    flight?.abort();
    flight = null;
    again = false;
  };

  async function tick(): Promise<void> {
    timer = null;
    if (!active()) return;
    if (flight) {
      again = true;
      return;
    }
    const controller = new AbortController();
    flight = controller;
    try {
      await options.run(controller.signal);
      failures = 0;
    } catch {
      // Only this run's own abort (a pause) ends it quietly. Any other error, a foreign AbortError included (the session's, a
      // request's own), counts as a failure and the schedule goes on (review 19).
      if (controller.signal.aborted) return;
      failures += 1;
    } finally {
      if (flight === controller) flight = null;
    }
    if (controller.signal.aborted) return;
    if (again) {
      again = false;
      schedule(0);
    } else {
      schedule(nextDelay());
    }
  }

  const runNow = () => {
    clearTimer();
    if (!active()) return;
    if (flight) {
      again = true;
      return;
    }
    void tick();
  };

  const onPresence = () => {
    if (active()) runNow();
    else {
      clearTimer();
      abortFlight();
    }
  };

  const onRealtime = () => {
    const connected = realtime.get();
    const dropped = wasRealtime && !connected;
    wasRealtime = connected;
    if (!started) return;
    // The socket dropped: whatever it would have told us may be missing, so ask now and go back to the full pace.
    if (dropped) runNow();
    else if (!flight) schedule(nextDelay());
  };

  return {
    start() {
      if (started) return;
      started = true;
      failures = 0;
      wasRealtime = realtime.get();
      unsubscribe = [options.foreground.subscribe(onPresence), online.subscribe(onPresence), realtime.subscribe(onRealtime)];
      runNow();
    },
    stop() {
      started = false;
      clearTimer();
      abortFlight();
      unsubscribe.forEach((off) => off());
      unsubscribe = [];
    },
    poke: runNow,
    nextDelay,
  };
}
