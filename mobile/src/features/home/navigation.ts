import { useMutationState } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';

import type { FollowInput } from '@/api/queries/social';
import { useSessionStore } from '@/state/session';

/** PROF-02 inside the tab that opened it (`/u/[username]`, a shared route), or the own profile tab for yourself. */
export function memberPath(username: string, own: string | null | undefined): Href {
  return own && own.toLowerCase() === username.toLowerCase() ? '/profile' : `/u/${username}`;
}

export function useOpenMember(): (username: string) => void {
  const router = useRouter();
  const own = useSessionStore((state) => state.member?.username);
  return useCallback(
    (username: string) => {
      const path = memberPath(username, own);
      if (path === '/profile') router.navigate(path);
      else router.push(path);
    },
    [own, router],
  );
}

/** `/v/{slug}` or its Verlauf entry, inside the tab. */
export const vehiclePath = (slug: string): Href => `/v/${slug}`;
export const updatePath = (slug: string, updateId: string): Href => `/v/${slug}/updates/${updateId}`;

type FollowWrite = { username: string; follow: boolean; at: number; failed: boolean };

/**
 * The Home lists (Aktive Mitglieder, Folge ich suggestions) are their own queries, which `useFollow` does not edit. The follow state
 * the member last asked for wins over the list's copy until the list is read again: what the mutation cache holds, newest first, a
 * refused write left out (it turned back with its toast).
 */
export function useFollowState(): (username: string, listed: boolean) => boolean {
  const writes = useMutationState<FollowWrite | null>({
    filters: { predicate: (mutation) => String(mutation.options.scope?.id ?? '').startsWith('follow:') },
    select: (mutation) => {
      const input = mutation.state.variables as FollowInput | undefined;
      if (!input) return null;
      return { username: input.username.toLowerCase(), follow: input.follow, at: mutation.state.submittedAt, failed: mutation.state.status === 'error' };
    },
  });
  const latest = useMemo(() => {
    const map = new Map<string, boolean>();
    const sorted = writes.filter((write): write is FollowWrite => write !== null && !write.failed).sort((a, b) => a.at - b.at);
    for (const write of sorted) map.set(write.username, write.follow);
    return map;
  }, [writes]);
  return useCallback((username: string, listed: boolean) => latest.get(username.toLowerCase()) ?? listed, [latest]);
}
