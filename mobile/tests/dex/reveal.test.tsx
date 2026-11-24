import { screen, waitFor, within } from '@testing-library/react-native';

import { dexKeys, type SpotResponse } from '@/api/queries/dex';
import { SpotRevealScreen } from '@/features/dex/screens/SpotRevealScreen';
import { qa } from '@/lib/qa';
import { haptics, __setAccessibilityForTests } from '@/ui/motion';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, signIn, spotCard, spotResponse, stubFetch } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { spotId?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/dex/spot/x',
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// The sensor tilt is native and needs a device; its gate (full motion, focused) is the screen's.
jest.mock('@/features/dex/components/Tilt', () => ({ Tilt: ({ children }: { children: unknown }) => children }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ID = '01spot0000000000000000000a';

async function showReveal(response: SpotResponse) {
  mockParams = { spotId: response.data.spot_id };
  const client = newQueryClient();
  client.setQueryData(dexKeys.spot(response.data.spot_id), response);
  return renderScreen(<SpotRevealScreen />, client);
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  // The car's page answers nothing: Folgen and the reaction stay away, the card is what is tested here.
  stubFetch({});
});
const mockQa = qa as { dex?: string; state?: string };
afterEach(() => {
  __setAccessibilityForTests({ reduceMotion: false, reduceTransparency: false });
  delete mockQa.dex;
  delete mockQa.state;
});

describe('DEX-03 spot reveal', () => {
  it('a new car: NEU, its rarity, its number, one success haptic', async () => {
    const success = jest.spyOn(haptics, 'success');
    await showReveal(spotResponse({ new_in_dex: true }));
    expect(await screen.findByTestId('DEX-03.new')).toBeTruthy();
    expect(screen.getByText('Neu in deinem Dex')).toBeTruthy();
    // The front is announced once the card has turned.
    expect(await screen.findByTestId('DEX-03.card.rarity.rare')).toBeTruthy();
    expect(screen.getByText('Nr. 0087')).toBeTruthy();
    // DQ-P5G-01: the number stands on the dark stage under the photo, never on its sky.
    expect(within(screen.getByTestId('DEX-03.card.photo')).queryByTestId('DEX-03.card.number')).toBeNull();
    expect(screen.getByText('Honda Civic Type R EK9')).toBeTruthy();
    expect(screen.getByText('KW Variant 3')).toBeTruthy();
    expect(screen.getByText('In 9 Städten gespottet')).toBeTruthy();
    expect(screen.getByTestId('DEX-03.toDex')).toBeTruthy();
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
  });

  it('the same car again: "Schon in deinem Dex", no NEU', async () => {
    await showReveal(spotResponse({ new_in_dex: false, duplicate: true }));
    expect(await screen.findByText('Schon in deinem Dex')).toBeTruthy();
    expect(screen.queryByTestId('DEX-03.new')).toBeNull();
  });

  it('a young account: the spot does not count yet, said plainly', async () => {
    await showReveal(spotResponse({ new_in_dex: false, counted: false, reason: 'account_too_new' }));
    expect(await screen.findByText('Dein Konto ist noch neu – Spots zählen ab morgen.')).toBeTruthy();
    expect(screen.queryByTestId('DEX-03.new')).toBeNull();
  });

  it('a sample car scanned by a real member: says so, no NEU, no set steps (ADR-514)', async () => {
    await showReveal(spotResponse({ new_in_dex: false, counted: false, reason: 'sample_car' }));
    expect(await screen.findByText('Ein Beispielauto – dieser Spot zählt nicht für deinen Dex.')).toBeTruthy();
    expect(screen.queryByText('Dein Konto ist noch neu – Spots zählen ab morgen.')).toBeNull();
    expect(screen.queryByTestId('DEX-03.new')).toBeNull();
  });

  it('First Spotter: the tag, the line and the foil sweep', async () => {
    await showReveal(spotResponse({ first_spotter: true }, spotCard({ first_spotter: true })));
    expect(await screen.findByTestId('DEX-03.card.firstSpotter')).toBeTruthy();
    expect(screen.getByTestId('DEX-03.firstSpotterLine')).toBeTruthy();
    // The foil is decoration, hidden from screen readers.
    expect(screen.getByTestId('DEX-03.foil', { includeHiddenElements: true })).toBeTruthy();
  });

  it('reduced motion: no foil sweep, and the faces crossfade without turning', async () => {
    __setAccessibilityForTests({ reduceMotion: true });
    await showReveal(spotResponse({ first_spotter: true }, spotCard({ first_spotter: true })));
    expect(await screen.findByTestId('DEX-03.card.firstSpotter')).toBeTruthy();
    expect(screen.queryByTestId('DEX-03.foil', { includeHiddenElements: true })).toBeNull();
    // DQ-P5G-14: the permanent foil at rest stays, with the tag in the photo's top row.
    expect(screen.getByTestId('DEX-03.card.foilFrame')).toBeTruthy();
    expect(within(screen.getByTestId('DEX-03.card.photo')).getByTestId('DEX-03.card.firstSpotter')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('DEX-03.flip.front')).toHaveAnimatedStyle({ transform: [] }));
  });

  it('full motion: the card turns on rotateY', async () => {
    await showReveal(spotResponse());
    const front = await screen.findByTestId('DEX-03.flip.front');
    const style = (front.props as { style: unknown }).style;
    expect(JSON.stringify(style)).toContain('rotateY');
  });

  it('a forced empty state wins over the QA sample (DQ-P5G-02)', async () => {
    mockQa.dex = 'new';
    mockQa.state = 'empty';
    mockParams = { spotId: 'sample' };
    await renderScreen(<SpotRevealScreen />, newQueryClient());
    expect(await screen.findByTestId('DEX-03.notFound')).toBeTruthy();
    expect(screen.queryByTestId('DEX-03.skeleton')).toBeNull();
  });

  it('a Ghost car gets the Ghost frame and label', async () => {
    await showReveal(spotResponse({}, spotCard({}, { ghost: true, rarity: 'legend' })));
    expect(await screen.findByTestId('DEX-03.card.ghostFrame')).toBeTruthy();
    expect(screen.getByTestId('DEX-03.card.rarity.ghost')).toBeTruthy();
  });

  it('a spot that is gone: a calm state with the way to the Dex', async () => {
    mockParams = { spotId: ID };
    stubFetch({ [`/spots/${ID}`]: { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } } });
    await renderScreen(<SpotRevealScreen />);
    expect(await screen.findByTestId('DEX-03.notFound')).toBeTruthy();
  });

  it('opens from a link by loading the spot: NEU for the first counted spot of the car', async () => {
    mockParams = { spotId: ID };
    // GET spots/{spot} as the live server answers: duplicate false, set_progress empty, new_in_dex for the first counted spot.
    stubFetch({ [`/spots/${ID}`]: { body: spotResponse({ new_in_dex: true, first_spotter: false }) } });
    await renderScreen(<SpotRevealScreen />);
    expect(await screen.findByText('Neu in deinem Dex')).toBeTruthy();
    // The card face lays its name out after the label (flip, then DisplayTitle's first frame): wait for it, as for the label.
    expect(await screen.findByText('Honda Civic Type R EK9')).toBeTruthy();
  });

  it('opens from a link to a later spot of a car already in the Dex', async () => {
    mockParams = { spotId: ID };
    stubFetch({ [`/spots/${ID}`]: { body: spotResponse({ new_in_dex: false }) } });
    await renderScreen(<SpotRevealScreen />);
    expect(await screen.findByText('Schon in deinem Dex')).toBeTruthy();
  });
});
