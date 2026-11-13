import type { FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, ScrollView, View } from 'react-native';

import { flattenNotifications, useMarkAllRead, useMarkRead, useNotifications, type AppNotification } from '@/api/queries/notifications';
import { PushedListPage } from '@/features/shell/PushedListPage';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { toFormatLocale, useFormat } from '@/lib/useFormat';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { clearAuthIntent, useSessionStore } from '@/state/session';
import { createStyles, size, space } from '@/theme';
import { Button, Chip, CollapsingFlashList, ContextMenuButton, EmptyState, ErrorState, Skeleton, SkeletonBlock, SkeletonText, Spinner, Text, toast } from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { RestrictionNotice, useBrowseRestriction } from '../components/BrowseStates';
import { NotificationRow, NotificationRowSkeleton } from '../components/NotificationRow';
import { SampleNotifications } from '../components/SampleNotifications';
import { offlineLine } from '../model';
import {
  berlinDayKey,
  dayLabel,
  groupBySection,
  matchesFilter,
  msUntilNextBerlinDay,
  NOTIFICATION_FILTERS,
  notificationTarget,
  sectionOf,
  type NotificationFilter,
  type NotificationListRow,
} from '../notifications';

const ROUTE = 'HOME-02';
/** DQ-300: what a restricted member can still do here. */
const NOTIFICATIONS_COPY = { body: 'notifications.restricted', until: 'notifications.restrictedUntil' } as const;

type Today = { key: string; date: Date };

const todayNow = (): Today => {
  const date = now();
  return { key: berlinDayKey(date), date };
};

/**
 * The Berlin day the screen counts from. Read again when the screen comes into focus, when the app returns to the foreground, and at
 * the next midnight while it stays open; a new value only when the day changed, so the list is not grouped again for nothing.
 */
function useBerlinToday(): Today {
  const [today, setToday] = useState(todayNow);
  const refresh = useCallback(() => {
    const next = todayNow();
    setToday((current) => (current.key === next.key ? current : next));
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(refresh, msUntilNextBerlinDay(now()) + 1000);
    return () => clearTimeout(timer);
  }, [refresh, today]);
  return today;
}
const SKELETON_ROWS = 5;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // "Alle als gelesen markieren" on the column's start edge, as the text action of a list (§9).
  filters: { flexDirection: 'row', gap: t.space[8], paddingBottom: t.space[12] },
  day: { paddingBottom: t.space[4], paddingTop: t.space[16] },
  state: { paddingTop: t.space[32] },
  notice: { paddingBottom: t.space[8] },
  more: { alignItems: 'flex-start', paddingVertical: t.space[16] },
}));

/**
 * HOME-02 `/notifications` (in the Start tab): grouped by day ("Heute", "Gestern", "Mo., 3. Nov."), newest first, unread rows marked
 * in weight, a dot and their name; "Alle als gelesen markieren"; a row opens what it is about and counts as read. The text is made
 * in the app from `type` + `actors` + `actor_count`.
 */
export function NotificationsScreen() {
  const { t, i18n } = useTranslation('home');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  // M3.5: a list behind another screen or tab loads no pages for nobody (code review M2.8 nit 4).
  const shown = useScreenFocused();
  const status = useSessionStore((state) => state.status);
  const own = useSessionStore((state) => state.member?.username);
  const restriction = useBrowseRestriction(NOTIFICATIONS_COPY);
  const format = useFormat();
  const back = useBack('/');
  const query = useNotifications();
  const markAll = useMarkAllRead();
  const markRead = useMarkRead();
  const listRef = useRef<FlashListRef<NotificationListRow>>(null);
  const { forget } = useRetainedListScroll(listRef);
  const locale = toFormatLocale(i18n.language) === 'en' ? 'en' : 'de';

  const notifications = useMemo(() => (qaState === 'empty' ? [] : flattenNotifications(query.data?.pages)), [qaState, query.data?.pages]);
  const today = useBerlinToday();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const shownRows = useMemo(() => notifications.filter((notification) => matchesFilter(notification, filter)), [filter, notifications]);
  // `today` keeps "Heute" and "Gestern" true across midnight while the screen stays mounted (M2.2 review 25).
  const rows = useMemo(() => groupBySection(shownRows, today.date, t), [shownRows, t, today]);
  // DQ-292: under Heute "vor 2 Std.", under Gestern the clock time, further back the day ("Mo., 3. Nov.") and the time.
  const timeOf = useCallback(
    (date: Date) => {
      const section = sectionOf(date, today.date);
      if (section === 'today') return format.relative(date);
      if (section === 'yesterday') return format.time(date);
      return `${dayLabel(date, today.date, locale, t)}, ${format.time(date)}`;
    },
    [format, locale, t, today],
  );
  const unread = notifications.some((notification) => notification.read_at === null);

  // The stable `mutate`, not the mutation object, which changes with every state: memoised rows keep their props (M2.2 review 24).
  const { mutate: readRow } = markRead;
  const markOne = useCallback((notification: AppNotification) => readRow(notification.id), [readRow]);
  const open = useCallback(
    (notification: AppNotification) => {
      if (notification.read_at === null) readRow(notification.id);
      const target = notificationTarget(notification, own);
      if (target) router.push(target);
    },
    [own, readRow, router],
  );

  const readAll = () =>
    markAll.mutate(undefined, {
      onError: (error) => toast(error.message || t('notifications.readAllFailed'), { haptic: 'warning', testID: `${ROUTE}.toast` }),
    });

  const loading =
    status !== 'guest' &&
    (qaState === 'loading' || status === 'loading' || (!query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error'));
  let state: ReactNode = null;
  if (status === 'guest') {
    state = (
      <EmptyState
        preview={<SampleNotifications testID={`${ROUTE}.guest.sample`} />}
        title={t('notifications.guest.title')}
        body={t('notifications.guest.body')}
        action={{
          label: common('auth.signIn'),
          onPress: () => {
            clearAuthIntent();
            router.push({ pathname: '/auth/email', params: { returnTo: '/notifications' } });
          },
        }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (loading) {
    // DQ-286: in the loaded page's geometry, under the band of "Alle als gelesen markieren": the first day header, then the rows.
    state = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.day}>
          <SkeletonText variant="callout" width="20%" />
        </View>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <NotificationRowSkeleton key={index} inset={space[0]} divider={index < SKELETON_ROWS - 1} />
        ))}
      </Skeleton>
    );
  } else if (qaState === 'error' || !query.data) {
    const offline = qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    state = (
      <ErrorState
        title={offline ? t('error.offlineTitle') : t('notifications.errorTitle')}
        message={offline ? t('notifications.offlineBody') : t('error.body')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (notifications.length === 0) {
    state = (
      <EmptyState
        preview={<SampleNotifications testID={`${ROUTE}.empty.sample`} />}
        title={t('notifications.emptyTitle')}
        body={t('notifications.emptyBody')}
        action={{ label: t('notifications.emptyAction'), onPress: () => router.navigate('/discover') }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else if (rows.length === 0) {
    // A chip with nothing in it (yet): say so, the other chips stay in reach above.
    state = (
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.filterEmpty`}>
        {query.hasNextPage ? t('notifications.filterEmptyMore') : t('notifications.filterEmpty')}
      </Text>
    );
  }

  const filterLabels: Record<NotificationFilter, string> = {
    all: t('notifications.filters.all'),
    builds: t('notifications.filters.builds'),
    social: t('notifications.filters.social'),
    events: t('notifications.filters.events'),
    system: t('notifications.filters.system'),
  };
  const listed = !loading && notifications.length > 0 && (state === null || rows.length === 0);
  const top =
    restriction || loading || listed ? (
      <>
        {restriction ? <RestrictionNotice message={restriction} style={styles.notice} testID={`${ROUTE}.restricted`} /> : null}
        {loading ? (
          <Skeleton testID={`${ROUTE}.skeleton.filters`}>
            <View style={styles.filters}>
              {NOTIFICATION_FILTERS.map((key) => (
                <SkeletonBlock key={key} width={size.chip * 2} height={size.chip} corner="full" />
              ))}
            </View>
          </Skeleton>
        ) : listed ? (
          // 09 §7.4 filter chips: one choice at a time, "Alle" first.
          // One line that scrolls sideways: five chips wrapped to a second line on a phone (M4.8 r1).
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
            role="radiogroup"
            aria-label={t('notifications.filters.label')}
            testID={`${ROUTE}.filters`}
          >
            {NOTIFICATION_FILTERS.map((key) => (
              <Chip
                key={key}
                label={filterLabels[key]}
                selected={filter === key}
                selectionRole="radio"
                onPress={() => {
                  setFilter(key);
                  forget();
                  listRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
                testID={`${ROUTE}.filter.${key}`}
              />
            ))}
          </ScrollView>
        ) : null}
      </>
    ) : undefined;

  // 09 §7.4: the header menu, "Alle als gelesen markieren" and "Einstellungen".
  const menu =
    status === 'member' ? (
      <ContextMenuButton
        label={t('notifications.menu')}
        items={[
          {
            key: 'readAll',
            label: t('notifications.readAll'),
            icon: 'check',
            disabled: !online || !unread || markAll.isPending || Boolean(state && notifications.length === 0),
            onSelect: readAll,
          },
          { key: 'settings', label: t('notifications.settings'), icon: 'gear-six', onSelect: () => router.push('/settings/notifications') },
        ]}
        testID={`${ROUTE}.menu`}
      />
    ) : undefined;

  return (
    <PushedListPage
      routeId={ROUTE}
      title={t('notifications.title')}
      onBack={back}
      offlineLabel={offlineLine(t, query.dataUpdatedAt, format.relative)}
      trailing={menu}
      top={top}
      onScrollToTop={(animated) => {
        forget();
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }}
      renderList={(frame) => (
        <CollapsingFlashList
          ref={listRef}
          {...frame.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(row: NotificationListRow) => row.key}
          getItemType={(row: NotificationListRow) => row.kind}
          style={styles.list}
          contentContainerStyle={frame.contentContainerStyle}
          scrollEnabled={!(state && qaState === 'loading')}
          // The 32 of a state is for empty, error and offline; the skeleton stands where the rows will be (DQ-286, DQ-276).
          ListEmptyComponent={state ? <View style={[frame.columnStyle, loading || listed ? null : styles.state]}>{state}</View> : null}
          ListFooterComponent={
            <View style={[frame.columnStyle, frame.endStyle]}>
              {query.isFetchingNextPage ? (
                <View style={styles.more}>
                  <Spinner label={t('notifications.loadingMore')} testID={`${ROUTE}.loadingMore`} />
                </View>
              ) : query.isFetchNextPageError ? (
                <View style={styles.more}>
                  <Button label={common('actions.retry')} variant="secondary" size="m" onPress={() => void query.fetchNextPage()} testID={`${ROUTE}.moreRetry`} />
                </View>
              ) : null}
            </View>
          }
          onEndReached={() => {
            if (shown && !state && online && query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          renderItem={({ item, index }: { item: NotificationListRow; index: number }) =>
            item.kind === 'day' ? (
              <View style={[frame.columnStyle, styles.day]}>
                <Text variant="calloutStrong" color="text.secondary" role="heading" testID={`${ROUTE}.${item.key}`}>
                  {item.label}
                </Text>
              </View>
            ) : (
              <View style={frame.columnStyle}>
                <NotificationRow
                  notification={item.notification}
                  onOpen={open}
                  timeOf={timeOf}
                  inset={space[0]}
                  divider={rows[index + 1]?.kind === 'row'}
                  onMarkRead={online ? markOne : undefined}
                  testID={`${ROUTE}.row.${item.notification.id}`}
                />
              </View>
            )
          }
          testID={`${ROUTE}.list`}
        />
      )}
    />
  );
}
