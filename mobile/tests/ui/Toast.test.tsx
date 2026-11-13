import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hydrateThemePreference, motion, radius, size, space } from '@/theme';
import { Sheet } from '@/ui/Sheet';
import { dismissToast, toast } from '@/ui/toast';
import { TOAST_DURATION_MS, ToastHost } from '@/ui/ToastHost';

import { flat, renderUi } from './helpers';

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  notificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(async () => {
  await act(async () => {
    dismissToast();
    jest.advanceTimersByTime(1000);
  });
  jest.useRealTimers();
});

const show = (...args: Parameters<typeof toast>) =>
  act(async () => {
    toast(...args);
  });

describe('Toast', () => {
  it('shows nothing without a toast', async () => {
    await renderUi(<ToastHost />);
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(screen.getByTestId('toast.host')).toBeTruthy();
  });

  it('has the §8 shape and inverse colours', async () => {
    await renderUi(<ToastHost />);
    await show('Fahrzeug gespeichert');
    const style = flat(screen.getByTestId('toast').props.style);
    expect(style.minHeight).toBe(size.toastMin);
    expect(style.borderRadius).toBe(radius.sm);
    expect(screen.getByText('Fahrzeug gespeichert')).toBeTruthy();
  });

  it('sits 8 above the tab bar', async () => {
    await renderUi(<ToastHost tabBarOffset={size.tabBar} />);
    const bottom = flat(screen.getByTestId('toast.host').props.style).bottom as number;
    expect(bottom).toBeGreaterThanOrEqual(size.tabBar + 8);
  });

  it('announces on native', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderUi(<ToastHost />);
    await show('Fahrzeug gespeichert');
    expect(announce).toHaveBeenCalledWith('Fahrzeug gespeichert');
  });

  it('leaves after 4 s', async () => {
    await renderUi(<ToastHost />);
    await show('Fahrzeug gespeichert');
    expect(TOAST_DURATION_MS).toBe(4000);
    await act(async () => {
      jest.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.queryByTestId('toast')).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('offers undo with the common label, and closes after it', async () => {
    const undo = jest.fn();
    await renderUi(<ToastHost />);
    await show('Foto entfernt', { undo });
    const action = screen.getByTestId('toast.action');
    expect(action.props.role).toBe('button');
    expect(action.props.accessibilityLabel).toBe('Rückgängig');
    await fireEvent.press(action);
    expect(undo).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('replaces the current toast and restarts its 4 s', async () => {
    await renderUi(<ToastHost />);
    await show('Erste');
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await show('Zweite');
    expect(screen.queryByText('Erste')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Zweite')).toBeTruthy();
  });

  it('plays only the requested haptic', async () => {
    await renderUi(<ToastHost />);
    await show('Ohne');
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    await show('Gespeichert', { haptic: 'success' });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('passes its own testID through', async () => {
    await renderUi(<ToastHost />);
    await show('Fehler', { testID: 'GAR-01.toast', action: { label: 'Details', onPress: jest.fn() } });
    expect(screen.getByTestId('GAR-01.toast')).toBeTruthy();
    expect(screen.getByTestId('GAR-01.toast.action')).toBeTruthy();
  });
});

describe('where the toast sits', () => {
  /** A one-row sticky CTA bar: hairline, 12 + button L + 12, plus the inset it pads itself. */
  const BAR = 1 + space[12] + size.button.l + space[12];
  const INSET = 34;
  const KEYBOARD = 336;
  const bottomOf = () => flat(screen.getByTestId('toast.host').props.style).bottom as number;
  const insets = useSafeAreaInsets as jest.Mock;
  const keyboardAnimation = useReanimatedKeyboardAnimation as jest.Mock;
  const closedKeyboard: unknown = keyboardAnimation();
  const openKeyboard = (height: number, progress = 1) =>
    keyboardAnimation.mockReturnValue({
      height: { value: -height, get: () => -height, set: jest.fn() },
      progress: { value: progress, get: () => progress, set: jest.fn() },
    });
  /** The wrapper that slides in: its translateY carries the keyboard lift, after the entrance has settled. */
  const settledShift = async () => {
    await show('Code erneut gesendet');
    await act(async () => {
      jest.advanceTimersByTime(motion.css['effect.default'].duration + motion.css['effect.fast'].duration);
    });
    return screen.getByTestId('toast').parent;
  };

  afterEach(() => {
    keyboardAnimation.mockReturnValue(closedKeyboard);
    insets.mockReset();
    insets.mockImplementation(() => ({ top: 0, right: 0, bottom: 0, left: 0 }));
  });

  it('sits 8 above a sticky CTA bar, so it never covers the primary action', async () => {
    await renderUi(<ToastHost stickyBarHeight={BAR} />);
    expect(bottomOf()).toBe(BAR + 8);
  });

  it('sits 8 above the higher of tab bar and sticky bar', async () => {
    await renderUi(<ToastHost tabBarOffset={size.tabBar} stickyBarHeight={BAR} />);
    expect(bottomOf()).toBe(Math.max(size.tabBar, BAR) + 8);
  });

  it('counts the safe inset once: over the tab bar, and inside the bar that pads it itself', async () => {
    insets.mockImplementation(() => ({ top: 0, right: 0, bottom: INSET, left: 0 }));
    const { unmount } = await renderUi(<ToastHost tabBarOffset={size.tabBar} />);
    expect(bottomOf()).toBe(size.tabBar + INSET + 8);
    await act(async () => unmount());
    await renderUi(<ToastHost stickyBarHeight={BAR + INSET} />);
    expect(bottomOf()).toBe(BAR + INSET + 8);
  });

  it('does not move with the keyboard closed', async () => {
    await renderUi(<ToastHost stickyBarHeight={BAR} />);
    expect(await settledShift()).toHaveAnimatedStyle({ transform: [{ translateY: 0 }] });
  });

  it('rises above the open keyboard', async () => {
    openKeyboard(KEYBOARD);
    await renderUi(<ToastHost />);
    expect(await settledShift()).toHaveAnimatedStyle({ transform: [{ translateY: -KEYBOARD }] });
  });

  it('rises above the sticky bar riding on the keyboard, whose safe inset goes behind it', async () => {
    insets.mockImplementation(() => ({ top: 0, right: 0, bottom: INSET, left: 0 }));
    openKeyboard(KEYBOARD);
    await renderUi(<ToastHost stickyBarHeight={BAR + INSET} />);
    // Bottom BAR + INSET + 8; the top of the bar is now at KEYBOARD + BAR.
    expect(await settledShift()).toHaveAnimatedStyle({ transform: [{ translateY: -(KEYBOARD - INSET) }] });
  });
});

describe('a toast while an overlay is open', () => {
  let setOpen: (open: boolean) => void = () => undefined;

  function Scene() {
    const [open, set] = useState(false);
    setOpen = set;
    return (
      <>
        <ToastHost testID="app" />
        <Sheet visible={open} onClose={jest.fn()} title="Foto" testID="s" />
      </>
    );
  }

  it('shows in the overlay only, and goes back to the app host when it closes', async () => {
    await renderUi(<Scene />);
    expect(screen.queryByTestId('app.host')).not.toBeNull();

    await act(async () => setOpen(true));
    expect(screen.queryByTestId('app.host')).toBeNull();
    expect(screen.getAllByTestId('toast.host')).toHaveLength(1);

    await show('Foto gespeichert', { testID: 'saved', undo: jest.fn() });
    expect(screen.getAllByTestId('saved')).toHaveLength(1);
    expect(screen.getByTestId('saved.action')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);

    await act(async () => setOpen(false));
    await act(async () => {
      // The sheet stays mounted for its exit, the spring.default slide (09 §4.7, SM10).
      jest.advanceTimersByTime(motion.css['spring.default'].duration);
    });
    expect(screen.queryByTestId('app.host')).not.toBeNull();
    expect(screen.getAllByTestId('saved')).toHaveLength(1);
    // Moved, not raised again.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  });

  it('with stacked overlays only the top one hosts', async () => {
    await renderUi(
      <>
        <Sheet visible onClose={jest.fn()} title="Foto" testID="a" />
        <Sheet visible onClose={jest.fn()} title="Foto" testID="b" />
      </>,
    );
    expect(screen.getAllByTestId('toast.host')).toHaveLength(1);
  });
});
