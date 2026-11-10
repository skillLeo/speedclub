import { useSyncExternalStore } from 'react';

export type ToastHaptic = 'success' | 'warning';

export type ToastAction = { label: string; onPress: () => void };

export type ToastOptions = {
  /** Adds the "Rückgängig" action from the common namespace. */
  undo?: () => void;
  /** Any other single action. `undo` wins when both are given. */
  action?: ToastAction;
  /** Only where it is meaningful (§10). */
  haptic?: ToastHaptic;
  /** `.action` is added for the action button. */
  testID?: string;
};

export type ToastItem = ToastOptions & { id: number; message: string };

let current: ToastItem | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: ToastItem | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Shows a toast. A new toast replaces the current one. Returns its id for `dismissToast`. */
export function toast(message: string, options: ToastOptions = {}): number {
  const id = nextId++;
  publish({ ...options, id, message });
  return id;
}

/** Without an id it dismisses whatever is showing. */
export function dismissToast(id?: number): void {
  if (current && (id === undefined || current.id === id)) publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCurrentToast(): ToastItem | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
