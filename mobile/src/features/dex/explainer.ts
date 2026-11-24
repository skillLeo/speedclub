/**
 * R4-3.1: whether DEX-01 shows its explainer card expanded. On this device only (a small UI pref, no server field): expanded on the
 * first `EXPANDED_VISITS` visits until the member hides it, then the compact "So funktioniert's" link. AsyncStorage (localStorage on
 * the web); a view-as or draft preview tab keeps it in memory, so a staff member's browser never changes from a member's view.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { keepsNothingOnDisk } from '@/api/ephemeralTab';

export const DEX_EXPLAINER_KEY = 'sc.dexExplainer';
/** The first visits that show the card expanded. */
export const EXPANDED_VISITS = 3;

type ExplainerState = { visits: number; dismissed: boolean; hydrated: boolean };

export const useDexExplainerStore = create<ExplainerState>(() => ({ visits: 0, dismissed: false, hydrated: false }));

/** Expanded while the member has not hidden it and within the first visits. */
export function explainerExpanded({ visits, dismissed }: Pick<ExplainerState, 'visits' | 'dismissed'>): boolean {
  return !dismissed && visits <= EXPANDED_VISITS;
}

function persist(): void {
  if (keepsNothingOnDisk()) return;
  const { visits, dismissed } = useDexExplainerStore.getState();
  AsyncStorage.setItem(DEX_EXPLAINER_KEY, JSON.stringify({ visits, dismissed })).catch(() => console.warn('Could not keep the Dex explainer state'));
}

let hydration: Promise<void> | null = null;

/** Reads the stored state once; a broken or foreign value counts as a first visit. */
export function hydrateDexExplainer(): Promise<void> {
  hydration ??= (async () => {
    let visits = 0;
    let dismissed = false;
    try {
      const raw = keepsNothingOnDisk() ? null : await AsyncStorage.getItem(DEX_EXPLAINER_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const value = parsed as { visits?: unknown; dismissed?: unknown };
        if (typeof value.visits === 'number' && Number.isFinite(value.visits)) visits = Math.max(0, Math.floor(value.visits));
        dismissed = value.dismissed === true;
      }
    } catch {
      // Unreadable: a first visit.
    }
    const current = useDexExplainerStore.getState();
    useDexExplainerStore.setState({ visits: Math.max(visits, current.visits), dismissed: dismissed || current.dismissed });
  })();
  return hydration;
}

/** One visit of DEX-01 (once per mount of the screen). The card draws only from here on, so it never flips on a fourth visit. */
export async function countDexVisit(): Promise<void> {
  await hydrateDexExplainer();
  useDexExplainerStore.setState((state) => ({ visits: state.visits + 1, hydrated: true }));
  persist();
}

/** "Erklärung ausblenden": the compact link from now on. */
export function dismissDexExplainer(): void {
  useDexExplainerStore.setState({ dismissed: true });
  persist();
}

/** Tests only. */
export function resetDexExplainerForTests(): void {
  hydration = null;
  useDexExplainerStore.setState({ visits: 0, dismissed: false, hydrated: false });
}
