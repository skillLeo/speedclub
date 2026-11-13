import type { FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useTabScrollToTop } from '@/features/shell/retap';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import {
  CollapsingFlashList,
  Dialog,
  EmptyState,
  ErrorState,
  Header,
  HeaderLargeTitle,
  ListRow,
  OfflineBanner,
  SearchBar,
  SegmentedControl,
  Spinner,
  toast,
  useCollapsingHeader,
  type HeaderAction,
} from '@/ui';
import { SwipeRow, type SwipeAction } from '@/ui/motion/kit';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { ConversationRow, ConversationRowsSkeleton } from '../components/ConversationRow';
import { SampleConversations } from '../components/SampleConversations';
import { MuteSheet, muteChange, OrganiseSheet } from '../components/Sheets';
import { useMessaging, type OrganisePatch } from '../data';
import { MESSAGE_GLYPHS } from '../glyphs';
import { compareConversations, isMuted, type ConversationSummary, type Folder } from '../model';
import { INBOX_POLL_MS } from '../pollScheduler';
import { realtimeHub } from '../realtime';
import { useMessagingMember, useRealtimeSession } from '../session';
import { otherName, takeChars } from '../text';
import { usePolling } from '../usePolling';

import { MESSAGING_FLAGS } from './ThreadPane';

const ROUTE = 'MSG-01';
/** Typing settles before the search goes out, as on PROF-04. */
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX = 100;

type Row = { kind: 'conversation'; conversation: ConversationSummary } | { kind: 'archived' } | { kind: 'state' };

const useStyles = createStyles((t) => ({
  root: { flex: 1 },
  list: { flex: 1 },
  controls: { gap: t.space[8], paddingBottom: t.space[8] },
  state: { paddingTop: t.space[32] },
  more: { alignItems: 'center', paddingVertical: t.space[16] },
  end: { paddingBottom: t.space[32] },
  archived: { marginTop: t.space[16] },
}));

export type InboxPaneProps = {
  folder: Folder;
  onFolder: (folder: 'chats' | 'requests') => void;
  /** The conversation open beside the list (web split view). */
  selectedId?: string;
  onOpen: (conversation: ConversationSummary) => void;
  /** Archiviert is a pushed page with back; the tab root has none. */
  onBack?: () => void;
};

/** "Nichts für q" while searching; otherwise the folder's own empty state. */
function emptyFor(folder: Folder, q: string): 'noResults' | 'emptyChats' | 'emptyRequests' | 'emptyArchived' {
  if (q) return 'noResults';
  return folder === 'requests' ? 'emptyRequests' : folder === 'archived' ? 'emptyArchived' : 'emptyChats';
}

/**
 * MSG-01's list (contract §7): large title "Nachrichten" with the new-message action, content tabs "Chats · Anfragen (n)", the
 * search field [SIG organise], rows, and "Archiviert" at the end. Polls every 15 s in front (the badge counts come along), and
 * at once on a realtime event. The phone screen shows it alone; the web from 1280 puts the thread beside it.
 */
export function InboxPane({ folder, onFolder, selectedId, onOpen, onBack }: InboxPaneProps) {
  const { t } = useTranslation('messages');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const motion = useMotionPreference();
  const qaState = useQaState();
  const online = useOnline();
  // M3.5: a list behind another screen or tab loads no pages for nobody (code review M2.8 nit 4).
  const shown = useScreenFocused();
  const status = useSessionStore((state) => state.status);
  const adapter = useMessaging();
  const actions = adapter.useActions();
  const organiseFlag = useFlag(MESSAGING_FLAGS.organise);
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const { gutter } = useBreakpoint();
  const listRef = useRef<FlashListRef<Row>>(null);
  const { forget } = useRetainedListScroll(listRef);
  useRealtimeSession(adapter);
  const member = useMessagingMember();
  // The inbox slows down only while its own `private-user` subscription is confirmed (review 9).
  const userChannel = useMemo(() => (member ? realtimeHub.channelLive(`user.${member}`) : realtimeHub.status), [member]);

  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [organising, setOrganising] = useState<ConversationSummary | null>(null);
  const [muting, setMuting] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);

  useEffect(() => {
    const next = takeChars(text.replace(/\s+/g, ' ').trim(), SEARCH_MAX).trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => setQ(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, text]);

  const query = adapter.useInbox(folder, organiseFlag ? q : '');
  const counts = adapter.useCounts();
  const signedIn = status === 'member';

  usePolling(
    useCallback(() => actions.refreshInbox(), [actions]),
    INBOX_POLL_MS,
    signedIn && Boolean(query.data),
    userChannel,
  );
  useEffect(() => {
    if (!signedIn) return undefined;
    const refresh = () => void actions.refreshInbox();
    return realtimeHub.watchUser({ onMessage: refresh, onUnreadChanged: refresh });
  }, [actions, signedIn]);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    forget();
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  // A new folder or search starts at its top.
  useEffect(() => {
    forget();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [folder, forget, q]);

  const conversations = useMemo(
    () => (qaState === 'empty' ? [] : [...(query.data ?? [])].sort(compareConversations)),
    [qaState, query.data],
  );
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = conversations.map((conversation) => ({ kind: 'conversation', conversation }));
    if (folder === 'chats' && !q && organiseFlag) list.push({ kind: 'archived' });
    return list;
  }, [conversations, folder, organiseFlag, q]);

  const organise = (conversation: ConversationSummary, patch: OrganisePatch, done: string, undo?: OrganisePatch) => {
    actions
      .organise(conversation.id, patch)
      .then(() =>
        toast(t(done), {
          testID: `${ROUTE}.toast`,
          ...(undo ? { undo: () => void actions.organise(conversation.id, undo).catch(() => toast(t('organise.failed'), { haptic: 'warning' })) } : {}),
        }),
      )
      .catch(() => toast(t('organise.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }));
  };
  const remove = () => {
    const conversation = deleting;
    setDeleting(null);
    if (!conversation) return;
    // A request is declined, never deleted (review 1): `deleteConversation` declines it, and the copy says so.
    const request = conversation.folder === 'requests';
    actions
      .deleteConversation(conversation.id)
      .then(() => toast(t(request ? 'request.declined' : 'organise.deleted'), { testID: `${ROUTE}.toast` }))
      .catch(() => toast(t('organise.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }));
  };

  // SM11 (09 §7.8): Stummschalten · Archivieren · Löschen behind a left swipe, native only (ADR-438 c: on the web the hidden
  // actions overlapped the row); the more button and the organise sheet stay the way there and for screen readers.
  const swipeActions = (conversation: ConversationSummary): SwipeAction[] => {
    const muted = isMuted(conversation, now());
    const archived = Boolean(conversation.archivedAt);
    return [
      muted
        ? { key: 'unmute', label: t('swipe.unmute'), icon: 'bell', onPress: () => organise(conversation, { mute: 'off' }, 'organise.unmuted') }
        : { key: 'mute', label: t('swipe.mute'), icon: MESSAGE_GLYPHS.muted, onPress: () => setMuting(conversation) },
      {
        key: 'archive',
        label: archived ? t('swipe.unarchive') : t('swipe.archive'),
        icon: MESSAGE_GLYPHS.archive,
        onPress: () => organise(conversation, { archived: !archived }, archived ? 'organise.unarchived' : 'organise.archived', { archived }),
      },
      { key: 'delete', label: t('swipe.delete'), icon: MESSAGE_GLYPHS.delete, tone: 'destructive', onPress: () => setDeleting(conversation) },
    ];
  };

  let state: ReactNode = null;
  // The folder is empty, not failed or loading: "Archiviert" stays under its empty state, the only way to chats that were all
  // archived (M2.8).
  let emptyFolder = false;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="chats"
        title={t('inbox.guestTitle')}
        body={t('inbox.guestBody')}
        action={{
          label: t('inbox.signIn'),
          onPress: () => {
            clearAuthIntent();
            router.push({ pathname: '/auth/email', params: { returnTo: '/messages' } });
          },
        }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (qaState === 'restricted' || query.error?.kind === 'restricted') {
    state = <EmptyState icon="lock-simple" title={t('inbox.restrictedTitle')} body={t('inbox.restrictedBody')} testID={`${ROUTE}.restricted`} />;
  } else if (qaState === 'loading' || status === 'loading' || (!query.data && query.isPending && qaState !== 'error')) {
    state = <ConversationRowsSkeleton inset={gutter} testID={`${ROUTE}.skeleton`} />;
  } else if (qaState === 'error' || !query.data) {
    const offline = qaState !== 'error' && (!online || query.isPaused);
    state = (
      <ErrorState
        title={offline ? t('inbox.offlineTitle') : t('inbox.errorTitle')}
        message={offline ? t('inbox.offlineBody') : undefined}
        onRetry={query.refetch}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (conversations.length === 0) {
    emptyFolder = true;
    const key = emptyFor(folder, q);
    state =
      key === 'noResults' ? (
        <EmptyState icon="magnifying-glass" title={t('inbox.noResults', { q })} body={t('inbox.noResultsBody')} testID={`${ROUTE}.noResults`} />
      ) : (
        <EmptyState
          // DQ-1033: the empty inbox previews two badged sample rows; requests and the archive keep their quiet line.
          icon={key === 'emptyChats' ? undefined : 'chats'}
          preview={key === 'emptyChats' ? <SampleConversations testID={`${ROUTE}.emptyChats.sample`} /> : undefined}
          title={t(`inbox.${key}.title`)}
          body={t(`inbox.${key}.body`)}
          action={key === 'emptyChats' ? { label: t('inbox.emptyChats.action'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' } : undefined}
          testID={`${ROUTE}.${key}`}
        />
      );
  }

  const stateView = state ? <View style={[styles.state, { paddingHorizontal: gutter }]}>{state}</View> : null;
  const keepsArchived = emptyFolder && rows.some((row) => row.kind === 'archived');
  const listRows: Row[] = !state ? rows : keepsArchived ? [{ kind: 'state' }, { kind: 'archived' }] : [];

  const title = folder === 'archived' ? t('inbox.archivedTitle') : common('tabs.messages');
  const headerActions: HeaderAction[] =
    signedIn && folder !== 'archived'
      ? [{ icon: 'plus', label: t('inbox.newMessage'), onPress: () => router.push('/new-message'), testID: `${ROUTE}.new` }]
      : [];
  const requestsLabel = counts.requests > 0 ? t('inbox.requestsCount', { value: format.number(counts.requests) }) : t('inbox.requests');
  const showControls = signedIn && qaState !== 'restricted' && query.error?.kind !== 'restricted';

  const top = (
    <View>
      {onBack ? null : <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />}
      {showControls ? (
        <View style={[styles.controls, { paddingHorizontal: gutter }]}>
          {organiseFlag && folder !== 'requests' ? (
            <SearchBar value={text} onChangeText={setText} onCancel={() => setText('')} placeholder={t('inbox.search')} maxLength={SEARCH_MAX} testID={`${ROUTE}.search`} />
          ) : null}
          {folder !== 'archived' ? (
            // 09 §7.8: SearchField, then the SegmentedControl "Chats · Anfragen (2)".
            <SegmentedControl
              options={[
                { value: 'chats' as const, label: t('inbox.chats') },
                { value: 'requests' as const, label: requestsLabel },
              ]}
              value={folder === 'requests' ? 'requests' : 'chats'}
              onChange={onFolder}
              label={t('inbox.tabsLabel')}
              role="tablist"
              testID={`${ROUTE}.tabs`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <Header
        variant={onBack ? 'compact' : 'large'}
        title={title}
        scroll={header}
        onBack={onBack}
        actions={headerActions}
        testID={`${ROUTE}.header`}
      />
      {online ? null : <OfflineBanner label={t('offlineBanner')} testID={`${ROUTE}.offlineBanner`} />}
      <CollapsingFlashList
        ref={listRef}
        {...header.scrollProps}
        data={listRows}
        keyExtractor={(row: Row) => (row.kind === 'conversation' ? row.conversation.id : row.kind)}
        getItemType={(row: Row) => row.kind}
        extraData={`${selectedId ?? ''}|${organiseFlag}`}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: inset }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={top}
        ListEmptyComponent={state && listRows.length === 0 ? stateView : null}
        ListFooterComponent={
          <View style={styles.end}>
            {query.isLoadingMore ? (
              <View style={styles.more}>
                <Spinner testID={`${ROUTE}.more`} />
              </View>
            ) : null}
          </View>
        }
        onEndReached={() => {
          if (shown && query.hasMore && !query.isLoadingMore && !query.error) query.loadMore();
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item, index }: { item: Row; index: number }) =>
          item.kind === 'state' ? (
            stateView
          ) : item.kind === 'archived' ? (
            <ListRow
              title={t('inbox.archived')}
              icon={MESSAGE_GLYPHS.archive}
              onPress={() => router.push({ pathname: '/messages', params: { folder: 'archived' } })}
              style={styles.archived}
              testID={`${ROUTE}.archived`}
            />
          ) : (
            <SwipeableConversation
              conversation={item.conversation}
              swipe={organiseFlag && !isWeb && folder !== 'requests'}
              actions={swipeActions(item.conversation)}
              label={otherName(item.conversation, t)}
              onOpen={onOpen}
              testID={`${ROUTE}.row.${item.conversation.id}`}
            >
              <ConversationRow
                conversation={item.conversation}
                selected={item.conversation.id === selectedId}
                divider={index < conversations.length - 1}
                inset={gutter}
                organise={organiseFlag}
                onOpen={onOpen}
                onMore={setOrganising}
                testID={`${ROUTE}.row.${item.conversation.id}`}
              />
            </SwipeableConversation>
          )
        }
        testID={`${ROUTE}.list`}
      />
      <OrganiseSheet
        conversation={organising}
        name={organising ? otherName(organising, t) : ''}
        onClose={() => setOrganising(null)}
        onPin={(conversation, pinned) => organise(conversation, { pinned }, pinned ? 'organise.pinned' : 'organise.unpinned')}
        onMute={setMuting}
        onUnmute={(conversation) => organise(conversation, { mute: 'off' }, 'organise.unmuted')}
        onArchive={(conversation, archived) =>
          organise(conversation, { archived }, archived ? 'organise.archived' : 'organise.unarchived', { archived: !archived })
        }
        onDelete={setDeleting}
        testID={`${ROUTE}.organise`}
      />
      <MuteSheet
        visible={muting !== null}
        onClose={() => setMuting(null)}
        onChoose={(choice) => {
          if (muting) organise(muting, { mute: muteChange(choice, now()) }, 'organise.muted');
        }}
        testID={`${ROUTE}.mute`}
      />
      <Dialog
        visible={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting?.folder === 'requests' ? t('request.declineTitle') : t('organise.deleteTitle')}
        body={t(deleting?.folder === 'requests' ? 'request.declineBody' : 'organise.deleteBody', { name: deleting ? otherName(deleting, t) : '' })}
        testID={`${ROUTE}.deleteDialog`}
        actions={[
          { label: t('organise.cancel'), variant: 'secondary', onPress: () => setDeleting(null), testID: `${ROUTE}.deleteDialog.cancel` },
          { label: t('organise.delete'), destructive: true, onPress: remove, testID: `${ROUTE}.deleteDialog.confirm` },
        ]}
      />
    </View>
  );
}

/** A conversation row behind SM11 swipe actions where they apply; otherwise the row as it is. */
function SwipeableConversation({
  conversation,
  swipe,
  actions,
  label,
  onOpen,
  children,
  testID,
}: {
  conversation: ConversationSummary;
  swipe: boolean;
  actions: readonly SwipeAction[];
  label: string;
  onOpen: (conversation: ConversationSummary) => void;
  children: ReactNode;
  testID: string;
}) {
  if (!swipe) return <>{children}</>;
  return (
    <SwipeRow actions={actions} label={label} onPress={() => onOpen(conversation)} ground="canvas" testID={`${testID}.swipe`}>
      {children}
    </SwipeRow>
  );
}
