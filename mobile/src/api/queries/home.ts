/**
 * HOME-01 (FS-2): the featured builds, Neue Builds, the Home modules and the two streams (docs/reports/phase-1/m1.8-api-handover.md,
 * docs/reports/phase-2/m2.2-contract.md). Every list renders per viewer (blocks, power setting, the owner's own name when "Besitzer
 * zeigen" is off) and per language, so the viewer is part of every key.
 */
import { useQuery } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { retryUnlessAnswered, usePublicViewer } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { useSessionStore } from '@/state/session';

import { flattenPages, useSeamedList } from './seamedList';

export type FeedVehicle = components['schemas']['FeedVehicleResource'];
export type FeaturedBuild = components['schemas']['FeaturedBuildResource'];
export type FeedOwner = components['schemas']['MemberSummaryResource'];

/** One page of Neue Builds; the API allows 1 to 50. */
export const NEW_BUILDS_PAGE_SIZE = 20;

export const homeKeys = {
  all: ['home'] as const,
  featured: (viewer: string) => ['home', viewer, 'featured'] as const,
  newBuilds: (viewer: string) => ['home', viewer, 'new-builds'] as const,
  // Own keys below `newBuilds`, which still invalidates both. "first" is not the infinite query's old key, so a cache
  // stored by an earlier build in that shape is never read as a single page.
  newBuildsFirst: (viewer: string) => ['home', viewer, 'new-builds', 'first'] as const,
  newBuildsMore: (viewer: string) => ['home', viewer, 'new-builds', 'more'] as const,
  /** The two cards of the Neue Builds module (FS-2). */
  newBuildsPreview: (viewer: string) => ['home', viewer, 'new-builds', 'preview'] as const,
  modules: (viewer: string) => ['home', viewer, 'modules'] as const,
  feed: (viewer: string, tab: FeedTab) => ['home', viewer, 'feed', tab] as const,
  feedFirst: (viewer: string, tab: FeedTab) => ['home', viewer, 'feed', tab, 'first'] as const,
  feedMore: (viewer: string, tab: FeedTab) => ['home', viewer, 'feed', tab, 'more'] as const,
};

/** FS-2: the segmented control of Start. */
export type FeedTab = 'for_you' | 'following';

/** At most three, each with a photo and a different owner. Empty while no public build exists: the hero hides. */
export function useFeaturedBuilds() {
  const viewer = usePublicViewer();
  return useQuery({
    queryKey: homeKeys.featured(viewer),
    queryFn: async ({ signal }) => (await apiData(api.GET('/home/featured', { signal }))).data,
    retry: retryUnlessAnswered,
  });
}

function fetchNewBuilds(cursor: string | null, signal: AbortSignal, perPage: number = NEW_BUILDS_PAGE_SIZE) {
  return apiData(
    api.GET('/home/new-builds', {
      params: { query: { per_page: perPage, ...(cursor ? { cursor } : {}) } },
      signal,
    }),
  );
}

const vehicleId = (vehicle: FeedVehicle) => vehicle.id;

/** Public builds, most recently published or changed first, page by page (ADR-155 g, BH-42: `useSeamedList`). */
export function useNewBuilds() {
  const viewer = usePublicViewer();
  return useSeamedList({
    headKey: homeKeys.newBuildsFirst(viewer),
    tailKey: homeKeys.newBuildsMore(viewer),
    fetchPage: fetchNewBuilds,
    idOf: vehicleId,
  });
}

/** The pages as one list. A build that moved up between two pages would come twice: the first place wins. */
export function flattenBuilds(pages: readonly { data: readonly FeedVehicle[] }[] | undefined): FeedVehicle[] {
  return flattenPages(pages, vehicleId);
}

/** 09 §7.3 "Neu in der Garage": a rail of 8 and "Alle". One more is read, for when the lead build is one of them. Stored for an offline start. */
export const NEW_BUILDS_PREVIEW = 8;

export function useNewBuildsPreview() {
  const viewer = usePublicViewer();
  return useQuery({
    queryKey: homeKeys.newBuildsPreview(viewer),
    queryFn: async ({ signal }) => (await fetchNewBuilds(null, signal, NEW_BUILDS_PREVIEW + 1)).data,
    retry: retryUnlessAnswered,
  });
}

async function fetchModules(signal: AbortSignal) {
  return (await apiData(api.GET('/home/modules', { signal }))).data;
}

export type HomeModules = Awaited<ReturnType<typeof fetchModules>>;
export type BuildUpdateRowData = HomeModules['build_updates'][number];
export type ActiveMember = HomeModules['active_members'][number];
export type PopularMod = HomeModules['popular_mods'][number];

/** Build-Updates (3), Aktive Mitglieder (≤ 12) and Beliebte Mods (≤ 12): one request, guests too. */
export function useHomeModules() {
  const viewer = usePublicViewer();
  return useQuery({
    queryKey: homeKeys.modules(viewer),
    queryFn: ({ signal }) => fetchModules(signal),
    retry: retryUnlessAnswered,
  });
}

/** One page of a stream; the API allows 1 to 30. */
export const FEED_PAGE_SIZE = 20;

function feedReader(tab: FeedTab) {
  return (cursor: string | null, signal: AbortSignal) =>
    apiData(api.GET('/feed', { params: { query: { tab, per_page: FEED_PAGE_SIZE, ...(cursor ? { cursor } : {}) } }, signal }));
}

const readForYou = feedReader('for_you');
const readFollowing = feedReader('following');

export type FeedPage = Awaited<ReturnType<typeof readForYou>>;
export type FeedItem = FeedPage['data'][number];
export type FeedSuggestion = NonNullable<NonNullable<FeedPage['meta']['suggestions']>[number]>;

export const feedItemKey = (item: FeedItem) => item.key;

/** 409 `feed_stale`: the Für dich cursor belongs to a ranking the server has replaced (ADR-195); the stream starts over. */
export function isFeedStale(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'feed_stale';
}

/**
 * Für dich (guests too) or Folge ich (members only: a guest is never asked, the screen shows the sign-in prompt). Both persist only
 * their first page and continue with pages that are never stored (ADR-155 g). Für dich is ranked once an hour on the server, so its
 * order holds while a member scrolls; Folge ich is newest first, and new items push the first page's end down (BH-42). `active`: the
 * segment is on screen; a stream already read stays in the cache while the other one is shown.
 */
export function useFeed(tab: FeedTab, active: boolean = true) {
  const viewer = usePublicViewer();
  const member = useSessionStore((state) => state.status === 'member');
  return useSeamedList({
    headKey: homeKeys.feedFirst(viewer, tab),
    tailKey: homeKeys.feedMore(viewer, tab),
    fetchPage: tab === 'for_you' ? readForYou : readFollowing,
    idOf: feedItemKey,
    isStaleCursor: isFeedStale,
    // Folge ich is read once the member opens it, not with every Start.
    enabled: active && (tab === 'for_you' || member),
  });
}

/** The pages of a stream as one list, each item once. */
export function flattenFeed(pages: readonly { data: readonly FeedItem[] }[] | undefined): FeedItem[] {
  return flattenPages(pages, feedItemKey);
}
