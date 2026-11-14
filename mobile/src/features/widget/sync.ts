/**
 * Android widget "Mein Auto" (09 §8.14, ADR-454): the app keeps the widget's snapshot current and pushes each change to the
 * launcher; the widget itself only refreshes from the snapshot every 6 hours (updatePeriodMillis; the upstream ANR issue 165 rules out short periods).
 *
 * Writes follow the data, not the screens: whenever the garage list (`me/vehicles`), the upcoming maintenance or the app config
 * changes in the query cache, the snapshot is built again and written if it differs. A sign-in fetches both lists once; a
 * sign-out, an expired session or another member clears the snapshot and the photo, and the widget falls back to its empty
 * state. With the flag `android_widget` off the snapshot stays empty too.
 */
import type { Query, QueryClient } from '@tanstack/react-query';
import { hashKey } from '@tanstack/react-query';

import { appConfigKey, type AppConfigState } from '@/api/queries/appConfig';
import { MAINTENANCE_FLAG, maintenanceApi, maintenanceKeys, UPCOMING_LIMIT, type MaintenanceUpcoming } from '@/api/queries/maintenance';
import { fetchMyVehicles, myVehiclesKey, type VehicleCardData } from '@/api/queries/profile';
import type { DistanceUnit } from '@/features/maintenance/model';
import type { FormatLocale } from '@/lib/format';
import type { SessionStatus } from '@/state/session';

import type { TFunction } from 'i18next';

import { buildSnapshot, pickDue, pickMainVehicle, type WidgetPhoto, type WidgetSnapshot } from './snapshot';

export const WIDGET_FLAG = 'android_widget';
/** Bursts of cache updates (a sign-in answers several queries at once) become one write. */
export const SYNC_DEBOUNCE_MS = 400;
/** A sign-in reads the two lists unless the cache holds an answer at most this old. */
const PREFETCH_STALE_MS = 60 * 1000;

const WATCHED = new Set([hashKey(myVehiclesKey), hashKey(maintenanceKeys.upcoming), hashKey(appConfigKey)]);

type SessionLike = { status: SessionStatus; member: { id: string } | null };

export type WidgetSyncDeps = {
  queryClient: QueryClient;
  session: { getState: () => SessionLike; subscribe: (listener: (state: SessionLike, previous: SessionLike) => void) => () => void };
  /** The garage namespace in the member's current language. */
  translate: () => { t: TFunction<'garage'>; locale: FormatLocale };
  unit: () => DistanceUnit;
  qaForcesFlag?: (key: string) => boolean;
  read: () => Promise<WidgetSnapshot | null>;
  write: (snapshot: WidgetSnapshot) => Promise<void>;
  /** Removes the snapshot and every photo. */
  clearAll: () => void;
  /** Removes every photo but `keep` (a file URI); the snapshot stays. */
  prunePhotos: (keep: string | null) => void;
  photo: (media: VehicleCardData['cover'], previous: WidgetPhoto | null) => Promise<WidgetPhoto | null>;
  /** Redraws every placed widget from this snapshot (null: the empty state). */
  publish: (snapshot: WidgetSnapshot | null) => Promise<void>;
  now?: () => Date;
};

function flagOn(client: QueryClient, key: string, qa?: (key: string) => boolean): boolean {
  const state = client.getQueryData<AppConfigState>(appConfigKey);
  return state?.config.flags[key] === true || qa?.(key) === true;
}

/** Same content, so no write and no redraw. */
function sameSnapshot(a: WidgetSnapshot | null, b: WidgetSnapshot | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type WidgetSync = { stop: () => void; /** For tests: the queue of writes so far has settled. */ settled: () => Promise<void> };

export function startWidgetSync(deps: WidgetSyncDeps): WidgetSync {
  const { queryClient } = deps;
  const now = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((error: unknown) => console.warn('The widget could not be updated', error));
    return queue;
  };

  const clear = () =>
    enqueue(async () => {
      const previous = await deps.read();
      deps.clearAll();
      if (previous !== null) await deps.publish(null);
    });

  const sync = () =>
    enqueue(async () => {
      const { status, member } = deps.session.getState();
      if (status !== 'member' || !member) return;
      const previous = await deps.read();
      if (!flagOn(queryClient, WIDGET_FLAG, deps.qaForcesFlag)) {
        if (previous !== null) {
          deps.clearAll();
          await deps.publish(null);
        }
        return;
      }
      const vehicles = queryClient.getQueryData<VehicleCardData[]>(myVehiclesKey);
      // Nothing known about the garage yet: keep what the widget shows.
      if (!vehicles) return;
      const own = previous?.member === member.id ? previous : null;
      const car = pickMainVehicle(vehicles);
      const photo = car ? await deps.photo(car.cover, own?.car?.photo ?? null) : null;
      const maintenanceOn = flagOn(queryClient, MAINTENANCE_FLAG, deps.qaForcesFlag);
      const upcoming = maintenanceOn ? queryClient.getQueryData<MaintenanceUpcoming[]>(maintenanceKeys.upcoming) : undefined;
      const { t, locale } = deps.translate();
      const snapshot = buildSnapshot({
        member: member.id,
        locale,
        unit: deps.unit(),
        now: now(),
        car,
        photo,
        due: car ? pickDue(t, upcoming, car.id, UPCOMING_LIMIT) : { due: null, known: false },
      });
      if (sameSnapshot(previous, snapshot)) return;
      await deps.write(snapshot);
      // Only the current photo stays: an older cut, or another member's, goes.
      deps.prunePhotos(photo?.uri ?? null);
      await deps.publish(snapshot);
    });

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void sync();
    }, SYNC_DEBOUNCE_MS);
  };

  const prefetch = () => {
    void queryClient.prefetchQuery({ queryKey: myVehiclesKey, queryFn: fetchMyVehicles, staleTime: PREFETCH_STALE_MS });
    if (flagOn(queryClient, MAINTENANCE_FLAG, deps.qaForcesFlag)) {
      void queryClient.prefetchQuery({
        queryKey: maintenanceKeys.upcoming,
        queryFn: ({ signal }) => maintenanceApi.upcoming(signal),
        staleTime: PREFETCH_STALE_MS,
      });
    }
  };

  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (WATCHED.has(hashKey((event.query as Query).queryKey))) schedule();
  });

  const unsubscribeSession = deps.session.subscribe((state, previous) => {
    if (state.status === 'guest' && previous.status !== 'guest') {
      if (timer) clearTimeout(timer);
      timer = null;
      void clear();
      return;
    }
    if (state.status !== 'member' || !state.member) return;
    const changed = previous.member !== null && previous.member.id !== state.member.id;
    if (changed) void clear();
    if (previous.status !== 'member' || changed) {
      prefetch();
      schedule();
    }
  });

  // Started with a member already restored (the cache came back from storage): bring the snapshot up to date once.
  const initial = deps.session.getState();
  if (initial.status === 'member') schedule();
  else if (initial.status === 'guest') void clear();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribeCache();
      unsubscribeSession();
    },
    settled: () => queue,
  };
}
