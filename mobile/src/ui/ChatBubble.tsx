import { useEffect, type ReactNode } from 'react';
import { View, type DimensionValue, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { createStyles, space, useMotion } from '@/theme';

import { endsWord, joinLabel } from './rowParts';
import { Text } from './Text';

export type ChatBubbleProps = {
  text?: string;
  /** Own messages sit right on bg.inverse; others left on bg.raised. */
  own?: boolean;
  /** The last bubble of a group: the corner towards the sender becomes the tail. */
  tail?: boolean;
  /** Time, shown under the group: "14:32". */
  time?: string;
  /** Who wrote it, for screen readers: "Du", "Lukas". */
  senderLabel?: string;
  /** Message send (§10): rises 8 and fades in over 200 ms. */
  animateIn?: boolean;
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

/** Web: a token wider than the bubble breaks inside itself rather than leave it; native wraps such a token by itself. */
const LONG_TOKEN_BREAK = (isWeb ? { overflowWrap: 'anywhere' } : {}) as TextStyle;

const useStyles = createStyles((t) => ({
  group: { maxWidth: `${t.size.chatBubbleMaxWidthRatio * PERCENT}%` as DimensionValue },
  groupOwn: { alignItems: 'flex-end', alignSelf: 'flex-end' },
  groupOther: { alignItems: 'flex-start', alignSelf: 'flex-start' },
  bubble: {
    borderRadius: t.size.bubbleRadius,
    gap: t.space[8],
    paddingHorizontal: t.space[12],
    paddingVertical: t.space[8],
  },
  fill: { alignSelf: 'stretch' },
  own: { backgroundColor: t.color.bg.inverse },
  other: { backgroundColor: t.color.bg.raised },
  tailOwn: { borderBottomRightRadius: t.size.bubbleTailRadius },
  tailOther: { borderBottomLeftRadius: t.size.bubbleTailRadius },
  time: { marginTop: t.space[4] },
}));

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

/** §8 chat bubble: at most 75 % wide, radius 16 with 4 on the tail corner, `body.dense`. */
export function ChatBubble({ text, own = false, tail = true, time, senderLabel, animateIn = false, children, fill = false, style, testID }: ChatBubbleProps) {
  const styles = useStyles();
  const motion = useMotion();
  const entrance = useSharedValue(animateIn ? 0 : 1);
  // Reduced motion leaves the crossfade: no rise.
  const rise = motion.reduced ? 0 : space[8];

  useEffect(() => {
    if (animateIn) entrance.set(motion.timingTo(1, 'small', 'decelerate'));
  }, [animateIn, entrance, motion]);

  const animated = useAnimatedStyle(() => ({
    opacity: entrance.get(),
    transform: [{ translateY: (1 - entrance.get()) * rise }],
  }));

  return (
    <Animated.View
      {...groupProps(senderLabel, text, time, !children)}
      testID={testID}
      style={[styles.group, own ? styles.groupOwn : styles.groupOther, animated, style]}
    >
      <View
        style={[styles.bubble, own ? styles.own : styles.other, tail ? (own ? styles.tailOwn : styles.tailOther) : null, fill ? styles.fill : null]}
        testID={testID ? `${testID}.bubble` : undefined}
      >
        {children}
        {text ? (
          <Text
            variant="bodyDense"
            color={own ? 'text.inverse' : 'text.primary'}
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
        <Text variant="caption" color="text.tertiary" style={styles.time} testID={testID ? `${testID}.time` : undefined}>
          {time}
        </Text>
      ) : null}
    </Animated.View>
  );
}
