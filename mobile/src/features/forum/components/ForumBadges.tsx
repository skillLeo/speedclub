import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { ForumPostStatus, ForumThreadStatus } from '@/api/queries/forum';
import { createStyles } from '@/theme';
import { Icon, type IconName } from '@/ui/icons/Icon';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';

const useStyles = createStyles((t) => ({
  // The Badge geometry (09 §5: 20 high, radius 4, label.badge) on the surface-3 ground; Hell takes border.subtle as Badge does.
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.colorScheme === 'light' ? t.color.border.subtle : t.color.bg.overlay,
    borderRadius: t.radius.xs,
    flexDirection: 'row',
    gap: t.space[4],
    minHeight: t.size.statusPill,
    paddingLeft: t.space[4],
    paddingRight: t.space[8],
  },
  tag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.colorScheme === 'light' ? t.color.border.subtle : t.color.bg.raised,
    borderRadius: t.radius.xs,
    flexDirection: 'row',
    flexShrink: 1,
    gap: t.space[4],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  tagWithIcon: { paddingLeft: t.space[4] },
  tagText: { flexShrink: 1 },
}));

/**
 * "Gelöst" (10 §7.2): the badge geometry with the check glyph in the desaturated success tone, its word in the primary text. Glyph and
 * word together, never colour alone.
 */
export function SolvedBadge({ style, testID }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  return (
    <View style={[styles.badge, style]} testID={testID}>
      <Icon name="check-circle" size={16} weight="fill" color="state.success" />
      <Text variant="labelBadge" color="text.primary" hyphenate={false} numberOfLines={1}>
        {t('row.solved')}
      </Text>
    </View>
  );
}

/** A thread's or post's state for its author (FOR-05, FOR-03): "In Prüfung", "Nicht freigegeben", … Nothing when it is published. */
export function ForumStatusPill({ status, testID }: { status: ForumThreadStatus | ForumPostStatus; testID?: string }) {
  const { t } = useTranslation('forum');
  if (status === 'published') return null;
  return <StatusPill label={t(`status.${status}`)} testID={testID} />;
}

/** A category or the attached car on a row: caption on the raised ground, radius 4; a car leads with the garage glyph. */
export function ForumTag({ label, icon, accessibilityLabel, testID }: { label: string; icon?: IconName; accessibilityLabel?: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.tag, icon ? styles.tagWithIcon : null]} aria-label={accessibilityLabel} testID={testID}>
      {icon ? <Icon name={icon} size={16} color="text.secondary" /> : null}
      <Text variant="caption" color="text.secondary" numberOfLines={1} hyphenate={false} style={styles.tagText}>
        {label}
      </Text>
    </View>
  );
}
