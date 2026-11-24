import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ForumPost } from '@/api/queries/forum';
import { variantUrl } from '@/features/vehicle/media';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { SampleBadges } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { canVote, isLocalPost, reasonText } from '../model';
import { ForumContent } from './ForumContent';
import { ForumStatusPill, SolvedBadge } from './ForumBadges';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[16] },
  highlight: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, marginHorizontal: -t.space[12], paddingHorizontal: t.space[12] },
  // p5r1 capture (FOR-03 High): the avatar is a link, so its column is the 44 hit area (the 32 avatar at its start); with the 4 gap
  // the text starts at 48, and the answers are indented by the same 48 (a spacing token, Medium off-scale 44 before).
  post: { flexDirection: 'row', gap: t.space[4], paddingVertical: t.space[12] },
  avatarHit: { alignItems: 'flex-start', alignSelf: 'flex-start', minHeight: t.size.touchMin, width: t.size.touchMin },
  body: { flex: 1, gap: t.space[8], minWidth: 0 },
  nameLine: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  name: { flexShrink: 1 },
  actions: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap', marginLeft: -t.space[12] },
  // DQ-P5-023: one row "[thumb] Hilfreich · 7", the label as heavy as "Antworten" (bodyStrong), 44 high; the row is the visual's
  // (contentStyle), the outer target only takes the height.
  helpful: { justifyContent: 'center', minHeight: t.size.touchMin },
  helpfulContent: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], paddingHorizontal: t.space[12] },
  answers: { gap: t.space[4], marginLeft: t.space[48] },
  tombstone: { paddingVertical: t.space[12] },
}));

export type PostHandlers = {
  onVote: (post: ForumPost) => void;
  onReply: (post: ForumPost) => void;
  onMarkSolution: (post: ForumPost) => void;
  onMore: (post: ForumPost) => void;
  onOpenMember: (username: string) => void;
};

type PostItemProps = PostHandlers & {
  post: ForumPost;
  routeId: string;
  /** The thread author may mark the solution (`thread.viewer.can_mark_solution`) on any published reply, an answer included. */
  canMarkSolution: boolean;
  /** Replying is open (not locked, not restricted); a guest still sees "Antworten" and signs in. */
  canReply: boolean;
  /** `?post=` of a notification: this reply (or one of its answers) is drawn on the surface tone. */
  highlightId: string | null;
  /** A guest's "Hilfreich" opens the sign-in (the server answers `can_vote: false` for guests); a member's follows `viewer.can_vote`. */
  guest: boolean;
};

/** The visible "Hilfreich" toggle (ADR-506: its count is public in the forum only), 44 high; tabular figures. */
function HelpfulButton({ post, guest, onVote, testID }: { post: ForumPost; guest: boolean; onVote: (post: ForumPost) => void; testID: string }) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const enabled = canVote(post) && (guest || post.viewer.can_vote);
  const color = enabled || post.viewer_voted ? 'text.primary' : 'text.secondary';
  return (
    <PressableScale
      role="checkbox"
      aria-checked={post.viewer_voted}
      aria-disabled={!enabled}
      aria-label={t('post.helpfulLabel', { count: post.helpful_count })}
      disabled={!enabled}
      onPress={() => onVote(post)}
      style={styles.helpful}
      contentStyle={styles.helpfulContent}
      testID={testID}
    >
      <Icon name="thumbs-up" size={20} weight={post.viewer_voted ? 'fill' : 'regular'} color={color} />
      <Text variant="bodyStrong" color={color} hyphenate={false} numberOfLines={1}>
        {t('post.helpful')}
      </Text>
      {post.helpful_count > 0 ? (
        <>
          <Text variant="bodyStrong" color="text.secondary" aria-hidden>
            ·
          </Text>
          <Text variant="bodyStrong" color={color} numeric testID={`${testID}.count`}>
            {post.helpful_count}
          </Text>
        </>
      ) : null}
    </PressableScale>
  );
}

function SinglePost({ post, routeId, canMarkSolution, canReply, highlightId, guest, onVote, onReply, onMarkSolution, onMore, onOpenMember }: PostItemProps) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const format = useFormat();
  const testID = `${routeId}.post.${post.id}`;
  const local = isLocalPost(post);
  if (post.deleted) {
    return (
      <View style={styles.tombstone} testID={`${testID}.deleted`}>
        <Text variant="callout" color="text.tertiary">
          {t('post.deleted')}
        </Text>
      </View>
    );
  }
  const author = post.author;
  const name = author ? author.display_name || `@${author.username}` : t('post.someone');
  const created = post.created_at ? new Date(post.created_at) : null;
  const reason = post.status === 'rejected' ? reasonText(post.review_reason) : null;
  const hint =
    post.status === 'pending'
      ? t('post.pendingHint')
      : post.status === 'rejected'
        ? [t('post.rejectedHint'), reason ? t('thread.rejectedReason', { reason }) : null].filter(Boolean).join(' ')
        : post.status === 'removed'
          ? t('post.removedHint')
          : null;
  const published = post.status === 'published' && !local;
  return (
    <View style={[styles.post, highlightId === post.id ? styles.highlight : null]} testID={testID}>
      <PressableScale
        role="link"
        aria-label={name}
        disabled={!author}
        onPress={author ? () => onOpenMember(author.username) : undefined}
        style={styles.avatarHit}
        testID={`${testID}.avatar`}
      >
        <Avatar name={name} uri={variantUrl(author?.avatar, size.avatar.sm)} blurhash={author?.avatar?.blurhash} size={32} decorative />
      </PressableScale>
      <View style={styles.body}>
        <View style={styles.nameLine}>
          <Text variant="bodyStrong" numberOfLines={1} hyphenate={false} style={styles.name} testID={`${testID}.author`}>
            {name}
          </Text>
          {created ? (
            <Text variant="caption" color="text.secondary" numeric hyphenate={false}>
              {local ? t('post.sending') : format.relative(created)}
              {post.edited_at ? ` · ${t('post.edited')}` : ''}
            </Text>
          ) : null}
          {post.is_solution ? <SolvedBadge testID={`${testID}.solution`} /> : null}
          <ForumStatusPill status={post.status} testID={`${testID}.status`} />
          <SampleBadges flags={author} testID={`${testID}.badges`} />
        </View>
        <ForumContent blocks={post.content} testID={`${testID}.content`} />
        {hint ? (
          <Text variant="caption" color="text.secondary" testID={`${testID}.hint`}>
            {hint}
          </Text>
        ) : null}
        {published ? (
          <View style={styles.actions}>
            <HelpfulButton post={post} guest={guest} onVote={onVote} testID={`${testID}.helpful`} />
            {canReply && post.parent_id !== null ? (
              // DQ-P5-043: an answer is 48 narrower; its "Antworten" is the glyph alone (named), so "⋯" stays on the row.
              <IconButton
                icon="arrow-bend-up-left"
                label={author ? t('post.replyTo', { username: author.username }) : t('post.reply')}
                color="text.primary"
                onPress={() => onReply(post)}
                testID={`${testID}.reply`}
              />
            ) : canReply ? (
              <Button
                label={t('post.reply')}
                accessibilityLabel={author ? t('post.replyTo', { username: author.username }) : t('post.reply')}
                icon="arrow-bend-up-left"
                variant="tertiary"
                size="s"
                onPress={() => onReply(post)}
                testID={`${testID}.reply`}
              />
            ) : null}
            {canMarkSolution ? (
              <Button
                label={post.is_solution ? t('post.unmarkSolution') : t('post.markSolution')}
                icon="check-circle"
                variant="tertiary"
                size="s"
                onPress={() => onMarkSolution(post)}
                testID={`${testID}.markSolution`}
              />
            ) : null}
            {post.viewer.can_edit || post.viewer.can_delete || post.viewer.can_report ? (
              <IconButton icon="dots-three" label={t('post.more')} color="text.secondary" onPress={() => onMore(post)} testID={`${testID}.more`} />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A top-level reply of FOR-03 with its answers one level in (10 §7.2): avatar, name, time, "Lösung" and the author's own states, the
 * text, then "Hilfreich" with its count, "Antworten", the author's "Als Lösung markieren" and "Mehr" (melden, bearbeiten, löschen). A
 * deleted reply with answers stays as a tombstone.
 */
export const PostItem = memo(function PostItem(props: PostItemProps) {
  const styles = useStyles();
  const { post } = props;
  return (
    <View style={styles.root}>
      <SinglePost {...props} />
      {post.replies.length > 0 ? (
        <View style={styles.answers} role="list" testID={`${props.routeId}.post.${post.id}.answers`}>
          {post.replies.map((answer) => (
            <View key={answer.id} role="listitem">
              <SinglePost {...props} post={answer} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** A reply's geometry while the replies load. */
export function PostItemSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.post}>
      <View style={styles.avatarHit}>
        <SkeletonBlock width={size.avatar.sm} height={size.avatar.sm} corner="full" />
      </View>
      <View style={styles.body}>
        <SkeletonText variant="bodyStrong" width="40%" />
        <SkeletonText variant="body" lines={3} lastLineWidth="70%" />
      </View>
    </View>
  );
}

export function PostListSkeleton({ testID }: { testID?: string }) {
  return (
    <Skeleton testID={testID}>
      <PostItemSkeleton />
      <PostItemSkeleton />
    </Skeleton>
  );
}
