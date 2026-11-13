/**
 * "Das war ich nicht" (M4.7, 09 §8.4): the answer the result screen (/auth/secure) shows after SET-21 secured the account. The
 * session ends with it, so the answer cannot wait in a query: it is held here, in memory, for that one screen.
 */
import { create } from 'zustand';

import type { SecuredAccount } from '@/api/queries/accountSecurity';

type State = { result: SecuredAccount | null };

export const useSecuredAccountStore = create<State>(() => ({ result: null }));

export function holdSecuredAccount(result: SecuredAccount): void {
  useSecuredAccountStore.setState({ result });
}

export function forgetSecuredAccount(): void {
  useSecuredAccountStore.setState({ result: null });
}
