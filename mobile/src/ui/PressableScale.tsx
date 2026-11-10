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
import { motion as motionTokens, size, useMotion } from '@/theme';

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
  /** False removes scale and opacity, for example while a button is loading. */
  feedback?: boolean;
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
const styles = StyleSheet.create({ target: NO_BROWSER_OUTLINE, content: { flexGrow: 1 }, hitArea: { position: 'absolute' } });

/** The WAI-ARIA patterns in which Space checks, selects or switches the focused control. */
const SPACE_ROLES: ReadonlySet<string> = new Set(['checkbox', 'radio', 'switch']);

const isSpaceKey = (key: string) => key === ' ' || key === 'Spacebar';

/**
 * The shared press base (03_DESIGN_SYSTEM.md §10): scale 0.98 + opacity 0.92 with spring.snappy.
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
  const motion = useMotion();
  const focus = useFocusRing(ring === 'none' ? 'default' : ring);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const forced = useForcedVisualState();
  const press = useSharedValue(forced?.pressed && feedback ? 1 : 0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(press.get(), [0, 1], [1, motionTokens.press.opacity]),
    transform: [{ scale: interpolate(press.get(), [0, 1], [1, motionTokens.press.scale]) }],
  }));

  const state: PressableVisualState = {
    pressed: (pressed || (forced?.pressed ?? false)) && !disabled,
    hovered: (hovered || (forced?.hovered ?? false)) && !disabled,
    focused: focus.focused,
  };
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
        if (feedback) press.set(motion.springTo(1));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        press.set(motion.springTo(0));
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
      style={[styles.target, resolve(style, state)]}
      {...rest}
    >
      {isWeb && hasSlop ? <HitArea slopX={slopX} slopY={slopY} /> : null}
      <Animated.View
        dataSet={contentDataSet}
        style={[styles.content, resolve(contentStyle, state), ring === 'none' ? null : focus.ringStyle, animatedStyle]}
      >
        {typeof children === 'function' ? children(state) : children}
      </Animated.View>
    </Pressable>
  );
}

/** Invisible child that reaches 44. The DOM audit and the browser both count it as part of the Pressable. */
export function HitArea({ slopX = 0, slopY = 0 }: { slopX?: number; slopY?: number }) {
  return <View style={[styles.hitArea, { top: -slopY, bottom: -slopY, left: -slopX, right: -slopX }]} />;
}
