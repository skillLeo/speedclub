import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '@/api/client';
import {
  APP_CONFIG_STORAGE_KEY,
  APP_CONFIG_TIMEOUT_MS,
  appConfigKey,
  appConfigSchema,
  appGateFor,
  BUNDLED_APP_CONFIG,
  compareVersions,
  loadAppConfig,
  readCachedConfig,
  type AppConfig,
} from '@/api/queries/appConfig';
import { queryClient } from '@/api/queryClient';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const fresh: AppConfig = { ...BUNDLED_APP_CONFIG, flags: { 'sig.compare': true }, links: { imprint: null } };

function mockGet(result: () => Promise<unknown>) {
  return jest.spyOn(api, 'GET').mockImplementation(result as never);
}

function ok(data: unknown, etag: string | null = '"v1"') {
  return Promise.resolve({ data: { data }, response: new Response('{}', { status: 200, headers: etag ? { ETag: etag } : {} }) });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  queryClient.clear();
  jest.restoreAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('loadAppConfig', () => {
  it('a first launch without network runs on the bundled defaults', async () => {
    mockGet(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadAppConfig()).resolves.toEqual({ config: BUNDLED_APP_CONFIG, confirmed: false });
  });

  it('stores a valid answer with its ETag', async () => {
    mockGet(() => ok(fresh));
    await expect(loadAppConfig()).resolves.toEqual({ config: fresh, confirmed: true });
    await expect(readCachedConfig()).resolves.toEqual({ etag: '"v1"', config: fresh });
  });

  it('sends If-None-Match and keeps the cached copy on 304', async () => {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify({ etag: '"v1"', config: fresh }));
    const get = mockGet(() => Promise.resolve({ error: '', response: new Response(null, { status: 304 }) }));
    await expect(loadAppConfig()).resolves.toEqual({ config: fresh, confirmed: true });
    expect(get).toHaveBeenCalledWith('/app-config', { headers: { 'If-None-Match': '"v1"' }, signal: expect.any(AbortSignal) });
  });

  it('applies the cached copy before the network answers', async () => {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify({ etag: null, config: fresh }));
    let seenDuringRequest: unknown;
    mockGet(() => {
      seenDuringRequest = queryClient.getQueryData(appConfigKey);
      return Promise.reject(new TypeError('offline'));
    });
    await loadAppConfig();
    expect(seenDuringRequest).toEqual({ config: fresh, confirmed: false });
  });

  it('ignores a payload that fails the schema and keeps the last good copy', async () => {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify({ etag: '"v1"', config: fresh }));
    mockGet(() => ok({ maintenance: 'yes' }, '"bad"'));
    await expect(loadAppConfig()).resolves.toEqual({ config: fresh, confirmed: false });
    await expect(readCachedConfig()).resolves.toEqual({ etag: '"v1"', config: fresh });
  });

  it('ignores a server error', async () => {
    mockGet(() => Promise.resolve({ error: {}, response: new Response(null, { status: 500 }) }));
    await expect(loadAppConfig()).resolves.toEqual({ config: BUNDLED_APP_CONFIG, confirmed: false });
  });

  it('survives a corrupt cache', async () => {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, 'not json');
    mockGet(() => Promise.reject(new TypeError('offline')));
    await expect(loadAppConfig()).resolves.toEqual({ config: BUNDLED_APP_CONFIG, confirmed: false });
  });
});

describe('a cached maintenance flag', () => {
  const down: AppConfig = { ...fresh, maintenance: { enabled: true, message: 'Bis 14 Uhr' } };
  const lifted: AppConfig = { ...fresh, maintenance: { enabled: false, message: 'Bis 14 Uhr' } };
  const status = (code: number) => () => Promise.resolve({ error: {}, response: new Response(null, { status: code }) });

  beforeEach(() => AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify({ etag: '"v1"', config: down })));

  it('applies while the request is in flight', async () => {
    let seenDuringRequest: unknown;
    mockGet(() => {
      seenDuringRequest = queryClient.getQueryData(appConfigKey);
      return Promise.reject(new TypeError('offline'));
    });
    await loadAppConfig();
    expect(seenDuringRequest).toEqual({ config: down, confirmed: false });
  });

  it('is lifted when the request gets no response, and the stored copy stays', async () => {
    mockGet(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadAppConfig()).resolves.toEqual({ config: lifted, confirmed: false, released: true });
    await expect(readCachedConfig()).resolves.toEqual({ etag: '"v1"', config: down });
  });

  it.each([423, 500, 503])('holds when the server answers %i', async (code) => {
    mockGet(status(code));
    await expect(loadAppConfig()).resolves.toEqual({ config: down, confirmed: false });
  });

  it('holds on a 304, because the server vouches for it', async () => {
    mockGet(status(304));
    await expect(loadAppConfig()).resolves.toEqual({ config: down, confirmed: true });
  });

  it.each([404, 429])('is lifted on a %i, which says nothing about maintenance', async (code) => {
    mockGet(status(code));
    await expect(loadAppConfig()).resolves.toEqual({ config: lifted, confirmed: false, released: true });
  });

  it('is lifted when the payload fails the schema', async () => {
    mockGet(() => ok({ maintenance: 'yes' }));
    await expect(loadAppConfig()).resolves.toEqual({ config: lifted, confirmed: false, released: true });
  });

  describe('on a connection that hangs', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    });
    afterEach(() => jest.useRealTimers());

    it('is lifted after the timeout, and the request is aborted', async () => {
      const get = mockGet(() => new Promise(() => undefined));
      let settled = false;
      const result = loadAppConfig().then((state) => {
        settled = true;
        return state;
      });
      await jest.advanceTimersByTimeAsync(APP_CONFIG_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ config: lifted, confirmed: false, released: true });
      const options = get.mock.calls[0]?.[1] as unknown as { signal: AbortSignal };
      expect(options.signal.aborted).toBe(true);
    });

    it('does not abort a request that was answered in time', async () => {
      const get = mockGet(status(304));
      const result = loadAppConfig();
      await jest.advanceTimersByTimeAsync(0);
      await expect(result).resolves.toEqual({ config: down, confirmed: true });
      await jest.advanceTimersByTimeAsync(APP_CONFIG_TIMEOUT_MS);
      const options = get.mock.calls[0]?.[1] as unknown as { signal: AbortSignal };
      expect(options.signal.aborted).toBe(false);
    });
  });

  it('does not come back during a later poll, or every poll offline would flash the gate', async () => {
    mockGet(() => Promise.reject(new TypeError('offline')));
    queryClient.setQueryData(appConfigKey, await loadAppConfig());
    let seenDuringRequest: unknown;
    mockGet(() => {
      seenDuringRequest = queryClient.getQueryData(appConfigKey);
      return Promise.reject(new TypeError('offline'));
    });
    await loadAppConfig();
    expect(seenDuringRequest).toEqual({ config: lifted, confirmed: false, released: true });
  });
});

describe('schema', () => {
  it('accepts the bundled defaults', () => {
    expect(appConfigSchema.safeParse(BUNDLED_APP_CONFIG).success).toBe(true);
  });

  it('rejects a flag that is not a boolean', () => {
    expect(appConfigSchema.safeParse({ ...BUNDLED_APP_CONFIG, flags: { x: 'on' } }).success).toBe(false);
  });

  it('reads the logo sizes (ADM-28), and a size that is no real size as none', () => {
    const parsed = appConfigSchema.parse({
      ...BUNDLED_APP_CONFIG,
      branding: {
        ...BUNDLED_APP_CONFIG.branding,
        logo_sizes: { wordmark_white: { width: 800, height: 200 }, wordmark_black: { width: 0, height: 200 }, square: 'big', app_mark: null },
      },
    });
    expect(parsed.branding.logo_sizes).toEqual({ wordmark_white: { width: 800, height: 200 }, wordmark_black: null, square: null, app_mark: null });
  });
});

describe('gate', () => {
  const withMin = (version: string): AppConfig => ({
    ...BUNDLED_APP_CONFIG,
    min_version: { ios: version, android: version },
  });
  const maintenance: AppConfig = { ...BUNDLED_APP_CONFIG, maintenance: { enabled: true, message: null } };

  it('compares versions by number, not by text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });

  it('asks for an update below the minimum, on native only', () => {
    expect(appGateFor(withMin('2.0.0'), 'android', '1.9.0')).toBe('update-required');
    expect(appGateFor(withMin('2.0.0'), 'ios', '1.9.0')).toBe('update-required');
    expect(appGateFor(withMin('2.0.0'), 'android', '2.0.0')).toBeNull();
    expect(appGateFor(withMin('2.0.0'), 'web', '0.1.0')).toBeNull();
  });

  it('shows maintenance everywhere, and an update takes precedence', () => {
    expect(appGateFor(maintenance, 'web', '1.0.0')).toBe('maintenance');
    expect(appGateFor({ ...withMin('2.0.0'), maintenance: maintenance.maintenance }, 'ios', '1.0.0')).toBe('update-required');
  });

  it('the bundled defaults never block', () => {
    expect(appGateFor(BUNDLED_APP_CONFIG, 'android', '0.0.1')).toBeNull();
  });
});
