import { zodResolver } from '@hookform/resolvers/zod';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, type TextInput as RNTextInput } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';
import { z } from 'zod';

import { ApiError, newIdempotencyKey } from '@/api/client';
import {
  FORUM_LIMITS,
  flattenPosts,
  hasReplies,
  isThreadClosed,
  useDeletePost,
  useDeleteThread,
  useEditPost,
  useForumOn,
  useForumPosts,
  useForumThread,
  useReply,
  useSolution,
  useSubscribe,
  useVote,
  type ForumPost,
  type ForumPostSort,
  type ForumThread,
} from '@/api/queries/forum';
import { useMe } from '@/api/queries/auth';
import { applyServerErrors } from '@/features/auth/forms';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useOpenMember } from '@/features/home/navigation';
import { shareLink } from '@/features/profile/share';
import { useRestrictionDecision } from '@/features/safety/components/DecisionLink';
import { useReport } from '@/features/safety/useReport';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useHideTabBar } from '@/features/shell/tabBarLayout';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { viewerImages } from '@/features/vehicle/media';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth } from '@/state/session';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { useSafeEdge, useSafeInset } from '@/ui/safeArea';
import { Button } from '@/ui/Button';
import { Composer } from '@/ui/Composer';
import { Dialog } from '@/ui/Dialog';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Header, type HeaderAction } from '@/ui/Header';
import { IconButton } from '@/ui/IconButton';
import { ImageViewer } from '@/ui/ImageViewer';
import { KeyboardInsetView } from '@/ui/KeyboardInsetView';
import { Screen } from '@/ui/Screen';
import { Sheet } from '@/ui/Sheet';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { useForumAccess } from '../access';
import { excerptOf } from '../content';
import { PostItem, PostListSkeleton } from '../components/PostItem';
import { ForumDecisionLink, ThreadHead, ThreadHeadSkeleton } from '../components/ThreadHead';
import { isLocalPost, replyParentOf, seekStep, topIndexOf } from '../model';
import { composerHref } from '../navigation';

const ROUTE = 'FOR-03';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  root: { flex: 1 },
  list: { flex: 1 },
  column: { alignSelf: 'center', maxWidth: layout.feedColumn, width: '100%' },
  item: { paddingBottom: t.space[4] },
  more: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingVertical: t.space[12] },
  state: { flex: 1, justifyContent: 'center', paddingVertical: t.space[32] },
  bar: { backgroundColor: t.color.bg.canvas, borderTopColor: t.color.border.hairline, borderTopWidth: t.size.border.control },
  barInner: { alignSelf: 'center', gap: t.space[8], maxWidth: layout.feedColumn, paddingTop: t.space[12], width: '100%' },
  note: { gap: t.space[4], paddingBottom: t.space[12] },
  guest: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12], justifyContent: 'space-between', paddingBottom: t.space[12] },
  guestText: { flexShrink: 1 },
  replyTo: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  field: { alignSelf: 'center', maxWidth: layout.feedColumn, width: '100%' },
  replyToText: { flex: 1, gap: t.space[2], minWidth: 0 },
  editBody: { gap: t.space[16], paddingBottom: t.space[16] },
}));

const editSchema = z.object({ body: z.string().trim().min(1, 'empty').max(FORUM_LIMITS.replyMax, 'tooLong') });
type EditValues = z.infer<typeof editSchema>;

/**
 * FOR-03 Thema `/forum/[id]` (10 §7.2, flagship ★): the opening (ThreadHead), the replies one level deep with "Hilfreich" and its
 * visible count (ADR-506), the author's "Gelöst", subscribe (bell), share and "Mehr" (report through the DSA pipeline with target
 * `forum_post`, edit, delete), and the reply bar at the bottom above the keyboard. `?post=` (a notification) scrolls to that reply and
 * marks it. Locked threads keep votes, the solution and the subscription; only replying closes. New accounts see that their posts
 * are checked first (pre-moderation). The tab bar steps aside while the thread is open, as in a conversation.
 */
export function ForumThreadScreen() {
  const { t } = useTranslation('forum');
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; post?: string }>();
  const id = paramOf(params.id) ?? '';
  const focusPost = paramOf(params.post) ?? null;
  const qaState = useQaState();
  const online = useOnline();
  const flag = useForumOn();
  const back = useBack('/forum');
  const thread = useForumThread(qaState === 'default' || qaState === 'restricted' || qaState === 'offline' ? id : '');
  const data = thread.data;
  const offline = qaState === 'offline' || (!online && !data) || (!data && thread.fetchStatus === 'paused');
  useHideTabBar();

  let body: ReactNode;
  if (!flag && qaState === 'default') {
    body = <CentredState><EmptyState icon="chats" title={t('thread.unavailableTitle')} body={t('thread.unavailableBody')} testID={`${ROUTE}.unavailable`} /></CentredState>;
  } else if (qaState === 'loading' || (qaState === 'default' && !data && thread.isPending && thread.fetchStatus !== 'paused')) {
    body = <ThreadLoading />;
  } else if (data && qaState !== 'error' && qaState !== 'empty') {
    body = <ThreadBody thread={data} focusPost={focusPost} />;
  } else if (qaState === 'empty' || (thread.error instanceof ApiError && thread.error.kind === 'not_found')) {
    body = (
      <CentredState>
        <EmptyState
          icon="chats"
          title={t('thread.notFoundTitle')}
          body={t('thread.notFoundBody')}
          action={{ label: t('thread.toForum'), onPress: () => router.replace('/forum' as Href), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.notFound`}
        />
      </CentredState>
    );
  } else {
    const isOffline = qaState === 'offline' || (qaState !== 'error' && offline);
    body = (
      <CentredState>
        <ErrorState
          title={isOffline ? t('thread.offlineTitle') : t('thread.errorTitle')}
          message={isOffline ? t('thread.offlineBody') : undefined}
          onRetry={() => void thread.refetch()}
          retrying={thread.isFetching}
          testID={`${ROUTE}.${isOffline ? 'offline' : 'error'}`}
        />
      </CentredState>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      {data ? null : <Header variant="compact" title={t('title')} onBack={back} backLabel={t('thread.back')} testID={`${ROUTE}.header`} />}
      {data ? null : <ShellOfflineBanner label={t('list.offlineBanner')} />}
      {body}
    </Screen>
  );
}

function CentredState({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return <View style={[styles.state, { paddingHorizontal: gutter }]}>{children}</View>;
}

function useColumn(): { width: number; gutter: number; bleed: number } {
  const { gutter, kind, width } = useBreakpoint();
  const pane = kind === 'desktop' ? width - layout.sidebar : kind === 'tablet' ? width - layout.rail : width;
  // The column is at most feedColumn wide with the gutter inside it (DQ-P5-037 d: the photos were measured 2 × 24 too wide at 1440,
  // so three wrapped 2 + 1).
  const column = Math.min(layout.feedColumn, pane) - 2 * gutter;
  return { width: column, gutter, bleed: kind === 'phone' ? gutter : 0 };
}

function ThreadLoading() {
  const styles = useStyles();
  const { width, gutter, bleed } = useColumn();
  return (
    <View style={[styles.column, { paddingHorizontal: gutter }]}>
      <ThreadHeadSkeleton width={width} leadBleed={bleed} testID={`${ROUTE}.skeleton`} />
      <PostListSkeleton />
    </View>
  );
}

type ReplyTarget = { parent: ForumPost; to: ForumPost } | null;

function ThreadBody({ thread, focusPost }: { thread: ForumThread; focusPost: string | null }) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const access = useForumAccess();
  const requireAuth = useRequireAuth();
  const me = useMe().data;
  const openMember = useOpenMember();
  const header = useCollapsingHeader();
  const back = useBack('/forum');
  const bottom = useSafeEdge('bottom');
  const inset = useSafeInset('bottom');
  const { width, gutter, bleed } = useColumn();
  const decisionId = useRestrictionDecision(access.restrictionKind === 'publishing' ? 'publishing' : 'forum');
  const animated = motion.enabled && !motion.reduced;

  const [sort, setSort] = useState<ForumPostSort>('oldest');
  const posts = useForumPosts(thread.id, sort, thread.status === 'published' || thread.status === 'merged' || thread.viewer.is_author);
  const list = useMemo(() => flattenPosts(posts.data?.pages), [posts.data?.pages]);
  const listRef = useRef<FlashListRef<ForumPost>>(null);
  const [highlight, setHighlight] = useState<string | null>(focusPost);

  const vote = useVote(thread.id);
  const subscribe = useSubscribe(thread.id);
  const solution = useSolution(thread.id);
  const reply = useReply(thread.id);
  const editPost = useEditPost(thread.id);
  const deletePost = useDeletePost(thread.id);
  const deleteThread = useDeleteThread();

  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [postMenu, setPostMenu] = useState<ForumPost | null>(null);
  const [editing, setEditing] = useState<ForumPost | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'thread' } | { kind: 'post'; post: ForumPost } | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const composerInput = useRef<ComponentRef<typeof RNTextInput>>(null);

  const report = useReport(
    thread.opening_post_id ? { type: 'forum_post', id: thread.opening_post_id, label: thread.title, ...(thread.author ? { owner: thread.author.username } : {}) } : null,
    { routeId: ROUTE, onBlocked: () => back() },
  );

  // `?post=` (a notification) and "Zur Antwort": the reply is scrolled into view and marked once it is loaded. SF-6: the newest reply
  // (where forum_reply links) sits on the last page of "Chronologisch", so the pages are read on until it turns up, at most
  // SEEK_PAGE_CAP pages; not found by then (deleted, hidden), the thread simply stays at its top.
  // Each request is its own object, so "Zur Antwort" pressed twice scrolls twice; a finished one is remembered in a ref.
  const [seek, setSeek] = useState<{ id: string } | null>(focusPost ? { id: focusPost } : null);
  const settled = useRef<{ id: string } | null>(null);
  const showPost = useCallback((postId: string) => {
    setHighlight(postId);
    setSeek({ id: postId });
  }, []);
  const pageCount = posts.data?.pages.length ?? 0;
  useEffect(() => {
    if (!seek || settled.current === seek || !posts.data) return;
    const index = topIndexOf(list, seek.id);
    const step = seekStep({ found: index !== -1, hasNext: posts.hasNextPage, fetching: posts.isFetchingNextPage, failed: posts.isError, pages: pageCount });
    if (step === 'show') {
      settled.current = seek;
      requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated, viewPosition: 0.2 }));
    } else if (step === 'fetch') {
      void posts.fetchNextPage();
    } else if (step === 'stop') {
      settled.current = seek;
    }
  }, [animated, list, pageCount, posts, seek]);

  const canWrite = access.status === 'member' && access.restriction === null;
  const replyOpen = thread.status === 'published' && !thread.is_locked;
  // A guest still sees "Antworten" and signs in first; a member needs the server's `can_reply` and no restriction in force.
  const canReply = replyOpen && (access.status !== 'member' || (canWrite && thread.viewer.can_reply));

  const startReply = (post: ForumPost) => {
    // A reply still on its way has no id the server knows: it cannot be answered until its server copy replaces it.
    if (isLocalPost(post)) return;
    requireAuth(
      () => {
        const parentId = replyParentOf(post);
        const parent = list.find((entry) => entry.id === parentId) ?? post;
        if (isLocalPost(parent)) return;
        setReplyTarget({ parent, to: post });
        haptics.selection();
        requestAnimationFrame(() => composerInput.current?.focus());
      },
      { returnTo: `/forum/${thread.id}` },
    );
  };

  const send = (text: string) => {
    const body = text.trim();
    if (body === '') return;
    if (body.length > FORUM_LIMITS.replyMax) {
      toast(t('reply.tooLong', { max: FORUM_LIMITS.replyMax }), { haptic: 'warning', testID: `${ROUTE}.toast` });
      return;
    }
    // The target may have been a local reply that the server refused meanwhile: then the answer goes to the thread.
    const target = replyTarget && !isLocalPost(replyTarget.parent) ? replyTarget : null;
    setDraft('');
    setReplyTarget(null);
    reply.mutate(
      {
        body,
        parent: target?.parent ?? null,
        idempotencyKey: newIdempotencyKey(),
        author: me?.username
          ? { username: me.username, display_name: me.display_name, city: me.city, avatar: me.avatar, is_sample: me.is_sample, is_editorial: me.is_editorial }
          : null,
      },
      {
        onSuccess: (post) => {
          haptics.success();
          if (post.status === 'pending') toast(t('reply.pendingSent'), { testID: `${ROUTE}.toast` });
        },
        onError: (error) => {
          haptics.error();
          // The text goes back into the field (and the reply's target with it), so nothing typed is lost.
          setDraft((current) => (current === '' ? body : current));
          setReplyTarget((current) => current ?? target);
          const message =
            error instanceof ApiError && error.kind === 'rate_limited'
              ? t('reply.rateLimited')
              : isThreadClosed(error)
                ? t('reply.closed')
                : error instanceof ApiError && error.kind === 'validation'
                  ? (error.fieldErrors.body?.[0] ?? error.message)
                  : t('reply.failed');
          toast(message, { haptic: 'warning', testID: `${ROUTE}.toast` });
        },
      },
    );
  };

  const onVote = useCallback(
    (post: ForumPost) => {
      requireAuth(
        () => {
          if (post.viewer.is_author) {
            toast(t('post.helpfulOwn'), { testID: `${ROUTE}.toast` });
            return;
          }
          haptics.light();
          vote.mutate(
            { post, on: !post.viewer_voted },
            { onError: () => toast(t('post.helpfulFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` }) },
          );
        },
        { returnTo: `/forum/${thread.id}` },
      );
    },
    [requireAuth, t, thread.id, vote],
  );

  const onMarkSolution = useCallback(
    (post: ForumPost) => {
      const next = post.is_solution ? null : post.id;
      haptics.selection();
      solution.mutate(next, {
        onSuccess: () => {
          if (next) {
            haptics.success();
            toast(t('post.solutionMarked'), { testID: `${ROUTE}.toast` });
          }
        },
        onError: () => toast(t('post.solutionFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
      });
    },
    [solution, t],
  );

  const toggleSubscription = () => {
    requireAuth(
      () => {
        const next = !thread.viewer.subscribed;
        haptics.light();
        subscribe.mutate(next, {
          onSuccess: (subscribed) => toast(subscribed ? t('thread.subscribed') : t('thread.unsubscribed'), { testID: `${ROUTE}.toast` }),
          onError: () => toast(t('reply.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
        });
      },
      { returnTo: `/forum/${thread.id}` },
    );
  };

  const share = async () => {
    const outcome = await shareLink({ url: thread.share_url, title: thread.title });
    if (outcome === 'copied') toast(t('thread.linkCopied'), { testID: `${ROUTE}.toast` });
    if (outcome === 'failed') toast(t('thread.shareFailed', { url: thread.share_url }), { testID: `${ROUTE}.toast` });
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(thread.share_url);
      toast(t('thread.linkCopied'), { testID: `${ROUTE}.toast` });
    } catch {
      toast(t('thread.copyFailed', { url: thread.share_url }), { testID: `${ROUTE}.toast` });
    }
  };

  const removeThread = () => {
    deleteThread.mutate(thread.id, {
      onSuccess: () => {
        setConfirmDelete(null);
        haptics.success();
        toast(t('thread.deleted'), { testID: `${ROUTE}.toast` });
        back();
      },
      onError: (error) => {
        setConfirmDelete(null);
        haptics.error();
        toast(hasReplies(error) ? t('thread.deleteHasReplies') : t('thread.deleteFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
      },
    });
  };
  const removePost = (post: ForumPost) => {
    deletePost.mutate(post.id, {
      onSuccess: () => {
        setConfirmDelete(null);
        toast(t('post.deletedToast'), { testID: `${ROUTE}.toast` });
      },
      onError: () => {
        setConfirmDelete(null);
        toast(t('post.deleteFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
      },
    });
  };

  const moreActions: MoreAction[] = [
    { key: 'share', icon: 'share-network', label: t('thread.share'), onPress: () => void share() },
    { key: 'copyLink', icon: 'link', label: t('thread.copyLink'), onPress: () => void copy() },
    ...(thread.viewer.can_edit ? [{ key: 'edit', icon: 'pencil-simple', label: t('thread.edit'), onPress: () => router.push(composerHref({ threadId: thread.id })) } satisfies MoreAction] : []),
    ...(thread.viewer.can_delete ? [{ key: 'delete', icon: 'trash', label: t('thread.delete'), onPress: () => setConfirmDelete({ kind: 'thread' }) } satisfies MoreAction] : []),
    ...(report.available && thread.viewer.can_report && !thread.is_sample && thread.opening_post_id
      ? [{ key: 'report', icon: 'flag', label: t('thread.report'), onPress: report.open } satisfies MoreAction]
      : []),
  ];
  const postActions: MoreAction[] = postMenu
    ? [
        ...(postMenu.viewer.can_edit ? [{ key: 'edit', icon: 'pencil-simple', label: t('post.edit'), onPress: () => setEditing(postMenu) } satisfies MoreAction] : []),
        ...(postMenu.viewer.can_delete ? [{ key: 'delete', icon: 'trash', label: t('post.delete'), onPress: () => setConfirmDelete({ kind: 'post', post: postMenu }) } satisfies MoreAction] : []),
        ...(report.available && postMenu.viewer.can_report && !(postMenu.author?.is_sample ?? false)
          ? [
              {
                key: 'report',
                icon: 'flag',
                label: t('post.report'),
                onPress: () => report.openFor({ type: 'forum_post', id: postMenu.id, label: thread.title, ...(postMenu.author ? { owner: postMenu.author.username } : {}) }),
              } satisfies MoreAction,
            ]
          : []),
      ]
    : [];

  const actions: HeaderAction[] = [
    {
      icon: 'bell',
      label: thread.viewer.subscribed ? t('thread.unsubscribe') : t('thread.subscribe'),
      selected: thread.viewer.subscribed,
      onPress: toggleSubscription,
      disabled: thread.status !== 'published' && thread.status !== 'merged',
      testID: `${ROUTE}.subscribe`,
    },
    { icon: 'share-network', label: t('thread.share'), onPress: () => void share(), disabled: thread.status !== 'published', testID: `${ROUTE}.share` },
    { icon: 'dots-three', label: t('thread.more'), onPress: () => setMoreOpen(true), testID: `${ROUTE}.moreActions` },
  ];

  const viewerList = useMemo(() => viewerImages(thread.photos, thread.title), [thread.photos, thread.title]);
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const barPadding = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);
  // From 768 the field keeps to the column (plus its own gutters), centred like the thread above it.
  const fieldStyle = useMemo(() => (bleed > 0 ? undefined : [styles.field, { maxWidth: layout.feedColumn + 2 * gutter }]), [bleed, gutter, styles.field]);

  const head = (
    <ThreadHead
      thread={thread}
      routeId={ROUTE}
      width={width}
      leadBleed={bleed}
      sort={sort}
      onSort={(next) => {
        haptics.selection();
        setSort(next);
      }}
      onOpenPhoto={setViewer}
      onOpenMember={openMember}
      onShowSolution={showPost}
      focusPost={focusPost}
    />
  );

  const repliesState = posts.isError && list.length === 0 ? (
    <ErrorState title={t('thread.repliesError')} onRetry={() => void posts.refetch()} retrying={posts.isFetching} testID={`${ROUTE}.repliesError`} />
  ) : posts.isPending && posts.fetchStatus !== 'paused' && thread.replies_count > 0 ? (
    <PostListSkeleton testID={`${ROUTE}.repliesSkeleton`} />
  ) : null;

  // The bar under the list: notes in the column (padded), the Composer itself edge to edge with its own gutters (as in MSG-02),
  // held to the column's width from 768.
  let composer: ReactNode;
  let field: ReactNode = null;
  if (thread.status !== 'published') {
    composer = null;
  } else if (thread.is_locked) {
    composer = (
      <View style={styles.note}>
        {/* DQ-P5-037 b: the one place that says it (the head no longer repeats it). */}
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.closed`}>
          {t('thread.locked')}
        </Text>
      </View>
    );
  } else if (access.status === 'guest') {
    composer = (
      <View style={styles.guest}>
        <Text variant="callout" color="text.secondary" style={styles.guestText}>
          {t('reply.guest')}
        </Text>
        <Button label={t('reply.signIn')} variant="secondary" size="m" onPress={() => requireAuth(undefined, { returnTo: `/forum/${thread.id}` })} testID={`${ROUTE}.signIn`} />
      </View>
    );
  } else if (access.restriction) {
    composer = (
      <View style={styles.note}>
        <FormNotice tone="info" message={access.restriction} testID={`${ROUTE}.restricted`} />
        <ForumDecisionLink routeId={ROUTE} decisionId={decisionId} />
      </View>
    );
  } else {
    composer = access.premoderated ? (
      <View style={styles.note}>
        <FormNotice tone="info" message={t('reply.premoderation')} testID={`${ROUTE}.premoderation`} />
      </View>
    ) : null;
    field = (
        <Composer
          ref={composerInput}
          header={
            replyTarget ? (
              <View style={[styles.replyTo, { paddingLeft: gutter, paddingRight: gutter - space[12] }]} testID={`${ROUTE}.replyTo`}>
                <View style={styles.replyToText}>
                  <Text variant="caption" color="text.secondary" numberOfLines={1} hyphenate={false}>
                    {t('reply.replyingTo', { username: replyTarget.to.author?.username ?? t('post.someone') })}
                  </Text>
                  <Text variant="callout" numberOfLines={1} hyphenate={false}>
                    {excerptOf(replyTarget.to.content)}
                  </Text>
                </View>
                <IconButton
                  icon="x"
                  label={t('reply.cancelReply', { username: replyTarget.to.author?.username ?? t('post.someone') })}
                  color="text.secondary"
                  onPress={() => setReplyTarget(null)}
                  testID={`${ROUTE}.replyTo.cancel`}
                />
              </View>
            ) : undefined
          }
          value={draft}
          onChangeText={setDraft}
          onSend={send}
          placeholder={replyTarget?.to.author ? t('reply.placeholderTo', { username: replyTarget.to.author.username }) : t('reply.placeholder')}
          sendLabel={t('reply.send')}
          maxLength={FORUM_LIMITS.replyMax + 200}
          disabled={!online || !canWrite || qaState === 'offline'}
          sending={reply.isPending}
          style={fieldStyle}
          testID={`${ROUTE}.composer`}
        />
    );
  }

  return (
    <KeyboardInsetView bottomInset={inset} style={styles.root}>
      <Header
        variant="compact"
        title={t('title')}
        scroll={header}
        onBack={back}
        backLabel={t('thread.back')}
        actions={actions}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('list.offlineBanner')} />
      <CollapsingFlashList
        ref={listRef}
        {...header.scrollProps}
        data={list}
        keyExtractor={(post: ForumPost) => post.id}
        renderItem={({ item, index }: { item: ForumPost; index: number }) => (
          <View style={[columnStyle, styles.item]}>
            {index > 0 ? <Hairline /> : null}
            <PostItem
              post={item}
              routeId={ROUTE}
              canMarkSolution={thread.viewer.can_mark_solution}
              canReply={canReply}
              highlightId={highlight}
              guest={access.status !== 'member'}
              onVote={onVote}
              onReply={startReply}
              onMarkSolution={onMarkSolution}
              onMore={setPostMenu}
              onOpenMember={openMember}
            />
          </View>
        )}
        style={styles.list}
        ListHeaderComponent={<View style={columnStyle}>{head}</View>}
        ListEmptyComponent={repliesState ? <View style={columnStyle}>{repliesState}</View> : null}
        ListFooterComponent={
          posts.isFetchingNextPage ? (
            <View style={[columnStyle, styles.more]}>
              <Spinner label={t('thread.moreReplies')} testID={`${ROUTE}.loadingMore`} />
            </View>
          ) : posts.hasNextPage ? (
            <View style={[columnStyle, styles.more]}>
              <Button label={t('thread.moreReplies')} variant="secondary" size="m" onPress={() => void posts.fetchNextPage()} testID={`${ROUTE}.moreReplies`} />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (posts.hasNextPage && !posts.isFetchingNextPage && !posts.isError) void posts.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID={`${ROUTE}.list`}
      />
      {composer || field ? (
        <View style={[styles.bar, bottom]} testID={`${ROUTE}.bar`}>
          {composer ? <View style={[styles.barInner, barPadding]}>{composer}</View> : null}
          {field}
        </View>
      ) : null}
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={thread.title} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
      <MoreSheet visible={postMenu !== null} onClose={() => setPostMenu(null)} title={t('post.more')} actions={postActions} testID={`${ROUTE}.postSheet`} />
      <Dialog
        visible={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete?.kind === 'post' ? t('post.deleteTitle') : t('thread.deleteTitle')}
        body={confirmDelete?.kind === 'post' ? t('post.deleteBody') : t('thread.deleteBody')}
        actions={[
          { label: t('thread.cancel'), variant: 'secondary', onPress: () => setConfirmDelete(null), testID: `${ROUTE}.deleteDialog.cancel` },
          {
            label: t('thread.deleteConfirm'),
            destructive: true,
            loading: deleteThread.isPending || deletePost.isPending,
            onPress: () => {
              haptics.warning();
              if (confirmDelete?.kind === 'post') removePost(confirmDelete.post);
              else removeThread();
            },
            testID: `${ROUTE}.deleteDialog.confirm`,
          },
        ]}
        testID={`${ROUTE}.deleteDialog`}
      />
      <EditPostSheet
        post={editing}
        onClose={() => setEditing(null)}
        saving={editPost.isPending}
        onSave={(values, setError) =>
          editing &&
          editPost.mutate(
            { postId: editing.id, body: values.body.trim() },
            {
              onSuccess: () => {
                setEditing(null);
                toast(t('reply.saved'), { testID: `${ROUTE}.toast` });
              },
              onError: (error) => {
                const left = applyServerErrors(error, setError, { body: 'body' });
                if (left) toast(left, { haptic: 'warning', testID: `${ROUTE}.toast` });
              },
            },
          )
        }
      />
      <ImageViewer visible={viewer !== null} images={viewerList} initialIndex={viewer ?? 0} onClose={() => setViewer(null)} testID={`${ROUTE}.viewer`} />
      {report.element}
    </KeyboardInsetView>
  );
}

/** "Antwort bearbeiten" (the author, contract §4 #18): the reply's Markdown source in a sheet, with the discard question when changed. */
function EditPostSheet({
  post,
  onClose,
  onSave,
  saving,
}: {
  post: ForumPost | null;
  onClose: () => void;
  onSave: (values: EditValues, setError: ReturnType<typeof useForm<EditValues>>['setError']) => void;
  saving: boolean;
}) {
  const { t } = useTranslation('forum');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const [asking, setAsking] = useState(false);
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema), defaultValues: { body: '' } });
  const source = post?.body ?? '';
  useEffect(() => {
    if (post) form.reset({ body: source });
  }, [form, post, source]);
  const close = () => {
    if (form.formState.isDirty) setAsking(true);
    else onClose();
  };
  const messageOf = (code: string | undefined) => (code === 'tooLong' ? t('reply.tooLong', { max: FORUM_LIMITS.replyMax }) : code === 'empty' ? t('reply.empty') : code);
  return (
    <>
      <Sheet visible={post !== null} onClose={close} title={t('reply.editTitle')} initialSnap="full" testID={`${ROUTE}.editSheet`}>
        <View style={styles.editBody}>
          <Controller
            control={form.control}
            name="body"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('reply.field')}
                error={messageOf(fieldState.error?.message)}
                multiline
                maxRows={10}
                maxLength={FORUM_LIMITS.replyMax + 200}
                testID={`${ROUTE}.editSheet.body`}
              />
            )}
          />
          <Button label={t('reply.save')} loading={saving} onPress={() => void form.handleSubmit((values) => onSave(values, form.setError), () => haptics.warning())()} testID={`${ROUTE}.editSheet.save`} />
        </View>
      </Sheet>
      <Dialog
        visible={asking}
        onClose={() => setAsking(false)}
        title={common('discard.title')}
        body={common('discard.body')}
        actions={[
          { label: common('discard.keep'), variant: 'secondary', onPress: () => setAsking(false), testID: `${ROUTE}.editSheet.discard.keep` },
          {
            label: common('discard.confirm'),
            destructive: true,
            onPress: () => {
              setAsking(false);
              form.reset({ body: source });
              onClose();
            },
            testID: `${ROUTE}.editSheet.discard.discard`,
          },
        ]}
        testID={`${ROUTE}.editSheet.discard`}
      />
    </>
  );
}
