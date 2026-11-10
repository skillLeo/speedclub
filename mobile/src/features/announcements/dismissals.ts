/**
 * Dismissed announcements, on this device only (M3.5 §3: device-local and sync-free, no server table): a list of ids in AsyncStorage
 * (localStorage on web), the newest 50 kept. A view-as tab and a draft preview tab keep their dismissals in memory, so the staff member's own
 * browser storage never changes from a member's view or a draft (m3.2-contract §3, ADM-34).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { keepsNothingOnDisk } from '@/api/ephemeralTab';

export const DISMISSALS_STORAGE_KEY = 'sc.announcementsDismissed';
const KEEP = 50;

type DismissalState = { ids: readonly string[]; hydrated: boolean };

export const useDismissalStore = create<DismissalState>(() => ({ ids: [], hydrated: false }));

let hydration: Promise<void> | null = null;

/** Reads the stored ids once; a broken or foreign value counts as none. */
export function hydrateDismissals(): Promise<void> {
  hydration ??= (async () => {
    let stored: string[] = [];
    try {
      const raw = keepsNothingOnDisk() ? null : await AsyncStorage.getItem(DISMISSALS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed))
        stored = parsed.filter((id): id is string => typeof id === 'string').slice(-KEEP);
    } catch {
      // Unreadable: nothing dismissed.
    }
    const current = useDismissalStore.getState().ids;
    useDismissalStore.setState({ ids: [...new Set([...stored, ...current])].slice(-KEEP), hydrated: true });
  })();
  return hydration;
}

export function dismissAnnouncement(id: string): void {
  const ids = [...useDismissalStore.getState().ids.filter((known) => known !== id), id].slice(-KEEP);
  useDismissalStore.setState({ ids });
  if (keepsNothingOnDisk()) return;
  AsyncStorage.setItem(DISMISSALS_STORAGE_KEY, JSON.stringify(ids)).catch(() =>
    console.warn('Could not store a dismissed announcement'),
  );
}

/** Tests only. */
export function resetDismissalsForTests(): void {
  hydration = null;
  useDismissalStore.setState({ ids: [], hydrated: false });
}
