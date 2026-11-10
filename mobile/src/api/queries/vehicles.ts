/**
 * Public vehicle reads (VEH-01 to VEH-05; docs/reports/phase-1/m1.6-api-handover.md). Guests, members and the owner read
 * the same routes: the API renders per viewer (language, power setting, owner-only values, `is_owner`), so the viewer and
 * the language are part of every key. The owner also reads a private or draft vehicle here, which is what GAR-02 builds on.
 *
 * Every hidden vehicle answers one 404 `vehicle_unavailable` (ADR-141): the screens show one calm state and no reason.
 */
import { hashKey, useInfiniteQuery, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData, ApiError } from '@/api/client';
import i18n from '@/i18n';
import { queryClient } from '@/api/queryClient';
import type { components } from '@/api/schema';
import { useSessionStore } from '@/state/session';

export type PublicVehicle = components['schemas']['PublicVehicleResource'];
export type PublicModRow = components['schemas']['ModificationRowResource'];
export type PublicMod = components['schemas']['ModificationResource'];
export type BuildUpdate = components['schemas']['BuildUpdateResource'];
export type VehicleMedia = components['schemas']['MediaResource'];
export type MediaCategory = components['schemas']['MediaCategory'];
export type VehicleOwner = components['schemas']['MemberProfileResource'];
export type SpecGroup = PublicVehicle['spec_groups'][number];
export type ModGroup = PublicVehicle['mods']['groups'][number];

/** Verlauf beyond the 20 entries the page carries. The API allows 30 per page (ADR-146). */
export const UPDATES_PAGE_SIZE = 30;

/**
 * The 8-character public id at the end of a slug. Only it identifies the vehicle (§3.2): a renamed slug keeps its cache,
 * and the API answers an old text part with a 301 to the canonical one.
 */
export function publicIdOf(slug: string): string {
  return (slug.trim().toLowerCase().split('-').pop() ?? '').slice(-8);
}

/** Member id or `guest`, plus the language the API renders in. */
export function usePublicViewer(): string {
  const { i18n } = useTranslation();
  const member = useSessionStore((state) => (state.status === 'member' ? state.member?.id : null));
  return `${member ?? 'guest'}|${i18n.language}`;
}

/** The same viewer outside React: a stored action that runs after sign-in reads with the member who is signed in then. */
export function publicViewerNow(): string {
  const { status, member } = useSessionStore.getState();
  return `${status === 'member' ? (member?.id ?? 'guest') : 'guest'}|${i18n.language}`;
}

export const vehicleKeys = {
  /** Everything of one vehicle, for every viewer: invalidate this after an owner edit. */
  of: (slug: string) => ['public-vehicle', publicIdOf(slug)] as const,
  page: (slug: string, viewer: string) => ['public-vehicle', publicIdOf(slug), viewer, 'page'] as const,
  mod: (slug: string, viewer: string, modId: string) => ['public-vehicle', publicIdOf(slug), viewer, 'mod', modId] as const,
  update: (slug: string, viewer: string, updateId: string) =>
    ['public-vehicle', publicIdOf(slug), viewer, 'update', updateId] as const,
  updates: (slug: string, viewer: string) => ['public-vehicle', publicIdOf(slug), viewer, 'updates'] as const,
};

/** GAR-* call this after a change, so VEH-01 shows it the next time it is focused. */
export function invalidatePublicVehicle(slug: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: vehicleKeys.of(slug) });
}

/** The vehicle is hidden for this viewer, for whatever reason (ADR-141). Also on every sub-route. */
export function isVehicleUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'vehicle_unavailable';
}

/** A mod or Verlauf entry of a visible vehicle that does not exist (any more), or a hidden entry. */
export function isEntryNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code !== 'vehicle_unavailable';
}

/** A 4xx is an answer, and a retry cannot change it. A rate limit is retried by the user, with the button. */
export function retryUnlessAnswered(failures: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;
}

/**
 * A vehicle that turned hidden leaves nothing behind (ADR-141, ADR-148): every other copy of it, for any viewer and any
 * sub-route, is dropped, so neither a later offline read nor a sub-route's head start shows it. The query that heard the
 * 404 keeps its old data in memory only: its route state is unavailable from now on (features/vehicle/states.tsx), and the
 * persister never stores a query in error. Removing that query too would only make its screen ask once more.
 */
export async function readVisibleVehicle<T>(
  context: { client: QueryClient; queryKey: QueryKey },
  slug: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isVehicleUnavailable(error)) {
      const heardBy = hashKey(context.queryKey);
      context.client.removeQueries({ queryKey: vehicleKeys.of(slug), predicate: (query) => query.queryHash !== heardBy });
    }
    throw error;
  }
}

async function fetchPublicVehicle(slug: string, signal?: AbortSignal) {
  return (await apiData(api.GET('/public/vehicles/{slug}', { params: { path: { slug } }, signal }))).data;
}

/**
 * The page as the viewer signed in now sees it, fresh when the cache is stale: for an action a guest asked for, which runs after
 * sign-in and must not act on the guest's copy (a save of your own build would only fail).
 */
export function readPublicVehicleNow(client: QueryClient, slug: string): Promise<PublicVehicle> {
  return client.fetchQuery({
    queryKey: vehicleKeys.page(slug, publicViewerNow()),
    queryFn: (context) => readVisibleVehicle(context, slug, () => fetchPublicVehicle(slug, context.signal)),
  });
}

/** VEH-01, VEH-03, VEH-04 and GAR-02. Kept for offline reads like every query. */
export function usePublicVehicle(slug: string | undefined) {
  const viewer = usePublicViewer();
  const value = slug ?? '';
  return useQuery({
    queryKey: vehicleKeys.page(value, viewer),
    queryFn: async (context) =>
      readVisibleVehicle(context, value, () => fetchPublicVehicle(value, context.signal)),
    enabled: value !== '',
    retry: retryUnlessAnswered,
  });
}

/**
 * The cached page of a vehicle, for sub-routes that can show part of it before their own answer arrives. A read of the
 * cache, not a subscription: the sub-route's own query decides what follows. A page the server has since hidden is no head
 * start (ADR-141).
 */
export function useCachedPublicVehicle(slug: string | undefined): PublicVehicle | undefined {
  const viewer = usePublicViewer();
  const client = useQueryClient();
  if (!slug) return undefined;
  const state = client.getQueryState<PublicVehicle>(vehicleKeys.page(slug, viewer));
  return state && !isVehicleUnavailable(state.error) ? state.data : undefined;
}

/** VEH-02: category spec table, photos and the disclaimer. */
export function usePublicMod(slug: string | undefined, modId: string | undefined) {
  const viewer = usePublicViewer();
  const vehicle = slug ?? '';
  const mod = modId ?? '';
  return useQuery({
    queryKey: vehicleKeys.mod(vehicle, viewer, mod),
    queryFn: async (context) =>
      readVisibleVehicle(context, vehicle, async () =>
        (
          await apiData(
            api.GET('/public/vehicles/{slug}/mods/{modification}', {
              params: { path: { slug: vehicle, modification: mod } },
              signal: context.signal,
            }),
          )
        ).data,
      ),
    enabled: vehicle !== '' && mod !== '',
    retry: retryUnlessAnswered,
  });
}

/** VEH-05: the only route with every change and its `details`. */
export function usePublicUpdate(slug: string | undefined, updateId: string | undefined) {
  const viewer = usePublicViewer();
  const vehicle = slug ?? '';
  const update = updateId ?? '';
  return useQuery({
    queryKey: vehicleKeys.update(vehicle, viewer, update),
    queryFn: async (context) =>
      readVisibleVehicle(context, vehicle, async () =>
        (
          await apiData(
            api.GET('/public/vehicles/{slug}/updates/{update}', { params: { path: { slug: vehicle, update } }, signal: context.signal }),
          )
        ).data,
      ),
    enabled: vehicle !== '' && update !== '',
    retry: retryUnlessAnswered,
  });
}

/**
 * Verlauf beyond the page's latest 20, newest first, page by page. Only starts when the member asks for older entries;
 * its first page repeats what the page carries, which the screen merges by id.
 */
export function usePublicVehicleUpdates(slug: string | undefined, enabled: boolean) {
  const viewer = usePublicViewer();
  const vehicle = slug ?? '';
  return useInfiniteQuery({
    queryKey: vehicleKeys.updates(vehicle, viewer),
    queryFn: async (context) =>
      readVisibleVehicle(context, vehicle, async () =>
        apiData(
          api.GET('/public/vehicles/{slug}/updates', {
            params: {
              path: { slug: vehicle },
              query: { per_page: UPDATES_PAGE_SIZE, ...(context.pageParam ? { cursor: context.pageParam } : {}) },
            },
            signal: context.signal,
          }),
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && vehicle !== '',
    retry: retryUnlessAnswered,
    // A long history is read again when needed, not restored on the next launch.
    meta: { persist: false },
  });
}
