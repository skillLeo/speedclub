/**
 * SET-13: the account was deleted in this app run. The form's screen reads it to leave (the form and its discard guard go
 * first), and the final screen reads it to know it follows a deletion rather than a typed URL. Memory only.
 */
import { create } from 'zustand';

import { useSessionStore } from '@/state/session';

const useDeletion = create<{ deleted: boolean }>(() => ({ deleted: false }));

export function markAccountDeleted(): void {
  useDeletion.setState({ deleted: true });
}

/** For the next member of this app run, and for tests. */
export function resetAccountDeleted(): void {
  useDeletion.setState({ deleted: false });
}

// A sign-in after a deletion is somebody's new session: the deletion of the last one says nothing about it.
useSessionStore.subscribe((state, previous) => {
  if (state.status === 'member' && previous.status !== 'member') resetAccountDeleted();
});

export function useAccountDeleted(): boolean {
  return useDeletion((state) => state.deleted);
}
