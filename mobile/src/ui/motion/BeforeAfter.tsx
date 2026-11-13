import { useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type KeyDownEvent, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isWeb } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { motion as motionTokens } from '@/theme/tokens.generated';

import { Photo, type PhotoAspect, type PhotoFields } from '../Photo';
import { useFocusRing } from '../useFocusRing';
import { hapticFor } from './haptics';
import { clamp01, dividerPosition, wipeOffsets } from './math';
import { useMotionPreference } from './preference';

const BA = motionTokens.signature.beforeAfter;
const PERCENT = 100;
const HIT = size.touchMin;

const useStyles = createStyles((t) => ({
  root: { overflow: 'hidden' },
  layer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  handle: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: -HIT / 2, position: 'absolute', top: 0, width: HIT },
  line: { backgroundColor: t.color.onPhoto.primary, bottom: 0, position: 'absolute', top: 0, width: t.size.border.focusRing },
  knob: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderColor: t.color.onPhoto.primary,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.focusRing,
    height: t.size.avatar.md,
    width: t.size.avatar.md,
  },
}));

export type BeforeAfterProps = {
  before: PhotoFields & { label: string };
  after: PhotoFields & { label: string };
  aspect: PhotoAspect;
  /** "Vorher / Nachher-Vergleich" from the caller's namespace; the value is read as a percentage. */
  label: string;
  testID: string;
};

/**
 * SM17 before/after slider (09 §4.7, build updates): the "after" photo lies over the "before" one and is clipped at a
 * draggable divider; the clip follows the finger on the UI thread (a transform mask, no width animates), a light haptic when
 * the handle is grabbed. The handle's hit area is 44 wide over the full height. It is an adjustable control: screen readers
 * swipe up/down, the keyboard uses the arrow keys (5 % per step). Reduced motion changes nothing: the divider moves only
 * with the finger or a key.
 */
export function BeforeAfter({ before, after, aspect, label, testID }: BeforeAfterProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const ring = useFocusRing();
  const [width, setWidth] = useState(0);
  const [value, setValue] = useState<number>(BA.start);
  const position = useSharedValue<number>(BA.start);
  const start = useSharedValue<number>(BA.start);

  const setTo = (next: number) => {
    const clamped = clamp01(next);
    setValue(clamped);
    position.set(motion.springTo(clamped, 'fast'));
  };

  const pan = usePanGesture({
    minDistance: 0,
    testID: `${testID}.pan`,
    onBegin: () => {
      'worklet';
      start.set(position.get());
      scheduleOnRN(hapticFor, 'swipeActionThreshold');
    },
    onUpdate: (event) => {
      'worklet';
      position.set(dividerPosition(start.get(), event.translationX, width));
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(setValue, position.get());
    },
  });

  // The "after" photo is uncovered from the right edge: at 0.5 its right half shows.
  const clipOuter = useAnimatedStyle(() => ({ transform: [{ translateX: wipeOffsets(1 - position.get(), width, 'end').outer }] }));
  const clipInner = useAnimatedStyle(() => ({ transform: [{ translateX: wipeOffsets(1 - position.get(), width, 'end').inner }] }));
  const handleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() * width }] }));

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') setTo(value + BA.keyStep);
    if (event.nativeEvent.actionName === 'decrement') setTo(value - BA.keyStep);
  };
  const onKeyDown = (event: KeyDownEvent) => {
    const key = event.nativeEvent.key;
    if (key === 'ArrowRight' || key === 'ArrowUp') setTo(value + BA.keyStep);
    else if (key === 'ArrowLeft' || key === 'ArrowDown') setTo(value - BA.keyStep);
    else if (key === 'Home') setTo(0);
    else if (key === 'End') setTo(1);
    else return;
    event.preventDefault?.();
  };
  const percent = Math.round(value * PERCENT);

  return (
    <View style={styles.root} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} testID={testID}>
      <Photo aspect={aspect} {...before} />
      <Animated.View style={[styles.layer, clipOuter]}>
        <Animated.View style={[StyleSheet.absoluteFill, clipInner]}>
          <Photo aspect={aspect} {...after} />
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan} touchAction="pan-y" userSelect="none">
        <Animated.View
          accessible
          role="slider"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={PERCENT}
          aria-valuenow={percent}
          aria-valuetext={`${percent} %`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
          {...(isWeb ? { tabIndex: 0 as const, onKeyDown, onFocus: ring.onFocus, onBlur: ring.onBlur } : {})}
          style={[styles.handle, handleStyle]}
          testID={`${testID}.handle`}
        >
          <View style={styles.line} />
          <View style={[styles.knob, ring.ringStyle]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
