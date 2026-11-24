import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { filterParam, setActive, windowOpen, type DexSet } from '@/api/queries/dex';
import { splitName } from '@/features/dex/components/DexTile';
import { DexHomeScreen, makesOf, openSlots } from '@/features/dex/screens/DexHomeScreen';
import { hydrateThemePreference } from '@/theme';

import { dexPage, dexSet, renderScreen, signIn, signOut, spotCard, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/dex',
  useNavigation: () => ({ getState: () => undefined }),
}));
jest.mock('@shopify/flash-list', () => jest.requireActual<object>('./flashListMock'));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const EK9 = spotCard();
const R34 = spotCard(
  { spot_id: '01spot0000000000000000000b', first_spotter: true },
  { id: '01r34000000000000000000000', name: 'Nissan Skyline GT-R R34', make: 'Nissan', make_slug: 'nissan', generation: 'R34', generation_slug: 'r34', dex_number: 34, rarity: 'legend' },
);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('DEX-01 Mein Dex', () => {
  it('shows "Dex 87 / 1.240", the cards with number, rarity and First Spotter, and the open slots of active sets', async () => {
    stubFetch({ '/me/dex': { body: dexPage([EK9, R34], { found: 87 }) }, '/me/dex/sets': { body: { data: [dexSet()] } } });
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByLabelText('87 von 1.240 Autos in deinem Dex')).toBeTruthy();
    expect(screen.getByText('87 / 1.240', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('DEX-01.progress.bar')).toBeTruthy();
    expect(screen.getByTestId(`DEX-01.card.${EK9.vehicle.id}.rarity.rare`)).toBeTruthy();
    expect(screen.getByTestId(`DEX-01.card.${R34.vehicle.id}.rarity.legend`)).toBeTruthy();
    expect(screen.getByTestId(`DEX-01.card.${R34.vehicle.id}.firstSpotter`)).toBeTruthy();
    expect(screen.queryByTestId(`DEX-01.card.${EK9.vehicle.id}.firstSpotter`)).toBeNull();
    expect(screen.getByText('Nr. 0087')).toBeTruthy();
    // The set's two unfound slots: one with the hint the rule gives, one without; the found slot is a card above, not a "???".
    expect(await screen.findByText('Noch offen in deinen Sets')).toBeTruthy();
    expect(screen.getAllByText('???', { includeHiddenElements: true })).toHaveLength(2);
    // DQ-P5G-08: the slot writes the hint as a card writes its name, the make as a caption over the generation.
    expect(screen.getByText('Mazda', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('FD', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText('Noch nicht gespottet: Mazda · FD, JDM Legends')).toBeTruthy();
  });

  it('opens a card on DEX-04', async () => {
    stubFetch({ '/me/dex': { body: dexPage([EK9], { found: 1 }) }, '/me/dex/sets': { body: { data: [] } } });
    await renderScreen(<DexHomeScreen />);
    fireEvent.press(await screen.findByTestId(`DEX-01.card.${EK9.vehicle.id}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/dex/car/[vehicleId]', params: { vehicleId: EK9.vehicle.id } });
  });

  it('filters by rarity through the chip and asks the server with filter=rarity:rare', async () => {
    const { calls } = stubFetch({ '/me/dex': { body: dexPage([EK9], { found: 87 }) }, '/me/dex/sets': { body: { data: [] } } });
    await renderScreen(<DexHomeScreen />);
    fireEvent.press(await screen.findByTestId('DEX-01.filters.rarity'));
    fireEvent.press(await screen.findByTestId('DEX-01.filters.option.rare'));
    await waitFor(() => expect(calls.some((call) => new URL(call.url).searchParams.get('filter') === 'rarity:rare')).toBe(true));
    // The chip names what is picked.
    await waitFor(() => expect(within(screen.getByTestId('DEX-01.filters.rarity')).getByText('Rare')).toBeTruthy());
  });

  it('a new spotter gets the badged sample and one action, Sticker scannen', async () => {
    stubFetch({ '/me/dex': { body: dexPage([], { found: 0 }) }, '/me/dex/sets': { body: { data: [] } } });
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByTestId('DEX-01.empty')).toBeTruthy();
    expect(screen.getByText('Dein Dex ist noch leer')).toBeTruthy();
    expect(screen.getByTestId('DEX-01.empty.sample.card.sample')).toBeTruthy();
    expect(screen.getByText('Beispiel')).toBeTruthy();
    // The sample shows no number and no count.
    expect(screen.queryByText(/Nr\./)).toBeNull();
    expect(screen.getByText('Sticker scannen')).toBeTruthy();
  });

  it('a guest is asked to sign in, nothing is requested', async () => {
    signOut();
    const { calls } = stubFetch({});
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByTestId('DEX-01.guest')).toBeTruthy();
    expect(calls.filter((call) => call.url.includes('/me/dex'))).toHaveLength(0);
  });

  it('shows the error with a retry when the Dex cannot load', async () => {
    stubFetch({ '/me/dex': { status: 500, body: { message: 'x', code: 'server_error', errors: {} } } });
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByTestId('DEX-01.error', {}, { timeout: 4000 })).toBeTruthy();
  });
});

describe('DEX-01 rules', () => {
  const today = new Date(2026, 10, 14);
  it('builds the filter values of the contract', () => {
    expect(filterParam({ kind: 'all' })).toBe('all');
    expect(filterParam({ kind: 'rarity', tier: 'ghost' })).toBe('rarity:ghost');
    expect(filterParam({ kind: 'make', slug: 'mercedes-benz', name: 'Mercedes-Benz' })).toBe('make:mercedes-benz');
    expect(filterParam({ kind: 'set', key: 'jdm-legends', name: 'JDM Legends' })).toBe('set:jdm-legends');
  });

  it('sets the make over the rest of the name, so the wordmark keeps to two lines', () => {
    expect(splitName('Nissan Skyline GT-R R34', 'Nissan')).toEqual({ make: 'Nissan', rest: 'Skyline GT-R R34' });
    expect(splitName('Der blaue Skyline', 'Nissan')).toEqual({ make: null, rest: 'Der blaue Skyline' });
    expect(splitName('BMW', 'BMW')).toEqual({ make: null, rest: 'BMW' });
  });

  it('lists each make once, A–Z', () => {
    expect(makesOf([R34, EK9, spotCard({}, { make: 'Honda' })])).toEqual([
      { slug: 'honda', name: 'Honda' },
      { slug: 'nissan', name: 'Nissan' },
    ]);
  });

  it('only active sets give silhouettes under "Alle": not complete, inside their season', () => {
    const open = dexSet() as unknown as DexSet;
    const done = { ...open, key: 'done', completed_at: '2026-04-12T18:00:00+02:00', progress: 3 } as DexSet;
    const later = { ...open, key: 'start', window: { starts_on: '03-01', ends_on: '04-30' } } as DexSet;
    expect(setActive(open, today)).toBe(true);
    expect(setActive(done, today)).toBe(false);
    expect(setActive(later, today)).toBe(false);
    const all = openSlots([open, done, later], { kind: 'all' }, today, 8);
    expect(all.map((slot) => slot.key)).toEqual(['jdm-legends.1', 'jdm-legends.2']);
    // A chosen set shows its own open slots, season or not.
    expect(openSlots([later], { kind: 'set', key: 'start', name: 'Saisonstart' }, today, 8)).toHaveLength(2);
    // Another filter shows none.
    expect(openSlots([open], { kind: 'rarity', tier: 'rare' }, today, 8)).toHaveLength(0);
  });

  it('season windows, also across the new year', () => {
    expect(windowOpen({ starts_on: '05-01', ends_on: '10-31' }, new Date(2026, 4, 1))).toBe(true);
    expect(windowOpen({ starts_on: '05-01', ends_on: '10-31' }, new Date(2026, 10, 1))).toBe(false);
    expect(windowOpen({ starts_on: '12-01', ends_on: '02-28' }, new Date(2027, 0, 10))).toBe(true);
    expect(windowOpen(null, today)).toBe(true);
  });
});
