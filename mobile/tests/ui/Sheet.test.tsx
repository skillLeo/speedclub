import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Dimensions, Text as RNText } from 'react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { hydrateThemePreference, radius, size } from '@/theme';
import { Sheet, type SheetProps } from '@/ui/Sheet';
import { contentOffset, footerTranslate, moveFocusIntoSheet, panelTranslate, settleTarget } from '@/ui/sheetMath';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-keyboard-controller', () => jest.requireActual('react-native-keyboard-controller/jest'));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeAll(hydrateThemePreference);
beforeEach(() => jest.clearAllMocks());

const SETTLE_MS = 1000;
const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });

describe('sheet maths', () => {
  it('rests the panel so that only the content shows', () => {
    expect(contentOffset(700, 300)).toBe(400);
    expect(contentOffset(700, 900)).toBe(0);
  });

  it('settles on the nearest snap point', () => {
    expect(settleTarget(100, 0, 400, 700, true, true)).toBe('full');
    expect(settleTarget(300, 0, 400, 700, true, true)).toBe('content');
    expect(settleTarget(500, 0, 400, 700, true, true)).toBe('content');
    expect(settleTarget(600, 0, 400, 700, true, true)).toBe('close');
  });

  it('follows a flick past the nearest point', () => {
    expect(settleTarget(390, -900, 400, 700, true, true)).toBe('full');
    expect(settleTarget(410, 900, 400, 700, true, true)).toBe('close');
    expect(settleTarget(100, 900, 400, 700, true, true)).toBe('content');
  });

  it('respects a sheet that cannot expand or close', () => {
    expect(settleTarget(100, -900, 400, 700, false, true)).toBe('content');
    expect(settleTarget(600, 900, 400, 700, true, false)).toBe('content');
  });

  it('never lifts the panel above the 90 % line, and keeps the footer above the keyboard', () => {
    expect(panelTranslate(0, -300)).toBe(0);
    expect(panelTranslate(400, -100)).toBe(300);
    // Full snap, keyboard 300: the footer moves up by the whole keyboard.
    expect(footerTranslate(0, -300, 0)).toBe(-300);
    // Content snap at 200, keyboard 100: panel bottom sits 100 below the screen, footer 100 above it.
    expect(footerTranslate(200, -100, 200)).toBe(-200);
    // Dragged 100 below the resting point: the footer stops compensating and travels with the panel.
    expect(footerTranslate(300, 0, 200)).toBe(-200);
  });
});

describe('first focus on web (DQ-043)', () => {
  const start = () => ({ focus: jest.fn() });

  it('starts on the title and does not scroll to it', () => {
    const title = start();
    moveFocusIntoSheet({ contains: () => false }, title, null);
    expect(title.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('leaves focus on a field in the body that took it', () => {
    const title = start();
    moveFocusIntoSheet({ contains: () => true }, title, null);
    expect(title.focus).not.toHaveBeenCalled();
  });
});

describe('Sheet', () => {
  it('shows the title hairline only while the body is scrolled under it (DQ-334)', async () => {
    await renderUi(
      <Sheet visible onClose={jest.fn()} title="Filter" testID="s">
        <RNText>Marke</RNText>
      </Sheet>,
    );
    expect(screen.queryByTestId('s.headerLine', { includeHiddenElements: true })).toBeNull();
    let scroller = screen.getByTestId('s.body').parent;
    while (scroller && typeof scroller.props.onScroll !== 'function') scroller = scroller.parent;
    const scrollTo = (y: number) => fireEvent.scroll(scroller as never, { nativeEvent: { contentOffset: { x: 0, y } } });
    await scrollTo(24);
    // Over the header's bottom padding: the header keeps its height.
    expect(flat(screen.getByTestId('s.headerLine', { includeHiddenElements: true }).props.style)).toMatchObject({ bottom: 0, position: 'absolute' });
    await scrollTo(0);
    expect(screen.queryByTestId('s.headerLine', { includeHiddenElements: true })).toBeNull();
  });

  it('keeps a model name in the title whole, and the accessible name plain (DQ-047)', async () => {
    await renderUi(<Sheet visible onClose={jest.fn()} title="Nissan GT-R" testID="s" />);
    expect(screen.getByTestId('s.title').props.children).toBe('Nissan GT-\u2060R');
    expect(screen.getByTestId('s').props['aria-label']).toBe('Nissan GT-R');
  });

  describe('dragging', () => {
    /** Panel 90 % of the window, content snap from the measured header and body. */
    async function open(props: Partial<SheetProps> = {}) {
      const onClose = jest.fn();
      const onSnapChange = jest.fn();
      await renderUi(<Sheet visible onClose={onClose} onSnapChange={onSnapChange} title="Kraftstoff" testID="s" {...props} />);
      await fireEvent(screen.getByTestId('s.header'), 'layout', layout(48));
      await fireEvent(screen.getByTestId('s.body'), 'layout', layout(120));
      // The spring that carries it from below the screen to its resting point.
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS)));
      return { onClose, onSnapChange };
    }
    const drag = async (translationY: number, velocityY = 0) => {
      await act(async () => {
        fireGestureHandler(getByGestureTestId('s.headerPan'), [{ translationY: 0, velocityY: 0 }, { translationY, velocityY }]);
      });
    };
    const windowHeight = Dimensions.get('window').height;

    it('a flick up snaps to full, with the haptic', async () => {
      const { onSnapChange, onClose } = await open();
      await drag(-40, -900);
      expect(onSnapChange).toHaveBeenLastCalledWith('full');
      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('a flick down closes', async () => {
      const { onClose, onSnapChange } = await open();
      await drag(40, 900);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSnapChange).not.toHaveBeenCalled();
    });

    it('a drag far down closes without a flick', async () => {
      const { onClose } = await open();
      await drag(windowHeight);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a small drag stays at the content snap', async () => {
      const { onClose, onSnapChange } = await open();
      await drag(4);
      expect(onClose).not.toHaveBeenCalled();
      expect(onSnapChange).not.toHaveBeenCalled();
    });

    it('a sheet that is not dismissable does not close from a drag', async () => {
      const { onClose } = await open({ dismissable: false });
      await drag(windowHeight, 900);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('renders nothing while closed', async () => {
    await renderUi(<Sheet visible={false} onClose={jest.fn()} title="Kraftstoff" testID="s" />);
    expect(screen.queryByTestId('s')).toBeNull();
  });

  it('is a modal dialog named by its title, with the §8 shape', async () => {
    await renderUi(
      <Sheet visible onClose={jest.fn()} title="Kraftstoff" testID="s">
        <RNText>Benzin</RNText>
      </Sheet>,
    );
    const panel = screen.getByTestId('s');
    expect(panel.props.role).toBe('dialog');
    expect(panel.props['aria-modal']).toBe(true);
    expect(panel.props['aria-label']).toBe('Kraftstoff');
    const style = flat(panel.props.style);
    expect(style.borderTopLeftRadius).toBe(radius.lg);
    expect(style.borderTopRightRadius).toBe(16);
    expect(screen.getByTestId('s.title')).toHaveTextContent('Kraftstoff');
    expect(screen.getByText('Benzin')).toBeTruthy();
  });

  it('caps the panel at 90 % of the stage', async () => {
    await renderUi(<Sheet visible onClose={jest.fn()} title="Kraftstoff" testID="s" />);
    expect(size.sheetMaxHeightRatio).toBe(0.9);
    expect(flat(screen.getByTestId('s').props.style).height).toBe(Math.round(Dimensions.get('window').height * 0.9));
  });

  it('closes on the scrim', async () => {
    const onClose = jest.fn();
    await renderUi(<Sheet visible onClose={onClose} title="Kraftstoff" testID="s" />);
    await fireEvent.press(screen.getByTestId('s.scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores the scrim when it is not dismissable', async () => {
    const onClose = jest.fn();
    await renderUi(<Sheet visible onClose={onClose} dismissable={false} title="Kraftstoff" testID="s" />);
    await fireEvent.press(screen.getByTestId('s.scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('expands from the grabber with a light haptic only on the way to full', async () => {
    const onSnapChange = jest.fn();
    await renderUi(
      <Sheet visible onClose={jest.fn()} title="Kraftstoff" onSnapChange={onSnapChange} testID="s">
        <RNText>Benzin</RNText>
      </Sheet>,
    );
    await fireEvent(screen.getByTestId('s.body'), 'layout', layout(120));

    const grabber = screen.getByTestId('s.grabber');
    expect(grabber.props.role).toBe('button');
    expect(grabber.props.accessibilityState.expanded).toBe(false);

    await fireEvent.press(grabber);
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('s.grabber').props.accessibilityState.expanded).toBe(true);

    await fireEvent.press(screen.getByTestId('s.grabber'));
    expect(onSnapChange).toHaveBeenLastCalledWith('content');
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('has no grabber control when it cannot expand', async () => {
    await renderUi(<Sheet visible onClose={jest.fn()} expandable={false} title="Kraftstoff" testID="s" />);
    expect(screen.queryByTestId('s.grabber')).toBeNull();
  });

  it('renders the footer slot', async () => {
    await renderUi(
      <Sheet visible onClose={jest.fn()} title="Filter" footer={<RNText>124 Ergebnisse</RNText>} testID="s" />,
    );
    expect(screen.getByTestId('s.footer')).toHaveTextContent('124 Ergebnisse');
  });

  it('does not close again during the exit animation, from the scrim or the accessibility escape', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      function Host() {
        const [visible, setVisible] = useState(true);
        return (
          <Sheet
            visible={visible}
            onClose={() => {
              onClose();
              setVisible(false);
            }}
            title="Kraftstoff"
            testID="s"
          />
        );
      }
      await renderUi(<Host />);
      await fireEvent.press(screen.getByTestId('s.scrim'));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(flat(screen.getByTestId('s').props.style).pointerEvents).toBe('none');
      await fireEvent.press(screen.getByTestId('s.scrim'));
      await act(async () => screen.getByTestId('s').props.onAccessibilityEscape());
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stays mounted for the exit animation, then unmounts', async () => {
    jest.useFakeTimers();
    try {
      let hide = () => {};
      function Host() {
        const [visible, setVisible] = useState(true);
        hide = () => setVisible(false);
        return <Sheet visible={visible} onClose={jest.fn()} title="Kraftstoff" testID="s" />;
      }
      await renderUi(<Host />);
      await act(async () => hide());
      expect(screen.queryByTestId('s')).not.toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByTestId('s')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
