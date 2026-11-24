import { fireEvent, screen } from '@testing-library/react-native';

import { modLine } from '@/features/dex/components/SpotCardFace';
import { DexCardScreen } from '@/features/dex/screens/DexCardScreen';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, spotCard, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/dex/car/x',
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const CARD = spotCard({ first_spotter: true });
const ID = CARD.vehicle.id;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  mockParams = { vehicleId: ID };
});

describe('DEX-04 Karte', () => {
  it('a spotted car: photo, number, rarity, top mods, owner, the cities line, the day and the way to its page', async () => {
    stubFetch({ [`/vehicles/${ID}/dex-card`]: { body: { data: CARD } } });
    await renderScreen(<DexCardScreen />);
    expect(await screen.findByTestId('DEX-04.card.rarity.rare')).toBeTruthy();
    expect(screen.getByText('Nr. 0087')).toBeTruthy();
    expect(screen.getByText('KW Variant 3')).toBeTruthy();
    expect(screen.getByText('Volk Racing TE37')).toBeTruthy();
    expect(screen.getByTestId('DEX-04.card.owner')).toBeTruthy();
    expect(screen.getByText('In 9 Städten gespottet')).toBeTruthy();
    expect(screen.getByTestId('DEX-04.card.firstSpotter')).toBeTruthy();
    expect(screen.getByText('Gespottet am 14. November 2026')).toBeTruthy();
    expect(screen.queryByTestId('DEX-04.notSpotted')).toBeNull();
    fireEvent.press(screen.getByTestId('DEX-04.toVehicle'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/v/${CARD.vehicle.slug}`);
  });

  it('a public car not spotted yet: the preview, no spot data, the scanner', async () => {
    // The server's preview keeps the spot keys, null (API handover, deviation 2).
    const preview = { ...CARD, spot_id: null, spotted_at: null, spotted: false, first_spotter: false, cities_count_label: null };
    stubFetch({ [`/vehicles/${ID}/dex-card`]: { body: { data: preview } } });
    await renderScreen(<DexCardScreen />);
    expect(await screen.findByTestId('DEX-04.notSpotted')).toBeTruthy();
    expect(screen.getByText('Noch nicht gespottet')).toBeTruthy();
    expect(screen.queryByTestId('DEX-04.card.cities')).toBeNull();
    expect(screen.queryByTestId('DEX-04.card.firstSpotter')).toBeNull();
    expect(screen.queryByTestId('DEX-04.spottedOn')).toBeNull();
    fireEvent.press(screen.getByTestId('DEX-04.scan'));
    expect(mockRouter.push).toHaveBeenCalledWith('/scan');
  });

  it('a car that is gone or not to be shown: not found, back to the Dex', async () => {
    stubFetch({});
    await renderScreen(<DexCardScreen />);
    expect(await screen.findByTestId('DEX-04.notFound')).toBeTruthy();
    expect(screen.getByText('Diese Karte gibt es nicht')).toBeTruthy();
  });

  it('names the brand of a mod once, also when the title already carries it (live answer: "KW V3", brand "KW")', () => {
    expect(modLine({ name: 'KW V3', brand: 'KW' })).toBe('KW V3');
    expect(modLine({ name: 'Rays Volk Racing TE37 Saga', brand: 'Rays' })).toBe('Rays Volk Racing TE37 Saga');
    expect(modLine({ name: 'Variant 3', brand: 'KW' })).toBe('KW Variant 3');
    expect(modLine({ name: 'Downpipe', brand: null })).toBe('Downpipe');
  });

});
