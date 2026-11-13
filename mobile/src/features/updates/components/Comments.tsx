import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { newIdempotencyKey } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import {
  COMMENT_MAX,
  SOCIAL_FLAGS,
  useComments,
  useDeleteComment,
  usePostComment,
  type BuildComment,
} from '@/api/queries/social2';
import type { ReportTarget } from '@/features/safety/model';
import { variantUrl } from '@/features/vehicle/media';
import { useFormat } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import {
  Button,
  Composer,
  ErrorState,
  MemberRow,
  SectionHeader,
  Skeleton,
  SkeletonText,
  Text,
  toast,
} from '@/ui';

import { MentionText } from './MentionText';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  comment: { gap: t.space[4] },
  reply: { marginLeft: t.space[40] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[4] },
  skeleton: { gap: t.space[8] },
}));

export type CommentsSectionProps = {
  updateId: string;
  /** The owner switched comments off for this vehicle (`social.comments_enabled` false). */
  enabledByOwner: boolean;
  onReport: (target: ReportTarget) => void;
  reportable: boolean;
  testID: string;
};

/**
 * 09 §8.5 comments behind `build_comments` (off by default): flat with one reply level, ≤ 500 characters, the author or the
 * update's owner deletes, anybody else reports (DSA pipeline). Without the flag nothing renders.
 */
export function CommentsSection({
  updateId,
  enabledByOwner,
  onReport,
  reportable,
  testID,
}: CommentsSectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const flag = useFlag(SOCIAL_FLAGS.comments);
  const member = useSessionStore((state) => state.status === 'member');
  const list = useComments(updateId, flag && enabledByOwner);
  const post = usePostComment(updateId);
  const remove = useDeleteComment(updateId);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<BuildComment | null>(null);
  const key = useRef(newIdempotencyKey());
  if (!flag || !enabledByOwner) return null;

  const send = (body: string) => {
    const text = body.trim();
    if (!text) return;
    post.mutate(
      { body: text, parentId: replyTo?.id ?? null, idempotencyKey: key.current },
      {
        onSuccess: () => {
          setDraft('');
          setReplyTo(null);
          key.current = newIdempotencyKey();
        },
        onError: (error) =>
          toast(error.message || t('composer.failed'), { haptic: 'warning', testID: `${testID}.toast` }),
      },
    );
  };

  const row = (comment: BuildComment, reply: boolean) => (
    <View
      key={comment.id}
      style={[styles.comment, reply ? styles.reply : null]}
      testID={`${testID}.comment.${comment.id}`}
    >
      <MemberRow
        name={
          comment.author
            ? comment.author.display_name || `@${comment.author.username}`
            : t('reactions.removedMember')
        }
        meta={comment.created_at ? format.date(new Date(comment.created_at)) : undefined}
        avatarUri={variantUrl(comment.author?.avatar, size.avatar.md)}
        avatarBlurhash={comment.author?.avatar?.blurhash}
        inset={0}
      />
      <MentionText
        text={comment.body}
        usernames={comment.mentions.map((entry) => entry.username)}
        testID={`${testID}.comment.${comment.id}.body`}
      />
      <View style={styles.actions}>
        {!reply && member ? (
          <Button
            label={t('update.reply')}
            variant="tertiary"
            size="s"
            onPress={() => setReplyTo(comment)}
            testID={`${testID}.comment.${comment.id}.reply`}
          />
        ) : null}
        {comment.can_delete ? (
          <Button
            label={t('update.delete')}
            variant="tertiary"
            size="s"
            onPress={() => remove.mutate(comment.id)}
            testID={`${testID}.comment.${comment.id}.delete`}
          />
        ) : reportable ? (
          <Button
            label={t('update.reportComment')}
            variant="tertiary"
            size="s"
            onPress={() =>
              onReport({
                type: 'comment',
                id: comment.id,
                label: comment.body.slice(0, 60),
                ...(comment.author ? { owner: comment.author.username } : {}),
              })
            }
            testID={`${testID}.comment.${comment.id}.report`}
          />
        ) : null}
      </View>
      {comment.replies.map((child) => row(child, true))}
    </View>
  );

  const comments = list.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <View style={styles.root} testID={testID}>
      <SectionHeader title={t('update.comments')} />
      {list.isPending ? (
        <Skeleton testID={`${testID}.skeleton`}>
          <View style={styles.skeleton}>
            <SkeletonText variant="body" width="60%" />
            <SkeletonText variant="body" width="80%" />
          </View>
        </Skeleton>
      ) : list.isError ? (
        <ErrorState
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
          testID={`${testID}.error`}
        />
      ) : (
        comments.map((comment) => row(comment, false))
      )}
      {member ? (
        <View>
          {replyTo ? (
            <Text variant="caption" color="text.secondary" testID={`${testID}.replyTo`}>
              {`@${replyTo.author?.username ?? ''}`}
            </Text>
          ) : null}
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={send}
            placeholder={t('update.comments')}
            sendLabel={t('composer.post')}
            sending={post.isPending}
            maxLength={COMMENT_MAX}
            testID={`${testID}.composer`}
          />
        </View>
      ) : null}
    </View>
  );
}
