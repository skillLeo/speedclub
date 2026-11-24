import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import type { FlashListRef } from '@shopify/flash-list';

import { ApiError } from '@/api/client';
import {
  FORUM_LIMITS,
  THREAD_SORTS,
  flattenThreads,
  forumQueryOf,
  useForumCategories,
  useForumCategory,
  useForumOn,
  useForumThreads,
  type ForumCategory,
  type ForumThreadRow,
  type ForumThreadSort,
  type ThreadFilters,
} from '@/api/queries/forum';
import { DiscoverSegmentBar, SegmentRailScrollView, SegmentSwipe } from '@/features/discover/components/DiscoverSegments';
import { OptionRow } from '@/features/discover/components/OptionRow';
import { useIsSegmentRoot, useSegmentsInSidebar } from '@/features/discover/segments';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { useInboxActions } from '@/features/shell/inboxActions';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth } from '@/state/session';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Header, HeaderLargeTitle, type HeaderAction } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
import { SearchBar } from '@/ui/SearchBar';
import { Sheet } from '@/ui/Sheet';
import { Spinner } from '@/ui/Spinner';
import { Text } from '@/ui/Text';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { useForumAccess } from '../access';
import { ThreadListSkeleton, ThreadRow, sampleThread } from '../components/ThreadRow';
import { categoryChips, filtersFromParams, listEmptyKind } from '../model';
import { composerHref } from '../navigation';

const EDGES: readonly Edge[] = ['left', 'right'];
const SEARCH_DEBOUNCE_MS = 300;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn, width: '100%' },
  controls: { gap: t.space[16], paddingBottom: t.space[8] },
  intro: { gap: t.space[4] },
  chips: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  chipsWrap: { flexWrap: 'wrap' },
  divider: { backgroundColor: t.color.border.subtle, height: t.size.chip - t.space[12], width: t.size.border.control },
  state: { paddingTop: t.space[16] },
  more: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingVertical: t.space[8] },
  hint: { paddingTop: t.space[4] },
  mine: { alignSelf: 'flex-start' },
}));

export type ForumListScreenProps = {
  /** FOR-01 (the forum home, Entdecken › Forum) or FOR-02 (one category, `/forum/c/[slug]`). */
  routeId: 'FOR-01' | 'FOR-02';
  /** FOR-02: the category's slug from the route. */
  categorySlug?: string;
};

/**
 * FOR-01 Forum (10 §7.2, §1: Entdecken › Forum `/forum`) and FOR-02 Kategorie (`/forum/c/[slug]`): the forum's own search
 * (`search/threads`), category chips (FOR-01: the top level; FOR-02: its sub-forums), the sort Aktiv · Neu · Unbeantwortet · Gelöst in a
 * sheet, and the thread rows (ThreadRow). The filters live in the address (`?category=&sort=&q=`), so a link keeps them.
 *
 * As a segment page of Entdecken (useIsSegmentRoot) FOR-01 carries the tab's title, the segmented control, the bell and Nachrichten, no
 * back, and swipes to its neighbour; pushed elsewhere (Home "Gerade im Forum", a push) it is "Forum" with back. From 1280 the sidebar
 * lists Forum itself (DQ-M52-03): the page is "Forum" without the control.
 */
export function ForumListScreen({ routeId, categorySlug }: ForumListScreenProps) {
  const { t } = useTranslation('forum');
  const tabs = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; sort?: string; q?: string }>();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const flag = useForumOn();
  const access = useForumAccess();
  const requireAuth = useRequireAuth();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const back = useBack('/forum');
  const segmentRootHere = useIsSegmentRoot();
  const segmentRoot = routeId === 'FOR-01' && segmentRootHere;
  const inSidebar = useSegmentsInSidebar();
  const inbox = useInboxActions(routeId);
  const { gutter, kind } = useBreakpoint();
  const listRef = useRef<FlashListRef<ForumThreadRow>>(null);

  const initial = useMemo(() => filtersFromParams(params), []); // eslint-disable-line react-hooks/exhaustive-deps -- the address seeds the state once
  const base = categorySlug ?? null;
  const [sub, setSub] = useState<string | null>(initial.category);
  const [sort, setSort] = useState<ForumThreadSort>(initial.sort);
  const [text, setText] = useState(initial.text);
  const [sortOpen, setSortOpen] = useState(false);
  const query = useDebouncedValue(forumQueryOf(text), SEARCH_DEBOUNCE_MS);
  const typedShort = text.trim().length > 0 && text.trim().length < FORUM_LIMITS.queryMin;

  const tree = useForumCategories();
  const category = useForumCategory(categorySlug ?? '');
  const chipSource: readonly ForumCategory[] = routeId === 'FOR-01' ? (tree.data ?? []) : (category.data?.children ?? []);
  const chips = categoryChips(chipSource, routeId === 'FOR-01' ? t('list.allCategories') : t('category.all'));
  const filters = useMemo<ThreadFilters>(() => ({ category: sub ?? base, sort, q: query }), [base, query, sort, sub]);

  const forced = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const list = useForumThreads(filters, forced && (routeId === 'FOR-01' || category.isSuccess));
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenThreads(list.data?.pages)), [list.data?.pages, qaState]);

  const updateAddress = useCallback(
    (next: { category?: string | null; sort?: ForumThreadSort; q?: string | null }) => {
      router.setParams({
        ...(next.category !== undefined ? { category: next.category ?? undefined } : {}),
        ...(next.sort !== undefined ? { sort: next.sort === 'active' ? undefined : next.sort } : {}),
        ...(next.q !== undefined ? { q: next.q ?? undefined } : {}),
      });
    },
    [router],
  );
  const chooseCategory = (slug: string | null) => {
    if (slug === sub) return;
    haptics.selection();
    setSub(slug);
    updateAddress({ category: slug });
  };
  const chooseSort = (next: ForumThreadSort) => {
    setSort(next);
    updateAddress({ sort: next });
  };
  const reset = () => {
    setSub(null);
    setSort('active');
    setText('');
    updateAddress({ category: null, sort: 'active', q: null });
  };

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const create = useCallback(() => {
    const preset = sub ?? base;
    requireAuth(() => router.push(composerHref({ category: preset })), { returnTo: categorySlug ? `/forum/c/${categorySlug}` : '/forum' });
  }, [base, categorySlug, requireAuth, router, sub]);

  const actions: HeaderAction[] = [
    { icon: 'plus', label: t('list.create'), onPress: create, locked: access.status === 'member' ? access.restriction : null, testID: `${routeId}.create` },
  ];
  if (segmentRoot) actions.push(...inbox);

  const columnStyle = useMemo(() => [styles.column, { paddingHorizontal: gutter }], [gutter, styles.column]);
  const pending = list.isPending && list.fetchStatus !== 'paused';
  const categoryPending = routeId === 'FOR-02' && category.isPending && category.fetchStatus !== 'paused';
  const loading = qaState === 'loading' || (qaState === 'default' && !list.data && (pending || categoryPending));
  const offline = qaState === 'offline' || (!online && !list.data) || (!list.data && list.fetchStatus === 'paused');
  const categoryGone = routeId === 'FOR-02' && category.error instanceof ApiError && category.error.kind === 'not_found';

  let state: ReactNode = null;
  // The skeleton starts where the rows start (DQ-P5-028); the other states keep their air above.
  let skeleton = false;
  if (!flag && qaState === 'default') {
    state = <EmptyState icon="chats" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${routeId}.unavailable`} />;
  } else if (categoryGone) {
    state = (
      <EmptyState
        icon="chats"
        title={t('category.notFoundTitle')}
        body={t('category.notFoundBody')}
        action={{ label: t('category.toForum'), onPress: () => router.replace('/forum' as Href), variant: 'secondary', size: 'm' }}
        testID={`${routeId}.notFound`}
      />
    );
  } else if (loading) {
    state = <ThreadListSkeleton testID={`${routeId}.skeleton`} />;
    skeleton = true;
  } else if (qaState === 'error' || (offline && !list.data) || (!list.data && (list.isError || category.isError))) {
    const isOffline = qaState === 'offline' || (qaState !== 'error' && offline);
    state = (
      <ErrorState
        title={isOffline ? t('list.offlineTitle') : routeId === 'FOR-02' && category.isError ? t('category.errorTitle') : t('list.errorTitle')}
        message={isOffline ? t('list.offlineBody') : undefined}
        onRetry={() => {
          if (category.isError) void category.refetch();
          void list.refetch();
        }}
        retrying={list.isFetching || category.isFetching}
        testID={`${routeId}.${isOffline ? 'offline' : 'error'}`}
      />
    );
  } else {
    const empty = listEmptyKind(rows.length, filters, base);
    if (empty === 'empty') {
      state = (
        <EmptyState
          preview={<ThreadRow thread={sampleThread(t, now())} routeId={`${routeId}.empty`} inert />}
          title={t('list.emptyTitle')}
          body={t('list.emptyBody')}
          action={{ label: t('list.create'), onPress: create, variant: 'secondary', size: 'm' }}
          testID={`${routeId}.empty`}
        />
      );
    } else if (empty === 'unanswered') {
      state = (
        <EmptyState
          icon="check-circle"
          title={t('list.emptyUnansweredTitle')}
          body={t('list.emptyUnansweredBody')}
          action={{ label: t('sort.active'), onPress: () => chooseSort('active'), variant: 'secondary', size: 'm' }}
          testID={`${routeId}.emptyUnanswered`}
        />
      );
    } else if (empty === 'filtered') {
      state = (
        <EmptyState
          preview={<ThreadRow thread={sampleThread(t, now())} routeId={`${routeId}.emptyFiltered`} inert />}
          title={t('list.emptyFilteredTitle')}
          body={t('list.emptyFilteredBody')}
          action={{ label: t('list.resetFilters'), onPress: reset, variant: 'secondary', size: 'm' }}
          testID={`${routeId}.emptyFiltered`}
        />
      );
    }
  }

  const wrapChips = kind !== 'phone';
  const chipRow = (
    <>
      <Chip
        label={t('list.sortValue', { sort: t(`sort.${sort}`) })}
        icon="sort-ascending"
        opensSheet
        accessibilityLabel={`${t('list.sortLabel')}: ${t(`sort.${sort}`)}`}
        onPress={() => setSortOpen(true)}
        testID={`${routeId}.sort`}
      />
      {chips.length > 1 ? <View style={styles.divider} aria-hidden /> : null}
      {chips.length > 1
        ? chips.map((chip) => (
            <Chip
              key={chip.slug ?? 'all'}
              label={chip.label}
              selected={(chip.slug ?? null) === sub}
              selectionRole="radio"
              onPress={() => chooseCategory(chip.slug)}
              testID={`${routeId}.category.${chip.slug ?? 'all'}`}
            />
          ))
        : null}
    </>
  );

  const pageTitle = routeId === 'FOR-02' ? (category.data?.name ?? t('title')) : segmentRoot && !inSidebar ? tabs('tabs.discover') : t('title');
  const description = routeId === 'FOR-02' ? category.data?.description : null;
  const controls = (
    <View style={styles.controls}>
      {segmentRoot ? <DiscoverSegmentBar current="forum" testID={`${routeId}.segments`} /> : null}
      {description ? (
        <Text variant="callout" color="text.secondary" testID={`${routeId}.description`}>
          {description}
        </Text>
      ) : null}
      <View style={styles.intro}>
        <SearchBar
          value={text}
          onChangeText={(next) => {
            setText(next);
            updateAddress({ q: forumQueryOf(next) });
          }}
          onCancel={() => {
            setText('');
            updateAddress({ q: null });
          }}
          placeholder={t('list.search')}
          maxLength={FORUM_LIMITS.queryMax}
          autoCorrect={false}
          testID={`${routeId}.search`}
        />
        {typedShort ? (
          <Text variant="caption" color="text.secondary" style={styles.hint} testID={`${routeId}.searchShort`}>
            {t('list.searchShort', { min: FORUM_LIMITS.queryMin })}
          </Text>
        ) : null}
      </View>
      {/* DQ-P5-026: "Meine Themen" lives in the page, not as a fourth header glyph (a chat bubble beside the paper plane read as a
          second Nachrichten); the header keeps the actions Builds and Treffen have. */}
      {access.status === 'member' ? (
        <Button
          label={t('list.mine')}
          variant="tertiary"
          size="s"
          role="link"
          flush="start"
          onPress={() => router.push('/forum/mine' as Href)}
          style={styles.mine}
          testID={`${routeId}.mine`}
        />
      ) : null}
      {wrapChips ? (
        <View style={[styles.chips, styles.chipsWrap]} role="radiogroup" aria-label={t('list.categories')} testID={`${routeId}.chips`}>
          {chipRow}
        </View>
      ) : (
        <SegmentRailScrollView
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -gutter }}
          contentContainerStyle={[styles.chips, { paddingHorizontal: gutter }]}
          role="radiogroup"
          aria-label={t('list.categories')}
          testID={`${routeId}.chips`}
        >
          {chipRow}
        </SegmentRailScrollView>
      )}
      {access.status === 'member' && access.restriction && qaState === 'restricted' ? (
        <Text variant="callout" color="text.secondary" testID={`${routeId}.restricted`}>
          {access.restriction}
        </Text>
      ) : null}
    </View>
  );

  const listView = (
    <CollapsingFlashList
      ref={listRef}
      {...header.scrollProps}
      data={state ? [] : rows}
      keyExtractor={(row: ForumThreadRow) => row.id}
      getItemType={(row: ForumThreadRow) => (row.vehicle?.cover ? 'thumb' : 'plain')}
      renderItem={({ item, index }: { item: ForumThreadRow; index: number }) => (
        <View style={columnStyle}>
          {index > 0 ? <Hairline /> : null}
          <ThreadRow thread={item} routeId={routeId} />
        </View>
      )}
      style={styles.list}
      contentContainerStyle={{ paddingBottom: inset }}
      ListHeaderComponent={
        <View>
          <HeaderLargeTitle title={pageTitle} scroll={header} testID={`${routeId}.title`} />
          <View style={columnStyle}>{controls}</View>
        </View>
      }
      ListEmptyComponent={state ? <View style={[columnStyle, skeleton ? null : styles.state]}>{state}</View> : null}
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <View style={[columnStyle, styles.more]}>
            <Spinner label={t('list.more')} testID={`${routeId}.more`} />
          </View>
        ) : null
      }
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage && !list.isError) void list.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      testID={`${routeId}.list`}
    />
  );

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header
        variant="large"
        title={pageTitle}
        scroll={header}
        onBack={segmentRoot ? undefined : back}
        actions={actions}
        contentMaxWidth={kind === 'desktop' ? layout.feedColumn + 2 * space[24] : undefined}
        testID={`${routeId}.header`}
      />
      <ShellOfflineBanner label={t('list.offlineBanner')} />
      <SegmentSwipe current="forum" enabled={segmentRoot} testID={`${routeId}.swipe`}>
        {listView}
      </SegmentSwipe>
      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title={t('list.sortSheet')} expandable={false} narrow testID={`${routeId}.sortSheet`}>
        <View role="radiogroup" aria-label={t('list.sortSheet')}>
          {THREAD_SORTS.map((option, index) => (
            <OptionRow
              key={option}
              label={t(`sort.${option}`)}
              role="radio"
              selected={option === sort}
              onPress={() => {
                setSortOpen(false);
                if (option !== sort) chooseSort(option);
              }}
              divider={index < THREAD_SORTS.length - 1}
              testID={`${routeId}.sortSheet.${option}`}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
