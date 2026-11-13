import '@/features/events/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';

import {
  flattenEvents,
  MY_EVENT_TABS,
  useMayOrganise,
  useMyEvents,
  type EventCard,
  type MyEventsTab,
} from '@/api/queries/events';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import {
  CollapsingFlashList,
  ContentTabs,
  EmptyState,
  ErrorState,
  EventCardSkeleton,
  Header,
  HeaderLargeTitle,
  Screen,
  Skeleton,
  Spinner,
  useCollapsingHeader,
} from '@/ui';

import { EventCardView } from '../components/EventCardView';
import { editorPath, sampleEvent } from '../model';

const ROUTE = 'EVT-05';
const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  tabs: { paddingBottom: t.space[16] },
  card: { paddingBottom: t.space[24] },
  state: { paddingTop: t.space[8] },
  skeleton: { gap: t.space[24] },
  more: { minHeight: t.size.touchMin, paddingVertical: t.space[8] },
}));

/**
 * EVT-05 Meine Treffen `/profile/events` (09 §7.10): Zugesagt (with the waitlist) · Interessiert · Organisiert (every status, with its
 * pill) · Vergangen. `?tab=organised` opens a tab (the review notifications link there).
 */
export function MyEventsScreen() {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initial = paramOf(params.tab);
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const status = useSessionStore((state) => state.status);
  const mayOrganise = useMayOrganise();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const back = useBack('/profile');
  const { gutter } = useBreakpoint();
  const [tab, setTab] = useState<MyEventsTab>(
    (MY_EVENT_TABS as readonly string[]).includes(initial ?? '') ? (initial as MyEventsTab) : 'going',
  );
  const query = useMyEvents(tab, qaState === 'default' || qaState === 'offline');
  const listRef = useRef<FlashListRef<EventCard>>(null);
  const events = useMemo(
    () => (qaState === 'empty' ? [] : flattenEvents(query.data?.pages)),
    [qaState, query.data?.pages],
  );
  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        preview={<EventCardView event={sampleEvent(now(), t)} routeId={`${ROUTE}.guest`} withCover inert />}
        title={t('mine.guestTitle')}
        body={t('mine.guestBody')}
        action={{
          label: t('editor.signIn'),
          onPress: () => {
            clearAuthIntent();
            router.push({ pathname: '/auth/email', params: { returnTo: '/profile/events' } });
          },
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
        <View style={styles.skeleton}>
          <EventCardSkeleton />
          <EventCardSkeleton />
          <EventCardSkeleton />
        </View>
      </Skeleton>
    );
  } else if (qaState === 'error' || (qaState === 'offline' && !query.data) || !query.data) {
    const offline =
      qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('list.offlineTitle') : t('mine.errorTitle')}
        message={offline ? t('list.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (events.length === 0) {
    const organise = tab === 'organised' && mayOrganise;
    state = (
      <EmptyState
        preview={<EventCardView event={sampleEvent(now(), t)} routeId={`${ROUTE}.empty`} withCover inert />}
        title={t(`mine.empty.${tab}`)}
        body={t(`mine.emptyBody.${tab}`)}
        action={
          organise
            ? { label: t('list.create'), onPress: () => router.push(editorPath('new')) }
            : {
                label: t('mine.discover'),
                onPress: () => router.push('/events'),
                variant: 'secondary',
                size: 'm',
              }
        }
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const title = t('mine.title');
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={title}
        scroll={header}
        onBack={back}
        actions={
          mayOrganise
            ? [
                {
                  icon: 'plus',
                  label: t('list.create'),
                  onPress: () => router.push(editorPath('new')),
                  testID: `${ROUTE}.create`,
                },
              ]
            : undefined
        }
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('mine.offlineBanner')} />
      <CollapsingFlashList
        ref={listRef}
        {...header.scrollProps}
        data={state ? [] : events}
        keyExtractor={(event: EventCard) => event.id}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: inset }}
        ListHeaderComponent={
          <View>
            <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />
            {status === 'guest' ? null : (
              <ContentTabs<MyEventsTab>
                tabs={MY_EVENT_TABS.map((value) => ({
                  value,
                  label: t(`mine.tab.${value}`),
                  testID: `${ROUTE}.tab.${value}`,
                }))}
                value={tab}
                onChange={setTab}
                label={t('mine.tabs')}
                style={styles.tabs}
                testID={`${ROUTE}.tabs`}
              />
            )}
          </View>
        }
        ListEmptyComponent={state ? <View style={[columnStyle, styles.state]}>{state}</View> : null}
        renderItem={({ item }: { item: EventCard }) => (
          <View style={[columnStyle, styles.card]}>
            <EventCardView event={item} routeId={ROUTE} showStatus={tab === 'organised'} withThumb />
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
    </Screen>
  );
}
