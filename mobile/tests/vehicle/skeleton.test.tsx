import { fireEvent, screen, within } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { thumbLayout } from '@/features/vehicle/components/DesktopThumbs';
import { KnownTextSkeleton, linesInHeight } from '@/features/vehicle/components/KnownTextSkeleton';
import { VehicleProfileSkeleton } from '@/features/vehicle/components/VehicleProfileSkeleton';
import {
  BLUEPRINT_SPEC_STRIP,
  BLUEPRINT_SUBLINE,
  BLUEPRINT_SUBLINE_PARTS,
  BLUEPRINT_TITLE,
  blueprintLines,
  blueprintStripHeight,
  buttonChrome,
  buttonHeight,
  displayTitleLines,
  knownTitleLines,
  wrapWords,
} from '@/features/vehicle/skeletonGeometry';
import { profileSummaryWidth, summaryTitlePlacement } from '@/features/vehicle/layout';
import { useSessionStore } from '@/state/session';
import { breakpointFor, hydrateThemePreference, layout as layoutTokens, typeScale, typography, typographyDesktop } from '@/theme';
import { estimatedSpecStripColumns, specStripHeight } from '@/ui/specStripLayout';
import { Skeleton } from '@/ui';

import { flat } from '../ui/helpers';
import { renderWithProviders } from './harness';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) }),
  useLocalSearchParams: () => ({}),
  usePathname: () => '/v/test',
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), getParent: () => undefined, isFocused: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
// React Native's Jest default (750 × 1334 at font scale 2), which one test sets to font scale 1.
const DEFAULT_WINDOW = { width: 750, height: 1334, scale: 2, fontScale: 2 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: jest.fn() }));
const dimensions = useWindowDimensions as jest.Mock;
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  dimensions.mockReturnValue(DEFAULT_WINDOW);
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('the loading geometry of VEH-01 and GAR-02 (DQ-178)', () => {
  it('sizes the strip with SpecStrip’s own fit rule on FS-3’s values (DQ-801)', () => {
    // A phone's quarter cannot hold DREHMOMENT with 12 on each side: the 2×2 grid, as the page shows it, its first row (power
    // and torque) with the provenance line.
    expect(estimatedSpecStripColumns(BLUEPRINT_SPEC_STRIP, 350, 1, false, 1)).toBe(2);
    expect(blueprintStripHeight(350, 1, false, 1)).toBe(specStripHeight(2, 1, false, 1, [true, false]));
    expect(blueprintStripHeight(600, 1, false, 1)).toBe(specStripHeight(1, 1, false, 1, [true]));
    // 200 % on a phone: one column, two rows of four with a provenance.
    expect(blueprintStripHeight(320, 2, false, 1)).toBe(specStripHeight(4, 2, false, 1, [true, true, false, false]));
  });

  it('shrinks the title to 24 above two lines, as DisplayTitle does (DQ-802)', () => {
    expect(displayTitleLines(BLUEPRINT_TITLE, 2, 350)).toMatchObject({ shrunk: false });
    const long = { words: [3.73, 2.66, 2.115, 3.1, 2.4], space: BLUEPRINT_TITLE.space };
    const result = displayTitleLines(long, 2, 350);
    expect(result.shrunk).toBe(true);
    expect(result.lines).toEqual(wrapWords(long, typeScale.displayTitle.minSize * 2, 350));
  });

  it('decides the desktop title at the desktop size, 44, and shrinks it to 24 like the page (NH-3)', () => {
    // FS-3's title in a 340 column: one line at 30, two at 44, and the skeleton draws the two.
    expect(displayTitleLines(BLUEPRINT_TITLE, 1, 340, false).lines).toHaveLength(1);
    expect(displayTitleLines(BLUEPRINT_TITLE, 1, 340, true)).toEqual({ lines: wrapWords(BLUEPRINT_TITLE, typographyDesktop.displayTitle.fontSize, 340), shrunk: false });
    expect(displayTitleLines(BLUEPRINT_TITLE, 1, 340, true).lines).toHaveLength(2);
    // A longer name: two lines at 30, but three at 44, so the desktop page shrinks it to 24 where the phone rule would not.
    const long = { words: [3.73, 2.66, 2.115, 3.1, 2.4], space: BLUEPRINT_TITLE.space };
    expect(displayTitleLines(long, 1, 340, false).shrunk).toBe(false);
    const desktop = displayTitleLines(long, 1, 340, true);
    expect(desktop.shrunk).toBe(true);
    expect(desktop.lines).toEqual(wrapWords(long, typeScale.displayTitle.minSize, 340));
  });

  it('sets a card title, 30/34 at every width, by the card rule (ADR-426 b); the desktop page title now sits on the hero (DQ-1048)', () => {
    // FS-3's title in a 1280 side card (≈ 355): one line at 30, where the page's 44 takes two.
    const card = profileSummaryWidth('desktop', 1280 - layoutTokens.sidebar, 24);
    expect(summaryTitlePlacement('desktop')).toBe('page');
    expect(displayTitleLines(BLUEPRINT_TITLE, 1, card, true, 'card')).toEqual({ lines: wrapWords(BLUEPRINT_TITLE, typography.displayTitle.fontSize, card), shrunk: false });
    expect(displayTitleLines(BLUEPRINT_TITLE, 1, card, true, 'card').lines).toHaveLength(1);
    expect(displayTitleLines(BLUEPRINT_TITLE, 1, card, true, 'page').lines).toHaveLength(2);
    // A card title with two lines at 30 shrinks only when 24 brings it to one line; three lines at 30 always shrink.
    const two = { words: [3.73, 2.66, 2.115, 3.1], space: BLUEPRINT_TITLE.space };
    expect(wrapWords(two, 30, 360)).toHaveLength(2);
    expect(displayTitleLines(two, 1, 360, false, 'card')).toEqual({ lines: wrapWords(two, typeScale.displayTitle.minSize, 360), shrunk: true });
    expect(displayTitleLines(two, 1, 280, false, 'card')).toMatchObject({ shrunk: false });
    expect(displayTitleLines(two, 1, 280, false, 'page')).toMatchObject({ shrunk: false });
  });

  it('breaks FS-3’s title and sub-line at their spaces, as the page does', () => {
    // 390 wide: a gutter of 20 on each side.
    expect(blueprintLines(BLUEPRINT_TITLE, 'displayTitle', 1, 350)).toHaveLength(1);
    expect(blueprintLines(BLUEPRINT_TITLE, 'displayTitle', 2, 350)).toHaveLength(2);
    expect(blueprintLines(BLUEPRINT_TITLE, 'displayTitle', 2, 632)).toHaveLength(1);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'callout', 1, 350)).toHaveLength(1);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'callout', 1, 320)).toHaveLength(2);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'callout', 1.3, 390)).toHaveLength(2);
    // At twice the size the line breaks before "(RB26DETT)" and again before "Blue" below 359.
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'callout', 2, 350)).toHaveLength(3);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'callout', 2, 390)).toHaveLength(2);
  });

  it('breaks the sub-line between its parts up to the font scale where the page keeps them whole (DQ-167)', () => {
    expect(blueprintLines(BLUEPRINT_SUBLINE_PARTS, 'callout', 1, 350)).toHaveLength(1);
    // At 360: "2002 · 2,6 l R6 Biturbo (RB26DETT) ·" and "Bayside Blue", no longer "Bayside" / "Blue".
    const lines = blueprintLines(BLUEPRINT_SUBLINE_PARTS, 'callout', 1, 328);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBeCloseTo(BLUEPRINT_SUBLINE_PARTS.words[2]! * typography.callout.fontSize);
  });

  it('gives each line the width of its words and a word wider than the line a line of its own', () => {
    expect(wrapWords({ words: [2, 3], space: 0.5 }, 10, 100)).toEqual([55]);
    expect(wrapWords({ words: [2, 3], space: 0.5 }, 10, 50)).toEqual([20, 30]);
    expect(wrapWords({ words: [8], space: 0.5 }, 10, 50)).toEqual([80]);
  });

  it('grows the buttons with the font as their labels do', () => {
    // Every size sets its label in body.strong (15/22, 09 §5): M is 22 + 2 × 8 + 2 × 1 once that passes 44, S 22 + 2 × 4 + 2.
    expect(buttonHeight('m', 1)).toBe(44);
    expect(buttonHeight('m', 1.3)).toBeCloseTo(46.6);
    expect(buttonHeight('m', 2)).toBe(62);
    // 09 §5: Button S is 32 (hit area 44).
    expect(buttonHeight('s', 1)).toBe(32);
    expect(buttonHeight('s', 2)).toBe(54);
    // The padding token holds the border (DQ-065), so these equal the real button beside its label: 12 + 16 + 8 + 12, 16 + 16.
    expect(buttonChrome('s', true)).toBe(48);
    expect(buttonChrome('m', false)).toBe(32);
  });

  it('lays out the desktop thumbnails as the gallery does', () => {
    expect(thumbLayout(1)).toEqual({ thumbs: 0, columns: 2 });
    expect(thumbLayout(3)).toEqual({ thumbs: 2, columns: 2 });
    expect(thumbLayout(4)).toEqual({ thumbs: 3, columns: 3 });
    expect(thumbLayout(12)).toEqual({ thumbs: 4, columns: 4 });
  });

  it('draws the action row under the identity for a guest and for a member on VEH-01 (M4.9, 09 §7.6 (4))', async () => {
    const view = await renderWithProviders(<VehicleProfileSkeleton onBack={jest.fn()} />);
    expect(screen.getByTestId('VEH-01.skeleton')).toBeTruthy();
    // Folgen across, then Speichern · Teilen · Nachricht: two rows, as VehicleActions.
    expect(screen.getByTestId('VEH-01.skeleton.actions').children).toHaveLength(2);
    expect(screen.queryByTestId('VEH-01.skeleton.ownerActions')).toBeNull();
    // DQ-1047: the owner chip (avatar 32 + handle) sits in the identity on the hero's stage, a row of its own.
    expect(within(screen.getByTestId('VEH-01.skeleton.stage')).getByTestId('VEH-01.skeleton.ownerRow')).toBeTruthy();
    expect(flat(screen.getByTestId('VEH-01.skeleton.ownerRow').props.style).flexDirection).toBe('row');
    await view.unmount();

    useSessionStore.setState({ status: 'member' });
    await renderWithProviders(<VehicleProfileSkeleton onBack={jest.fn()} />);
    expect(screen.getByTestId('VEH-01.skeleton.actions').children).toHaveLength(2);
  });

  it('draws no visitor action row for the owner, whose capsule floats (DQ-1049, DQ-1062)', async () => {
    await renderWithProviders(<VehicleProfileSkeleton routeId="GAR-02" onBack={jest.fn()} owner />);
    expect(screen.getByTestId('GAR-02.skeleton.specStrip')).toBeTruthy();
    expect(screen.queryByTestId('GAR-02.skeleton.actions')).toBeNull();
  });
});

describe('skeleton text from what is already known', () => {
  const layout = (width: number, height: number = 20) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  const measureWord = async (word: string, width: number) =>
    fireEvent(screen.getByText(word, { includeHiddenElements: true }), 'layout', layout(width));

  it('sets a known vehicle’s title and sub-line at the lines they will take, not FS-3’s example (DQ-182)', async () => {
    const title = 'Mercedes-Benz E 63 S AMG 4MATIC+ T-Modell Final Edition';
    await renderWithProviders(
      <VehicleProfileSkeleton routeId="GAR-02" onBack={jest.fn()} owner known={{ title, subline_parts: ['2001', 'Bayside Blue'] }} />,
    );
    const lines = (testID: string) => screen.getByTestId(testID, { includeHiddenElements: true }).children;
    // This environment runs above font scale 1.2, where the parts of the sub-line wrap at their own spaces.
    await measureWord('2001 ·', 20);
    await measureWord('Bayside', 30);
    await measureWord('Blue', 20);
    // NH-R3-1: the known title by DisplayTitle's own estimate (its size, its conditional code binding, its line count), so the
    // skeleton and the loaded title agree; FS-3's example would take fewer lines here.
    const { width, fontScale } = DEFAULT_WINDOW;
    const known = knownTitleLines(title, fontScale, profileSummaryWidth('phone', width, breakpointFor(width).gutter), false, 'page');
    const example = displayTitleLines(BLUEPRINT_TITLE, fontScale, profileSummaryWidth('phone', width, breakpointFor(width).gutter));
    expect(known?.lines.length).toBeGreaterThan(example.lines.length);
    expect(lines('GAR-02.skeleton.title')).toHaveLength(known?.lines.length ?? 0);
    expect(lines('GAR-02.skeleton.subline')).toHaveLength(1);
  });

  it('NH-R3-1: binds a known title’s trailing code only as DisplayTitle does', () => {
    // "Volkswagen Golf GTI VIII (CD)" in a 353 phone line: "(CD)" stays with "VIII", two lines at 30, as the loaded title.
    expect(knownTitleLines('Volkswagen Golf GTI VIII (CD)', 1, 353)).toMatchObject({ shrunk: false });
    expect(knownTitleLines('Volkswagen Golf GTI VIII (CD)', 1, 353)?.lines).toHaveLength(2);
    // "Porsche 911" has no breakable space before the pair: never bound, so at 200 % it wraps at its space.
    expect(knownTitleLines('Porsche 911', 2, 353)?.lines).toHaveLength(2);
  });

  it('draws no sub-line for a known vehicle without one', async () => {
    await renderWithProviders(<VehicleProfileSkeleton routeId="GAR-02" onBack={jest.fn()} owner known={{ title: 'Silvia S15', subline_parts: [] }} />);
    expect(screen.queryByTestId('GAR-02.skeleton.subline', { includeHiddenElements: true })).toBeNull();
  });

  it('takes as many lines as the real text does (DQ-214)', async () => {
    expect(linesInHeight(0, 'callout', 1)).toBe(1);
    expect(linesInHeight(20, 'callout', 1)).toBe(1);
    expect(linesInHeight(60, 'callout', 1)).toBe(3);
    expect(linesInHeight(80, 'callout', 2)).toBe(2);
    expect(linesInHeight(40, 'webTab', 2)).toBe(2);
    // On the web desktop body is 24 a line: six lines are 144, which 22 a line would read as seven.
    expect(linesInHeight(6 * typographyDesktop.body.lineHeight, 'body', 1, true)).toBe(6);
    expect(linesInHeight(6 * typographyDesktop.body.lineHeight, 'body', 1)).toBe(7);
    await renderWithProviders(
      <Skeleton>
        <KnownTextSkeleton text="Ein Text, der hier umbricht" variant="callout" testID="line" />
      </Skeleton>,
    );
    const line = () => screen.getByTestId('line', { includeHiddenElements: true });
    // The line's own height, with the font scale this test environment runs at.
    const [first] = line().children;
    const lineHeight = flat(first && typeof first !== 'string' ? first.props.style : undefined).height as number;
    expect(line().children).toHaveLength(1);
    await fireEvent(screen.getByText('Ein Text, der hier umbricht', { includeHiddenElements: true }), 'layout', layout(300, 3 * lineHeight));
    expect(line().children).toHaveLength(3);
  });
});
