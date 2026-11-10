import { useSyncExternalStore } from 'react';

let stack: readonly symbol[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly symbol[]) {
  stack = next;
  listeners.forEach((listener) => listener());
}

/** Registers an open overlay, on top of the others. Returns the release. */
export function pushOverlay(token: symbol): () => void {
  publish([...stack, token]);
  return () => publish(stack.filter((entry) => entry !== token));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The overlay on top, or null when none is open. It alone shows toasts, because it covers everything else. */
export function useTopOverlay(): symbol | null {
  return useSyncExternalStore(
    subscribe,
    () => stack[stack.length - 1] ?? null,
    () => null,
  );
}
