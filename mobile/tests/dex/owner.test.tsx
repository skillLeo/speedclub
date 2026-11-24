import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { dexKeys, spotSettingsOf, spotStatsOf } from '@/api/queries/dex';
import { garageKeys } from '@/api/queries/garage';
import { ownerSpotLineText } from '@/features/dex/components/OwnerSpotLine';
import { lastDays } from '@/features/dex/components/SpotBars';
import { SpotSettings } from '@/features/dex/components/SpotSettings';
import { nextFamousTier, OwnerSpotsScreen } from '@/features/dex/screens/OwnerSpotsScreen';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';
import { ToastHost } from '@/ui';

import { newQueryClient, renderScreen, signIn, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/vehicles/x/spots',
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ID = '01ek9000000000000000000000';
const today = new Date();
const iso = (daysAgo: number) => new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** As the live server answers (M5.9b, 2026-11-15): 30 Berlin days oldest first with zeros, integer counts, `{anonymous: true}` spotters. */
const DAY_COUNTS: Readonly<Record<number, number>> = { 0: 2, 6: 9 };
const STATS = {
  total: 37,
  unique_spotters: 29,
  cities_count: 2,
  cities: [
    { name: 'Köln', count: 14 },
    { name: 'Düsseldorf', count: 9 },
  ],
  last_30_days: Array.from({ length: 30 }, (_, index) => ({ day: iso(29 - index), count: DAY_COUNTS[29 - index] ?? 0 })),
  recent_spotters: [{ username: 'mara.fd', display_name: 'Mara', avatar: null }, { anonymous: true }, { anonymous: true }],
  street_famous: { tier: 10 as const },
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  mockParams = { id: ID };
});

describe('DEX-06 owner spot stats', () => {
  it('shows the numbers, Street Famous, 30 days with today in the accent, the day cities and "jemand"', async () => {
    stubFetch({ [`/vehicles/${ID}/spot-stats`]: { body: { data: STATS } }, [`/vehicles/${ID}`]: { body: { data: { id: ID, full_title: 'Honda Civic Type R EK9', hide_spot_cities: false } } } });
    await renderScreen(<OwnerSpotsScreen />);
    expect(await screen.findByLabelText('37 Spots')).toBeTruthy();
    expect(screen.getByLabelText('29 Leute')).toBeTruthy();
    expect(screen.getByLabelText('2 Städte')).toBeTruthy();
    expect(screen.getByText('Street Famous 10')).toBeTruthy();
    expect(screen.getByTestId(`DEX-06.days.bar.${iso(0)}`)).toBeTruthy();
    expect(screen.getByLabelText('Spots pro Tag in den letzten 30 Tagen: heute 2, an einem Tag höchstens 9.')).toBeTruthy();
    expect(screen.getByText('Köln')).toBeTruthy();
    expect(screen.getByText('Spots zwischen 22 und 6 Uhr zählen mit, zeigen aber nie eine Stadt.')).toBeTruthy();
    expect(screen.getByText('Mara')).toBeTruthy();
    // Spotters who keep "Meine Spots zeigen" off read as "jemand".
    expect(screen.getAllByText('jemand')).toHaveLength(2);
    fireEvent.press(screen.getByTestId('DEX-06.settings'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/garage/${ID}/visibility`);
  });

  it('holds the car hero\'s slot with a skeleton while the car loads, then shows the cover and the name (review SF-4)', async () => {
    const { fetchMock } = stubFetch({
      [`/vehicles/${ID}/spot-stats`]: { body: { data: STATS } },
      [`/vehicles/${ID}`]: { body: { data: { id: ID, full_title: 'Honda Civic Type R EK9', hide_spot_cities: false } } },
    });
    // The car's own request waits until the test lets it through; the stats answer at once.
    const answer = fetchMock.getMockImplementation();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementation(async (input: Request | string) => {
      const request = typeof input === 'string' ? new Request(input) : input;
      if (new URL(request.url).pathname.endsWith(`/vehicles/${ID}`)) await gate;
      return answer!(input);
    });
    await renderScreen(<OwnerSpotsScreen />);
    expect(await screen.findByTestId('DEX-06.hero.skeleton')).toBeTruthy();
    release();
    expect(await screen.findByTestId('DEX-06.hero')).toBeTruthy();
    expect(screen.queryByTestId('DEX-06.hero.skeleton')).toBeNull();
  });

  it('with the cities hidden, shows no city and no city count', async () => {
    stubFetch({
      [`/vehicles/${ID}/spot-stats`]: { body: { data: { ...STATS, cities: [], cities_count: 0 } } },
      [`/vehicles/${ID}`]: { body: { data: { id: ID, full_title: 'Honda Civic Type R EK9', hide_spot_cities: true } } },
    });
    await renderScreen(<OwnerSpotsScreen />);
    expect(await screen.findByTestId('DEX-06.cities.hidden')).toBeTruthy();
    expect(screen.queryByTestId('DEX-06.citiesCount')).toBeNull();
    expect(screen.queryByText('Köln')).toBeNull();
  });

  it('somebody else gets the owner-only notice, nothing else', async () => {
    stubFetch({ [`/vehicles/${ID}/spot-stats`]: { status: 403, body: { message: 'x', code: 'forbidden', errors: {} } } });
    await renderScreen(<OwnerSpotsScreen />);
    expect(await screen.findByTestId('DEX-06.restricted')).toBeTruthy();
    expect(screen.getByText('Nur der Besitzer sieht die Spots eines Autos.')).toBeTruthy();
  });

  it('nobody yet: the badged month and the way to the sticker', async () => {
    stubFetch({ [`/vehicles/${ID}/spot-stats`]: { body: { data: { ...STATS, total: 0, unique_spotters: 0, cities_count: 0, cities: [], last_30_days: [], recent_spotters: [], street_famous: { tier: null } } } } });
    await renderScreen(<OwnerSpotsScreen />);
    expect(await screen.findByTestId('DEX-06.empty')).toBeTruthy();
    expect(screen.getByText('Beispiel')).toBeTruthy();
    fireEvent.press(screen.getByText('Sticker ansehen'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/stickers/${ID}`);
  });
});

describe('DEX-06 rules', () => {
  const t = i18n.getFixedT('de', 'dex');
  const number = (value: number) => new Intl.NumberFormat('de-DE').format(value);
  // DQ-P5G-18: a number never parts from its noun (no-break space).
  it('the VEH-01 owner line', () => {
    expect(ownerSpotLineText(t, { unique_spotters: 112, cities_count: 9 }, number)).toBe('Gespottet von 112\u00A0Leuten in 9\u00A0Städten');
    expect(ownerSpotLineText(t, { unique_spotters: 1, cities_count: 1 }, number)).toBe('Gespottet von 1\u00A0Person in 1\u00A0Stadt');
    expect(ownerSpotLineText(t, { unique_spotters: 1240, cities_count: 0 }, number)).toBe('Gespottet von 1.240\u00A0Leuten');
    expect(ownerSpotLineText(t, { unique_spotters: 0, cities_count: 0 }, number)).toBeNull();
  });

  it('fills the 30 days, oldest first', () => {
    const days = lastDays([{ day: '2026-11-14', count: 3 }, { day: '2026-10-01', count: 8 }], new Date(2026, 10, 14));
    expect(days).toHaveLength(30);
    expect(days[29]).toEqual({ day: '2026-11-14', count: 3 });
    expect(days[0]?.day).toBe('2026-10-16');
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(3);
  });

  it('Street Famous steps; the stats with numeric counts and no name behind "anonymous"', () => {
    expect(nextFamousTier(29)).toBe(50);
    expect(nextFamousTier(500)).toBeNull();
    const stats = spotStatsOf({ ...STATS, total: 3, unique_spotters: 2, cities_count: 1, recent_spotters: [{ anonymous: true }] });
    expect(stats).toMatchObject({ total: 3, unique_spotters: 2, cities_count: 1 });
    type Resource = Parameters<typeof spotStatsOf>[0];
    const live = spotStatsOf({ ...STATS, recent_spotters: [{ anonymous: true, username: 'leak' }] } as unknown as Resource);
    expect(live.total).toBe(37);
    expect(live.recent_spotters).toEqual([{ anonymous: true }]);
  });
});

describe('GAR-12 Spots switches', () => {
  it('saves Ghost-Modus at once with PATCH /vehicles/{id}, and goes back when the server refuses', async () => {
    const { calls } = stubFetch({ [`/vehicles/${ID}`]: () => ({ body: { data: { id: ID, ghost_mode: true } } }) });
    const client = newQueryClient();
    client.setQueryData(garageKeys.vehicle(ID), { id: ID, full_title: 'Honda Civic Type R EK9', ghost_mode: false, spotting_paused: false, hide_spot_cities: false });
    await renderScreen(
      <>
        <SpotSettings vehicleId={ID} routeId="GAR-12" />
        <ToastHost />
      </>,
      client,
    );
    expect(screen.getByText('Dein Auto taucht nicht mehr in Suche, Entdecken und Listen auf. Nur wer es vor Ort scannt, findet es.')).toBeTruthy();
    await fireEvent(screen.getByTestId('GAR-12.spots.ghost.switch'), 'valueChange', true);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(new URL(patch?.url ?? '').pathname).toBe(`/api/v1/vehicles/${ID}`);
    expect(await patch?.clone().json()).toEqual({ ghost_mode: true });
    await waitFor(() => expect(spotSettingsOf(client.getQueryData(garageKeys.vehicle(ID))).ghost_mode).toBe(true));
    expect(client.getQueryState(dexKeys.spotStats(ID))?.isInvalidated ?? true).toBe(true);
  });

  it('a refused switch goes back', async () => {
    stubFetch({ [`/vehicles/${ID}`]: { status: 422, body: { message: 'Nein', code: 'validation_failed', errors: {} } } });
    const client = newQueryClient();
    client.setQueryData(garageKeys.vehicle(ID), { id: ID, ghost_mode: false, spotting_paused: false, hide_spot_cities: false });
    await renderScreen(<SpotSettings vehicleId={ID} routeId="GAR-12" />, client);
    await fireEvent(screen.getByTestId('GAR-12.spots.pause.switch'), 'valueChange', true);
    await waitFor(() => expect(spotSettingsOf(client.getQueryData(garageKeys.vehicle(ID))).spotting_paused).toBe(false));
  });
});
