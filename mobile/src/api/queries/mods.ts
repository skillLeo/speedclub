/**
 * The owner's modifications (GAR-09, GAR-10; F3). `fields` and `notes` hold the stored values for the owner only (ADR-142).
 * A change makes a build update on a published vehicle, so the vehicle's Verlauf and its public page read again.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { allPages } from '@/api/queries/catalog';
import { IDEMPOTENCY_KEY_REUSED, refreshVehicle, type GarageVehicle } from '@/api/queries/garage';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type OwnerMod = components['schemas']['ModificationResource'];
export type ModStatus = components['schemas']['ModStatus'];
type ModificationRequest = components['schemas']['ModificationRequest'];

/** One stored value per key of the category's schema; null leaves the key out. */
export type ModFieldValues = Record<string, string | number | boolean | null>;

/**
 * What GAR-10 sends. The OpenAPI document describes `fields` as a list of strings, while the API takes an object keyed by the
 * schema (ModFields::validated refuses a list), so the request type is narrowed here at the one place it meets the client.
 */
export type ModPayload = Omit<ModificationRequest, 'fields' | 'category'> & { category?: string; fields?: ModFieldValues };

function toRequest(payload: ModPayload): ModificationRequest {
  return payload as unknown as ModificationRequest;
}

/** Two pages hold a vehicle's 200 mods at most. */
const PAGE_SIZE = 100;

export const modKeys = {
  list: (vehicleId: string) => ['garage', 'mods', vehicleId] as const,
  mod: (modId: string) => ['garage', 'mod', modId] as const,
};

type VehicleRef = Pick<GarageVehicle, 'id' | 'slug'>;

function refreshMods(client: QueryClient, vehicle: VehicleRef, mod?: OwnerMod) {
  if (mod) client.setQueryData(modKeys.mod(mod.id), mod);
  void client.invalidateQueries({ queryKey: modKeys.list(vehicle.id) });
  refreshVehicle(client, vehicle);
}

/** GAR-09: every mod of the vehicle in the member's order. */
export function useVehicleMods(vehicleId: string | undefined) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const id = vehicleId ?? '';
  return useQuery({
    queryKey: modKeys.list(id),
    queryFn: ({ signal }) =>
      allPages((cursor) =>
        apiData(
          api.GET('/vehicles/{vehicle}/mods', {
            params: { path: { vehicle: id }, query: { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
            signal,
          }),
        ),
      ),
    enabled: signedIn && id !== '',
    retry: retryUnlessAnswered,
  });
}

/** GAR-10 for an existing mod. It reads fresh on open: another device may have changed it, and a save sends `fields` whole (BH-10). */
export function useOwnerMod(modId: string | undefined) {
  const signedIn = useSessionStore(selectMayReadOwned);
  const id = modId ?? '';
  return useQuery({
    queryKey: modKeys.mod(id),
    queryFn: async ({ signal }) => (await apiData(api.GET('/mods/{modification}', { params: { path: { modification: id } }, signal }))).data,
    enabled: signedIn && id !== '' && id !== 'new',
    refetchOnMount: 'always',
    retry: retryUnlessAnswered,
  });
}

export function useCreateMod(vehicle: VehicleRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, idempotencyKey }: { payload: ModPayload & { category: string }; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/vehicles/{vehicle}/mods', {
            params: { path: { vehicle: vehicle.id } },
            body: toRequest(payload),
            ...withIdempotency(idempotencyKey),
          }),
        )
      ).data,
    onSuccess: (mod) => refreshMods(client, vehicle, mod),
    onError: (error) => {
      // No answer, or a key used before: the mod may be stored, so the list reads again (BH-03).
      if (error instanceof ApiError && (error.kind === 'network' || error.code === IDEMPOTENCY_KEY_REUSED)) void client.invalidateQueries({ queryKey: modKeys.list(vehicle.id) });
    },
  });
}

/**
 * Only the keys sent change; `fields` is replaced as a whole. The category cannot change. The answer says whether Verlauf now
 * tells about this save (`history_recorded`). The id comes with the call, as a new mod learns it from the save it is in.
 */
export function useUpdateMod(vehicle: VehicleRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ modId, payload }: { modId: string; payload: ModPayload }) =>
      (await apiData(api.PATCH('/mods/{modification}', { params: { path: { modification: modId } }, body: toRequest(payload) }))).data,
    onSuccess: (mod) => refreshMods(client, vehicle, mod),
  });
}

/** Soft: the history keeps the entry. Open under a restriction. */
export function useDeleteMod(vehicle: VehicleRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (modId: string) => {
      await apiData(api.DELETE('/mods/{modification}', { params: { path: { modification: modId } } }));
      return modId;
    },
    onSuccess: (modId) => {
      client.setQueryData<OwnerMod[]>(modKeys.list(vehicle.id), (mods) => mods?.filter((mod) => mod.id !== modId));
      client.removeQueries({ queryKey: modKeys.mod(modId) });
      refreshMods(client, vehicle);
    },
  });
}

/**
 * GAR-10: deletes one of the mod's photos. The editor's grid reads the mod, not the vehicle, so the mod's copy loses the
 * photo at once and the mod, its list and the vehicle read again. Open under a restriction (ADR-146 b).
 */
export function useDeleteModPhoto(vehicle: VehicleRef, modId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (mediaId: string) => {
      await apiData(api.DELETE('/media/{media}', { params: { path: { media: mediaId } } }));
      return mediaId;
    },
    onSuccess: (mediaId) => {
      client.setQueryData<OwnerMod>(modKeys.mod(modId), (mod) => (mod ? { ...mod, photos: mod.photos.filter((photo) => photo.id !== mediaId) } : mod));
      void client.invalidateQueries({ queryKey: modKeys.mod(modId) });
      refreshMods(client, vehicle);
    },
  });
}

/** GAR-09 "Sortieren": every mod exactly once. The list moves at once and goes back when the call fails. */
export function useReorderMods(vehicle: VehicleRef) {
  const client = useQueryClient();
  const key = modKeys.list(vehicle.id);
  return useMutation({
    mutationFn: async (ids: string[]) =>
      (await apiData(api.PUT('/vehicles/{vehicle}/mods/order', { params: { path: { vehicle: vehicle.id } }, body: { ids } }))).data,
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<OwnerMod[]>(key);
      if (before) {
        const byId = new Map(before.map((mod) => [mod.id, mod]));
        client.setQueryData<OwnerMod[]>(
          key,
          ids.flatMap((id) => {
            const mod = byId.get(id);
            return mod ? [mod] : [];
          }),
        );
      }
      return { before };
    },
    onError: (_error, _ids, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSettled: () => refreshMods(client, vehicle),
  });
}
