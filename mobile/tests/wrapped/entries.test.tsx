import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { WrappedCountdownBanner } from '@/features/wrapped/components/WrappedCountdownBanner';
import { WrappedProfileEntry } from '@/features/wrapped/components/WrappedProfileEntry';
import { __resetCountdownDismissals } from '@/features/wrapped/model';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, rawList, renderScreen, SEASON, signIn, signOut, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

/** Noon of the calendar day `days` from today: always that many calendar days away, whatever the time of the run. */
const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  __resetCountdownDismissals();
  signIn();
});

describe('PROF-01 "Mein Wrapped"', () => {
  it('shows the newest released season, "Neu" until opened, and opens it', async () => {
    stubFetch({ '/me/wrapped': { body: rawList([{ season_key: SEASON, released: true, generated_at: null, viewed_at: null }]) } });
    await renderScreen(<WrappedProfileEntry routeId="PROF-01" />, newQueryClient());
    // DQ-P5G-52: the year once, in the season line.
    expect(await screen.findByText('Mein Wrapped')).toBeTruthy();
    expect(screen.getByText('Saison 2027')).toBeTruthy();
    expect(screen.getByText('Neu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('PROF-01.wrapped'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/wrapped/[season]', params: { season: SEASON } });
  });

  it('nothing before a release, while the feature is off, or for a guest', async () => {
    const { calls } = stubFetch({ '/me/wrapped': { body: rawList([{ season_key: SEASON, released: false }]) } });
    await renderScreen(<WrappedProfileEntry routeId="PROF-01" />, newQueryClient());
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('PROF-01.wrapped')).toBeNull();

    stubFetch({});
    await renderScreen(<WrappedProfileEntry routeId="PROF-01" />, newQueryClient());
    expect(screen.queryByTestId('PROF-01.wrapped')).toBeNull();

    signOut();
    const guest = stubFetch({ '/me/wrapped': { body: rawList([{ season_key: SEASON, released: true }]) } });
    await renderScreen(<WrappedProfileEntry routeId="PROF-01" />, newQueryClient());
    expect(guest.calls).toHaveLength(0);
    expect(screen.queryByTestId('PROF-01.wrapped')).toBeNull();
  });
});

describe('HOME-01 countdown', () => {
  it('shows in the last 7 days when the server sends it, and stays away once dismissed', async () => {
    stubFetch({ '/me/wrapped': { body: rawList([], { season_key: SEASON, release_at: inDays(3) }) } });
    await renderScreen(<WrappedCountdownBanner routeId="HOME-01" />, newQueryClient());
    // DQ-P5G-18: the count stays with its noun (no-break space).
    expect(await screen.findByText('Dein Wrapped 2027 kommt in 3\u00a0Tagen')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Hinweis ausblenden'));
    expect(screen.queryByTestId('HOME-01.wrappedCountdown')).toBeNull();
  });

  it('not earlier than 7 days, and not without countdown info (the flag is off)', async () => {
    const early = stubFetch({ '/me/wrapped': { body: rawList([], { season_key: SEASON, release_at: inDays(12) }) } });
    await renderScreen(<WrappedCountdownBanner routeId="HOME-01" />, newQueryClient());
    await waitFor(() => expect(early.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('HOME-01.wrappedCountdown')).toBeNull();

    const off = stubFetch({ '/me/wrapped': { body: rawList([]) } });
    await renderScreen(<WrappedCountdownBanner routeId="HOME-01" />, newQueryClient());
    await waitFor(() => expect(off.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('HOME-01.wrappedCountdown')).toBeNull();
  });
});

afterAll(() => waitFor(() => undefined));
