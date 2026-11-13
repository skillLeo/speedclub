/**
 * Maintenance (M4.13, 09 §8.8, §7.12, ADR-441): the owner's items and service log per vehicle, odometer, private costs, the
 * upcoming list of GAR-01 and the reminder plan the app's local backup notifications follow. Owner only, never public; staff
 * view-as does not see it. Every write answers the new resource, which replaces the cached copy; the lists that show the same
 * item (upcoming, reminders, costs, the vehicle's HU/AU month) read again.
 *
 * Creates carry a client ULID (`id`) and an Idempotency-Key, so the offline outbox (features/maintenance/outbox.ts) can send the
 * same write again without making a second item. Patches carry the `version` they started from: a newer one answers 409
 * edit_conflict.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { garageKeys } from '@/api/queries/garage';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';
import { numberOrNull } from '@/lib/numbers';
import { selectMayReadOwned, useSessionStore } from '@/state/session';

export type MaintenanceItem = components['schemas']['MaintenanceItemResource'];
export type MaintenanceLog = components['schemas']['MaintenanceLogResource'];
export type MaintenanceUpcoming = components['schemas']['MaintenanceUpcomingResource'];
export type MaintenanceCosts = components['schemas']['MaintenanceCostsResource'];
export type MaintenanceType = components['schemas']['MaintenanceType'];
export type MaintenanceDueState = components['schemas']['MaintenanceDueState'];
export type ReminderPlan = components['schemas']['MaintenanceReminderPlanResource'];
export type ReminderStage = ReminderPlan['stages'][number];
export type ItemInput = components['schemas']['StoreMaintenanceItemRequest'];
export type ItemPatch = components['schemas']['UpdateMaintenanceItemRequest'];
export type LogInput = components['schemas']['StoreMaintenanceLogRequest'];
export type LogPatch = components['schemas']['UpdateMaintenanceLogRequest'];
export type LogPhoto = MaintenanceLog['photos'][number];
export type Odometer = components['schemas']['OdometerResource'];

/** The feature flag of every maintenance route (09 §8.18). */
export const MAINTENANCE_FLAG = 'maintenance';
/** 09 §8.8 / MaintenanceRules: one item per type except custom, at most 30 per vehicle. */
export const MAINTENANCE_ITEM_LIMIT = 30;
export const LOG_PHOTO_LIMIT = 6;
export const LOGS_PAGE_SIZE = 30;
/** Signed photo URLs live about 10 minutes: the Verlauf reads again before they run out while it is open. */
export const SIGNED_URL_REFRESH_MS = 8 * 60 * 1000;
/** GAR-01 "Nächste Fälligkeiten": overdue ones, then the next 60 days (the API's default). */
export const UPCOMING_DAYS = 60;
export const UPCOMING_LIMIT = 6;

export const EDIT_CONFLICT = 'edit_conflict';
export const LIMIT_REACHED = 'limit_reached';

export const maintenanceKeys = {
  all: ['maintenance'] as const,
  items: (vehicleId: string) => ['maintenance', 'items', vehicleId] as const,
  logs: (vehicleId: string) => ['maintenance', 'logs', vehicleId] as const,
  costs: (vehicleId: string) => ['maintenance', 'costs', vehicleId] as const,
  upcoming: ['maintenance', 'upcoming'] as const,
  reminders: ['maintenance', 'reminders'] as const,
};

export type ItemsPage = { items: MaintenanceItem[]; odometer: { km: number | null; recordedAt: string | null } };

export { numberOrNull };

export function isEditConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === EDIT_CONFLICT;
}

/** No answer: the write may wait in the outbox. */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'network';
}

/** 404 of an item or entry: deleted elsewhere (also feature_disabled; both mean "not there any more"). */
export function isGoneError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found';
}

function useMayRead(): boolean {
  const signedIn = useSessionStore(selectMayReadOwned);
  return useFlag(MAINTENANCE_FLAG) && signedIn;
}

type Wrapped<T> = { data: T };

/** The plain calls, shared by the hooks and the outbox. */
export const maintenanceApi = {
  async items(vehicleId: string, signal?: AbortSignal): Promise<ItemsPage> {
    const answer = await apiData(api.GET('/vehicles/{vehicle}/maintenance-items', { params: { path: { vehicle: vehicleId } }, signal }));
    return { items: answer.data, odometer: { km: numberOrNull(answer.meta.odometer.km), recordedAt: answer.meta.odometer.recorded_at } };
  },
  async createItem(vehicleId: string, body: ItemInput, idempotencyKey: string): Promise<MaintenanceItem> {
    const answer = await apiData(
      api.POST('/vehicles/{vehicle}/maintenance-items', {
        params: { path: { vehicle: vehicleId } },
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    // The generated type of the 201 is a bare string (Scramble); the body is the item resource.
    return (answer as unknown as Wrapped<MaintenanceItem>).data;
  },
  async updateItem(vehicleId: string, itemId: string, body: ItemPatch): Promise<MaintenanceItem> {
    const answer = await apiData(
      api.PATCH('/vehicles/{vehicle}/maintenance-items/{item}', { params: { path: { vehicle: vehicleId, item: itemId } }, body }),
    );
    return (answer as unknown as Wrapped<MaintenanceItem>).data;
  },
  async deleteItem(vehicleId: string, itemId: string): Promise<void> {
    await apiData(api.DELETE('/vehicles/{vehicle}/maintenance-items/{item}', { params: { path: { vehicle: vehicleId, item: itemId } } }));
  },
  async logs(vehicleId: string, cursor: string | null, signal?: AbortSignal) {
    return apiData(
      api.GET('/vehicles/{vehicle}/maintenance-logs', {
        params: { path: { vehicle: vehicleId }, query: { per_page: LOGS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async createLog(vehicleId: string, body: LogInput, idempotencyKey: string): Promise<MaintenanceLog> {
    const answer = await apiData(
      api.POST('/vehicles/{vehicle}/maintenance-logs', {
        params: { path: { vehicle: vehicleId } },
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    return (answer as unknown as Wrapped<MaintenanceLog>).data;
  },
  async updateLog(vehicleId: string, logId: string, body: LogPatch): Promise<MaintenanceLog> {
    const answer = await apiData(
      api.PATCH('/vehicles/{vehicle}/maintenance-logs/{log}', { params: { path: { vehicle: vehicleId, log: logId } }, body }),
    );
    return (answer as unknown as Wrapped<MaintenanceLog>).data;
  },
  async deleteLog(vehicleId: string, logId: string): Promise<void> {
    await apiData(api.DELETE('/vehicles/{vehicle}/maintenance-logs/{log}', { params: { path: { vehicle: vehicleId, log: logId } } }));
  },
  async setOdometer(vehicleId: string, km: number): Promise<Odometer> {
    const answer = await apiData(api.PUT('/vehicles/{vehicle}/odometer', { params: { path: { vehicle: vehicleId } }, body: { km } }));
    return (answer as unknown as Wrapped<Odometer>).data;
  },
  async uploadLogPhoto(vehicleId: string, logId: string, form: FormData, idempotencyKey: string): Promise<LogPhoto> {
    const answer = await apiData(
      api.POST('/vehicles/{vehicle}/maintenance-logs/{log}/photos', {
        params: { path: { vehicle: vehicleId, log: logId } },
        // The generated type describes the multipart field as a string; the serializer hands the FormData on as is.
        body: form as unknown as components['schemas']['MaintenancePhotoRequest'],
        bodySerializer: (body) => body as unknown as FormData,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    );
    return (answer as unknown as Wrapped<LogPhoto>).data;
  },
  async deleteLogPhoto(vehicleId: string, logId: string, mediaId: string): Promise<void> {
    await apiData(
      api.DELETE('/vehicles/{vehicle}/maintenance-logs/{log}/photos/{media}', {
        params: { path: { vehicle: vehicleId, log: logId, media: mediaId } },
      }),
    );
  },
  async costs(vehicleId: string, signal?: AbortSignal): Promise<MaintenanceCosts> {
    return (await apiData(api.GET('/vehicles/{vehicle}/costs', { params: { path: { vehicle: vehicleId } }, signal }))).data;
  },
  async upcoming(signal?: AbortSignal): Promise<MaintenanceUpcoming[]> {
    return (await apiData(api.GET('/me/maintenance/upcoming', { params: { query: { days: UPCOMING_DAYS, limit: UPCOMING_LIMIT } }, signal }))).data;
  },
  async reminders(signal?: AbortSignal): Promise<ReminderPlan> {
    return (await apiData(api.GET('/me/maintenance/reminders', { signal }))).data;
  },
};

/**
 * After any write of a vehicle's maintenance: its items, log and costs read again, and so do the lists across vehicles. The
 * HU/AU item mirrors the vehicle's HU/AU month (ADR-441), so the garage copy of the vehicle reads again too.
 */
export function refreshMaintenance(client: QueryClient, vehicleId: string) {
  void client.invalidateQueries({ queryKey: maintenanceKeys.items(vehicleId) });
  void client.invalidateQueries({ queryKey: maintenanceKeys.logs(vehicleId) });
  void client.invalidateQueries({ queryKey: maintenanceKeys.costs(vehicleId) });
  void client.invalidateQueries({ queryKey: maintenanceKeys.upcoming });
  void client.invalidateQueries({ queryKey: maintenanceKeys.reminders });
  void client.invalidateQueries({ queryKey: garageKeys.vehicle(vehicleId) });
}

/** MNT-01: the vehicle's items, the nearest due first, and its last known mileage. */
export function useMaintenanceItems(vehicleId: string) {
  const mayRead = useMayRead();
  return useQuery({
    queryKey: maintenanceKeys.items(vehicleId),
    queryFn: ({ signal }) => maintenanceApi.items(vehicleId, signal),
    enabled: mayRead && vehicleId !== '',
    retry: retryUnlessAnswered,
  });
}

/** MNT-01 Verlauf, newest first. The photo URLs are signed for about 10 minutes: an open screen reads again before they end. */
export function useMaintenanceLogs(vehicleId: string) {
  const mayRead = useMayRead();
  return useInfiniteQuery({
    queryKey: maintenanceKeys.logs(vehicleId),
    queryFn: ({ pageParam, signal }) => maintenanceApi.logs(vehicleId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    enabled: mayRead && vehicleId !== '',
    refetchInterval: SIGNED_URL_REFRESH_MS,
    retry: retryUnlessAnswered,
  });
}

export type LogsData = InfiniteData<Awaited<ReturnType<typeof maintenanceApi.logs>>, string | null>;

export function useMaintenanceCosts(vehicleId: string, enabled: boolean = true) {
  const mayRead = useMayRead();
  return useQuery({
    queryKey: maintenanceKeys.costs(vehicleId),
    queryFn: ({ signal }) => maintenanceApi.costs(vehicleId, signal),
    enabled: mayRead && enabled && vehicleId !== '',
    retry: retryUnlessAnswered,
  });
}

/** GAR-01 "Nächste Fälligkeiten" across the member's vehicles. */
export function useUpcomingMaintenance(enabled: boolean = true) {
  const mayRead = useMayRead();
  return useQuery({
    queryKey: maintenanceKeys.upcoming,
    queryFn: ({ signal }) => maintenanceApi.upcoming(signal),
    enabled: mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

/** The reminder stages the local backups follow (ADR-441 dedupe contract). */
export function useReminderPlan(enabled: boolean = true) {
  const mayRead = useMayRead();
  return useQuery({
    queryKey: maintenanceKeys.reminders,
    queryFn: ({ signal }) => maintenanceApi.reminders(signal),
    enabled: mayRead && enabled,
    retry: retryUnlessAnswered,
  });
}

function replaceItem(client: QueryClient, vehicleId: string, item: MaintenanceItem) {
  client.setQueryData<ItemsPage>(maintenanceKeys.items(vehicleId), (page) => {
    if (!page) return page;
    const known = page.items.some((entry) => entry.id === item.id);
    return { ...page, items: known ? page.items.map((entry) => (entry.id === item.id ? item : entry)) : [...page.items, item] };
  });
}

export type SaveItemInput =
  | { mode: 'create'; body: ItemInput & { id: string }; idempotencyKey: string }
  | { mode: 'update'; itemId: string; body: ItemPatch };

/** MNT-02: a new item or a change. The answer replaces the cached item at once; the rest reads again. */
export function useSaveItem(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveItemInput) =>
      input.mode === 'create'
        ? maintenanceApi.createItem(vehicleId, input.body, input.idempotencyKey)
        : maintenanceApi.updateItem(vehicleId, input.itemId, input.body),
    onSuccess: (item) => {
      replaceItem(client, vehicleId, item);
      refreshMaintenance(client, vehicleId);
    },
    onError: (error) => {
      // The server's copy is newer, or the item is gone: read it again either way.
      if (isEditConflict(error) || isGoneError(error) || (error instanceof ApiError && error.kind === 'conflict')) refreshMaintenance(client, vehicleId);
    },
  });
}

/** A switch on a card ("Erinnern"): moves at once, goes back when the server refuses. */
export function useToggleItem(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ item, enabled }: { item: MaintenanceItem; enabled: boolean }) =>
      maintenanceApi.updateItem(vehicleId, item.id, { enabled, version: item.version }),
    onMutate: async ({ item, enabled }) => {
      await client.cancelQueries({ queryKey: maintenanceKeys.items(vehicleId) });
      const before = client.getQueryData<ItemsPage>(maintenanceKeys.items(vehicleId));
      replaceItem(client, vehicleId, { ...item, enabled });
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(maintenanceKeys.items(vehicleId), context.before);
      refreshMaintenance(client, vehicleId);
    },
    onSuccess: (item) => {
      replaceItem(client, vehicleId, item);
      refreshMaintenance(client, vehicleId);
    },
  });
}

/** Removes the card at once; it comes back when the call fails for any reason but "already gone". */
export function useDeleteItem(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => maintenanceApi.deleteItem(vehicleId, itemId),
    onMutate: async (itemId) => {
      await client.cancelQueries({ queryKey: maintenanceKeys.items(vehicleId) });
      const before = client.getQueryData<ItemsPage>(maintenanceKeys.items(vehicleId));
      if (before) client.setQueryData<ItemsPage>(maintenanceKeys.items(vehicleId), { ...before, items: before.items.filter((item) => item.id !== itemId) });
      return { before };
    },
    onError: (error, _itemId, context) => {
      if (context?.before && !isGoneError(error)) client.setQueryData(maintenanceKeys.items(vehicleId), context.before);
    },
    onSettled: () => refreshMaintenance(client, vehicleId),
  });
}

function replaceLog(client: QueryClient, vehicleId: string, log: MaintenanceLog) {
  client.setQueryData<LogsData>(maintenanceKeys.logs(vehicleId), (data) => {
    if (!data) return data;
    const known = data.pages.some((page) => page.data.some((entry) => entry.id === log.id));
    const pages = data.pages.map((page, index) => ({
      ...page,
      data: known ? page.data.map((entry) => (entry.id === log.id ? log : entry)) : index === 0 ? [log, ...page.data] : page.data,
    }));
    return { ...data, pages };
  });
}

export type SaveLogInput =
  | { mode: 'create'; body: LogInput & { id: string }; idempotencyKey: string }
  | { mode: 'update'; logId: string; body: LogPatch };

/** A service log entry: new or changed. It moves its item's last time and next due date, so the items read again. */
export function useSaveLog(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveLogInput) =>
      input.mode === 'create'
        ? maintenanceApi.createLog(vehicleId, input.body, input.idempotencyKey)
        : maintenanceApi.updateLog(vehicleId, input.logId, input.body),
    onSuccess: (log) => {
      replaceLog(client, vehicleId, log);
      refreshMaintenance(client, vehicleId);
    },
    onError: (error) => {
      if (isEditConflict(error) || isGoneError(error)) refreshMaintenance(client, vehicleId);
    },
  });
}

export function useDeleteLog(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (logId: string) => maintenanceApi.deleteLog(vehicleId, logId),
    onMutate: async (logId) => {
      await client.cancelQueries({ queryKey: maintenanceKeys.logs(vehicleId) });
      const before = client.getQueryData<LogsData>(maintenanceKeys.logs(vehicleId));
      if (before) {
        client.setQueryData<LogsData>(maintenanceKeys.logs(vehicleId), {
          ...before,
          pages: before.pages.map((page) => ({ ...page, data: page.data.filter((log) => log.id !== logId) })),
        });
      }
      return { before };
    },
    onError: (error, _logId, context) => {
      if (context?.before && !isGoneError(error)) client.setQueryData(maintenanceKeys.logs(vehicleId), context.before);
    },
    onSettled: () => refreshMaintenance(client, vehicleId),
  });
}

/** "Kilometerstand aktualisieren": the new mileage shows at once, km-based countdowns read again. */
export function useSetOdometer(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (km: number) => maintenanceApi.setOdometer(vehicleId, km),
    onMutate: async (km) => {
      await client.cancelQueries({ queryKey: maintenanceKeys.items(vehicleId) });
      const before = client.getQueryData<ItemsPage>(maintenanceKeys.items(vehicleId));
      if (before) client.setQueryData<ItemsPage>(maintenanceKeys.items(vehicleId), { ...before, odometer: { ...before.odometer, km } });
      return { before };
    },
    onError: (_error, _km, context) => {
      if (context?.before) client.setQueryData(maintenanceKeys.items(vehicleId), context.before);
    },
    onSettled: () => refreshMaintenance(client, vehicleId),
  });
}

export function useUploadLogPhoto(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, form, idempotencyKey }: { logId: string; form: FormData; idempotencyKey: string }) =>
      maintenanceApi.uploadLogPhoto(vehicleId, logId, form, idempotencyKey),
    onSettled: () => void client.invalidateQueries({ queryKey: maintenanceKeys.logs(vehicleId) }),
  });
}

export function useDeleteLogPhoto(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, mediaId }: { logId: string; mediaId: string }) => maintenanceApi.deleteLogPhoto(vehicleId, logId, mediaId),
    onSettled: () => void client.invalidateQueries({ queryKey: maintenanceKeys.logs(vehicleId) }),
  });
}

/** One service log entry, for MNT-02 opened by a link: the Verlauf's cached copy first, then the server's. */
export function useMaintenanceLog(vehicleId: string, logId: string | undefined) {
  const mayRead = useMayRead();
  const client = useQueryClient();
  return useQuery({
    queryKey: ['maintenance', 'log', vehicleId, logId ?? ''] as const,
    queryFn: async ({ signal }) =>
      (
        (await apiData(
          api.GET('/vehicles/{vehicle}/maintenance-logs/{log}', { params: { path: { vehicle: vehicleId, log: logId ?? '' } }, signal }),
        )) as unknown as Wrapped<MaintenanceLog>
      ).data,
    initialData: () =>
      client
        .getQueryData<LogsData>(maintenanceKeys.logs(vehicleId))
        ?.pages.flatMap((page) => page.data)
        .find((log) => log.id === logId),
    enabled: mayRead && vehicleId !== '' && Boolean(logId),
    refetchInterval: SIGNED_URL_REFRESH_MS,
    retry: retryUnlessAnswered,
  });
}
