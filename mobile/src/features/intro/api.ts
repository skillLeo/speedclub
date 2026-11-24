/**
 * R4-1.4 INTRO-01…04: the server keeps whether an account has seen the introduction (`me.intro_seen_at`), so it shows once per
 * account and never again on another device. `POST /me/intro/seen` answers 204 and may be sent again (idempotent).
 */
import { useMutation } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import { meKey, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';

/**
 * Whether the introduction is still owed: only an explicit `null`. A server without the field (older than round 4) answers
 * `undefined`, and that member never gets the pages (treated as seen).
 */
export function introDue(me: Me | null | undefined): boolean {
  if (!me) return false;
  // An older cached answer can still lack the field despite the type: only an explicit null is due.
  return me.intro_seen_at === null;
}

export async function postIntroSeen(): Promise<void> {
  await apiData(api.POST('/me/intro/seen'));
}

/** Marks the cached member as having seen the pages, so the trigger never opens them twice while the request is under way. */
export function markIntroSeenLocally(at: string = new Date().toISOString()): void {
  queryClient.setQueryData<Me>(meKey, (me) => (me ? { ...me, intro_seen_at: at } : me));
}

/**
 * "Überspringen" or "Los geht's": the introduction is done for this account. Optimistic: the member moves on at once; should the
 * request fail (offline), the next start of the app owes the pages again, as the server still says so.
 */
export function useMarkIntroSeen() {
  return useMutation({
    mutationFn: postIntroSeen,
    // No rollback on an error: the pages stay closed for this session, and the server owes them again at the next start.
    onMutate: () => markIntroSeenLocally(),
  });
}
