/**
 * Entdecken (m1.8 and m2.3 API handovers): DISC-01's page (make tiles, Kollektionen, Beliebte Mods, [SIG] members with similar
 * cars), the make page DISC-03, the model collection DISC-04 with its builds and wheel-setup comparison, and VEH-01's
 * [SIG] similar builds. Text tiles only (03 §6, no manufacturer marks); every count is the real number of builds this viewer
 * can find, blocks taken out.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import { retryUnlessAnswered, usePublicViewer } from '@/api/queries/vehicles';
import type { components, operations } from '@/api/schema';

export type MakeTile = components['schemas']['MakeTileResource'];
export type DiscoverCollection = components['schemas']['CollectionResource'];
export type MakePage = components['schemas']['MakePageResource'];
export type ModelCount = components['schemas']['ModelCountResource'];
export type GenerationCount = components['schemas']['GenerationCountResource'];
export type ModelPage = components['schemas']['ModelPageResource'];
export type WheelSetup = components['schemas']['WheelSetupResource'];
export type ModelBuildsSort = NonNullable<NonNullable<NonNullable<operations['v1.discover.models.builds']['parameters']['query']>['sort']>>;

/** Per page of the model's builds and of the wheel table; the API allows 1 to 50. */
export const MODEL_PAGE_SIZE = 20;

export const discoverKeys = {
  all: ['discover'] as const,
  page: (viewer: string) => ['discover', viewer] as const,
  make: (viewer: string, make: string) => ['discover', viewer, 'make', make] as const,
  model: (viewer: string, model: string) => ['discover', viewer, 'model', model] as const,
  builds: (viewer: string, model: string, generation: string, sort: string) => ['discover', viewer, 'model', model, 'builds', generation, sort] as const,
  wheels: (viewer: string, model: string, generation: string) => ['discover', viewer, 'model', model, 'wheels', generation] as const,
  similar: (viewer: string, vehicleId: string) => ['discover', viewer, 'similar', vehicleId] as const,
};

export function useDiscover() {
  const viewer = usePublicViewer();
  return useQuery({
    queryKey: discoverKeys.page(viewer),
    queryFn: async ({ signal }) => (await apiData(api.GET('/discover', { signal }))).data,
    retry: retryUnlessAnswered,
  });
}

/** DISC-03: the make with its models and their generations, each with its real count. 404 `not_found` without a visible build. */
/** The canonical slug or key a page answered with, when it differs from the one asked (a merged entry's 301); else null. */
export function canonicalMove(asked: string, served: string | undefined): string | null {
  if (!asked || !served) return null;
  return served.toLowerCase() === asked.toLowerCase() ? null : served;
}

export function useMakePage(make: string) {
  const viewer = usePublicViewer();
  const client = useQueryClient();
  return useQuery({
    queryKey: discoverKeys.make(viewer, make),
    queryFn: async ({ signal }) => {
      const page = (await apiData(api.GET('/discover/makes/{make}', { params: { path: { make } }, signal }))).data;
      // M3.3 (ADR-234): a merged make's slug answers 301 to its survivor, which fetch follows. The page is also the survivor's, so
      // DISC-03 can move its route to the canonical slug without loading it again.
      if (page.make.slug !== make) client.setQueryData(discoverKeys.make(viewer, page.make.slug), page);
      return page;
    },
    enabled: make !== '',
    retry: retryUnlessAnswered,
  });
}

/** DISC-04's header: model, make and generations with counts. `model` is the composite key `bmw--m4` (handover §1). */
export function useModelPage(model: string) {
  const viewer = usePublicViewer();
  const client = useQueryClient();
  return useQuery({
    queryKey: discoverKeys.model(viewer, model),
    queryFn: async ({ signal }) => {
      const page = (await apiData(api.GET('/discover/models/{model}', { params: { path: { model } }, signal }))).data;
      // M3.3 (ADR-234): as for a make, the 301 of a merged model lands on the survivor, cached under its key for DISC-04's new route.
      if (page.model.key !== model) client.setQueryData(discoverKeys.model(viewer, page.model.key), page);
      return page;
    },
    enabled: model !== '',
    retry: retryUnlessAnswered,
  });
}

/** DISC-04 Builds: feed cards of the model, of one generation or all, newest first by default. */
export function useModelBuilds(model: string, generation: string | null, sort: ModelBuildsSort | null, enabled: boolean) {
  const viewer = usePublicViewer();
  return useInfiniteQuery({
    queryKey: discoverKeys.builds(viewer, model, generation ?? '', sort ?? ''),
    queryFn: ({ pageParam, signal }) =>
      apiData(
        api.GET('/discover/models/{model}/builds', {
          params: {
            path: { model },
            query: { ...(generation ? { generation } : {}), ...(sort ? { sort } : {}), per_page: MODEL_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && model !== '',
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/** DISC-04 Räder-Vergleich: one row per build with an installed wheel set, newest change first. */
export function useWheelSetups(model: string, generation: string | null, enabled: boolean) {
  const viewer = usePublicViewer();
  return useInfiniteQuery({
    queryKey: discoverKeys.wheels(viewer, model, generation ?? ''),
    queryFn: ({ pageParam, signal }) =>
      apiData(
        api.GET('/discover/models/{model}/wheel-setups', {
          params: {
            path: { model },
            query: { ...(generation ? { generation } : {}), per_page: MODEL_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: enabled && model !== '',
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/**
 * VEH-01 [SIG `sig.similar_builds`]: up to eight similar public builds. Asked only while the flag is on; the route answers 404
 * `feature_disabled` otherwise, and any failure simply leaves the strip out.
 */
export function useSimilarBuilds(vehicleId: string, enabled: boolean) {
  const viewer = usePublicViewer();
  return useQuery({
    queryKey: discoverKeys.similar(viewer, vehicleId),
    queryFn: async ({ signal }) => (await apiData(api.GET('/vehicles/{id}/similar', { params: { path: { id: vehicleId } }, signal }))).data,
    enabled: enabled && vehicleId !== '',
    retry: retryUnlessAnswered,
    // An optional strip: it reads on mount and after an invalidation only, so a deleted build (still on screen under GAR-05) is not
    // asked again on a window focus or a reconnect (code review nit 1).
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { persist: false },
  });
}
