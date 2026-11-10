import { useCallback, useEffect, useRef, useState } from 'react';
import { View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { parseNumber } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, motion as motionTokens, size, space, useMotion } from '@/theme';

import { HitArea } from './PressableScale';
import { useForcedVisualState, WithoutForcedState } from './qaVisualState';
import { bubbleOffsets, clampHigh, clampLow, offsetToValue, snapValue, valueToOffset } from './rangeSliderMath';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { NO_BROWSER_OUTLINE, useFocusRing } from './useFocusRing';
import { keyOf } from './useRovingKeys';

export type RangeValue = readonly [number, number];

export type RangeSliderInputs = {
  lowLabel: string;
  highLabel: string;
  /** Unit in both fields, for example "PS". */
  suffix?: string;
};

export type RangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  value: RangeValue;
  /** Fires on every step of a drag, on a key press and when a numeric input commits. */
  onChange: (next: [number, number]) => void;
  /** Fires when a drag ends. */
  onChangeEnd?: (next: [number, number]) => void;
  /** Accessible names of the two thumbs. */
  lowLabel: string;
  highLabel: string;
  /** Text of the bubbles and `aria-valuetext`; defaults to the locale's number format. */
  formatValue?: (value: number) => string;
  /** Renders the two numeric inputs below the slider. */
  inputs?: RangeSliderInputs;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const THUMB = size.slider.thumb;
const THUMB_SLOP = (size.touchMin - THUMB) / 2;
const TRACK_TOP = (THUMB - size.slider.track) / 2;
const PAGE_STEPS = 10;

const useStyles = createStyles((t) => ({
  root: { alignSelf: 'stretch', gap: t.space[12] },
  bubbleLane: { paddingBottom: t.space[8] },
  bubble: {
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.overlay,
    borderColor: t.color.border.default,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[2],
  },
  bubbleSpacer: { opacity: 0 },
  bubbleFloat: { left: 0, position: 'absolute', top: 0 },
  bubbleText: { fontVariant: ['tabular-nums'] },
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
  // One unit wide, scaled between the thumbs: only transform animates.
  active: {
    backgroundColor: t.color.text.primary,
    height: t.size.slider.track,
    left: 0,
    position: 'absolute',
    top: TRACK_TOP,
    width: t.size.border.control,
  },
  // The box moves and holds the 44 target; the visual inside it scales, so pressing never shrinks the target.
  thumb: {
    height: t.size.slider.thumb,
    left: 0,
    position: 'absolute',
    top: 0,
    width: t.size.slider.thumb,
  },
  thumbVisual: {
    backgroundColor: t.color.bg.inverse,
    borderRadius: t.radius.full,
    height: t.size.slider.thumb,
    width: t.size.slider.thumb,
  },
  disabledFill: { backgroundColor: t.color.text.disabled },
  noOutline: NO_BROWSER_OUTLINE,
  raised: { zIndex: t.zIndex.sticky },
  inputs: { flexDirection: 'row', gap: t.space[12] },
  input: { flex: 1, minWidth: 0 },
}));

/**
 * §8 range slider: track 4, thumbs 28 with a 44 hit area, tabular value bubbles above, two thumbs that cannot
 * cross, arrow, page, Home and End keys on web, and adjustable actions for native screen readers.
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  onChangeEnd,
  lowLabel,
  highLabel,
  formatValue,
  inputs,
  disabled = false,
  style,
  testID,
}: RangeSliderProps) {
  const styles = useStyles();
  const format = useFormat();
  const display = formatValue ?? format.number;
  const [low, high] = value;

  const lowValue = useSharedValue(low);
  const highValue = useSharedValue(high);
  const width = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lowBubbleWidth = useSharedValue(0);
  const highBubbleWidth = useSharedValue(0);

  // Counts finished drags: a parent that refused or clamped a value changes no prop, and the thumb still has to go back.
  const [dragsEnded, setDragsEnded] = useState(0);

  useEffect(() => {
    if (dragging.get()) return;
    lowValue.set(low);
    highValue.set(high);
  }, [dragging, dragsEnded, high, highValue, low, lowValue]);

  const latest = useRef({ onChange, onChangeEnd, low, high });
  useEffect(() => {
    latest.current = { onChange, onChangeEnd, low, high };
  });

  const emitLow = useCallback((next: number) => {
    latest.current.onChange([next, latest.current.high]);
  }, []);
  const emitHigh = useCallback((next: number) => {
    latest.current.onChange([latest.current.low, next]);
  }, []);
  const emitEnd = useCallback((nextLow: number, nextHigh: number) => {
    latest.current.onChangeEnd?.([nextLow, nextHigh]);
    setDragsEnded((count) => count + 1);
  }, []);

  const changeBy = (thumb: 'low' | 'high', next: number) => {
    const clamped = thumb === 'low' ? clampLow(next, high, min, max, step) : clampHigh(next, low, min, max, step);
    if (clamped === (thumb === 'low' ? low : high)) return;
    const pair: [number, number] = thumb === 'low' ? [clamped, high] : [low, clamped];
    onChange(pair);
    onChangeEnd?.(pair);
  };

  const bubbles = useDerivedValue(() => {
    const travel = Math.max(0, width.get() - THUMB);
    return bubbleOffsets(
      valueToOffset(lowValue.get(), travel, min, max) + THUMB / 2,
      valueToOffset(highValue.get(), travel, min, max) + THUMB / 2,
      lowBubbleWidth.get(),
      highBubbleWidth.get(),
      width.get(),
      space[4],
    );
  });
  const lowBubble = useAnimatedStyle(() => ({
    opacity: width.get() > 0 ? 1 : 0,
    transform: [{ translateX: bubbles.get().low }],
  }));
  const highBubble = useAnimatedStyle(() => ({
    opacity: width.get() > 0 ? 1 : 0,
    transform: [{ translateX: bubbles.get().high }],
  }));
  const active = useAnimatedStyle(() => {
    const travel = Math.max(0, width.get() - THUMB);
    const start = valueToOffset(lowValue.get(), travel, min, max) + THUMB / 2;
    const end = valueToOffset(highValue.get(), travel, min, max) + THUMB / 2;
    return {
      transform: [{ translateX: (start + end) / 2 - size.border.control / 2 }, { scaleX: Math.max(0, end - start) }],
    };
  });

  // The thumb at the end of the range must stay reachable when both sit on the same spot.
  const lowOnTop = high - low <= step && high >= max;

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View>
        <View style={styles.bubbleLane}>
          <View aria-hidden style={[styles.bubble, styles.bubbleSpacer]}>
            <Text variant="caption" style={styles.bubbleText}>
              {display(high)}
            </Text>
          </View>
          <Animated.View
            onLayout={(event) => lowBubbleWidth.set(event.nativeEvent.layout.width)}
            style={[styles.bubble, styles.bubbleFloat, lowBubble]}
          >
            <Text variant="caption" style={styles.bubbleText} testID={testID ? `${testID}.lowValue` : undefined}>
              {display(low)}
            </Text>
          </Animated.View>
          <Animated.View
            onLayout={(event) => highBubbleWidth.set(event.nativeEvent.layout.width)}
            style={[styles.bubble, styles.bubbleFloat, highBubble]}
          >
            <Text variant="caption" style={styles.bubbleText} testID={testID ? `${testID}.highValue` : undefined}>
              {display(high)}
            </Text>
          </Animated.View>
        </View>
        <View style={styles.rail} onLayout={(event) => width.set(event.nativeEvent.layout.width)} testID={testID ? `${testID}.rail` : undefined}>
          <View style={styles.track} />
          <Animated.View style={[styles.active, disabled ? styles.disabledFill : null, active]} />
          <WithoutForcedState>
            <Thumb
              kind="low"
              label={lowLabel}
              value={low}
              own={lowValue}
              other={highValue}
              width={width}
              dragging={dragging}
              min={min}
              max={max}
              step={step}
              disabled={disabled}
              display={display}
              raised={lowOnTop}
              onStep={emitLow}
              onEnd={emitEnd}
              onAdjust={(next) => changeBy('low', next)}
              testID={testID ? `${testID}.low` : undefined}
            />
          </WithoutForcedState>
          <Thumb
            kind="high"
            label={highLabel}
            value={high}
            own={highValue}
            other={lowValue}
            width={width}
            dragging={dragging}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            display={display}
            raised={false}
            onStep={emitHigh}
            onEnd={emitEnd}
            onAdjust={(next) => changeBy('high', next)}
            testID={testID ? `${testID}.high` : undefined}
          />
        </View>
      </View>
      {inputs ? (
        <View style={styles.inputs}>
          <NumberField
            label={inputs.lowLabel}
            suffix={inputs.suffix}
            value={low}
            disabled={disabled}
            onCommit={(next) => changeBy('low', next)}
            testID={testID ? `${testID}.lowInput` : undefined}
          />
          <NumberField
            label={inputs.highLabel}
            suffix={inputs.suffix}
            value={high}
            disabled={disabled}
            onCommit={(next) => changeBy('high', next)}
            testID={testID ? `${testID}.highInput` : undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

type ThumbProps = {
  kind: 'low' | 'high';
  label: string;
  value: number;
  own: SharedValue<number>;
  other: SharedValue<number>;
  width: SharedValue<number>;
  dragging: SharedValue<boolean>;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  display: (value: number) => string;
  raised: boolean;
  onStep: (next: number) => void;
  onEnd: (low: number, high: number) => void;
  onAdjust: (next: number) => void;
  testID: string | undefined;
};

function Thumb({
  kind,
  label,
  value,
  own,
  other,
  width,
  dragging,
  min,
  max,
  step,
  disabled,
  display,
  raised,
  onStep,
  onEnd,
  onAdjust,
  testID,
}: ThumbProps) {
  const styles = useStyles();
  const focus = useFocusRing();
  const forced = useForcedVisualState();
  const start = useSharedValue(0);
  // §10 press: scale and opacity while the thumb is held, spring.snappy.
  const motion = useMotion();
  const { springTo } = motion;
  const held = useSharedValue(forced?.pressed ? 1 : 0);
  const isLow = kind === 'low';

  const pan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    hitSlop: THUMB_SLOP,
    testID: testID ? `${testID}.pan` : undefined,
    onBegin: () => {
      'worklet';
      dragging.set(true);
      held.set(springTo(1));
      start.set(own.get());
    },
    onUpdate: (event) => {
      'worklet';
      const travel = Math.max(0, width.get() - THUMB);
      const offset = valueToOffset(start.get(), travel, min, max) + event.translationX;
      const raw = offsetToValue(offset, travel, min, max);
      const next = isLow ? clampLow(raw, other.get(), min, max, step) : clampHigh(raw, other.get(), min, max, step);
      if (next !== own.get()) {
        own.set(next);
        scheduleOnRN(onStep, next);
      }
    },
    onFinalize: () => {
      'worklet';
      dragging.set(false);
      held.set(springTo(0));
      if (own.get() === start.get()) return;
      scheduleOnRN(onEnd, isLow ? own.get() : other.get(), isLow ? other.get() : own.get());
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: valueToOffset(own.get(), Math.max(0, width.get() - THUMB), min, max) }],
  }));
  const visualStyle = useAnimatedStyle(() => ({
    opacity: interpolate(held.get(), [0, 1], [1, motionTokens.press.opacity]),
    transform: [{ scale: interpolate(held.get(), [0, 1], [1, motionTokens.press.scale]) }],
  }));

  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    if (disabled) return;
    let next: number | undefined;
    switch (keyOf(event)) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - step;
        break;
      case 'PageUp':
        next = value + step * PAGE_STEPS;
        break;
      case 'PageDown':
        next = value - step * PAGE_STEPS;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault?.();
    onAdjust(snapValue(next, min, max, step));
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    if (event.nativeEvent.actionName === 'increment') onAdjust(snapValue(value + step, min, max, step));
    if (event.nativeEvent.actionName === 'decrement') onAdjust(snapValue(value - step, min, max, step));
  };

  return (
    <GestureDetector gesture={pan} touchAction="none">
      <Animated.View
        role="slider"
        accessible
        aria-label={label}
        aria-disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display(value)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAccessibilityAction}
        tabIndex={disabled ? -1 : 0}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
        testID={testID}
        style={[styles.thumb, styles.noOutline, raised ? styles.raised : null, animatedStyle]}
        {...({ onKeyDown } as object)}
      >
        {isWeb ? <HitArea slopX={THUMB_SLOP} slopY={THUMB_SLOP} /> : null}
        <Animated.View style={[styles.thumbVisual, disabled ? styles.disabledFill : null, focus.ringStyle, visualStyle]} />
      </Animated.View>
    </GestureDetector>
  );
}

function NumberField({
  label,
  suffix,
  value,
  disabled,
  onCommit,
  testID,
}: {
  label: string;
  suffix: string | undefined;
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
  testID: string | undefined;
}) {
  const styles = useStyles();
  const [draft, setDraft] = useState<string | null>(null);
  const { locale } = useFormat();

  const commit = () => {
    if (draft !== null) {
      const parsed = parseNumber(draft, locale);
      if (Number.isFinite(parsed)) onCommit(parsed);
    }
    setDraft(null);
  };

  return (
    <TextInput
      label={label}
      suffix={suffix}
      value={draft ?? String(value)}
      disabled={disabled}
      keyboardType="number-pad"
      inputMode="numeric"
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      containerStyle={styles.input}
      testID={testID}
    />
  );
}
