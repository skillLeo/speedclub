import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, useWindowDimensions, type TextInput as RNTextInput } from 'react-native';

import { newIdempotencyKey } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import {
  COMMENT_MAX,
  commentKeys,
  SOCIAL_FLAGS,
  useComments,
  useDeleteComment,
  useMentionSuggestions,
  usePostComment,
  type BuildComment,
  type CommentTarget,
} from '@/api/queries/social2';
import { FormNotice } from '@/features/auth/components/FormNotice';
import type { ReportTarget } from '@/features/safety/model';
import { variantUrl } from '@/features/vehicle/media';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Composer } from '@/ui/Composer';
import { Dialog } from '@/ui/Dialog';
import { ErrorState } from '@/ui/ErrorState';
import { IconButton } from '@/ui/IconButton';
import { MemberRow } from '@/ui/MemberRow';
import { SectionHeader } from '@/ui/SectionHeader';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { motionDuration } from '@/ui/motion';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { vehicleNameText } from '@/ui/textBreaks';

import { loadedComments, sendRefusal, trailingMention, withoutComment, withSentComment, type CommentPage } from '../comments';
import { insertMention } from '../model';
import { MentionText } from './MentionText';

type InputRef = ComponentRef<typeof RNTextInput>;
type Pending = { key: string; body: string; parentId: string | null };

const SKELETON_ROWS = 3;
const MENTION_SUGGESTIONS = 5;
/** From this font scale the composer's placeholder is the short one, so it keeps to one line (R4DQ-38). */
export const SHORT_PLACEHOLDER_FONT_SCALE = 1.3;
/**
 * R4DQ-14: the sheet's list takes at least this share of the window, so with its header and composer the sheet opens at about
 * 55 % (a medium resting point), and from there grows with its comments up to the Sheet's 90 %.
 */
export const SHEET_LIST_FLOOR_SHARE = 0.3;

/** The composer's placeholder: "Kommentar schreiben …", or "Kommentieren …" at a large font (R4DQ-38). */
export function placeholderKey(fontScale: number): 'comments.placeholder' | 'comments.placeholderShort' {
  return fontScale > SHORT_PLACEHOLDER_FONT_SCALE ? 'comments.placeholderShort' : 'comments.placeholder';
}

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  list: { gap: t.space[16] },
  comment: { gap: t.space[4] },
  reply: { marginLeft: t.space[40] },
  // R4DQ-16: the first action's label starts on the comment body's left edge; its 44 target reaches into the margin (as `flush`).
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[4], marginLeft: -t.size.buttonPaddingX.s },
  skeleton: { gap: t.space[16] },
  skeletonRow: { gap: t.space[8] },
  skeletonHead: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  replyBar: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], justifyContent: 'space-between', paddingLeft: t.space[16] },
  replyText: { flexShrink: 1 },
  mentions: { flexDirection: 'row', gap: t.space[8], paddingHorizontal: t.space[8], paddingTop: t.space[8] },
  composerNotice: { gap: t.space[8] },
  // R5DQ-06: the sheet's head, "Kommentare" over the car's name, where the Sheet's own title would stand (12 under the grabber).
  sheetHead: { gap: t.space[2], marginBottom: t.space[16], marginTop: t.space[12] },
}));

/** The member's own state for writing: why the composer is closed, or null while it is open. */
type Gate = 'guest' | 'offline' | 'restricted' | 'closed' | null;

/**
 * The thread's shared state for the inline section (VEH-05) and the sheet (feed cards): the cached pages, the draft with its reply
 * target, the comments on their way (shown at once, "Wird gesendet …"), the delete confirmation and what closes the composer.
 */
function useCommentThread(
  target: CommentTarget,
  enabled: boolean,
  enabledByOwner: boolean,
  focusComposer: () => void,
  testID: string,
  canWrite?: boolean,
) {
  const { t } = useTranslation('vehicle');
  const client = useQueryClient();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const list = useComments(target, enabled && qaState !== 'loading' && qaState !== 'error' && qaState !== 'empty');
  const post = usePostComment(target);
  const remove = useDeleteComment(target);
  const threadKey = commentKeys.thread(target);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<BuildComment | null>(null);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [refused, setRefused] = useState<'closed' | 'restricted' | null>(null);
  const [deleting, setDeleting] = useState<BuildComment | null>(null);
  const key = useRef(newIdempotencyKey());

  const restrictions = me.data?.restrictions;
  // R5-5: the car's thread says whether this member may write now (`comment_thread.can_write`); false for a member reads as restricted.
  const restricted =
    qaState === 'restricted' ||
    refused === 'restricted' ||
    canWrite === false ||
    Boolean(restrictions?.suspended || restrictions?.publishing.restricted);
  const gate: Gate =
    status !== 'member'
      ? 'guest'
      : !enabledByOwner || refused === 'closed'
        ? 'closed'
        : restricted
          ? 'restricted'
          : !online || qaState === 'offline'
            ? 'offline'
            : null;

  const send = (body: string) => {
    const text = body.trim();
    if (!text || gate) return;
    const idempotencyKey = key.current;
    // The next draft is another comment, with a key of its own.
    key.current = newIdempotencyKey();
    const parentId = replyTo?.id ?? null;
    const before = { draft: body, replyTo };
    // Optimistic: the comment shows at once, the composer empties; a refusal puts the draft back.
    setPending((current) => [...current, { key: idempotencyKey, body: text, parentId }]);
    setDraft('');
    setReplyTo(null);
    setFieldError(null);
    // One promise per send: a second comment sent before the first is answered keeps its own outcome.
    post
      .mutateAsync({ body: text, parentId, idempotencyKey })
      .then((comment) => {
        client.setQueryData<InfiniteData<CommentPage, string | null>>(threadKey, (data) => withSentComment(data, comment));
      })
      .catch((error: unknown) => {
        setDraft((current) => (current === '' ? before.draft : current));
        setReplyTo((current) => current ?? before.replyTo);
        const refusal = sendRefusal(error);
        if (refusal.kind === 'closed' || refusal.kind === 'restricted') {
          setRefused(refusal.kind);
        } else if (refusal.kind === 'field') {
          setFieldError(refusal.message);
        } else {
          // The draft comes back with its key: sending the same text again is the same comment (Idempotency-Key).
          key.current = idempotencyKey;
          toast(refusal.message ?? t('comments.failed'), { haptic: 'warning', testID: `${testID}.toast` });
        }
      })
      .finally(() => setPending((current) => current.filter((entry) => entry.key !== idempotencyKey)));
  };

  const confirmDelete = () => {
    const gone = deleting;
    if (!gone) return;
    const snapshot = client.getQueryData<InfiniteData<CommentPage, string | null>>(threadKey);
    client.setQueryData<InfiniteData<CommentPage, string | null>>(threadKey, (data) => withoutComment(data, gone.id));
    setDeleting(null);
    remove.mutate(gone.id, {
      onSuccess: () => toast(t('comments.deleted'), { testID: `${testID}.toast` }),
      onError: (error) => {
        client.setQueryData(threadKey, snapshot);
        toast(error.message || t('comments.deleteFailed'), { haptic: 'warning', testID: `${testID}.toast` });
      },
    });
  };

  const startReply = (comment: BuildComment) => {
    setReplyTo(comment);
    focusComposer();
  };

  return {
    list,
    comments: qaState === 'empty' ? [] : loadedComments(list.data?.pages),
    loading: qaState === 'loading' || (list.isPending && qaState !== 'empty' && qaState !== 'error'),
    failed: qaState === 'error' || (list.isError && !list.data),
    draft,
    setDraft: (next: string) => {
      setDraft(next);
      if (fieldError) setFieldError(null);
    },
    replyTo,
    setReplyTo,
    startReply,
    pending,
    fieldError,
    gate,
    send,
    sending: post.isPending,
    deleting,
    setDeleting,
    confirmDelete,
  };
}

type Thread = ReturnType<typeof useCommentThread>;

function CommentsSkeleton({ testID }: { testID: string }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${testID}.skeleton`}>
      <View style={styles.skeleton}>
        {Array.from({ length: SKELETON_ROWS }, (_, row) => (
          <View key={row} style={styles.skeletonRow}>
            <View style={styles.skeletonHead}>
              <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
              <SkeletonText variant="headline" width="40%" />
            </View>
            <SkeletonText variant="body" width="90%" lines={2} lastLineWidth="55%" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** The comments in their order, each with its replies (one level), its actions and the comments on their way. */
function CommentList({
  thread,
  onReport,
  reportable,
  testID,
}: {
  thread: Thread;
  onReport: (target: ReportTarget) => void;
  reportable: boolean;
  testID: string;
}) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const me = useSessionStore((state) => state.member);
  const member = useSessionStore((state) => state.status === 'member');
  const { list, comments, pending } = thread;

  if (thread.loading) return <CommentsSkeleton testID={testID} />;
  if (thread.failed) {
    return (
      <ErrorState
        title={t('comments.loadError')}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${testID}.error`}
      />
    );
  }

  const pendingRow = (entry: Pending, reply: boolean) => (
    <View key={entry.key} style={[styles.comment, reply ? styles.reply : null]} aria-busy testID={`${testID}.pending`}>
      <MemberRow
        name={me ? me.displayName || `@${me.username}` : ''}
        meta={t('comments.sending')}
        avatarUri={me?.avatarUrl ?? null}
        inset={0}
      />
      <Text variant="body" color="text.secondary">
        {entry.body}
      </Text>
    </View>
  );

  const row = (comment: BuildComment, reply: boolean) => (
    <View key={comment.id} style={[styles.comment, reply ? styles.reply : null]} testID={`${testID}.comment.${comment.id}`}>
      <MemberRow
        name={comment.author ? comment.author.display_name || `@${comment.author.username}` : t('reactions.removedMember')}
        meta={comment.created_at ? format.relative(new Date(comment.created_at)) : undefined}
        avatarUri={variantUrl(comment.author?.avatar, size.avatar.md)}
        avatarBlurhash={comment.author?.avatar?.blurhash}
        sample={comment.author ? { is_sample: comment.author.is_sample, is_editorial: comment.author.is_editorial } : undefined}
        inset={0}
      />
      <MentionText text={comment.body} usernames={comment.mentions.map((entry) => entry.username)} testID={`${testID}.comment.${comment.id}.body`} />
      <View style={styles.actions}>
        {!reply && member && thread.gate === null ? (
          <Button
            label={t('update.reply')}
            variant="tertiary"
            size="s"
            onPress={() => thread.startReply(comment)}
            testID={`${testID}.comment.${comment.id}.reply`}
          />
        ) : null}
        {comment.can_delete ? (
          <Button
            label={t('update.delete')}
            variant="destructive"
            size="s"
            onPress={() => thread.setDeleting(comment)}
            testID={`${testID}.comment.${comment.id}.delete`}
          />
        ) : reportable && comment.author ? (
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
      {pending.filter((entry) => entry.parentId === comment.id).map((entry) => pendingRow(entry, true))}
    </View>
  );

  const topPending = pending.filter((entry) => entry.parentId === null);
  return (
    <View style={styles.list} testID={`${testID}.list`}>
      {comments.length === 0 && pending.length === 0 ? (
        <Text variant="body" color="text.secondary" hyphenate={false} testID={`${testID}.empty`}>
          {thread.gate === 'closed' ? t('comments.emptyClosed') : t('comments.empty')}
        </Text>
      ) : null}
      {comments.map((comment) => row(comment, false))}
      {topPending.map((entry) => pendingRow(entry, false))}
      {list.hasNextPage ? (
        <Button
          label={t('comments.more')}
          variant="secondary"
          size="m"
          onPress={() => void list.fetchNextPage()}
          loading={list.isFetchingNextPage}
          testID={`${testID}.more`}
        />
      ) : null}
    </View>
  );
}

/** The composer with its reply bar and @mention suggestions, or the one line that says why writing is closed. */
function CommentComposer({ thread, inputRef, testID }: { thread: Thread; inputRef: RefObject<InputRef | null>; testID: string }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const requireAuth = useRequireAuth();
  const pathname = usePathname();
  const mentionsOn = useFlag(SOCIAL_FLAGS.mentions);
  const { gutter } = useBreakpoint();
  const { fontScale } = useTheme();
  // The composer keeps the gutter itself; in the page column and the sheet footer that gutter is already there.
  const flush = useMemo(() => ({ marginHorizontal: -gutter }), [gutter]);
  const mention = mentionsOn && thread.gate === null ? trailingMention(thread.draft) : null;
  const suggestions = useMentionSuggestions(mention ? mention.query : null, mention !== null && mention.query.length > 0);
  const members = (suggestions.data ?? []).slice(0, MENTION_SUGGESTIONS);

  if (thread.gate === 'guest') {
    return (
      <View style={styles.composerNotice} testID={`${testID}.guest`}>
        <Text variant="callout" color="text.secondary">
          {t('comments.guest')}
        </Text>
        <Button
          label={t('comments.signIn')}
          variant="secondary"
          size="m"
          onPress={() => requireAuth(undefined, { returnTo: pathname })}
          testID={`${testID}.signIn`}
        />
      </View>
    );
  }
  if (thread.gate === 'closed' || thread.gate === 'restricted') {
    return (
      <FormNotice
        tone="info"
        message={thread.gate === 'closed' ? t('comments.closed') : t('comments.restricted')}
        testID={`${testID}.${thread.gate}`}
      />
    );
  }

  const header = (
    <>
      {thread.replyTo ? (
        <View style={styles.replyBar} testID={`${testID}.replyTo`}>
          <Text variant="caption" color="text.secondary" style={styles.replyText}>
            {t('comments.replyingTo', { username: thread.replyTo.author?.username ?? '' })}
          </Text>
          <IconButton icon="x" label={t('comments.cancelReply')} onPress={() => thread.setReplyTo(null)} testID={`${testID}.replyTo.cancel`} />
        </View>
      ) : null}
      {mention && members.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" aria-label={t('comments.mentions')} testID={`${testID}.mentions`}>
          <View style={styles.mentions}>
            {members.map((member) => (
              <Chip
                key={member.username}
                label={`@${member.username}`}
                onPress={() => thread.setDraft(insertMention(thread.draft, mention, member.username).text)}
                testID={`${testID}.mention.${member.username}`}
              />
            ))}
          </View>
        </ScrollView>
      ) : null}
    </>
  );

  return (
    <View style={styles.composerNotice}>
      {thread.gate === 'offline' ? <FormNotice tone="info" message={t('comments.offline')} testID={`${testID}.offline`} /> : null}
      {thread.fieldError ? <FormNotice message={thread.fieldError} testID={`${testID}.fieldError`} /> : null}
      <Composer
        ref={inputRef}
        value={thread.draft}
        onChangeText={thread.setDraft}
        onSend={thread.send}
        placeholder={thread.replyTo ? t('comments.replyPlaceholder', { username: thread.replyTo.author?.username ?? '' }) : t(placeholderKey(fontScale))}
        sendLabel={t('comments.send')}
        sending={thread.sending}
        disabled={thread.gate === 'offline'}
        maxLength={COMMENT_MAX}
        header={thread.replyTo || (mention && members.length > 0) ? header : undefined}
        style={flush}
        testID={`${testID}.composer`}
      />
    </View>
  );
}

function DeleteDialog({ thread, testID }: { thread: Thread; testID: string }) {
  const { t } = useTranslation('vehicle');
  return (
    <Dialog
      visible={thread.deleting !== null}
      onClose={() => thread.setDeleting(null)}
      title={t('comments.deleteTitle')}
      body={thread.deleting?.parent_id ? undefined : t('comments.deleteBody')}
      actions={[
        { label: t('update.cancel'), variant: 'secondary', onPress: () => thread.setDeleting(null), testID: `${testID}.delete.cancel` },
        { label: t('update.deleteConfirm'), destructive: true, onPress: thread.confirmDelete, testID: `${testID}.delete.confirm` },
      ]}
      testID={`${testID}.delete`}
    />
  );
}

export type CommentsSectionProps = {
  updateId: string;
  /** The owner switched comments off for this vehicle (`social.comments_enabled` false): what was written stays readable. */
  enabledByOwner: boolean;
  onReport: (target: ReportTarget) => void;
  reportable: boolean;
  testID: string;
};

/**
 * VEH-05 comments (09 §8.5, flag build_comments; R4-2.2): flat with one reply level, ≤ 500 characters, @mentions, the author or the
 * update's owner deletes (with a confirmation), anybody else reports (DSA pipeline). Never a count. Without the flag nothing renders.
 */
export function CommentsSection({ updateId, enabledByOwner, onReport, reportable, testID }: CommentsSectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const flag = useFlag(SOCIAL_FLAGS.comments);
  const input = useRef<InputRef | null>(null);
  const focusComposer = useCallback(() => input.current?.focus(), []);
  const target = useMemo<CommentTarget>(() => ({ type: 'update', id: updateId }), [updateId]);
  const thread = useCommentThread(target, flag, enabledByOwner, focusComposer, testID);
  if (!flag) return null;
  return (
    <View style={styles.root} testID={testID}>
      <SectionHeader title={t('update.comments')} testID={`${testID}.title`} />
      <CommentList thread={thread} onReport={onReport} reportable={reportable} testID={testID} />
      <CommentComposer thread={thread} inputRef={input} testID={testID} />
      <DeleteDialog thread={thread} testID={testID} />
    </View>
  );
}

export type CommentsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** R5-5: the update's thread, or the car's own. */
  target: CommentTarget;
  /** The thread is closed (`comment_thread.enabled` / `social.comments_enabled` false): what was written stays readable. */
  enabledByOwner?: boolean;
  /** R5-5: the car thread's `comment_thread.can_write`; left out for an update's thread. */
  canWrite?: boolean;
  /** "Kommentare zu BMW M3 E46": the sheet's accessible name when it has no title of its own. */
  label: string;
  /**
   * The car the thread belongs to, as the head's second line under "Kommentare" (R4DQ-14, R5DQ-06): in the car-name voice, wrapping
   * only at its spaces, never hyphenated.
   */
  vehicleTitle?: string;
  /** Reports a comment: the caller closes the sheet first, so the report sheet is the only one open. */
  onReport: (target: ReportTarget) => void;
  reportable: boolean;
  testID: string;
};

/**
 * R4-2.2, R5-5: the comments of a feed card (its update's, or the car's own) and of VEH-01's car in a sheet, the composer sticky
 * above the keyboard. Closing with a draft asks first (discard guard). An update's thread is the same as on VEH-05.
 */
export function CommentsSheet({ visible, onClose, target, enabledByOwner = true, canWrite, label, vehicleTitle, onReport, reportable, testID }: CommentsSheetProps) {
  const { t } = useTranslation('vehicle');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const flag = useFlag(SOCIAL_FLAGS.comments);
  const input = useRef<InputRef | null>(null);
  const focusComposer = useCallback(() => input.current?.focus(), []);
  const thread = useCommentThread(target, flag && visible, enabledByOwner, focusComposer, testID, canWrite);
  const [discarding, setDiscarding] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const listFloor = useMemo(() => ({ minHeight: Math.round(windowHeight * SHEET_LIST_FLOOR_SHARE) }), [windowHeight]);
  // R4DQ-14: with no comment yet, the composer takes focus once the sheet has come up, so the first comment is one step.
  const empty = !thread.loading && !thread.failed && thread.comments.length === 0 && thread.pending.length === 0;
  const writable = thread.gate === null;
  const focused = useRef(false);
  useEffect(() => {
    if (!visible) {
      focused.current = false;
      return;
    }
    if (focused.current || !empty || !writable) return;
    const timer = setTimeout(() => {
      focused.current = true;
      input.current?.focus();
    }, motionDuration('spring.default'));
    return () => clearTimeout(timer);
  }, [visible, empty, writable]);
  const close = () => {
    if (thread.draft.trim() !== '') setDiscarding(true);
    else onClose();
  };
  if (!flag) return null;
  return (
    <>
      <Sheet
        visible={visible}
        onClose={close}
        // R5DQ-06: the head is drawn in the body (two lines, two voices, no hyphen); `label` names the dialog.
        label={label}
        initialSnap="content"
        footer={<CommentComposer thread={thread} inputRef={input} testID={testID} />}
        testID={testID}
      >
        <View style={styles.sheetHead} testID={`${testID}.head`}>
          <Text variant="title2" role="heading" hyphenate={false} testID={`${testID}.title`}>
            {t('update.comments')}
          </Text>
          {vehicleTitle ? (
            <Text variant="displayWordmark" color="text.secondary" hyphenate={false} testID={`${testID}.vehicle`}>
              {vehicleNameText(vehicleTitle)}
            </Text>
          ) : null}
        </View>
        {/* R5DQ-15: an empty thread keeps the sheet at its content height; a thread with comments opens at least at the floor. */}
        <View style={empty ? null : listFloor}>
          <CommentList thread={thread} onReport={onReport} reportable={reportable} testID={testID} />
        </View>
      </Sheet>
      <DeleteDialog thread={thread} testID={testID} />
      <Dialog
        visible={visible && discarding}
        onClose={() => setDiscarding(false)}
        title={t('comments.discardTitle')}
        body={t('comments.discardBody')}
        actions={[
          { label: t('comments.discardKeep'), variant: 'secondary', onPress: () => setDiscarding(false), testID: `${testID}.discard.keep` },
          {
            label: common('discard.confirm'),
            destructive: true,
            onPress: () => {
              setDiscarding(false);
              thread.setDraft('');
              thread.setReplyTo(null);
              onClose();
            },
            testID: `${testID}.discard.confirm`,
          },
        ]}
        testID={`${testID}.discard`}
      />
    </>
  );
}
