import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import type { Edge } from 'react-native-safe-area-context';

import { newIdempotencyKey } from '@/api/client';
import { useCloseModal } from '@/features/garage/navigation';
import { photoFields, variantUrl } from '@/features/profile/media';
import { paramOf } from '@/features/vehicle/navigation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { ViewAsModalUnavailable } from '@/features/viewAs/ViewAsModalUnavailable';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, space, useBreakpoint } from '@/theme';
import {
  Button,
  Composer,
  DiscardGuardDialog,
  EmptyState,
  ErrorState,
  Hairline,
  Header,
  IconButton,
  MemberRow,
  OfflineBanner,
  Photo,
  Screen,
  SearchBar,
  SectionHeader,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  toast,
} from '@/ui';
import { useSafeEdge, useSafeInset } from '@/ui/safeArea';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { useMessaging } from '../data';
import type { ChatVehicle, MessageCandidate } from '../model';
import { outboxFor, useMessagingMember } from '../session';
import { MESSAGE_MAX_LENGTH, takeChars } from '../text';

import { conversationHref } from './MessagingScreens';

const ROUTE = 'MSG-03';
const EDGES: readonly Edge[] = ['left', 'right'];
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX = 100;

const useStyles = createStyles((t) => ({
  root: { flex: 1 },
  column: { alignSelf: 'center', flex: 1, maxWidth: layout.feedColumn, width: '100%' },
  search: { paddingBottom: t.space[8], paddingTop: t.space[8] },
  list: { flex: 1 },
  state: { paddingTop: t.space[32] },
  // DQ-431: a section gap above "Zuletzt" (24 with the search field's 8), the §5 12 under it.
  listHeader: { paddingBottom: t.space[12], paddingTop: t.space[16] },
  to: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], minHeight: t.size.row.single },
  toText: { flex: 1, minWidth: 0 },
  vehicle: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], paddingVertical: t.space[12] },
  vehicleThumb: { width: t.size.thumb.row },
  vehicleText: { flex: 1, minWidth: 0 },
  spacer: { flex: 1 },
  sendVehicle: { alignItems: 'flex-start', paddingBottom: t.space[12] },
  note: { paddingVertical: t.space[12] },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single, paddingVertical: t.space[8] },
  skeletonText: { flex: 1 },
}));

function CandidatesSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {[0, 1, 2, 3, 4].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
          <View style={styles.skeletonText}>
            <SkeletonText variant="bodyStrong" width="50%" />
            <SkeletonText variant="supporting" width="35%" />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

function candidateName(candidate: Pick<MessageCandidate, 'displayName' | 'username'>): string {
  return candidate.displayName?.trim() || `@${candidate.username}`;
}

/**
 * MSG-03 new message (modal, contract §7): a member picker, recent conversations first, members you cannot write to disabled with
 * the reason. Picking someone you already write with goes straight to that thread; otherwise the first message is written here
 * and `POST conversations` starts (or finds) the conversation, with one Idempotency-Key per intent so a retry never sends twice.
 * Opened with `?to=username` (PROF-02 "Nachricht") the picker is skipped; with `?vehicle=slug` (VEH-01 "Fahrzeug senden") the
 * vehicle goes as a card and sets the conversation's context.
 */
export function NewMessageScreen() {
  const readOnly = useViewAsReadOnly();
  const { t } = useTranslation('messages');
  const close = useCloseModal('/messages');
  // M3.5: a view-as tab never opens messaging, also not from a "Nachricht" link that reached this modal.
  if (readOnly) return <ViewAsModalUnavailable title={t('compose.title')} onClose={close} routeId={ROUTE} />;
  return <NewMessageBody />;
}

function NewMessageBody() {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  const router = useRouter();
  const close = useCloseModal('/messages');
  const qaState = useQaState();
  const online = useOnline();
  // M3.5: a list behind another screen or tab loads no pages for nobody (code review M2.8 nit 4).
  const shown = useScreenFocused();
  const { gutter } = useBreakpoint();
  const inset = useSafeInset('bottom');
  const bottom = useSafeEdge('bottom');
  const adapter = useMessaging();
  const actions = adapter.useActions();
  const member = useMessagingMember();
  const params = useLocalSearchParams<{ to?: string; vehicle?: string; about?: string }>();
  const presetTo = paramOf(params.to);
  const vehicleSlug = paramOf(params.vehicle);
  const aboutSlug = paramOf(params.about);

  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [recipient, setRecipient] = useState<{ username: string; name: string; avatar: MessageCandidate['avatar'] } | null>(
    presetTo ? { username: presetTo, name: `@${presetTo}`, avatar: null } : null,
  );
  const [vehicleRemoved, setVehicleRemoved] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  /** One key per intent: kept across retries of the same message, new once the message or the recipient changes. */
  const intent = useRef<{ signature: string; clientId: string; key: string } | null>(null);

  useEffect(() => {
    const next = takeChars(searchText.replace(/\s+/g, ' ').trim(), SEARCH_MAX).trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => setQ(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, searchText]);

  const candidates = adapter.useCandidates(recipient ? '' : q);
  const shared = adapter.useSharedVehicle(vehicleSlug);
  const vehicle: ChatVehicle | null = vehicleRemoved ? null : (shared.data ?? null);
  // VEH-01 "Nachricht": the vehicle becomes the conversation's context card; the first message is text.
  const about = adapter.useSharedVehicle(aboutSlug).data ?? null;

  // PROF-02 "Nachricht" with nothing to send first: an existing conversation opens at once ("straight to the thread").
  const opened = useRef(false);
  const existing = presetTo && !vehicleSlug && !aboutSlug ? candidates.data?.find((item) => item.username === presetTo)?.conversationId : undefined;
  useEffect(() => {
    if (!existing || opened.current) return;
    opened.current = true;
    close();
    router.navigate(conversationHref({ id: existing, folder: 'chats' }));
  }, [close, existing, router]);

  const list = useMemo(() => (qaState === 'empty' ? [] : (candidates.data ?? [])), [candidates.data, qaState]);

  const pick = (candidate: MessageCandidate) => {
    if (!candidate.canMessage) return;
    if (candidate.conversationId && !vehicleSlug) {
      close();
      router.navigate(conversationHref({ id: candidate.conversationId, folder: 'chats' }));
      return;
    }
    setRecipient({ username: candidate.username, name: candidateName(candidate), avatar: candidate.avatar });
  };

  const send = (body: string) => {
    if (!recipient || sending) return;
    const trimmed = takeChars(body.trim(), MESSAGE_MAX_LENGTH);
    if (!vehicle && !trimmed) return;
    const signature = `${recipient.username}|${vehicle?.id ?? ''}|${about?.id ?? ''}|${trimmed}`;
    if (intent.current?.signature !== signature) intent.current = { signature, clientId: newIdempotencyKey(), key: newIdempotencyKey() };
    const { clientId, key } = intent.current;
    setSending(true);
    actions
      .start({
        recipient: recipient.username,
        vehicleId: vehicle?.id ?? about?.id ?? null,
        message: vehicle ? { kind: 'vehicle', vehicleId: vehicle.id } : { kind: 'text', body: trimmed },
        clientId,
        idempotencyKey: key,
      })
      .then(({ conversationId }) => {
        // A vehicle goes as the card; the text, when there is one, follows through the outbox like any message.
        if (vehicle && trimmed) outboxFor(member, adapter)?.enqueue(conversationId, { kind: 'text', body: trimmed });
        intent.current = null;
        setSent(true);
        setText('');
        close();
        router.navigate(conversationHref({ id: conversationId, folder: 'chats' }));
      })
      .catch((error: unknown) => {
        const failure = adapter.classify(error);
        toast(failure.message || t('compose.sendFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` });
      })
      .finally(() => setSending(false));
  };

  let state: ReactNode = null;
  if (qaState === 'restricted') {
    state = <EmptyState icon="lock-simple" title={t('compose.restrictedTitle')} body={t('compose.restrictedBody')} testID={`${ROUTE}.restricted`} />;
  } else if (!recipient) {
    if (qaState === 'loading' || (!candidates.data && candidates.isPending && qaState !== 'error')) state = <CandidatesSkeleton />;
    else if (qaState === 'error' || !candidates.data) {
      const offline = !online || candidates.isPaused;
      state = (
        <ErrorState
          title={offline ? t('thread.offlineTitle') : t('compose.errorTitle')}
          message={offline ? t('compose.offline') : undefined}
          onRetry={candidates.refetch}
          retrying={candidates.isFetching}
          testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
        />
      );
    } else if (list.length === 0) {
      state = q ? (
        <EmptyState icon="magnifying-glass" title={t('compose.noResults', { q })} body={t('compose.noResultsBody')} testID={`${ROUTE}.noResults`} />
      ) : (
        <EmptyState icon="user" title={t('compose.start')} testID={`${ROUTE}.start`} />
      );
    }
  }

  const picker = (
    <>
      <View style={[styles.search, { paddingHorizontal: gutter }]}>
        <SearchBar value={searchText} onChangeText={setSearchText} onCancel={() => setSearchText('')} placeholder={t('compose.search')} autoFocus maxLength={SEARCH_MAX} testID={`${ROUTE}.search`} />
      </View>
      <FlashList
        data={state ? [] : list}
        keyExtractor={(candidate) => candidate.username}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={!state && list.length > 0 ? <SectionHeader title={q ? t('compose.results') : t('compose.recent')} style={[styles.listHeader, { paddingHorizontal: gutter }]} testID={`${ROUTE}.listHeader`} /> : null}
        ListEmptyComponent={state ? <View style={[styles.state, { paddingHorizontal: gutter }]}>{state}</View> : null}
        onEndReached={() => {
          if (shown && candidates.hasMore && !candidates.isLoadingMore) candidates.loadMore();
        }}
        renderItem={({ item, index }) => {
          const name = candidateName(item);
          const reason = item.canMessage ? null : (item.reason ?? t('compose.cannot'));
          return (
            <View aria-disabled={!item.canMessage}>
              <MemberRow
                name={name}
                meta={reason ?? item.line ?? `@${item.username}`}
                avatarUri={variantUrl(item.avatar, size.avatar.md)}
                avatarBlurhash={item.avatar?.blurhash}
                onPress={item.canMessage ? () => pick(item) : undefined}
                divider={index < list.length - 1}
                testID={`${ROUTE}.candidate.${item.username}`}
              />
            </View>
          );
        }}
        testID={`${ROUTE}.list`}
      />
    </>
  );

  const compose = recipient ? (
    <KeyboardAvoidingView behavior="padding" automaticOffset keyboardVerticalOffset={-inset} style={styles.root}>
      <View style={{ paddingHorizontal: gutter }}>
        <View style={styles.to}>
          <Text variant="supporting" color="text.secondary">
            {t('compose.to')}
          </Text>
          <View style={styles.toText}>
            <MemberRow name={recipient.name} avatarUri={variantUrl(recipient.avatar, size.avatar.md)} inset={space[0]} testID={`${ROUTE}.recipient`} />
          </View>
          {presetTo ? null : (
            <Button
              label={t('compose.change')}
              accessibilityLabel={t('compose.changeLabel')}
              variant="tertiary"
              size="s"
              onPress={() => setRecipient(null)}
              testID={`${ROUTE}.change`}
            />
          )}
        </View>
      </View>
      <Hairline />
      {vehicle || about ? (
        <View style={[styles.vehicle, { paddingHorizontal: gutter }]} testID={`${ROUTE}.${vehicle ? 'vehicle' : 'about'}`}>
          <View style={styles.vehicleThumb}>
            <Photo aspect="1:1" corner="sm" {...photoFields((vehicle ?? about)?.cover, size.thumb.row)} />
          </View>
          <View style={styles.vehicleText}>
            <Text variant="supporting" color="text.secondary">
              {vehicle ? t('compose.vehicle') : t('compose.about')}
            </Text>
            <Text variant="bodyStrong" hyphenate={false}>
              {keepNameTogether((vehicle ?? about)?.title ?? '')}
            </Text>
          </View>
          {vehicle ? (
            <IconButton icon="x" label={t('compose.removeVehicle')} onPress={() => setVehicleRemoved(true)} testID={`${ROUTE}.removeVehicle`} />
          ) : null}
        </View>
      ) : null}
      {vehicle ? (
        <View style={[styles.sendVehicle, { paddingHorizontal: gutter }]}>
          <Button
            label={t('compose.sendVehicle')}
            size="m"
            loading={sending}
            disabled={!online}
            onPress={() => send(text)}
            testID={`${ROUTE}.sendVehicle`}
          />
        </View>
      ) : null}
      <View style={styles.spacer} />
      {online ? null : (
        <View style={[styles.note, { paddingHorizontal: gutter }]}>
          <Text variant="supporting" color="text.secondary" testID={`${ROUTE}.offlineNote`}>
            {t('compose.offline')}
          </Text>
        </View>
      )}
      <View style={bottom}>
        <Composer
          value={text}
          onChangeText={setText}
          onSend={send}
          placeholder={t('thread.composer')}
          sendLabel={t('thread.send')}
          sending={sending}
          disabled={!online}
          maxLength={MESSAGE_MAX_LENGTH}
          testID={`${ROUTE}.composer`}
        />
      </View>
    </KeyboardAvoidingView>
  ) : null;

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={t('compose.title')} onBack={close} backIcon="close" testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner label={t('compose.offline')} testID={`${ROUTE}.offline`} />}
      <View style={styles.column}>{recipient && state ? <View style={[styles.state, { paddingHorizontal: gutter }]}>{state}</View> : (compose ?? picker)}</View>
      <DiscardGuardDialog
        dirty={text.trim() !== '' && !sent}
        title={t('compose.discardTitle')}
        body={t('compose.discardBody')}
        discardLabel={t('compose.discard')}
        keepLabel={t('compose.keep')}
        testID={`${ROUTE}.discard`}
      />
    </Screen>
  );
}
