// The poll schedule (contract §3): 3 s and 15 s, paused in the background and on a hidden tab, 30 s with realtime, at once on a drop.
import {
  createPollScheduler,
  INBOX_POLL_MS,
  REALTIME_SAFETY_NET_MS,
  THREAD_POLL_MS,
  type Observable,
} from '@/features/messages/pollScheduler';

function source(initial: boolean): Observable<boolean> & { set: (next: boolean) => void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup(intervalMs = THREAD_POLL_MS, run?: (signal: AbortSignal) => Promise<void>) {
  const foreground = source(true);
  const online = source(true);
  const realtime = source(false);
  const runs: AbortSignal[] = [];
  const scheduler = createPollScheduler({
    intervalMs,
    run: (signal) => {
      runs.push(signal);
      return run ? run(signal) : Promise.resolve();
    },
    foreground,
    online,
    realtime,
  });
  return { scheduler, foreground, online, realtime, runs };
}

describe('poll scheduler', () => {
  it('runs at once, then every 3 s in an open conversation', async () => {
    const { scheduler, runs } = setup();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS - 1);
    expect(runs).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS * 3);
    expect(runs).toHaveLength(5);
    scheduler.stop();
  });

  it('polls the inbox every 15 s', async () => {
    const { scheduler, runs } = setup(INBOX_POLL_MS);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 2);
    expect(runs).toHaveLength(3);
    scheduler.stop();
  });

  it('counts the pause from the end of a slow run, so runs never overlap', async () => {
    let finish: () => void = () => undefined;
    const { scheduler, runs } = setup(THREAD_POLL_MS, () => new Promise<void>((resolve) => (finish = resolve)));
    scheduler.start();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(runs).toHaveLength(1);
    finish();
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS);
    expect(runs).toHaveLength(2);
    scheduler.stop();
  });

  it('pauses in the background, aborts the run under way, and runs at once on return', async () => {
    const { scheduler, foreground, runs } = setup(THREAD_POLL_MS, (signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())));
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(1);
    foreground.set(false);
    expect(runs[0]!.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(runs).toHaveLength(1);
    foreground.set(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(2);
    scheduler.stop();
  });

  it('pauses on a hidden web tab the same way (the focus source follows visibility)', async () => {
    const { scheduler, foreground, runs } = setup(INBOX_POLL_MS);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    foreground.set(false);
    await jest.advanceTimersByTimeAsync(INBOX_POLL_MS * 4);
    expect(runs).toHaveLength(1);
    scheduler.stop();
  });

  it('pauses offline and runs at once when the connection returns', async () => {
    const { scheduler, online, runs } = setup();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    online.set(false);
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS * 5);
    expect(runs).toHaveLength(1);
    online.set(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(2);
    scheduler.stop();
  });

  it('backs off to the 30 s safety net while realtime is connected, and resumes at once on a drop', async () => {
    const { scheduler, realtime, runs } = setup();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    realtime.set(true);
    expect(scheduler.nextDelay()).toBe(REALTIME_SAFETY_NET_MS);
    await jest.advanceTimersByTimeAsync(REALTIME_SAFETY_NET_MS - 1);
    expect(runs).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(2);

    realtime.set(false);
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS);
    expect(runs).toHaveLength(4);
    scheduler.stop();
  });

  it('backs off after failures and returns to its pace after a success', async () => {
    let fail = true;
    const { scheduler, runs } = setup(THREAD_POLL_MS, () => (fail ? Promise.reject(new Error('down')) : Promise.resolve()));
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(scheduler.nextDelay()).toBe(THREAD_POLL_MS * 2);
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS * 2);
    expect(runs).toHaveLength(2);
    expect(scheduler.nextDelay()).toBe(THREAD_POLL_MS * 4);
    fail = false;
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS * 4);
    expect(runs).toHaveLength(3);
    expect(scheduler.nextDelay()).toBe(THREAD_POLL_MS);
    scheduler.stop();
  });

  it('poke runs now, and once more after a run under way', async () => {
    let finish: () => void = () => undefined;
    const { scheduler, runs } = setup(THREAD_POLL_MS, () => new Promise<void>((resolve) => (finish = resolve)));
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    scheduler.poke();
    expect(runs).toHaveLength(1);
    finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(2);
    scheduler.stop();
  });

  it('keeps going after a foreign AbortError, for example the session\'s (review 19)', async () => {
    let calls = 0;
    const { scheduler, runs } = setup(THREAD_POLL_MS, () => {
      calls += 1;
      const error = new Error('aborted elsewhere');
      error.name = 'AbortError';
      return calls === 1 ? Promise.reject(error) : Promise.resolve();
    });
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(THREAD_POLL_MS * 2);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it('stop ends everything', async () => {
    const { scheduler, runs } = setup();
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    scheduler.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(runs).toHaveLength(1);
  });
});
