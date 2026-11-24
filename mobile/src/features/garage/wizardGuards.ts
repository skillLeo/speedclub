import { useEffect, useId, useSyncExternalStore } from 'react';

/**
 * R4B-005 (client round 4 hunt): GAR-03 pushes one screen per step, so after "Veröffentlichen" the earlier steps still sit in the
 * stack under the review. A step whose form came back dirty (WizardSpecsScreen keeps dirty fields over the saved values) blocked
 * GAR-04's `router.replace` with "Änderungen verwerfen?", and "Weiter bearbeiten" left an endless skeleton. A published draft has
 * nothing left to lose: every step of it releases its guard, and the move to GAR-04 waits until the last guard of that draft has
 * actually let go (each frame reports after its DiscardGuardDialog's own effect, children's effects running first).
 */
const published = new Set<string>();
const guards = new Map<string, Map<string, boolean>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The draft is published: its steps stop guarding. */
export function markWizardPublished(draftId: string): void {
  if (published.has(draftId)) return;
  published.add(draftId);
  emit();
}

export function useWizardPublished(draftId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => published.has(draftId),
    () => published.has(draftId),
  );
}

function guarding(draftId: string): boolean {
  for (const dirty of guards.get(draftId)?.values() ?? []) if (dirty) return true;
  return false;
}

/** One wizard frame reports whether its guard holds; unmounting clears it. */
export function useReportWizardGuard(draftId: string, guarded: boolean): void {
  const token = useId();
  useEffect(() => {
    let byFrame = guards.get(draftId);
    if (!byFrame) guards.set(draftId, (byFrame = new Map()));
    byFrame.set(token, guarded);
    emit();
    return () => {
      byFrame.delete(token);
      if (byFrame.size === 0) guards.delete(draftId);
      emit();
    };
  }, [draftId, guarded, token]);
}

/** Runs `then` once no frame of the draft guards any more (at once when none does); returns a cancel. */
export function whenWizardGuardsReleased(draftId: string, then: () => void): () => void {
  if (!guarding(draftId)) {
    then();
    return () => undefined;
  }
  let done = false;
  const unsubscribe = subscribe(() => {
    if (done || guarding(draftId)) return;
    done = true;
    unsubscribe();
    then();
  });
  return () => {
    done = true;
    unsubscribe();
  };
}

/** Tests only. */
export function __resetWizardGuardsForTests(): void {
  published.clear();
  guards.clear();
}
