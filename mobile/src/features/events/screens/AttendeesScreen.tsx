import '@/features/events/i18n';

import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import {
  useEvent,
  useEventAttendees,
  useRemoveAttendee,
  type EventAttendee,
  type RsvpStatus,
} from '@/api/queries/events';
import { useOpenMember } from '@/features/home/navigation';
import { photoFields } from '@/features/profile/media';
import { shareLink } from '@/features/profile/share';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  GuardedFlashList,
  Hairline,
  MemberRow,
  SegmentedControl,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  Text,
  toast,
} from '@/ui';

import { EventPage } from '../components/EventPage';

const ROUTE = 'EVT-04';
const TABS: readonly RsvpStatus[] = ['going', 'interested', 'waitlist'];

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  head: { gap: t.space[16], paddingBottom: t.space[8], paddingTop: t.space[16] },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.single },
  skeletonText: { flex: 1, gap: t.space[4] },
  more: { minHeight: t.size.touchMin, paddingVertical: t.space[8] },
  state: { paddingTop: t.space[24] },
  sample: { pointerEvents: 'none' },
}));

/**
 * EVT-04 Teilnehmende `/events/[slug]/attendees` (09 §7.10, privacy-respecting): members only; everybody sees the going members,
 * the organiser also Interessiert and Warteliste with the time of the answer and "Entfernen" (silent for the member, ADR-437).
 */
export function AttendeesScreen() {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = paramOf(params.slug) ?? '';
  const back = useBack(`/events/${slug}`);
  const qaState = useQaState();
  const online = useOnline();
  const format = useFormat();
  const status = useSessionStore((state) => state.status);
  const own = useSessionStore((state) => state.member?.username);
  const requireAuth = useRequireAuth();
  const openMember = useOpenMember();
  const { gutter } = useBreakpoint();
  const event = useEvent(slug);
  const organiser = Boolean(
    own && event.data && own.toLowerCase() === event.data.organiser.username.toLowerCase(),
  );
  const [tab, setTab] = useState<RsvpStatus>('going');
  const query = useEventAttendees(slug, organiser ? tab : null, status === 'member');
  const remove = useRemoveAttendee(slug);
  const [removing, setRemoving] = useState<EventAttendee | null>(null);
  const rows = useMemo(
    () => (qaState === 'empty' ? [] : (query.data?.pages ?? []).flatMap((page) => page.data)),
    [qaState, query.data?.pages],
  );
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const nameOf = (row: EventAttendee) => row.member.display_name ?? `@${row.member.username}`;

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="users"
        title={t('attendees.guestTitle')}
        body={t('attendees.guestBody')}
        action={{
          label: t('editor.signIn'),
          onPress: () => requireAuth(undefined, { returnTo: `/events/${slug}/attendees` }),
        }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (
    qaState === 'loading' ||
    status === 'loading' ||
    (qaState === 'default' && !query.data && query.isPending && query.fetchStatus !== 'paused')
  ) {
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
            <View style={styles.skeletonText}>
              <SkeletonText variant="headline" width="45%" />
              <SkeletonText variant="caption" width="30%" />
            </View>
          </View>
        ))}
      </Skeleton>
    );
  } else if (query.error instanceof ApiError && query.error.kind === 'forbidden') {
    state = (
      <EmptyState
        icon="lock-simple"
        title={t('attendees.forbiddenTitle')}
        body={t('attendees.forbiddenBody')}
        testID={`${ROUTE}.forbidden`}
      />
    );
  } else if (qaState === 'error' || qaState === 'offline' || !query.data) {
    const offline =
      qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('list.offlineTitle') : t('attendees.errorTitle')}
        message={offline ? t('list.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    // DQ-1116 (09 §5 EmptyState): left-aligned, two badged sample rows of what a going member looks like, one line, and for the
    // organiser one action. Never a centred glyph with a sentence.
    const shareUrl = event.data?.share_url;
    state = (
      <EmptyState
        preview={<SampleAttendees />}
        title={organiser && tab !== 'going' ? t('attendees.emptyTab') : t('attendees.emptyTitle')}
        body={t('attendees.emptyBody')}
        action={
          organiser && shareUrl && event.data?.status === 'published'
            ? {
                label: t('attendees.emptyShare'),
                variant: 'secondary',
                size: 'm',
                onPress: () =>
                  void shareLink({ url: shareUrl, title: event.data?.title ?? '' }).then((outcome) => {
                    if (outcome === 'copied') toast(t('detail.linkCopied'), { testID: `${ROUTE}.toast` });
                    if (outcome === 'failed')
                      toast(t('detail.shareFailed', { url: shareUrl }), { testID: `${ROUTE}.toast` });
                  }),
              }
            : undefined
        }
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const confirmRemove = () => {
    const row = removing;
    if (!row) return;
    setRemoving(null);
    remove.mutate(row.member.username, {
      onSuccess: () => {
        haptics.success();
        toast(t('attendees.removed', { name: nameOf(row) }), { testID: `${ROUTE}.toast` });
      },
      onError: () => {
        haptics.error();
        toast(t('attendees.removeFailed'), { testID: `${ROUTE}.toast` });
      },
    });
  };

  const header = (
    <View style={[columnStyle, styles.head]}>
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.privacy`}>
        {t('attendees.privacy')}
      </Text>
      {organiser ? (
        <SegmentedControl<RsvpStatus>
          options={[
            { value: 'going', label: t('attendees.tab.going'), testID: `${ROUTE}.tab.going` },
            { value: 'interested', label: t('attendees.tab.interested'), testID: `${ROUTE}.tab.interested` },
            { value: 'waitlist', label: t('attendees.tab.waitlist'), testID: `${ROUTE}.tab.waitlist` },
          ]}
          value={tab}
          onChange={(next) => {
            haptics.selection();
            setTab(TABS.includes(next) ? next : 'going');
          }}
          label={t('attendees.tabs')}
          role="tablist"
          testID={`${ROUTE}.tabs`}
        />
      ) : null}
    </View>
  );

  return (
    <EventPage routeId={ROUTE} title={t('attendees.title')} onBack={back} scroll={false}>
      <GuardedFlashList
        data={state ? [] : rows}
        keyExtractor={(row: EventAttendee) => row.member.username}
        style={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={state ? <View style={[columnStyle, styles.state]}>{state}</View> : null}
        renderItem={({ item, index }: { item: EventAttendee; index: number }) => (
          <View style={columnStyle}>
            {index > 0 ? <Hairline /> : null}
            <MemberRow
              name={nameOf(item)}
              meta={
                organiser && item.status_at
                  ? `@${item.member.username} · ${t('attendees.since', { date: format.date(new Date(item.status_at)) })}`
                  : `@${item.member.username}${item.member.city ? ` · ${item.member.city}` : ''}`
              }
              avatarUri={photoFields(item.member.avatar, size.avatar.md).source as string | null}
              avatarBlurhash={item.member.avatar?.blurhash}
              sample={item.member}
              onPress={() => openMember(item.member.username)}
              trailing={
                organiser ? (
                  <Button
                    label={t('attendees.remove')}
                    variant="tertiary"
                    size="s"
                    accessibilityLabel={t('attendees.removeLabel', { name: nameOf(item) })}
                    onPress={() => setRemoving(item)}
                    testID={`${ROUTE}.remove.${item.member.username}`}
                  />
                ) : undefined
              }
              testID={`${ROUTE}.member.${item.member.username}`}
            />
          </View>
        )}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={[columnStyle, styles.more]}>
              <Spinner label={t('list.more')} />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isError) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID={`${ROUTE}.list`}
      />
      <Dialog
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? t('attendees.removeTitle', { name: nameOf(removing) }) : ''}
        body={t('attendees.removeBody')}
        actions={[
          {
            label: t('editor.close'),
            variant: 'secondary',
            onPress: () => setRemoving(null),
            testID: `${ROUTE}.removeCancel`,
          },
          {
            label: t('attendees.removeConfirm'),
            destructive: true,
            onPress: confirmRemove,
            testID: `${ROUTE}.removeConfirm`,
          },
        ]}
        testID={`${ROUTE}.removeDialog`}
      />
    </EventPage>
  );
}

/** The empty list's preview: two going members as they would appear, badged "Beispiel", drawn and never opened. */
function SampleAttendees() {
  const { t } = useTranslation('events');
  const styles = useStyles();
  return (
    <View style={styles.sample} aria-hidden testID={`${ROUTE}.empty.sample`}>
      <MemberRow
        name={t('attendees.sampleOneName')}
        meta={t('attendees.sampleOne')}
        sample={{ is_sample: true, is_editorial: false }}
      />
      <Hairline />
      <MemberRow
        name={t('attendees.sampleTwoName')}
        meta={t('attendees.sampleTwo')}
        sample={{ is_sample: true, is_editorial: false }}
      />
    </View>
  );
}
