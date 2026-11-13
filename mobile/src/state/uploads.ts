/**
 * The upload queue of the garage photos (05_ARCHITECTURE §9): photos are prepared on the device (≤ 2560 px, JPEG), sent two
 * at a time, retried with backoff when the network drops and after a rate limit, and survive an app restart on native.
 * While the device is offline the queue pauses, and it starts again on reconnect. A failure stays in the queue with its
 * reason, so the member can retry or remove it (F2).
 *
 * The queue never decides what a screen shows: GAR-03, GAR-07 and GAR-10 read the items of their target and draw tiles from
 * them next to the photos the server already has.
 *
 * The queue belongs to one member. Sign-out, an expired session and a deleted account empty it (api/queries/auth.ts
 * clearLocalSession), and a stored queue only comes back for the member who left it. This module stays free of the API
 * client, so auth can import it: the real driver is features/garage/uploadDriver.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { UploadedMedia, UploadTarget } from '@/api/queries/media';
import { isNative } from '@/lib/platform';
import { useSessionStore } from '@/state/session';

export type { UploadTarget } from '@/api/queries/media';

export type UploadStatus =
  /** Waiting for a free slot. */
  | 'queued'
  /** Scaled down and re-encoded on the device. */
  | 'preparing'
  | 'uploading'
  /** A retry is scheduled, after a dropped connection or a rate limit. */
  | 'waiting'
  /** Stays until the member retries or removes it. */
  | 'failed'
  | 'done';

export type PickedPhoto = { uri: string; width: number; height: number };

export type UploadItem = {
  id: string;
  target: UploadTarget;
  /** The picked file, also the preview while it is prepared. */
  source: PickedPhoto;
  /** The JPEG that is sent, once prepared. Dropped once it arrived, or once a retry cannot help: on web it is the whole file. */
  preparedUri: string | null;
  status: UploadStatus;
  /** 0 to 1. */
  progress: number;
  /** Translated, safe to show on the tile. */
  error: string | null;
  /** False when the server refused the file itself (too large, over the allowance): a retry would only fail again. */
  retryable: boolean;
  attempts: number;
  /** One per photo, kept across retries, so a retry after a lost answer cannot upload it twice. */
  idempotencyKey: string;
  mediaId: string | null;
  createdAt: number;
  /**
   * The last try lost the connection: the queue starts it again by itself once the device is back online, so "Der Upload
   * startet neu, sobald du online bist" holds. Optional: a queue stored by an older build lacks it.
   */
  resumeOnline?: boolean;
};

/**
 * `retryAfter` (seconds) asks the queue to wait and try again by itself: a rate limit, or the server still busy with the
 * same photo. Longer than AUTOMATIC_WAIT_MAX_S, the tile fails instead and says how long to wait.
 */
export type UploadFailure = { message: string; retryable: boolean; retryAfter: number | null; network: boolean };

/** What the queue needs from the outside world. The app passes the real one; tests pass fakes. */
export type UploadDriver = {
  prepare: (photo: PickedPhoto) => Promise<string>;
  upload: (
    target: UploadTarget,
    preparedUri: string,
    idempotencyKey: string,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ) => Promise<UploadedMedia>;
  /** After a photo arrived: the screens read the vehicle or mod again. */
  onUploaded: (target: UploadTarget, media: UploadedMedia) => void;
  describe: (error: unknown) => UploadFailure;
  /** An item left the queue: frees what it held on the device (on web the picked file's blob: URL). */
  release?: (item: UploadItem) => void;
  newId: () => string;
  now: () => number;
  schedule: (run: () => void, ms: number) => void;
};

export const UPLOAD_CONCURRENCY = 2;
/** Automatic tries after a dropped connection, before the tile asks the member. */
export const MAX_AUTOMATIC_ATTEMPTS = 3;
/** Automatic tries after waits the server named, so a server that keeps answering "later" cannot keep a tile busy for ever. */
export const MAX_WAITED_ATTEMPTS = 8;
/** Backoff before the second and third try. */
export const BACKOFF_MS: readonly number[] = [2000, 6000];
const LAST_BACKOFF_MS = 6000;
/** The longest wait the queue sits out by itself; a longer one is the member's to retry, with the wait on the tile. */
export const AUTOMATIC_WAIT_MAX_S = 120;
const MIN_WAIT_MS = 1000;

type QueueState = {
  items: UploadItem[];
  enqueue: (target: UploadTarget, photos: readonly PickedPhoto[]) => string[];
  retry: (id: string) => void;
  /** Cancels a running upload, or removes a waiting or failed one. */
  cancel: (id: string) => void;
  /** Removes finished items of a target once the screen shows the server's copy: those of `mediaIds`, or all. */
  clearDone: (target: UploadTarget, mediaIds?: readonly string[]) => void;
};

/**
 * Connectivity as the queue sees it. While offline nothing starts and a lost connection costs no try; the switch back to
 * online starts again what the connection stopped. The app passes TanStack Query's onlineManager (NetInfo on native, the
 * browser's online events on web); without one the queue takes the device as always online.
 */
export type UploadNetwork = {
  isOnline: () => boolean;
  subscribe: (listener: (online: boolean) => void) => () => void;
};

const ALWAYS_ONLINE: UploadNetwork = { isOnline: () => true, subscribe: () => () => undefined };

/** What a stored queue holds: its items, and whose they are. */
type Stored = { owner: string | null; items: UploadItem[] };

export function sameTarget(a: UploadTarget, b: UploadTarget): boolean {
  if (a.kind !== b.kind || a.vehicleId !== b.vehicleId) return false;
  if (a.kind === 'mod') return b.kind === 'mod' && a.modId === b.modId;
  if (a.kind === 'update') return b.kind === 'update' && a.updateId === b.updateId;
  return true;
}

/** Items that still occupy a place: everything but what arrived. */
export function pendingFor(items: readonly UploadItem[], target: UploadTarget): UploadItem[] {
  return items.filter((item) => item.status !== 'done' && sameTarget(item.target, target));
}

/** After a restart nothing is running any more: what was on its way starts again from its prepared file. */
export function revive(items: readonly UploadItem[]): UploadItem[] {
  return items
    .filter((item) => item.status !== 'done')
    .map((item) =>
      item.status === 'failed' ? item : { ...item, status: 'queued' as const, progress: 0 },
    );
}

/**
 * A stored queue merged into the one that is running: only the member who left it gets it back, and what was enqueued
 * before the storage answered stays.
 */
export function mergeStored(stored: Partial<Stored> | undefined, current: readonly UploadItem[], owner: string | null): UploadItem[] {
  const mine = owner !== null && stored?.owner === owner ? revive(stored.items ?? []) : [];
  const running = new Set(current.map((item) => item.id));
  return [...mine.filter((item) => !running.has(item.id)), ...current];
}

export type UploadQueue = {
  store: StoreApi<QueueState>;
  /** Starts what fits into the free slots. Exposed for tests and for the restart. */
  pump: () => void;
  /** Stops everything at once, scheduled retries included, and empties the queue. */
  reset: () => void;
  /** Native, with a storage key: resolves once the stored queue is back (at once without one). */
  hydrated: () => Promise<void>;
};

export type UploadQueueOptions = {
  /** Keeps the queue across app restarts under this key. */
  persistKey?: string;
  /** Whose queue it is: a stored queue of anybody else is dropped. */
  owner?: () => string | null;
  /** Pauses the queue while offline (onlineNetwork in the app). */
  network?: UploadNetwork;
};

export function createUploadQueue(driver: UploadDriver, options: UploadQueueOptions = {}): UploadQueue {
  const controllers = new Map<string, AbortController>();
  const owner = options.owner ?? (() => null);
  const network = options.network ?? ALWAYS_ONLINE;
  // Bumped by reset(): whatever an earlier run or a scheduled retry still does afterwards is ignored.
  let generation = 0;

  const patch = (id: string, next: Partial<UploadItem>) =>
    store.setState((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...next } : item)) }));
  const find = (id: string) => store.getState().items.find((item) => item.id === id);
  const release = (items: readonly UploadItem[]) => {
    for (const item of items) driver.release?.(item);
  };

  async function run(id: string) {
    const round = generation;
    const controller = new AbortController();
    controllers.set(id, controller);
    const stale = () => round !== generation || controller.signal.aborted || !find(id);
    try {
      let item = find(id);
      if (!item) return;
      let preparedUri = item.preparedUri;
      if (!preparedUri) {
        patch(id, { status: 'preparing', progress: 0, error: null });
        preparedUri = await driver.prepare(item.source);
        if (stale()) return;
        patch(id, { preparedUri });
      }
      patch(id, { status: 'uploading', progress: 0, error: null });
      item = find(id);
      if (!item) return;
      const media = await driver.upload(item.target, preparedUri, item.idempotencyKey, (progress) => patch(id, { progress }), controller.signal);
      // Signed out meanwhile: nothing of this run reaches the next session.
      if (round !== generation) return;
      // The media id is all a finished tile needs; the prepared file can go (on web a data URI of the whole photo).
      patch(id, { status: 'done', progress: 1, mediaId: media.id, error: null, preparedUri: null });
      // Also when the tile was cancelled just as the answer came: the photo is on the server, so the screens read again.
      driver.onUploaded(item.target, media);
    } catch (error) {
      if (stale()) return;
      const failure = driver.describe(error);
      if (failure.network && failure.retryable && !network.isOnline()) {
        // The device is offline: the try does not count, and the switch back to online starts it again (resumeAll).
        patch(id, { status: 'waiting', error: failure.message, retryable: true, progress: 0, resumeOnline: true });
        return;
      }
      const attempts = (find(id)?.attempts ?? 0) + 1;
      const waited = failure.retryAfter !== null && failure.retryAfter <= AUTOMATIC_WAIT_MAX_S && attempts < MAX_WAITED_ATTEMPTS;
      const automatic = failure.retryable && (waited || (failure.retryAfter === null && failure.network && attempts < MAX_AUTOMATIC_ATTEMPTS));
      if (automatic) {
        const wait =
          failure.retryAfter !== null
            ? Math.max(MIN_WAIT_MS, failure.retryAfter * 1000)
            : BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? LAST_BACKOFF_MS;
        patch(id, { status: 'waiting', attempts, error: failure.message, retryable: true, progress: 0, resumeOnline: failure.network });
        driver.schedule(() => {
          if (round !== generation || find(id)?.status !== 'waiting') return;
          // Offline by now: it keeps waiting, and the switch back to online starts it.
          if (!network.isOnline()) {
            patch(id, { resumeOnline: true });
            return;
          }
          patch(id, { status: 'queued' });
          pump();
        }, wait);
      } else {
        patch(id, {
          status: 'failed',
          attempts,
          error: failure.message,
          retryable: failure.retryable,
          progress: 0,
          // Nothing will send it again; a retry the member still asks for prepares it anew.
          ...(failure.retryable ? {} : { preparedUri: null }),
          // Out of tries on a connection that kept dropping: the next switch back to online starts it again by itself.
          resumeOnline: failure.retryable && failure.network,
        });
      }
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id);
      if (round === generation) pump();
    }
  }

  function pump() {
    // Offline nothing starts: every try would fail and use up the tries the member gets before the tile asks.
    if (!network.isOnline()) return;
    const items = store.getState().items;
    const running = items.filter((item) => item.status === 'preparing' || item.status === 'uploading').length;
    const free = UPLOAD_CONCURRENCY - running;
    if (free <= 0) return;
    const next = items.filter((item) => item.status === 'queued').slice(0, free);
    for (const item of next) {
      // Marked before the async start, so a second pump in the same tick does not take it as well.
      patch(item.id, { status: item.preparedUri ? 'uploading' : 'preparing' });
      void run(item.id);
    }
  }

  /** Back online: what the connection stopped starts again with fresh tries, then the free slots fill. */
  function resumeAll() {
    if (!network.isOnline()) return;
    const stopped = new Set(
      store
        .getState()
        .items.filter((item) => item.resumeOnline && (item.status === 'waiting' || item.status === 'failed'))
        .map((item) => item.id),
    );
    if (stopped.size > 0) {
      store.setState((state) => ({
        items: state.items.map((item) =>
          stopped.has(item.id) ? { ...item, status: 'queued' as const, attempts: 0, error: null, progress: 0, resumeOnline: false } : item,
        ),
      }));
    }
    pump();
  }

  function reset() {
    generation += 1;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    const gone = store.getState().items;
    store.setState({ items: [] });
    release(gone);
  }

  const initializer = (set: StoreApi<QueueState>['setState']): QueueState => ({
    items: [],
    enqueue: (target, photos) => {
      const created = photos.map(
        (source): UploadItem => ({
          id: driver.newId(),
          target,
          source,
          preparedUri: null,
          status: 'queued',
          progress: 0,
          error: null,
          retryable: true,
          attempts: 0,
          idempotencyKey: driver.newId(),
          mediaId: null,
          createdAt: driver.now(),
        }),
      );
      set((state) => ({ items: [...state.items, ...created] }));
      pump();
      return created.map((item) => item.id);
    },
    retry: (id) => {
      const item = find(id);
      if (!item || (item.status !== 'failed' && item.status !== 'waiting')) return;
      patch(id, { status: 'queued', error: null, attempts: 0, progress: 0, resumeOnline: false });
      pump();
    },
    cancel: (id) => {
      controllers.get(id)?.abort();
      controllers.delete(id);
      const gone = store.getState().items.filter((item) => item.id === id);
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      release(gone);
      pump();
    },
    clearDone: (target, mediaIds) => {
      const finished = (item: UploadItem) =>
        item.status === 'done' && sameTarget(item.target, target) && (!mediaIds || (item.mediaId !== null && mediaIds.includes(item.mediaId)));
      const gone = store.getState().items.filter(finished);
      if (gone.length === 0) return;
      set((state) => ({ items: state.items.filter((item) => !finished(item)) }));
      release(gone);
    },
  });

  const persistKey = options.persistKey;
  const store: StoreApi<QueueState> = persistKey
    ? createStore<QueueState>()(
        persist((set) => initializer(set), {
          name: persistKey,
          storage: createJSONStorage(() => AsyncStorage),
          partialize: (state) => ({ owner: owner(), items: state.items.filter((item) => item.status !== 'done') }) as unknown as QueueState,
          merge: (stored, current) => ({ ...current, items: mergeStored(stored as Partial<Stored> | undefined, current.items, owner()) }),
          // Online at the start counts as a reconnect: a tile that ran out of tries offline starts again too.
          onRehydrateStorage: () => () => resumeAll(),
        }),
      )
    : createStore<QueueState>()((set) => initializer(set));

  const hydrated = (): Promise<void> => {
    const api = (store as StoreApi<QueueState> & { persist?: { hasHydrated: () => boolean; onFinishHydration: (listener: () => void) => () => void } }).persist;
    if (!api || api.hasHydrated()) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = api.onFinishHydration(() => {
        stop();
        resolve();
      });
    });
  };

  // Lives as long as the queue, which the app makes once per run (appUploadQueue).
  network.subscribe((online) => {
    if (online) resumeAll();
  });

  return { store, pump, reset, hydrated };
}

/** TanStack Query's view of the connection, fed from NetInfo on native (api/queryClient.ts) and the browser on web. */
export const onlineNetwork: UploadNetwork = {
  isOnline: () => onlineManager.isOnline(),
  subscribe: (listener) => onlineManager.subscribe(listener),
};

/** The storage key of the queue; it holds file paths on the device and the id of the member they belong to. */
export const UPLOAD_QUEUE_STORAGE_KEY = 'sc.uploadQueue';

function currentMember(): string | null {
  const session = useSessionStore.getState();
  return session.status === 'member' ? (session.member?.id ?? null) : null;
}

let appQueue: UploadQueue | null = null;

/** The app's queue, made once with the real driver (features/garage/uploads.ts hands it over). */
export function appUploadQueue(makeDriver: () => UploadDriver): UploadQueue {
  // A web page cannot open its picked files again after a reload, so only native keeps the queue.
  appQueue ??= createUploadQueue(
    makeDriver(),
    isNative
      ? { persistKey: UPLOAD_QUEUE_STORAGE_KEY, owner: currentMember, network: onlineNetwork }
      : { owner: currentMember, network: onlineNetwork },
  );
  return appQueue;
}

/** Sign-out, an expired session, a deleted account: the queue holds the member's files and must not reach the next account. */
export async function clearUploads(): Promise<void> {
  appQueue?.reset();
  // Also when this run never opened the queue: a stored one would otherwise come back after the next sign-in.
  if (isNative) await AsyncStorage.removeItem(UPLOAD_QUEUE_STORAGE_KEY);
}

/**
 * After an app restart the queue starts again as soon as the member is back, not only once a photo screen opens
 * (05_ARCHITECTURE §9). auth.ts imports this module, so the subscription exists from the app's start. Only a stored queue
 * brings in the driver, which reaches the API client and auth: hence the inline require, which keeps the imports acyclic.
 */
export async function resumeStoredUploads(): Promise<void> {
  if (appQueue || !isNative) return;
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(UPLOAD_QUEUE_STORAGE_KEY);
  } catch {
    return;
  }
  if (!stored || appQueue || currentMember() === null) return;
  const { createGarageUploadDriver } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/features/garage/uploadDriver') as typeof import('@/features/garage/uploadDriver');
  appUploadQueue(createGarageUploadDriver);
}

useSessionStore.subscribe((state, previous) => {
  if (state.status === 'member' && previous.status !== 'member') void resumeStoredUploads();
});
