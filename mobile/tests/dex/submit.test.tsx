import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { badgeKeys } from '@/api/queries/badges';
import { dexKeys, SPOT_REFRESH_ROOTS, spotNotCounted, useSubmitSpot, type SpotResult } from '@/api/queries/dex';
import { levelKeys } from '@/api/queries/level';
import { queryClient } from '@/api/queryClient';
import { __resetSpotOutboxForTests, queueSpot, SPOT_OUTBOX_KEY, spotOutbox } from '@/features/dex/outbox';
import { dismissToast } from '@/ui';

import { containsCoordinates, newQueryClient, signIn, spotResponse, stubFetch, type Answer } from './helpers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKey}` }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const CITY = { city_id: 2864118, bundesland: 'NW' as const };
const error = (status: number, code: string, message = 'Nein') => ({ status, body: { message, code, errors: {} } });

async function submitHook() {
  const client = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const queue = jest.fn();
  const view = await renderHook(() => useSubmitSpot(), { wrapper });
  const run = async (city: typeof CITY | null = CITY): Promise<SpotResult> => {
    let result: SpotResult | undefined;
    await act(async () => {
      result = await view.result.current.mutateAsync({ code: '7H2KQXMB', city, queue });
    });
    return result as SpotResult;
  };
  return { client, queue, run };
}

beforeEach(async () => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  signIn();
  await AsyncStorage.clear();
});
afterEach(() => dismissToast());
// The app's client keeps a sent spot for DEX-03; its garbage-collection timer must not keep Jest alive.
afterAll(() => queryClient.clear());

describe('POST /spots: every answer of contract §2', () => {
  it('201: a new spot, sent with an idempotency key and only code, city_id and Bundesland', async () => {
    const { calls } = stubFetch({ '/spots': { status: 201, body: spotResponse() } });
    const { run, client } = await submitHook();
    const result = await run();
    expect(result.kind).toBe('spotted');
    const request = calls.find((call) => call.url.endsWith('/api/v1/spots'));
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('Idempotency-Key')).toMatch(/^key-/);
    const body = JSON.parse(await (request as Request).clone().text()) as Record<string, unknown>;
    expect(body).toEqual({ code: '7H2KQXMB', city_id: CITY.city_id, bundesland: 'NW' });
    // The answer waits where DEX-03 reads it, under the spot id alone.
    const id = result.kind === 'spotted' ? result.response.data.spot_id : '';
    expect(client.getQueryData(dexKeys.spot(id))).toBeDefined();
  });

  it('marks the Dex, sets, cards, level and badges stale after a spot, and keeps the spot itself (CR-P5G-02)', async () => {
    stubFetch({ '/spots': { status: 201, body: spotResponse() } });
    const { run, client } = await submitHook();
    client.setQueryData(dexKeys.mine('all'), { pages: [], pageParams: [] });
    client.setQueryData(dexKeys.sets, []);
    client.setQueryData(['level', 'me', 'de'], { level: 1 });
    client.setQueryData(['badges', 'me', 'de'], []);
    const result = await run();
    const id = result.kind === 'spotted' ? result.response.data.spot_id : '';
    expect(client.getQueryState(dexKeys.mine('all'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(dexKeys.sets)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['level', 'me', 'de'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['badges', 'me', 'de'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(dexKeys.spot(id))?.isInvalidated).toBe(false);
    // The roots dex.ts names stay the level and badge query roots.
    expect(SPOT_REFRESH_ROOTS).toEqual([levelKeys.all, badgeKeys.all]);
  });

  it('sends the code alone without a city', async () => {
    const { calls } = stubFetch({ '/spots': { status: 201, body: spotResponse() } });
    await (await submitHook()).run(null);
    const request = calls.find((call) => call.url.endsWith('/api/v1/spots')) as Request;
    expect(JSON.parse(await request.clone().text())).toEqual({ code: '7H2KQXMB' });
  });

  it('200: the same car within 24 h is the existing card, not an error', async () => {
    stubFetch({ '/spots': { status: 200, body: spotResponse({ duplicate: true, new_in_dex: false }) } });
    const result = await (await submitHook()).run();
    expect(result.kind === 'spotted' && result.response.meta.duplicate).toBe(true);
  });

  it('201 counted:false: a young account scans, nothing counts', async () => {
    stubFetch({ '/spots': { status: 201, body: spotResponse({ new_in_dex: false, counted: false, reason: 'account_too_new' }) } });
    const result = await (await submitHook()).run();
    expect(result.kind === 'spotted' && spotNotCounted(result.response.meta)).toBe(true);
    expect(spotNotCounted(spotResponse({ reason: 'account_too_new' }).meta)).toBe(true);
    expect(spotNotCounted(spotResponse().meta)).toBe(false);
  });

  it.each<[string, Answer, string]>([
    ['404 qr_not_found', error(404, 'qr_not_found'), 'not_found'],
    ['409 spot_own_car', error(409, 'spot_own_car'), 'own_car'],
    ['409 spotting_paused', error(409, 'spotting_paused'), 'paused'],
    ['409 spot_unavailable', error(409, 'spot_unavailable'), 'unavailable'],
    ['409 another code', error(409, 'blocked'), 'unavailable'],
    ['429 30 per hour', { ...error(429, 'rate_limited'), headers: { 'Retry-After': '600' } }, 'rate_limited'],
    ['403 restricted', error(403, 'account_restricted'), 'restricted'],
    ['422 refused field', error(422, 'validation'), 'failed'],
  ])('%s is a calm refusal on the scanner', async (_case, answer, reason) => {
    stubFetch({ '/spots': answer });
    const { run, queue } = await submitHook();
    const result = await run();
    expect(result).toMatchObject({ kind: 'refused', reason });
    expect(queue).not.toHaveBeenCalled();
  });

  it('keeps Retry-After of a 429', async () => {
    stubFetch({ '/spots': { ...error(429, 'rate_limited'), headers: { 'Retry-After': '600' } } });
    expect(await (await submitHook()).run()).toMatchObject({ retryAfter: 600 });
  });

  it('offline: the scan is queued with its key and never sent now', async () => {
    const { fetchMock } = stubFetch({});
    onlineManager.setOnline(false);
    const { run, queue } = await submitHook();
    expect(await run()).toEqual({ kind: 'queued' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queue).toHaveBeenCalledWith({ code: '7H2KQXMB', city_id: CITY.city_id, bundesland: 'NW' }, expect.stringMatching(/^key-/));
  });

  it('no answer: the same key goes to the queue, so a retry is never a second spot', async () => {
    const { calls } = stubFetch({ '/spots': () => { throw new TypeError('Network request failed'); } });
    const { run, queue } = await submitHook();
    expect(await run()).toEqual({ kind: 'queued' });
    const sentKey = calls[0]?.headers.get('Idempotency-Key');
    expect(queue.mock.calls[0]?.[1]).toBe(sentKey);
  });
});

describe('the spot outbox', () => {
  beforeEach(async () => {
    await spotOutbox().reset();
    __resetSpotOutboxForTests();
  });

  it('keeps a scan made offline, then sends it once online with its own key', async () => {
    const { calls } = stubFetch({ '/spots': { status: 201, body: spotResponse() } });
    onlineManager.setOnline(false);
    queueSpot({ code: '7H2KQXMB', city_id: CITY.city_id, bundesland: 'NW' }, 'scan-key-1');
    await waitFor(async () => expect(await AsyncStorage.getItem(SPOT_OUTBOX_KEY)).not.toBeNull());
    expect(spotOutbox().store.getState().ops).toHaveLength(1);
    const stored = (await AsyncStorage.getItem(SPOT_OUTBOX_KEY)) ?? '';
    expect(containsCoordinates(stored)).toBe(false);
    expect(calls).toHaveLength(0);

    onlineManager.setOnline(true);
    await waitFor(() => expect(spotOutbox().store.getState().ops).toHaveLength(0));
    expect(calls[0]?.headers.get('Idempotency-Key')).toBe('scan-key-1');
    expect(queryClient.getQueryData(dexKeys.spot('01spot0000000000000000000a'))).toBeDefined();
  });

  it('drops a refused scan with its reason, and keeps one that hit the hourly limit', async () => {
    stubFetch({ '/spots': error(409, 'spot_own_car') });
    queueSpot({ code: '7H2KQXMB' }, 'scan-key-2');
    await waitFor(() => expect(spotOutbox().store.getState().ops).toHaveLength(0));

    stubFetch({ '/spots': error(429, 'rate_limited') });
    queueSpot({ code: '7H2KQXMB' }, 'scan-key-3');
    await waitFor(() => expect(spotOutbox().store.getState().ops[0]?.status).toBe('queued'));
    expect(spotOutbox().store.getState().ops[0]?.attempts).toBe(1);
  });

  it('sends only the contract fields of a stored op', async () => {
    const { calls } = stubFetch({ '/spots': { status: 201, body: spotResponse() } });
    spotOutbox().enqueue({
      id: 'k4',
      idempotencyKey: 'k4',
      kind: 'spot.create',
      scope: 'spots',
      target: '7H2KQXMB',
      payload: { code: '7H2KQXMB', lat: 51.1987, lng: 6.6925 },
    });
    await spotOutbox().flush();
    expect(JSON.parse(await (calls[0] as Request).clone().text())).toEqual({ code: '7H2KQXMB' });
  });
});
