import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { View, type DimensionValue, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isAndroid, isWeb } from '@/lib/platform';
import { concentric, createStyles, space, useTheme } from '@/theme';

import { useMotionPreference } from './motion';
import type { Rect } from './motion/math';
import { endsWord, joinLabel } from './rowParts';
import { Text } from './Text';

export type ChatBubbleProps = {
  text?: string;
  /** Own messages sit right on bg.inverse; others left on bg.raised. */
  own?: boolean;
  /**
   * 09 §7.8 grouping, no tails: inside a group the corners on the sender's side where two bubbles meet reduce to the joined
   * radius (`concentric(bubble.radius, padding 12 + gap 2)` = 6). `groupStart` is the oldest (top) bubble, `groupEnd` the newest.
   */
  groupStart?: boolean;
  groupEnd?: boolean;
  /** v1 prop, ignored: 2.0 bubbles have no tail (09 §7.8). Kept so callers outside messaging keep compiling. */
  tail?: boolean;
  /** Time, shown under the group: "14:32". */
  time?: string;
  /** Who wrote it, for screen readers: "Du", "Lukas". */
  senderLabel?: string;
  /** Message send: fades in (effect.default); with `enterFrom` it morphs from the composer (SM12), else it rises 8. */
  animateIn?: boolean;
  /**
   * SM12 send morph: the composer text's window rect at the moment of sending. The new bubble starts there (translate + scale
   * towards its own rect, spring.default) and settles in its list position. Reduced motion: the crossfade only.
   */
  enterFrom?: Rect | null;
  /**
   * The bubble sits in an inverted FlashList, whose cells are mirrored (scaleY −1 on iOS and web, rotate 180° on Android), so the
   * morph's window offsets are mirrored back.
   */
  invertedList?: boolean;
  /** Content above the text, for example a shared photo or vehicle. */
  children?: ReactNode;
  /**
   * The bubble takes the full width of its group instead of its content's: for a photo or vehicle, whose width comes from the
   * group (an image with only an aspect ratio has no width of its own, and in a group aligned to one side it would get none).
   */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const PERCENT = 100;
/**
 * DQ-939 / CARRY-M4.12-18: from this font scale a bubble may take the whole column. At 75 % a member's long word ("Mönchengladbach",
 * 264 px at 393 fs2) is wider than the line and could only break anywhere, since member text is never hyphenated (DQ-428).
 */
export const WIDE_BUBBLE_SCALE = 1.5;

/** Web: a token wider than the bubble breaks inside itself rather than leave it; native wraps such a token by itself. */
const LONG_TOKEN_BREAK = (isWeb ? { overflowWrap: 'anywhere' } : {}) as TextStyle;

const useStyles = createStyles((t) => ({
  group: { maxWidth: `${t.bubble.maxWidthRatio * PERCENT}%` as DimensionValue },
  groupOwn: { alignItems: 'flex-end', alignSelf: 'flex-end' },
  groupOther: { alignItems: 'flex-start', alignSelf: 'flex-start' },
  bubble: {
    borderRadius: t.bubble.radius,
    gap: t.space[8],
    paddingHorizontal: t.space[12],
    paddingVertical: t.space[8],
  },
  fill: { alignSelf: 'stretch' },
  groupWide: { maxWidth: '100%' as DimensionValue },
  // 09 §4.1 roles: `bubble.own` (deep accent tint) and `bubble.other` (surface-2), never the inverse fill.
  own: { backgroundColor: t.color.bubble.ownBg },
  other: { backgroundColor: t.color.bubble.otherBg },
  joinTopOwn: { borderTopRightRadius: joined(t) },
  joinBottomOwn: { borderBottomRightRadius: joined(t) },
  joinTopOther: { borderTopLeftRadius: joined(t) },
  joinBottomOther: { borderBottomLeftRadius: joined(t) },
  time: { marginTop: t.space[4] },
}));

/** The joined corner: concentric to the bubble radius across its 12 padding and the 2 gap between grouped bubbles (= 6). */
function joined(t: { bubble: { radius: number }; space: Record<2 | 12, number> }): number {
  return concentric(t.bubble.radius, t.space[12] + t.space[2]);
}

/**
 * What a screen reader gets for the bubble. On web the group is only named: its text stays readable inside it. On native
 * `accessible` merges the children into one element whose label replaces their text, so the label carries all of it.
 * A bubble with content cannot merge, because that would hide a shared photo or vehicle: there the text names the sender.
 */
function groupProps(senderLabel: string | undefined, text: string | undefined, time: string | undefined, merge: boolean) {
  if (!senderLabel) return {};
  if (isWeb) return { role: 'group' as const, 'aria-label': senderLabel };
  return merge ? { accessible: true, role: 'group' as const, 'aria-label': joinLabel([senderLabel, text, time]) } : {};
}

/**
 * Chat bubble 2.0 (09 §7.8): at most 75 % wide (bubble.maxWidthRatio; the whole column from font scale 1.5), radius 20, grouped
 * corners 6 on the sender's side, `bubble.own` / `bubble.other`, no tails, `body`.
 */
export function ChatBubble({
  text,
  own = false,
  groupStart = true,
  groupEnd = true,
  time,
  senderLabel,
  animateIn = false,
  enterFrom = null,
  invertedList = false,
  children,
  fill = false,
  style,
  testID,
}: ChatBubbleProps) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const wide = useTheme().fontScale >= WIDE_BUBBLE_SCALE;
  const entrance = useSharedValue(animateIn ? 0 : 1);
  // SM12: the offset and scale from the composer rect to this bubble's rect, settled to 0 / 1 on spring.default.
  const dx = useSharedValue(0);
  const dy = useSharedValue(animateIn && !enterFrom && !motion.reduced ? space[8] : 0);
  const scale = useSharedValue(1);
  const node = useRef<ComponentRef<typeof Animated.View>>(null);
  const morph = animateIn && enterFrom !== null && !motion.reduced;

  useEffect(() => {
    if (!animateIn) return;
    entrance.set(motion.effectTo(1, 'default'));
    if (!morph) dy.set(motion.springTo(0, 'default'));
  }, [animateIn, dy, entrance, morph, motion]);

  const onLayout = () => {
    if (!morph || !enterFrom) return;
    node.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      const start = sendMorphStart(enterFrom, { x, y, width, height });
      const mirror = invertedListMirror(invertedList);
      dx.set(start.dx * mirror.x);
      dy.set(start.dy * mirror.y);
      scale.set(start.scale);
      dx.set(motion.springTo(0, 'default'));
      dy.set(motion.springTo(0, 'default'));
      scale.set(motion.springTo(1, 'default'));
    });
  };

  const animated = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateX: dx.get() }, { translateY: dy.get() }, { scale: scale.get() }],
  }));

  const joins = own
    ? [groupStart ? null : styles.joinTopOwn, groupEnd ? null : styles.joinBottomOwn]
    : [groupStart ? null : styles.joinTopOther, groupEnd ? null : styles.joinBottomOther];

  return (
    <Animated.View
      ref={node}
      {...groupProps(senderLabel, text, time, !children)}
      testID={testID}
      onLayout={morph ? onLayout : undefined}
      style={[styles.group, wide ? styles.groupWide : null, own ? styles.groupOwn : styles.groupOther, animated, style]}
    >
      <View
        style={[styles.bubble, own ? styles.own : styles.other, ...joins, fill ? styles.fill : null]}
        testID={testID ? `${testID}.bubble` : undefined}
      >
        {children}
        {text ? (
          <Text
            variant="body"
            color={own ? 'bubble.ownText' : 'bubble.otherText'}
            // DQ-428: a member's own words are never hyphenated; only a token wider than the bubble (a URL) breaks, anywhere.
            hyphenate={false}
            style={LONG_TOKEN_BREAK}
            selectable
            aria-label={!isWeb && children && senderLabel ? joinLabel([senderLabel, text]) : undefined}
          >
            {/* The bubble and the time are separate boxes: "um 10" over "13:32" must not read "um 1013:32" (WCAG 2.5.3). */}
            {endsWord(text, Boolean(time))}
          </Text>
        ) : null}
      </View>
      {time ? (
        <Text variant="caption" color="text.secondary" style={styles.time} testID={testID ? `${testID}.time` : undefined}>
          {time}
        </Text>
      ) : null}
    </Animated.View>
  );
}

/**
 * SM12: where the new bubble starts, relative to its own rect: centred on the composer text and scaled to its width (never above
 * 1, never below a third, so a one-word bubble from a long draft does not shrink to a dot). Pure, for the tests.
 */
export function sendMorphStart(from: Rect, to: Rect): { dx: number; dy: number; scale: number } {
  const ratio = to.width > 0 ? from.width / to.width : 1;
  const scale = Math.min(1, Math.max(1 / 3, ratio));
  return {
    dx: from.x + from.width / 2 - (to.x + to.width / 2),
    dy: from.y + from.height / 2 - (to.y + to.height / 2),
    scale,
  };
}

/** How an inverted FlashList mirrors its cells: scaleY −1 (iOS, web) or rotate 180° (Android, which flips x as well). */
export function invertedListMirror(inverted: boolean, android: boolean = isAndroid): { x: 1 | -1; y: 1 | -1 } {
  if (!inverted) return { x: 1, y: 1 };
  return { x: android ? -1 : 1, y: -1 };
}
