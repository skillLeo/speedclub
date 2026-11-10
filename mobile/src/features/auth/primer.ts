/**
 * AUTH-10 in F1 (02 §4): Welcome → … → Profile setup → Notification primer (native) → Garage. The server knows the steps up to
 * AUTH-09; the primer belongs to the device, so this device remembers it. A member who leaves the app on the primer comes back to
 * it (F1 "resumes at the next incomplete step"); once answered, with either choice, it never asks again on this device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { isNative } from '@/lib/platform';

/** Native AsyncStorage key, holding the id of the member whose primer is still open. Only ids, nothing personal. */
export const PRIMER_PENDING_KEY = 'sc.primerPending';

/**
 * `idle`: nothing to do. `due`: the primer is open for the signed-in member (shown, or owed after a restart). `answered`: the
 * member chose, and the routing moves on to the garage.
 */
export type PrimerState = 'idle' | 'due' | 'answered';

export const usePrimerStore = create<{ state: PrimerState }>(() => ({ state: 'idle' }));

export function primerState(): PrimerState {
  return usePrimerStore.getState().state;
}

/** AUTH-10 is on screen for this member: kept, so a restart resumes there. */
export async function primerShown(memberId: string): Promise<void> {
  usePrimerStore.setState({ state: 'due' });
  try {
    await AsyncStorage.setItem(PRIMER_PENDING_KEY, memberId);
  } catch (error) {
    console.warn('Could not keep the open primer', error);
  }
}

/** Erlauben or Später: the step is done, on this device for good. */
export async function primerAnswered(): Promise<void> {
  usePrimerStore.setState({ state: 'answered' });
  try {
    await AsyncStorage.removeItem(PRIMER_PENDING_KEY);
  } catch (error) {
    console.warn('Could not forget the open primer', error);
  }
}

/** At every member change: the primer is owed again only when this member left it open. Another member's mark is dropped. */
export async function restorePrimer(memberId: string | null): Promise<void> {
  if (!isNative || memberId === null) {
    usePrimerStore.setState({ state: 'idle' });
    return;
  }
  let pending: string | null = null;
  try {
    pending = await AsyncStorage.getItem(PRIMER_PENDING_KEY);
  } catch {
    pending = null;
  }
  if (pending === memberId) {
    usePrimerStore.setState({ state: 'due' });
    return;
  }
  usePrimerStore.setState({ state: 'idle' });
  if (pending !== null) {
    try {
      await AsyncStorage.removeItem(PRIMER_PENDING_KEY);
    } catch {
      // Nothing to do: the next member change tries again.
    }
  }
}
