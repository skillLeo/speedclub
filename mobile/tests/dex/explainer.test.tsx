// R4-3.1 DEX-01 explainer: "Dein STREET DEX: Autos sammeln, die du in echt siehst", three steps and "So funktioniert's" (the rules
// sheet), expanded on the first visits on this device until hidden, then the compact link.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { DEX_EXPLAINER_KEY, EXPANDED_VISITS, explainerExpanded, resetDexExplainerForTests } from '@/features/dex/explainer';
import { DexHomeScreen } from '@/features/dex/screens/DexHomeScreen';
import type { QaState } from '@/lib/qa';
import { hydrateThemePreference } from '@/theme';

import { dexPage, renderScreen, signIn, signOut, spotCard, stubFetch } from './helpers';

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

const mockQa: { state: QaState } = { state: 'default' };
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));

beforeAll(hydrateThemePreference);
beforeEach(async () => {
  jest.clearAllMocks();
  resetDexExplainerForTests();
  await AsyncStorage.clear();
  signIn();
});

const stubDex = () => stubFetch({ '/me/dex': { body: dexPage([spotCard()], { found: 1 }) }, '/me/dex/sets': { body: { data: [] } } });

describe('explainerExpanded', () => {
  it('is expanded on the first visits until hidden', () => {
    expect(explainerExpanded({ visits: 1, dismissed: false })).toBe(true);
    expect(explainerExpanded({ visits: EXPANDED_VISITS, dismissed: false })).toBe(true);
    expect(explainerExpanded({ visits: EXPANDED_VISITS + 1, dismissed: false })).toBe(false);
    expect(explainerExpanded({ visits: 1, dismissed: true })).toBe(false);
  });
});

describe('DEX-01 explainer', () => {
  it('shows the card with its three steps on a first visit and opens the rules sheet', async () => {
    stubDex();
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByTestId('DEX-01.explainer')).toBeTruthy();
    expect(screen.getByTestId('DEX-01.explainer.title')).toHaveTextContent('Dein STREET DEX: Autos sammeln, die du in echt siehst');
    // The step's numeral, then its line.
    expect(screen.getByTestId('DEX-01.explainer.step.scan')).toHaveTextContent('1Den Sticker an einem Auto scannen (das ist ein Spot)');
    expect(screen.getByTestId('DEX-01.explainer.step.collect')).toBeTruthy();
    expect(screen.getByTestId('DEX-01.explainer.step.sets')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('DEX-01.explainer.how')));
    expect(await screen.findByTestId('DEX-01.rulesSheet.rule.delay')).toHaveTextContent(/3 Stunden/);
    expect(screen.getByTestId('DEX-01.rulesSheet.rule.samples')).toHaveTextContent(/Beispielautos zählen nie/);
    expect(screen.getByTestId('DEX-01.rulesSheet.rule.privacy')).toHaveTextContent(/nur die Stadt/);
  });

  it('hides for good on this device and leaves the compact link', async () => {
    stubDex();
    await renderScreen(<DexHomeScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('DEX-01.explainer.hide')));
    expect(screen.queryByTestId('DEX-01.explainer')).toBeNull();
    expect(screen.getByTestId('DEX-01.explainer.compact')).toBeTruthy();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(DEX_EXPLAINER_KEY)) ?? '{}')).toMatchObject({ dismissed: true }));
  });

  it('turns compact after the first visits by itself', async () => {
    await AsyncStorage.setItem(DEX_EXPLAINER_KEY, JSON.stringify({ visits: EXPANDED_VISITS, dismissed: false }));
    stubDex();
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByTestId('DEX-01.explainer.compact')).toBeTruthy();
    expect(screen.queryByTestId('DEX-01.explainer')).toBeNull();
  });

  it('explains the Dex to a guest too, inside the state: the steps, Anmelden under them, the rules link, the sample', async () => {
    signOut();
    stubFetch({});
    await renderScreen(<DexHomeScreen />);
    expect(await screen.findByTestId('DEX-01.guest')).toBeTruthy();
    expect(screen.getByTestId('DEX-01.guest.step.scan')).toBeTruthy();
    expect(screen.getByTestId('DEX-01.guest.action')).toHaveTextContent('Anmelden');
    expect(screen.queryByTestId('DEX-01.explainer')).toBeNull();
  });

  it('R4DQ-12: an empty Dex explains itself once, the steps above Sticker scannen, then the link and the sample', async () => {
    stubFetch({ '/me/dex': { body: dexPage([], { found: 0 }) }, '/me/dex/sets': { body: { data: [] } } });
    await renderScreen(<DexHomeScreen />);
    const empty = await screen.findByTestId('DEX-01.empty');
    // No explainer card and no second explanation line: the steps are the explanation.
    expect(screen.queryByTestId('DEX-01.explainer')).toBeNull();
    expect(screen.queryByTestId('DEX-01.explainer.compact')).toBeNull();
    expect(screen.queryByTestId('DEX-01.empty.note')).toBeNull();
    // The order inside the state: title, steps, the one action, the rules link, the sample.
    const order = ['DEX-01.empty.title', 'DEX-01.empty.steps', 'DEX-01.empty.action', 'DEX-01.empty.how', 'DEX-01.empty.preview'];
    const tree = JSON.stringify(screen.toJSON());
    const positions = order.map((id) => tree.indexOf(`"testID":"${id}"`));
    expect(positions.every((at) => at > 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(empty).toBeTruthy();
    expect(screen.getByTestId('DEX-01.empty.action')).toHaveTextContent('Sticker scannen');
    // R4DQ-46: the "???" slot is one labelled image, not a bare labelled box.
    expect(screen.getByTestId('DEX-01.empty.sample.open').props.role).toBe('img');
    // The rarity "?" has nothing to explain on an empty Dex; the scan action stays.
    expect(screen.queryByTestId('DEX-01.rarityHelp')).toBeNull();
    expect(screen.getByTestId('DEX-01.scan')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('DEX-01.empty.how')));
    expect(await screen.findByTestId('DEX-01.rulesSheet.rule.counts')).toBeTruthy();
  });

  it('draws the empty Dex under qaState=empty (no request, no endless skeleton)', async () => {
    const { calls } = stubFetch({});
    mockQa.state = 'empty';
    try {
      await renderScreen(<DexHomeScreen />);
      expect(await screen.findByTestId('DEX-01.empty')).toBeTruthy();
      expect(screen.queryByTestId('DEX-01.skeleton')).toBeNull();
      expect(calls.filter((call) => call.url.includes('/me/dex'))).toHaveLength(0);
    } finally {
      mockQa.state = 'default';
    }
  });
});
