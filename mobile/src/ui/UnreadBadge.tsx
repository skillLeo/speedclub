import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space } from '@/theme';

import { Text } from './Text';

export type UnreadBadgeProps = {
  /** Without a count the badge is the 8 dot. Zero renders nothing. */
  count?: number;
  /** Accessible name of the dot, or a replacement for the "{{count}} unread" string. */
  label?: string;
  /** For a control whose own accessible name already says the count: the pill is then only what it looks like. */
  decorative?: boolean;
  /** The largest figure shown; above it the pill says "{max}+" (99 by default; the header's Nachrichten pill says "9+", 10 §1). */
  max?: number;
  /** `neutral` for a count that asks for no attention, a muted conversation's (DQ-M52-17): bg.raised with text.secondary. */
  tone?: 'accent' | 'neutral';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const MAX_COUNT = 99;

/** What the pill shows, so a control can say the same in its name: "99+" above 99. */
export function unreadCountText(count: number, max: number = MAX_COUNT): string {
  return count > max ? `${max}+` : String(count);
}

/** DQ-M52-01: the pill's start on a 44 icon button, 4 inside the glyph's right edge. */
const PILL_LEFT = size.iconButton / 2 + space[8];
/** The furthest the pill's end may reach: the button's end plus the header's end padding on phones (gutter 20 − 12). */
const PILL_END_LIMIT = size.iconButton + space[8];

const useStyles = createStyles((t) => ({
  // DQ-M52-01: on a 44 icon button the badge sits on the glyph's top-right corner and grows rightwards into the target's spare
  // room, so a "9+" never covers more of the glyph. The ring in the header's ground cuts it out of the glyph (Instagram's pattern).
  ring: {
    backgroundColor: t.color.bg.canvas,
    borderRadius: t.radius.full,
    padding: t.space[2],
    pointerEvents: 'none',
    position: 'absolute',
  },
  // DQ-M52-01 round 2: on the glyph's corner, outside its ink (the paper plane's nose reaches the top right): the pill starts 4 px
  // inside the glyph's right edge and may reach into the gutter, as Instagram's does.
  ringPill: { left: PILL_LEFT, top: -t.space[2] },
  ringDot: { left: t.size.iconButton / 2 + t.space[4], top: t.space[4] },
  dot: {
    backgroundColor: t.color.accent.fill,
    borderRadius: t.radius.full,
    height: t.size.unreadDot,
    width: t.size.unreadDot,
  },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.color.accent.fill,
    borderRadius: t.radius.full,
    justifyContent: 'center',
    minHeight: t.size.unreadPill,
    minWidth: t.size.unreadPill,
    paddingHorizontal: t.space[4],
  },
  pillNeutral: { backgroundColor: t.color.bg.raised },
}));

/** §8 unread badge: dot 8 or pill 18 high, accent.fill + white `label.badge`, "99+" above 99. */
export function UnreadBadge({ count, label, decorative = false, max = MAX_COUNT, tone = 'accent', style, testID }: UnreadBadgeProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();

  if (count === undefined) {
    return (
      <View
        accessible={Boolean(label)}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={!label}
        testID={testID}
        style={[styles.dot, style]}
      />
    );
  }
  if (count <= 0) return null;

  return (
    <View
      accessible={!decorative}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (label ?? t('a11y.unreadCount', { count }))}
      aria-hidden={decorative}
      testID={testID}
      style={[styles.pill, tone === 'neutral' ? styles.pillNeutral : null, style]}
    >
      <Text variant="labelBadge" numeric color={tone === 'neutral' ? 'text.secondary' : 'text.onAccent'} selectable={false}>
        {unreadCountText(count, max)}
      </Text>
    </View>
  );
}

export type IconButtonBadgeProps = {
  /** As UnreadBadge: without a count the 8 dot. */
  count?: number;
  max?: number;
  testID?: string;
};

/**
 * The unread badge of a header icon button (Header, BrandHeader): a pill on the glyph's top-right corner that grows rightwards, or the
 * dot there, ringed in the header's ground. Always decorative: the button's own name says the unread state.
 */
export function IconButtonBadge({ count, max, testID }: IconButtonBadgeProps) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  if (count !== undefined && count <= 0) return null;
  // p5r1 capture (HOME-01 at 200 %): a wide pill ("9+" at the 1.3 cap) on the last header button ran 9 px past the screen and made the
  // page scroll sideways. It keeps its DQ-M52-01 place, but its end never passes the header's 8 end padding beyond the button.
  const clamp = count !== undefined && width > 0 ? { left: Math.min(PILL_LEFT, PILL_END_LIMIT - width) } : null;
  return (
    <View
      style={[styles.ring, count === undefined ? styles.ringDot : styles.ringPill, clamp]}
      onLayout={count === undefined ? undefined : (event) => setWidth(Math.ceil(event.nativeEvent.layout.width))}
      aria-hidden
    >
      <UnreadBadge count={count} max={max} decorative testID={testID} />
    </View>
  );
}
