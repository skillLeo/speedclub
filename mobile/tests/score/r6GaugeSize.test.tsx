/**
 * Client round 6, item 3 (R6-3) made the Build Score gauge smaller (120 beside the stage, the desktop's in the side card); client
 * round 7, item 1 (R7-1: "move build score back to the place where it was before, and make it just a little bit bigger on mobile")
 * puts it back: the centred block under "Build Score" in Überblick on every width, the stage inside the gauge, the ranks under it,
 * at 144 (one step up from 120, still well under round 4's 208), with the number in hero.numeral.s. The skeleton keeps the geometry.
 * The web desktop's size is proven in r6GaugeSize.web.test.tsx.
 */
import { screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { BuildScoreSection, BuildScoreSectionSkeleton, gaugeBoxFor } from '@/features/score/components/BuildScoreSection';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { hydrateThemePreference, typography } from '@/theme';
import { gaugeLayout, gaugeNumeralVariant, gaugeTextScale } from '@/ui/BuildScoreGauge';
import { __resetOdometerSessionForTests } from '@/ui/motion/OdometerNumber';

import { flat, renderUi, textOf } from '../ui/helpers';
import { R34 } from '../vehicle/fixtures';
import { renderWithProviders, stubFetch } from '../vehicle/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({ slug: 'nissan-skyline-gt-r-r34-5tf974vj' }),
  usePathname: () => '/v/nissan-skyline-gt-r-r34-5tf974vj',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
// Rows render in place (as in onePage.test).
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  horizontal?: boolean;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({
      scrollToOffset: jest.fn(),
      scrollToIndex: jest.fn(() => Promise.resolve()),
      getLayout: (index: number) => ({ x: 0, y: index * 1000, width: 390, height: 1000 }),
      getFirstItemOffset: () => 0,
      getScrollableNode: () => null,
    }));
    const items = props.data.map((item, index) => createElement(Fragment, { key: props.keyExtractor ? props.keyExtractor(item) : index }, props.renderItem({ item, index })));
    return createElement(Fragment, null, props.ListHeaderComponent, props.data.length === 0 ? props.ListEmptyComponent : items, props.ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const SCORE = {
  total: 482,
  stage: 3,
  parts: { completeness: { points: 220, max: 300 }, documentation: { points: 100, max: 300 }, community: { points: 82, max: 250 }, journey: { points: 80, max: 150 } },
  ranks: [
    { scope: 'generation', label: 'R34', rank: 1, group_size: 3, region: 'Deutschland' },
    { scope: 'bundesland', label: 'Bayern', rank: 2, group_size: 5 },
  ],
  computed_at: '2026-11-14T08:30:00Z',
  previous_total: 457,
  formula_version: '1',
};
const dimensions = useWindowDimensions as jest.Mock;
const windowOf = (width: number, height: number, fontScale = 1) => dimensions.mockReturnValue({ width, height, scale: 2, fontScale });
type Node = ReturnType<typeof screen.getByTestId>;
/** The nearest ancestor laid out as a row within three levels, or null. */
function rowOf(node: Node): Node | null {
  let current: Node | null = node.parent;
  for (let level = 0; current && level < 3; level += 1, current = current.parent) {
    if (flat(current.props.style)?.flexDirection === 'row') return current;
  }
  return null;
}
const widthOf = (testID: string) => Number(flat(screen.getByTestId(testID, { includeHiddenElements: true }).props.style).width);
/** Whether `inner` lies inside `outer` in the rendered tree. */
function contains(outer: Node, inner: Node): boolean {
  for (let current: Node | null = inner; current; current = current.parent) if (current === outer) return true;
  return false;
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  __resetOdometerSessionForTests();
  windowOf(393, 852);
});

describe('R7-1 gauge size rules', () => {
  it('draws the page gauge at 144 on a phone and on the desktop (120 in round 6), growing with the font only to the numerals’ cap', () => {
    expect(gaugeBoxFor(353, 1)).toBe(144);
    expect(gaugeBoxFor(320, 1)).toBe(144);
    // One step bigger than round 6, still smaller than round 4's 208.
    expect(gaugeBoxFor(353, 1)).toBeGreaterThanOrEqual(136);
    expect(gaugeBoxFor(353, 1)).toBeLessThan(208);
    // 200 %: the numeral stops at 1.3×, and so does its box.
    expect(gaugeBoxFor(353, 2)).toBe(187);
    expect(gaugeBoxFor(100, 2)).toBe(100);
  });

  it('sets three digits in hero.numeral.s; a grouped "1.000" one step smaller, so it stays inside the needle’s inner circle', () => {
    expect(gaugeNumeralVariant('482')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('999')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('1.000')).toBe('heroNumeralXs');
  });

  it('lays the 144 gauge out with the stage inside it: numeral on the pivot, "von 1.000" and "Stufe 3" under it, inside the square', () => {
    const { height, numeralTop, numeralLine, belowTop } = gaugeLayout(144, { valueText: '482', scale: gaugeTextScale(1), desktop: false, stage: true });
    expect(numeralLine).toBe(typography.heroNumeralS.lineHeight);
    expect(numeralTop + numeralLine / 2).toBe(72);
    expect(belowTop).toBeGreaterThan(numeralTop + numeralLine);
    expect(height).toBeLessThanOrEqual(144);
  });
});

describe('R7-1 on a phone (VEH-01 / GAR-02)', () => {
  it('is 144, centred as its own block (not beside the stage), the stage inside the gauge, the ranks centred under it', async () => {
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="GAR-02" />);
    const gauge = await screen.findByTestId('GAR-02.score.gauge');
    expect(widthOf('GAR-02.score.gauge')).toBe(144);
    expect(flat(gauge.props.style).alignSelf).toBe('center');
    // Not inline: no row holds the gauge (round 6 set it beside "Stufe 3").
    expect(rowOf(gauge)).toBeNull();
    // The stage is part of the gauge's drawing again, under "von 1.000".
    expect(within(gauge).getByTestId('GAR-02.score.gauge.stage', { includeHiddenElements: true })).toHaveTextContent('Stufe 3');
    expect(within(gauge).getByText('von 1.000', { includeHiddenElements: true })).toBeTruthy();
    // The rise and the ranks follow under the gauge, centred.
    expect(contains(gauge, screen.getByTestId('GAR-02.score.gauge.delta', { includeHiddenElements: true }))).toBe(false);
    expect(screen.getByTestId('GAR-02.score.gauge.delta', { includeHiddenElements: true })).toHaveTextContent('+25');
    expect(textOf(screen.getByTestId('GAR-02.score.rank.generation').props.style).textAlign).toBe('center');
    const digit = flat(screen.getAllByText('4', { includeHiddenElements: true })[0]?.props.style);
    expect(digit.fontSize).toBe(typography.heroNumeralS.fontSize);
    expect(digit.fontSize).not.toBe(typography.heroNumeral.fontSize);
  });

  it('loads in the same geometry: the skeleton’s track has the ready gauge’s box and height, centred', async () => {
    await renderUi(<BuildScoreSectionSkeleton width={353} testID="sk" />);
    const trackNode = screen.getByTestId('sk.track', { includeHiddenElements: true });
    const track = flat(trackNode.props.style);
    expect(rowOf(trackNode)).toBeNull();
    await screen.unmount();
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" />);
    await screen.findByTestId('VEH-01.score.gauge');
    const ready = flat(screen.getByTestId('VEH-01.score.gauge').props.style);
    expect({ width: track.width, height: track.height }).toEqual({ width: ready.width, height: ready.height });
    expect(ready.width).toBe(144);
  });
});

describe('R7-1 on the desktop layout (VEH-01 ≥ 1280)', () => {
  it('puts the gauge back in Überblick’s content column, not in the right-hand side card', async () => {
    windowOf(1440, 900);
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('VEH-01.score.gauge')).toBeTruthy());
    expect(screen.getAllByTestId('VEH-01.score.gauge')).toHaveLength(1);
    expect(within(screen.getByTestId('VEH-01.card')).queryByTestId('VEH-01.score.gauge')).toBeNull();
    expect(widthOf('VEH-01.score.gauge')).toBeLessThanOrEqual(144);
  });
});
