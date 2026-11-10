import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import type { UploadedMedia } from '@/api/queries/media';
import { dataUriToBlob } from '@/features/garage/photos';
import { describeUploadError } from '@/features/garage/uploadDriver';
import { visibleUploads } from '@/features/garage/uploads';
import {
  createUploadQueue,
  mergeStored,
  MAX_WAITED_ATTEMPTS,
  onlineNetwork,
  pendingFor,
  revive,
  sameTarget,
  UPLOAD_CONCURRENCY,
  type UploadDriver,
  type UploadFailure,
  type UploadItem,
  type UploadNetwork,
  type UploadQueueOptions,
} from '@/state/uploads';

import { media } from './fixtures';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

type Pending = { resolve: (media: UploadedMedia) => void; reject: (error: unknown) => void; progress: (fraction: number) => void; signal: AbortSignal; key: string };

function harness(describe: (error: unknown) => UploadFailure = describeUploadError, options: UploadQueueOptions = {}, ids = { next: 0 }) {
  const pending: Pending[] = [];
  const scheduled: { run: () => void; ms: number }[] = [];
  const uploaded: string[] = [];
  const released: string[] = [];
  const driver: UploadDriver = {
    prepare: jest.fn(async (photo) => `${photo.uri}.jpg`),
    upload: jest.fn(
      (_target, _uri, key, onProgress, signal) =>
        new Promise<UploadedMedia>((resolve, reject) => {
          pending.push({ resolve, reject, progress: onProgress, signal, key });
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    ),
    onUploaded: jest.fn((_target, item) => uploaded.push(item.id)),
    describe,
    release: (item) => released.push(item.id),
    newId: () => `id-${(ids.next += 1)}`,
    now: () => 1,
    schedule: (run, ms) => scheduled.push({ run, ms }),
  };
  const queue = createUploadQueue(driver, options);
  const state = () => queue.store.getState();
  return { queue, state, driver, pending, scheduled, uploaded, released };
}

/** A connection the test switches by hand; listeners hear every change, as from onlineManager. */
function fakeNetwork(initial: boolean): UploadNetwork & { set: (online: boolean) => void } {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next === online) return;
      online = next;
      for (const listener of listeners) listener(next);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const vehicle = { kind: 'vehicle', vehicleId: 'v1' } as const;
const photo = (name: string) => ({ uri: `file:///${name}`, width: 4000, height: 3000 });

describe('upload queue', () => {
  it('prepares and sends two at a time, then the next', async () => {
    const { state, pending } = harness();
    state().enqueue(vehicle, [photo('a'), photo('b'), photo('c')]);
    await flush();
    expect(UPLOAD_CONCURRENCY).toBe(2);
    expect(pending).toHaveLength(2);
    expect(state().items.map((item) => item.status)).toEqual(['uploading', 'uploading', 'queued']);
    expect(state().items[0]?.preparedUri).toBe('file:///a.jpg');
    pending[0]?.progress(0.4);
    expect(state().items[0]?.progress).toBe(0.4);
    pending[0]?.resolve(media('m1'));
    await flush();
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'done', mediaId: 'm1', progress: 1 });
    expect(pending).toHaveLength(3);
  });

  it('keeps one idempotency key per photo across retries', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    const first = pending[0]?.key;
    pending[0]?.reject(new ApiError({ kind: 'network', status: 0, code: 'network', message: 'offline' }));
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'waiting', attempts: 1, retryable: true });
    expect(scheduled[0]?.ms).toBe(2000);
    scheduled[0]?.run();
    await flush();
    expect(pending[1]?.key).toBe(first);
  });

  it('gives up after three dropped connections and waits for the member', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a')]);
    const network = () => new ApiError({ kind: 'network', status: 0, code: 'network', message: 'offline' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await flush();
      pending[attempt]?.reject(network());
      await flush();
      if (attempt < 2) scheduled[attempt]?.run();
    }
    expect(scheduled.map((entry) => entry.ms)).toEqual([2000, 6000]);
    expect(state().items[0]).toMatchObject({ status: 'failed', attempts: 3, retryable: true });
    state().retry(state().items[0]?.id ?? '');
    await flush();
    expect(state().items[0]?.status).toBe('uploading');
  });

  it('waits out a rate limit with the server’s Retry-After', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    pending[0]?.reject(new ApiError({ kind: 'rate_limited', status: 429, code: 'rate_limited', message: 'slow down', retryAfter: 30 }));
    await flush();
    expect(state().items[0]?.status).toBe('waiting');
    expect(scheduled[0]?.ms).toBe(30000);
  });

  it('stops for good when the server refuses the file itself', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    pending[0]?.reject(new ApiError({ kind: 'validation', status: 422, code: 'validation_failed', message: 'x', fieldErrors: { file: ['Dein Speicher ist voll.'] } }));
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'failed', retryable: false, error: 'Dein Speicher ist voll.' });
    expect(scheduled).toHaveLength(0);
  });

  it('cancels a running upload and starts the next one', async () => {
    const { state, pending } = harness();
    state().enqueue(vehicle, [photo('a'), photo('b'), photo('c')]);
    await flush();
    const first = state().items[0]?.id ?? '';
    state().cancel(first);
    await flush();
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(state().items.map((item) => item.id)).not.toContain(first);
    expect(pending).toHaveLength(3);
  });

  it('tells the screens about a finished photo, and they clear it once listed', async () => {
    const { state, pending, driver } = harness();
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    pending[0]?.resolve(media('m1'));
    await flush();
    expect(driver.onUploaded).toHaveBeenCalledWith(vehicle, expect.objectContaining({ id: 'm1' }));
    expect(visibleUploads(state().items, vehicle, [])).toHaveLength(1);
    expect(visibleUploads(state().items, vehicle, [media('m1')])).toHaveLength(0);
    state().clearDone(vehicle, ['other']);
    expect(state().items).toHaveLength(1);
    state().clearDone(vehicle, ['m1']);
    expect(state().items).toHaveLength(0);
  });

  it('restarts what was on its way after an app restart, failures stay', () => {
    const base = { target: vehicle, source: photo('a'), preparedUri: 'file:///a.jpg', progress: 0.5, error: null, retryable: true, attempts: 1, idempotencyKey: 'k', mediaId: null, createdAt: 1 };
    const revived = revive([
      { ...base, id: '1', status: 'uploading' },
      { ...base, id: '2', status: 'failed' },
      { ...base, id: '3', status: 'done' },
    ]);
    expect(revived.map((item) => [item.id, item.status, item.progress])).toEqual([
      ['1', 'queued', 0],
      ['2', 'failed', 0.5],
    ]);
  });

  it('sits out a 409 while the server is still busy with the same key, and stops at a key used for another file', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a'), photo('b')]);
    await flush();
    // The automatic retry after a dropped connection meets the first try still running on the server.
    pending[0]?.reject(new ApiError({ kind: 'conflict', status: 409, code: 'conflict', message: 'Diese Anfrage läuft noch.', retryAfter: 2 }));
    pending[1]?.reject(new ApiError({ kind: 'conflict', status: 409, code: 'conflict', message: 'Dieser Schlüssel gehört zu einer anderen Anfrage.' }));
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'waiting', retryable: true, error: 'Der Server verarbeitet dieses Foto noch. Es geht gleich automatisch weiter.' });
    expect(scheduled.map((entry) => entry.ms)).toEqual([2000]);
    expect(state().items[1]).toMatchObject({ status: 'failed', retryable: false, error: 'Dieser Schlüssel gehört zu einer anderen Anfrage.', preparedUri: null });
    scheduled[0]?.run();
    await flush();
    expect(pending).toHaveLength(3);
    expect(pending[2]?.key).toBe(pending[0]?.key);
  });

  it('leaves a rate limit longer than two minutes to the member, with the wait on the tile', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    pending[0]?.reject(new ApiError({ kind: 'rate_limited', status: 429, code: 'rate_limited', message: 'slow down', retryAfter: 2400 }));
    await flush();
    expect(scheduled).toHaveLength(0);
    expect(state().items[0]).toMatchObject({
      status: 'failed',
      retryable: true,
      error: 'Du hast gerade sehr viele Fotos hochgeladen. Versuche es in 40 Minuten noch einmal.',
    });
    // The prepared file stays for the member's retry.
    expect(state().items[0]?.preparedUri).toBe('file:///a.jpg');
  });

  it('stops waiting by itself after a bounded number of named waits', async () => {
    const { state, pending, scheduled } = harness();
    state().enqueue(vehicle, [photo('a')]);
    for (let attempt = 0; attempt < MAX_WAITED_ATTEMPTS; attempt += 1) {
      await flush();
      pending[attempt]?.reject(new ApiError({ kind: 'rate_limited', status: 429, code: 'rate_limited', message: 'slow down', retryAfter: 5 }));
      await flush();
      scheduled[attempt]?.run();
    }
    expect(scheduled).toHaveLength(MAX_WAITED_ATTEMPTS - 1);
    expect(state().items[0]).toMatchObject({ status: 'failed', retryable: true, attempts: MAX_WAITED_ATTEMPTS });
  });

  it('drops the prepared file once a photo arrived, and frees the picked file when an item leaves the queue', async () => {
    const { state, pending, released } = harness();
    state().enqueue(vehicle, [photo('a'), photo('b')]);
    await flush();
    pending[0]?.resolve(media('m1'));
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'done', mediaId: 'm1', preparedUri: null });
    expect(released).toEqual([]);
    state().clearDone(vehicle, ['m1']);
    state().cancel(state().items[0]?.id ?? '');
    expect(released).toEqual(['id-1', 'id-3']);
  });

  it('stops running uploads and scheduled retries at once when reset, as at a sign-out', async () => {
    const { queue, state, pending, scheduled, released, driver } = harness();
    state().enqueue(vehicle, [photo('a'), photo('b'), photo('c')]);
    await flush();
    pending[0]?.reject(new ApiError({ kind: 'network', status: 0, code: 'network', message: 'offline' }));
    await flush();
    expect(state().items[0]?.status).toBe('waiting');
    queue.reset();
    expect(state().items).toEqual([]);
    expect(pending.slice(1).every((entry) => entry.signal.aborted)).toBe(true);
    expect(released).toHaveLength(3);
    const sent = jest.mocked(driver.upload).mock.calls.length;
    scheduled[0]?.run();
    await flush();
    expect(jest.mocked(driver.upload).mock.calls.length).toBe(sent);
  });

  it('keeps the queue across an app restart, for the member who left it only', async () => {
    const key = 'test.uploadQueue';
    const owner: { id: string | null } = { id: 'm1' };
    const options = { persistKey: key, owner: () => owner.id };
    const ids = { next: 0 };
    const before = harness(describeUploadError, options, ids);
    await before.queue.hydrated();
    before.state().enqueue(vehicle, [photo('a')]);
    await flush();
    expect(before.state().items[0]?.status).toBe('uploading');
    const stored = JSON.parse((await AsyncStorage.getItem(key)) ?? 'null') as { state: { owner: string; items: UploadItem[] } };
    expect(stored.state.owner).toBe('m1');
    expect(stored.state.items.map((item) => item.preparedUri)).toEqual(['file:///a.jpg']);

    // The restart: a new queue on the same key starts what was on its way, from its prepared file and with its key.
    const after = harness(describeUploadError, options, ids);
    await after.queue.hydrated();
    await flush();
    expect(after.state().items).toHaveLength(1);
    expect(after.pending).toHaveLength(1);
    expect(after.pending[0]?.key).toBe(before.pending[0]?.key);
    expect(after.driver.prepare).not.toHaveBeenCalled();

    // Somebody else on the same device gets nothing of it.
    owner.id = 'm2';
    const other = harness(describeUploadError, options, ids);
    await other.queue.hydrated();
    await flush();
    expect(other.state().items).toEqual([]);
    expect(other.pending).toHaveLength(0);
    before.queue.reset();
    after.queue.reset();
    await AsyncStorage.removeItem(key);
  });

  it('keeps what was enqueued before the stored queue came back', () => {
    const base = { target: vehicle, source: photo('a'), preparedUri: 'file:///a.jpg', progress: 0, error: null, retryable: true, attempts: 0, idempotencyKey: 'k', mediaId: null, createdAt: 1 };
    const storedItem: UploadItem = { ...base, id: 'old', status: 'uploading' };
    const fresh: UploadItem = { ...base, id: 'new', status: 'preparing' };
    expect(mergeStored({ owner: 'm1', items: [storedItem] }, [fresh], 'm1').map((item) => [item.id, item.status])).toEqual([
      ['old', 'queued'],
      ['new', 'preparing'],
    ]);
    expect(mergeStored({ owner: 'm1', items: [storedItem] }, [fresh], 'm2').map((item) => item.id)).toEqual(['new']);
    expect(mergeStored({ owner: 'm1', items: [storedItem] }, [fresh], null).map((item) => item.id)).toEqual(['new']);
    expect(mergeStored(undefined, [], 'm1')).toEqual([]);
  });

  it('starts nothing while offline and sends what waits once the device is back online', async () => {
    const network = fakeNetwork(false);
    const { state, pending, driver } = harness(describeUploadError, { network });
    state().enqueue(vehicle, [photo('a'), photo('b'), photo('c')]);
    await flush();
    expect(driver.prepare).not.toHaveBeenCalled();
    expect(pending).toHaveLength(0);
    expect(state().items.map((item) => item.status)).toEqual(['queued', 'queued', 'queued']);
    network.set(true);
    await flush();
    expect(pending).toHaveLength(UPLOAD_CONCURRENCY);
    expect(state().items.map((item) => item.status)).toEqual(['uploading', 'uploading', 'queued']);
  });

  it('spends no tries while offline: a dropped connection waits for the reconnect, three times over', async () => {
    const network = fakeNetwork(true);
    const { state, pending, scheduled } = harness(describeUploadError, { network });
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    const key = pending[0]?.key;
    for (let drop = 0; drop < 3; drop += 1) {
      network.set(false);
      pending[drop]?.reject(new ApiError({ kind: 'network', status: 0, code: 'network', message: 'offline' }));
      await flush();
      expect(state().items[0]).toMatchObject({
        status: 'waiting',
        attempts: 0,
        retryable: true,
        error: 'Keine Verbindung. Der Upload startet neu, sobald du online bist.',
      });
      expect(scheduled).toHaveLength(0);
      expect(pending).toHaveLength(drop + 1);
      network.set(true);
      await flush();
      expect(state().items[0]).toMatchObject({ status: 'uploading', attempts: 0, error: null });
      expect(pending).toHaveLength(drop + 2);
    }
    expect(pending.every((entry) => entry.key === key)).toBe(true);
  });

  it('keeps a scheduled retry waiting when the device went offline meanwhile, and runs it on reconnect', async () => {
    const network = fakeNetwork(true);
    const { state, pending, scheduled } = harness(describeUploadError, { network });
    state().enqueue(vehicle, [photo('a')]);
    await flush();
    // The connection dropped before the device knew: that try counts and a backoff is scheduled.
    pending[0]?.reject(new ApiError({ kind: 'network', status: 0, code: 'network', message: 'offline' }));
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'waiting', attempts: 1 });
    network.set(false);
    scheduled[0]?.run();
    await flush();
    expect(state().items[0]?.status).toBe('waiting');
    expect(pending).toHaveLength(1);
    network.set(true);
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'uploading', attempts: 0 });
    expect(pending).toHaveLength(2);
  });

  it('starts a tile that ran out of tries on a dropped connection again on reconnect, not one the server refused', async () => {
    const network = fakeNetwork(true);
    const { state, pending, scheduled } = harness(describeUploadError, { network });
    state().enqueue(vehicle, [photo('a')]);
    // The device still reports online, so these drops count until the tile asks the member.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await flush();
      pending[attempt]?.reject(new ApiError({ kind: 'network', status: 0, code: 'network', message: 'offline' }));
      await flush();
      if (attempt < 2) scheduled[attempt]?.run();
    }
    state().enqueue(vehicle, [photo('b')]);
    await flush();
    pending[3]?.reject(new ApiError({ kind: 'validation', status: 422, code: 'validation_failed', message: 'x', fieldErrors: { file: ['Dein Speicher ist voll.'] } }));
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'failed', attempts: 3, resumeOnline: true });
    expect(state().items[1]).toMatchObject({ status: 'failed', retryable: false, resumeOnline: false });
    const sent = pending.length;
    network.set(false);
    network.set(true);
    await flush();
    expect(state().items[0]).toMatchObject({ status: 'uploading', attempts: 0, error: null });
    expect(state().items[1]?.status).toBe('failed');
    expect(pending).toHaveLength(sent + 1);
  });

  it('follows TanStack Query’s online state in the app', async () => {
    const { state, pending } = harness(describeUploadError, { network: onlineNetwork });
    onlineManager.setOnline(false);
    try {
      expect(onlineNetwork.isOnline()).toBe(false);
      state().enqueue(vehicle, [photo('a')]);
      await flush();
      expect(pending).toHaveLength(0);
      onlineManager.setOnline(true);
      await flush();
      expect(pending).toHaveLength(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('matches targets per vehicle and per mod', () => {
    const mod = { kind: 'mod', vehicleId: 'v1', modId: 'm1' } as const;
    expect(sameTarget(vehicle, { kind: 'vehicle', vehicleId: 'v1' })).toBe(true);
    expect(sameTarget(vehicle, mod)).toBe(false);
    expect(sameTarget(mod, { ...mod, modId: 'm2' })).toBe(false);
    expect(pendingFor([], vehicle)).toEqual([]);
  });
});

describe('web photo bytes', () => {
  it('decodes a prepared data URI without a request, which the CSP of /app would refuse', () => {
    const blob = dataUriToBlob('data:image/jpeg;base64,/9j/AA==');
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(4);
  });
});

describe('upload errors', () => {
  it('says what happened in plain language', () => {
    expect(describeUploadError(new ApiError({ kind: 'server', status: 413, code: 'payload_too_large', message: 'x' }))).toMatchObject({
      message: 'Das Foto ist größer als 15 MB. Wähle ein kleineres Foto.',
      retryable: false,
    });
    expect(describeUploadError(new ApiError({ kind: 'server', status: 500, code: 'server', message: 'x' })).retryable).toBe(true);
    expect(describeUploadError(new Error('decode')).retryable).toBe(false);
  });
});
