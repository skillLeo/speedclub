import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { variantUrl } from '@/features/profile/media';
import { now } from '@/lib/clock';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space, useTheme } from '@/theme';
import { Avatar, Icon, IconButton, PressableScale, Skeleton, SkeletonBlock, SkeletonText, Text, UnreadBadge } from '@/ui';
import { joinLabel, RowDivider } from '@/ui/rowParts';

import { inboxTime } from '../dates';
import { MESSAGE_GLYPHS } from '../glyphs';
import { isMuted, type ConversationSummary } from '../model';
import { otherName, previewText } from '../text';

/** §5 row with a 56 thumb: 72. The contract's avatar 48 is not on the avatar scale; 56 keeps the row on the 72 grid. */
const AVATAR = size.avatar.lg;
/** From this font scale the name, time and glyphs no longer share one line at phone widths (DQ-413: 360 × 1.3). */
export const STACK_SCALE = 1.3;

const useStyles = createStyles((t) => ({
  root: { flexDirection: 'row', alignItems: 'center' },
  box: { flex: 1, minWidth: 0 },
  body: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    paddingVertical: t.space[8],
  },
  selected: { backgroundColor: t.color.state.selected },
  hover: { backgroundColor: t.color.state.hover },
  pressed: { backgroundColor: t.color.state.pressed },
  ring: {
    borderRadius: t.radius.sm,
    outlineColor: t.color.focus.ring,
    outlineOffset: -(t.size.border.focusRing + t.size.border.focusOffset),
    outlineStyle: 'solid',
    outlineWidth: t.size.border.focusRing,
  },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  line: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  name: { flexShrink: 1, minWidth: 0 },
  stackedName: { alignSelf: 'stretch' },
  glyphs: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: t.space[4] },
  spacer: { flex: 1, minWidth: 0 },
  // DQ-413: the time is key data; it keeps its width and is never clamped.
  time: { flexShrink: 0 },
  preview: { flex: 1, minWidth: 0 },
  more: { flexShrink: 0 },
}));

export type ConversationRowProps = {
  conversation: ConversationSummary;
  /** Web split view: the conversation open beside the list. */
  selected?: boolean;
  divider?: boolean;
  /** Gutter of the list. */
  inset: number;
  /** [SIG] organise: the more button and long-press. Off without the flag. */
  organise: boolean;
  onOpen: (conversation: ConversationSummary) => void;
  onMore: (conversation: ConversationSummary) => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * MSG-01 row (contract §7): avatar, name `body.strong`, preview `supporting` on one line, time `caption`, unread count pill, the
 * mute and pin glyphs. The whole row opens the thread; long-press and the trailing more button open the organise sheet.
 */
export const ConversationRow = memo(function ConversationRow({
  conversation,
  selected = false,
  divider = false,
  inset,
  organise,
  onOpen,
  onMore,
  style,
  testID,
}: ConversationRowProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const format = useFormat();
  const reference = now();
  const name = otherName(conversation, t);
  const preview = previewText(conversation.lastMessage, t);
  const at = new Date(conversation.lastMessage?.createdAt ?? conversation.updatedAt);
  const time = inboxTime(at, reference, format.locale, t('days.yesterday'));
  const unread = conversation.unreadCount;
  const muted = isMuted(conversation, reference);
  // The theme's font scale: the QA scale on web, the system setting on native (ThemeProvider), one source for both.
  const scale = useTheme().fontScale;
  const pinned = Boolean(conversation.pinnedAt);
  const label = joinLabel([
    name,
    pinned ? t('inbox.pinned') : null,
    muted ? t('inbox.muted') : null,
    unread > 0 ? t('inbox.unread', { count: unread, formatted: format.number(unread) }) : null,
    preview,
    time,
  ]);

  // DQ-413: at large type the name gets its own lines (up to 2), the time and the glyphs the next, the preview the last.
  const stacked = scale >= STACK_SCALE;
  const glyphs =
    pinned || muted ? (
      <View style={styles.glyphs}>
        {pinned ? (
          <Icon name={MESSAGE_GLYPHS.pinned} size={16} color="text.tertiary" label={isWeb ? t('inbox.pinned') : undefined} testID={`${testID}.pinned`} />
        ) : null}
        {muted ? (
          <Icon name={MESSAGE_GLYPHS.muted} size={16} color="text.tertiary" label={isWeb ? t('inbox.muted') : undefined} testID={`${testID}.muted`} />
        ) : null}
      </View>
    ) : null;
  const timeText = (
    <Text variant="caption" color={unread > 0 ? 'text.primary' : 'text.tertiary'} style={styles.time} testID={`${testID}.time`}>
      {time}
    </Text>
  );

  return (
    // DQ-418: the selection fills the whole row, the "…" button included.
    <View style={[styles.root, selected ? styles.selected : null, style]} testID={testID}>
      <PressableScale
        role="link"
        // The label is for native, where the row reads as one element. On web the visible texts name the link (WCAG 2.5.3, as
        // RowBody): the avatar's initials are visible text too, and a label could never hold them. The glyphs and the pill
        // name themselves there instead.
        aria-label={isWeb ? undefined : label}
        aria-current={selected ? 'page' : undefined}
        feedback={false}
        ring="none"
        onPress={() => onOpen(conversation)}
        onLongPress={organise ? () => onMore(conversation) : undefined}
        delayLongPress={400}
        style={styles.box}
        contentStyle={(state) => [
          styles.body,
          { paddingLeft: inset, paddingRight: organise ? space[4] : inset },
          selected ? null : state.pressed ? styles.pressed : state.hovered ? styles.hover : null,
          state.focused ? styles.ring : null,
        ]}
        testID={`${testID}.open`}
      >
        <Avatar
          decorative
          name={name}
          uri={variantUrl(conversation.other?.avatar, AVATAR)}
          blurhash={conversation.other?.avatar?.blurhash}
          size={AVATAR}
        />
        <View style={styles.text} aria-hidden={!isWeb}>
          {stacked ? (
            <>
              <Text variant="bodyStrong" numberOfLines={2} hyphenate={false} style={styles.stackedName} testID={`${testID}.name`}>
                {name}
              </Text>
              <View style={styles.line}>
                {timeText}
                {glyphs}
              </View>
            </>
          ) : (
            <View style={styles.line}>
              <Text variant="bodyStrong" numberOfLines={1} hyphenate={false} style={styles.name} testID={`${testID}.name`}>
                {name}
              </Text>
              {glyphs}
              <View style={styles.spacer} />
              {timeText}
            </View>
          )}
          <View style={styles.line}>
            <Text
              variant="supporting"
              color={unread > 0 ? 'text.primary' : 'text.secondary'}
              numberOfLines={1}
              style={styles.preview}
              testID={`${testID}.preview`}
            >
              {preview}
            </Text>
            {unread > 0 ? (
              <UnreadBadge
                count={unread}
                decorative={!isWeb}
                label={t('inbox.unread', { count: unread, formatted: format.number(unread) })}
                testID={`${testID}.unread`}
              />
            ) : null}
          </View>
        </View>
      </PressableScale>
      {organise ? (
        <View style={[styles.more, { paddingRight: inset - space[12] }]}>
          <IconButton icon="dots-three" label={t('inbox.more', { name })} color="text.secondary" onPress={() => onMore(conversation)} testID={`${testID}.more`} />
        </View>
      ) : null}
      {divider ? <RowDivider inset={inset} lead={AVATAR + space[12]} /> : null}
    </View>
  );
});

/** The rows' geometry while the first page loads. */
export function ConversationRowsSkeleton({ inset, rows = 7, testID }: { inset: number; rows?: number; testID: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={testID}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.body, { paddingHorizontal: inset }]}>
          <SkeletonBlock width={AVATAR} height={AVATAR} corner="full" />
          <View style={styles.text}>
            <SkeletonText variant="bodyStrong" width="45%" />
            <SkeletonText variant="supporting" width="75%" />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}
