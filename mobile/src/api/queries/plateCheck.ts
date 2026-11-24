/**
 * M5.9a "Kennzeichen prüfen" (contract docs/reports/phase-5/m5.9a-contract.md §3, §4; handover m5.9a-api-handover.md): the
 * member's own photos from before the plate blur existed, one decision each, and the one-time "Später". Typed by the generated
 * schema (`PlateCheckItemResource`, `PlateBlurState`).
 */
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { api, apiData } from '@/api/client';
import { garageKeys, type GarageMedia } from '@/api/queries/garage';
import { myVehiclesKey } from '@/api/queries/profile';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components, operations } from '@/api/schema';
import type { BlurRegion } from '@/features/garage/blur';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

/** `media.plate_blur`, on the owner's own media only (`photo.plate_blur?.state`). */
export type PlateBlurState = components['schemas']['PlateBlurState'];
export type MediaPlateBlur = { state: PlateBlurState };

/** One unchecked photo. `image.thumbhash` is null for member uploads: the placeholder is `thumbhash ?? blurhash`. */
export type PlateCheckItem = components['schemas']['PlateCheckItemResource'];
export type PlateCheckKind = PlateCheckItem['kind'];

/** `GET /api/v1/me/plate-check`: cursor list (25) with `links` and Laravel's cursor `meta` plus `count` (all unchecked) and `dismissed`. */
export type PlateCheckPage = operations['v1.me.plate-check.index']['responses'][200]['content']['application/json'];

export type PlateCheckDecision = components['schemas']['PlateCheckDecisionRequest'];

export const PLATE_CHECK_PAGE_SIZE = 25;

export const plateCheckKeys = {
  all: ['plate-check'] as const,
};

type Pages = InfiniteData<PlateCheckPage, string | null>;

/** The pages the sheet lists, and the card's numbers (`meta` of the first page). */
export function usePlateCheck(enabled: boolean = true) {
  const signedIn = useSessionStore(selectMayReadOwned);
  return useInfiniteQuery({
    queryKey: plateCheckKeys.all,
    queryFn: ({ pageParam, signal }) =>
      apiData(
        api.GET('/me/plate-check', {
          params: { query: { per_page: PLATE_CHECK_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: signedIn && enabled,
    retry: retryUnlessAnswered,
    // The card is a quiet prompt: it does not chase focus or the network.
    staleTime: 5 * 60_000,
  });
}

/** The card shows while there is something to check and the member has not said "Später" (contract §4). */
export function plateCheckOpen(pages: InfiniteData<PlateCheckPage, unknown> | undefined): boolean {
  const meta = pages?.pages[0]?.meta;
  return meta !== undefined && meta.count > 0 && !meta.dismissed;
}

export function plateCheckCount(pages: InfiniteData<PlateCheckPage, unknown> | undefined): number {
  return pages?.pages[0]?.meta.count ?? 0;
}

/** Takes one photo out of the cached list, and one off the count: it has been decided. */
function withoutItem(pages: Pages | undefined, mediaId: string): Pages | undefined {
  if (!pages) return pages;
  const had = pages.pages.some((page) => page.data.some((item) => item.media_id === mediaId));
  if (!had) return pages;
  return {
    ...pages,
    pages: pages.pages.map((page, index) => ({
      ...page,
      data: page.data.filter((item) => item.media_id !== mediaId),
      meta: index === 0 ? { ...page.meta, count: Math.max(0, page.meta.count - 1) } : page.meta,
    })),
  };
}

function withDismissed(pages: Pages | undefined): Pages | undefined {
  if (!pages) return pages;
  return { ...pages, pages: pages.pages.map((page) => ({ ...page, meta: { ...page.meta, dismissed: true } })) };
}

type Snapshot = { before: Pages | undefined };

async function optimistic(client: QueryClient, update: (pages: Pages | undefined) => Pages | undefined): Promise<Snapshot> {
  await client.cancelQueries({ queryKey: plateCheckKeys.all });
  const before = client.getQueryData<Pages>(plateCheckKeys.all);
  client.setQueryData<Pages>(plateCheckKeys.all, update(before));
  return { before };
}

/** "Kein Kennzeichen sichtbar": `POST me/plate-check/{media}` `{decision: 'keep'}` → `declined` (204, idempotent). Optimistic. */
export function useKeepPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mediaId: string) => {
      const body: PlateCheckDecision = { decision: 'keep' };
      await apiData(api.POST('/me/plate-check/{media}', { params: { path: { media: mediaId } }, body }));
    },
    onMutate: (mediaId) => optimistic(client, (pages) => withoutItem(pages, mediaId)),
    onError: (_error, _mediaId, context) => {
      if (context) client.setQueryData(plateCheckKeys.all, context.before);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: plateCheckKeys.all }),
  });
}

/** "Später": `POST me/plate-check/dismiss` (204). The card goes at once, for good. */
export function useDismissPlateCheck() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiData(api.POST('/me/plate-check/dismiss'));
    },
    onMutate: () => optimistic(client, withDismissed),
    onError: (_error, _variables, context) => {
      if (context) client.setQueryData(plateCheckKeys.all, context.before);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: plateCheckKeys.all }),
  });
}

/**
 * "Unkenntlich machen" from the check: GAR-08's `PATCH media/{id}` with `blur_regions` (contract §4: lane B extends it to
 * build-update photos and the cover). The photo leaves the list once the server took it; the garage reads again, since its
 * variants are being redrawn.
 */
export function useBlurCheckedPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, regions }: { item: PlateCheckItem; regions: readonly BlurRegion[] }): Promise<GarageMedia> =>
      (
        await apiData(
          api.PATCH('/media/{media}', { params: { path: { media: item.media_id } }, body: { blur_regions: regions.map((region) => ({ ...region })) } }),
        )
      ).data,
    onSuccess: (_media, { item }) => {
      client.setQueryData<Pages>(plateCheckKeys.all, (pages) => withoutItem(pages, item.media_id));
      void client.invalidateQueries({ queryKey: plateCheckKeys.all });
      if (item.vehicle) void client.invalidateQueries({ queryKey: garageKeys.vehicle(item.vehicle.id) });
      void client.invalidateQueries({ queryKey: myVehiclesKey });
    },
  });
}
