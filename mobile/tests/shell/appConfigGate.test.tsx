import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { router, usePathname, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { api, createApiClient } from '@/api/client';
import {
  APP_CONFIG_GATE_REFETCH_MS,
  APP_CONFIG_STORAGE_KEY,
  APP_CONFIG_TIMEOUT_MS,
  BUNDLED_APP_CONFIG,
  useAppConfig,
  type AppConfig,
} from '@/api/queries/appConfig';
import { queryClient } from '@/api/queryClient';
import { AppConfigGate } from '@/features/system/AppConfigGate';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  usePathname: jest.fn(),
  useRootNavigationState: () => ({ key: 'root' }),
  useSegments: jest.fn(),
}));

const replace = router.replace as jest.Mock;
const segments = useSegments as unknown as jest.Mock;
const pathname = usePathname as unknown as jest.Mock;

const live: AppConfig = BUNDLED_APP_CONFIG;
const down: AppConfig = { ...BUNDLED_APP_CONFIG, maintenance: { enabled: true, message: null } };

function answer(config: AppConfig) {
  return Promise.resolve({
    data: { data: config },
    response: new Response('{}', { status: 200, headers: { ETag: '"new"' } }),
  });
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

function mockGet(result: () => Promise<unknown>) {
  return jest.spyOn(api, 'GET').mockImplementation(result as never);
}

const cache = (config: AppConfig) =>
  AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify({ etag: '"v1"', config }));

let settled = false;

/**
 * A second observer of the query, after the gate. It hears the end of a fetch in the same notification, and its effect
 * runs after the gate's. So once it has seen that, the gate has acted on the answer, whichever way it decided.
 */
function SettledProbe() {
  const { isFetching } = useAppConfig();
  useEffect(() => {
    settled = !isFetching;
  }, [isFetching]);
  return null;
}

async function waitUntilSettled() {
  await waitFor(() => expect(settled).toBe(true));
}

async function mountOn(segment: string) {
  settled = false;
  segments.mockReturnValue([segment]);
  await render(
    <QueryClientProvider client={queryClient}>
      <AppConfigGate />
      <SettledProbe />
    </QueryClientProvider>,
  );
  await waitUntilSettled();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  jest.restoreAllMocks();
  replace.mockClear();
  pathname.mockReturnValue('/');
});

// An unmounted query keeps a 24 h collection timer, which would keep Jest from exiting.
afterEach(async () => {
  await cleanup();
  queryClient.clear();
});

describe('AppConfigGate', () => {
  it('leaves a reloaded /maintenance once the server says maintenance is over', async () => {
    await cache(down);
    mockGet(() => answer(live));
    await mountOn('maintenance');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('leaves a reloaded /maintenance on a first answer without any cache', async () => {
    mockGet(() => answer(live));
    await mountOn('maintenance');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('leaves on a 304 that confirms a cached config without maintenance', async () => {
    await cache(live);
    mockGet(() => Promise.resolve({ error: '', response: new Response(null, { status: 304 }) }));
    await mountOn('maintenance');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('leaves /update-required the same way', async () => {
    mockGet(() => answer(live));
    await mountOn('update-required');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('never bounces out when the server confirms maintenance, even for one render', async () => {
    mockGet(() => answer(down));
    await mountOn('maintenance');
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['the network is down', offline],
    ['the server fails', () => Promise.resolve({ error: {}, response: new Response(null, { status: 500 }) })],
    ['the payload is invalid', () => answer({ maintenance: 'yes' } as unknown as AppConfig)],
  ])('stays on /maintenance while %s, because defaults prove nothing', async (_name, result) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGet(result);
    await mountOn('maintenance');
    expect(replace).not.toHaveBeenCalled();
  });

  it('enters the gate from the cached config while the request is in flight, and lets go when no response comes', async () => {
    await cache(down);
    let dropConnection = () => undefined as void;
    mockGet(
      () =>
        new Promise((_resolve, reject) => {
          dropConnection = () => reject(new TypeError('Failed to fetch'));
        }),
    );
    settled = false;
    segments.mockReturnValue(['(tabs)']);
    await render(
      <QueryClientProvider client={queryClient}>
        <AppConfigGate />
        <SettledProbe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/maintenance'));

    segments.mockReturnValue(['maintenance']);
    replace.mockClear();
    await act(async () => dropConnection());
    await waitUntilSettled();
    expect(replace).toHaveBeenCalledWith('/');
  });

  describe('a deep link that a cached flag interrupts', () => {
    async function openDeepLink(path: string, first: string) {
      settled = false;
      segments.mockReturnValue([first]);
      pathname.mockReturnValue(path);
      const view = await render(
        <QueryClientProvider client={queryClient}>
          <AppConfigGate />
          <SettledProbe />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/maintenance'));
      segments.mockReturnValue(['maintenance']);
      pathname.mockReturnValue('/maintenance');
      replace.mockClear();
      return view;
    }

    it.each([
      ['/v/nissan-skyline-gt-r-r34-5tf974vj', '(tabs)'],
      ['/c/8TR0Q3MC', 'c'],
    ])('returns to %s when the server ends maintenance', async (path, first) => {
      await cache(down);
      let answerNow = () => undefined as void;
      mockGet(
        () =>
          new Promise((resolve) => {
            answerNow = () =>
              resolve({ data: { data: live }, response: new Response('{}', { status: 200, headers: { ETag: '"new"' } }) });
          }),
      );
      await openDeepLink(path, first);
      await act(async () => answerNow());
      await waitUntilSettled();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith(path);
    });

    it('returns there as well when the flag is released offline', async () => {
      await cache(down);
      let dropConnection = () => undefined as void;
      mockGet(
        () =>
          new Promise((_resolve, reject) => {
            dropConnection = () => reject(new TypeError('Failed to fetch'));
          }),
      );
      await openDeepLink('/v/spike-demo', '(tabs)');
      await act(async () => dropConnection());
      await waitUntilSettled();
      expect(replace).toHaveBeenCalledWith('/v/spike-demo');
    });

    it('a hanging connection leaves the gate after the timeout and returns to the link', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
      try {
        await cache(down);
        mockGet(() => new Promise(() => undefined));
        await openDeepLink('/v/spike-demo', '(tabs)');
        expect(replace).not.toHaveBeenCalled();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(APP_CONFIG_TIMEOUT_MS);
        });
        await waitUntilSettled();
        expect(replace).toHaveBeenCalledWith('/v/spike-demo');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('lets go of /maintenance when no response backs the cached flag', async () => {
    await cache(down);
    mockGet(offline);
    await mountOn('maintenance');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/');
  });

  it.each([423, 503])('stays on /maintenance when a %i backs the cached flag', async (status) => {
    await cache(down);
    mockGet(() => Promise.resolve({ error: {}, response: new Response(null, { status }) }));
    await mountOn('maintenance');
    expect(replace).not.toHaveBeenCalled();
  });

  it('a cached minimum version still asks for the update offline', async () => {
    await cache({ ...down, min_version: { ios: '9.0.0', android: '9.0.0' } });
    mockGet(offline);
    await mountOn('update-required');
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves ordinary routes alone', async () => {
    mockGet(() => answer(live));
    await mountOn('(tabs)');
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('gate answers of the API', () => {
  const pause = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  /** The real client with its middleware, so a gate answer reaches the real listeners. */
  function serve(statusFor: (url: string) => number) {
    const fetchMock = jest.fn((request: Request) => {
      const status = statusFor(request.url);
      const body = status === 200 ? { data: live } : { message: 'x', code: 'x', errors: {} };
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
    });
    const client = createApiClient({
      origin: 'https://speedclub.test',
      cookieAuth: false,
      fetch: fetchMock,
      getToken: () => Promise.resolve(null),
    });
    jest.spyOn(api, 'GET').mockImplementation(client.GET as never);
    const configRequests = () => fetchMock.mock.calls.filter(([request]) => request.url.endsWith('/app-config')).length;
    return { client, configRequests };
  }

  it.each([423, 426])('a %i on /app-config itself ends with that one request', async (status) => {
    const { configRequests } = serve(() => status);
    await mountOn('(tabs)');
    await pause();
    expect(configRequests()).toBe(1);
  });

  it('other calls refresh the config, at most once per window, however many answer at once', async () => {
    const { client, configRequests } = serve((url) => (url.endsWith('/app-config') ? 200 : 423));
    await mountOn('(tabs)');
    expect(configRequests()).toBe(1);

    await act(async () => {
      await client.GET('/catalog/makes');
    });
    await pause();
    expect(configRequests()).toBe(1);

    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + APP_CONFIG_GATE_REFETCH_MS);
    await act(async () => {
      await Promise.all([client.GET('/catalog/makes'), client.GET('/catalog/makes'), client.GET('/catalog/makes')]);
    });
    await pause();
    expect(configRequests()).toBe(2);
  });
});
