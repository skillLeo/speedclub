import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { AppNotification } from '@/api/queries/notifications';
import { variantUrl } from '@/features/profile/media';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { Avatar, Icon, SkeletonBlock, SkeletonText, Text, UnreadBadge } from '@/ui';
import { RowBody, RowDivider, type RowInset, useRowInset } from '@/ui/rowParts';

import { parseDate } from '../model';
import { notificationIcon, notificationText } from '../notifications';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingVertical: t.space[12] },
  lead: { flexShrink: 0 },
  glyph: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    height: t.size.avatar.md,
    justifyContent: 'center',
    width: t.size.avatar.md,
  },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  // The unread mark: a dot at the row's end, and the text in `body.strong`, so it never rests on colour alone.
  mark: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: t.size.avatar.md, width: t.space[8] },
}));

export type NotificationRowProps = {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  /** DQ-292: the row's time under its day header: "vor 2 Std." under Heute, else the clock time. Relative by default. */
  timeOf?: (date: Date) => string;
  divider: boolean;
  inset?: RowInset;
  testID: string;
};

/** One row of HOME-02: the first actor's avatar (or the type's glyph), the sentence, the time; unread rows say so in text weight, a dot and their name. */
export const NotificationRow = memo(function NotificationRow({ notification, onOpen, timeOf, divider, inset, testID }: NotificationRowProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const format = useFormat();
  const side = useRowInset(inset);
  const text = notificationText(notification, t);
  const created = parseDate(notification.created_at);
  const time = created ? (timeOf ?? format.relative)(created) : null;
  const unread = notification.read_at === null;
  const actor = notification.type === 'build_saved' ? undefined : notification.actors[0];
  return (
    <View testID={testID}>
      <RowBody
        onPress={() => onOpen(notification)}
        role="link"
        label={[unread ? t('notifications.unread') : null, text, time].filter(Boolean).join(', ')}
        style={[styles.row, { paddingLeft: side, paddingRight: side }]}
        testID={`${testID}.body`}
      >
        <View style={styles.lead}>
          {actor ? (
            <Avatar decorative name={actor.display_name ?? actor.username} uri={variantUrl(actor.avatar, size.avatar.md)} blurhash={actor.avatar?.blurhash} size={size.avatar.md} />
          ) : (
            <View style={styles.glyph}>
              <Icon name={notificationIcon(notification)} size={20} color="text.secondary" />
            </View>
          )}
        </View>
        <View style={styles.text}>
          <Text variant={unread ? 'bodyStrong' : 'body'} testID={`${testID}.text`}>
            {text}
          </Text>
          {time ? (
            <Text variant="caption" color="text.tertiary" hyphenate={false}>
              {time}
            </Text>
          ) : null}
        </View>
        {unread ? (
          <View style={styles.mark}>
            <UnreadBadge testID={`${testID}.unread`} />
          </View>
        ) : null}
      </RowBody>
      {divider ? <RowDivider inset={side} lead={size.avatar.md + space[12]} /> : null}
    </View>
  );
});

export function NotificationRowSkeleton({ divider = true, inset }: { divider?: boolean; inset?: RowInset }) {
  const styles = useStyles();
  const side = useRowInset(inset);
  return (
    <View>
      <View style={[styles.row, { paddingLeft: side, paddingRight: side }]}>
        <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
        <View style={styles.text}>
          <SkeletonText variant="body" width="85%" lastLineWidth="50%" lines={2} />
          <SkeletonText variant="caption" width="25%" />
        </View>
      </View>
      {divider ? <RowDivider inset={side} lead={size.avatar.md + space[12]} /> : null}
    </View>
  );
}
