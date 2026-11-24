import { useEffect, useRef } from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, motion as motionTokens, size } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { HitArea } from '@/ui/PressableScale';
import { offsetToValue, snapValue, valueToOffset } from '@/ui/rangeSliderMath';
import { Text } from '@/ui/Text';
import { NO_BROWSER_OUTLINE, useFocusRing } from '@/ui/useFocusRing';
import { keyOf } from '@/ui/useRovingKeys';

export type AngleSliderProps = {
  /** Degrees, `min` … `max`. */
  value: number;
  min: number;
  max: number;
  step: number;
  /** Arrow keys and screen reader increments move this far; Page keys ten times as far. */
  onChange: (next: number) => void;
  /** Visible label above the track, also the slider's accessible name. */
  label: string;
  /** The value as shown ("−12°") and as read out ("−12 Grad"). */
  formatValue: (value: number) => string;
  formatSpoken: (value: number) => string;
  disabled?: boolean;
  testID: string;
};

const THUMB = size.slider.thumb;
const THUMB_SLOP = (size.touchMin - THUMB) / 2;
const TRACK_TOP = (THUMB - size.slider.track) / 2;
const PAGE_STEPS = 10;

const useStyles = createStyles((t) => ({
  root: { alignSelf: 'stretch', gap: t.space[8] },
  header: { alignItems: 'baseline', flexDirection: 'row', gap: t.space[12], justifyContent: 'space-between' },
  label: { flexShrink: 1 },
  value: { fontVariant: ['tabular-nums'] },
  rail: { height: t.size.slider.thumb },
  track: {
    backgroundColor: t.color.border.default,
    borderRadius: t.radius.full,
    height: t.size.slider.track,
    left: 0,
    position: 'absolute',
    right: 0,
    top: TRACK_TOP,
  },
  // The straight position: a tick in the middle of the track.
  zero: {
    backgroundColor: t.color.text.secondary,
    height: t.size.slider.thumb / 2,
    left: '50%',
    transform: [{ translateX: -t.size.border.control / 2 }],
    position: 'absolute',
    top: t.size.slider.thumb / 4,
    width: t.size.border.control,
  },
  // One unit wide, scaled from the middle to the thumb: only transform animates (RangeSlider's active bar).
  active: {
    backgroundColor: t.color.text.primary,
    height: t.size.slider.track,
    left: 0,
    position: 'absolute',
    top: TRACK_TOP,
    width: t.size.border.control,
  },
  thumb: { height: t.size.slider.thumb, left: 0, position: 'absolute', top: 0, width: t.size.slider.thumb },
  thumbVisual: { backgroundColor: t.color.bg.inverse, borderRadius: t.radius.full, height: t.size.slider.thumb, width: t.size.slider.thumb },
  disabledFill: { backgroundColor: t.color.text.disabled },
  noOutline: NO_BROWSER_OUTLINE,
}));

/**
 * The plate blur editor's angle control (client round, M5.9a): one thumb on RangeSlider's track (4) and thumb (28, 44 target),
 * the straight position marked in the middle, the bar running from there to the thumb, the value in tabular figures above. An
 * adjustable element for screen readers (increment/decrement), arrow, Page, Home and End keys on the web, a selection haptic when a
 * drag passes straight. Feature-local: the design system lists only the dual RangeSlider.
 */
export function AngleSlider({ value, min, max, step, onChange, label, formatValue, formatSpoken, disabled = false, testID }: AngleSliderProps) {
  const styles = useStyles();
  const focus = useFocusRing();
  const { springTo } = useMotionPreference();
  const own = useSharedValue(value);
  const width = useSharedValue(0);
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const held = useSharedValue(0);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (!dragging.get()) own.set(value);
  }, [dragging, own, value]);

  const emit = (next: number) => latest.current(next);
  const straight = () => haptics.selection();

  const pan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    hitSlop: THUMB_SLOP,
    // On the web RNGH re-applies the config on every render and drops the detector's `touchAction` (CR2-1, CarouselSnap): here too,
    // so a finger on iPhone Safari moves the thumb instead of scrolling the page.
    // @ts-expect-error -- touchAction is an allowed native prop of the pan handler (RNGH propsWhiteList) but not in PanGestureConfig
    touchAction: 'none',
    testID: `${testID}.pan`,
    onBegin: () => {
      'worklet';
      dragging.set(true);
      held.set(springTo(1, 'fast'));
      start.set(own.get());
    },
    onUpdate: (event) => {
      'worklet';
      const travel = Math.max(0, width.get() - THUMB);
      const raw = offsetToValue(valueToOffset(start.get(), travel, min, max) + event.translationX, travel, min, max);
      const next = snapValue(raw, min, max, step);
      const previous = own.get();
      if (next === previous) return;
      own.set(next);
      // One tick when the thumb reaches or jumps over straight.
      if (next === 0 || next * previous < 0) scheduleOnRN(straight);
      scheduleOnRN(emit, next);
    },
    onFinalize: () => {
      'worklet';
      dragging.set(false);
      held.set(springTo(0, 'fast'));
    },
  });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: valueToOffset(own.get(), Math.max(0, width.get() - THUMB), min, max) }],
  }));
  const visualStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(held.get(), [0, 1], [1, motionTokens.press.scale]) }],
  }));
  const activeStyle = useAnimatedStyle(() => {
    const travel = Math.max(0, width.get() - THUMB);
    const middle = valueToOffset(0, travel, min, max) + THUMB / 2;
    const thumb = valueToOffset(own.get(), travel, min, max) + THUMB / 2;
    return {
      opacity: width.get() > 0 ? 1 : 0,
      transform: [{ translateX: (middle + thumb) / 2 - size.border.control / 2 }, { scaleX: Math.abs(thumb - middle) / size.border.control }],
    };
  });

  const adjust = (next: number) => {
    const snapped = snapValue(next, min, max, step);
    if (snapped !== value) onChange(snapped);
  };

  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    if (disabled) return;
    const steps: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + step * PAGE_STEPS,
      PageDown: value - step * PAGE_STEPS,
      Home: min,
      End: max,
    };
    const key = keyOf(event);
    const next = key === undefined ? undefined : steps[key];
    if (next === undefined) return;
    event.preventDefault?.();
    adjust(next);
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    if (event.nativeEvent.actionName === 'increment') adjust(value + step);
    if (event.nativeEvent.actionName === 'decrement') adjust(value - step);
  };

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.header} aria-hidden>
        <Text variant="caption" color="text.secondary" style={styles.label}>
          {label}
        </Text>
        <Text variant="callout" style={styles.value} testID={`${testID}.value`}>
          {formatValue(value)}
        </Text>
      </View>
      <View style={styles.rail} onLayout={(event) => width.set(event.nativeEvent.layout.width)}>
        <View style={styles.track} />
        <View style={styles.zero} />
        <Animated.View style={[styles.active, disabled ? styles.disabledFill : null, activeStyle]} />
        <GestureDetector gesture={pan} touchAction="none" userSelect="none">
          <Animated.View
            role="slider"
            accessible
            aria-label={label}
            aria-disabled={disabled}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={formatSpoken(value)}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onAccessibilityAction}
            tabIndex={disabled ? -1 : 0}
            onFocus={focus.onFocus}
            onBlur={focus.onBlur}
            testID={`${testID}.thumb`}
            style={[styles.thumb, styles.noOutline, thumbStyle]}
            {...({ onKeyDown } as object)}
          >
            {isWeb ? <HitArea slopX={THUMB_SLOP} slopY={THUMB_SLOP} /> : null}
            <Animated.View style={[styles.thumbVisual, disabled ? styles.disabledFill : null, focus.ringStyle, visualStyle]} />
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}
