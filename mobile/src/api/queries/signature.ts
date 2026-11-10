/**
 * M2.7 signature reads and writes (m2.7-api-handover): share cards (VEH-07), the plate and face blur (GAR-08) and the comparison
 * of two builds (VEH-06). Each route answers 404 `feature_disabled` while its flag is off; the screens hide their entry points
 * then, so that answer only reaches a stale link.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { File as CacheFile, Paths } from 'expo-file-system';

import { api, apiData, apiOrigin, ApiError, networkError, toApiError } from '@/api/client';
import { garageKeys, refreshVehicle, type GarageMedia, type GarageVehicle } from '@/api/queries/garage';
import { publicIdOf, retryUnlessAnswered, usePublicViewer, type PublicVehicle } from '@/api/queries/vehicles';
import type { BlurRegion } from '@/features/garage/blur';
import { nativeDownloadError, nativeHeaders } from '@/features/qr/download';
import { compareFromApi, isSameBuild, type CompareData } from '@/features/vehicle/compare';
import { isWeb } from '@/lib/platform';

// -- Share cards (VEH-07)

export type ShareCardFormat = 'story' | 'square';

export type ShareCard = {
  /**
   * What the preview shows and the share sends: the stored, immutable PNG (`share_card_url`), or a card drawn just now, held on
   * the device (a file in the cache on native, an object URL on web).
   */
  url: string;
  /** False for a card held on the device: it is shared as it is, without another download. */
  remote: boolean;
  fileName: string;
};

export const signatureKeys = {
  shareCard: (vehicleId: string, format: ShareCardFormat, viewer: string) => ['share-card', vehicleId, format, viewer] as const,
  compare: (a: string, b: string, viewer: string) => ['compare', publicIdOf(a), publicIdOf(b), viewer] as const,
};

type WithShareCard = { id: string; share_card_url: { story: string | null; square: string | null } | null };

/** The stored card of a build this device has read: its public page (any viewer) or the owner's garage copy. */
export function storedShareCardUrl(client: QueryClient, vehicleId: string, format: ShareCardFormat): string | null {
  const candidates: unknown[] = [
    client.getQueryData<GarageVehicle>(garageKeys.vehicle(vehicleId)),
    ...client.getQueriesData<PublicVehicle>({ queryKey: ['public-vehicle'] }).map(([, data]) => data),
  ];
  for (const data of candidates) {
    if (!data || typeof data !== 'object' || !('share_card_url' in data)) continue;
    const vehicle = data as WithShareCard;
    if (vehicle.id === vehicleId && vehicle.share_card_url?.[format]) return vehicle.share_card_url[format];
  }
  return null;
}

export function shareCardFileName(vehicleId: string, format: ShareCardFormat): string {
  return `speedclub-${vehicleId}-${format}.png`;
}

/** Draws the card at once (`GET vehicles/{id}/share-card.png`) and keeps it on the device. */
async function drawShareCard(vehicleId: string, format: ShareCardFormat, signal: AbortSignal): Promise<ShareCard> {
  const fileName = shareCardFileName(vehicleId, format);
  if (isWeb) {
    const result = await api.GET('/vehicles/{id}/share-card.png', { params: { path: { id: vehicleId }, query: { format } }, parseAs: 'blob', signal });
    if (!result.response.ok || !(result.data instanceof Blob)) throw toApiError(result.response, result.error);
    return { url: URL.createObjectURL(result.data), remote: false, fileName };
  }
  const query = new URLSearchParams({ format }).toString();
  const url = `${apiOrigin()}/api/v1/vehicles/${encodeURIComponent(vehicleId)}/share-card.png?${query}`;
  try {
    const target = new CacheFile(Paths.cache, fileName);
    const downloaded = await CacheFile.downloadFileAsync(url, target, { headers: await nativeHeaders(), idempotent: true, signal });
    return { url: downloaded.uri, remote: false, fileName };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw nativeDownloadError(error);
  }
}

/**
 * The card of one format. The stored PNG when the build's page carries one; otherwise (being drawn, a cold link, no usable
 * photo yet) the route draws it now. 404 `vehicle_unavailable`: not visible, or no photo to draw from.
 */
export function useShareCard(vehicleId: string, format: ShareCardFormat, enabled: boolean) {
  const client = useQueryClient();
  const viewer = usePublicViewer();
  return useQuery({
    queryKey: signatureKeys.shareCard(vehicleId, format, viewer),
    queryFn: async ({ signal }): Promise<ShareCard> => {
      const stored = storedShareCardUrl(client, vehicleId, format);
      if (stored) return { url: stored, remote: true, fileName: shareCardFileName(vehicleId, format) };
      return drawShareCard(vehicleId, format, signal);
    },
    enabled: enabled && vehicleId !== '',
    retry: retryUnlessAnswered,
    // A drawn card is a local file or object URL: it is not worth keeping across launches.
    meta: { persist: false },
  });
}

// -- Plate and face blur (GAR-08)

/**
 * `PATCH media/{id}` with `blur_regions`: the server answers the photo `processing` with no variants, pixelates every file in the
 * queue and replaces the original. The cached vehicle takes the answer at once, so GAR-07 and GAR-08 show the processing state.
 */
export function useBlurPhoto(vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ mediaId, regions }: { mediaId: string; regions: readonly BlurRegion[] }): Promise<GarageMedia> =>
      (await apiData(api.PATCH('/media/{media}', { params: { path: { media: mediaId } }, body: { blur_regions: regions.map((region) => ({ ...region })) } }))).data,
    onSuccess: (media) => {
      client.setQueryData<GarageVehicle>(garageKeys.vehicle(vehicle.id), (current) =>
        current ? { ...current, photos: current.photos.map((photo) => (photo.id === media.id ? media : photo)) } : current,
      );
      refreshVehicle(client, vehicle);
    },
    onError: (error) => {
      // A 422 about the photo's state (still processing, no longer ready): what is true now reads again.
      if (error instanceof ApiError && (error.status === 422 || error.status === 404)) refreshVehicle(client, vehicle);
    },
  });
}

// -- Compare (VEH-06)

export type CompareQuery = {
  data: CompareData | undefined;
  isPending: boolean;
  isPaused: boolean;
  error: ApiError | null;
  isFetching: boolean;
  /** One build twice: the server refuses it with a 422 on `b`, so the app does not ask. */
  same: boolean;
  refetch: () => void;
};

/** Guest OK. 404 `vehicle_unavailable` when either build is not visible to the viewer, without saying which. */
export function useCompare(a: string, b: string): CompareQuery {
  const viewer = usePublicViewer();
  const same = a !== '' && isSameBuild(a, b);
  const query = useQuery({
    queryKey: signatureKeys.compare(a, b, viewer),
    queryFn: async ({ signal }) => compareFromApi((await apiData(api.GET('/compare', { params: { query: { a, b } }, signal }))).data),
    enabled: a !== '' && b !== '' && !same,
    retry: retryUnlessAnswered,
  });
  const error = query.error instanceof ApiError ? query.error : query.error ? networkError() : null;
  const sameFromServer = error?.status === 422 && Boolean(error.fieldErrors.b);
  return {
    data: query.data,
    isPending: query.isPending,
    isPaused: query.fetchStatus === 'paused',
    error: sameFromServer ? null : error,
    isFetching: query.isFetching,
    same: same || sameFromServer,
    refetch: () => void query.refetch(),
  };
}
