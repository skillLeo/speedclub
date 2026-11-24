import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useDexSets, windowOpen, type DexSet, type DexSlot, type SetWindow } from '@/api/queries/dex';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useBack } from '@/features/vehicle/navigation';
import { qa, useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Header, HeaderLargeTitle } from '@/ui/Header';
import { Progress } from '@/ui/Progress';
import { Screen } from '@/ui/Screen';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { DexSamplePreview } from '../components/DexSamplePreview';
import { DexTile, DexTileSkeleton, RemainingTile, SilhouetteTile } from '../components/DexTile';
import { CARD_COLUMNS, chunk, ROW_GAP, SLOT_COLUMNS, TILE_GAP, tileWidth, useDexGrid } from '../layout';
import { dexCardRoute, DEX_HOME_ROUTE } from '../navigation';
import { QA_SETS, qaDexActive, samplePhoto } from '../qaDex';

const ROUTE = 'DEX-05';
const EDGES: readonly Edge[] = ['left', 'right'];
/** The year a month-day is read in: any leap year, so 29 February formats. */
const WINDOW_YEAR = 2028;

/** One place on a binder page: a slot of the set, or "+n offen" for the rest of a count rule (DQ-P5G-09). */
export type BinderItem = { kind: 'slot'; slot: DexSlot; index: number } | { kind: 'remaining'; count: number; index: number };

type Row =
  | { kind: 'page'; key: string; set: DexSet; first: boolean }
  | { kind: 'slots'; key: string; set: DexSet; items: BinderItem[] };

/**
 * A set's places: every found car and every open slot the rule names (JDM generations); the open slots a count rule leaves
 * unnamed ("5 Autos", a season) fold into one "+n offen" after them, instead of n identical "???" (DQ-P5G-09).
 */
export function binderItems(slots: readonly DexSlot[]): BinderItem[] {
  const anonymous = slots.filter((slot) => !slot.found && slot.silhouette === null).length;
  const items: BinderItem[] = [];
  slots.forEach((slot, index) => {
    if (anonymous > 1 && !slot.found && slot.silhouette === null) return;
    items.push({ kind: 'slot', slot, index });
  });
  if (anonymous > 1) items.push({ kind: 'remaining', count: anonymous, index: slots.length });
  return items;
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // The large title on the grid's column (its own gutter is the column's padding).
  largeTitle: { paddingHorizontal: 0 },
  page: { gap: t.space[8], paddingBottom: t.space[16], paddingTop: t.space[24] },
  pageFirst: { paddingTop: t.space[8] },
  titleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'space-between' },
  titleSkeleton: { flexBasis: '100%' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  tag: {
    alignSelf: 'flex-start',
    borderColor: t.color.border.default,
    borderRadius: t.radius.xs,
    borderWidth: t.size.border.control,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  done: { backgroundColor: t.color.bg.inverse, borderColor: t.color.bg.inverse },
  meta: { gap: t.space[4] },
  row: { flexDirection: 'row', gap: TILE_GAP, paddingBottom: ROW_GAP },
  states: { paddingTop: t.space[16] },
  end: { paddingBottom: t.space[32] },
}));

/**
 * DQ-P5G-10: rows of one type share one height, so FlashList's estimate for the rows it has not drawn yet is right and the end of
 * the binder (its inset above the tab bar) is where it is measured: a page head with or without its season line, a row with cards
 * or with open slots only.
 */
function itemType(row: Row): string {
  if (row.kind === 'page') return `page${row.first ? '.first' : ''}${row.set.window ? '.window' : ''}`;
  return row.items.some((entry) => entry.kind === 'slot' && entry.slot.found) ? 'slots.cards' : 'slots.open';
}

/** "1.3." / "1 Mar" for a month-day of a season window. */
export function monthDayText(monthDay: string, locale: 'de' | 'en'): string {
  const [month, day] = monthDay.split('-').map(Number);
  const date = new Date(WINDOW_YEAR, (month ?? 1) - 1, day ?? 1);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: locale === 'en' ? 'short' : 'numeric' }).format(date);
}

/** The season line of a set: "1.3. bis 30.4." while it runs, "Läuft wieder ab 1.3." outside it; null without a window. */
export function windowLine(t: (key: string, options?: Record<string, unknown>) => string, window: SetWindow | null, today: Date, locale: 'de' | 'en'): string | null {
  if (!window) return null;
  const from = monthDayText(window.starts_on, locale);
  return windowOpen(window, today) ? t('sets.window', { from, to: monthDayText(window.ends_on, locale) }) : t('sets.windowLater', { from });
}

/** A set's binder page: name, kind, the season, "3 von 10" over its bar, or "Komplett" with its day. */
function SetPage({ set, first }: { set: DexSet; first: boolean }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const format = useFormat();
  const today = qa.now ?? new Date();
  const done = set.completed_at !== null || (set.target > 0 && set.progress >= set.target);
  const completedAt = set.completed_at ? new Date(set.completed_at) : null;
  const season = windowLine(t, set.window, today, format.locale);
  const testID = `${ROUTE}.set.${set.key}`;
  return (
    <View style={[styles.page, first ? styles.pageFirst : null]} testID={testID}>
      {first ? null : <Hairline />}
      <View style={styles.titleRow}>
        <Text variant="headline" role="heading" aria-level={2} testID={`${testID}.name`}>
          {set.name}
        </Text>
        <View style={styles.tags}>
          <View style={styles.tag}>
            <Text variant="labelBadge" color="text.secondary" hyphenate={false}>
              {t(`sets.kind.${set.kind}`)}
            </Text>
          </View>
          {done ? (
            <View style={[styles.tag, styles.done]} testID={`${testID}.complete`}>
              <Text variant="labelBadge" color="text.inverse" hyphenate={false}>
                {t('sets.complete')}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.meta}>
        <Text variant="callout" color="text.secondary" numeric aria-label={t('sets.progressLabel', { name: set.name, progress: set.progress, target: set.target })} testID={`${testID}.progress`}>
          {done && completedAt && !Number.isNaN(completedAt.getTime())
            ? t('sets.completedOn', { date: format.longDate(completedAt) })
            : t('sets.progress', { progress: format.number(set.progress), target: format.number(set.target) })}
        </Text>
        {season ? (
          <Text variant="caption" color="text.tertiary" numeric testID={`${testID}.window`}>
            {season}
          </Text>
        ) : null}
      </View>
      <Progress value={set.target > 0 ? Math.min(1, set.progress / set.target) : 0} label={t('sets.progressLabel', { name: set.name, progress: set.progress, target: set.target })} />
    </View>
  );
}

function SetsSkeleton({ columns, tile }: { columns: number; tile: number }) {
  const styles = useStyles();
  return (
    // DQ-P5G-69: the binder page's own containers and gaps (SetPage: page, title row, meta, bar), then the slot row, so nothing moves
    // when the sets arrive.
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {[0, 1].map((page) => (
        <View key={page}>
          <View style={[styles.page, page === 0 ? styles.pageFirst : null]}>
            {page === 0 ? null : <Hairline />}
            <View style={styles.titleRow}>
              {/* A row gives its children no width: the bar's 45 % needs a full-width parent (design QA round 4). */}
              <View style={styles.titleSkeleton}>
                <SkeletonText variant="headline" width="45%" />
              </View>
            </View>
            <View style={styles.meta}>
              <SkeletonText variant="callout" width="25%" />
            </View>
            <SkeletonBlock width="100%" height={size.progress.height} corner="full" />
          </View>
          <View style={styles.row}>
            {Array.from({ length: columns }, (_, cell) => (
              <View key={cell} style={{ width: tile }}>
                <DexTileSkeleton compact />
              </View>
            ))}
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

/**
 * DEX-05 Sets (contract §3/§8, 10 §16.2): every set as a binder page — its name and kind, the season window (Saisonstart 1.3.–30.4.,
 * Saison 1.5.–31.10.), "3 von 10" over its bar or "Komplett" — and its slots: the found cars as cards (to DEX-04), the open ones as
 * "???" with the hint the set rule gives (JDM generations), the rest of a count rule as one "+n offen", never a ghost car.
 */
export function DexSetsScreen() {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const inset = useTabBarInset();
  const back = useBack(DEX_HOME_ROUTE);
  const header = useCollapsingHeader();
  const grid = useDexGrid(SLOT_COLUMNS);
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const sample = qaDexActive();
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const query = useDexSets(live && !sample && status === 'member');
  const sets = useMemo(() => (live ? (sample ? QA_SETS : (query.data ?? [])) : []), [live, query.data, sample]);

  const rows = useMemo<Row[]>(
    () =>
      sets.flatMap((set, setIndex): Row[] => [
        { kind: 'page', key: `p.${set.key}`, set, first: setIndex === 0 },
        ...chunk(binderItems(set.slots), grid.columns).map((items): Row => ({ kind: 'slots', key: `s.${set.key}.${items[0]?.index ?? 0}`, set, items })),
      ]),
    [grid.columns, sets],
  );

  let state: ReactNode = null;
  let loading = false;
  if (status === 'guest') {
    state = (
      <EmptyState
        icon="qr-sticker"
        title={t('home.guest.title')}
        body={t('home.guest.body')}
        action={{ label: t('home.guest.signIn'), onPress: () => requireAuth(undefined, { returnTo: '/dex/sets' }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (qaState === 'loading' || status === 'loading' || (!sample && !query.data && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    loading = true;
    state = <SetsSkeleton columns={grid.columns} tile={grid.tile} />;
  } else if (qaState === 'error' || (!sample && !query.data && qaState !== 'empty')) {
    const offline = qaState !== 'error' && (!online || query.fetchStatus === 'paused');
    state = (
      <ErrorState
        title={offline ? t('sets.offline') : t('sets.errorTitle')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (sets.length === 0) {
    state = (
      <EmptyState
        preview={<DexSamplePreview width={tileWidth(grid.inner, CARD_COLUMNS[grid.kind])} testID={`${ROUTE}.empty.sample`} />}
        title={t('sets.empty.title')}
        body={t('sets.empty.body')}
        action={{ label: t('sets.empty.action'), onPress: () => router.navigate(DEX_HOME_ROUTE), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  }

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'page') {
      return (
        <View style={grid.style}>
          <SetPage set={item.set} first={item.first} />
        </View>
      );
    }
    return (
      <View style={grid.style}>
        <View role="list" style={styles.row}>
          {item.items.map((entry) => (
            <View key={entry.index} role="listitem" style={{ width: grid.tile }}>
              {entry.kind === 'remaining' ? (
                <RemainingTile count={entry.count} testID={`${ROUTE}.set.${item.set.key}.remaining`} />
              ) : entry.slot.found && entry.slot.vehicle ? (
                <DexTile
                  compact
                  card={entry.slot.vehicle}
                  width={grid.tile}
                  photo={samplePhoto(entry.slot.vehicle.vehicle.id)}
                  onPress={() => entry.slot.vehicle && router.push(dexCardRoute(entry.slot.vehicle.vehicle.id))}
                  testID={`${ROUTE}.set.${item.set.key}.slot.${entry.index}`}
                />
              ) : (
                <SilhouetteTile compact silhouette={entry.slot.silhouette} width={grid.tile} testID={`${ROUTE}.set.${item.set.key}.slot.${entry.index}`} />
              )}
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        scroll={header}
        title={t('sets.title')}
        onBack={back}
        contentMaxWidth={grid.headerWidth}
        contentAlign={grid.headerAlign}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('sets.offline')} />
      <View style={styles.list} onLayout={grid.onPaneLayout}>
        <CollapsingFlashList
          {...header.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(row: Row) => row.key}
          getItemType={itemType}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          scrollEnabled={!loading}
          ListHeaderComponent={
            <View style={grid.style}>
              <HeaderLargeTitle title={t('sets.title')} scroll={header} style={styles.largeTitle} testID={`${ROUTE}.title`} />
            </View>
          }
          // The skeleton starts where the first binder page starts (right under the large title); only the other states keep the padding.
          ListEmptyComponent={state ? <View style={[grid.style, loading ? null : styles.states]}>{state}</View> : null}
          ListFooterComponent={<View style={styles.end} />}
          renderItem={renderItem}
          testID={`${ROUTE}.list`}
        />
      </View>
    </Screen>
  );
}
