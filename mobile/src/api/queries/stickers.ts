/**
 * Stickers (M5.4, 10 §2, ADR-504; server contract docs/reports/phase-5/m5.4-contract.md). STK-01 hub, STK-04 stats, STK-05 designer,
 * STK-06 order and STK-07 history read and write through these hooks; the downloads go through features/qr/stickerDownload.ts.
 *
 * Owner only: every read waits for a member session (as the QR hooks, BH-28). 4xx answers are answers and never retried.
 *
 * QA (never in production): `qaStickers=sample` answers the hub's weekly counts and the stats from the bundled, "Beispiel"-badged
 * set in features/qr/qaStickers.ts, so the matrix can capture a sticker with scans on a host whose demo cars have none. Designs,
 * previews and the Scan-Test stay real.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { qrCodeKey, qrListKey } from '@/api/queries/qr';
import type { components } from '@/api/schema';
import { qa } from '@/lib/qa';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type StickerCard = components['schemas']['StickerCardResource'];
/** `revision` (review MF-4) moves on every content write; PUT and restore send it back as `base_revision`. */
export type StickerDesign = components['schemas']['StickerDesignResource'];
export type StickerOptions = StickerDesign['options'];
export type StickerTemplateKey = components['schemas']['StickerTemplate'];
export type StickerTemplates = components['schemas']['StickerTemplatesResource'];
export type StickerTemplateInfo = StickerTemplates['templates'][number];
export type StickerPreview = components['schemas']['StickerPreviewResource'];
export type StickerOrderLink = components['schemas']['StickerOrderLinkResource'];
export type StickerClientScanTest = components['schemas']['StickerClientScanTest'];
export type StickerColourway = components['schemas']['StickerColourway'];

/** The stats with numbers as numbers (the generated schema types some counts as strings; the server sends integers). */
export type StickerStats = {
  days: readonly { date: string; count: number }[];
  total: number;
  total_30_days: number;
  this_week: number;
  last_week: number;
  first_scan_on: string | null;
  sources: { sticker_scan: number; link: number | null };
  milestones_reached: readonly number[];
  /** Only the QA set: shown with the "Beispiel" badge. */
  sample?: boolean;
};

export const stickersKey = ['stickers'] as const;
export const stickerTemplatesKey = ['stickers', 'templates'] as const;
export const myStickersKey = ['stickers', 'list'] as const;
export const stickerStatsKey = (vehicleId: string) => ['stickers', 'stats', vehicleId] as const;
export const stickerDesignKey = (vehicleId: string) => ['stickers', 'design', vehicleId] as const;
export const stickerVersionsKey = (vehicleId: string) => ['stickers', 'versions', vehicleId] as const;
/** The rendered preview of an unsaved state: the state itself is the key, so undo shows a cached drawing at once. */
export const stickerPreviewKey = (vehicleId: string, template: StickerTemplateKey, options: StickerOptions) =>
  ['stickers', 'preview', vehicleId, template, stableOptions(options)] as const;
/** A saved version's drawing; `updated_at` in the key, so an autosaved draft draws again. */
export const stickerSvgKey = (designId: string, updatedAt: string | null) => ['stickers', 'svg', designId, updatedAt ?? ''] as const;

/** Options in one fixed key order, for query keys and equality. */
export function stableOptions(options: StickerOptions): string {
  return JSON.stringify([
    options.size,
    options.colourway,
    options.material,
    options.qr,
    options.username,
    options.car_name,
    options.custom_line ?? null,
    options.mirrored,
  ]);
}

/** A 4xx is an answer: retrying cannot change it. */
const retryUnlessAnswered = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

function useSignedIn(): boolean {
  return useSessionStore(selectMayReadOwned);
}

// -- QA source (features/qr/qaStickers.ts registers it; never in production, where `qa` has no overrides)

type StickerQaSource = {
  stats: (vehicleId: string) => StickerStats;
  scansThisWeek: (vehicleId: string) => number;
};
let qaSource: StickerQaSource | null = null;

export function registerStickerQaSource(source: StickerQaSource): void {
  qaSource = source;
}

function qaSample(): StickerQaSource | null {
  return qa.stickers === 'sample' ? qaSource : null;
}

/** The server's counts, typed as numbers whatever the generated schema says. */
export function normaliseStats(raw: components['schemas']['StickerStatsResource']): StickerStats {
  return {
    days: raw.days.map((day) => ({ date: day.date, count: Number(day.count) || 0 })),
    total: Number(raw.total) || 0,
    total_30_days: Number(raw.total_30_days) || 0,
    this_week: Number(raw.this_week) || 0,
    last_week: Number(raw.last_week) || 0,
    first_scan_on: raw.first_scan_on,
    sources: {
      sticker_scan: Number(raw.sources.sticker_scan) || 0,
      link: raw.sources.link === null ? null : Number(raw.sources.link) || 0,
    },
    milestones_reached: raw.milestones_reached.map(Number),
  };
}

/** `persisted` arrives as a boolean although the schema says string. */
export function isPersisted(design: Pick<StickerDesign, 'persisted' | 'version'>): boolean {
  const value: unknown = design.persisted;
  return value === true || value === 'true' || value === '1' || design.version > 0;
}

// -- Reads

/** STK-05: the six templates, colourways, materials and limits. Changes with a deploy only. */
export function useStickerTemplates() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: stickerTemplatesKey,
    queryFn: async ({ signal }) => (await apiData(api.GET('/stickers/templates', { signal }))).data,
    enabled: signedIn,
    staleTime: 60 * 60 * 1000,
    retry: retryUnlessAnswered,
  });
}

/** STK-01: one card per published vehicle, main first. A member has at most 20; one page holds 30. */
export function useMyStickers() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: myStickersKey,
    queryFn: async ({ signal }) => {
      const cards = (await apiData(api.GET('/me/stickers', { signal }))).data;
      const sample = qaSample();
      return sample ? cards.map((card) => ({ ...card, scans_this_week: sample.scansThisWeek(card.vehicle.id) })) : cards;
    },
    enabled: signedIn,
    retry: retryUnlessAnswered,
  });
}

/** STK-04: 30 daily counts, totals, first scan, sources. 404 `feature_disabled` while `sig.qr_stats` is off. */
export function useStickerStats(vehicleId: string | undefined) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useQuery({
    queryKey: stickerStatsKey(id),
    queryFn: async ({ signal }): Promise<StickerStats> => {
      const sample = qaSample();
      if (sample) return sample.stats(id);
      const raw = (await apiData(api.GET('/vehicles/{vehicle}/sticker/stats', { params: { path: { vehicle: id } }, signal }))).data;
      return normaliseStats(raw);
    },
    enabled: signedIn && id !== '',
    staleTime: 5 * 60 * 1000,
    retry: retryUnlessAnswered,
  });
}

/** STK-05/06: the current version, or the unsaved default (`version: 0`). The hub's card stands in while it loads. */
export function useStickerDesign(vehicleId: string | undefined) {
  const signedIn = useSignedIn();
  const client = useQueryClient();
  const id = vehicleId ?? '';
  return useQuery<StickerDesign, Error, StickerDesign, ReturnType<typeof stickerDesignKey>>({
    queryKey: stickerDesignKey(id),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/vehicles/{vehicle}/sticker-design', { params: { path: { vehicle: id } }, signal }))).data,
    enabled: signedIn && id !== '',
    retry: retryUnlessAnswered,
    // The editor starts only from a fresh read (review MF-2): never from a copy cached before this device's last save.
    staleTime: 0,
    refetchOnMount: 'always',
    meta: { persist: false },
    placeholderData: (): StickerDesign | undefined =>
      client.getQueryData<StickerCard[]>(myStickersKey)?.find((card) => card.vehicle.id === id)?.design ?? undefined,
  });
}

/** The live preview of an unsaved state (writes nothing). The last drawing stays while the next one renders. */
export function useStickerPreview(
  vehicleId: string | undefined,
  state: { template: StickerTemplateKey; options: StickerOptions } | null,
) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useQuery({
    queryKey: state ? stickerPreviewKey(id, state.template, state.options) : ['stickers', 'preview', id, 'none'],
    queryFn: async ({ signal }) => {
      if (!state) throw new Error('no state');
      return (
        await apiData(
          api.POST('/vehicles/{vehicle}/sticker-design/preview', {
            params: { path: { vehicle: id } },
            body: { template: state.template, options: { ...state.options } },
            signal,
          }),
        )
      ).data;
    },
    enabled: signedIn && id !== '' && state !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
    meta: { persist: false },
    placeholderData: keepPreviousData,
    retry: retryUnlessAnswered,
  });
}

/**
 * STK-01 for a car without a saved design: the server's default (Classic with the member's defaults), drawn on its surface. Nothing is
 * stored; the hub shows what "Gestalten" will start from.
 */
export function useStickerDefaultPreview(vehicleId: string | undefined, enabled: boolean = true) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useQuery({
    queryKey: ['stickers', 'preview', id, 'default'] as const,
    queryFn: async ({ signal }) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/sticker-design/preview', {
            params: { path: { vehicle: id } },
            body: { template: 'classic', options: {} },
            signal,
          }),
        )
      ).data,
    enabled: signedIn && enabled && id !== '',
    staleTime: 10 * 60 * 1000,
    meta: { persist: false },
    retry: retryUnlessAnswered,
  });
}

/** A saved version's drawing (hub thumbnails, history), as SVG markup. */
export function useStickerSvg(designId: string | null | undefined, updatedAt: string | null | undefined) {
  const signedIn = useSignedIn();
  const id = designId ?? '';
  return useQuery({
    queryKey: stickerSvgKey(id, updatedAt ?? null),
    queryFn: async ({ signal }) =>
      apiData(api.GET('/sticker-designs/{design}/preview.svg', { params: { path: { design: id } }, parseAs: 'text', signal })),
    enabled: signedIn && id !== '',
    staleTime: Number.POSITIVE_INFINITY,
    // Many drawings (hub, history): kept in memory only, never in the persisted cache (localStorage on the web).
    meta: { persist: false },
    retry: retryUnlessAnswered,
  });
}

/** STK-07: every version, newest first (the validated ones and the open draft), 30 a page, by cursor (review SF-4). */
export function useStickerVersions(vehicleId: string | undefined) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useInfiniteQuery({
    queryKey: stickerVersionsKey(id),
    queryFn: async ({ signal, pageParam }) => {
      const page = await apiData(
        api.GET('/vehicles/{vehicle}/sticker-design/versions', {
          params: { path: { vehicle: id }, query: pageParam ? { cursor: pageParam } : {} },
          signal,
        }),
      );
      return { data: page.data as StickerDesign[], next: page.meta.next_cursor };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: signedIn && id !== '',
    retry: retryUnlessAnswered,
  });
}

// -- Writes

/** After a write: the design, the hub and the history show the new state; the QR screens learn about a design. */
export function settleDesign(client: QueryClient, vehicleId: string, design: StickerDesign): void {
  // Review SF-5: a read sent before this write must not land after it with the older copy. Cancelling reverts the entry at once
  // (synchronously), so the write below is what stays.
  void client.cancelQueries({ queryKey: stickerDesignKey(vehicleId) });
  client.setQueryData(stickerDesignKey(vehicleId), design);
  client.setQueryData<StickerCard[]>(myStickersKey, (cards) =>
    cards?.map((card) => (card.vehicle.id === vehicleId ? { ...card, design } : card)),
  );
  void client.invalidateQueries({ queryKey: myStickersKey });
  void client.invalidateQueries({ queryKey: stickerVersionsKey(vehicleId) });
}

export type SaveDesignInput = {
  baseVersion: number;
  baseRevision: number;
  template: StickerTemplateKey;
  options: StickerOptions;
};

type SaveDesignBody = components['schemas']['SaveStickerDesignRequest'];

/**
 * The autosave call (PUT, contract §3.1). 409 `edit_conflict`: another device saved in between (the version or the draft revision
 * moved). `keepalive` lets the browser finish it while the page is being left (review SF-2).
 */
export async function saveStickerDesign(vehicleId: string, input: SaveDesignInput, keepalive: boolean = false): Promise<StickerDesign> {
  const body: SaveDesignBody = {
    base_version: input.baseVersion,
    base_revision: input.baseRevision,
    template: input.template,
    options: { ...input.options },
  };
  return (
    await apiData(
      api.PUT('/vehicles/{vehicle}/sticker-design', {
        params: { path: { vehicle: vehicleId } },
        body,
        ...(keepalive ? { keepalive: true } : {}),
      }),
    )
  ).data;
}

/** The newest version from the server, for the conflict path: the editor reloads it (contract §3.1). */
export async function fetchStickerDesign(vehicleId: string): Promise<StickerDesign> {
  return (await apiData(api.GET('/vehicles/{vehicle}/sticker-design', { params: { path: { vehicle: vehicleId } } }))).data;
}

/** The Scan-Test of the current version (contract §4). The caller keeps one idempotency key per run. */
export function useValidateStickerDesign(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { version: number; clientScanTest: StickerClientScanTest; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/sticker-design/validate', {
            params: { path: { vehicle: vehicleId } },
            body: { version: input.version, client_scan_test: input.clientScanTest },
            ...withIdempotency(input.idempotencyKey),
          }),
        )
      ).data,
    onSuccess: (design) => settleDesign(client, vehicleId, design),
    onError: (error) => {
      // A failed test is stored on the draft; a replaced code changes the card.
      if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
        void client.invalidateQueries({ queryKey: stickerDesignKey(vehicleId) });
        void client.invalidateQueries({ queryKey: myStickersKey });
      }
    },
  });
}

/** STK-07 "Wiederherstellen": that version's template and options become the draft. */
export function useRestoreStickerVersion(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { version: number; baseRevision: number; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/sticker-design/versions/{version}/restore', {
            params: { path: { vehicle: vehicleId, version: input.version } },
            body: { base_revision: input.baseRevision },
            ...withIdempotency(input.idempotencyKey),
          }),
        )
      ).data,
    onSuccess: (design) => settleDesign(client, vehicleId, design),
  });
}

/** STK-06: the Shopify cart link with the design attached, or `available: false` ("Bestellung bald verfügbar"). */
export function useStickerOrderLink(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { designId: string; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/sticker-designs/{design}/order-link', {
            params: { path: { design: input.designId } },
            ...withIdempotency(input.idempotencyKey),
          }),
        )
      ).data,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: stickerDesignKey(vehicleId) });
      void client.invalidateQueries({ queryKey: myStickersKey });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: qrListKey });
        void client.invalidateQueries({ queryKey: qrCodeKey(vehicleId) });
      }
    },
  });
}
