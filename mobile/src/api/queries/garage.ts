/**
 * The owner's garage (GAR-01 to GAR-12; docs/reports/phase-1/m1.6-api-handover.md). Every write answers with the new
 * VehicleResource, which replaces the cached copy at once; the lists and the public page that show the same vehicle are
 * invalidated, so GAR-01, VEH-01 and QR-01 read again when they are next in view.
 *
 * Creating calls (POST vehicles, publish, notes) take the caller's idempotency key: one key per intent, kept across retries.
 */
import { hashKey, useInfiniteQuery, useIsRestoring, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { meKey } from '@/api/queries/auth';
import { discoverKeys } from '@/api/queries/discover';
import { homeKeys, type FeedVehicle } from '@/api/queries/home';
import { myVehiclesKey, type VehicleCardData } from '@/api/queries/profile';
import { qrCodeKey, qrListKey, type QrCodeData } from '@/api/queries/qr';
import { searchKeys } from '@/api/queries/search';
import { retryUnlessAnswered, vehicleKeys } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type GarageVehicle = components['schemas']['VehicleResource'];
export type VehicleAttributes = components['schemas']['VehicleAttributesRequest'];
export type SpecsRequest = components['schemas']['UpdateSpecsRequest'];
export type Visibility = components['schemas']['Visibility'];
export type OwnerUpdate = components['schemas']['BuildUpdateResource'];
export type MediaPatch = components['schemas']['UpdateMediaRequest'];
export type GarageMedia = components['schemas']['MediaResource'];

/** The wizard's route id before the first save created the draft (features/auth/routing.ts WIZARD_PATH). */
export const NEW_DRAFT = 'new';

/** A creating POST whose idempotency key was used with another body. In flight is a plain `conflict` with Retry-After. */
export const IDEMPOTENCY_KEY_REUSED = 'idempotency_key_reused';

/** The API allows 30 entries of Verlauf per page (ADR-146). */
export const OWNER_UPDATES_PAGE_SIZE = 30;

export const garageKeys = {
  vehicle: (id: string) => ['garage', 'vehicle', id] as const,
  updates: (id: string) => ['garage', 'updates', id] as const,
};

function useSignedIn(): boolean {
  return useSessionStore(selectMayReadOwned);
}

/**
 * After any change to a vehicle: the stored copy is replaced when the answer carries one, and everything else that shows
 * the vehicle reads again. The keys of the public page hold the public id, the garage keys the ULID.
 */
export function refreshVehicle(client: QueryClient, vehicle: Pick<GarageVehicle, 'id' | 'slug'>, next?: GarageVehicle) {
  if (next) client.setQueryData(garageKeys.vehicle(vehicle.id), next);
  else void client.invalidateQueries({ queryKey: garageKeys.vehicle(vehicle.id) });
  void client.invalidateQueries({ queryKey: myVehiclesKey });
  void client.invalidateQueries({ queryKey: vehicleKeys.of(vehicle.slug) });
  void client.invalidateQueries({ queryKey: garageKeys.updates(vehicle.id) });
  void client.invalidateQueries({ queryKey: qrListKey });
  void client.invalidateQueries({ queryKey: qrCodeKey(vehicle.id) });
}

/** The cached pages of "Neue Builds" that a viewer's feed continues with, for every viewer in the cache. */
function newBuildsMoreOf(client: QueryClient): QueryKey[] {
  const keys = client.getQueryCache().findAll({ queryKey: homeKeys.all }).map((query) => query.queryKey);
  return keys.filter((key) => hashKey(key) === hashKey(homeKeys.newBuildsMore(String(key[1]))));
}

/**
 * After a change that the public lists can show (BH-37): Start, Entdecken, the search and the member's own counts read again.
 * The continuation of "Neue Builds" is `enabled: false`, so an invalidation would never refetch it: it starts over instead.
 * Apart from refreshVehicle, because every autosave and mod write calls that one.
 */
export function refreshPublicLists(client: QueryClient, gone?: string) {
  void client.invalidateQueries({ queryKey: meKey });
  void client.invalidateQueries({ queryKey: homeKeys.all });
  // A deleted build's own "Ähnliche Builds" stays out: GAR-02 still shows it under GAR-05, and a refetch could only answer 404.
  void client.invalidateQueries({ queryKey: discoverKeys.all, predicate: (query) => gone === undefined || !isSimilarOf(query.queryKey, gone) });
  void client.invalidateQueries({ queryKey: searchKeys.all });
  for (const key of newBuildsMoreOf(client)) void client.resetQueries({ queryKey: key, exact: true });
}

/** `discoverKeys.similar(viewer, vehicleId)` for any viewer: the strip of similar builds on one vehicle's page. */
function isSimilarOf(key: QueryKey, vehicleId: string): boolean {
  return key[0] === discoverKeys.all[0] && key[2] === 'similar' && key[3] === vehicleId;
}

type FeedPage = { data: FeedVehicle[] };
type FeedPages = { pages: FeedPage[] };

/** A deleted build leaves the cached feed at once, so no card leads to "Fahrzeug nicht verfügbar" until the refetch answers. */
function dropFromFeed(client: QueryClient, vehicleId: string) {
  const without = <Page extends FeedPage>(page: Page): Page => ({ ...page, data: page.data.filter((card) => card.id !== vehicleId) });
  for (const key of client.getQueryCache().findAll({ queryKey: homeKeys.all }).map((query) => query.queryKey)) {
    const viewer = String(key[1]);
    if (hashKey(key) === hashKey(homeKeys.newBuildsFirst(viewer))) client.setQueryData<FeedPage>(key, (page) => (page ? without(page) : page));
    if (hashKey(key) === hashKey(homeKeys.newBuildsMore(viewer))) client.setQueryData<FeedPages>(key, (all) => (all ? { ...all, pages: all.pages.map(without) } : all));
  }
}

/**
 * Being the main vehicle moves between vehicles: the other pages of the member's garage say so too (BH-19). Read before a
 * deleted vehicle's card leaves the list.
 */
function refreshGaragePages(client: QueryClient, except?: string) {
  for (const card of client.getQueryData<VehicleCardData[]>(myVehiclesKey) ?? []) {
    if (card.id !== except) void client.invalidateQueries({ queryKey: vehicleKeys.of(card.slug) });
  }
}

/** A published vehicle is in the public lists. A draft is not, so its autosaves leave them alone. */
function refreshIfPublished(client: QueryClient, vehicle: Pick<GarageVehicle, 'status'>) {
  if (vehicle.status === 'published') refreshPublicLists(client);
}

/** No answer, or a key that was used before: a creating call may be stored, so what lists it reads again (BH-03). */
function mayBeStored(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'network' || error.code === IDEMPOTENCY_KEY_REUSED);
}

/** GAR-02, GAR-05 to GAR-08, GAR-12 and each wizard step: the stored values, the photos and what is still missing. */
export function useVehicle(id: string | undefined) {
  const signedIn = useSignedIn();
  const vehicleId = id ?? '';
  return useQuery({
    queryKey: garageKeys.vehicle(vehicleId),
    queryFn: async ({ signal }) =>
      (await apiData(api.GET('/vehicles/{vehicle}', { params: { path: { vehicle: vehicleId } }, signal }))).data,
    enabled: signedIn && vehicleId !== '' && vehicleId !== NEW_DRAFT,
    retry: retryUnlessAnswered,
  });
}

/**
 * Reads the vehicle fresh when a screen that writes it opens, also a copy younger than the 60 s of staleTime (BH-10), as
 * refetchOnMount: 'always' would: a fetch under way or a disabled query is left alone. It waits for the persisted cache to be
 * restored: before that the query has no copy and no subscriber, so a read then is skipped, and the restored copy, which the
 * persister's 1 s throttle can leave older than the last save, would stand for the whole staleTime. The garage editors
 * (useOwnVehicle) and every wizard step (useWizardDraft) open through this; useVehicle's other callers do not want it.
 */
export function useReadVehicleOnOpen(id: string | undefined) {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const signedIn = useSignedIn();
  const vehicleId = id && id !== NEW_DRAFT ? id : '';
  useEffect(() => {
    if (restoring || !signedIn || vehicleId === '') return;
    void client.refetchQueries({ queryKey: garageKeys.vehicle(vehicleId), exact: true }, { cancelRefetch: false });
  }, [client, restoring, signedIn, vehicleId]);
}

/** The garage card of a vehicle from the GAR-01 list, while its own resource is on the way. */
export function useCachedCard(id: string | undefined): VehicleCardData | undefined {
  const client = useQueryClient();
  return id ? client.getQueryData<VehicleCardData[]>(myVehiclesKey)?.find((card) => card.id === id) : undefined;
}

/** GAR-03 step 1, the first save of a new draft. */
export function useCreateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: { body: VehicleAttributes; idempotencyKey: string }) =>
      (await apiData(api.POST('/vehicles', { body, ...withIdempotency(idempotencyKey) }))).data,
    onSuccess: (vehicle) => refreshVehicle(client, vehicle, vehicle),
    onError: (error) => {
      if (mayBeStored(error)) void client.invalidateQueries({ queryKey: myVehiclesKey });
    },
  });
}

async function patchVehicle(id: string, body: VehicleAttributes) {
  return (await apiData(api.PATCH('/vehicles/{vehicle}', { params: { path: { vehicle: id } }, body }))).data;
}

function refreshAfterEdit(client: QueryClient, vehicle: GarageVehicle) {
  refreshVehicle(client, vehicle, vehicle);
  refreshIfPublished(client, vehicle);
}

/** GAR-03 steps, GAR-05, the cover photo: only the keys sent change. */
export function useUpdateVehicle(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: VehicleAttributes) => patchVehicle(id, body),
    onSuccess: (vehicle) => refreshAfterEdit(client, vehicle),
  });
}

/** The same for a vehicle whose id comes with the call: GAR-03 step 1 learns it from the save it is in the middle of. */
export function useUpdateVehicleById() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: VehicleAttributes }) => patchVehicle(id, body),
    onSuccess: (vehicle) => refreshAfterEdit(client, vehicle),
  });
}

/** GAR-03 step 2 and GAR-06. PUT replaces the whole set: a key that is not sent is empty afterwards. */
export function useSaveSpecs(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: SpecsRequest) =>
      (await apiData(api.PUT('/vehicles/{vehicle}/specs', { params: { path: { vehicle: id } }, body }))).data,
    onSuccess: (vehicle) => refreshAfterEdit(client, vehicle),
  });
}

/** GAR-03 step 4. 422 `vehicle_incomplete` lists what is missing; 403 `email_not_verified` comes first. */
export function usePublishVehicle(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ visibility, idempotencyKey }: { visibility: Visibility; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/publish', {
            params: { path: { vehicle: id } },
            body: { visibility },
            ...withIdempotency(idempotencyKey),
          }),
        )
      ).data,
    onSuccess: (vehicle) => {
      refreshVehicle(client, vehicle, vehicle);
      refreshPublicLists(client);
    },
  });
}

/** Hauptfahrzeug: at most one, published vehicles only. */
export function useSetMainVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await apiData(api.POST('/vehicles/{vehicle}/main', { params: { path: { vehicle: id } } }))).data,
    onSuccess: (vehicle) => {
      refreshGaragePages(client);
      refreshVehicle(client, vehicle, vehicle);
    },
  });
}

/** GAR-12. Going private stays open under a restriction; public and unlisted answer 403 `account_restricted` then. */
export function useChangeVisibility(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (visibility: Visibility) =>
      (await apiData(api.PATCH('/vehicles/{vehicle}/visibility', { params: { path: { vehicle: id } }, body: { visibility } }))).data,
    onSuccess: (vehicle) => {
      // First the patch, then the re-read: setQueryData would otherwise take back the invalidation.
      patchCodeVisibility(client, vehicle);
      refreshAfterEdit(client, vehicle);
    },
  });
}

/**
 * QR-02 and QR-04 show the answer's visibility at once, and so does the QR-01 row that stands in for them (placeholderData),
 * instead of the old state until the re-read answers, or until reconnect when offline (BH-23). A revoked or blocked code keeps
 * its state: the visibility does not change what a scan of it finds.
 */
function patchCodeVisibility(client: QueryClient, vehicle: Pick<GarageVehicle, 'id' | 'visibility'>) {
  const patch = (code: QrCodeData): QrCodeData => ({
    ...code,
    scan_state: code.scan_state === 'active' || code.scan_state === 'private' ? (vehicle.visibility === 'private' ? 'private' : 'active') : code.scan_state,
    vehicle: { ...code.vehicle, visibility: vehicle.visibility },
  });
  client.setQueryData<QrCodeData>(qrCodeKey(vehicle.id), (code) => (code ? patch(code) : code));
  client.setQueryData<QrCodeData[]>(qrListKey, (rows) => rows?.map((row) => (row.vehicle.id === vehicle.id ? patch(row) : row)));
}

/** Revokes the QR code and takes the vehicle off search at once; open under a restriction. */
export function useDeleteVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vehicle: Pick<GarageVehicle, 'id' | 'slug'>) => {
      await apiData(api.DELETE('/vehicles/{vehicle}', { params: { path: { vehicle: vehicle.id } } }));
      return vehicle;
    },
    onSuccess: (vehicle) => forgetVehicle(client, vehicle),
    onError: (error, vehicle) => {
      // A 404: an earlier delete landed and its answer was lost, or another device deleted it. Either way it is gone.
      if (error instanceof ApiError && error.status === 404) forgetVehicle(client, vehicle);
    },
  });
}

/**
 * A deleted vehicle leaves every list and copy at once. Its own pages never read again by themselves: GAR-02 is still open under
 * GAR-05 until the dismiss, and a read now would only fetch a 404. A read already under way stops, and the copies are marked
 * stale, so a later visit reads again and shows the gone state. They are not removed: a screen still showing one would build a
 * new query on its next render and ask once more (readVisibleVehicle).
 */
function forgetVehicle(client: QueryClient, vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  // The server may have promoted another vehicle to main.
  refreshGaragePages(client, vehicle.id);
  client.setQueryData<VehicleCardData[]>(myVehiclesKey, (cards) => cards?.filter((card) => card.id !== vehicle.id));
  client.removeQueries({ queryKey: garageKeys.vehicle(vehicle.id) });
  for (const queryKey of [vehicleKeys.of(vehicle.slug), garageKeys.updates(vehicle.id), qrCodeKey(vehicle.id)]) {
    void client.cancelQueries({ queryKey });
    void client.invalidateQueries({ queryKey, refetchType: 'none' });
  }
  // Its similar builds too (F2 BH-37: GET vehicles/{id}/similar answered 404 after the delete), for every viewer.
  const similar = (query: { queryKey: QueryKey }) => isSimilarOf(query.queryKey, vehicle.id);
  void client.cancelQueries({ predicate: similar });
  void client.invalidateQueries({ predicate: similar, refetchType: 'none' });
  void client.invalidateQueries({ queryKey: myVehiclesKey });
  void client.invalidateQueries({ queryKey: qrListKey });
  dropFromFeed(client, vehicle.id);
  refreshPublicLists(client, vehicle.id);
}

/**
 * GAR-01 "Sortieren": every published vehicle exactly once, drafts stay out. The list moves at once and goes back to the
 * server's order when the call fails.
 */
export function useReorderVehicles() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => (await apiData(api.PUT('/me/vehicles/order', { body: { ids } }))).data,
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: myVehiclesKey });
      const before = client.getQueryData<VehicleCardData[]>(myVehiclesKey);
      if (before) {
        const byId = new Map(before.map((card) => [card.id, card]));
        const sorted = ids.flatMap((id) => {
          const card = byId.get(id);
          return card ? [card] : [];
        });
        const rest = before.filter((card) => !ids.includes(card.id));
        client.setQueryData<VehicleCardData[]>(myVehiclesKey, [...sorted, ...rest]);
      }
      return { before };
    },
    onError: (_error, _ids, context) => {
      if (context?.before) client.setQueryData(myVehiclesKey, context.before);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: myVehiclesKey }),
  });
}

/** GAR-11: the owner's Verlauf, hidden entries included, newest first. */
export function useOwnerUpdates(vehicleId: string | undefined, enabled: boolean = true) {
  const signedIn = useSignedIn();
  const id = vehicleId ?? '';
  return useInfiniteQuery({
    queryKey: garageKeys.updates(id),
    queryFn: async ({ pageParam, signal }) =>
      apiData(
        api.GET('/vehicles/{vehicle}/updates', {
          params: { path: { vehicle: id }, query: { per_page: OWNER_UPDATES_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled: signedIn && enabled && id !== '',
    retry: retryUnlessAnswered,
  });
}

/** GAR-11 "Notiz hinzufügen": published vehicles only, up to 500 characters. */
export function useAddNote(vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ note, idempotencyKey }: { note: string; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/updates', {
            params: { path: { vehicle: vehicle.id } },
            body: { note },
            ...withIdempotency(idempotencyKey),
          }),
        )
      ).data,
    onSuccess: () => refreshVehicle(client, vehicle),
    onError: (error) => {
      if (mayBeStored(error)) refreshVehicle(client, vehicle);
    },
  });
}

type UpdatePages = { pages: { data: OwnerUpdate[] }[]; pageParams: unknown[] };

/** Hides an entry from everybody but the owner, or shows it again. The row changes at once. */
export function useHideUpdate(vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  const key = garageKeys.updates(vehicle.id);
  const patch = (updateId: string, hidden: boolean) =>
    client.setQueryData<UpdatePages>(key, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.map((row) => (row.id === updateId ? { ...row, hidden } : row)),
            })),
          }
        : current,
    );
  return useMutation({
    mutationFn: async ({ id, hidden }: { id: string; hidden: boolean }) =>
      (await apiData(api.PATCH('/updates/{update}', { params: { path: { update: id } }, body: { hidden } }))).data,
    onMutate: async ({ id, hidden }) => {
      await client.cancelQueries({ queryKey: key });
      patch(id, hidden);
    },
    onError: (_error, { id, hidden }) => patch(id, !hidden),
    onSuccess: () => void client.invalidateQueries({ queryKey: vehicleKeys.of(vehicle.slug) }),
  });
}

// -- Photos of a vehicle (GAR-07, GAR-08). Uploads go through the queue in src/state/uploads.ts.

/** Alt text, focal point, category. */
export function useUpdateMedia(vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: MediaPatch }) =>
      (await apiData(api.PATCH('/media/{media}', { params: { path: { media: id } }, body }))).data,
    onSuccess: (media) => {
      client.setQueryData<GarageVehicle>(garageKeys.vehicle(vehicle.id), (current) =>
        current ? { ...current, photos: current.photos.map((photo) => (photo.id === media.id ? media : photo)) } : current,
      );
      refreshVehicle(client, vehicle);
    },
  });
}

/**
 * Deleting the last photo of a published vehicle stays allowed (ADR-142 c); the hero then shows its empty state. A failed
 * upload (`failed_photos`, BH-46) goes the same way, and may already be gone: media:prune removes it after 30 days.
 */
export function useDeleteMedia(vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mediaId: string) => {
      await apiData(api.DELETE('/media/{media}', { params: { path: { media: mediaId } } }));
      return mediaId;
    },
    onSuccess: (mediaId) => {
      client.setQueryData<GarageVehicle>(garageKeys.vehicle(vehicle.id), (current) =>
        current ? { ...current, photos: current.photos.filter((photo) => photo.id !== mediaId), failed_photos: (current.failed_photos ?? []).filter((photo) => photo.id !== mediaId) } : current,
      );
      refreshVehicle(client, vehicle);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) refreshVehicle(client, vehicle);
    },
  });
}

/** GAR-07 "Sortieren": every photo exactly once, at most 30. */
export function useReorderMedia(vehicle: Pick<GarageVehicle, 'id' | 'slug'>) {
  const client = useQueryClient();
  const key = garageKeys.vehicle(vehicle.id);
  return useMutation({
    mutationFn: async (ids: string[]) =>
      apiData(api.PUT('/vehicles/{vehicle}/media/order', { params: { path: { vehicle: vehicle.id } }, body: { ids } })),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<GarageVehicle>(key);
      if (before) {
        const byId = new Map(before.photos.map((photo) => [photo.id, photo]));
        const photos = ids.flatMap((id) => {
          const photo = byId.get(id);
          return photo ? [photo] : [];
        });
        client.setQueryData<GarageVehicle>(key, { ...before, photos });
      }
      return { before };
    },
    onError: (_error, _ids, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSettled: () => refreshVehicle(client, vehicle),
  });
}
