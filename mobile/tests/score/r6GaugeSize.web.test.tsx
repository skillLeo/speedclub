/**
 * Client round 6, item 3 (R6-3): on the web desktop the Build Score gauge is about 140 (144: 120 × 48/40) inside the right-hand side
 * card, not across the content column, and its number is set in hero.numeral.s at its desktop size (48).
 */
import { screen } from '@testing-library/react-native';
import { Platform, useWindowDimensions } from 'react-native';

import { BuildScoreSection } from '@/features/score/components/BuildScoreSection';
import { profileSummaryWidth } from '@/features/vehicle/layout';
import { hydrateThemePreference, layout, typographyDesktop } from '@/theme';
import { __resetOdometerSessionForTests } from '@/ui/motion/OdometerNumber';

import { flat } from '../ui/helpers';
import { R34 } from '../vehicle/fixtures';
import { renderWithProviders, stubFetch } from '../vehicle/harness';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 1440, height: 900, scale: 1, fontScale: 1 })),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/v/test' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// The browser's online events need a window with listeners, which this environment lacks: online.
jest.mock('@/state/online', () => ({ ...jest.requireActual('@/state/online'), useOnline: () => true }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

/** A browser window of 1440 answers the desktop media query (Text's desktop sizes). */
const WINDOW = 1440;
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    matches: WINDOW >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});

const SCORE = {
  total: 482,
  stage: 3,
  parts: { completeness: { points: 220, max: 300 }, documentation: { points: 100, max: 300 }, community: { points: 82, max: 250 }, journey: { points: 80, max: 150 } },
  ranks: [{ scope: 'generation', label: 'G82', rank: 1, group_size: 3, region: 'Deutschland' }],
  computed_at: '2026-11-14T08:30:00Z',
  previous_total: null,
  formula_version: '1',
};

const originalOS = Platform.OS;
beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
  __resetOdometerSessionForTests();
  (useWindowDimensions as jest.Mock).mockReturnValue({ width: WINDOW, height: 900, scale: 1, fontScale: 1 });
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe('R6-3 Build Score gauge on the web desktop', () => {
  it('is about 140 inside the side card (its inner width), not the card or the content column wide', async () => {
    // The content column beside the 240 sidebar, and the side card's inner width in it (as VehicleProfile passes it).
    const card = profileSummaryWidth('desktop', WINDOW - layout.sidebar, layout.gutter.desktop);
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" part="score" layoutWidth={card} />);
    const gauge = flat((await screen.findByTestId('VEH-01.score.gauge')).props.style);
    expect(gauge.width).toBe(144);
    expect(Math.abs(Number(gauge.width) - 140)).toBeLessThanOrEqual(5);
    expect(Number(gauge.width)).toBeLessThan(card / 2);
    // The stage sits beside it in the card, and the card part leaves "Nächstes Upgrade" to Überblick.
    expect(screen.getByTestId('VEH-01.score.gauge.stage', { includeHiddenElements: true })).toHaveTextContent('Stufe 3');
    expect(screen.queryByTestId('VEH-01.score.next')).toBeNull();
  });

  it('sets the number in hero.numeral.s at its desktop size (48), not hero.numeral (88)', async () => {
    const card = profileSummaryWidth('desktop', WINDOW - layout.sidebar, layout.gutter.desktop);
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" part="score" layoutWidth={card} />);
    await screen.findByTestId('VEH-01.score.gauge');
    const digit = flat(screen.getAllByText('4', { includeHiddenElements: true })[0]?.props.style);
    expect(digit.fontSize).toBe(typographyDesktop.heroNumeralS.fontSize);
    expect(digit.fontSize).not.toBe(typographyDesktop.heroNumeral.fontSize);
  });
});
