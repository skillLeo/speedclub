/**
 * ADR-429 e: a new passwordless account may create nothing before AUTH-09b; every such write answers 403 `terms_required`. The app
 * normally routes there from `next_step`, but a member whose cached Me is older (another device, a restored session) can still try
 * a write. Any such refusal refreshes auth/me, and the session routing then opens AUTH-09b with the page as the way back.
 */
import { useEffect } from 'react';

import { ApiError } from '@/api/client';
import { meKey } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';

export const TERMS_REQUIRED = 'terms_required';

export function isTermsRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === TERMS_REQUIRED;
}

/** At most one refresh per few seconds: a screen with several writes failing at once asks once. */
const REFRESH_GAP_MS = 5000;
let lastRefresh = 0;

export function refreshForTerms(now: number = Date.now()): void {
  if (now - lastRefresh < REFRESH_GAP_MS) return;
  lastRefresh = now;
  void queryClient.invalidateQueries({ queryKey: meKey });
}

export function useTermsRequiredRefresh(): void {
  useEffect(() => {
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && isTermsRequired(event.mutation.state.error)) refreshForTerms();
    });
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && isTermsRequired(event.query.state.error)) refreshForTerms();
    });
    return () => {
      mutations();
      queries();
    };
  }, []);
}
