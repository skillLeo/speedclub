/**
 * QR codes (QR-01 to QR-04, c/[code]; 02_PRODUCT_SPEC §3.4). Owner routes need a member; the resolver is public and counts a
 * scan for anybody but the owner, so it never refetches by itself and never lands in the persisted cache.
 */
import { onlineManager, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { myVehiclesKey } from '@/api/queries/profile';
import type { components } from '@/api/schema';
import { isWeb } from '@/lib/platform';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

import appVersion from '../../../version.json';

export type QrCodeData = components['schemas']['QrCodeResource'];
export type QrResolution = components['schemas']['QrResolutionResource'];
export type QrScanState = components['schemas']['QrScanState'];
export type QrStats = components['schemas']['QrStatsResource'];

export const qrListKey = ['qr', 'list'] as const;
export const qrCodeKey = (vehicleId: string) => ['qr', 'code', vehicleId] as const;
/** With the code in the key: a reissue draws the new one instead of showing the old drawing. */
export const qrSvgKey = (vehicleId: string, code: string) => ['qr', 'svg', vehicleId, code] as const;
export const qrResolveKey = (code: string) => ['qr', 'resolve', code] as const;
export const qrStatsKey = (vehicleId: string) => ['qr', 'stats', vehicleId] as const;

/** A 4xx is an answer: retrying cannot change it. */
const retryUnlessAnswered = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

/**
 * The resolver's own rule. Every request is a scan on the owner's counter, and an answer that got lost may still have
 * counted, so the resolver never asks again by itself: only the screen's retry button does. The one exception is a
 * request that failed while the device was offline. It never reached the server, and it waits, paused, until the
 * connection is back (c/[code] "resolves once the connection is back").
 */
export function retryResolveWhileOffline(_failures: number, error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'network' && !onlineManager.isOnline();
}

/** Not while the session changes hands: a mounted QR screen of the previous member must not ask for its ids (BH-28). */
function useSignedIn(): boolean {
  return useSessionStore(selectMayReadOwned);
}

/** QR-01: one row per published vehicle, main vehicle first. A member has at most 20, and one page holds 30. */
export function useMyQrCodes() {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: qrListKey,
    queryFn: async ({ signal }) => (await apiData(api.GET('/me/qr-codes', { signal }))).data,
    enabled: signedIn,
    retry: retryUnlessAnswered,
  });
}

/** QR-02 to QR-04. The row of QR-01 stands in while the request runs, so the card appears at once. */
export function useQrCode(vehicleId: string | undefined) {
  const signedIn = useSignedIn();
  const client = useQueryClient();
  const id = vehicleId ?? '';
  // Explicit types: a function in `placeholderData` would otherwise be taken for the data type.
  return useQuery<QrCodeData, Error, QrCodeData, ReturnType<typeof qrCodeKey>>({
    queryKey: qrCodeKey(id),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/vehicles/{vehicle}/qr', { params: { path: { vehicle: id } }, signal }))).data,
    enabled: signedIn && id !== '',
    retry: retryUnlessAnswered,
    placeholderData: (): QrCodeData | undefined =>
      client.getQueryData<QrCodeData[]>(qrListKey)?.find((row) => row.vehicle.id === id),
  });
}

/**
 * The server's drawing of an active code (black on white, quiet zone 4, EC level Q), as SVG markup for `QRDisplay`. It is a
 * few kilobytes and stays in the persisted cache, so the card still shows offline.
 */
export function useQrSvg(vehicleId: string | undefined, code: string | null | undefined, enabled: boolean = true) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useQuery({
    queryKey: qrSvgKey(id, code ?? ''),
    queryFn: async ({ signal }) =>
      apiData(api.GET('/vehicles/{vehicle}/qr.svg', { params: { path: { vehicle: id } }, parseAs: 'text', signal })),
    enabled: signedIn && enabled && id !== '' && Boolean(code),
    // A code never changes its drawing; a new code has a new key.
    staleTime: Number.POSITIVE_INFINITY,
    retry: retryUnlessAnswered,
  });
}

/**
 * QR-02 [SIG `sig.qr_stats`]: 14 daily counts and the total, nothing about who scanned. The counter moves once a day at most
 * per scan, so a five-minute staleness is plenty. 404 answers for a vehicle that is not the member's (SEC-P1-10) and while the
 * flag is off: the row then stays away.
 */
export function useQrStats(vehicleId: string | undefined, enabled: boolean) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useQuery({
    queryKey: qrStatsKey(id),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/vehicles/{vehicle}/qr/stats', { params: { path: { vehicle: id } }, signal }))).data,
    enabled: signedIn && enabled && id !== '',
    staleTime: 5 * 60 * 1000,
    retry: retryUnlessAnswered,
  });
}

/**
 * Everything that shows a vehicle's code: QR-01, QR-02, the garage list (GAR-01 reads `qr.code` from its cards) and any query
 * keyed by this vehicle, such as its VehicleResource with the `qr` block. Drawings stay: their key holds the code.
 */
export function refreshCodes(client: QueryClient, vehicleId: string, next?: QrCodeData) {
  if (next) client.setQueryData(qrCodeKey(vehicleId), next);
  void client.invalidateQueries({ queryKey: qrListKey });
  void client.invalidateQueries({ queryKey: myVehiclesKey });
  void client.invalidateQueries({
    predicate: (query) => query.queryKey[1] !== 'svg' && query.queryKey.includes(vehicleId),
  });
}

/**
 * Revoke and reissue (QR-02). The caller keeps one idempotency key per intent, so a retry after a dropped answer cannot
 * replace the code twice. 403 `qr_revoked_by_staff` refetches the code, which then shows the blocked state.
 */
export function useReissueQr(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (idempotencyKey: string) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/qr/reissue', {
            params: { path: { vehicle: vehicleId } },
            ...withIdempotency(idempotencyKey),
          }),
        )
      ).data,
    onSuccess: (next) => refreshCodes(client, vehicleId, next),
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) refreshCodes(client, vehicleId);
    },
  });
}

/**
 * React Native on Android sends `okhttp/x.y`, which the server's bot list ignores for scan counts (KnownBots). The app names
 * itself instead. Browsers do not let a page set this header, so web keeps its own.
 */
export const RESOLVER_USER_AGENT = `SPEEDCLUB/${appVersion.versionName} (${Platform.OS})`;

/**
 * c/[code]. `code` is already normalised; null skips the request, because no such code can exist. The answer's `title` and
 * `message` are WEB-06's copy in the language of the request.
 */
export function useResolveQr(code: string | null) {
  return useQuery({
    queryKey: qrResolveKey(code ?? ''),
    queryFn: async ({ signal }) =>
      (
        await apiData(
          api.GET('/qr/{code}', {
            params: { path: { code: code ?? '' } },
            ...(isWeb ? {} : { headers: { 'User-Agent': RESOLVER_USER_AGENT } }),
            signal,
          }),
        )
      ).data,
    enabled: code !== null,
    meta: { persist: false },
    // Every request is a scan on the owner's counter: only the screen's own retry asks again (retryResolveWhileOffline).
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryResolveWhileOffline,
  });
}
