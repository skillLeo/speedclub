/**
 * App readiness: the splash stays up, and `dataset.scReady` stays unset, until every gate is released.
 *
 *   const releaseSession = registerReadyGate('session');   // at module scope, before the first render
 *   restoreSession().finally(releaseSession);
 *
 * Once open, the app stays ready. A gate that never releases cannot trap the user behind the splash:
 * it opens itself after READY_GATE_TIMEOUT_MS and logs a warning. Opening a gate does not render anything,
 * so whatever a gate waits for needs its own bound if rendering depends on it (see useAppFonts).
 * "Ready" therefore does not prove that a screen exists; useFirstScreenMounted does.
 *
 * Rule: every route renders the Screen primitive, +not-found and modals included. Only Screen releases the
 * first-screen gate, so a route without it holds the splash for the full timeout and never sets
 * `dataset.scReady`.
 */
import { useSyncExternalStore } from 'react';

export const READY_GATE_TIMEOUT_MS = 10_000;

const pending = new Set<string>();
const listeners = new Set<() => void>();
let ready = false;

function release(name: string): void {
  if (!pending.delete(name) || pending.size > 0) return;
  ready = true;
  listeners.forEach((listener) => listener());
}

export function registerReadyGate(name: string, timeoutMs: number = READY_GATE_TIMEOUT_MS): () => void {
  if (ready) {
    console.warn(`Ready gate "${name}" was registered after the app became ready.`);
    return () => undefined;
  }
  pending.add(name);
  const timer = setTimeout(() => {
    console.warn(`Ready gate "${name}" timed out after ${timeoutMs} ms.`);
    release(name);
  }, timeoutMs);
  return () => {
    clearTimeout(timer);
    release(name);
  };
}

let releaseFirstScreen: (() => void) | null = null;
let firstScreenMounted = false;

/** Keeps the app unready until a route screen exists. The root layout calls this at module scope. */
export function registerFirstScreenGate(): void {
  releaseFirstScreen = registerReadyGate('first-screen');
}

/** Called by the Screen primitive on mount, so route chunks loaded later than the layout still count. */
export function markFirstScreenMounted(): void {
  if (firstScreenMounted) return;
  firstScreenMounted = true;
  releaseFirstScreen?.();
  releaseFirstScreen = null;
  listeners.forEach((listener) => listener());
}

export function isFirstScreenMounted(): boolean {
  return firstScreenMounted;
}

export function isAppReady(): boolean {
  return ready;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppReady(): boolean {
  return useSyncExternalStore(subscribe, isAppReady, isAppReady);
}

export function useFirstScreenMounted(): boolean {
  return useSyncExternalStore(subscribe, isFirstScreenMounted, isFirstScreenMounted);
}
