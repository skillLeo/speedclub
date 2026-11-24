import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ALL_FILTER, setActive, useDexSets, useMyDex, type DexFilter, type DexMake, type DexMeta, type DexSet, type SetSilhouette, type SpotCard } from '@/api/queries/dex';
import { RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useBack } from '@/features/vehicle/navigation';
import { qa, useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Header, HeaderLargeTitle, type HeaderAction } from '@/ui/Header';
import { Progress } from '@/ui/Progress';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { scannerAvailable } from '../availability';
import { DexEmptyIntro } from '../components/DexEmptyIntro';
import { DexExplainer } from '../components/DexExplainer';
import { DexFilters } from '../components/DexFilters';
import { DexSamplePreview } from '../components/DexSamplePreview';
import { DexTile, DexTileSkeleton, SilhouetteTile } from '../components/DexTile';
import { RaritySheet } from '../components/RaritySheet';
import { rarityOf } from '../components/SpotCardFace';
import { useScanAction } from '../entry';
import { CARD_COLUMNS, chunk, ROW_GAP, TILE_GAP, useDexGrid } from '../layout';
import { dexCardRoute, DEX_HOME_ROUTE, DEX_SETS_ROUTE, SCAN_ROUTE } from '../navigation';
import { QA_CARDS, QA_META, QA_SETS, qaDexActive, samplePhoto } from '../qaDex';

const ROUTE = 'DEX-01';
const EDGES: readonly Edge[] = ['left', 'right'];
/**
 * "Noch offen in deinen Sets" under "Alle": one row of compact slots, so what the member owns stays the focal point (DQ-P5G-08);
 * the rest are on DEX-05 behind "Alle Sets".
 */
const OPEN_ROWS = 1;
const SKELETON_ROWS = 2;

/** One unfound slot as DEX-01 shows it, with the set it belongs to. */
export type OpenSlot = { key: string; silhouette: SetSilhouette | null; setName: string };

type Row = { kind: 'cards'; key: string; cards: SpotCard[] } | { kind: 'openHeader' } | { kind: 'open'; key: string; slots: OpenSlot[] };

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // The large title on the grid's column (its own gutter is the column's padding).
  largeTitle: { paddingHorizontal: 0 },
  head: { gap: t.space[16], paddingBottom: t.space[24], paddingTop: t.space[8] },
  // R4-3.1: the explainer under the title, 16 above the progress (8 here and the head's 8).
  explainer: { paddingBottom: t.space[8], paddingTop: t.space[8] },
  progress: { gap: t.space[8] },
  numerals: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  help: { alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', gap: t.space[8] },
  row: { flexDirection: 'row', gap: TILE_GAP, paddingBottom: ROW_GAP },
  openHeader: { paddingBottom: t.space[12], paddingTop: t.space[8] },
  more: { alignItems: 'flex-start', paddingBottom: t.space[16] },
  end: { paddingBottom: t.space[32] },
  states: { paddingTop: t.space[16] },
  skeleton: { gap: 0 },
}));

/** The unfound slots of the active sets (or of the one set filtered), each with its set; never more than `max`. */
export function openSlots(sets: readonly DexSet[], filter: DexFilter, today: Date, max: number): OpenSlot[] {
  const chosen = filter.kind === 'set' ? sets.filter((set) => set.key === filter.key) : filter.kind === 'all' ? sets.filter((set) => setActive(set, today)) : [];
  const slots = chosen.flatMap((set) =>
    set.slots.flatMap((slot, index) => (slot.found ? [] : [{ key: `${set.key}.${index}`, silhouette: slot.silhouette, setName: set.name }])),
  );
  return filter.kind === 'set' ? slots : slots.slice(0, max);
}

/** The QA set under a filter (the server filters the real cards). */
export function qaCards(filter: DexFilter): SpotCard[] {
  switch (filter.kind) {
    case 'rarity':
      return QA_CARDS.filter((card) => rarityOf(card.vehicle) === filter.tier);
    case 'make':
      return QA_CARDS.filter((card) => card.vehicle.make_slug === filter.slug);
    case 'set': {
      const ids = new Set(QA_SETS.find((set) => set.key === filter.key)?.slots.map((slot) => slot.vehicle?.vehicle.id) ?? []);
      return QA_CARDS.filter((card) => ids.has(card.vehicle.id));
    }
    default:
      return [...QA_CARDS];
  }
}

/** The makes of the cards loaded under "Alle", A–Z, each once, with the server's slug for `filter=make:{slug}`. */
export function makesOf(cards: readonly SpotCard[]): DexMake[] {
  const byslug = new Map<string, DexMake>();
  for (const { vehicle } of cards) if (vehicle.make && vehicle.make_slug) byslug.set(vehicle.make_slug, { slug: vehicle.make_slug, name: vehicle.make });
  return [...byslug.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** "Dex 87 / 1.240" (tnum) over the progress bar. */
function DexProgress({ meta }: { meta: DexMeta }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const format = useFormat();
  const found = format.number(meta.found);
  const total = format.number(meta.total);
  return (
    <View style={styles.progress} testID={`${ROUTE}.progress`}>
      <View style={styles.numerals} accessible aria-label={t('home.progressA11y', { found, total })}>
        <Text variant="labelCaps" color="text.secondary" aria-hidden>
          {t('home.progressLabel')}
        </Text>
        <Text variant="heroNumeralS" numeric hyphenate={false} aria-hidden testID={`${ROUTE}.progress.value`}>
          {t('home.progress', { found, total })}
        </Text>
      </View>
      <Progress value={meta.total > 0 ? Math.min(1, meta.found / meta.total) : 0} label={t('home.barLabel')} testID={`${ROUTE}.progress.bar`} />
    </View>
  );
}

/** The four filter chips' widths (Alle · Rarität · Marke · Sets), close to the German labels. */
const SKELETON_CHIPS = [56, 96, 88, 80] as const;

/**
 * DQ-P5G-12: the loaded head's geometry (progress, then the 32 chip row) at the head's own offset, and the tiles as the cards draw
 * them (one framed block of a card's height each), so the rows keep the loaded grid's pitch.
 */
function DexHomeSkeleton({ columns, tile }: { columns: number; tile: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`} style={styles.skeleton}>
      <View style={styles.head}>
        <View style={styles.progress}>
          <SkeletonText variant="heroNumeralS" width="45%" />
          <SkeletonBlock width="100%" height={size.progress.height} corner="full" />
        </View>
        <View style={styles.chips}>
          {SKELETON_CHIPS.map((width) => (
            <SkeletonBlock key={width} width={width} height={size.chip} corner="full" />
          ))}
        </View>
      </View>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: columns }, (__, cell) => (
            <View key={cell} style={{ width: tile }}>
              <DexTileSkeleton />
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
  );
}

/** The cards of a filter and the progress: the server's pages, or the QA set under `qaDex`. */
function useDexData(filter: DexFilter, live: boolean) {
  const sample = qaDexActive();
  const query = useMyDex(filter, live && !sample);
  const all = useMyDex(ALL_FILTER, live && !sample && filter.kind !== 'all');
  const sets = useDexSets(live && !sample);
  const cards = useMemo(() => (sample ? qaCards(filter) : (query.data?.pages.flatMap((page) => page.data) ?? [])), [filter, query.data, sample]);
  const allCards = useMemo(
    () => (sample ? [...QA_CARDS] : filter.kind === 'all' ? cards : (all.data?.pages.flatMap((page) => page.data) ?? [])),
    [all.data, cards, filter.kind, sample],
  );
  const makes = useMemo(() => makesOf(allCards), [allCards]);
  // The progress is the whole Dex whatever the filter: "Alle"'s first page carries it, the filtered one until that is in.
  const meta = sample ? QA_META : ((filter.kind === 'all' ? query.data : all.data)?.pages[0]?.meta ?? query.data?.pages[0]?.meta ?? null);
  return { query, sets: sample ? QA_SETS : (sets.data ?? []), cards, meta, makes };
}

/**
 * DEX-01 Mein Dex ★ (10 §16.2, contract §3/§8): "Dex 87 / 1.240" in the numeral face over its bar, the chips Alle · Rarität · Marke ·
 * Sets, the cards as a grid (2/3/4 columns, each its photo, number, rarity frame and First Spotter mark), then "???" for the cars
 * still open in the active sets. From Profil; a card opens DEX-04. Works on the member web as in the app (only scanning does not).
 */
export function DexHomeScreen() {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const back = useBack('/profile');
  const inset = useTabBarInset();
  const grid = useDexGrid(CARD_COLUMNS);
  const header = useCollapsingHeader();
  const status = useSessionStore((state) => state.status);
  const requireAuth = useRequireAuth();
  const restriction = useBrowseRestriction();
  const scan = useScanAction(ROUTE);
  const [filter, setFilter] = useState<DexFilter>(ALL_FILTER);
  const [rarityOpen, setRarityOpen] = useState(false);
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const data = useDexData(filter, live && status === 'member');
  const { query } = data;
  const today = useMemo(() => qa.now ?? new Date(), []);

  const cards = useMemo(() => (live ? data.cards : []), [data.cards, live]);
  const open = useMemo(() => (live ? openSlots(data.sets, filter, today, grid.columns * OPEN_ROWS) : []), [data.sets, filter, grid.columns, live, today]);
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = chunk(cards, grid.columns).map((row) => ({ kind: 'cards', key: `c.${row[0]?.vehicle.id ?? ''}`, cards: row }));
    if (open.length === 0) return list;
    return [...list, { kind: 'openHeader' }, ...chunk(open, grid.columns).map((row): Row => ({ kind: 'open', key: `o.${row[0]?.key ?? ''}`, slots: row }))];
  }, [cards, grid.columns, open]);

  const openCard = useCallback((card: SpotCard) => router.push(dexCardRoute(card.vehicle.id)), [router]);
  const startScan = () => router.push(SCAN_ROUTE);
  const actions: HeaderAction[] = [{ icon: 'question', label: t('home.rarityHelp'), onPress: () => setRarityOpen(true), testID: `${ROUTE}.rarityHelp` }, scan];

  let state: ReactNode = null;
  let loading = false;
  let failed = false;
  // A new spotter's Dex: the empty state alone, without "0 / 1.240" and chips above it.
  let emptyDex = false;
  const sample = qaDexActive();
  if (status === 'guest') {
    // R4DQ-12: the steps, "Anmelden" under them, the rules link and the sample: one explanation, the action in the first view.
    emptyDex = true;
    state = (
      <DexEmptyIntro
        routeId={ROUTE}
        preview={<DexSamplePreview width={grid.tile} align="start" testID={`${ROUTE}.guest.sample`} />}
        title={t('home.guest.title')}
        action={{ label: t('home.guest.signIn'), onPress: () => requireAuth(undefined, { returnTo: DEX_HOME_ROUTE }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (qaState === 'loading' || status === 'loading' || (live && !sample && !query.data && query.isPending && query.fetchStatus !== 'paused')) {
    loading = true;
    state = <DexHomeSkeleton columns={grid.columns} tile={grid.tile} />;
  } else if (qaState === 'error' || (live && !sample && !query.data)) {
    failed = true;
    const offline = qaState !== 'error' && (!online || query.fetchStatus === 'paused');
    state = (
      <ErrorState
        title={offline ? t('home.offline') : t('home.errorTitle')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (qaState === 'empty' || (filter.kind === 'all' && cards.length === 0 && (data.meta?.found ?? 0) === 0)) {
    // 09 §5 "never empty" and R4DQ-12: the explainer's steps, the one way in under them, the rules link, then the badged sample
    // of a card and a "???" slot. The member web adds that scanning needs the phone.
    emptyDex = true;
    state = (
      <DexEmptyIntro
        routeId={ROUTE}
        preview={<DexSamplePreview width={grid.tile} align="start" testID={`${ROUTE}.empty.sample`} />}
        title={t('home.empty.title')}
        note={scannerAvailable() ? undefined : t('home.empty.webBody')}
        action={{ label: t('home.empty.action'), onPress: startScan }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else if (cards.length === 0 && open.length === 0) {
    state = (
      <EmptyState
        icon="funnel"
        title={t('home.filterEmpty.title')}
        body={t('home.filterEmpty.body')}
        action={{ label: t('home.filterEmpty.action'), onPress: () => setFilter(ALL_FILTER), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.filterEmpty`}
      />
    );
  }

  const showHead = status === 'member' && !loading && !emptyDex && qaState !== 'error' && (sample || query.data !== undefined);
  const head = (
    <View style={grid.style}>
      <HeaderLargeTitle title={t('home.title')} scroll={header} style={styles.largeTitle} testID={`${ROUTE}.title`} />
      {restriction ? <RestrictionNotice message={t('home.restricted')} testID={`${ROUTE}.restricted`} /> : null}
      {/* R4-3.1: what the Dex is and its rules; not over a skeleton or an error, and not over an empty Dex, whose state carries
          the steps itself (R4DQ-12). */}
      {status !== 'loading' && !loading && !failed && !emptyDex ? (
        <DexExplainer routeId={ROUTE} style={styles.explainer} />
      ) : null}
      {showHead && data.meta ? (
        <View style={styles.head}>
          <DexProgress meta={data.meta} />
          <DexFilters value={filter} onChange={setFilter} makes={data.makes} sets={data.sets} gutter={grid.gutter} testID={`${ROUTE}.filters`} />
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'openHeader') {
      return (
        <View style={grid.style}>
          <SectionHeader
            title={t('home.open.title')}
            actionLabel={t('home.open.allSets')}
            actionAccessibilityLabel={t('home.open.allSetsLabel')}
            onAction={() => router.push(DEX_SETS_ROUTE)}
            style={styles.openHeader}
            testID={`${ROUTE}.open.header`}
          />
        </View>
      );
    }
    if (item.kind === 'open') {
      return (
        <View style={grid.style}>
          <View role="list" style={styles.row}>
            {item.slots.map((slot) => (
              <View key={slot.key} role="listitem" style={{ width: grid.tile }}>
                <SilhouetteTile
                  silhouette={slot.silhouette}
                  setName={filter.kind === 'set' ? undefined : slot.setName}
                  width={grid.tile}
                  testID={`${ROUTE}.open.${slot.key}`}
                />
              </View>
            ))}
          </View>
        </View>
      );
    }
    return (
      <View style={grid.style}>
        <View role="list" style={styles.row}>
          {item.cards.map((card) => (
            <View key={card.vehicle.id} role="listitem" style={{ width: grid.tile }}>
              <DexTile card={card} width={grid.tile} photo={samplePhoto(card.vehicle.id)} onPress={() => openCard(card)} testID={`${ROUTE}.card.${card.vehicle.id}`} />
            </View>
          ))}
        </View>
      </View>
    );
  };

  const footer =
    !state && query.hasNextPage ? (
      <View style={[grid.style, styles.more]}>
        <Button
          label={t('home.loadMore')}
          variant="secondary"
          size="m"
          loading={query.isFetchingNextPage}
          disabled={!online}
          onPress={() => void query.fetchNextPage()}
          testID={`${ROUTE}.more`}
        />
      </View>
    ) : null;

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        scroll={header}
        title={t('home.title')}
        onBack={back}
        // R4DQ-12: an empty Dex has no rarity to explain; its state carries the rules link.
        actions={status === 'member' ? (emptyDex ? [scan] : actions) : undefined}
        contentMaxWidth={grid.headerWidth}
        contentAlign={grid.headerAlign}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('home.offline')} />
      <View style={styles.list} onLayout={grid.onPaneLayout}>
        <CollapsingFlashList
          {...header.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(row: Row) => (row.kind === 'openHeader' ? row.kind : row.key)}
          getItemType={(row: Row) => row.kind}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          scrollEnabled={!loading}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage && online) void query.fetchNextPage();
          }}
          ListHeaderComponent={head}
          // DQ-P5G-12: the skeleton starts where the loaded head does (its own `head` padding), the other states 16 lower.
          ListEmptyComponent={state ? <View style={[grid.style, loading ? null : styles.states]}>{state}</View> : null}
          ListFooterComponent={
            <>
              {footer}
              <View style={styles.end} />
            </>
          }
          renderItem={renderItem}
          testID={`${ROUTE}.list`}
        />
      </View>
      <RaritySheet visible={rarityOpen} onClose={() => setRarityOpen(false)} testID={`${ROUTE}.raritySheet`} />
    </Screen>
  );
}

