// Token rotation (05_ARCHITECTURE §7) against requests in flight and lost answers. The old token only lives 120 s after the
// first rotation commits (RotateMemberToken), so no request may lose the session to it, and the keychain must end up with the
// answer of the last call.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, apiData, onApiGateEvent } from '@/api/client';
import { rotateTokenIfDue } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { restoreMember } from '@/features/auth/sessionLifecycle';
import { setGuest, setMember, useSessionStore } from '@/state/session';

const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockKeychain.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockKeychain.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockKeychain.delete(key);
    return Promise.resolve();
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-03T12:00:00Z');
/** Issued ten days ago: due, since rotation starts after seven. */
const DUE_EXPIRY = new Date(NOW + 80 * DAY_MS).toISOString();
/** Issued a day ago. */
const FRESH_EXPIRY = new Date(NOW + 89 * DAY_MS).toISOString();
const NEW_EXPIRY = new Date(NOW + 90 * DAY_MS).toISOString();

const ME = {
  id: '01JMEMBER',
  email: 'lukas@speedclub.test',
  email_verified: true,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  username: 'lukas.sc',
  username_change_available_at: null,
  display_name: 'Lukas',
  city: 'Stuttgart',
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps',
  member_since: '2023-03-01T00:00:00Z',
  stats: { vehicles: 3, followers: 128, following: 87 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UNAUTHENTICATED = { message: 'Bitte melde dich an.', code: 'unauthenticated', errors: {} };
const rotated = () => json(200, { data: { token: 'new-token', token_expires_at: NEW_EXPIRY, member: ME } });

type Pending = { resolve: (response: Response) => void };
function deferred(): { promise: Promise<Response> } & Pending {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const fetchMock = jest.fn<Promise<Response>, [Request]>();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Lets promise chains and response bodies finish while the timers are fake: setImmediate stays real. */
async function settle() {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}
const pathOf = (request: Request) => new URL(request.url).pathname;
const bearer = (request: Request) => request.headers.get('Authorization');
const callsTo = (path: string) => fetchMock.mock.calls.map(([request]) => request).filter((request) => pathOf(request) === path);

let gateEvents: string[] = [];
let stopListening: () => void = () => undefined;

// adoptMe writes the app's own client, whose 24-hour collection timer would outlive the file.
afterAll(() => queryClient.clear());

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(async () => {
  fetchMock.mockReset();
  mockKeychain.clear();
  await AsyncStorage.clear();
  queryClient.clear();
  useSessionStore.setState({ status: 'loading', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
  gateEvents = [];
  stopListening = onApiGateEvent((event) => gateEvents.push(event));
});

afterEach(() => stopListening());

function signedInWith(expiry: string) {
  mockKeychain.set('sc.authToken', 'old-token');
  mockKeychain.set('sc.authTokenExpiresAt', expiry);
  setMember({ id: ME.id, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
}

describe('rotating the token', () => {
  it('asks nothing while the token is younger than seven days', async () => {
    signedInWith(FRESH_EXPIRY);
    await rotateTokenIfDue(NOW);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockKeychain.get('sc.authToken')).toBe('old-token');
  });

  it('stores the new token and its expiry once it is due', async () => {
    signedInWith(DUE_EXPIRY);
    fetchMock.mockResolvedValueOnce(rotated());
    await rotateTokenIfDue(NOW);
    const [rotate] = callsTo('/api/v1/auth/token/rotate');
    expect(rotate?.method).toBe('POST');
    expect(bearer(rotate!)).toBe('Bearer old-token');
    // This install's id, as at sign-in: the successor token belongs to this device alone.
    expect(await rotate!.json()).toEqual({ device_id: 'uuid-1' });
    expect(mockKeychain.get('sc.authToken')).toBe('new-token');
    expect(mockKeychain.get('sc.authTokenExpiresAt')).toBe(NEW_EXPIRY);
  });

  it('keeps the old token on a 409 conflict, and the session with it', async () => {
    signedInWith(DUE_EXPIRY);
    fetchMock.mockResolvedValueOnce(json(409, { message: 'Konflikt', code: 'conflict', errors: {} }));
    await rotateTokenIfDue(NOW);
    expect(mockKeychain.get('sc.authToken')).toBe('old-token');
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', notice: null });
  });

  it('holds a parallel request until the new token is stored, and sends that one', async () => {
    signedInWith(DUE_EXPIRY);
    const rotation = deferred();
    fetchMock.mockImplementation((request) =>
      pathOf(request).endsWith('/auth/token/rotate') ? rotation.promise : Promise.resolve(json(200, { data: [] })),
    );
    const rotating = rotateTokenIfDue(NOW);
    const parallel = apiData(api.GET('/me/vehicles'));
    await flush();
    expect(callsTo('/api/v1/me/vehicles')).toHaveLength(0);

    rotation.resolve(rotated());
    await rotating;
    await parallel;

    const [vehicles] = callsTo('/api/v1/me/vehicles');
    expect(bearer(vehicles!)).toBe('Bearer new-token');
    expect(gateEvents).toEqual([]);
    expect(mockKeychain.get('sc.authToken')).toBe('new-token');
  });

  it('sends a request that left with the old token again with the new one, instead of ending the session', async () => {
    signedInWith(DUE_EXPIRY);
    const inFlight = deferred();
    fetchMock.mockImplementation((request) => {
      if (pathOf(request).endsWith('/auth/token/rotate')) return Promise.resolve(rotated());
      return bearer(request) === 'Bearer old-token' ? inFlight.promise : Promise.resolve(json(200, { data: [] }));
    });
    const settings = apiData(api.PATCH('/me/settings', { body: { theme: 'black' } }));
    await flush();
    expect(callsTo('/api/v1/me/settings')).toHaveLength(1);

    await rotateTokenIfDue(NOW);
    // The server checks the old token only now, after the rotation deleted it.
    inFlight.resolve(json(401, UNAUTHENTICATED));
    await expect(settings).resolves.toEqual({ data: [] });

    const sent = callsTo('/api/v1/me/settings');
    expect(sent.map(bearer)).toEqual(['Bearer old-token', 'Bearer new-token']);
    expect(await sent[1]!.json()).toEqual({ theme: 'black' });
    expect(gateEvents).toEqual([]);
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', notice: null });
    expect(mockKeychain.get('sc.authToken')).toBe('new-token');
  });

  it('still ends the session for a 401 on the token that is stored', async () => {
    signedInWith(FRESH_EXPIRY);
    fetchMock.mockResolvedValueOnce(json(401, UNAUTHENTICATED));
    await expect(apiData(api.GET('/me/vehicles'))).rejects.toMatchObject({ kind: 'unauthenticated' });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', notice: { kind: 'expired' } });
    expect(mockKeychain.has('sc.authToken')).toBe(false);
  });

  it('stores nothing for a session that ended while the rotation was under way', async () => {
    signedInWith(DUE_EXPIRY);
    const rotation = deferred();
    fetchMock.mockImplementation(() => rotation.promise);
    const rotating = rotateTokenIfDue(NOW);
    await flush();
    setGuest();
    rotation.resolve(rotated());
    await rotating;
    expect(mockKeychain.get('sc.authToken')).toBe('old-token');
  });

  it('starts at the restore, before the first screens ask for anything', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      mockKeychain.set('sc.authToken', 'old-token');
      mockKeychain.set('sc.authTokenExpiresAt', DUE_EXPIRY);
      fetchMock.mockImplementation((request) => {
        if (pathOf(request).endsWith('/auth/me')) return Promise.resolve(json(200, { data: ME }));
        if (pathOf(request).endsWith('/auth/token/rotate')) return Promise.resolve(rotated());
        return Promise.resolve(json(200, { data: [] }));
      });
      await expect(restoreMember()).resolves.toMatchObject({ id: ME.id });
      // The first screen's query, right after the ready gate opened.
      await apiData(api.GET('/me/vehicles'));
      expect(bearer(callsTo('/api/v1/me/vehicles')[0]!)).toBe('Bearer new-token');
      expect(callsTo('/api/v1/auth/token/rotate')).toHaveLength(1);
      expect(gateEvents).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('a rotation whose answer is lost (BH-36)', () => {
  const NETWORK_FAILED = new TypeError('Network request failed');
  /** The server: the first call commits and its answer is lost. Then, within the grace, a repeat answers a fresh token. */
  function serverThatLosesTheFirstAnswer() {
    let rotations = 0;
    fetchMock.mockImplementation((request) => {
      if (!pathOf(request).endsWith('/auth/token/rotate')) return Promise.resolve(json(200, { data: [] }));
      rotations += 1;
      return rotations === 1 ? Promise.reject(NETWORK_FAILED) : Promise.resolve(rotated());
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    // Nothing of a rotation stays behind for the next test.
    setGuest();
    await jest.runOnlyPendingTimersAsync();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps the old token, lets requests through, and tries again in the grace period', async () => {
    signedInWith(DUE_EXPIRY);
    serverThatLosesTheFirstAnswer();
    await rotateTokenIfDue(NOW);
    expect(mockKeychain.get('sc.authToken')).toBe('old-token');

    // A request after the lost answer goes out with the old token, which still works.
    await apiData(api.GET('/me/vehicles'));
    expect(bearer(callsTo('/api/v1/me/vehicles')[0]!)).toBe('Bearer old-token');

    await jest.advanceTimersByTimeAsync(100_000);
    await settle();
    const rotations = callsTo('/api/v1/auth/token/rotate');
    expect(rotations).toHaveLength(2);
    expect(bearer(rotations[1]!)).toBe('Bearer old-token');
    expect(mockKeychain.get('sc.authToken')).toBe('new-token');
    expect(mockKeychain.get('sc.authTokenExpiresAt')).toBe(NEW_EXPIRY);
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', notice: null });
    expect(gateEvents).toEqual([]);

    await apiData(api.GET('/me/vehicles'));
    expect(bearer(callsTo('/api/v1/me/vehicles')[1]!)).toBe('Bearer new-token');
  });

  it('tries again after the timeout too, when the request hung until it was aborted', async () => {
    signedInWith(DUE_EXPIRY);
    let rotations = 0;
    fetchMock.mockImplementation((request) => {
      rotations += 1;
      if (rotations > 1) return Promise.resolve(rotated());
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const rotating = rotateTokenIfDue(NOW);
    await jest.advanceTimersByTimeAsync(8000);
    await rotating;
    expect(mockKeychain.get('sc.authToken')).toBe('old-token');
    await jest.advanceTimersByTimeAsync(90_000);
    await settle();
    expect(mockKeychain.get('sc.authToken')).toBe('new-token');
  });

  it('keeps trying while the network stays away, and every try ends inside the two minutes', async () => {
    signedInWith(DUE_EXPIRY);
    fetchMock.mockImplementation((request) => {
      return new Promise<Response>((_resolve, reject) => {
        // A dead connection: each try runs into its timeout.
        request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const started: number[] = [];
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((request) => {
      started.push(Date.now() - NOW);
      return inner(request);
    });
    const rotating = rotateTokenIfDue(NOW);
    await jest.advanceTimersByTimeAsync(8000);
    await rotating;
    await jest.advanceTimersByTimeAsync(300_000);
    await settle();
    expect(started.length).toBeGreaterThanOrEqual(4);
    // The last try starts and times out before the old token ends at 120 s.
    expect(started[started.length - 1]! + 8000).toBeLessThan(120_000);
  });

  it('stops on any answer of the server: a 409 leaves the rest to the next 401', async () => {
    signedInWith(DUE_EXPIRY);
    let rotations = 0;
    fetchMock.mockImplementation(() => {
      rotations += 1;
      return rotations === 1 ? Promise.reject(NETWORK_FAILED) : Promise.resolve(json(409, { message: 'Konflikt', code: 'conflict', errors: {} }));
    });
    await rotateTokenIfDue(NOW);
    await jest.advanceTimersByTimeAsync(300_000);
    await settle();
    expect(rotations).toBe(2);
    expect(mockKeychain.get('sc.authToken')).toBe('old-token');
  });

  it('stops once the session has ended', async () => {
    signedInWith(DUE_EXPIRY);
    serverThatLosesTheFirstAnswer();
    await rotateTokenIfDue(NOW);
    setGuest();
    await jest.advanceTimersByTimeAsync(300_000);
    await settle();
    expect(callsTo('/api/v1/auth/token/rotate')).toHaveLength(1);
  });

  it('runs one rotation at a time: a retry never overlaps a second call, whose answer would revoke its token', async () => {
    signedInWith(DUE_EXPIRY);
    let rotations = 0;
    const slow = deferred();
    fetchMock.mockImplementation(() => {
      rotations += 1;
      if (rotations === 1) return Promise.reject(NETWORK_FAILED);
      return slow.promise;
    });
    await rotateTokenIfDue(NOW);
    await jest.advanceTimersByTimeAsync(5000);
    await settle();
    expect(rotations).toBe(2);
    // A new due check, as from a restart of the flow, while the retry is under way.
    void rotateTokenIfDue(NOW);
    await settle();
    expect(rotations).toBe(2);
    slow.resolve(rotated());
    await settle();
    expect(mockKeychain.get('sc.authToken')).toBe('new-token');
    await jest.advanceTimersByTimeAsync(300_000);
    expect(rotations).toBe(2);
  });
});

describe('a token left behind while the app runs as a guest', () => {
  it('goes nowhere', async () => {
    mockKeychain.set('sc.authToken', 'old-token');
    setGuest();
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));
    await apiData(api.GET('/catalog/makes'));
    expect(bearer(fetchMock.mock.calls[0]![0])).toBeNull();
  });

  it('is confirmed later, and then the member is adopted (the start found no cached member and no network)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      mockKeychain.set('sc.authToken', 'old-token');
      mockKeychain.set('sc.authTokenExpiresAt', FRESH_EXPIRY);
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      await expect(restoreMember()).resolves.toBeNull();
      setGuest();
      expect(mockKeychain.get('sc.authToken')).toBe('old-token');

      fetchMock.mockResolvedValueOnce(json(200, { data: ME }));
      await jest.advanceTimersByTimeAsync(5000);
      await settle();

      const retry = fetchMock.mock.calls[1]![0];
      expect(pathOf(retry)).toBe('/api/v1/auth/me');
      expect(bearer(retry)).toBe('Bearer old-token');
      expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id, username: 'lukas.sc' } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('is forgotten when the server no longer knows it', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      mockKeychain.set('sc.authToken', 'old-token');
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      await restoreMember();
      setGuest();

      fetchMock.mockResolvedValueOnce(json(401, UNAUTHENTICATED));
      await jest.advanceTimersByTimeAsync(5000);
      await settle();

      expect(mockKeychain.has('sc.authToken')).toBe(false);
      expect(useSessionStore.getState()).toMatchObject({ status: 'guest', notice: { kind: 'expired' } });
    } finally {
      jest.useRealTimers();
    }
  });
});
