/**
 * Client round 6, item 3 (R6-3): the Build Score gauge "clearly smaller and quieter". On a phone at most 120, inline next to the
 * stage label (not a hero block), with the number in hero.numeral.s; on the desktop layout inside the right-hand side card, not in
 * the content column; the loading skeleton in the same geometry. The web desktop's 144 is proven in r6GaugeSize.web.test.tsx.
 */
import { screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { BuildScoreSection, BuildScoreSectionSkeleton, gaugeBoxFor } from '@/features/score/components/BuildScoreSection';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { hydrateThemePreference, typography } from '@/theme';
import { gaugeLayout, gaugeNumeralVariant, gaugeTextScale } from '@/ui/BuildScoreGauge';
import { __resetOdometerSessionForTests } from '@/ui/motion/OdometerNumber';

import { flat, renderUi } from '../ui/helpers';
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
/** The nearest ancestor laid out as a row (the gauge's line), within three levels; fails when there is none. */
function rowOf(node: Node): Node {
  let current: Node | null = node.parent;
  for (let level = 0; current && level < 3; level += 1, current = current.parent) {
    if (flat(current.props.style)?.flexDirection === 'row') return current;
  }
  throw new Error('the gauge is not in a row');
}
const widthOf = (testID: string) => Number(flat(screen.getByTestId(testID, { includeHiddenElements: true }).props.style).width);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  __resetOdometerSessionForTests();
  windowOf(393, 852);
});

describe('R6-3 gauge size rules', () => {
  it('draws the page gauge at 120 on a phone, 144 (≈ 140) on the web desktop, growing with the font only to the numerals’ cap', () => {
    expect(gaugeBoxFor(353, 1)).toBe(120);
    expect(gaugeBoxFor(320, 1)).toBe(120);
    expect(gaugeBoxFor(320, 1, true)).toBe(144);
    // 200 %: the numeral stops at 1.3×, and so does its box.
    expect(gaugeBoxFor(353, 2)).toBe(156);
    expect(gaugeBoxFor(100, 2)).toBe(100);
  });

  it('sets three digits in hero.numeral.s; a grouped "1.000" one step smaller, so it stays inside the needle’s inner circle', () => {
    expect(gaugeNumeralVariant('482')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('999')).toBe('heroNumeralS');
    expect(gaugeNumeralVariant('1.000')).toBe('heroNumeralXs');
  });

  it('lays the 120 gauge out shorter than its square: the arc ends and "von 1.000" under the numeral', () => {
    const { height, numeralTop, numeralLine } = gaugeLayout(120, { valueText: '482', scale: gaugeTextScale(1), desktop: false, stage: false });
    expect(numeralLine).toBe(typography.heroNumeralS.lineHeight);
    expect(numeralTop + numeralLine / 2).toBe(60);
    expect(height).toBeLessThan(120);
  });
});

describe('R6-3 on a phone (VEH-01 / GAR-02)', () => {
  it('is at most 120, inline next to the stage label, with the number in hero.numeral.s', async () => {
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="GAR-02" />);
    await screen.findByTestId('GAR-02.score.gauge');
    expect(widthOf('GAR-02.score.gauge')).toBeLessThanOrEqual(120);
    // Inline: the gauge and the stage (with its rise) share one row.
    const row = rowOf(screen.getByTestId('GAR-02.score.gauge'));
    expect(within(row).getByTestId('GAR-02.score.gauge.stage', { includeHiddenElements: true })).toHaveTextContent('Stufe 3');
    expect(within(row).getByTestId('GAR-02.score.gauge.delta', { includeHiddenElements: true })).toHaveTextContent('+25');
    const digit = flat(screen.getAllByText('4', { includeHiddenElements: true })[0]?.props.style);
    expect(digit.fontSize).toBe(typography.heroNumeralS.fontSize);
    expect(digit.fontSize).not.toBe(typography.heroNumeral.fontSize);
  });

  it('loads in the same geometry: the skeleton’s track has the ready gauge’s box and height, beside the stage line', async () => {
    await renderUi(<BuildScoreSectionSkeleton width={353} testID="sk" />);
    const track = flat(screen.getByTestId('sk.track', { includeHiddenElements: true }).props.style);
    // Beside the stage line, as the ready state.
    expect(rowOf(screen.getByTestId('sk.track', { includeHiddenElements: true }))).toBeTruthy();
    await screen.unmount();
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<BuildScoreSection vehicle={R34} routeId="VEH-01" />);
    await screen.findByTestId('VEH-01.score.gauge');
    const ready = flat(screen.getByTestId('VEH-01.score.gauge').props.style);
    expect({ width: track.width, height: track.height }).toEqual({ width: ready.width, height: ready.height });
    expect(ready.width).toBe(120);
  });
});

describe('R6-3 on the desktop layout (VEH-01 ≥ 1280)', () => {
  it('puts the gauge inside the right-hand side card, not in Überblick’s content column', async () => {
    windowOf(1440, 900);
    stubFetch({ [`/vehicles/${R34.id}/build-score`]: { body: { data: SCORE } } });
    await renderWithProviders(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await waitFor(() => expect(within(screen.getByTestId('VEH-01.card')).getByTestId('VEH-01.score.gauge')).toBeTruthy());
    expect(screen.getAllByTestId('VEH-01.score.gauge')).toHaveLength(1);
    expect(widthOf('VEH-01.score.gauge')).toBeLessThanOrEqual(144);
  });
});
