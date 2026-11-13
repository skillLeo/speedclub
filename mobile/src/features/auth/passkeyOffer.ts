/**
 * AUTH-14 (09 §7.2): offered once per device, after the first successful sign-in on a device that can hold a passkey, behind
 * `auth.passkeys`. A sign-in screen arms the offer before it signs in (`armPasskeyOffer`); SessionHost's routing then sends the new
 * session to /auth/passkey-offer instead of where it was going, and the screen's answer ("Passkey hinzufügen" or "Später")
 * releases it. A passkey sign-in never arms it, and neither does the F1 onboarding of a new account.
 */
import { create } from 'zustand';

import { getStored, setStored, type StorageKey } from '@/lib/storage';

import { platformAuthenticatorAvailable } from './providers/passkeys';

const OFFERED_KEY = 'sc.passkeyOffered' satisfies StorageKey;

export type PasskeyOfferState = 'idle' | 'due' | 'answered';

type Store = { state: PasskeyOfferState; offeredBefore: boolean | null };

export const usePasskeyOfferStore = create<Store>(() => ({ state: 'idle', offeredBefore: null }));

async function offeredBefore(): Promise<boolean> {
  const known = usePasskeyOfferStore.getState().offeredBefore;
  if (known !== null) return known;
  const value = (await getStored(OFFERED_KEY)) === '1';
  usePasskeyOfferStore.setState({ offeredBefore: value });
  return value;
}

/**
 * Before a sign-in that is not a passkey: arms the offer when passkeys are on and the device has a platform authenticator, and the
 * offer was never shown here. Resolves when decided, so the routing that follows the sign-in sees it.
 */
export async function armPasskeyOffer(passkeysOn: boolean): Promise<void> {
  if (!passkeysOn || (await offeredBefore()) || !(await platformAuthenticatorAvailable())) return;
  usePasskeyOfferStore.setState({ state: 'due' });
}

/** A failed sign-in leaves nothing armed. */
export function disarmPasskeyOffer(): void {
  if (usePasskeyOfferStore.getState().state === 'due') usePasskeyOfferStore.setState({ state: 'idle' });
}

/** The member chose on AUTH-14: never again on this device. */
export function answerPasskeyOffer(): void {
  usePasskeyOfferStore.setState({ state: 'answered', offeredBefore: true });
  void setStored(OFFERED_KEY, '1');
}

/** After the routing left AUTH-14. */
export function resetPasskeyOffer(): void {
  usePasskeyOfferStore.setState({ state: 'idle' });
}
