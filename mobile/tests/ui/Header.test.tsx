import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, size } from '@/theme';
import { Button } from '@/ui/Button';
import { Header, HeaderLargeTitle } from '@/ui/Header';
import { useCollapsingHeader, type CollapsingHeader } from '@/ui/useCollapsingHeader';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 750, height: 1334, scale: 1, fontScale: 1 })),
}));
jest.mock('expo-haptics', () => ({}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 750, height: 1334, scale: 1, fontScale: 1 }));

function Collapsing({ children }: { children: (scroll: CollapsingHeader) => React.ReactNode }) {
  return <>{children(useCollapsingHeader())}</>;
}

describe('useCollapsingHeader', () => {
  it('starts at the top with the 52 collapse distance, and gives scroll props', async () => {
    const { result } = await renderHook(() => useCollapsingHeader());
    expect(result.current.scrollY.get()).toBe(0);
    expect(result.current.collapseAt.get()).toBe(size.headerLargeTitleBlock);
    expect(size.headerLargeTitleBlock).toBe(52);
    expect(result.current.scrollProps.onScroll).toBeDefined();
    expect(result.current.scrollProps.scrollEventThrottle).toBe(16);
  });
});

describe('Header', () => {
  it('compact: heading, back chevron with the common label, press', async () => {
    const onBack = jest.fn();
    await renderUi(<Header title="Einstellungen" onBack={onBack} testID="h" />);
    const title = screen.getByTestId('h.title');
    expect(title).toHaveTextContent('Einstellungen');
    expect(title.props.role).toBe('heading');
    const back = screen.getByTestId('h.back');
    expect(back.props.accessibilityLabel).toBe('Zurück');
    await fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('close icon uses the close label', async () => {
    await renderUi(<Header title="Fahrzeug hinzufügen" onBack={jest.fn()} backIcon="close" testID="h" />);
    expect(screen.getByTestId('h.back').props.accessibilityLabel).toBe('Schließen');
  });

  it('is at least 44 high', async () => {
    await renderUi(<Header title="Titel" testID="h" />);
    expect(size.header).toBe(44);
    expect(flat(screen.getByTestId('h').props.style).paddingTop).toBeDefined();
    expect(flat(screen.getByTestId('h.title').parent?.parent?.props.style).minHeight).toBe(44);
  });

  it('skips the status bar inset when the parent owns it', async () => {
    await renderUi(<Header title="Titel" safeTop={false} testID="h" />);
    expect(flat(screen.getByTestId('h').props.style).paddingTop).toBeUndefined();
  });

  it('actions are named 44 targets, with the unread state in the name', async () => {
    const onPress = jest.fn();
    await renderUi(
      <Header
        variant="large"
        title="Start"
        testID="h"
        actions={[
          { icon: 'bell', label: 'Benachrichtigungen', onPress, unread: { label: 'Neu' }, testID: 'h.bell' },
        ]}
      />,
    );
    const bell = screen.getByTestId('h.bell');
    expect(bell.props.accessibilityLabel).toBe('Benachrichtigungen, Neu');
    expect(flat(bell.props.style).width).toBe(size.iconButton);
    await fireEvent.press(bell);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(['large', 'compact'] as const)('%s: the hairline fades in over the first 8 of scroll, with content under the bar', async (variant) => {
    // In Jest the animated style only follows the scroll once its mapper is registered, and Reanimated registers it on a
    // frame of the worklets UI queue: requestAnimationFrame, which is a setTimeout(0) there. On real timers that frame
    // raced the reading (a loaded machine often had not run it yet, so the style still read 0). Fake timers hold every
    // frame until the test advances the clock.
    jest.useFakeTimers();
    try {
      let captured: CollapsingHeader | undefined;
      await renderUi(
        <Collapsing>
          {(scroll) => {
            captured = scroll;
            return <Header variant={variant} title="Garage" scroll={scroll} testID="h" />;
          }}
        </Collapsing>,
      );
      const hairline = () => screen.getByTestId('h.hairline', { includeHiddenElements: true });
      const frames = () =>
        act(async () => {
          jest.advanceTimersByTime(50);
        });
      await frames();
      expect(hairline()).toHaveAnimatedStyle({ opacity: 0 });
      await act(async () => captured?.scrollY.set(4));
      await frames();
      expect(hairline()).toHaveAnimatedStyle({ opacity: 0.5 });
      await act(async () => captured?.scrollY.set(8));
      await frames();
      expect(hairline()).toHaveAnimatedStyle({ opacity: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  // DQ-144: the controls keep to the content's column, the bar and its hairline to the pane.
  it('contentMaxWidth narrows back, title and trailing, never the bar or the hairline', async () => {
    await renderUi(
      <Collapsing>
        {(scroll) => (
          <Header title="Erscheinungsbild" onBack={jest.fn()} scroll={scroll} contentMaxWidth={704} testID="h" />
        )}
      </Collapsing>,
    );
    const column = screen.getByTestId('h.content');
    expect(flat(column.props.style)).toEqual(expect.objectContaining({ alignSelf: 'flex-start', maxWidth: 704, width: '100%' }));
    expect(screen.getByTestId('h.back')).toBeTruthy();
    expect(column).toContainElement(screen.getByTestId('h.back'));
    expect(column).toContainElement(screen.getByTestId('h.title'));
    const hairline = screen.getByTestId('h.hairline', { includeHiddenElements: true });
    expect(column).not.toContainElement(hairline);
    expect(flat(hairline.props.style)).toEqual(expect.objectContaining({ left: 0, position: 'absolute', right: 0 }));
    expect(flat(screen.getByTestId('h').props.style).maxWidth).toBeUndefined();
  });

  it('without contentMaxWidth the row needs no column', async () => {
    await renderUi(<Header title="Titel" onBack={jest.fn()} testID="h" />);
    expect(screen.queryByTestId('h.content')).toBeNull();
  });

  it('large: the bar title is hidden from screen readers, the block is the heading', async () => {
    await renderUi(
      <Collapsing>
        {(scroll) => (
          <>
            <Header variant="large" title="Garage" scroll={scroll} testID="h" />
            <HeaderLargeTitle title="Garage" scroll={scroll} testID="l" />
          </>
        )}
      </Collapsing>,
    );
    expect(screen.getByTestId('h.title', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    expect(flat(screen.getByTestId('l').props.style).minHeight).toBe(size.headerLargeTitleBlock);
  });

  it('large title reports its real height, so a wrapped title collapses correctly', async () => {
    let captured: CollapsingHeader | undefined;
    await renderUi(
      <Collapsing>
        {(scroll) => {
          captured = scroll;
          return <HeaderLargeTitle title="Garage" scroll={scroll} testID="l" />;
        }}
      </Collapsing>,
    );
    await fireEvent(screen.getByTestId('l'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 86 } } });
    expect(captured?.collapseAt.get()).toBe(86);
  });

  it('photo: overlays the hero and uses on-photo icon buttons', async () => {
    await renderUi(
      <Header
        variant="photo"
        onBack={jest.fn()}
        testID="h"
        actions={[{ icon: 'share-network', label: 'Teilen', onPress: jest.fn(), testID: 'h.share' }]}
      />,
    );
    expect(flat(screen.getByTestId('h').props.style).position).toBe('absolute');
    expect(screen.getByTestId('h.back').props.accessibilityLabel).toBe('Zurück');
    expect(screen.getByTestId('h.share').props.accessibilityLabel).toBe('Teilen');
  });

  it('shows the previous title only where there is room', async () => {
    await renderUi(<Header title="Technik" onBack={jest.fn()} backTitle="Skyline" testID="h" />);
    // Jest runs as iOS at 750 wide.
    expect(screen.getByText('Skyline')).toBeTruthy();
  });

  describe('from font scale 1.3', () => {
    beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1.3 }));

    it('gives the compact title its own line, whole, next to no control', async () => {
      await renderUi(
        <Header title="Nissan Skyline GT-R R34 V-Spec II Nür" onBack={jest.fn()} trailing={<Button label="Speichern" size="s" />} testID="h" />,
      );
      const title = screen.getByTestId('h.title');
      expect(title.props.numberOfLines).toBeUndefined();
      expect(title.props.role).toBe('heading');
      // A direct child of the bar: below the row with the controls, not an overlay between them.
      expect(title.parent?.parent?.props.testID ?? title.parent?.props.testID).toBe('h');
      expect(flat(title.props.style).position).toBeUndefined();
      expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy();
    });

    it('drops the previous title', async () => {
      dimensions.mockReturnValue({ width: 750, height: 1334, scale: 1, fontScale: 1.3 });
      await renderUi(<Header title="Technik" onBack={jest.fn()} backTitle="Skyline" testID="h" />);
      expect(screen.queryByText('Skyline')).toBeNull();
    });

    it('keeps the overlay title of a tab root', async () => {
      await renderUi(<Header variant="large" title="Garage" testID="h" />);
      expect(screen.getByTestId('h.title', { includeHiddenElements: true }).props.numberOfLines).toBe(1);
    });
  });
});
