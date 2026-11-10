import { fireEvent, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { thumbLayout } from '@/features/vehicle/components/DesktopThumbs';
import { KnownTextSkeleton, linesInHeight } from '@/features/vehicle/components/KnownTextSkeleton';
import { VehicleProfileSkeleton } from '@/features/vehicle/components/VehicleProfileSkeleton';
import { BLUEPRINT_SUBLINE, BLUEPRINT_SUBLINE_PARTS, BLUEPRINT_TITLE, blueprintLines, buttonChrome, buttonHeight, wrapWords } from '@/features/vehicle/skeletonGeometry';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
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
  it('breaks FS-3’s title and sub-line at their spaces, as the page does', () => {
    // 390 wide: a gutter of 20 on each side.
    expect(blueprintLines(BLUEPRINT_TITLE, 'displayL', 1, 350)).toHaveLength(1);
    expect(blueprintLines(BLUEPRINT_TITLE, 'displayL', 2, 350)).toHaveLength(2);
    expect(blueprintLines(BLUEPRINT_TITLE, 'displayL', 2, 632)).toHaveLength(1);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'supporting', 1, 350)).toHaveLength(1);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'supporting', 1, 320)).toHaveLength(2);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'supporting', 1.3, 390)).toHaveLength(2);
    // At twice the size the line breaks before "(RB26DETT)" and again before "Blue" below 359.
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'supporting', 2, 350)).toHaveLength(3);
    expect(blueprintLines(BLUEPRINT_SUBLINE, 'supporting', 2, 390)).toHaveLength(2);
  });

  it('breaks the sub-line between its parts up to the font scale where the page keeps them whole (DQ-167)', () => {
    expect(blueprintLines(BLUEPRINT_SUBLINE_PARTS, 'supporting', 1, 350)).toHaveLength(1);
    // At 360: "2002 · 2,6 l R6 Biturbo (RB26DETT) ·" and "Bayside Blue", no longer "Bayside" / "Blue".
    const lines = blueprintLines(BLUEPRINT_SUBLINE_PARTS, 'supporting', 1, 328);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBeCloseTo(6.081 * 14);
  });

  it('gives each line the width of its words and a word wider than the line a line of its own', () => {
    expect(wrapWords({ words: [2, 3], space: 0.5 }, 10, 100)).toEqual([55]);
    expect(wrapWords({ words: [2, 3], space: 0.5 }, 10, 50)).toEqual([20, 30]);
    expect(wrapWords({ words: [8], space: 0.5 }, 10, 50)).toEqual([80]);
  });

  it('grows the buttons with the font as their labels do', () => {
    expect(buttonHeight('m', 1)).toBe(44);
    expect(buttonHeight('m', 1.3)).toBe(44);
    expect(buttonHeight('m', 2)).toBe(58);
    expect(buttonHeight('s', 1)).toBe(36);
    expect(buttonHeight('s', 2)).toBe(50);
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

  it('draws Folgen and Nachricht for a guest and for a member on VEH-01, so the content does not move when the row arrives (M2.8)', async () => {
    const view = await renderWithProviders(<VehicleProfileSkeleton onBack={jest.fn()} />);
    expect(screen.getByTestId('VEH-01.skeleton')).toBeTruthy();
    expect(screen.getByTestId('VEH-01.skeleton.ownerActions').children).toHaveLength(3);
    expect(screen.queryByTestId('VEH-01.skeleton.ownerToolbar')).toBeNull();
    // A guest's row follows the guest rule; nothing measures the member's widest state.
    expect(screen.queryByText('Folge ich', { includeHiddenElements: true })).toBeNull();
    await view.unmount();

    useSessionStore.setState({ status: 'member' });
    await renderWithProviders(<VehicleProfileSkeleton onBack={jest.fn()} />);
    // Two button blocks and the invisible measure of their labels, as for the guest.
    expect(screen.getByTestId('VEH-01.skeleton.ownerActions').children).toHaveLength(3);
    expect(screen.queryByTestId('VEH-01.skeleton.ownerToolbar')).toBeNull();
  });

  it('stacks a member’s row as the page does, by the pair in its widest state "✓ Folge ich" (DQ-262)', async () => {
    dimensions.mockReturnValue({ ...DEFAULT_WINDOW, fontScale: 1 });
    useSessionStore.setState({ status: 'member' });
    await renderWithProviders(<VehicleProfileSkeleton onBack={jest.fn()} />);
    const ownerRow = () => flat(screen.getByTestId('VEH-01.skeleton.ownerRow').props.style);
    const widest = screen.getByText('Folge ich', { includeHiddenElements: true });
    const layoutOf = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 24 } } });
    const measure = (width: number) => fireEvent(widest, 'layout', layoutOf(width));
    // A wide content column: the pair fits beside the identity while its widest label is short.
    let frame = screen.getByTestId('VEH-01.scroll').parent;
    while (frame && typeof frame.props.onLayout !== 'function') frame = frame.parent;
    await fireEvent(frame as never, 'layout', layoutOf(1000));
    await measure(1);
    expect(ownerRow().flexDirection).toBe('row');
    // A label far wider than the row leaves no room beside the identity.
    await measure(2000);
    expect(ownerRow().flexDirection).not.toBe('row');
  });

  it('draws GAR-02’s toolbar instead of the owner actions', async () => {
    await renderWithProviders(
      <VehicleProfileSkeleton routeId="GAR-02" onBack={jest.fn()} toolbarLabels={['Bearbeiten', 'Mods', 'Fotos', 'QR-Code', 'Sichtbarkeit']} />,
    );
    expect(screen.getByTestId('GAR-02.skeleton.ownerToolbar')).toBeTruthy();
    expect(screen.queryByTestId('GAR-02.skeleton.ownerActions')).toBeNull();
  });
});

describe('skeleton text from what is already known', () => {
  const layout = (width: number, height: number = 20) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  const measureWord = async (word: string, width: number) =>
    fireEvent(screen.getByText(word, { includeHiddenElements: true }), 'layout', layout(width));

  it('sets a known vehicle’s title and sub-line at the lines they will take, not FS-3’s example (DQ-182)', async () => {
    await renderWithProviders(
      <VehicleProfileSkeleton routeId="GAR-02" onBack={jest.fn()} toolbarLabels={['Bearbeiten']} known={{ title: 'Silvia S15', subline_parts: ['2001', 'Bayside Blue'] }} />,
    );
    const lines = (testID: string) => screen.getByTestId(testID, { includeHiddenElements: true }).children;
    // A word wider than the line takes one of its own: FS-3's example would set this title on one line at this width.
    await measureWord('Silvia', 4000);
    await measureWord('S15', 20);
    // This environment runs above font scale 1.2, where the parts of the sub-line wrap at their own spaces.
    await measureWord('2001 ·', 20);
    await measureWord('Bayside', 30);
    await measureWord('Blue', 20);
    expect(lines('GAR-02.skeleton.title')).toHaveLength(2);
    expect(lines('GAR-02.skeleton.subline')).toHaveLength(1);
  });

  it('draws no sub-line for a known vehicle without one', async () => {
    await renderWithProviders(<VehicleProfileSkeleton routeId="GAR-02" onBack={jest.fn()} toolbarLabels={['Bearbeiten']} known={{ title: 'Silvia S15', subline_parts: [] }} />);
    expect(screen.queryByTestId('GAR-02.skeleton.subline', { includeHiddenElements: true })).toBeNull();
  });

  it('takes as many lines as the real text does (DQ-214)', async () => {
    expect(linesInHeight(0, 'supporting', 1)).toBe(1);
    expect(linesInHeight(20, 'supporting', 1)).toBe(1);
    expect(linesInHeight(60, 'supporting', 1)).toBe(3);
    expect(linesInHeight(80, 'supporting', 2)).toBe(2);
    expect(linesInHeight(40, 'tab', 2)).toBe(2);
    await renderWithProviders(
      <Skeleton>
        <KnownTextSkeleton text="Ein Text, der hier umbricht" variant="supporting" testID="line" />
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
