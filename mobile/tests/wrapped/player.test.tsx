import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { WrappedPlayerScreen } from '@/features/wrapped/screens/WrappedPlayerScreen';
import { usePlayer } from '@/features/wrapped/usePlayer';
import { hydrateThemePreference } from '@/theme';
import { __setAccessibilityForTests } from '@/ui/motion';

import { newQueryClient, rawCards, rawPayload, renderScreen, SEASON, signIn, signOut, stubFetch, wrappedClient, type Answer } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { season?: string; card?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/wrapped/2027-saison',
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
const mockCapture = jest.fn(async () => 'file:///tmp/wrapped.png');
const mockRelease = jest.fn();
jest.mock('react-native-view-shot', () => ({ captureRef: (...args: unknown[]) => mockCapture(...(args as [])), releaseCapture: (...args: unknown[]) => mockRelease(...(args as [])) }));
const mockShareAsync = jest.fn(async () => undefined);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: (...args: unknown[]) => mockShareAsync(...(args as [])) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const PAYLOAD_PATH = `/me/wrapped/${SEASON}`;

async function open(answers: Parameters<typeof stubFetch>[0] = { [PAYLOAD_PATH]: { body: rawPayload() } }, params: { card?: string } = {}) {
  mockParams = { season: SEASON, ...params };
  const stub = stubFetch(answers);
  await renderScreen(<WrappedPlayerScreen />, newQueryClient());
  const room = await screen.findByTestId('WRP-01.room');
  await fireEvent(room, 'layout', { nativeEvent: { layout: { width: 393, height: 700, x: 0, y: 0 } } });
  return stub;
}

/** A state screen: no player, so nothing to lay out. */
async function show(answers: Parameters<typeof stubFetch>[0]) {
  mockParams = { season: SEASON };
  const stub = stubFetch(answers);
  // The flag `wrapped` is on: the list (for the countdown) is read only then (client round 6, L2).
  await renderScreen(<WrappedPlayerScreen />, wrappedClient());
  return stub;
}

const position = () => screen.getByTestId('WRP-01.progress').props['aria-label'] as string;
const tapAt = (x: number) =>
  act(async () => {
    fireGestureHandler(getByGestureTestId('WRP-01.tap'), [{ state: State.BEGAN, x }, { state: State.ACTIVE, x }, { state: State.END, x }]);
  });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  __setAccessibilityForTests({ reduceMotion: false, reduceTransparency: false });
});

describe('WRP-01 story player', () => {
  it('opens on the intro: the season, the brand moment, card 1 of 9', async () => {
    await open();
    expect(await screen.findByTestId('WRP-01.card.intro')).toBeTruthy();
    expect(screen.getByText('Deine Saison 2027')).toBeTruthy();
    expect(screen.getByTestId('WRP-01.card.intro.wordmark')).toBeTruthy();
    expect(screen.getByText('Saison 2027')).toBeTruthy();
    expect(position()).toBe('Karte 1 von 9');
    // No "Beispiel" on a real season.
    expect(screen.queryByTestId('WRP-01.card.intro.sample')).toBeNull();
  });

  it('tap right goes on, tap left goes back', async () => {
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    await tapAt(300);
    expect(await screen.findByTestId('WRP-01.card.spots')).toBeTruthy();
    expect(position()).toBe('Karte 2 von 9');
    await tapAt(300);
    expect(await screen.findByTestId('WRP-01.card.scans')).toBeTruthy();
    // The left 30 % of the card goes back.
    await tapAt(40);
    expect(await screen.findByTestId('WRP-01.card.spots')).toBeTruthy();
  });

  it('the buttons do the same, for screen readers and everyone', async () => {
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    expect(screen.getByTestId('WRP-01.previous').props['aria-disabled'] ?? screen.getByLabelText('Vorherige Karte')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Nächste Karte'));
    expect(await screen.findByTestId('WRP-01.card.spots')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Vorherige Karte'));
    expect(await screen.findByTestId('WRP-01.card.intro')).toBeTruthy();
  });

  it('auto-advances after 6 s and stays on the share card at the end', async () => {
    jest.useFakeTimers();
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    await act(async () => jest.advanceTimersByTime(5900));
    expect(screen.getByTestId('WRP-01.card.intro')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(200));
    expect(screen.getByTestId('WRP-01.card.spots')).toBeTruthy();
    for (let i = 0; i < 12; i += 1) await act(async () => jest.advanceTimersByTime(6000));
    expect(screen.getByTestId('WRP-01.card.share')).toBeTruthy();
    expect(position()).toBe('Karte 9 von 9');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('pause stops the clock and resumes where it stopped', async () => {
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    jest.useFakeTimers();
    await act(async () => jest.advanceTimersByTime(4000));
    await fireEvent.press(screen.getByLabelText('Anhalten'));
    expect(screen.getByLabelText('Weiter abspielen')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(20000));
    expect(screen.getByTestId('WRP-01.card.intro')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Weiter abspielen'));
    // 2 s of the card's 6 were left.
    await act(async () => jest.advanceTimersByTime(2100));
    expect(screen.getByTestId('WRP-01.card.spots')).toBeTruthy();
  });

  it('holding the card pauses until the finger lifts', async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => usePlayer({ total: 9, initialIndex: 0, startPaused: false, screenReader: false, blocked: false }));
    await act(async () => jest.advanceTimersByTime(3000));
    await act(async () => result.current.setHeld(true));
    expect(result.current.running).toBe(false);
    await act(async () => jest.advanceTimersByTime(20000));
    expect(result.current.index).toBe(0);
    await act(async () => result.current.setHeld(false));
    // The card keeps the 3 s it had: 3 more to go.
    await act(async () => jest.advanceTimersByTime(2900));
    expect(result.current.index).toBe(0);
    await act(async () => jest.advanceTimersByTime(200));
    expect(result.current.index).toBe(1);
  });

  it('a hold on the card is not a tap: it does not change the card', async () => {
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    await act(async () => {
      fireGestureHandler(getByGestureTestId('WRP-01.hold'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    });
    expect(screen.getByTestId('WRP-01.card.intro')).toBeTruthy();
    // Released: playing again.
    expect(screen.getByLabelText('Anhalten')).toBeTruthy();
  });

  it('never advances by itself while a screen reader runs', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    await waitFor(() => expect(screen.queryByTestId('WRP-01.pause')).toBeNull());
    jest.useFakeTimers();
    await act(async () => jest.advanceTimersByTime(30000));
    expect(screen.getByTestId('WRP-01.card.intro')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Nächste Karte'));
    expect(screen.getByTestId('WRP-01.card.spots')).toBeTruthy();
  });

  it('closes with the button and with a swipe down; a short drag springs back', async () => {
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    await fireEvent.press(screen.getByLabelText('Schließen'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('WRP-01.pan'), [{ translationY: 0, velocityY: 0 }, { translationY: 40, velocityY: 100 }]);
    });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('WRP-01.pan'), [{ translationY: 0, velocityY: 0 }, { translationY: 220, velocityY: 300 }]);
    });
    expect(mockRouter.back).toHaveBeenCalledTimes(2);
  });

  it('reduced motion: the card changes with the crossfade alone, no slide', async () => {
    __setAccessibilityForTests({ reduceMotion: true });
    await open();
    await screen.findByTestId('WRP-01.card.intro');
    await fireEvent.press(screen.getByLabelText('Nächste Karte'));
    expect(await screen.findByTestId('WRP-01.card.spots')).toBeTruthy();
    expect(screen.getByTestId('WRP-01.stage')).toHaveAnimatedStyle({ transform: [{ translateX: 0 }, { translateY: 0 }] });
  });

  it('leaves out cards without data: no 0 anywhere', async () => {
    const cards = rawCards().filter((card) => card.kind !== 'spots' && card.kind !== 'treffen');
    await open({ [PAYLOAD_PATH]: { body: rawPayload([...cards.slice(0, 2), { kind: 'spots', count: 0, unique_cars: 0, cities: [] }, ...cards.slice(2)]) } });
    await screen.findByTestId('WRP-01.card.intro');
    expect(position()).toBe('Karte 1 von 7');
    await fireEvent.press(screen.getByLabelText('Nächste Karte'));
    expect(await screen.findByTestId('WRP-01.card.scans')).toBeTruthy();
  });

  it('a link to card 4 opens on the Build Score', async () => {
    await open(undefined, { card: '4' });
    expect(await screen.findByTestId('WRP-01.card.score')).toBeTruthy();
    expect(screen.getByText('Von 412 auf 642 Punkte in dieser Saison.')).toBeTruthy();
    expect(screen.getByText('Aufgestiegen von Stufe 3 auf Stufe 4')).toBeTruthy();
  });

  it('shares the drawn card on the phone and counts it on the server', async () => {
    const { calls } = await open();
    await screen.findByTestId('WRP-01.card.intro');
    await fireEvent.press(screen.getByTestId('WRP-01.share'));
    await waitFor(() => expect(mockShareAsync).toHaveBeenCalledWith('file:///tmp/wrapped.png', expect.objectContaining({ mimeType: 'image/png' })));
    expect(mockCapture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: 'png', result: 'tmpfile' }));
    expect(mockRelease).toHaveBeenCalledWith('file:///tmp/wrapped.png');
    await waitFor(() => expect(calls.some((request) => request.method === 'POST' && new URL(request.url).pathname.endsWith(`${PAYLOAD_PATH}/shared`))).toBe(true));
    const post = calls.find((request) => request.method === 'POST');
    expect(post?.headers.get('Idempotency-Key')).toBe('uuid-1');
  });
});

describe('WRP-01 states', () => {
  it('not released yet: says so, with the release date from the countdown', async () => {
    await show({
      [PAYLOAD_PATH]: { status: 403, body: { message: 'Noch nicht veröffentlicht', code: 'wrapped_not_released', errors: {} } },
      '/me/wrapped': { body: { data: [{ season_key: SEASON, released: false }], meta: { countdown: { season_key: SEASON, release_at: '2027-11-01T10:00:00+01:00' } } } },
    });
    expect(await screen.findByTestId('WRP-01.notReleased')).toBeTruthy();
    expect(await screen.findByText(/Es erscheint am 1\. November 2027/)).toBeTruthy();
  });

  it('no Wrapped for this member: the sample share card and one way on', async () => {
    await show({ [PAYLOAD_PATH]: { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } } });
    expect(await screen.findByTestId('WRP-01.empty')).toBeTruthy();
    expect(screen.getByText('Für diese Saison gibt es kein Wrapped')).toBeTruthy();
    expect(screen.getByTestId('WRP-01.card.share.sample', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByText('Zur Garage'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/garage');
  });

  it('a season key that is not one: the empty state, nothing asked', async () => {
    mockParams = { season: '../me' };
    const { calls } = stubFetch({});
    await renderScreen(<WrappedPlayerScreen />, newQueryClient());
    expect(await screen.findByTestId('WRP-01.empty')).toBeTruthy();
    expect(calls.some((request) => request.url.includes('/me/wrapped/'))).toBe(false);
  });

  it('error: retry asks again', async () => {
    let fail = true;
    await show({ [PAYLOAD_PATH]: (): Answer => (fail ? { status: 500, body: { message: "Fehler", code: "server_error", errors: {} } } : { body: rawPayload() }) });
    // A 500 is retried twice (1 s, 2 s) before the error shows.
    expect(await screen.findByTestId('WRP-01.error', {}, { timeout: 8000 })).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByText('Erneut versuchen'));
    const room = await screen.findByTestId('WRP-01.room');
    await fireEvent(room, 'layout', { nativeEvent: { layout: { width: 393, height: 700, x: 0, y: 0 } } });
    expect(await screen.findByTestId('WRP-01.card.intro')).toBeTruthy();
  });

  it('guest: asks to sign in and comes back here', async () => {
    signOut();
    mockParams = { season: SEASON };
    stubFetch({});
    await renderScreen(<WrappedPlayerScreen />, newQueryClient());
    expect(await screen.findByTestId('WRP-01.guest')).toBeTruthy();
    expect(screen.getByText('Melde dich an, um dein Wrapped zu sehen')).toBeTruthy();
  });
});

afterAll(() => waitFor(() => undefined));
