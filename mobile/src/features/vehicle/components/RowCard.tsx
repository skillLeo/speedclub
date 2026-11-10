import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, Text, type IconName } from '@/ui';
import { joinLabel } from '@/ui/rowParts';

const NO_BREAK_SPACE = '\u00A0';

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  count: { fontVariant: ['tabular-nums'] },
  title: { flexShrink: 1 },
}));

/**
 * A group of rows on bg.surface, radius 12 (§3: the Black theme puts scrolling content on surface cards). Rows inside pass
 * `inset={space[16]}` and `divider` on all but the last.
 */
export function RowCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export type GroupHeaderProps = {
  title: string;
  /** FS-3 Mods: the category glyph, 20, text.secondary. */
  icon?: IconName;
  /** FS-3 Mods: the number of mods in the category. */
  count?: number;
  /** Screen readers hear the count with its word, "3 Mods". */
  countLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A heading of a group inside a tab: optional glyph, `title.s`, optional count in tertiary tabular figures. The count stands in the
 * heading's own line behind a no-break space, so at a large font it stays with the last word and never sits alone (DQ-180).
 */
export function GroupHeader({ title, icon, count, countLabel, style, testID }: GroupHeaderProps) {
  const styles = useStyles();
  return (
    <View style={[styles.header, style]} testID={testID}>
      {icon ? <Icon name={icon} size={20} color="text.secondary" /> : null}
      <Text
        variant="titleS"
        role="heading"
        {...({ 'aria-level': 2 } as object)}
        aria-label={count === undefined || !countLabel ? undefined : joinLabel([title, countLabel])}
        style={styles.title}
      >
        {title}
        {count === undefined ? null : (
          <>
            {NO_BREAK_SPACE}
            <Text variant="supporting" color="text.tertiary" style={styles.count} testID={testID ? `${testID}.count` : undefined}>
              {String(count)}
            </Text>
          </>
        )}
      </Text>
    </View>
  );
}
