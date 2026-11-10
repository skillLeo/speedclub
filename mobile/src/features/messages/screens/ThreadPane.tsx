import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { useFlag } from '@/api/queries/appConfig';
import { pickPhotos, preparePhoto } from '@/features/garage/photos';
import { BlockDialog } from '@/features/safety/BlockDialog';
import { useRestrictionDecision } from '@/features/safety/components/DecisionLink';
import { conversationTarget, messageTarget } from '@/features/safety/targets';
import { useReport } from '@/features/safety/useReport';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Composer, Dialog, EmptyState, ErrorState, ImageViewer, OfflineBanner, Spinner, Text, toast, type ViewerImage } from '@/ui';
import { useSafeEdge, useSafeInset } from '@/ui/safeArea';
import { useScreenFocused } from '@/ui/SkeletonFocus';
import { AI_FLAGS } from '@/api/queries/ai';
import { useAiAvailable } from '@/features/ai/availability';
import { useTranslations } from '@/features/ai/translations';

import { chatPhotoUrl } from '../components/ChatPhoto';
import { MessageBubble } from '../components/MessageBubble';
import { AttachSheet, MessageActionsSheet, VehiclePickerSheet } from '../components/Sheets';
import { ThreadHeader } from '../components/ThreadHeader';
import { ComposerNote, ContextCard, DaySeparator, RequestBanner, ThreadSkeleton, TypingIndicator } from '../components/ThreadParts';
import { isConversationGone, useMessaging } from '../data';
import { threadItems, type ThreadItem } from '../grouping';
import { mergeThread, serverClientIds } from '../merge';
import type { ChatVehicle, ConversationDetail, ReactionKey, ThreadMessage } from '../model';
import { readReceiptKey, readToSend } from '../receipts';
import { THREAD_POLL_MS } from '../pollScheduler';
import { realtimeHub } from '../realtime';
import { useOutbox, useOutboxEntries, useRealtimeSession } from '../session';
import { MESSAGE_MAX_LENGTH, otherName, takeChars } from '../text';
import { foregroundSource, usePolling } from '../usePolling';
import type { Observable } from '../pollScheduler';

/** The viewer asks for the largest signed variant (1600). */
const VIEWER_WIDTH = 1600;

const NOT_LIVE: Observable<boolean> = { get: () => false, subscribe: () => () => undefined };

/** [SIG] flags (02 §5). */
export const MESSAGING_FLAGS = {
  typing: 'sig.msg_typing',
  receipts: 'sig.msg_read_receipts',
  reactions: 'sig.msg_reactions',
  organise: 'sig.msg_organize',
} as const;

/** Contract §2: the server keeps `typing_until` 5 s; one signal every 4 s keeps it alive while the member types. */
const TYPING_EVERY_MS = 4_000;
/** The typing line goes once nothing renewed it for this long. */
const TYPING_SHOWN_MS = 6_000;

const useStyles = createStyles((t) => ({
  root: { backgroundColor: t.color.bg.canvas, flex: 1 },
  list: { flex: 1 },
  // While the messages load, the skeleton takes the list's place and height, its bubbles at the bottom as the inverted list's.
  skeletonBox: { flex: 1, justifyContent: 'flex-end' },
  state: { flex: 1, justifyContent: 'center', paddingBottom: t.space[48] },
  older: { alignItems: 'center', gap: t.space[8], paddingVertical: t.space[16] },
  listEnd: { paddingTop: t.space[16] },
  listStart: { paddingBottom: t.space[8] },
  composer: { backgroundColor: t.color.bg.canvas },
  empty: { alignItems: 'center', paddingVertical: t.space[32] },
}));

export type ThreadPaneProps = {
  conversationId: string | undefined;
  /** `ROUTE-ID` for test ids: MSG-02 or MSG-04. */
  routeId: string;
  /** The web split view puts the list beside the thread: no back there. */
  onBack?: () => void;
  /** MSG-05; the split view opens it as a pushed page too. */
  onInfo?: (conversationId: string) => void;
  /** After accept, decline, block or delete: where to go. */
  onLeave: () => void;
  /** M2.6's report flow. Until it exists no "Melden" row is offered. */
  onReport?: (message: ThreadMessage) => void;
};

type ThreadViewProps = {
  conversation: ConversationDetail;
  routeId: string;
  gutter: number;
};

/**
 * MSG-02 (FS-7) and MSG-04 (its request mode), the body of both routes and of the web split view. Instant and safe:
 * - your message shows the moment you send it (outbox), with "Erneut senden" when it did not go out and an offline queue;
 * - polling every 3 s while the thread is on screen and the app in front, a 30 s safety net with realtime;
 * - a request is never marked read, and its read state never shows ("Gelesen" needs `other_read_message_id`, which the server
 *   sends only when both send receipts, and the client checks the folder again);
 * - block is reachable from the request banner and from MSG-05 (info), report from every message of the other member (M2.6).
 */
export function ThreadPane({ conversationId, routeId, onBack, onInfo, onLeave, onReport }: ThreadPaneProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const router = useRouter();
  const adapter = useMessaging();
  const qaState = useQaState();
  const online = useOnline();
  const { gutter } = useBreakpoint();
  useRealtimeSession(adapter);
  const conversation = adapter.useConversation(conversationId);

  const openVehicle = useCallback((vehicle: ChatVehicle) => router.push({ pathname: '/v/[slug]', params: { slug: vehicle.slug } }), [router]);
  // DQ-439: qaState=empty is the real conversation with no messages yet: the empty line and the composer. "Gone" stays the answer
  // of the server alone (404/410).
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted' || qaState === 'empty';
  const loaded = live ? conversation.data : undefined;
  // DQ-416: qaState=restricted is the real thread, read-only, with the restriction note and its decision link in the composer's place.
  const data = useMemo(
    () => (loaded && qaState === 'restricted' ? { ...loaded, canSend: false, cannotSendReason: 'restricted' as const } : loaded),
    [loaded, qaState],
  );
  const name = data ? otherName(data, t) : '';

  let state: ReactNode = null;
  const loading = qaState === 'loading' || (!data && conversation.isPending && qaState !== 'error');
  if (loading) {
    state = <ThreadSkeleton gutter={gutter} testID={`${routeId}.skeleton`} />;
  } else if (!data && isConversationGone(conversation.error)) {
    state = (
      <View style={styles.state}>
        <EmptyState
          icon="chat-circle"
          title={t('thread.goneTitle')}
          body={t('thread.goneBody')}
          action={{ label: t('thread.goneAction'), onPress: onLeave, variant: 'secondary', size: 'm' }}
          testID={`${routeId}.gone`}
        />
      </View>
    );
  } else if (!data) {
    const offline = !online || conversation.isPaused;
    state = (
      <View style={styles.state}>
        <ErrorState
          title={offline ? t('thread.offlineTitle') : t('thread.errorTitle')}
          message={offline ? t('thread.offlineBody') : undefined}
          onRetry={conversation.refetch}
          retrying={conversation.isFetching}
          testID={`${routeId}.${offline ? 'offline' : 'error'}`}
        />
      </View>
    );
  }

  return (
    <View style={styles.root} testID={`${routeId}.root`}>
      <ThreadHeader
        member={data && !data.otherDeleted ? data.other : null}
        name={name}
        onBack={onBack}
        onOpenMember={data?.other && !data.otherDeleted ? () => router.push({ pathname: '/u/[username]', params: { username: data.other?.username ?? '' } }) : undefined}
        onInfo={data && onInfo && conversationId ? () => onInfo(conversationId) : undefined}
        loading={loading}
        testID={`${routeId}.header`}
      />
      {online ? null : <OfflineBanner label={t('offlineBanner')} testID={`${routeId}.offlineBanner`} />}
      {state ?? (data ? <ThreadView conversation={data} routeId={routeId} gutter={gutter} onLeave={onLeave} onReport={onReport} onOpenVehicle={openVehicle} /> : null)}
    </View>
  );
}

function ThreadView({
  conversation,
  routeId,
  gutter,
  onLeave,
  onReport,
  onOpenVehicle,
}: ThreadViewProps & { onLeave: () => void; onReport?: (message: ThreadMessage) => void; onOpenVehicle: (vehicle: ChatVehicle) => void }) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const format = useFormat();
  const adapter = useMessaging();
  const actions = adapter.useActions();
  const outbox = useOutbox(adapter);
  const id = conversation.id;
  const thread = adapter.useThread(id);
  const pending = useOutboxEntries(outbox, id);
  const online = useOnline();
  // M3.5: a list behind another screen or tab loads no pages for nobody (code review M2.8 nit 4).
  const shown = useScreenFocused();
  const inset = useSafeInset('bottom');
  const bottom = useSafeEdge('bottom');
  const typingFlag = useFlag(MESSAGING_FLAGS.typing);
  const receiptsFlag = useFlag(MESSAGING_FLAGS.receipts);
  const reactionsFlag = useFlag(MESSAGING_FLAGS.reactions);
  // M3.7 ai.translate: "Übersetzen" in a message's actions, the translation in its bubble with "Übersetzt · Original anzeigen".
  const translateOn = useAiAvailable(AI_FLAGS.translate);
  const translations = useTranslations('message', `${routeId}.message`);
  const { toggle: toggleTranslationOf } = translations;
  const toggleTranslation = useCallback(
    (message: ThreadMessage) => {
      if (message.id) toggleTranslationOf(message.id);
    },
    [toggleTranslationOf],
  );
  const request = conversation.folder === 'requests';
  const name = otherName(conversation, t);
  const listRef = useRef<FlashListRef<ThreadItem>>(null);
  const listPadding = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(true);
  const [acting, setActing] = useState<ThreadMessage | null>(null);
  const [attach, setAttach] = useState(false);
  const [pickVehicle, setPickVehicle] = useState(false);
  const [viewer, setViewer] = useState<ViewerImage | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  /** A realtime typing event: the line shows until nothing renews it for TYPING_SHOWN_MS. */
  const [typingSeen, setTypingSeen] = useState(0);
  const [typingEvent, setTypingEvent] = useState(false);
  const lastRead = useRef<string | null>(null);
  const lastTyping = useRef(0);
  const vehicles = adapter.useOwnVehicles();

  const { refresh: refreshThread } = thread;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // Back on screen: the newest page again, so reactions, removals and hidden messages are current (review 7).
      const controller = new AbortController();
      refreshThread(controller.signal).catch(() => undefined);
      return () => {
        controller.abort();
        setFocused(false);
      };
    }, [refreshThread]),
  );
  // Read state goes out only while the app is in front and the web tab visible (review 12).
  const inFront = useSyncExternalStore(foregroundSource.subscribe, foregroundSource.get, () => true);

  const qaEmpty = useQaState() === 'empty';
  const server = useMemo(() => (qaEmpty ? [] : (thread.data ?? [])), [qaEmpty, thread.data]);
  // M2.6: "Melden" on a message of the other member, and "Blockieren und melden" on a request; a block leaves the thread.
  const otherUsername = conversation.other?.username ?? null;
  const report = useReport(null, { routeId, onBlocked: () => onLeave() });
  const restrictionDecision = useRestrictionDecision('messaging');
  const reportMessage = onReport ?? (report.available ? (message: ThreadMessage) => {
    const target = messageTarget(message, otherUsername);
    if (target) report.openFor(target);
  } : undefined);
  const requestTarget = request ? conversationTarget(server, otherUsername) : null;
  // The server's copy is here: the outbox entry is done, whatever state it was in.
  useEffect(() => {
    outbox?.reconcile(id, serverClientIds(server));
  }, [id, outbox, server]);

  const merged = useMemo(() => mergeThread(server, pending), [pending, server]);
  const items = useMemo(
    () => threadItems(merged, now(), format.locale, { today: t('days.today'), yesterday: t('days.yesterday') }),
    [format.locale, merged, t],
  );
  const receiptKey = receiptsFlag ? readReceiptKey({ folder: conversation.folder, otherReadMessageId: conversation.otherReadMessageId, messages: merged }) : null;
  // Only what the server's reads have shown in full may be marked read, never an id a send answer brought (review 2, 12).
  const readUpTo = thread.readUpTo;

  // Polling always works without Pusher (contract §3); `pollNewer` also refreshes the conversation (typing, read mark).
  const poll = useCallback(
    async (signal: AbortSignal) => {
      const ids = await thread.pollNewer(signal);
      outbox?.reconcile(id, ids);
    },
    [id, outbox, thread],
  );
  // A request (MSG-04) subscribes no conversation channel (review 10): nothing in it is broadcast, and it polls at full pace.
  const live = useMemo(() => (request ? NOT_LIVE : realtimeHub.channelLive(`conversation.${id}`)), [id, request]);
  const poke = usePolling(poll, THREAD_POLL_MS, focused && Boolean(thread.data), live);

  useEffect(() => {
    if (!focused || request) return undefined;
    return realtimeHub.watchConversation(id, {
      onMessage: poke,
      onRead: poke,
      onTyping: () => {
        setTypingEvent(true);
        setTypingSeen((count) => count + 1);
      },
    });
  }, [focused, id, poke, request]);

  // Read up to what the server showed, never in a request (MSG-04), only while the thread is on screen and the app in front.
  useEffect(() => {
    const next = readToSend({ folder: conversation.folder, newestId: readUpTo, lastSentId: lastRead.current, visible: focused && inFront });
    if (!next) return;
    lastRead.current = next;
    actions.markRead(id, next).catch(() => {
      lastRead.current = null;
    });
  }, [actions, conversation.folder, focused, id, inFront, readUpTo]);

  // The typing line from the server's flag (polling) or a realtime event; it ends by itself.
  const otherTyping = typingFlag && !request && (conversation.otherTyping || typingEvent);
  useEffect(() => {
    if (typingSeen === 0) return undefined;
    const timer = setTimeout(() => setTypingEvent(false), TYPING_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [typingSeen]);

  // `request_pending`: your request is out and unanswered, a second message would be 409 (handover §2).
  const waiting = conversation.requestPending || pending.some((entry) => entry.failure?.reason === 'request_pending');
  const canWrite = conversation.canSend && !waiting && !request && Boolean(outbox);
  const onChangeText = (next: string) => {
    setText(next);
    if (!typingFlag || !canWrite || next.trim() === '') return;
    const at = Date.now();
    if (at - lastTyping.current < TYPING_EVERY_MS) return;
    lastTyping.current = at;
    actions.typing(id).catch(() => undefined);
  };

  const scrollToNewest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
  const send = (body: string) => {
    if (!outbox) return;
    outbox.enqueue(id, { kind: 'text', body: takeChars(body, MESSAGE_MAX_LENGTH) });
    setText('');
    lastTyping.current = 0;
    scrollToNewest();
  };
  const sendPhoto = async () => {
    try {
      const picked = await pickPhotos(1);
      const photo = picked?.[0];
      if (!photo || !outbox) return;
      const uri = await preparePhoto(photo);
      outbox.enqueue(id, { kind: 'photo', photo: { uri, width: photo.width, height: photo.height }, mediaId: null });
      scrollToNewest();
    } catch {
      toast(t('attach.photoFailed'), { haptic: 'warning', testID: `${routeId}.toast` });
    }
  };
  const sendVehicle = (vehicle: ChatVehicle) => {
    outbox?.enqueue(id, { kind: 'vehicle', vehicle });
    scrollToNewest();
  };

  const react = useCallback(
    (message: ThreadMessage, key: ReactionKey | null) => {
      if (!message.id) return;
      actions.react(id, message.id, key).catch(() => toast(t('actions.failed'), { haptic: 'warning', testID: `${routeId}.toast` }));
    },
    [actions, id, routeId, t],
  );
  const openPhoto = useCallback(
    (message: ThreadMessage) => {
      const uri = message.media ? chatPhotoUrl(message.media, VIEWER_WIDTH) : message.localPhoto?.uri;
      if (typeof uri !== 'string') return;
      // Chat photos stay out of the image disk cache (review 6).
      setViewer({ uri, blurhash: message.media?.blurhash ?? undefined, alt: t('thread.photo'), cachePolicy: 'memory' });
    },
    [setViewer, t],
  );
  // ADR-208: a signed chat photo URL lives 10–20 minutes. One that fails reads the newest page once for fresh URLs; the same URL
  // never twice, so a photo that is really gone does not loop.
  const refreshedFor = useRef(new Set<string>());
  const photoFailed = useCallback(
    (message: ThreadMessage) => {
      const uri = chatPhotoUrl(message.media, size.thumb.card * 4);
      if (!uri || refreshedFor.current.has(uri)) return;
      refreshedFor.current.add(uri);
      thread.refresh(new AbortController().signal).catch(() => undefined);
    },
    [thread],
  );
  const retry = useCallback((clientId: string) => outbox?.retry(clientId), [outbox]);
  const remove = useCallback((clientId: string) => outbox?.remove(clientId), [outbox]);

  const accept = () => {
    setBusy('accept');
    actions
      .accept(id)
      .then(() => toast(t('request.accepted'), { testID: `${routeId}.toast` }))
      .catch(() => toast(t('request.failed'), { haptic: 'warning', testID: `${routeId}.toast` }))
      .finally(() => setBusy(null));
  };
  const decline = () => {
    setDeclining(false);
    setBusy('decline');
    actions
      .decline(id)
      .then(() => {
        toast(t('request.declined'), { testID: `${routeId}.toast` });
        onLeave();
      })
      .catch(() => toast(t('request.failed'), { haptic: 'warning', testID: `${routeId}.toast` }))
      .finally(() => setBusy(null));
  };

  let composer: ReactNode;
  if (request) composer = null;
  else if (waiting || !conversation.canSend) {
    const note = waiting
      ? t('thread.requestPending', { name })
      : conversation.cannotSendReason === 'not_verified'
        ? t('thread.notVerified')
        : conversation.cannotSendReason === 'restricted'
          ? t('thread.restricted')
          : t('thread.closed');
    composer = (
      <ComposerNote
        text={note}
        gutter={gutter}
        decisionId={!waiting && conversation.cannotSendReason === 'restricted' ? restrictionDecision : null}
        testID={`${routeId}.${waiting ? 'requestPending' : 'closed'}`}
      />
    );
  } else {
    composer = (
      <View style={[styles.composer, bottom]}>
        <Composer
          value={text}
          onChangeText={onChangeText}
          onSend={send}
          placeholder={t('thread.composer')}
          sendLabel={t('thread.send')}
          onAttach={() => setAttach(true)}
          attachLabel={t('thread.attach')}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={!canWrite}
          testID={`${routeId}.composer`}
        />
      </View>
    );
  }

  const header = (
    <>
      {request ? (
        <RequestBanner
          username={conversation.other && !conversation.otherDeleted ? conversation.other.username : null}
          name={name}
          gutter={gutter}
          busy={busy}
          onAccept={accept}
          onDecline={() => setDeclining(true)}
          onBlock={() => (requestTarget && report.available ? report.openBlockAndReportFor(requestTarget) : setBlocking(otherUsername))}
          blockLabel={requestTarget && report.available ? report.blockAndReportLabel : undefined}
          testID={`${routeId}.request`}
        />
      ) : null}
      {conversation.contextVehicle && !request ? (
        <ContextCard vehicle={conversation.contextVehicle} gutter={gutter} onOpen={onOpenVehicle} testID={`${routeId}.context`} />
      ) : null}
    </>
  );

  let body: ReactNode;
  // The composer stands where it will stay from the first frame: under a skeleton that fills the list's height, not under five
  // bars at the top. It jumped down by the list's height when the messages came, under a pointer already on "+" (F5 WebKit:
  // the attach sheet never opened, M2.8).
  if (!thread.data && thread.isPending) {
    body = (
      <View style={styles.skeletonBox}>
        <ThreadSkeleton gutter={gutter} testID={`${routeId}.skeleton`} />
      </View>
    );
  }
  else if (!thread.data) {
    body = (
      <View style={styles.state}>
        <ErrorState
          title={!online || thread.isPaused ? t('thread.offlineTitle') : t('thread.errorTitle')}
          onRetry={thread.refetch}
          retrying={thread.isFetching}
          testID={`${routeId}.threadError`}
        />
      </View>
    );
  } else {
    body = (
      <FlashList
        ref={listRef}
        inverted
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        extraData={[receiptKey, translations.states]}
        style={styles.list}
        contentContainerStyle={listPadding}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onEndReached={() => {
          if (shown && thread.hasMore && !thread.isLoadingMore && !thread.error) thread.loadMore();
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.listStart}>{otherTyping ? <TypingIndicator name={name} testID={`${routeId}.typing`} /> : null}</View>
        }
        ListFooterComponent={
          <View style={styles.listEnd}>
            {thread.isLoadingMore ? (
              <View style={styles.older}>
                <Spinner testID={`${routeId}.older`} />
              </View>
            ) : thread.error && thread.hasMore ? (
              <View style={styles.older}>
                <Text variant="supporting" color="text.secondary">
                  {t('thread.olderError')}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="supporting" color="text.secondary" testID={`${routeId}.empty`}>
              {/* DQ-450: a request has no composer yet, so its empty line does not invite a first message. */}
              {t(request ? 'thread.emptyRequest' : 'thread.empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) =>
          item.type === 'day' ? (
            <DaySeparator label={item.label} testID={`${routeId}.${item.key}`} />
          ) : (
            <MessageBubble
              item={item}
              receipt={item.key === receiptKey}
              otherName={name}
              animateIn={item.message.delivery !== 'sent'}
              reactions={reactionsFlag}
              onActions={setActing}
              onRetry={retry}
              onRemove={remove}
              onOpenPhoto={openPhoto}
              onOpenVehicle={onOpenVehicle}
              onReact={react}
              onPhotoFailed={photoFailed}
              translation={item.message.id ? translations.states[item.message.id] : undefined}
              onToggleTranslation={toggleTranslation}
              testID={`${routeId}.message.${item.key}`}
            />
          )
        }
        testID={`${routeId}.list`}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset keyboardVerticalOffset={-inset} style={styles.list}>
      {header}
      {body}
      {composer}
      <AttachSheet
        visible={attach}
        onClose={() => setAttach(false)}
        onPhoto={() => void sendPhoto()}
        onVehicle={() => setPickVehicle(true)}
        testID={`${routeId}.attach`}
      />
      <VehiclePickerSheet visible={pickVehicle} onClose={() => setPickVehicle(false)} vehicles={vehicles} onPick={sendVehicle} testID={`${routeId}.vehicles`} />
      <MessageActionsSheet
        message={acting}
        onClose={() => setActing(null)}
        reactions={reactionsFlag}
        onReact={react}
        onCopy={(message) => {
          void Clipboard.setStringAsync(message.body ?? '').then(() => toast(t('actions.copied'), { testID: `${routeId}.toast` }));
        }}
        onHide={(message) => {
          if (!message.id) return;
          actions
            .hideMessage(id, message.id)
            .then(() => toast(t('actions.hidden'), { testID: `${routeId}.toast` }))
            .catch(() => toast(t('actions.failed'), { haptic: 'warning', testID: `${routeId}.toast` }));
        }}
        onTranslate={translateOn && !translations.hidden ? toggleTranslation : undefined}
        onReport={reportMessage}
        onOpenPhoto={openPhoto}
        onOpenVehicle={onOpenVehicle}
        testID={`${routeId}.actions`}
      />
      <Dialog
        visible={declining}
        onClose={() => setDeclining(false)}
        title={t('request.declineTitle')}
        body={t('request.declineBody', { name })}
        testID={`${routeId}.declineDialog`}
        actions={[
          { label: t('request.cancel'), variant: 'secondary', onPress: () => setDeclining(false), testID: `${routeId}.declineDialog.cancel` },
          { label: t('request.decline'), destructive: true, onPress: decline, testID: `${routeId}.declineDialog.confirm` },
        ]}
      />
      <BlockDialog username={blocking} onClose={() => setBlocking(null)} onBlocked={() => onLeave()} testID={`${routeId}.blockDialog`} />
      {report.element}
      <ImageViewer visible={viewer !== null} images={viewer ? [viewer] : []} onClose={() => setViewer(null)} testID={`${routeId}.viewer`} />
    </KeyboardAvoidingView>
  );
}
