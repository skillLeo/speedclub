/**
 * The app's one upload queue and the session (05_ARCHITECTURE §9): a stored queue starts again as soon as its member is
 * back, without any photo screen, and every way a session ends empties it, its storage and its scheduled retries included.
 * One file, because the queue is a module singleton: the tests run in order on the same queue.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLocalSession } from '@/api/queries/auth';
import type { UploadedMedia } from '@/api/queries/media';
import { setGuest, setMember } from '@/state/session';
import { appUploadQueue, UPLOAD_QUEUE_STORAGE_KEY, type UploadDriver, type UploadItem } from '@/state/uploads';

type Pending = { key: string; signal: AbortSignal; reject: (error: unknown) => void };

const mockPending: Pending[] = [];
const mockScheduled: (() => void)[] = [];
const mockDriver: UploadDriver = {
  prepare: jest.fn(async (photo) => `${photo.uri}.jpg`),
  upload: jest.fn(
    (_target, _uri, key, _onProgress, signal) =>
      new Promise<UploadedMedia>((_resolve, reject) => {
        mockPending.push({ key, signal, reject });
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  ),
  onUploaded: jest.fn(),
  describe: () => ({ message: 'Keine Verbindung.', retryable: true, retryAfter: null, network: true }),
  newId: (() => {
    let next = 0;
    return () => `new-${(next += 1)}`;
  })(),
  now: () => 1,
  schedule: (run) => {
    mockScheduled.push(run);
  },
};

// The real driver reaches the picker, the image manipulator and XMLHttpRequest; the queue only needs its shape.
jest.mock('@/features/garage/uploadDriver', () => ({ createGarageUploadDriver: () => mockDriver }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  setItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const MEMBER = { id: '01nina', username: 'nina.neu', displayName: 'Nina', avatarUrl: null, nextStep: null };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function storedItem(id: string, status: UploadItem['status']): UploadItem {
  return {
    id,
    target: { kind: 'vehicle', vehicleId: '01vehicle' },
    source: { uri: `file:///${id}`, width: 4000, height: 3000 },
    preparedUri: `file:///${id}.jpg`,
    status,
    progress: 0.4,
    error: null,
    retryable: true,
    attempts: 0,
    idempotencyKey: `key-${id}`,
    mediaId: null,
    createdAt: 1,
  };
}

afterAll(() => setGuest());

it('starts a stored queue as soon as its member is back, before any photo screen opens', async () => {
  await AsyncStorage.setItem(
    UPLOAD_QUEUE_STORAGE_KEY,
    JSON.stringify({ state: { owner: MEMBER.id, items: [storedItem('a', 'uploading'), storedItem('b', 'waiting')] }, version: 0 }),
  );
  setMember(MEMBER);
  await jestWait(() => mockPending.length === 2);
  expect(mockPending.map((entry) => entry.key)).toEqual(['key-a', 'key-b']);
  expect(mockDriver.prepare).not.toHaveBeenCalled();
});

it('empties the queue on sign-out: running uploads stop, scheduled retries do nothing, and the stored copy is gone', async () => {
  const queue = appUploadQueue(() => mockDriver);
  // One upload drops its connection and waits for its automatic retry.
  mockPending[0]?.reject(new Error('offline'));
  await jestWait(() => mockScheduled.length === 1);
  expect(queue.store.getState().items.map((item) => item.status)).toEqual(['waiting', 'uploading']);

  setGuest();
  await clearLocalSession();

  expect(queue.store.getState().items).toEqual([]);
  expect(mockPending[1]?.signal.aborted).toBe(true);
  expect(await AsyncStorage.getItem(UPLOAD_QUEUE_STORAGE_KEY)).toBeNull();
  const sent = jest.mocked(mockDriver.upload).mock.calls.length;
  mockScheduled[0]?.();
  await flush();
  expect(jest.mocked(mockDriver.upload).mock.calls.length).toBe(sent);
});

it('forgets a stored queue at sign-out also when this run never opened it', async () => {
  await AsyncStorage.setItem(UPLOAD_QUEUE_STORAGE_KEY, JSON.stringify({ state: { owner: MEMBER.id, items: [storedItem('c', 'queued')] }, version: 0 }));
  await clearLocalSession();
  expect(await AsyncStorage.getItem(UPLOAD_QUEUE_STORAGE_KEY)).toBeNull();
});

/** Polls a condition on real timers: the persist middleware and the queue settle over a few microtask rounds. */
async function jestWait(condition: () => boolean, rounds = 200): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    if (condition()) return;
    await flush();
  }
  throw new Error('condition not met');
}
