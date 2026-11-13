/**
 * Recent authentication ("sudo mode", 09 §8.1): a sensitive call that answers 403 `reauthentication_required` opens the reauth sheet
 * (features/auth/RecentAuthHost), and after the member confirmed it is them the call goes again, once. Cancelling the sheet
 * rejects with ReauthCancelled, which screens treat as "nothing happened" (no error notice).
 */
import { create } from 'zustand';

import { ApiError } from '@/api/client';

import { reauthMethodsOf, type ReauthMethod } from './errorDetails';

export const REAUTH_REQUIRED = 'reauthentication_required';

export class ReauthCancelled extends Error {
  constructor() {
    super('reauth_cancelled');
    this.name = 'ReauthCancelled';
  }
}

export function isReauthCancelled(error: unknown): boolean {
  return error instanceof ReauthCancelled;
}

export function isReauthRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === REAUTH_REQUIRED;
}

type Pending = {
  /** From the 403 body; null when the call did not keep it, and the sheet derives them from the member. */
  methods: ReauthMethod[] | null;
  settle: (confirmed: boolean) => void;
};

type RecentAuthState = { pending: Pending | null };

export const useRecentAuthStore = create<RecentAuthState>(() => ({ pending: null }));

/**
 * Opens the sheet and resolves once the member confirmed (true) or closed it (false). A second request while one is open joins
 * it: two parallel calls need one confirmation, not two sheets.
 */
export function requestRecentAuth(methods: ReauthMethod[] | null): Promise<boolean> {
  const open = useRecentAuthStore.getState().pending;
  return new Promise<boolean>((resolve) => {
    if (open) {
      const previous = open.settle;
      useRecentAuthStore.setState({
        pending: {
          methods: open.methods,
          settle: (confirmed) => {
            previous(confirmed);
            resolve(confirmed);
          },
        },
      });
      return;
    }
    useRecentAuthStore.setState({ pending: { methods, settle: resolve } });
  });
}

/** The sheet's answer. Settles every waiting call. */
export function settleRecentAuth(confirmed: boolean): void {
  const open = useRecentAuthStore.getState().pending;
  useRecentAuthStore.setState({ pending: null });
  open?.settle(confirmed);
}

/** Runs a sensitive call; on 403 reauthentication_required asks, then runs it once more. */
export async function withRecentAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!isReauthRequired(error)) throw error;
    const confirmed = await requestRecentAuth(reauthMethodsOf(error));
    if (!confirmed) throw new ReauthCancelled();
    return call();
  }
}
