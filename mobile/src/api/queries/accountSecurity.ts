/**
 * M4.7 account security (09 §7.9, §8.4): SET-21 Sicherheitsaktivität (`GET me/security-events`, cursor-paged), "Das war ich nicht"
 * from a row (`POST me/security/secure`) and from the alert mail's link (`POST auth/secure-account`, no sign-in). Both secure the
 * whole account at once: every device and browser signed out (this one too), a new password at the next sign-in, a support request.
 */
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';

import { api, apiData, newIdempotencyKey, withIdempotency } from '@/api/client';
import type { components } from '@/api/schema';
import { useSessionStore } from '@/state/session';

import { withFreshCsrf } from './auth';
import { retryUnlessAnswered } from './vehicles';

type Schemas = components['schemas'];
export type SecurityEvent = Schemas['SecurityEventResource'];
export type SecurityActivity = Schemas['SecurityActivity'];
export type SecuredAccount = Schemas['SecuredAccountResource'];

/** Rows per page of SET-21 (the server allows 1–50). */
export const SECURITY_EVENTS_PAGE_SIZE = 30;

export const securityEventsKey = ['me', 'security-events'] as const;

/**
 * One page. The OpenAPI export types only `data`; the cursor paginator also sends `meta.next_cursor` (as `me/blocks` does), so the
 * page is read with it. Reported to the API owner to add `meta` to the document.
 */
export type SecurityEventsPage = { data: SecurityEvent[]; meta: { next_cursor?: string | null } };

async function fetchSecurityEvents(cursor: string | null, signal: AbortSignal): Promise<SecurityEventsPage> {
  const page = await apiData(
    api.GET('/me/security-events', { params: { query: { per_page: SECURITY_EVENTS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }),
  );
  const meta = (page as { meta?: { next_cursor?: string | null } }).meta ?? {};
  return { data: page.data, meta };
}

/** SET-21: newest first, 12 months. Never stored on the device (who signed in where stays off the disk). */
export function useSecurityEvents() {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useInfiniteQuery({
    queryKey: securityEventsKey,
    queryFn: ({ pageParam, signal }) => fetchSecurityEvents(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: signedIn,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/**
 * "Das war ich nicht" in SET-21 (`POST me/security/secure`): `eventId` names the row that was not the member. The key stays the same
 * through retries of one press, so a lost answer never opens a second support request.
 */
export function useSecureAccount() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    mutationFn: async ({ eventId, idempotencyKey }: { eventId: string | null; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/me/security/secure', {
            body: eventId ? { security_event_id: eventId } : {},
            ...withIdempotency(idempotencyKey),
          }),
        )
      ).data,
  });
}

export { newIdempotencyKey };

/** The token of the alert link: `<event ULID>.<proof>`; anything else is no token (SecureAccountLinks on the server). */
export const SECURE_TOKEN_SHAPE = /^[0-9A-Za-z]{26}\.[A-Za-z0-9_-]{16,128}$/;

/** `#t=…` of the address bar (web): the token travels in the fragment only (ADR-138), never to a log. */
export function secureTokenFromHash(hash: string): string | null {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  const all = values.getAll('t');
  const token = all.length === 1 ? all[0] : undefined;
  return token && SECURE_TOKEN_SHAPE.test(token) ? token : null;
}

/** "Das war ich nicht" from the alert mail (`POST auth/secure-account`): no session needed. Invalid, used or expired: 422 on `token`. */
export function useSecureAccountByLink() {
  return useMutation({
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    mutationFn: async (token: string) =>
      (await withFreshCsrf(() => apiData(api.POST('/auth/secure-account', { body: { token } })))).data,
  });
}
