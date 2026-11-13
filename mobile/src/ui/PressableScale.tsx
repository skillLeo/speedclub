import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type KeyDownEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { createStyles, motion as motionTokens, size } from '@/theme';

import { useMotionPreference } from './motion';
import { useForcedVisualState } from './qaVisualState';
import { NO_BROWSER_OUTLINE, useFocusRing, type RingTone } from './useFocusRing';

export type PressableVisualState = { pressed: boolean; hovered: boolean; focused: boolean };
type StateStyle = StyleProp<ViewStyle> | ((state: PressableVisualState) => StyleProp<ViewStyle>);

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children' | 'hitSlop'> & {
  children?: ReactNode | ((state: PressableVisualState) => ReactNode);
  /** The Pressable itself: the layout box and the target. It does not scale. */
  style?: StateStyle;
  /** The visual inside the target. It scales, and it carries the focus ring. */
  contentStyle?: StateStyle;
  /** QA markers on the visual, see `contentStyle`. */
  contentDataSet?: Record<string, string>;
  /** False removes scale and tone shift, for example while a button is loading. */
  feedback?: boolean;
  /**
   * The 6 % tone shift of SM7: a `state.pressed` layer over the visual while it is pressed. False when the component draws its
   * own pressed fill (the accent fill's `fillPressed`, a parent shell's tone), so the tone never doubles.
   */
  toneShift?: boolean;
  /** `inverse` on a `bg.inverse` fill (primary button, selected chip): the layer is `state.pressedInverse` (ADR-421 c). */
  tone?: PressTone;
  /** Height of a visual below 44: adds a real hit area up to 44, also on web, which ignores `hitSlop`. */
  visualHeight?: number;
  /** Width of a visual below 44. */
  visualWidth?: number;
  /** `none` when a smaller child draws the ring itself, from `state.focused`. */
  ring?: RingTone | 'none';
  ref?: Ref<ComponentRef<typeof View>>;
};

function resolve(style: StateStyle, state: PressableVisualState): StyleProp<ViewStyle> {
  return typeof style === 'function' ? style(state) : style;
}

function slopFor(visual: number | undefined): number {
  return visual === undefined ? 0 : Math.max(0, (size.touchMin - visual) / 2);
}

// The target itself never draws focus: the ring belongs to the shaped visual, and the browser's own outline on the
// square 44 box would show around it.
const styles = StyleSheet.create({ target: NO_BROWSER_OUTLINE, fill: { flexGrow: 1 }, hitArea: { position: 'absolute' } });

export type PressTone = 'default' | 'inverse';

const useToneStyles = createStyles((t) => ({
  // Above the content, so a photo tile shifts too; it never takes a touch.
  default: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.pressed, pointerEvents: 'none' },
  inverse: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.pressedInverse, pointerEvents: 'none' },
}));

const RADIUS_KEYS = [
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderTopStartRadius',
  'borderTopEndRadius',
  'borderBottomStartRadius',
  'borderBottomEndRadius',
] as const;

/** The corners of the visual, so the tone layer has the same shape (a pill stays a pill). */
export function cornersOf(visual: ViewStyle | undefined): ViewStyle {
  const corners: Record<string, unknown> = {};
  if (!visual) return corners;
  for (const key of RADIUS_KEYS) if (visual[key] !== undefined) corners[key] = visual[key];
  return corners as ViewStyle;
}

/**
 * The shape of the tone layer: the visual's corners, and over its border too. A fill reaches under the border (a transparent
 * one included), so a layer inside it would leave a 1 rim of the resting tone around a pressed button or chip.
 */
export function toneShapeOf(visual: ViewStyle | undefined): ViewStyle {
  const corners = cornersOf(visual);
  const border = typeof visual?.borderWidth === 'number' ? visual.borderWidth : 0;
  return border > 0 ? { ...corners, top: -border, right: -border, bottom: -border, left: -border } : corners;
}

/**
 * SM7 tone (ADR-421 c): its own value, faded on effect.fast (critically damped), never on the press spring, whose ζ 0.6 would
 * overshoot a colour. `pressIn` / `pressOut` drive it; a QA `pressed` state starts it shown.
 */
export function usePressTone(initiallyPressed: boolean) {
  const motion = useMotionPreference();
  const value = useSharedValue(initiallyPressed ? 1 : 0);
  const style = useAnimatedStyle(() => ({ opacity: value.get() }));
  return {
    style,
    pressIn: () => value.set(motion.effectTo(1, 'fast')),
    pressOut: () => value.set(motion.effectTo(0, 'fast')),
  };
}

export type PressToneLayerProps = {
  tone?: PressTone;
  /** From `usePressTone`. */
  animatedStyle: ReturnType<typeof usePressTone>['style'];
  /** The visual the layer covers, for its corners and border (`toneShapeOf`). */
  shape?: ViewStyle;
};

/**
 * Marks the tone layer (`data-press-tone` on web), so a test can find it without a test ID: the layer is decorative, and a
 * `<control>.tone` test ID would extend the control's prefix, so flows that list controls by prefix would count it as one.
 */
export const PRESS_TONE_DATASET = { pressTone: 'layer' } as const;

/**
 * The SM7 tone layer, for a press base or for a shell that draws the tone of the targets inside it (removable Chip). Decorative:
 * hidden from assistive technology and without a test ID (see PRESS_TONE_DATASET).
 */
export function PressToneLayer({ tone = 'default', animatedStyle, shape }: PressToneLayerProps) {
  const styles = useToneStyles();
  return <Animated.View aria-hidden dataSet={PRESS_TONE_DATASET} style={[styles[tone], toneShapeOf(shape), animatedStyle]} />;
}

/**
 * BUG-2: whether the visual grows to the target's height. It only may when that height comes from outside: a target that
 * stretches (the default `alignSelf`), or one with its own `height`, `flex` or `flexGrow`.
 *
 * A target that hugs its content (`alignSelf` flex-start, center, end, baseline, as Button does) must not carry a growing
 * child. Yoga, as React Native 0.88 configures it (`YGErrataAll`, which includes `StretchFlexBasis`), measures an auto-height
 * child of a column with the column's whole inner height as an at-most limit (CalculateLayout.cpp, computeFlexBasisForChild),
 * and because the hugging target's width is not exact either, that measure runs the flex step: the errata keeps the
 * "size from content" shortcut off, so the free space up to the limit goes to a `flexGrow: 1` child. The target then reports
 * the column's whole height as its own, and everything after it moves down by that height (VEH-01 on Android: the header
 * action spanned the screen, the title sat centred far below it). Browsers size such a box from its content, so web is unchanged.
 */
export function visualFills(target: ViewStyle | undefined): boolean {
  if (!target) return true;
  if (target.height !== undefined || target.flex !== undefined || target.flexGrow !== undefined) return true;
  const align = target.alignSelf;
  return align === undefined || align === 'auto' || align === 'stretch';
}

/** The WAI-ARIA patterns in which Space checks, selects or switches the focused control. */
const SPACE_ROLES: ReadonlySet<string> = new Set(['checkbox', 'radio', 'switch']);

const isSpaceKey = (key: string) => key === ' ' || key === 'Spacebar';

/**
 * The shared press base, SM7 (09 §4.7): scale 0.97 on spring.fast plus the tone shift through the `state.pressed` layer
 * (`state.pressedInverse` on an inverse fill), which fades on effect.fast (ADR-421 c). Never opacity: an opacity-only press is banned (DL13). Under reduced motion the scale settles with the effect.default
 * crossfade; `qaMotion=off` jumps.
 *
 * On web, react-native-web turns Enter into a press for every role but Space only for role `button` (PressResponder
 * `isValidKeyPress`). A checkbox, radio or switch therefore presses on Space here, once per key press.
 *
 * react-native-web also leaves Enter on `role="link"` to the browser, as for a native anchor. Without an `href` it renders a
 * `<div role="link">`, which no browser activates, so such a link presses on Enter here (WCAG 2.1.1; M2.3 test round, F2).
 * A link with an `href` stays with the browser.
 */
export function PressableScale({
  children,
  style,
  contentStyle,
  contentDataSet,
  feedback = true,
  toneShift = true,
  tone = 'default',
  visualHeight,
  visualWidth,
  ring = 'default',
  disabled,
  role,
  onPress,
  onKeyDown,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  ref,
  ...rest
}: PressableScaleProps) {
  const motion = useMotionPreference();
  const focus = useFocusRing(ring === 'none' ? 'default' : ring);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const forced = useForcedVisualState();
  const press = useSharedValue(forced?.pressed && feedback ? 1 : 0);
  const toneLayer = usePressTone(Boolean(forced?.pressed && feedback));

  // The press spring moves only the scale; the tone has its own effect value (usePressTone).
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(press.get(), [0, 1], [1, motionTokens.press.scale]) }],
  }));

  const state: PressableVisualState = {
    pressed: (pressed || (forced?.pressed ?? false)) && !disabled,
    hovered: (hovered || (forced?.hovered ?? false)) && !disabled,
    focused: focus.focused,
  };
  const targetStyle = resolve(style, state);
  const visualStyle = resolve(contentStyle, state);
  const fills = visualFills(StyleSheet.flatten(targetStyle) ?? undefined);
  const slopY = slopFor(visualHeight);
  const slopX = slopFor(visualWidth);
  const hasSlop = slopX > 0 || slopY > 0;

  // Native keeps its own handling: no key handler is added there.
  const spacePresses = isWeb && role != null && SPACE_ROLES.has(role);
  const enterPresses = isWeb && role === 'link' && !('href' in rest && (rest as { href?: unknown }).href);
  const handleKeyDown =
    spacePresses || enterPresses
      ? (event: KeyDownEvent) => {
          const { key, repeat, altKey, ctrlKey, metaKey, shiftKey } = event.nativeEvent;
          // Only the control's own key: not one from a child, a shortcut, or a key an earlier handler took already.
          // Clicks, and Enter on every other role, stay with react-native-web, so nothing presses twice.
          const own = event.target === event.currentTarget && !event.defaultPrevented;
          const plain = !altKey && !ctrlKey && !metaKey;
          if (own && plain && !disabled && onPress) {
            if (spacePresses && isSpaceKey(key)) {
              // Space would scroll the page.
              event.preventDefault();
              event.stopPropagation();
              // A held key repeats keydown: the control changes once per press.
              if (!repeat) onPress(event as unknown as GestureResponderEvent);
            } else if (enterPresses && key === 'Enter' && !shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              if (!repeat) onPress(event as unknown as GestureResponderEvent);
            }
          }
          onKeyDown?.(event);
        }
      : onKeyDown;

  return (
    <Pressable
      ref={ref}
      role={role}
      disabled={disabled}
      onPress={onPress}
      onKeyDown={handleKeyDown}
      hitSlop={!isWeb && hasSlop ? { top: slopY, bottom: slopY, left: slopX, right: slopX } : undefined}
      onPressIn={(event) => {
        setPressed(true);
        if (feedback) {
          press.set(motion.springTo(1, motionTokens.press.spring));
          toneLayer.pressIn();
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        press.set(motion.springTo(0, motionTokens.press.spring));
        toneLayer.pressOut();
        onPressOut?.(event);
      }}
      onHoverIn={(event) => {
        if (isWeb) setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      onFocus={(event) => {
        focus.onFocus(event);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focus.onBlur();
        onBlur?.(event);
      }}
      style={[styles.target, targetStyle]}
      {...rest}
    >
      {isWeb && hasSlop ? <HitArea slopX={slopX} slopY={slopY} /> : null}
      <Animated.View
        dataSet={contentDataSet}
        style={[fills ? styles.fill : null, visualStyle, ring === 'none' ? null : focus.ringStyle, animatedStyle]}
      >
        {typeof children === 'function' ? children(state) : children}
        {toneShift && feedback ? (
          <PressToneLayer
            tone={tone}
            animatedStyle={toneLayer.style}
            shape={StyleSheet.flatten(visualStyle) ?? undefined}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/** Invisible child that reaches 44. The DOM audit and the browser both count it as part of the Pressable. */
export function HitArea({ slopX = 0, slopY = 0 }: { slopX?: number; slopY?: number }) {
  return <View style={[styles.hitArea, { top: -slopY, bottom: -slopY, left: -slopX, right: -slopX }]} />;
}
