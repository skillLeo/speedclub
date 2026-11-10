import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';

import { Text } from './Text';

export type UnreadBadgeProps = {
  /** Without a count the badge is the 8 dot. Zero renders nothing. */
  count?: number;
  /** Accessible name of the dot, or a replacement for the "{{count}} unread" string. */
  label?: string;
  /** For a control whose own accessible name already says the count: the pill is then only what it looks like. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const MAX_COUNT = 99;

/** What the pill shows, so a control can say the same in its name: "99+" above 99. */
export function unreadCountText(count: number): string {
  return count > MAX_COUNT ? `${MAX_COUNT}+` : String(count);
}

const useStyles = createStyles((t) => ({
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
}));

/** §8 unread badge: dot 8 or pill 18 high, accent.fill + white `badge`, "99+" above 99. */
export function UnreadBadge({ count, label, decorative = false, style, testID }: UnreadBadgeProps) {
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
      style={[styles.pill, style]}
    >
      <Text variant="badge" color="text.onAccent" selectable={false}>
        {unreadCountText(count)}
      </Text>
    </View>
  );
}
