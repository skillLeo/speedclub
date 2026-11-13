import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useState, type ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { setHapticsEnabled } from '@/lib/haptics';
import { hydrateThemePreference, motion, ThemeProvider, useTheme } from '@/theme';
import { Text, ToastHost, dismissToast, toast } from '@/ui';
import { hapticFor, setReducedMotionPreview, useHapticsSetting, useMotionPreference, type Motion } from '@/ui/motion';
import {
  __resetFlightsForTests,
  __resetOdometerSessionForTests,
  BeforeAfter,
  BrushReveal,
  brushRevealDuration,
  CircularReveal,
  ContentReveal,
  expandFrom,
  FlightLayer,
  FollowButton,
  LiveCount,
  OdometerNumber,
  ReactionPicker,
  SaveToggle,
  startFlight,
  SwipeRow,
  useOdometerOnce,
  zeroed,
} from '@/ui/motion/kit';

import { renderUi } from './helpers';

/** The providers of `renderUi`, for a rerender. */
function ui(element: ReactElement) {
  return (
    <GestureHandlerRootView>
      <ThemeProvider>{element}</ThemeProvider>
    </GestureHandlerRootView>
  );
}

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: {},
}));

beforeAll(hydrateThemePreference);
afterEach(async () => {
  await act(async () => setReducedMotionPreview(null));
  setHapticsEnabled(true, false);
  jest.clearAllMocks();
  __resetFlightsForTests();
  __resetOdometerSessionForTests();
});

const PHOTO = { source: 1, blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB', focal: { x: 0.5, y: 0.5 } };

describe('reduced-motion preview (DEV-01)', () => {
  it('switches every motion to the reduced variant and hands back to the device', async () => {
    const seen: { current: Motion | null } = { current: null };
    function Probe() {
      seen.current = useMotionPreference();
      return null;
    }
    await render(<Probe />);
    expect(seen.current?.reduced).toBe(false);
    await act(async () => setReducedMotionPreview(true));
    expect(seen.current?.preference).toBe('reduced');
    await act(async () => setReducedMotionPreview(null));
    expect(seen.current?.reduced).toBe(false);
  });
});

describe('haptics toggle (SET-10 "Haptisches Feedback", 09 §4.8)', () => {
  it('plays the mapped kind while on and stays silent while off', async () => {
    let setting: readonly [boolean, (next: boolean) => void] = [true, () => undefined];
    function Probe() {
      setting = useHapticsSetting();
      return null;
    }
    await render(<Probe />);
    expect(setting[0]).toBe(true);
    hapticFor('follow');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');

    await act(async () => setting[1](false));
    expect(setting[0]).toBe(false);
    hapticFor('qrRevealed');
    hapticFor('failedAction');
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    await act(async () => setting[1](true));
    hapticFor('qrRevealed');
    expect(Haptics.impactAsync).toHaveBeenLastCalledWith('medium');
  });
});

describe('SM8 follow and save', () => {
  function Follow() {
    const [following, setFollowing] = useState(false);
    return (
      <FollowButton following={following} onToggle={() => setFollowing((f) => !f)} followLabel="Folgen" followingLabel="Folge ich" testID="t.follow" />
    );
  }

  it('morphs the label, tells its state and plays one light haptic per toggle', async () => {
    await renderUi(<Follow />);
    const button = screen.getByTestId('t.follow');
    expect(button.props.accessibilityLabel).toBe('Folgen');
    await fireEvent.press(button);
    // A toggle keeps its name; the state is aria-pressed (review M4.3 #19).
    expect(screen.getByTestId('t.follow').props.accessibilityLabel).toBe('Folgen');
    expect(screen.getByTestId('t.follow').props['aria-pressed']).toBe(true);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('keeps the bookmark name and tells the state in aria-pressed', async () => {
    function Save() {
      const [saved, setSaved] = useState(false);
      return <SaveToggle saved={saved} onToggle={() => setSaved((s) => !s)} saveLabel="Merken" savedLabel="Gemerkt" testID="t.save" />;
    }
    await renderUi(<Save />);
    await fireEvent.press(screen.getByTestId('t.save'));
    expect(screen.getByTestId('t.save').props.accessibilityLabel).toBe('Merken');
    expect(screen.getByTestId('t.save').props['aria-pressed']).toBe(true);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  });
});

describe('SM6 odometer and SM18 live count', () => {
  it('reads the value once, whatever rolls', async () => {
    await renderUi(<OdometerNumber value="1.725" rollFrom={zeroed('1.725')} testID="t.odo" />);
    expect(screen.getByTestId('t.odo').props['aria-label']).toBe('1.725');
    expect(zeroed('3,9')).toBe('0,0');
  });

  it('rolls once per vehicle per session', async () => {
    const seen: boolean[] = [];
    function Probe({ id }: { id: string }) {
      seen.push(useOdometerOnce(id));
      return null;
    }
    const first = await render(<Probe id="v1" />);
    await first.unmount();
    await render(<Probe id="v1" />);
    await render(<Probe id="v2" />);
    expect(seen.slice(0, 1)).toEqual([true]);
    expect(seen).toContain(false);
    expect(seen.at(-1)).toBe(true);
  });

  it('follows filters only after they stood still for 250 ms', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderUi(<LiveCount value="128" testID="t.count" />);
      await view.rerender(ui(<LiveCount value="64" testID="t.count" />));
      expect(screen.getByTestId('t.count').props['aria-label']).toBe('128');
      await act(async () => {
        jest.advanceTimersByTime(motion.signature.liveCountDebounce);
      });
      expect(screen.getByTestId('t.count').props['aria-label']).toBe('64');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SM11 swipe actions', () => {
  const archive = jest.fn();
  const remove = jest.fn();
  const row = (
    <SwipeRow
      fullSwipe
      actions={[
        { key: 'archive', label: 'Archivieren', icon: 'archive', onPress: archive },
        { key: 'delete', label: 'Löschen', icon: 'trash', tone: 'destructive', onPress: remove },
      ]}
      label="Lukas Schneider folgt dir"
      testID="t.row"
    >
      <Text>Lukas Schneider</Text>
    </SwipeRow>
  );

  it('offers the actions to screen readers', async () => {
    await renderUi(row);
    const front = screen.getByTestId('t.row.front');
    // The row itself is the focusable element: VoiceOver and TalkBack offer only the focused element's actions.
    expect(front.props.accessible).toBe(true);
    expect(front.props['aria-label']).toBe('Lukas Schneider folgt dir');
    expect(front.props.accessibilityActions).toEqual([
      { name: 'archive', label: 'Archivieren' },
      { name: 'delete', label: 'Löschen' },
    ]);
    await fireEvent(front, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('runs the first action on a full swipe, with one threshold haptic', async () => {
    await renderUi(row);
    await fireEvent(screen.getByTestId('t.row'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 56 } } });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('t.row.pan'), [
        { translationX: 0, velocityX: 0 },
        { translationX: -150, velocityX: 0 },
        { translationX: -300, velocityX: 0 },
      ]);
    });
    expect(archive).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });
});

describe('SM9 reaction picker', () => {
  const REACTIONS = [
    { key: 'stark', label: 'Stark', icon: 'turbo' as const },
    { key: 'sauber', label: 'Sauber', icon: 'wheel' as const },
  ];

  it('gives the last-used reaction on a tap and any reaction as an action', async () => {
    const onSelect = jest.fn();
    await renderUi(<ReactionPicker reactions={REACTIONS} selected={null} lastUsed="sauber" onSelect={onSelect} label="Reagieren" testID="t.react" />);
    const button = screen.getByTestId('t.react.button');
    expect(button.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['activate', 'stark', 'sauber']);
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onSelect).toHaveBeenLastCalledWith('sauber');
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'stark' } });
    expect(onSelect).toHaveBeenLastCalledWith('stark');
  });

  it('takes the reaction back on a second tap', async () => {
    const onSelect = jest.fn();
    await renderUi(<ReactionPicker reactions={REACTIONS} selected="stark" lastUsed="stark" onSelect={onSelect} label="Reagieren" testID="t.react" />);
    const button = screen.getByTestId('t.react.button');
    expect(button.props['aria-label']).toBe('Reagieren: Stark');
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe('SM17 before/after', () => {
  it('is an adjustable control in 5 % steps', async () => {
    await renderUi(<BeforeAfter before={{ ...PHOTO, label: 'Vorher' }} after={{ ...PHOTO, label: 'Nachher' }} aspect="4:3" label="Vergleich" testID="t.ba" />);
    const handle = screen.getByTestId('t.ba.handle');
    expect(handle.props['aria-valuenow']).toBe(50);
    await fireEvent(handle, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('t.ba.handle').props['aria-valuenow']).toBe(55);
  });
});

describe('SM15 skeleton → content', () => {
  it('shows the skeleton while loading and the content after', async () => {
    const view = await renderUi(
      <ContentReveal loading skeleton={<Text testID="t.skeleton">…</Text>} testID="t.content">
        <Text>Inhalt</Text>
      </ContentReveal>,
    );
    expect(screen.queryByTestId('t.content')).toBeNull();
    await view.rerender(
      ui(
<ContentReveal loading={false} skeleton={<Text testID="t.skeleton">…</Text>} testID="t.content">
        <Text>Inhalt</Text>
      </ContentReveal>),
    );
    expect(screen.queryByTestId('t.skeleton')).toBeNull();
    expect(screen.getByTestId('t.content')).toBeTruthy();
  });
});

describe('SM14 circular reveal', () => {
  function Canvas() {
    return <Text testID="t.canvas">{useTheme().color.bg.canvas}</Text>;
  }
  const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 200 } } };

  it('switches the content under the disc once it covers the box', async () => {
    jest.useFakeTimers();
    try {
      const view = await renderUi(
        <CircularReveal theme="carbon" testID="t.reveal">
          <Canvas />
        </CircularReveal>,
      );
      const carbon = screen.getByTestId('t.canvas').props.children as string;
      await fireEvent(screen.getByTestId('t.reveal'), 'layout', layout);
      await view.rerender(
        ui(
<CircularReveal theme="light" testID="t.reveal">
          <Canvas />
        </CircularReveal>),
      );
      expect(screen.getByTestId('t.reveal.disc', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId('t.canvas').props.children).toBe(carbon);
      await act(async () => {
        jest.advanceTimersByTime(motion.css['effect.slow'].duration + motion.css['effect.fast'].duration);
      });
      expect(screen.getByTestId('t.canvas').props.children).not.toBe(carbon);
      expect(screen.queryByTestId('t.reveal.disc', { includeHiddenElements: true })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('crossfades under reduced motion: the content switches at once, no disc', async () => {
    await act(async () => setReducedMotionPreview(true));
    const view = await renderUi(
      <CircularReveal theme="carbon" testID="t.reveal">
        <Canvas />
      </CircularReveal>,
    );
    const carbon = screen.getByTestId('t.canvas').props.children as string;
    await fireEvent(screen.getByTestId('t.reveal'), 'layout', layout);
    await view.rerender(
      ui(
<CircularReveal theme="light" testID="t.reveal">
        <Canvas />
      </CircularReveal>),
    );
    expect(screen.queryByTestId('t.reveal.disc', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('t.canvas').props.children).not.toBe(carbon);
  });
});

describe('SM1 brush reveal', () => {
  it('reports done after reveal and hold, sooner under reduced motion, and never loops', async () => {
    expect(brushRevealDuration(false)).toBe(motion.css['spring.slow'].duration + motion.signature.splash.hold);
    expect(brushRevealDuration(true)).toBe(motion.css['effect.default'].duration + motion.signature.splash.hold);
    expect(brushRevealDuration(false, false)).toBe(0);
    jest.useFakeTimers();
    try {
      const onDone = jest.fn();
      await renderUi(<BrushReveal play logo={<Text>SPEED CLUB</Text>} onDone={onDone} />);
      await act(async () => {
        jest.advanceTimersByTime(brushRevealDuration(false) - 1);
      });
      expect(onDone).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SM4/SM12 flights', () => {
  it('needs a laid-out source to start', async () => {
    await expect(expandFrom('missing', () => null)).resolves.toBe(false);
  });

  it('draws the clone in the layer until the spring has settled', async () => {
    jest.useFakeTimers();
    try {
      const onLand = jest.fn();
      await renderUi(<FlightLayer testID="t.flights" />);
      await act(async () => {
        startFlight({
          id: 'hero',
          from: { x: 20, y: 300, width: 96, height: 128 },
          to: { x: 0, y: 0, width: 390, height: 293 },
          render: () => <Text>Foto</Text>,
          token: 'default',
          radiusFrom: 12,
          radiusTo: 0,
          onLand,
        });
      });
      expect(screen.getByTestId('t.flights.hero', { includeHiddenElements: true })).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(motion.css['spring.default'].duration);
      });
      expect(onLand).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('t.flights.hero', { includeHiddenElements: true })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SM20 toast', () => {
  it('keeps a toast with undo for 5 s and a plain one for 4 s', async () => {
    jest.useFakeTimers();
    try {
      await renderUi(<ToastHost />);
      await act(async () => {
        toast('Foto entfernt', { undo: () => undefined });
      });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.getByText('Foto entfernt')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1000 + motion.css['effect.fast'].duration);
      });
      expect(screen.queryByText('Foto entfernt')).toBeNull();
    } finally {
      await act(async () => dismissToast());
      jest.useRealTimers();
    }
  });
});
