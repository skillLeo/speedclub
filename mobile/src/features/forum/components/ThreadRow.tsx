import { useRouter, type Href } from 'expo-router';
import type { TFunction } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ForumThreadRow } from '@/api/queries/forum';
import { photoFields } from '@/features/profile/media';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { SampleBadges, useSampleBadgeLabels } from '@/ui/Badge';
import { Icon } from '@/ui/icons/Icon';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { ForumStatusPill, ForumTag, SolvedBadge } from './ForumBadges';

const useStyles = createStyles((t) => ({
  row: { flexDirection: 'row', gap: t.space[16], paddingVertical: t.space[16] },
  body: { flex: 1, gap: t.space[8], minWidth: 0 },
  tags: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  meta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  count: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  thumb: { borderRadius: t.radius.sm, overflow: 'hidden', width: t.size.thumb.row },
  skeletonMeta: { flexDirection: 'row', gap: t.space[8] },
}));

/** The words of a row's last activity: "vor 2 Std. · @lukas.sc" (the time alone without a poster). */
export function lastActivityText(row: Pick<ForumThreadRow, 'last_activity_at' | 'last_poster'>, relative: (date: Date) => string, t: TFunction): string | null {
  if (!row.last_activity_at) return null;
  const date = new Date(row.last_activity_at);
  if (Number.isNaN(date.getTime())) return null;
  const time = relative(date);
  return row.last_poster ? t('row.lastBy', { time, username: row.last_poster.username }) : time;
}

/** The thread's page: `path` from the server, else `/forum/{id}`. */
export function threadHref(row: Pick<ForumThreadRow, 'id' | 'path'>): Href {
  return (row.path && row.path.startsWith('/forum/') ? row.path : `/forum/${row.id}`) as Href;
}

export type ThreadRowProps = {
  thread: ForumThreadRow;
  routeId: string;
  /** The sample of an empty state: drawn, but not a link. */
  inert?: boolean;
  /** FOR-05: the author's own states ("In Prüfung", …) and the staff's reason under a rejected thread. */
  showStatus?: boolean;
  note?: string | null;
};

/**
 * One thread in FOR-01/02/05, Home and VEH-01 (10 §7.2): the category and the attached car as tags (pinned and closed as glyphs), the
 * title as the headline, then "Gelöst", the reply count (tabular, the forum's one public count besides "Hilfreich", ADR-506) and the
 * last activity. The attached car's photo sits at the row's end when it has one; "Beispiel" on samples.
 */
export const ThreadRow = memo(function ThreadRow({ thread, routeId, inert = false, showStatus = false, note = null }: ThreadRowProps) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const sampleLabels = useSampleBadgeLabels(thread);
  const last = lastActivityText(thread, format.relative, t);
  const replies = thread.replies_count > 0 ? t('row.replies', { count: thread.replies_count }) : t('row.noReplies');
  const cover = thread.vehicle?.cover ?? null;
  const testID = `${routeId}.thread.${thread.id}`;
  const label = [
    thread.title,
    thread.category.name,
    thread.vehicle ? t('row.vehicle', { vehicle: thread.vehicle.full_title }) : null,
    thread.is_pinned ? t('row.pinned') : null,
    thread.is_locked ? t('row.locked') : null,
    thread.is_solved ? t('row.solved') : null,
    showStatus && thread.status !== 'published' ? t(`status.${thread.status}`) : null,
    replies,
    last,
    ...sampleLabels,
  ]
    .filter(Boolean)
    .join(', ');

  const content = (
    <View style={styles.row}>
      <View style={styles.body}>
        <View style={styles.tags}>
          <ForumTag label={thread.category.name} testID={`${testID}.category`} />
          {thread.vehicle ? <ForumTag label={thread.vehicle.full_title} icon="garage" testID={`${testID}.vehicle`} /> : null}
          {thread.is_pinned ? <Icon name="push-pin" size={16} color="text.secondary" testID={`${testID}.pinned`} /> : null}
          {thread.is_locked ? <Icon name="lock-simple" size={16} color="text.secondary" testID={`${testID}.locked`} /> : null}
        </View>
        <Text variant="headline" numberOfLines={3} testID={`${testID}.title`}>
          {thread.title}
        </Text>
        <View style={styles.meta}>
          {thread.is_solved ? <SolvedBadge testID={`${testID}.solved`} /> : null}
          {showStatus ? <ForumStatusPill status={thread.status} testID={`${testID}.status`} /> : null}
          <SampleBadges flags={thread} testID={`${testID}.badges`} />
          <View style={styles.count}>
            <Icon name="chats" size={16} color="text.secondary" />
            <Text variant="caption" color="text.secondary" numeric testID={`${testID}.replies`}>
              {replies}
            </Text>
          </View>
          {last ? (
            // DQ-P5-037 c: the count and the time read as two facts, also when they wrap ("Noch keine Antwort · vor 5 Std.").
            <Text variant="caption" color="text.secondary" numeric hyphenate={false} testID={`${testID}.last`}>
              <Text variant="caption" color="text.secondary" aria-hidden>
                {'· '}
              </Text>
              {last}
            </Text>
          ) : null}
          {thread.has_photos ? <Icon name="image" size={16} color="text.secondary" label={t('row.photos')} /> : null}
        </View>
        {note ? (
          <Text variant="caption" color="text.secondary" testID={`${testID}.note`}>
            {note}
          </Text>
        ) : null}
      </View>
      {cover ? (
        <View style={styles.thumb}>
          <Photo {...photoFields(cover, size.thumb.row)} aspect="1:1" corner="sm" />
        </View>
      ) : null}
    </View>
  );

  if (inert) {
    return (
      <View aria-label={label} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale role="link" aria-label={label} onPress={() => router.push(threadHref(thread))} testID={testID}>
      {content}
    </PressableScale>
  );
});

/** The row's geometry while it loads: the tag line, two headline lines and the meta line. */
export function ThreadRowSkeleton({ thumb = false }: { thumb?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <SkeletonText variant="caption" width="35%" />
        <SkeletonText variant="headline" lines={2} lastLineWidth="60%" />
        <View style={styles.skeletonMeta}>
          <SkeletonText variant="caption" width="30%" />
          <SkeletonText variant="caption" width="25%" />
        </View>
      </View>
      {thumb ? (
        <View style={styles.thumb}>
          <SkeletonBlock aspectRatio={1} corner="sm" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * A few skeleton rows for a list's first load, in the loaded rows' geometry: from the list's top edge (no state padding above it) and
 * without thumbnails, which only rows with an attached car show (DQ-P5-028).
 */
export function ThreadListSkeleton({ rows = 4, testID }: { rows?: number; testID?: string }) {
  return (
    <Skeleton testID={testID}>
      {Array.from({ length: rows }, (_, index) => (
        <ThreadRowSkeleton key={index} />
      ))}
    </Skeleton>
  );
}

/** The badged sample of an empty forum (09 §8.19): a real kind of question, never a real member's words. */
export function sampleThread(t: TFunction, now: Date): ForumThreadRow {
  return {
    id: 'sample',
    title: t('forum:sample.title'),
    slug: 'sample',
    status: 'published',
    category: { id: 0, slug: 'fahrwerk', name: t('forum:sample.category'), kind: 'standard' },
    author: null,
    vehicle: null,
    tags: [],
    is_pinned: false,
    is_locked: false,
    is_solved: true,
    replies_count: 4,
    last_activity_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    last_poster: { username: t('forum:sample.username'), display_name: null, city: null, avatar: null, is_sample: true, is_editorial: false },
    has_photos: false,
    is_sample: true,
    path: '/forum',
  };
}
