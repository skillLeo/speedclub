import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { createPollScheduler, type Observable, type PollScheduler } from './pollScheduler';
import { realtimeHub } from './realtime';

/**
 * In front: TanStack's focus manager, which the app wires to AppState on native (api/queryClient.ts) and which follows the page's
 * visibility on web. So a background app and a hidden tab both pause the polls.
 */
export const foregroundSource: Observable<boolean> = {
  get: () => focusManager.isFocused(),
  subscribe: (listener) => focusManager.subscribe(() => listener()),
};

/** NetInfo on native, navigator.onLine on web (api/queryClient.ts). */
export const onlineSource: Observable<boolean> = {
  get: () => onlineManager.isOnline(),
  subscribe: (listener) => onlineManager.subscribe(() => listener()),
};

/**
 * Runs `run` on the schedule of `pollScheduler.ts` while `enabled`. Returns `poke` to run at once, for example on a realtime
 * event or right after a send.
 */
export function usePolling(
  run: (signal: AbortSignal) => Promise<unknown>,
  intervalMs: number,
  enabled: boolean,
  /** Live realtime for what this poll covers: `realtimeHub.channelLive(name)`, stable per name. */
  realtime: Observable<boolean> = realtimeHub.status,
): () => void {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);
  const scheduler = useRef<PollScheduler | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const next = createPollScheduler({
      intervalMs,
      run: async (signal) => {
        await latest.current(signal);
      },
      foreground: foregroundSource,
      online: onlineSource,
      realtime,
    });
    scheduler.current = next;
    next.start();
    return () => {
      next.stop();
      if (scheduler.current === next) scheduler.current = null;
    };
  }, [enabled, intervalMs, realtime]);

  return useMemo(() => () => scheduler.current?.poke(), []);
}
