import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { flattenThreads, useForumOn, useMyForumThreads, type ForumThreadRow, type MyForumTab } from '@/api/queries/forum';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Header, HeaderLargeTitle } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Spinner } from '@/ui/Spinner';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { ThreadListSkeleton, ThreadRow, sampleThread } from '../components/ThreadRow';
import { reasonText } from '../model';
import { composerHref } from '../navigation';

const ROUTE = 'FOR-05';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  controls: { paddingBottom: t.space[8] },
  state: { paddingTop: t.space[16] },
  more: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingVertical: t.space[8] },
}));

/**
 * FOR-05 Meine Themen `/forum/mine` (10 §7.2): Gestartet (every own thread with its state: In Prüfung, nicht freigegeben, entfernt,
 * zusammengeführt) and Abonniert (the threads the member follows, newest activity first). `?tab=subscriptions` opens the second.
 */
export function MyForumScreen() {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const qaState = useQaState();
  const online = useOnline();
  const flag = useForumOn();
  const status = useSessionStore((state) => state.status);
  const requireAuth = useRequireAuth();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const back = useBack('/forum');
  const { gutter } = useBreakpoint();
  const [tab, setTab] = useState<MyForumTab>(paramOf(params.tab) === 'subscriptions' ? 'subscriptions' : 'threads');
  const list = useMyForumThreads(tab, qaState === 'default' || qaState === 'offline' || qaState === 'restricted');
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenThreads(list.data?.pages)), [list.data?.pages, qaState]);
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  // The staff's reason under a rejected thread. TODO(api:types): ForumThreadRowResource has no `review_reason` yet (ForumThreadResource
  // and ForumPostResource carry it since the m5.8 review); read by name until the row lists it.
  const rejectionNote = (row: ForumThreadRow): string | null => {
    const reason = row.status === 'rejected' ? reasonText((row as ForumThreadRow & { review_reason?: string | null }).review_reason) : null;
    return reason ? t('mine.rejectedReason', { reason }) : null;
  };
  const offline = qaState === 'offline' || (!online && !list.data) || (!list.data && list.fetchStatus === 'paused');
  const loading = qaState === 'loading' || (qaState === 'default' && status === 'member' && !list.data && list.isPending && list.fetchStatus !== 'paused');

  let state: ReactNode = null;
  // The skeleton starts where the rows start (DQ-P5-028); the other states keep their air above.
  let skeleton = false;
  if (status === 'guest' && qaState === 'default') {
    state = (
      <EmptyState
        icon="chats"
        title={t('mine.guestTitle')}
        body={t('mine.guestBody')}
        action={{ label: t('mine.guestSignIn'), onPress: () => requireAuth(undefined, { returnTo: '/forum/mine' }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (!flag && qaState === 'default') {
    state = <EmptyState icon="chats" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (loading) {
    state = <ThreadListSkeleton testID={`${ROUTE}.skeleton`} />;
    skeleton = true;
  } else if (qaState === 'error' || (offline && !list.data) || (!list.data && list.isError)) {
    const isOffline = qaState === 'offline' || (qaState !== 'error' && offline);
    state = (
      <ErrorState
        title={isOffline ? t('list.offlineTitle') : t('mine.errorTitle')}
        message={isOffline ? t('list.offlineBody') : undefined}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
        testID={`${ROUTE}.${isOffline ? 'offline' : 'error'}`}
      />
    );
  } else if (rows.length === 0) {
    state =
      tab === 'threads' ? (
        <EmptyState
          preview={<ThreadRow thread={sampleThread(t, now())} routeId={`${ROUTE}.empty`} inert />}
          title={t('mine.emptyThreadsTitle')}
          body={t('mine.emptyThreadsBody')}
          action={{ label: t('list.create'), onPress: () => router.push(composerHref()), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.empty`}
        />
      ) : (
        <EmptyState
          preview={<ThreadRow thread={sampleThread(t, now())} routeId={`${ROUTE}.emptySubscriptions`} inert />}
          title={t('mine.emptySubscriptionsTitle')}
          body={t('mine.emptySubscriptionsBody')}
          action={{ label: t('mine.toForum'), onPress: () => router.push('/forum' as Href), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.emptySubscriptions`}
        />
      );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" title={t('mine.title')} scroll={header} onBack={back} backLabel={t('thread.back')} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('list.offlineBanner')} />
      <CollapsingFlashList
        {...header.scrollProps}
        data={state ? [] : rows}
        keyExtractor={(row: ForumThreadRow) => row.id}
        renderItem={({ item, index }: { item: ForumThreadRow; index: number }) => (
          <View style={columnStyle}>
            {index > 0 ? <Hairline /> : null}
            <ThreadRow thread={item} routeId={ROUTE} showStatus={tab === 'threads'} note={rejectionNote(item)} />
          </View>
        )}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: inset }}
        ListHeaderComponent={
          <View>
            <HeaderLargeTitle title={t('mine.title')} scroll={header} testID={`${ROUTE}.title`} />
            {status === 'member' || qaState !== 'default' ? (
              <View style={[columnStyle, styles.controls]}>
                <SegmentedControl
                  options={[
                    { value: 'threads', label: t('mine.tabThreads'), testID: `${ROUTE}.tab.threads` },
                    { value: 'subscriptions', label: t('mine.tabSubscriptions'), testID: `${ROUTE}.tab.subscriptions` },
                  ]}
                  value={tab}
                  onChange={(next) => {
                    haptics.selection();
                    setTab(next);
                    router.setParams({ tab: next === 'threads' ? undefined : next });
                  }}
                  label={t('mine.tabs')}
                  labelVariant="labelControl"
                  role="tablist"
                  testID={`${ROUTE}.tabs`}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={state ? <View style={[columnStyle, skeleton ? null : styles.state]}>{state}</View> : null}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={[columnStyle, styles.more]}>
              <Spinner label={t('list.more')} testID={`${ROUTE}.more`} />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage && !list.isError) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID={`${ROUTE}.list`}
      />
    </Screen>
  );
}
