// SEC-414-02: when auth/me answers 401 the session is gone (the server pruned its push subscriptions with it), so the browser drops its
// own PushSubscription too, locally, without a server call.
import { fetchMe, onMeUnauthenticated } from '@/api/queries/auth';
import { dropLocalWebPush } from '@/features/pwa/webPush';

import { stubFetch } from '../vehicle/harness';

// The client is built at import time with the configured origin; native has none in Jest, and a relative URL is no Request.
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const mockDelete = jest.fn();
jest.mock('@/api/queries/webPush', () => ({
  ...jest.requireActual<object>('@/api/queries/webPush'),
  deletePushSubscription: (...args: unknown[]) => mockDelete(...args),
}));
let mockSubscription: { unsubscribe: jest.Mock } | null = null;
jest.mock('@/features/pwa/serviceWorker', () => ({
  ...jest.requireActual<object>('@/features/pwa/serviceWorker'),
  serviceWorkerRegistration: () => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(mockSubscription) } }),
}));

beforeEach(() => {
  mockDelete.mockReset();
  mockSubscription = null;
});

describe('Web Push when the session ends without a sign-out (SEC-414-02)', () => {
  it('unsubscribes the browser locally and asks nothing of the server', async () => {
    const unsubscribe = jest.fn(() => Promise.resolve(true));
    mockSubscription = { unsubscribe };
    await expect(dropLocalWebPush()).resolves.toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('does nothing without a subscription', async () => {
    await expect(dropLocalWebPush()).resolves.toBe(false);
  });

  it('tells its listeners when auth/me answers 401, and only then', async () => {
    const heard = jest.fn();
    const stop = onMeUnauthenticated(heard);
    stubFetch({ '/auth/me': { status: 401, body: { message: 'Bitte melde dich an.', code: 'unauthenticated' } } });
    await expect(fetchMe()).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(heard).toHaveBeenCalledTimes(1);
    stubFetch({ '/auth/me': { status: 503, body: { message: 'Wartung', code: 'server_error' } } });
    await expect(fetchMe()).rejects.toBeTruthy();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});
