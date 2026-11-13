import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { AppNotification } from '@/api/queries/notifications';
import type { MediaData } from '@/api/queries/profile';
import { photoFields, variantUrl } from '@/features/profile/media';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { Avatar, Icon, Photo, SkeletonBlock, SkeletonText, Text, UnreadBadge } from '@/ui';
import { SwipeRow } from '@/ui/motion/kit';
import { RowBody, RowDivider, type RowInset, useRowInset } from '@/ui/rowParts';

import { parseDate } from '../model';
import { emphasisRuns, notificationHyphenates, notificationIcon, notificationText, notificationThumb } from '../notifications';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingVertical: t.space[12] },
  lead: { flexShrink: 0 },
  // 09 §7.4 / §5 Avatar: the actor's car as a square badge (radius 4) on the avatar's bottom-right, with a canvas ring to cut it free.
  carBadge: {
    borderColor: t.color.bg.canvas,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    bottom: -t.space[2],
    height: t.size.icon.m,
    overflow: 'hidden',
    position: 'absolute',
    right: -t.space[2],
    width: t.size.icon.m,
  },
  glyph: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderRadius: t.radius.full,
    height: t.size.avatar.md,
    justifyContent: 'center',
    width: t.size.avatar.md,
  },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  // The unread mark: a dot before the end of the row, and "Ungelesen" in the row's name, so it never rests on colour alone.
  mark: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: t.size.avatar.md, width: t.space[8] },
  // 09 §7.4: the object as a car photo, radius 8 (never an icon), as tall as the avatar it balances (40; the scale has no 44 thumb).
  thumb: { borderRadius: t.radius.sm, flexShrink: 0, height: t.size.avatar.md, overflow: 'hidden', width: t.size.avatar.md },
}));

/**
 * DQ-1039: the actor's main car cover, for the avatar's car badge. Lane B gap: `actors[].main_vehicle_cover`; until the types have
 * it, it is read only when present, and without it the avatar has no badge.
 */
export function actorCarCover(actor: object | undefined): MediaData | null {
  if (!actor || !('main_vehicle_cover' in actor)) return null;
  const cover = (actor as { main_vehicle_cover?: unknown }).main_vehicle_cover;
  return typeof cover === 'object' && cover !== null ? (cover as MediaData) : null;
}

export type NotificationRowProps = {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  /** DQ-292: the row's time under its day header: "vor 2 Std." under Heute, else the clock time. Relative by default. */
  timeOf?: (date: Date) => string;
  divider: boolean;
  inset?: RowInset;
  /** SM11: an unread row swipes to "Gelesen". */
  onMarkRead?: (notification: AppNotification) => void;
  testID: string;
};

/** One row of HOME-02: the first actor's avatar (or the type's glyph), the sentence, the time; unread rows say so in text weight, a dot and their name. */
export const NotificationRow = memo(function NotificationRow({ notification, onOpen, timeOf, divider, inset, onMarkRead, testID }: NotificationRowProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const format = useFormat();
  const side = useRowInset(inset);
  const text = notificationText(notification, t);
  const created = parseDate(notification.created_at);
  const time = created ? (timeOf ?? format.relative)(created) : null;
  const unread = notification.read_at === null;
  const actor = notification.type === 'build_saved' ? undefined : notification.actors[0];
  const thumb = notificationThumb(notification);
  const carCover = actorCarCover(actor);
  const label = [unread ? t('notifications.unread') : null, text, time].filter(Boolean).join(', ');
  const body = (
      <RowBody
        onPress={() => onOpen(notification)}
        role="link"
        label={label}
        style={[styles.row, { paddingLeft: side, paddingRight: side }]}
        testID={`${testID}.body`}
      >
        <View style={styles.lead}>
          {actor ? (
            <View>
              <Avatar decorative name={actor.display_name ?? actor.username} uri={variantUrl(actor.avatar, size.avatar.md)} blurhash={actor.avatar?.blurhash} size={size.avatar.md} />
              {carCover ? (
                <View style={styles.carBadge} testID={`${testID}.carBadge`}>
                  <Photo {...photoFields(carCover, size.icon.m)} aspect="1:1" />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.glyph}>
              <Icon name={notificationIcon(notification)} size={20} color="text.secondary" />
            </View>
          )}
        </View>
        <View style={styles.text}>
          <Text variant="body" hyphenate={notificationHyphenates(notification)} testID={`${testID}.text`}>
            {emphasisRuns(text, notification).map((run, index) =>
              run.strong ? (
                <Text key={index} variant="bodyStrong" hyphenate={false}>
                  {run.text}
                </Text>
              ) : (
                run.text
              ),
            )}
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
        {thumb ? (
          <View style={styles.thumb}>
            <Photo {...photoFields(thumb, size.avatar.md)} aspect="1:1" testID={`${testID}.thumb`} />
          </View>
        ) : null}
      </RowBody>
  );
  return (
    <View testID={testID}>
      {/* SM11 on touch platforms; the web marks rows read by opening them or with "Alle als gelesen markieren" (the kit keeps a
          web row's actions in the tab order under the row, which a pointer cannot reach without a swipe). */}
      {unread && onMarkRead && !isWeb ? (
        <SwipeRow
          actions={[{ key: 'read', label: t('notifications.markRead'), icon: 'check', onPress: () => onMarkRead(notification) }]}
          label={label}
          onPress={() => onOpen(notification)}
          ground="canvas"
          testID={`${testID}.swipe`}
        >
          {body}
        </SwipeRow>
      ) : (
        body
      )}
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
