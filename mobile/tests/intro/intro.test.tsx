// R4-1.4 INTRO-01…04: four pages after the first sign-in of an account, skippable, once per account (`me.intro_seen_at`), never for a
// guest; an older server without the field never shows them. Settings › Hilfe replays them without touching the account's mark.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import type { Me } from '@/api/queries/auth';
import { introDue } from '@/features/intro/api';
import { INTRO_DIALOG_MAX_WIDTH, IntroScreen, introBodyKey, introPhotoMin, introStage, pageOpacity, STACK_FONT_SCALE } from '@/features/intro/IntroScreen';
import { shouldOpenIntro, type IntroTriggerInput } from '@/features/intro/trigger';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { __setAccessibilityForTests } from '@/ui/motion/preference';

import { renderScreen, stubFetch } from '../settings/harness';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const me = (fields: Record<string, unknown>) => ({ id: 'm1', ...fields }) as unknown as Me;

const base: IntroTriggerInput = { status: 'member', nextStep: null, pathname: '/garage', due: true, opened: false, suppressed: false };

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  __setAccessibilityForTests({ reduceMotion: true });
});
afterAll(() => __setAccessibilityForTests({ reduceMotion: false }));

describe('introDue', () => {
  it('is due only for an explicit null; a missing field (older server) counts as seen', () => {
    expect(introDue(me({ intro_seen_at: null }))).toBe(true);
    expect(introDue(me({ intro_seen_at: '2026-11-21T10:00:00Z' }))).toBe(false);
    expect(introDue(me({}))).toBe(false);
    expect(introDue(undefined)).toBe(false);
  });
});

describe('shouldOpenIntro', () => {
  it('opens for a member with nothing left to do, on an app route', () => {
    expect(shouldOpenIntro(base)).toBe(true);
    expect(shouldOpenIntro({ ...base, pathname: '/' })).toBe(true);
  });

  it('never opens for a guest, twice, with an open F1 step, under QA or once seen', () => {
    expect(shouldOpenIntro({ ...base, status: 'guest' })).toBe(false);
    expect(shouldOpenIntro({ ...base, status: 'loading' })).toBe(false);
    expect(shouldOpenIntro({ ...base, opened: true })).toBe(false);
    expect(shouldOpenIntro({ ...base, nextStep: 'profile_setup' })).toBe(false);
    expect(shouldOpenIntro({ ...base, suppressed: true })).toBe(false);
    expect(shouldOpenIntro({ ...base, due: false })).toBe(false);
  });

  it('waits on the sign-in and F1 routes (primer, passkey offer) and the gates, and never stacks on itself', () => {
    for (const pathname of ['/sign-in', '/profile-setup', '/notifications-primer', '/auth/passkey-offer', '/maintenance', '/settings/legal/terms', '/intro']) {
      expect(shouldOpenIntro({ ...base, pathname })).toBe(false);
    }
  });
});

describe('introStage (R4DQ-08)', () => {
  it('fills a phone and centres a dialog of at most 480 × 720 from 768, never closer than 40 to the window', () => {
    expect(introStage({ width: 390, height: 844 }, 20, true)).toEqual({ dialog: false, width: 390, height: 844 });
    expect(INTRO_DIALOG_MAX_WIDTH).toBe(480);
    expect(introStage({ width: 1280, height: 800 }, 24, false)).toEqual({ dialog: true, width: 480, height: 720 });
    expect(introStage({ width: 1280, height: 700 }, 24, false)).toEqual({ dialog: true, width: 480, height: 620 });
    expect(introStage({ width: 800, height: 1024 }, 24, false)).toEqual({ dialog: true, width: 480, height: 720 });
  });

  it('R4DQ-59: on a short stage at a large font the photo gives way to 30 % of the height; elsewhere it keeps a 4:3 crop', () => {
    expect(introPhotoMin({ width: 360, height: 640 }, 1)).toBe(270);
    expect(introPhotoMin({ width: 360, height: 640 }, 2)).toBe(192);
    expect(introPhotoMin({ width: 390, height: 844 }, 2)).toBe(293);
    expect(introPhotoMin({ width: 480, height: 620 }, 2)).toBe(186);
  });

  it('crossfades a page photo with the pager position', () => {
    expect(pageOpacity(1, 1)).toBe(1);
    expect(pageOpacity(1.5, 1)).toBe(0.5);
    expect(pageOpacity(0.5, 1)).toBe(0.5);
    expect(pageOpacity(3, 1)).toBe(0);
  });
});

describe('INTRO-01…04', () => {
  it('names Crews on the last page only with the crews flag', () => {
    expect(introBodyKey('community', false)).toBe('intro.pages.community.body');
    expect(introBodyKey('community', true)).toBe('intro.pages.community.bodyCrews');
    expect(introBodyKey('club', true)).toBe('intro.pages.club.body');
  });

  it('pages through the four pages and ends with Los geht’s, which marks the account', async () => {
    useSessionStore.setState({ status: 'member' });
    const { calls } = stubFetch({ '/me/intro/seen': { body: {} } });
    await renderScreen(<IntroScreen />);
    // R4DQ-24: the phrases are bound (no break inside "dein Build"); the dots announce the position, no second caption.
    expect(screen.getByTestId('INTRO-01.title').props.children).toBe('Deine\u00a0Garage, dein\u00a0Build, dein\u00a0Club');
    expect(screen.getByTestId('INTRO-01.indicator').props['aria-label']).toBe('Seite 1 von 4');
    expect(screen.queryByTestId('INTRO-01.step')).toBeNull();
    expect(screen.queryByTestId('INTRO-01.back')).toBeNull();
    await fireEvent.press(screen.getByTestId('INTRO-01.next'));
    expect(screen.getByTestId('INTRO-02.title')).toHaveTextContent('Garage & Mods');
    expect(screen.getByTestId('INTRO-02.indicator').props['aria-label']).toBe('Seite 2 von 4');
    await fireEvent.press(screen.getByTestId('INTRO-02.back'));
    expect(screen.getByTestId('INTRO-01.title')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('INTRO-01.next'));
    await fireEvent.press(screen.getByTestId('INTRO-02.next'));
    expect(screen.getByTestId('INTRO-03.title')).toHaveTextContent('Der Sticker');
    await fireEvent.press(screen.getByTestId('INTRO-03.next'));
    // The last page has no skip: its button ends the introduction.
    expect(screen.queryByTestId('INTRO-04.skip')).toBeNull();
    expect(screen.getByTestId('INTRO-04.done')).toHaveTextContent('Los geht’s');
    await act(async () => fireEvent.press(screen.getByTestId('INTRO-04.done')));
    await waitFor(() => expect(calls.some((request) => request.method === 'POST' && request.url.endsWith('/me/intro/seen'))).toBe(true));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('R4DQ-42/47: at a large font the buttons stack on every page, page 1 keeping Zurück’s room; the pager is a named, focusable region', async () => {
    // The jest window reports font scale 2.
    expect(Dimensions.get('window').fontScale).toBeGreaterThanOrEqual(STACK_FONT_SCALE);
    useSessionStore.setState({ status: 'member' });
    stubFetch({});
    await renderScreen(<IntroScreen replay />);
    const pager = screen.getByTestId('INTRO.pager');
    expect(pager.props.tabIndex).toBe(0);
    expect(pager.props['aria-label']).toBe('Einführung');
    expect(screen.getByTestId('INTRO.backRoom', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('INTRO-01.next'));
    expect(screen.queryByTestId('INTRO.backRoom', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('INTRO-02.back')).toBeTruthy();
  });

  it('skips from the first page, which marks the account too', async () => {
    useSessionStore.setState({ status: 'member' });
    const { calls } = stubFetch({ '/me/intro/seen': { body: {} } });
    await renderScreen(<IntroScreen />);
    await act(async () => fireEvent.press(screen.getByTestId('INTRO-01.skip')));
    await waitFor(() => expect(calls.some((request) => request.url.endsWith('/me/intro/seen'))).toBe(true));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('changes nothing on the server when replayed from Hilfe or seen by a guest', async () => {
    useSessionStore.setState({ status: 'member' });
    const replay = stubFetch({});
    await renderScreen(<IntroScreen replay />);
    await act(async () => fireEvent.press(screen.getByTestId('INTRO-01.skip')));
    expect(replay.calls.filter((request) => request.url.endsWith('/me/intro/seen'))).toHaveLength(0);
    screen.unmount();

    useSessionStore.setState({ status: 'guest' });
    const guest = stubFetch({});
    await renderScreen(<IntroScreen />);
    await act(async () => fireEvent.press(screen.getByTestId('INTRO-01.skip')));
    expect(guest.calls.filter((request) => request.url.endsWith('/me/intro/seen'))).toHaveLength(0);
    expect(mockRouter.back).toHaveBeenCalledTimes(2);
  });
});
