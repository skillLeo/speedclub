import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import {
  flattenTags,
  hasNoBusiness,
  useBusinessesOn,
  useBusinessTags,
  useDecideBusinessTag,
  useMyBusiness,
  useRemoveBusinessTag,
  type ModTag,
} from '@/api/queries/businesses';
import { removeWithUndo, useHiddenRemovals } from '@/features/collections/deferred';
import { EventPage } from '@/features/events/components/EventPage';
import { SAMPLE_CARD_PHOTO } from '@/features/garage/sample';
import { photoFields } from '@/features/profile/media';
import { useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, size, useBreakpoint } from '@/theme';
import {
  Button,
  EmptyState,
  ErrorState,
  GuardedFlashList,
  Hairline,
  Photo,
  SampleBadge,
  SegmentedControl,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  Text,
  toast,
} from '@/ui';
import { joinLabel } from '@/ui/rowParts';

import { tagSubject } from '../model';

const ROUTE = 'BIZ-04';
const TABS = ['incoming', 'outgoing', 'accepted'] as const;
type Tab = (typeof TABS)[number];
const SKELETON_ROWS = 3;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  head: { gap: t.space[16], paddingBottom: t.space[8], paddingTop: t.space[16] },
  row: { flexDirection: 'row', gap: t.space[12], paddingVertical: t.space[12] },
  thumb: { borderRadius: t.radius.sm, height: t.size.thumb.row, overflow: 'hidden', width: t.size.thumb.row },
  thumbEmpty: { backgroundColor: t.color.bg.raised },
  text: { flex: 1, gap: t.space[2], minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[8] },
  state: { paddingTop: t.space[24] },
  more: { minHeight: t.size.touchMin, paddingVertical: t.space[8] },
  sample: { pointerEvents: 'none' },
}));

/** The rows of a tab: the business's pending requests, its own pending proposals, or the portfolio (accepted, both directions). */
function useTabRows(tab: Tab) {
  const incoming = useBusinessTags('incoming', tab === 'accepted' ? 'accepted' : 'pending', tab !== 'outgoing');
  const outgoing = useBusinessTags('outgoing', tab === 'accepted' ? 'accepted' : 'pending', tab !== 'incoming');
  const queries = tab === 'incoming' ? [incoming] : tab === 'outgoing' ? [outgoing] : [incoming, outgoing];
  const rows = useMemo(() => {
    const merged = queries.flatMap((query) => flattenTags(query.data?.pages));
    return tab === 'accepted' ? [...merged].sort((a, b) => (b.decided_at ?? b.created_at ?? '').localeCompare(a.decided_at ?? a.created_at ?? '')) : merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pages of the tab's queries are the inputs
  }, [tab, incoming.data, outgoing.data]);
  return {
    rows,
    pending: queries.some((query) => query.isPending && query.fetchStatus !== 'paused'),
    paused: queries.some((query) => query.fetchStatus === 'paused'),
    error: queries.find((query) => query.isError)?.error ?? null,
    fetching: queries.some((query) => query.isFetching),
    hasMore: queries.some((query) => query.hasNextPage),
    loadingMore: queries.some((query) => query.isFetchingNextPage),
    refetch: () => queries.forEach((query) => void query.refetch()),
    more: () => queries.forEach((query) => (query.hasNextPage && !query.isFetchingNextPage ? void query.fetchNextPage() : undefined)),
  };
}

/**
 * BIZ-04 Anfragen `/business/requests` (09 §7.11, §8.10, ADR-414): "Eingebaut von" needs both sides. Anfragen: members named the
 * business on a mod, the business accepts (the build joins the portfolio) or declines; Vorschläge: the business's own proposals
 * waiting for the owner; Portfolio: every confirmed build, which either side can take off again. Every decision leaves the list at
 * once with an undo toast (SM20) and is sent when the toast is gone.
 */
export function BusinessRequestsScreen() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const flag = useBusinessesOn();
  const requireAuth = useRequireAuth();
  const back = useBack('/business');
  const { gutter } = useBreakpoint();
  const [tab, setTab] = useState<Tab>('incoming');
  const mine = useMyBusiness();
  const verified = mine.data?.status === 'verified';
  const list = useTabRows(tab);
  const hidden = useHiddenRemovals();
  const decide = useDecideBusinessTag();
  const remove = useRemoveBusinessTag();
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const rows = qaState === 'empty' ? [] : list.rows.filter((tag) => !hidden.has(`tag:${tag.id}`));

  const act = (tag: ModTag, action: 'accept' | 'decline' | 'withdraw' | 'remove') => {
    haptics.light();
    const subject = tagSubject(tag, t);
    const commit =
      action === 'accept' || action === 'decline'
        ? () => decide.mutateAsync({ tagId: tag.id, decision: action === 'accept' ? 'accepted' : 'declined' })
        : () => remove.mutateAsync(tag.id);
    const removal = removeWithUndo(`tag:${tag.id}`, commit, (error) =>
      toast(error instanceof ApiError ? error.message : t('requests.failed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
    );
    toast(t(`requests.done.${action}`, { subject }), { undo: () => void removal.undo(), testID: `${ROUTE}.toast` });
  };

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="workshop"
        title={t('dashboard.guestTitle')}
        body={t('dashboard.guestBody')}
        action={{ label: t('apply.signIn'), onPress: () => requireAuth(undefined, { returnTo: '/business/requests' }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (!flag && qaState === 'default') {
    state = <EmptyState icon="workshop" title={t('off.businessesTitle')} body={t('off.businessesBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (hasNoBusiness(mine.error) || (mine.data && !verified && qaState === 'default')) {
    state = (
      <EmptyState
        icon="workshop"
        title={t('requests.notVerifiedTitle')}
        body={t('requests.notVerifiedBody')}
        action={{ label: t('dashboard.title'), onPress: () => router.replace('/business'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notVerified`}
      />
    );
  } else if (qaState === 'loading' || (qaState === 'default' && (list.pending || (mine.isPending && mine.fetchStatus !== 'paused')))) {
    state = <RequestsSkeleton />;
  } else if (qaState === 'error' || ((list.error || mine.isError) && rows.length === 0)) {
    const offline = qaState !== 'error' && (!online || list.paused);
    state = (
      <ErrorState
        title={offline ? t('states.offlineTitle') : t('requests.errorTitle')}
        message={offline ? t('states.offlineBody') : undefined}
        onRetry={() => {
          void mine.refetch();
          list.refetch();
        }}
        retrying={list.fetching || mine.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state = (
      <EmptyState
        preview={<SampleRequest />}
        title={t(`requests.empty.${tab}Title`)}
        body={t(`requests.empty.${tab}Body`)}
        action={{ label: t('requests.toDashboard'), onPress: () => router.replace('/business'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const header = (
    <View style={[columnStyle, styles.head]}>
      <Text variant="callout" color="text.secondary">
        {t('requests.intro')}
      </Text>
      {qaState === 'restricted' ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
          {t('apply.restricted')}
        </Text>
      ) : null}
      <SegmentedControl
        options={[
          { value: 'incoming', label: t('requests.tabs.incoming'), testID: `${ROUTE}.tab.incoming` },
          { value: 'outgoing', label: t('requests.tabs.outgoing'), testID: `${ROUTE}.tab.outgoing` },
          { value: 'accepted', label: t('requests.tabs.accepted'), testID: `${ROUTE}.tab.accepted` },
        ]}
        value={tab}
        onChange={(next) => setTab(TABS.includes(next) ? next : 'incoming')}
        label={t('requests.tabsLabel')}
        role="tablist"
        testID={`${ROUTE}.tabs`}
      />
    </View>
  );

  return (
    <EventPage routeId={ROUTE} title={t('requests.title')} onBack={back} offlineLabel={t('states.offlineBanner')} scroll={false}>
      <GuardedFlashList
        data={state ? [] : rows}
        keyExtractor={(tag: ModTag) => tag.id}
        style={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={state ? <View style={[columnStyle, styles.state]}>{state}</View> : null}
        renderItem={({ item, index }: { item: ModTag; index: number }) => (
          <View style={columnStyle}>
            {index > 0 ? <Hairline /> : null}
            <TagRow
              tag={item}
              date={item.decided_at ?? item.created_at}
              format={(iso) => format.date(new Date(iso))}
              onOpen={() => (item.vehicle && item.mod ? router.push(`/v/${item.vehicle.slug}/mods/${item.mod.id}`) : undefined)}
              actions={
                tab === 'incoming'
                  ? [
                      { key: 'accept', label: t('requests.accept'), primary: true, onPress: () => act(item, 'accept') },
                      { key: 'decline', label: t('requests.decline'), onPress: () => act(item, 'decline') },
                    ]
                  : tab === 'outgoing'
                    ? [{ key: 'withdraw', label: t('requests.withdraw'), onPress: () => act(item, 'withdraw') }]
                    : [{ key: 'remove', label: t('requests.remove'), onPress: () => act(item, 'remove') }]
              }
              disabled={qaState === 'restricted' || !online}
            />
          </View>
        )}
        ListFooterComponent={
          list.loadingMore ? (
            <View style={[columnStyle, styles.more]}>
              <Spinner label={t('requests.more')} />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (list.hasMore && !list.loadingMore && !list.error) list.more();
        }}
        onEndReachedThreshold={0.5}
        testID={`${ROUTE}.list`}
      />
    </EventPage>
  );
}

type TagAction = { key: string; label: string; primary?: boolean; onPress: () => void };

/** One tag: the car photo 56 (radius 8, never an icon), the mod, the build and its owner, the date, and what the business can do. */
function TagRow({ tag, date, format, onOpen, actions, disabled }: { tag: ModTag; date: string | null; format: (iso: string) => string; onOpen: () => void; actions: readonly TagAction[]; disabled: boolean }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const cover = tag.vehicle?.cover ? photoFields(tag.vehicle.cover, size.thumb.row) : null;
  const meta = [tag.owner_username ? `@${tag.owner_username}` : null, date ? format(date) : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.row} testID={`${ROUTE}.tag.${tag.id}`}>
      {cover ? <Photo {...cover} aspect="1:1" corner="sm" style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
      <View style={styles.text}>
        <Button
          label={tag.mod?.title ?? t('tags.goneSubject')}
          variant="tertiary"
          size="s"
          flush="start"
          role="link"
          accessibilityLabel={joinLabel([tag.mod?.title, tag.vehicle?.full_title])}
          disabled={!tag.mod || !tag.vehicle}
          onPress={onOpen}
          testID={`${ROUTE}.tag.${tag.id}.open`}
        />
        {tag.vehicle ? (
          <Text variant="callout" color="text.secondary">
            {tag.vehicle.full_title}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" color="text.secondary" numeric>
            {meta}
          </Text>
        ) : null}
        {tag.vehicle?.is_sample ? <SampleBadge /> : null}
        <View style={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.key}
              label={action.label}
              variant={action.primary ? 'secondary' : 'tertiary'}
              size="s"
              disabled={disabled}
              onPress={action.onPress}
              testID={`${ROUTE}.tag.${tag.id}.${action.key}`}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function RequestsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonBlock width={size.thumb.row} height={size.thumb.row} corner="sm" />
          <View style={styles.text}>
            <SkeletonText variant="headline" width="55%" />
            <SkeletonText variant="callout" width="70%" />
            <SkeletonBlock width="45%" height={size.button.s} corner="sm" />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

/** The empty list's preview: a request as it would appear, badged "Beispiel", drawn and never sent. */
function SampleRequest() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  return (
    <View style={[styles.row, styles.sample]} aria-hidden testID={`${ROUTE}.empty.sample`}>
      <Photo {...SAMPLE_CARD_PHOTO} aspect="1:1" corner="sm" style={styles.thumb} />
      <View style={styles.text}>
        <Text variant="headline">{t('sample.requestMod')}</Text>
        <Text variant="callout" color="text.secondary">
          {t('sample.requestVehicle')}
        </Text>
        <SampleBadge />
      </View>
    </View>
  );
}

