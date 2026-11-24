/**
 * Client round 7, item 3 (R7-3): 'on user profile with "Dein Level" pop-up, there is text written on top of each other'. Reproduced on
 * the member web (WebKit 390 and 360, Chromium 390, desktop 1440; many more at 200 %): in "Abzeichen, die du dir holen kannst" a
 * badge's description and the next badge's name were drawn over each other. Cause: each badge's text box reused the rule row's
 * `ruleText` (flexBasis 0, flexGrow 1, made to share a row with the points) inside a column, where the basis is the height: the box
 * collapsed to 0 and its lines overflowed onto the next badge. Rule: no text container in the sheet gets its height from a zero basis
 * in a column, a fixed height or absolute positioning (the ring's numeral, inside its fixed ring, is the one drawn exception).
 */
import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { LevelSheet } from '@/features/gift/components/LevelSheet';
import { hydrateThemePreference } from '@/theme';

import { flat } from '../ui/helpers';
import { BADGES, renderScreen, signIn, stubApi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
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
  level: 5,
  title: 'Build-Handwerker',
  xp: 1350,
  next_level_xp: 1500,
  progress: 0.9,
  today: { earned: 0, cap: 200 },
  ladder: [
    { level: 4, title: 'Teilejäger', from_xp: 500 },
    { level: 5, title: 'Build-Handwerker', from_xp: 900 },
    { level: 6, title: 'Bekanntes Gesicht', from_xp: 1500 },
  ],
  rules: [{ type: 'documented_mod', points: 20, daily_max: null }],
};

const ID = 'PROF-01.levelSheet';
type Node = ReturnType<typeof screen.getByTestId>;

/** Whether a host element draws text somewhere below it. */
function holdsText(node: Node): boolean {
  return node.children.some((child) => typeof child === 'string' || holdsText(child as Node));
}

/** Every element below `root` that holds text and takes its height from a zero flex basis in a column, a fixed height, or is absolute. */
function collapsingTextBoxes(root: Node, parentRow = false, inRing = false): string[] {
  const found: string[] = [];
  const style = flat(root.props.style) ?? {};
  const ring = inRing || String(root.props.testID ?? '').endsWith('.ring');
  if (holdsText(root) && !ring) {
    const name = String(root.props.testID ?? root.type);
    if (!parentRow && style.flexBasis === 0) found.push(`${name}: flexBasis 0 in a column`);
    if (typeof style.height === 'number') found.push(`${name}: height ${style.height}`);
    if (style.position === 'absolute') found.push(`${name}: absolute`);
  }
  const row = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
  for (const child of root.children) if (typeof child !== 'string') found.push(...collapsingTextBoxes(child as Node, row, ring));
  return found;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  signIn();
  stubApi({ 'GET /me/level': { body: { data: LEVEL } }, 'GET /me/badges': { body: { data: BADGES } } });
});

describe('R7-3 "Dein Level" sheet: no text over text', () => {
  it.each([
    [390, 1],
    [360, 1],
    [390, 2],
  ])('at %i dp and font scale %f every badge to earn is laid out in its own lines', async (width, fontScale) => {
    dimensions.mockReturnValue({ width, height: 844, scale: 1, fontScale });
    await renderScreen(<LevelSheet visible onClose={jest.fn()} testID={ID} />);
    const badges = await screen.findByTestId(`${ID}.badges`);
    const items = BADGES.filter((badge) => badge.earned_at === null).slice(0, 3);
    expect(items.length).toBeGreaterThan(1);
    for (const badge of items) {
      const box = flat(screen.getByTestId(`${ID}.badge.${badge.key}`).props.style);
      // The collapse: a zero basis in the list's column made the box 0 high.
      expect(box.flexBasis).toBeUndefined();
      expect(box.height).toBeUndefined();
    }
    expect(collapsingTextBoxes(badges)).toEqual([]);
    expect(collapsingTextBoxes(screen.getByTestId(`${ID}.hero`))).toEqual([]);
    expect(collapsingTextBoxes(screen.getByTestId(`${ID}.ladder`))).toEqual([]);
    expect(collapsingTextBoxes(screen.getByTestId(`${ID}.rules`))).toEqual([]);
  });
});
