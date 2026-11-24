/** M5.7 view beacon (10 §6.1, m5.7-contract §3.1): once per open, never prefetched, never the owner's, never twice a day. */
import { act, waitFor } from '@testing-library/react-native';
import { IsFocusedContext } from 'expo-router/build/react-navigation/core/useIsFocused';
import { useEffect, useState } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import {
  beaconBlock,
  berlinDayKey,
  isQaRender,
  noteStickerScanOpen,
  resetBeaconForTests,
  sendViewOnce,
  sourceOf,
  useViewBeacon,
  type BeaconContext,
  type BeaconInput,
} from '@/features/insights/beacon';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, signIn, stubApi } from '../gift/helpers';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const CAR = '01m6f7zv1vs5e2xw9a96cbqzyp';
const OPEN: BeaconContext = { focused: true, online: true, enabled: true, viewAs: false, qaRender: false };
const PAGE: BeaconInput = { target: { subject: 'vehicle', id: CAR }, ready: true, own: false, sample: false, via: null, slug: 'nissan-r34' };

function clientWithFlag(on: boolean) {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { insights: on } }, confirmed: true });
  return client;
}

function Probe({ input }: { input: BeaconInput }) {
  useViewBeacon(input);
  return null;
}

/** A page whose data and focus change from the test, as a revalidation or a focus change would (no `rerender`: it drops the providers). */
let setPage: (next: { input: BeaconInput; focused: boolean }) => void = () => undefined;
function Page({ input, focused = true }: { input: BeaconInput; focused?: boolean }) {
  const [state, setState] = useState({ input, focused });
  useEffect(() => {
    setPage = setState;
  }, []);
  return (
    <IsFocusedContext.Provider value={state.focused}>
      <Probe input={state.input} />
    </IsFocusedContext.Provider>
  );
}
const change = (next: { input: BeaconInput; focused: boolean }) => act(async () => setPage(next));

const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((call) => call.method === 'POST' && call.path.endsWith('/views'));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  resetBeaconForTests();
  signIn();
});

describe('beacon rules', () => {
  it('sends only for a loaded, focused page of somebody else', () => {
    expect(beaconBlock(PAGE, OPEN)).toBeNull();
    expect(beaconBlock({ ...PAGE, target: null }, OPEN)).toBe('no-target');
    expect(beaconBlock({ ...PAGE, ready: false }, OPEN)).toBe('not-ready');
    // A preloaded or prefetched route renders without focus.
    expect(beaconBlock(PAGE, { ...OPEN, focused: false })).toBe('not-focused');
    expect(beaconBlock(PAGE, { ...OPEN, qaRender: true })).toBe('qa');
    expect(beaconBlock(PAGE, { ...OPEN, viewAs: true })).toBe('view-as');
    expect(beaconBlock(PAGE, { ...OPEN, enabled: false })).toBe('flag-off');
    expect(beaconBlock({ ...PAGE, own: true }, OPEN)).toBe('own');
    expect(beaconBlock({ ...PAGE, sample: true }, OPEN)).toBe('sample');
    expect(beaconBlock(PAGE, { ...OPEN, online: false })).toBe('offline');
  });

  it('names the source: sticker scan, then shared link, then the platform', () => {
    expect(sourceOf({ via: null }, false)).toBe('app');
    expect(sourceOf({ via: null }, true)).toBe('web');
    expect(sourceOf({ via: 'share' }, false)).toBe('shared_link');
    expect(sourceOf({ via: 'share' }, true, true)).toBe('sticker_scan');
  });

  it('treats any qa override as a QA render', () => {
    expect(isQaRender({})).toBe(false);
    expect(isQaRender({ state: 'default' })).toBe(true);
  });

  it('keys the day in Berlin, not UTC', () => {
    // 23:30 UTC on 16 Nov is 00:30 on 17 Nov in Berlin (CET).
    expect(berlinDayKey(new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-17');
    expect(berlinDayKey(new Date('2026-11-16T22:30:00Z'))).toBe('2026-11-16');
  });

  it('never sends the same subject twice on one Berlin day, and again on the next', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    const day = new Date('2026-11-16T10:00:00Z');
    expect(sendViewOnce({ subject: 'vehicle', id: CAR }, 'app', day)).toBe(true);
    expect(sendViewOnce({ subject: 'vehicle', id: CAR }, 'web', day)).toBe(false);
    expect(sendViewOnce({ subject: 'profile', username: 'Jann.Ptrs' }, 'app', day)).toBe(true);
    expect(sendViewOnce({ subject: 'profile', username: 'jann.ptrs' }, 'app', day)).toBe(false);
    expect(sendViewOnce({ subject: 'vehicle', id: CAR }, 'app', new Date('2026-11-17T10:00:00Z'))).toBe(true);
    await settle();
    expect(posts(calls).map((call) => call.body)).toEqual([
      { subject: 'vehicle', id: CAR, source: 'app' },
      { subject: 'profile', username: 'Jann.Ptrs', source: 'app' },
      { subject: 'vehicle', id: CAR, source: 'app' },
    ]);
  });
});

describe('useViewBeacon', () => {
  it('waits for the page, then sends once, also across re-renders and refetches', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    await renderScreen(<Page input={{ ...PAGE, ready: false, target: null }} />, clientWithFlag(true));
    await settle();
    expect(posts(calls)).toHaveLength(0);
    await change({ input: PAGE, focused: true });
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({ subject: 'vehicle', id: CAR, source: 'app' });
    // A revalidation hands the same page in again (a new object): nothing more goes out.
    await change({ input: { ...PAGE }, focused: true });
    await change({ input: { ...PAGE, ready: true }, focused: true });
    await settle();
    expect(posts(calls)).toHaveLength(1);
  });

  it('opening the same car again the same day sends nothing (no double count)', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    const first = await renderScreen(<Page input={PAGE} />, clientWithFlag(true));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    await first.unmount();
    await renderScreen(<Page input={PAGE} />, clientWithFlag(true));
    await settle();
    expect(posts(calls)).toHaveLength(1);
  });

  it('never sends for a prefetched (unfocused) screen, and sends once it is focused', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    await renderScreen(<Page input={PAGE} focused={false} />, clientWithFlag(true));
    await settle();
    expect(posts(calls)).toHaveLength(0);
    await change({ input: PAGE, focused: true });
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
  });

  it("sends nothing on the owner's own page, for samples, or with the flag off", async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    await renderScreen(<Page input={{ ...PAGE, own: true }} />, clientWithFlag(true));
    await renderScreen(<Page input={{ ...PAGE, sample: true }} />, clientWithFlag(true));
    await renderScreen(<Page input={PAGE} />, clientWithFlag(false));
    await settle();
    expect(posts(calls)).toHaveLength(0);
  });

  it('counts a shared link as `shared_link`', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    await renderScreen(<Page input={{ ...PAGE, via: 'share' }} />, clientWithFlag(true));
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ subject: 'vehicle', id: CAR, source: 'shared_link' }));
  });

  it('counts the VEH-01 a sticker opened as `sticker_scan`, once', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 204 } });
    noteStickerScanOpen('nissan-r34');
    await renderScreen(<Page input={PAGE} />, clientWithFlag(true));
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ subject: 'vehicle', id: CAR, source: 'sticker_scan' }));
  });

  it('a failed beacon is dropped quietly: no retry, no error', async () => {
    const { calls } = stubApi({ 'POST /views': { status: 500, body: { message: 'Fehler', code: 'server_error', errors: {} } } });
    await renderScreen(<Page input={PAGE} />, clientWithFlag(true));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    await settle();
    expect(posts(calls)).toHaveLength(1);
  });
});
