/**
 * Delete with undo (SM20, 09 §7.7 COL-01/02): the thing leaves the screen at once and the toast offers "Rückgängig" for its
 * 5 s; only then is the delete sent. Undo therefore never needs the server, and a delete is never sent twice. The hidden keys
 * live here, outside the screens, so leaving the screen during the toast still sends the delete and a refetch in the meantime
 * cannot bring the thing back.
 */
import { useSyncExternalStore } from 'react';

import { motion } from '@/theme';

/** SM20: a toast with an action stays this long (ToastHost's TOAST_ACTION_DURATION_MS). */
const UNDO_MS: number = motion.signature.toast.autoDismiss;

type Pending = { timer: ReturnType<typeof setTimeout> | null; run: () => Promise<void> };

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
let hidden: ReadonlySet<string> = new Set();

function publish(): void {
  hidden = new Set(pending.keys());
  listeners.forEach((listener) => listener());
}

function finish(key: string, entry: Pending): void {
  if (pending.get(key) !== entry) return;
  pending.delete(key);
  publish();
}

export type DeferredRemoval = {
  /** Brings the thing back; false when the delete was already sent. */
  undo: () => boolean;
};

/**
 * Hides `key` now and runs `commit` once the undo toast is gone. A failing commit calls `onFailed` and shows the thing again
 * (its screen reads the list again). The key stays hidden until `commit` settles, which should include reading the list again.
 */
export function removeWithUndo(key: string, commit: () => Promise<unknown>, onFailed: (error: unknown) => void): DeferredRemoval {
  const entry: Pending = {
    timer: null,
    run: async () => {
      entry.timer = null;
      try {
        await commit();
      } catch (error) {
        onFailed(error);
      } finally {
        finish(key, entry);
      }
    },
  };
  // The same key again (removed, undone, removed): the newer removal replaces a waiting one.
  const before = pending.get(key);
  if (before?.timer) clearTimeout(before.timer);
  entry.timer = setTimeout(() => void entry.run(), UNDO_MS);
  pending.set(key, entry);
  publish();
  return {
    undo: () => {
      if (pending.get(key) !== entry || entry.timer === null) return false;
      clearTimeout(entry.timer);
      finish(key, entry);
      return true;
    },
  };
}

/** Sends every waiting delete now (sign-out, tests). */
export async function flushRemovals(): Promise<void> {
  const waiting = [...pending.values()].filter((entry) => entry.timer !== null);
  waiting.forEach((entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
  });
  await Promise.all(waiting.map((entry) => entry.run()));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The keys hidden right now; screens leave them out of their lists. */
export function useHiddenRemovals(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => hidden, () => hidden);
}

/** For the tests. */
export function __resetRemovalsForTests(): void {
  pending.forEach((entry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
  });
  pending.clear();
  publish();
}
