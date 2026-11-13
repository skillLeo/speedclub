import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { avatarUrlOf, useMe } from '@/api/queries/auth';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Avatar, Icon, Text } from '@/ui';
import { joinLabel, RowBody } from '@/ui/rowParts';

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
}));

export type IdentityCardProps = {
  onPress: () => void;
  /** The row of the page beside it on desktop (SET-02). */
  selected?: boolean;
  /** The 280 pane: avatar 40 instead of 56. */
  compact?: boolean;
  testID: string;
};

/**
 * SET-01 identity card (09 §7.9): Avatar 56, the member's name, "Konto, Sicherheit & Anmeldung", chevron → SET-02. The handle is
 * the name until a display name is set; it never breaks inside itself (DQ-1017) — one line, ellipsis, the whole handle in the
 * accessible name.
 */
export function IdentityCard({ onPress, selected = false, compact = false, testID }: IdentityCardProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const me = useMe();
  const username = useSessionStore((state) => state.member?.username ?? '');
  const handle = username ? `@${username}` : '';
  const name = me.data?.display_name?.trim() || handle || t('rows.account');
  const avatarSize = compact ? size.avatar.md : size.avatar.lg;
  const caption = t('identity.caption');
  return (
    <View style={styles.card}>
      <RowBody onPress={onPress} label={joinLabel([name, handle !== name && handle, caption])} current={selected} testID={testID}>
        <View style={styles.row}>
          <Avatar decorative name={name} uri={avatarUrlOf(me.data?.avatar ?? null, avatarSize * 3)} blurhash={me.data?.avatar?.blurhash} size={avatarSize} />
          <View style={styles.text}>
            <Text variant="headline" numberOfLines={1} hyphenate={false} selectable={false} testID={`${testID}.name`}>
              {name}
            </Text>
            <Text variant="caption" color="text.secondary" selectable={false}>
              {caption}
            </Text>
          </View>
          <Icon name="caret-right" size={16} color="text.tertiary" />
        </View>
      </RowBody>
    </View>
  );
}
