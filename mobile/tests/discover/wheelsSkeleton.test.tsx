// DISC-04 Räder-Vergleich while loading (M2.8 round 2): the skeleton takes the same table-or-cards decision as the loaded set-ups
// (DQ-436), so its geometry matches what follows.
import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ModelScreen } from '@/features/discover/screens/ModelScreen';
import { hydrateThemePreference } from '@/theme';

import { renderWithProviders, stubFetch } from '../home/harness';

const mockWindow = { current: { width: 390, height: 844, scale: 1, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  router: { dismissAll: jest.fn() },
  useLocalSearchParams: () => ({ model: 'nissan--skyline-gt-r', segment: 'wheels' }),
  usePathname: () => '/discover/model/nissan--skyline-gt-r',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => 'loading' }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

beforeAll(hydrateThemePreference);
beforeEach(() => stubFetch({}));

const cards = () => screen.queryAllByTestId('DISC-04.skeleton.card', { includeHiddenElements: true }).length;
const table = () => screen.queryAllByTestId('DISC-04.skeleton.table', { includeHiddenElements: true }).length;

describe('DISC-04 wheels skeleton (DQ-436 decision)', () => {
  it.each([
    ['a phone: single cards', { width: 390, fontScale: 1 }, { cards: 2, table: 0 }],
    ['768: paired cards', { width: 768, fontScale: 1 }, { cards: 4, table: 0 }],
    ['1024: paired cards', { width: 1024, fontScale: 1 }, { cards: 4, table: 0 }],
    ['1280 at 2×: cards, as the table no longer fits', { width: 1280, fontScale: 2 }, { cards: 4, table: 0 }],
    ['1280: the table block', { width: 1280, fontScale: 1 }, { cards: 0, table: 1 }],
    ['1440: the table block', { width: 1440, fontScale: 1 }, { cards: 0, table: 1 }],
  ])('%s', async (_name, window, expected) => {
    mockWindow.current = { height: 900, scale: 1, ...window };
    await renderWithProviders(<ModelScreen />);
    expect(cards()).toBe(expected.cards);
    expect(table()).toBe(expected.table);
  });
});

describe('DISC-04 skeleton gap (DQ-451)', () => {
  it('starts where the first card will: no state padding above the skeleton', async () => {
    mockWindow.current = { width: 390, height: 844, scale: 1, fontScale: 1 };
    await renderWithProviders(<ModelScreen />);
    const skeleton = screen.getByTestId('DISC-04.skeleton', { includeHiddenElements: true });
    const panel = skeleton.parent?.parent ?? skeleton.parent;
    const styleOf = (node: typeof skeleton | null | undefined) => StyleSheet.flatten((node?.props as { style?: object } | undefined)?.style) ?? {};
    const paddings = [skeleton.parent, panel].map((node) => (styleOf(node) as { paddingTop?: number }).paddingTop ?? 0);
    expect(paddings.every((value) => value === 0)).toBe(true);
  });
});
