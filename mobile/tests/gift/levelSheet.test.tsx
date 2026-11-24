/**
 * DQ-P5-202 (Phase 5 gate, PROF-01-level): a rule row of the level sheet keeps the wide column at every size. The trailing column
 * shows only the points ("+2 XP"); a daily cap is a caption line under the rule text. At large text the points go under the rule.
 */
import { screen, within } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { LevelSheet } from '@/features/gift/components/LevelSheet';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, signIn, stubApi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 1, fontScale: 1 })),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({}), usePathname: () => '/profile' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const dimensions = useWindowDimensions as jest.Mock;

const LEVEL = {
  level: 4,
  title: 'Parts Hunter',
  xp: 1240,
  next_level_xp: 1600,
  progress: 0.6,
  today: { earned: 40, cap: 200 },
  rules: [
    { type: 'documented_mod', points: 20, daily_max: null },
    { type: 'helpful_received', points: 2, daily_max: 20 },
  ],
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  dimensions.mockReturnValue({ width: 393, height: 852, scale: 1, fontScale: 1 });
  signIn();
  stubApi({ 'GET /me/level': { body: { data: LEVEL } } });
});

const ID = 'PROF-01.levelSheet';

describe('level sheet rules (DQ-P5-202)', () => {
  it('at 100 %: the points stand alone in the trailing column, the cap is a caption under the rule', async () => {
    await renderScreen(<LevelSheet visible onClose={jest.fn()} testID={ID} />);
    const row = await screen.findByTestId(`${ID}.rule.helpful_received`);
    expect(row).toHaveStyle({ flexDirection: 'row' });
    expect(within(row).getByTestId(`${ID}.rule.helpful_received.points`)).toHaveTextContent('+2 XP', { exact: true });
    expect(within(row).getByTestId(`${ID}.rule.helpful_received.cap`)).toHaveTextContent('höchstens 20 XP am Tag', { exact: true });
    // The cap belongs to the rule text, never to the narrow value column.
    expect(row).toHaveTextContent('Jemand findet deine Antwort im Forum hilfreichhöchstens 20 XP am Tag+2 XP');
  });

  it('a rule without a cap draws no caption', async () => {
    await renderScreen(<LevelSheet visible onClose={jest.fn()} testID={ID} />);
    const row = await screen.findByTestId(`${ID}.rule.documented_mod`);
    expect(within(row).queryByTestId(`${ID}.rule.documented_mod.cap`)).toBeNull();
    expect(row).toHaveTextContent('Einen Mod mit Marke, Foto und Datum dokumentieren+20 XP');
  });

  it('at 200 %: the row stacks, so the rule keeps the full width and the points go under it', async () => {
    dimensions.mockReturnValue({ width: 393, height: 852, scale: 1, fontScale: 2 });
    await renderScreen(<LevelSheet visible onClose={jest.fn()} testID={ID} />);
    const row = await screen.findByTestId(`${ID}.rule.helpful_received`);
    expect(row).toHaveStyle({ flexDirection: 'column' });
    expect(within(row).getByTestId(`${ID}.rule.helpful_received.points`)).toHaveStyle({ textAlign: 'left' });
    expect(within(row).getByTestId(`${ID}.rule.helpful_received.cap`)).toBeTruthy();
  });
});
