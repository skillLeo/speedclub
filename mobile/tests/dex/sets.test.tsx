import { fireEvent, screen } from '@testing-library/react-native';

import { binderItems, DexSetsScreen, monthDayText, windowLine } from '@/features/dex/screens/DexSetsScreen';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { dexSet, renderScreen, signIn, spotCard, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/dex/sets',
}));
jest.mock('@shopify/flash-list', () => jest.requireActual<object>('./flashListMock'));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const SEASON_START = dexSet({
  key: 'season-start-2026',
  name: 'Saisonstart 2026',
  kind: 'season',
  progress: 2,
  target: 2,
  completed_at: '2026-04-12T18:00:00+02:00',
  window: { starts_on: '03-01', ends_on: '04-30' },
  slots: [
    { found: true, vehicle: spotCard(), silhouette: null },
    { found: true, vehicle: spotCard({ spot_id: 's2' }, { id: '01r34', name: 'Nissan Skyline GT-R R34' }), silhouette: null },
  ],
});

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('DEX-05 Sets', () => {
  it('shows each set as a page: progress, the found cards and the open slots with their hint', async () => {
    stubFetch({ '/me/dex/sets': { body: { data: [dexSet(), SEASON_START] } } });
    await renderScreen(<DexSetsScreen />);
    expect(await screen.findByTestId('DEX-05.set.jdm-legends')).toBeTruthy();
    expect(screen.getByText('1 von 3')).toBeTruthy();
    expect(screen.getByTestId('DEX-05.set.jdm-legends.slot.0.rarity.rare')).toBeTruthy();
    expect(screen.getByLabelText('Noch nicht gespottet: Mazda · FD')).toBeTruthy();
    expect(screen.getByLabelText('Noch nicht gespottet')).toBeTruthy();
    fireEvent.press(screen.getByTestId('DEX-05.set.jdm-legends.slot.0'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/dex/car/[vehicleId]', params: { vehicleId: '01ek9000000000000000000000' } });
  });

  it('folds the unnamed open slots of a count rule into one "+n offen" (DQ-P5G-09)', async () => {
    const open = { found: false, vehicle: null, silhouette: null };
    const brand = dexSet({ key: 'brand-porsche-5', name: 'Porsche · 5 Autos', kind: 'brand', target: 5, slots: [{ found: true, vehicle: spotCard(), silhouette: null }, open, open, open, open] });
    expect(binderItems(brand.slots).map((item) => item.kind)).toEqual(['slot', 'remaining']);
    expect(binderItems(brand.slots)[1]).toMatchObject({ kind: 'remaining', count: 4 });
    // Named slots (a JDM generation) stay one by one; a single unnamed slot stays a slot.
    expect(binderItems(dexSet().slots).map((item) => item.kind)).toEqual(['slot', 'slot', 'slot']);
    stubFetch({ '/me/dex/sets': { body: { data: [brand] } } });
    await renderScreen(<DexSetsScreen />);
    expect(await screen.findByTestId('DEX-05.set.brand-porsche-5.remaining')).toBeTruthy();
    expect(screen.getByLabelText('Noch 4 Autos offen')).toBeTruthy();
    expect(screen.queryByTestId('DEX-05.set.brand-porsche-5.slot.2')).toBeNull();
  });

  it('a completed set says so with its day; a season outside its window says when it runs again', async () => {
    stubFetch({ '/me/dex/sets': { body: { data: [SEASON_START] } } });
    await renderScreen(<DexSetsScreen />);
    expect(await screen.findByTestId('DEX-05.set.season-start-2026.complete')).toBeTruthy();
    expect(screen.getByText('Komplett seit 12. April 2026')).toBeTruthy();
    expect(screen.getByTestId('DEX-05.set.season-start-2026.window')).toBeTruthy();
  });

  it('no set: the badged sample and the way back to the Dex', async () => {
    stubFetch({ '/me/dex/sets': { body: { data: [] } } });
    await renderScreen(<DexSetsScreen />);
    expect(await screen.findByTestId('DEX-05.empty')).toBeTruthy();
    expect(screen.getByText('Beispiel')).toBeTruthy();
  });
});

describe('DEX-05 rules', () => {
  const t = i18n.getFixedT('de', 'dex') as unknown as (key: string, options?: Record<string, unknown>) => string;
  it('formats season windows the German and the English way', () => {
    expect(monthDayText('03-01', 'de')).toBe('1.3.');
    expect(monthDayText('10-31', 'de')).toBe('31.10.');
    expect(monthDayText('03-01', 'en')).toBe('1 Mar');
    expect(windowLine(t, { starts_on: '05-01', ends_on: '10-31' }, new Date(2026, 6, 1), 'de')).toBe('1.5. bis 31.10.');
    expect(windowLine(t, { starts_on: '03-01', ends_on: '04-30' }, new Date(2026, 10, 14), 'de')).toBe('Läuft wieder ab 1.3.');
    expect(windowLine(t, null, new Date(), 'de')).toBeNull();
  });

});
