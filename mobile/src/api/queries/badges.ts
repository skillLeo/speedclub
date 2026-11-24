/**
 * M5.9d badges (contract docs/reports/phase-5/m5.9d-contract.md §2, ADR-508): every active badge for the member with `earned_at`,
 * hidden ones as "???" with a hint until earned; another member's earned badges; the unlock events behind the one toast per app
 * start (`?unseen=1`, then `POST me/badges/seen`). Fixed rules on the server, never random; the app only shows what it gets.
 *
 * Calls through the generated client (`BadgeResource`, handover m5.9d-api-handover.md): `{data: Badge[]}` around every list, the seen
 * call's body `{keys: string[]}` (204), `?unseen=1`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData, withIdempotency } from '@/api/client';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

import { fromGiftQa, giftQa } from './giftQa';
import { retryUnlessAnswered, usePublicViewer } from './vehicles';

export const BADGE_CATEGORIES = ['garage', 'mods', 'spotting', 'sets', 'treffen', 'forum', 'sticker', 'founding', 'community'] as const;
export type BadgeCategory = (typeof BADGE_CATEGORIES)[number];

/** Contract §2 tier: bronze/silver/gold or 1–3, read as 1–3. */
export type BadgeTier = 1 | 2 | 3;

export type Badge = {
  key: string;
  /** A hidden badge not earned yet: name and description stay null, the hint is all there is ("???"). */
  hidden: boolean;
  name: string | null;
  description: string | null;
  hint: string | null;
  tier: BadgeTier | null;
  category: BadgeCategory | null;
  earned_at: string | null;
  sort: number;
};


const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

export const badgeKeys = {
  all: ['badges'] as const,
  mine: (language: string) => ['badges', 'me', language] as const,
  unseen: (language: string) => ['badges', 'me', 'unseen', language] as const,
  member: (username: string, viewer: string) => ['badges', 'member', username, viewer] as const,
};

function tierOf(value: unknown): BadgeTier | null {
  if (value === 1 || value === 'bronze') return 1;
  if (value === 2 || value === 'silver') return 2;
  if (value === 3 || value === 'gold') return 3;
  return null;
}

export function parseBadge(value: unknown): Badge | null {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key === '') return null;
  const earnedAt = typeof value.earned_at === 'string' ? value.earned_at : null;
  const name = text(value.name);
  const hidden = value.hidden === true && earnedAt === null;
  // An earned badge always has its name; a visible one without a name is not one the app can show.
  if (!hidden && name === null) return null;
  const category = (BADGE_CATEGORIES as readonly string[]).includes(String(value.category)) ? (value.category as BadgeCategory) : null;
  return {
    key: value.key,
    hidden,
    name: hidden ? null : name,
    description: hidden ? null : text(value.description),
    hint: text(value.hint),
    tier: tierOf(value.tier),
    category,
    earned_at: earnedAt,
    sort: typeof value.sort === 'number' ? value.sort : 0,
  };
}

export function parseBadges(body: unknown): Badge[] {
  const list = isRecord(body) && 'data' in body ? body.data : body;
  return (Array.isArray(list) ? list : []).map(parseBadge).filter((badge): badge is Badge => badge !== null);
}

/** Earned first (newest first), then the rest in the server's order; hidden "???" last. */
export function orderBadges(badges: readonly Badge[]): Badge[] {
  const rank = (badge: Badge) => (badge.earned_at ? 0 : badge.hidden ? 2 : 1);
  return [...badges].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.earned_at && b.earned_at) return b.earned_at.localeCompare(a.earned_at);
    return a.sort - b.sort;
  });
}

/** What another member's profile may show: earned badges only (the public endpoint sends only these; the app filters again). */
export function publicBadges(badges: readonly Badge[]): Badge[] {
  return orderBadges(badges.filter((badge) => badge.earned_at !== null && !badge.hidden));
}

async function getMyBadges(unseen: boolean, signal?: AbortSignal): Promise<Badge[]> {
  return parseBadges(await apiData(api.GET('/me/badges', { params: { query: unseen ? { unseen: '1' } : {} }, signal })));
}

async function getMemberBadges(username: string, signal?: AbortSignal): Promise<Badge[]> {
  return parseBadges(await apiData(api.GET('/users/{username}/badges', { params: { path: { username } }, signal })));
}

/** `GET me/badges`: every active badge, earned or not. */
export function useMyBadges(enabled: boolean = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const { i18n } = useTranslation();
  const sample = giftQa() !== null;
  return useQuery({
    queryKey: [...badgeKeys.mine(i18n.language), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) => (sample ? fromGiftQa((source) => source.badges()) : getMyBadges(false, signal)),
    enabled: signedIn && enabled,
    retry: sample ? false : retryUnlessAnswered,
    staleTime: 60_000,
  });
}

/** `GET users/{username}/badges`: another member's earned badges. */
export function useMemberBadges(username: string | undefined, enabled: boolean = true) {
  const viewer = usePublicViewer();
  const sample = giftQa() !== null;
  const name = username ?? '';
  return useQuery({
    queryKey: [...badgeKeys.member(name, viewer), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) =>
      sample ? fromGiftQa((source) => source.memberBadges(name)) : getMemberBadges(name, signal),
    enabled: enabled && name !== '',
    retry: sample ? false : retryUnlessAnswered,
    staleTime: 5 * 60_000,
  });
}

/** `GET me/badges?unseen=1`: badges earned since the member last saw an unlock. Read once per app start (BadgeUnlock). */
export function useUnseenBadges(enabled: boolean) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const { i18n } = useTranslation();
  const sample = giftQa() !== null;
  return useQuery({
    queryKey: [...badgeKeys.unseen(i18n.language), sample ? 'qa' : 'live'],
    queryFn: ({ signal }) => (sample ? fromGiftQa((source) => source.unseen()) : getMyBadges(true, signal)),
    enabled: signedIn && enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** `POST me/badges/seen` `{keys}`: the toast has shown them; they never come again. Nothing is sent in QA. */
export function useMarkBadgesSeen() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (keys: readonly string[]) => {
      if (giftQa() !== null || keys.length === 0) return;
      await apiData(api.POST('/me/badges/seen', { body: { keys: [...keys] }, ...withIdempotency() }));
    },
    // The full list reads again when next shown (its unlock dates are new); the unseen read is done for this app start.
    onSettled: () =>
      void client.invalidateQueries({ queryKey: badgeKeys.all, refetchType: 'none', predicate: (query) => query.queryKey[2] !== 'unseen' }),
  });
}
