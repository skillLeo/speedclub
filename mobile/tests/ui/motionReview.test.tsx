/** M4.3 code-review fixes (motion kit): end states under preference flips, focusable actions, flight store, mount runs. */
import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { hydrateThemePreference, motion, ThemeProvider } from '@/theme';
import { Text } from '@/ui';
import { setReducedMotionPreview, useMotionPreference, type Motion } from '@/ui/motion';
import {
  beginFlight,
  flightRectNow,
  handlesOf,
  hasPending,
  PENDING_TTL_MS,
  registerSource,
  registerTarget,
  reportProgress,
  takePending,
  unregisterSource,
  type FlightHandle,
} from '@/ui/motion/flight';
import { __resetFlightLayerForTests } from '@/ui/motion/FlightLayer';
import {
  __resetFlightsForTests,
  __resetOdometerSessionForTests,
  CarouselSnap,
  collapseFlight,
  DrawnRule,
  FlightLayer,
  FlightTarget,
  FollowButton,
  MapPinScale,
  PrintWipe,
  QrReveal,
  SlideUpCard,
  startFlight,
} from '@/ui/motion/kit';
import { coverCounterScale, flightAt, flightRectAt, flightTransform, indicatorEdges, odometerCells, reactionIndexAt } from '@/ui/motion/math';

import { renderUi } from './helpers';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  AndroidHaptics: {},
}));

function ui(element: ReactElement) {
  return (
    <GestureHandlerRootView>
      <ThemeProvider>{element}</ThemeProvider>
    </GestureHandlerRootView>
  );
}

beforeAll(hydrateThemePreference);
afterEach(async () => {
  await act(async () => setReducedMotionPreview(null));
  jest.clearAllMocks();
  jest.useRealTimers();
  __resetFlightsForTests();
  __resetFlightLayerForTests();
  __resetOdometerSessionForTests();
});

const node = (rect = { x: 0, y: 0, width: 100, height: 100 }) => ({
  measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => cb(rect.x, rect.y, rect.width, rect.height),
});

describe('math edge cases (review #20)', () => {
  it('lets a bouncy flight overshoot past the target', () => {
    const start = flightTransform({ x: 0, y: 0, width: 50, height: 50 }, { x: 100, y: 100, width: 100, height: 100 });
    const over = flightAt(start, 1.2);
    expect(over.scaleX).toBeCloseTo(1.1);
    expect(over.translateX).toBeCloseTo(-0.2 * start.translateX);
  });

  it('keeps the counter-scale finite at zero size', () => {
    const counter = coverCounterScale(0, 0);
    expect(Number.isFinite(counter.scaleX)).toBe(true);
    expect(Number.isFinite(counter.scaleY)).toBe(true);
    expect(coverCounterScale(0, 2).scaleX).toBeGreaterThan(1);
  });

  it('rolls a shrinking value with the remaining columns only ("1.024" → "999")', () => {
    expect(odometerCells('1.024', '999')).toEqual([
      { kind: 'digit', key: 'p2', from: 0, to: 9 },
      { kind: 'digit', key: 'p1', from: 2, to: 9 },
      { kind: 'digit', key: 'p0', from: 4, to: 9 },
    ]);
  });

  it('rests the page indicator on the last page', () => {
    const edges = indicatorEdges(3, 8, 8, 20);
    expect(edges.left).toBeCloseTo(3 * 16 + 4 - 10);
    expect(edges.right - edges.left).toBeCloseTo(20);
  });

  it('splits the gap between two glyphs in the middle', () => {
    // Items 44, gap 4: the boundary between glyph 0 and 1 is the middle of the gap, x = 46.
    expect(reactionIndexAt(45.9, 20, 4, 44, 4, 24)).toBe(0);
    expect(reactionIndexAt(46, 20, 4, 44, 4, 24)).toBe(1);
  });

  it('places the clone at its start, end and in between', () => {
    const from = { x: 20, y: 300, width: 96, height: 128 };
    const to = { x: 0, y: 0, width: 390, height: 293 };
    expect(flightRectAt(from, to, 0)).toEqual(from);
    const end = flightRectAt(from, to, 1);
    expect(end.x).toBeCloseTo(0);
    expect(end.width).toBeCloseTo(390);
    expect(flightRectAt(from, to, 0.5).width).toBeCloseTo((96 + 390) / 2);
  });
});

describe('flight store (review #3, #4, #5)', () => {
  it('keeps the newer source of an id when the older one unregisters', () => {
    const a: FlightHandle = { node: node(), setVisible: jest.fn() };
    const b: FlightHandle = { node: node(), setVisible: jest.fn() };
    registerSource('hero.v1', a);
    registerSource('hero.v1', b);
    unregisterSource('hero.v1', a);
    expect(handlesOf('hero.v1').source).toBe(b);
    unregisterSource('hero.v1', b);
    expect(handlesOf('hero.v1').source).toBeUndefined();
  });

  it('drops a hand-over that no target took within the TTL', () => {
    beginFlight('hero.v2', { x: 0, y: 0, width: 10, height: 10 }, () => null, 'default', 12, 0, undefined, 0);
    expect(hasPending('hero.v2', PENDING_TTL_MS - 1)).toBe(true);
    expect(takePending('hero.v2', PENDING_TTL_MS + 1)).toBeUndefined();
    expect(hasPending('hero.v2', 0)).toBe(false);
  });

  it('drops the hand-over when its source unmounts', () => {
    const source: FlightHandle = { node: node(), setVisible: jest.fn() };
    registerSource('hero.v3', source);
    beginFlight('hero.v3', { x: 0, y: 0, width: 10, height: 10 }, () => null, 'default', 12, 0, source);
    unregisterSource('hero.v3', source);
    expect(hasPending('hero.v3')).toBe(false);
  });

  it('knows where a clone is mid-air, for a reverse that turns around', () => {
    const from = { x: 0, y: 0, width: 100, height: 100 };
    const to = { x: 200, y: 0, width: 100, height: 100 };
    startFlight({ id: 'hero.v4', from, to, render: () => null, token: 'default', radiusFrom: 12, radiusTo: 0 });
    expect(flightRectNow('hero.v4')).toBeNull();
    reportProgress('hero.v4', () => 0.5);
    expect(flightRectNow('hero.v4')).toEqual({ x: 100, y: 0, width: 100, height: 100 });
  });
});

describe('FlightTarget hand-over and the reduced way back (review #9)', () => {
  it('starts hidden with a flight pending, takes it on layout and fades in under reduced motion', async () => {
    jest.useFakeTimers();
    await act(async () => setReducedMotionPreview(true));
    beginFlight('hero.t', { x: 0, y: 0, width: 10, height: 10 }, () => null, 'default', 12, 0);
    await renderUi(
      <FlightTarget id="hero.t" testID="t.target">
        <Text>Hero</Text>
      </FlightTarget>,
    );
    expect(screen.getByTestId('t.target')).toHaveAnimatedStyle({ opacity: 0 });
    await fireEvent(screen.getByTestId('t.target'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 293 } } });
    expect(hasPending('hero.t')).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(motion.css['effect.default'].duration * 3);
    });
    expect(screen.getByTestId('t.target')).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('fades the target out on effect.fast, then pops', async () => {
    jest.useFakeTimers();
    let reduced: Motion | null = null;
    function Probe() {
      reduced = useMotionPreference();
      return null;
    }
    await act(async () => setReducedMotionPreview(true));
    await renderUi(<Probe />);
    const fadeOut = jest.fn();
    registerTarget('hero.back', { node: node(), setVisible: jest.fn(), fadeOut });
    registerSource('hero.back', { node: node(), setVisible: jest.fn() });
    const onDone = jest.fn();
    await act(async () => {
      await collapseFlight('hero.back', () => null, reduced as unknown as Motion, onDone);
    });
    expect(fadeOut).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(motion.css['effect.fast'].duration);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('one FlightLayer (review #6)', () => {
  it('lets the second layer render nothing, so a clone lands once', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderUi(
      <>
        <FlightLayer testID="t.a" />
        <FlightLayer testID="t.b" />
      </>,
    );
    await act(async () => {
      startFlight({ id: 'hero', from: { x: 0, y: 0, width: 10, height: 10 }, to: { x: 0, y: 0, width: 20, height: 20 }, render: () => null, token: 'default', radiusFrom: 12, radiusTo: 0 });
    });
    expect(screen.getByTestId('t.a.hero', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('t.b.hero', { includeHiddenElements: true })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('end states under a preference flip (review #1, #11, #14)', () => {
  it('uncovers the print even when reduced motion turned on before it played', async () => {
    jest.useFakeTimers();
    const view = await renderUi(
      <PrintWipe printing={false} testID="t.print">
        <Text>QR</Text>
      </PrintWipe>,
    );
    await act(async () => setReducedMotionPreview(true));
    await view.rerender(
      ui(
        <PrintWipe printing testID="t.print">
          <Text>QR</Text>
        </PrintWipe>,
      ),
    );
    await act(async () => {
      jest.advanceTimersByTime(motion.css['effect.default'].duration * 3);
    });
    expect(screen.getByTestId('t.print')).toHaveAnimatedStyle({ opacity: 1 });
    expect(screen.getByTestId('t.print.wipe')).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('draws the rule under reduced motion instead of leaving it at 0', async () => {
    const view = await renderUi(<DrawnRule drawn={false} width={120} testID="t.rule" />);
    await act(async () => setReducedMotionPreview(true));
    await view.rerender(ui(<DrawnRule drawn width={120} testID="t.rule" />));
    expect(screen.getByTestId('t.rule', { includeHiddenElements: true })).toHaveAnimatedStyle({ transform: [{ scaleX: 1 }] });
  });

  it('plays the QR haptic only when the card turns revealed, never on mount or a preference flip', async () => {
    const view = await renderUi(
      <QrReveal revealed>
        <Text>QR</Text>
      </QrReveal>,
    );
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    await act(async () => setReducedMotionPreview(true));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    await view.rerender(
      ui(
        <QrReveal revealed={false}>
          <Text>QR</Text>
        </QrReveal>,
      ),
    );
    await view.rerender(
      ui(
        <QrReveal revealed>
          <Text>QR</Text>
        </QrReveal>,
      ),
    );
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  });

  it('sizes a pin at once under reduced motion', async () => {
    jest.useFakeTimers();
    await act(async () => setReducedMotionPreview(true));
    await renderUi(
      <MapPinScale selected testID="t.pin">
        <Text>Pin</Text>
      </MapPinScale>,
    );
    // One frame: a spring would still be on its way, a set value is there.
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    expect(screen.getByTestId('t.pin')).toHaveAnimatedStyle({ transform: [{ scale: motion.signature.mapPin.selectedScale }] });
  });

  it('takes a hidden event card out of reach', async () => {
    await renderUi(
      <SlideUpCard visible={false} testID="t.card">
        <Text>Treffen</Text>
      </SlideUpCard>,
    );
    const card = screen.getByTestId('t.card', { includeHiddenElements: true });
    expect(card.props.pointerEvents).toBe('none');
    expect(card.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('no morph on mount or on a recycled cell (review #10)', () => {
  it('jumps to the new member state when the item changes, and keeps the stable name', async () => {
    jest.useFakeTimers();
    const button = (following: boolean, itemKey: string) => (
      <FollowButton following={following} itemKey={itemKey} onToggle={jest.fn()} followLabel="Folgen" followingLabel="Folge ich" testID="t.f" />
    );
    const view = await renderUi(button(true, 'lukas'));
    expect(screen.getByTestId('t.f.followingLabel')).toHaveAnimatedStyle({ opacity: 1 });
    // A FlashList cell is reused for another member who is not followed: no crossfade from the old state.
    await view.rerender(ui(button(false, 'mia')));
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    expect(screen.getByTestId('t.f.followingLabel')).toHaveAnimatedStyle({ opacity: 0 });
    expect(screen.getByTestId('t.f').props['aria-pressed']).toBe(false);
    expect(screen.getByTestId('t.f').props.accessibilityLabel).toBe('Folgen');
  });
});

describe('carousel actions on the focusable card (review #2, #12)', () => {
  const CARS = [
    { key: 'e46', title: 'BMW M3 E46' },
    { key: 'r34', title: 'Nissan Skyline GT-R R34' },
  ];
  const carousel = (onReorder: (from: number, to: number) => void, editing = false) => (
    <CarouselSnap
      items={CARS}
      keyOf={(car) => car.key}
      labelOf={(car) => car.title}
      renderItem={(car) => <Text>{car.title}</Text>}
      itemWidth={240}
      gap={12}
      onReorder={onReorder}
      moveLabels={{ left: 'Nach links schieben', right: 'Nach rechts schieben' }}
      editing={editing}
      testID="t.c"
    />
  );

  it('offers the move actions on the card that screen readers focus', async () => {
    const onReorder = jest.fn();
    await renderUi(carousel(onReorder));
    const card = screen.getByTestId('t.c.card.e46');
    expect(card.props.accessible).toBe(true);
    expect(card.props['aria-label']).toBe('BMW M3 E46');
    expect(card.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['moveRight']);
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'moveRight' } });
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('shows visible move buttons while sorting (WCAG 2.5.7)', async () => {
    const onReorder = jest.fn();
    await renderUi(carousel(onReorder, true));
    const first = screen.getByTestId('t.c.card.e46.moveLeft');
    expect(first.props['aria-disabled'] ?? first.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('t.c.card.r34.moveLeft'));
    expect(onReorder).toHaveBeenCalledWith(1, 0);
  });
});
