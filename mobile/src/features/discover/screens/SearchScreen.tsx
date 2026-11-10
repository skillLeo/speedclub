import type { FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useDiscover } from '@/api/queries/discover';
import type { FeedVehicle } from '@/api/queries/home';
import {
  countLabel,
  criteriaKey,
  interpretQuery,
  mergeResults,
  normalizeQuery,
  SEARCH_MAX_LENGTH,
  useMoreMembers,
  useMoreVehicles,
  useSearchFacets,
  useSearchOverview,
  type Facets,
  type SearchKind,
  type SearchMember,
} from '@/api/queries/search';
import { usePublicViewer } from '@/api/queries/vehicles';
import type { InterpretationChip } from '@/api/queries/ai';
import { AiLabel } from '@/features/ai/AiLabel';
import { AiSearchAction } from '@/features/ai/AiSearchAction';
import { aiChipParams } from '@/features/ai/search';
import { BrowseErrorState, RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { FeedVehicleCard, FeedVehicleCardSkeleton } from '@/features/home/components/FeedVehicleCard';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useRetainedListScroll } from '@/features/shell/useRetainedListScroll';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, layout, space, typography, useBreakpoint, useMotion, useTheme } from '@/theme';
import {
  Button,
  ContentTabs,
  EmptyState,
  GuardedFlashList,
  Hairline,
  Header,
  Screen,
  SearchBar,
  Sheet,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Spinner,
  Text,
  toast,
} from '@/ui';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { chipLabel, knownLabel, rememberLabel, slugWords, type LabelField, type LabelLookup } from '../chipLabels';
import { FilterChipRow, type ActiveChip } from '../components/FilterChipRow';
import { FilterPanel, type FilterPanelStatus } from '../components/FilterPanel';
import { FilterSheet, type FilterSheetPage } from '../components/FilterSheet';
import { PickerList } from '../components/PickerList';
import { QueryChips } from '../components/QueryChips';
import { ResultsBar } from '../components/ResultsBar';
import { ResultTile } from '../components/ResultTile';
import { SearchMemberRow } from '../components/SearchMemberRow';
import { SortSheet } from '../components/SortSheet';
import {
  activeChips,
  activeFilterCount,
  applyInterpretation,
  availableSorts,
  dropRefused,
  effectiveSort,
  hasFilters,
  removeChip,
  resetFilters,
  sameFilters,
  setSingle,
  type FacetKey,
  type FilterOptions,
  type ResultView,
  type SearchFilters,
  type SearchState,
} from '../filters';
import { UNDERSTAND_PARAM } from '../navigation';
import { clearRecentSearches, rememberSearch, useRecentSearches } from '../recentSearches';
import { useDebouncedValue } from '../useDebouncedValue';
import { useSearchPlaceholder } from '../useSearchPlaceholder';
import { useSearchUrlState } from '../useSearchUrlState';
import { LARGE_FONT_SCALE } from '@/ui/rowParts';

const ROUTE = 'DISC-02';
const EDGES: readonly Edge[] = ['left', 'right'];
/** Typing settles before the URL and the request follow (m1.8 handover: 300 ms keeps a member under the limit). */
export const SEARCH_DEBOUNCE_MS = 300;
/** Suggestions from the real makes, on an empty field and with no result. */
const SUGGESTED_MAKES = 8;
const COLUMN = layout.feedColumn;
/** Pages only ever append here, so nothing needs keeping in place, and a new answer must not ride on the card that was first (BH-39). */
const NO_ANCHOR = { disabled: true } as const;
/** Values sent whose URL has not answered yet. A router answers each one, or only the last of a quick run; a few cover both. */
const SENT_KEPT = 4;
/** Typical length of a tab label ("Fahrzeuge (12)", "Mitglieder (3)"), for the skeleton's tab bar. */
const TAB_LABEL_CHARS = 14;
/** Inter's average advance in em across such a label, as `estimateLines` counts it. */
const TAB_CHAR_EM = 0.55;
/** §8 grid tiles: 2 columns on phones and tablets; 3 beside the filter panel from 1280 (04_SCREEN_REGISTER DISC). */
const GRID_COLUMNS = { phone: 2, tablet: 2, desktop: 3 } as const;
const GRID_GAP = space[12];
/**
 * Facets and the desktop panel's URL write wait until taps settle: `search/facets` shares the `search` limit (60 a minute), and
 * an aborted request still counts. Draft and chips change at once; only the network waits.
 */
export const FACETS_DEBOUNCE_MS = 300;
/** From 1280 the filters stay open beside the results: the settings pane's width, a known column of this shell. */
const PANEL_WIDTH = layout.settingsPane;

type Row =
  | { kind: 'vehicle'; vehicle: FeedVehicle }
  | { kind: 'tiles'; key: string; vehicles: readonly FeedVehicle[] }
  | { kind: 'member'; member: SearchMember; last: boolean };

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  top: { gap: t.space[8], paddingBottom: t.space[8], paddingTop: t.space[8] },
  tabsRow: { alignItems: 'center', flexDirection: 'row' },
  tabs: { flex: 1 },
  busy: { paddingLeft: t.space[8] },
  first: { paddingTop: t.space[16] },
  firstBar: { paddingBottom: t.space[8], paddingTop: t.space[8] },
  skeletonBar: { justifyContent: 'center', minHeight: t.size.touchMin },
  chipsBelow: { paddingTop: t.space[8] },
  chipsAlone: { paddingBottom: t.space[8] },
  cardGap: { paddingBottom: t.space[24] },
  tiles: { flexDirection: 'row', gap: GRID_GAP, paddingBottom: t.space[24] },
  tile: { flexShrink: 0 },
  states: { gap: t.space[32], paddingBottom: t.space[32], paddingTop: t.space[16] },
  // RESULT 11: on the cards' column and its start edge, as the rest of the column (§15 left-aligned hierarchy).
  footer: { alignItems: 'flex-start', minHeight: t.size.touchMin, paddingBottom: t.space[32], paddingTop: t.space[8] },
  footerError: { alignItems: 'flex-start', gap: t.space[8], paddingBottom: t.space[32] },
  skeleton: { gap: t.space[24] },
  skeletonTile: { gap: t.space[8] },
  // The tab bar's geometry (ContentTabs with `bleed`): 44 high tabs with 12 of label padding reaching past the column.
  skeletonTabs: { flexDirection: 'row', marginHorizontal: -t.space[12] },
  skeletonTab: { justifyContent: 'center', minHeight: t.size.contentTab, paddingHorizontal: t.space[12] },
  skeletonTabEqual: { alignItems: 'center', flexBasis: 0, flexGrow: 1 },
  desktopRow: { flex: 1, flexDirection: 'row', gap: t.space[24], paddingLeft: t.space[24] },
  // DQ-315: a ScrollView grows by default; the panel keeps its 280 and the results take the rest.
  panel: { flexGrow: 0, flexShrink: 0, width: PANEL_WIDTH },
  panelContent: { gap: t.space[16], paddingBottom: t.space[32], paddingTop: t.space[16] },
  // DQ-328: 24 between the panel's title and its first group.
  panelHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: t.space[24] },
  main: { flex: 1, minWidth: 0 },
  // DQ-423: without the panel the members take the pane from its start edge, up to the content max the header keeps to.
  mainAlone: { maxWidth: layout.contentMax - layout.gutter.desktop },
  // Heard, not seen: the chips above already show what was understood.
  announce: { height: t.size.border.control, opacity: 0, overflow: 'hidden', position: 'absolute', width: t.size.border.control },
}));


/** DQ-191: the two content tabs and their hairline, where the loaded tabs sit, in the same equal or natural widths. */
function SearchTabsSkeleton({ width }: { width: number }) {
  const styles = useStyles();
  const theme = useTheme();
  const padding = theme.space[12];
  const label = Math.ceil(TAB_LABEL_CHARS * TAB_CHAR_EM * typography.bodyDense.fontSize * theme.fontScale);
  const row = width + 2 * padding;
  const equal = 2 * (label + 2 * padding) > row;
  const lines = equal ? Math.max(1, Math.ceil(label / Math.max(1, row / 2 - 2 * padding))) : 1;
  return (
    <Skeleton testID={`${ROUTE}.skeleton.tabs`}>
      <View style={styles.skeletonTabs}>
        {[0, 1].map((index) => (
          <View key={index} style={[styles.skeletonTab, equal ? styles.skeletonTabEqual : null]}>
            <SkeletonText variant="labelS" lines={lines} width={equal ? '80%' : label} lastLineWidth="50%" />
          </View>
        ))}
      </View>
      <Hairline />
    </Skeleton>
  );
}

/** The result cards while the first answer is on the way; the list's own 16 above them, as in the loaded list. */
function SearchSkeleton({ width }: { width: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeleton}>
        {/* DQ-205: a result usually carries a change, so the first card draws one; the next never runs longer than the page. */}
        <FeedVehicleCardSkeleton width={width} testID={`${ROUTE}.skeleton.card`} />
        <FeedVehicleCardSkeleton width={width} latest={false} />
      </View>
    </Skeleton>
  );
}

/** The field follows the URL when it changes from outside (back, a chip, a link), and the URL follows typing. */
function useQueryField(urlQuery: string) {
  const router = useRouter();
  const [text, setText] = useState(urlQuery);
  const [seen, setSeen] = useState(urlQuery);
  // BH-40: what this field sent and the URL has not answered yet, oldest first. The URL answering with one of them is its own echo: a
  // key pressed since must stay, and the effect below sends it. That holds for an older value too, when the debounce and Enter both
  // sent before the first answer. Any other value came from outside. An echo uses itself and everything sent before it up, so a later
  // back press to such a value counts again. State, not a ref, because it is read while rendering; it is set together with the
  // request, so it is there before the URL answers.
  const [sent, setSent] = useState<readonly string[]>([]);
  if (seen !== urlQuery) {
    setSeen(urlQuery);
    const echo = sent.lastIndexOf(urlQuery);
    if (echo >= 0) setSent(sent.slice(echo + 1));
    else if (normalizeQuery(text) !== urlQuery) setText(urlQuery);
  }
  const send = useCallback(
    (next: string) => {
      setSent((before) => [...before, next].slice(-SENT_KEPT));
      router.setParams({ q: next });
    },
    [router],
  );
  useEffect(() => {
    const next = normalizeQuery(text);
    if (next === urlQuery) return undefined;
    const timer = setTimeout(() => send(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [send, text, urlQuery]);
  const commit = useCallback(
    (value: string) => {
      const next = normalizeQuery(value);
      if (next !== urlQuery) send(next);
    },
    [send, urlQuery],
  );
  return { text, setText, commit };
}

/** The grid while the first answer is on the way: two rows of 4:3 tiles with their two text lines. */
function GridSkeleton({ width, columns }: { width: number; columns: number }) {
  const styles = useStyles();
  const tile = Math.floor((width - (columns - 1) * GRID_GAP) / columns);
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {[0, 1].map((row) => (
        <View key={row} style={styles.tiles}>
          {Array.from({ length: columns }, (_, index) => (
            <View key={index} style={[styles.skeletonTile, { width: tile }]}>
              <SkeletonBlock width={tile} height={Math.round((tile * 3) / 4)} corner="sm" />
              <SkeletonText variant="labelS" width="80%" />
              <SkeletonText variant="caption" width="50%" />
            </View>
          ))}
        </View>
      ))}
    </Skeleton>
  );
}

/** The sheet's groups from the facets: each under the filter key it sets. */
export function facetOptions(facets: Facets | undefined): FilterOptions {
  if (!facets) return {};
  return {
    make: facets.makes,
    model: facets.models ?? [],
    generation: facets.generations ?? [],
    drivetrain: facets.drivetrain,
    gearbox: facets.gearbox,
    fuel: facets.fuel,
    wheel_diameter: facets.wheel_diameter,
    wheel_brand: facets.wheel_brand,
    suspension_type: facets.suspension_type,
    suspension_brand: facets.suspension_brand,
    exhaust_brand: facets.exhaust_brand,
    mod_category: facets.mod_category,
  };
}

/** Names the facets give, so a chip reads "BBS", "Heck", "Gewindefahrwerk" and not the slug. */
function lookupIn(options: FilterOptions): LabelLookup {
  return (field: LabelField, value: string) => options[field as FacetKey]?.find((option) => option.value === value)?.label;
}

function facetStatus(query: { data: unknown; isPending: boolean; isError: boolean; fetchStatus: string }): FilterPanelStatus {
  if (query.data !== undefined) return 'ready';
  if (query.fetchStatus === 'paused') return 'offline';
  if (query.isError) return 'error';
  return 'loading';
}

/** Splits the vehicles into rows of tiles, keyed by their first build so a row keeps its identity while pages append. */
function tileRows(vehicles: readonly FeedVehicle[], columns: number): Row[] {
  const rows: Row[] = [];
  for (let start = 0; start < vehicles.length; start += columns) {
    const slice = vehicles.slice(start, start + columns);
    rows.push({ kind: 'tiles', key: `t.${slice[0]?.id ?? start}`, vehicles: slice });
  }
  return rows;
}

/**
 * DISC-02 /discover/search, FS-11: content tabs with counts, the chip row ("Filter" + removable active chips), "124 Builds ·
 * Relevanz ▾" with the list/grid toggle, the filter sheet with facet counts and its live total, the sort sheet, query
 * understanding on submit, and every filter in the URL. From 1280 the filters stay open on the left beside a 3-column grid.
 */
export function SearchScreen() {
  const { t } = useTranslation('discover');
  const searchHint = useSearchPlaceholder();
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotion();
  const format = useFormat();
  const online = useOnline();
  const focused = useScreenFocused();
  const qaState = useQaState();
  const restriction = useBrowseRestriction();
  const back = useBack('/discover');
  const inset = useTabBarInset();
  const queryClient = useQueryClient();
  const viewer = usePublicViewer();
  const { gutter, kind, width } = useBreakpoint();
  const { fontScale } = useTheme();
  const desktop = kind === 'desktop';
  const { state: url, update } = useSearchUrlState();
  const params = useLocalSearchParams<{ [UNDERSTAND_PARAM]?: string | string[] }>();
  const understandParam = paramOf(params[UNDERSTAND_PARAM]) === '1';
  const query = url.q;
  const field = useQueryField(query);
  const recent = useRecentSearches();
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const criteria = useMemo(() => ({ filters: url.filters, sort: url.sort }), [url.filters, url.sort]);
  const criteriaOn = hasFilters(url.filters) || url.sort !== null;
  const requestKey = `${query}#${criteriaKey(criteria)}`;
  const overview = useSearchOverview(live ? query : '', live ? criteria : undefined);
  const discover = useDiscover();
  const listRef = useRef<FlashListRef<Row>>(null);
  const retained = useRetainedListScroll(listRef);
  const [chosen, setChosen] = useState<{ key: string; tab: SearchKind } | null>(null);
  const offset = useRef(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);
  const [mainWidth, setMainWidth] = useState(0);
  const onMainLayout = useCallback((event: LayoutChangeEvent) => setMainWidth(event.nativeEvent.layout.width), []);
  // The results' inner width: the column on a phone and tablet, the space beside the panel from 1280.
  const resultsWidth = desktop && mainWidth > 0 ? mainWidth - gutter : Math.min(COLUMN, width - 2 * gutter);
  const cardWidth = Math.min(COLUMN, resultsWidth);
  const view: ResultView = url.view ?? (desktop ? 'grid' : 'list');
  const columns = GRID_COLUMNS[kind];
  const tileWidth = Math.floor((resultsWidth - (columns - 1) * GRID_GAP) / columns);
  const tileStyle = useMemo(() => [styles.tile, { width: tileWidth }], [styles.tile, tileWidth]);
  const [wanted, setWanted] = useState<ReadonlySet<string>>(() => new Set());

  // ---------- sheets ----------
  const [sheet, setSheet] = useState<{ open: boolean; page: FilterSheetPage }>({ open: false, page: 'filters' });
  const [draft, setDraft] = useState<SearchFilters>(url.filters);
  const [sortOpen, setSortOpen] = useState(false);
  const [picker, setPicker] = useState<'make' | 'model' | null>(null);
  const draftRef = useRef(draft);
  const changeDraft = useCallback((next: SearchFilters) => {
    // Read by "… anzeigen" at once, so a change made just before the tap is never left behind.
    draftRef.current = next;
    setDraft(next);
  }, []);
  // From 1280 the panel changes the results directly: its changes show at once and reach the URL once the taps settle.
  const [panelPending, setPanelPending] = useState<SearchFilters | null>(null);
  if (panelPending && sameFilters(panelPending, url.filters)) setPanelPending(null);
  const panelFilters = panelPending ?? url.filters;
  const facetsQuery = useDebouncedValue(query, FACETS_DEBOUNCE_MS);
  const appliedForFacets = useDebouncedValue(url.filters, FACETS_DEBOUNCE_MS);
  const draftForFacets = useDebouncedValue(draft, FACETS_DEBOUNCE_MS);
  const applied = useSearchFacets(facetsQuery, appliedForFacets, live && (hasFilters(appliedForFacets) || desktop));
  const drafted = useSearchFacets(facetsQuery, draftForFacets, live && sheet.open);
  const appliedOptions = useMemo(() => facetOptions(applied.data), [applied.data]);
  const draftOptions = useMemo(() => facetOptions(drafted.data), [drafted.data]);
  const lookup = useMemo(() => lookupIn(appliedOptions), [appliedOptions]);
  const draftLookup = useMemo(() => lookupIn(draftOptions), [draftOptions]);
  useEffect(() => {
    for (const [key, options] of Object.entries({ ...appliedOptions, ...draftOptions })) {
      for (const option of options ?? []) rememberLabel(key, option.value, option.label);
    }
  }, [appliedOptions, draftOptions]);

  const openFilters = useCallback(() => {
    changeDraft(url.filters);
    setSheet({ open: true, page: 'filters' });
  }, [changeDraft, url.filters]);
  const write = useCallback(
    (next: SearchState) => {
      // A direct write (a chip's ×, reset, a picker, a sort) wins over a panel change still waiting.
      setPanelPending(null);
      update(next);
    },
    [update],
  );
  const setFilters = useCallback((filters: SearchFilters) => write({ ...url, filters }), [url, write]);
  const flushPanel = useEffectEvent((filters: SearchFilters) => setFilters(filters));
  useEffect(() => {
    if (!panelPending) return undefined;
    const timer = setTimeout(() => flushPanel(panelPending), FACETS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [panelPending]);

  // ---------- query understanding (contract §3) ----------
  const urlRef = useRef(url);
  const textRef = useRef(field.text);
  const updateRef = useRef(update);
  const tRef = useRef(t);
  useEffect(() => {
    urlRef.current = url;
    textRef.current = field.text;
    updateRef.current = update;
    tRef.current = t;
    draftRef.current = draft;
  });
  // Reads the latest URL and field through refs: the answer comes back after renders that may have changed both.
  const [understood, setUnderstood] = useState<{ key: string; text: string } | null>(null);
  const pendingUnderstand = useRef<string | null>(null);
  const understand = useCallback(async (text: string) => {
    let answer;
    try {
      answer = await queryClient.fetchQuery(interpretQuery(viewer, text));
    } catch (error) {
      // Not understood or limited: the text search stands on its own. Offline, the text waits and is read once the
      // connection is back, so a submit on the road still gets its chips (test round M2.3).
      if (error instanceof ApiError && error.kind === 'network') pendingUnderstand.current = text;
      return;
    }
    pendingUnderstand.current = null;
    // Typed on since: the newer text wins.
    if (normalizeQuery(textRef.current) !== text) return;
    for (const chip of answer.chips) {
      if (chip.field === 'make' || chip.field === 'model' || chip.field === 'generation') rememberLabel(chip.field, chip.value, chip.label);
    }
    if (answer.chips.length === 0) return;
    const next = applyInterpretation({ ...urlRef.current, q: text }, answer.filters, answer.remaining_q);
    updateRef.current(next);
    // Said once for screen readers: the words became the chips above.
    const message = `${tRef.current('results.understood')}: ${answer.chips.map((chip) => chip.label).join(', ')}`;
    setUnderstood({ key: `${next.q}#${criteriaKey({ filters: next.filters, sort: next.sort })}`, text: message });
    if (!isWeb) AccessibilityInfo.announceForAccessibility(message);
  }, [queryClient, viewer]);
  // M3.7 "Mit KI suchen": the AI's chips replace the text and stand as normal, removable chips; "KI-Vorschlag" marks them while
  // the search is still the one they made.
  const [aiApplied, setAiApplied] = useState<{ key: string; label: string } | null>(null);
  const applyAi = useCallback((chips: readonly InterpretationChip[], label: string) => {
    for (const chip of chips) {
      if (chip.facet === 'make' || chip.facet === 'model' || chip.facet === 'generation') rememberLabel(chip.facet, chip.value, chip.label);
    }
    const next = applyInterpretation({ ...urlRef.current, q: '' }, aiChipParams(chips), '');
    updateRef.current(next);
    setAiApplied({ key: `${next.q}#${criteriaKey({ filters: next.filters, sort: next.sort })}`, label });
  }, []);
  useEffect(() => {
    const pending = pendingUnderstand.current;
    if (!online || !pending) return;
    pendingUnderstand.current = null;
    if (normalizeQuery(textRef.current) === pending) void understand(pending);
  }, [online, understand]);
  useEffect(() => {
    if (!understandParam || !query) return;
    // DISC-01's request is used up at once, before the answer: typing on must never read the text again.
    router.setParams({ [UNDERSTAND_PARAM]: undefined });
    void understand(query);
  }, [query, router, understand, understandParam]);

  // The previous query's answer stands in for the new one only while the new one is on its way and has results to keep
  // on screen, under the busy sign. Paused offline it never arrives: the screen says so instead of showing old cards and
  // old counts under the new query. An old "Keine Treffer" says nothing about the new query: the skeleton follows.
  const placeholder = overview.isPlaceholderData;
  const keepPrevious =
    placeholder &&
    overview.fetchStatus === 'fetching' &&
    overview.data !== undefined &&
    overview.data.vehicles.count + overview.data.members.count > 0;
  const data = placeholder && !keepPrevious ? undefined : overview.data;
  const current = data !== undefined && !placeholder;
  // Members are found by text only, so without one there is no Mitglieder tab; a filter keeps the Fahrzeuge tab in front.
  const membersTab = query !== '';
  const autoTab: SearchKind = data && membersTab && !criteriaOn && data.vehicles.count === 0 && data.members.count > 0 ? 'members' : 'vehicles';
  const tab: SearchKind = membersTab && chosen?.key === requestKey ? chosen.tab : autoTab;
  const vehiclesMore = useMoreVehicles(query, current ? data.vehicles.next_cursor : null, wanted.has(`${requestKey}|vehicles`), criteria);
  const membersMore = useMoreMembers(query, current ? data.members.next_cursor : null, wanted.has(`${requestKey}|members`));
  const more = tab === 'vehicles' ? vehiclesMore : membersMore;

  const vehicles = useMemo(() => mergeResults(data?.vehicles.items ?? [], vehiclesMore.data?.pages, (item) => item.id), [data, vehiclesMore.data]);
  const members = useMemo(() => mergeResults(data?.members.items ?? [], membersMore.data?.pages, (item) => item.username), [data, membersMore.data]);
  const makeNames = useMemo(() => (discover.data?.makes ?? []).slice(0, SUGGESTED_MAKES).map((make) => make.name), [discover.data]);

  const rows = useMemo<Row[]>(() => {
    if (tab === 'members') return members.map((member, index) => ({ kind: 'member', member, last: index === members.length - 1 }));
    return view === 'grid' ? tileRows(vehicles, columns) : vehicles.map((vehicle) => ({ kind: 'vehicle', vehicle }));
  }, [columns, members, tab, vehicles, view]);

  // BH-39: a new query starts at its best result, also for a member who had scrolled. A filter or sort is a new query.
  const { forget: forgetPlace } = retained;
  const shownRequest = useRef(requestKey);
  useEffect(() => {
    if (shownRequest.current === requestKey) return;
    shownRequest.current = requestKey;
    forgetPlace();
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [forgetPlace, requestKey]);

  useTabScrollToTop(() => {
    const node = isWeb ? (listRef.current?.getScrollableNode() as { scrollTop?: number } | null | undefined) : null;
    const before = typeof node?.scrollTop === 'number' ? node.scrollTop : offset.current;
    if (before <= 0) return false;
    forgetPlace();
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const submit = (value: string) => {
    const next = normalizeQuery(value);
    if (next) rememberSearch(next);
    field.commit(value);
    if (next) void understand(next);
  };
  const pick = (term: string) => {
    field.setText(term);
    textRef.current = term;
    submit(term);
  };

  const openVehicle = useCallback(
    (vehicle: FeedVehicle) => {
      if (query) rememberSearch(query);
      router.push(`/v/${vehicle.slug}`);
    },
    [query, router],
  );
  const openUpdate = useCallback(
    (vehicle: FeedVehicle) => {
      if (query) rememberSearch(query);
      if (vehicle.latest_update) router.push(`/v/${vehicle.slug}/updates/${vehicle.latest_update.id}`);
    },
    [query, router],
  );
  // M2.1: a member opens PROF-02 inside the Entdecken stack (shared routes, ADR-101); the own row leads to the own profile.
  const openMember = useCallback(
    (member: SearchMember) => {
      rememberSearch(query);
      if (member.is_self) {
        router.navigate('/profile');
        return;
      }
      router.push({ pathname: '/u/[username]', params: { username: member.username } });
    },
    [query, router],
  );

  const cursor = current ? (tab === 'vehicles' ? data.vehicles.next_cursor : data.members.next_cursor) : null;
  const moreLeft = cursor !== null && (!more.data || more.hasNextPage);
  // A new page on its way, or the first one after the overview. A refresh of the pages already there (focus, reconnect) is not.
  const loadingMore = more.isFetchingNextPage || (more.isFetching && !more.data);
  // BH-43: FlashList reports the end once. A turn that cannot be taken now is owed: offline until the connection is back, and during a
  // refresh of the pages already loaded until it settles (TanStack would cancel the refresh for the next page).
  const owed = useRef(false);
  const loadMore = () => {
    // Code review M2.8 nit 4: a search left behind in its tab or stack loads no pages nobody sees.
    if (!current || !focused) return;
    if (!online || (more.isFetching && more.data && !more.isFetchingNextPage)) {
      owed.current = moreLeft;
      return;
    }
    const key = `${requestKey}|${tab}`;
    if (!wanted.has(key)) {
      if (cursor) setWanted((before) => new Set(before).add(key));
      return;
    }
    if (more.hasNextPage && !more.isFetching && !more.isFetchNextPageError) void more.fetchNextPage();
  };
  const takeOwed = useEffectEvent(() => {
    owed.current = false;
    loadMore();
  });
  const refreshing = more.isFetching;
  useEffect(() => {
    if (online && !refreshing && owed.current) takeOwed();
  }, [online, refreshing]);

  // ---------- chips ----------
  const chips: ActiveChip[] = activeChips(url.filters).map((chip) => ({
    id: chip.id,
    label: chipLabel(chip, t, format.number, lookup),
    onRemove: () => setFilters(removeChip(url.filters, chip)),
  }));
  const filterCount = activeFilterCount(url.filters);
  const resetAll = () => write(resetFilters(url));
  const labelFor = (fieldName: 'make' | 'model', value: string | null, find: LabelLookup) =>
    value ? (find(fieldName, value) ?? knownLabel(fieldName, value) ?? slugWords(value)) : null;
  // The chip row's label for it: "R34", also before the facets list the generation (DQ-449).
  const generationLabelFor = (value: string | null, find: LabelLookup) =>
    value ? chipLabel({ field: 'generation', value }, t, format.number, find) : null;

  // ---------- states ----------
  const validation = overview.error instanceof ApiError && overview.error.kind === 'validation' ? overview.error : null;
  // An old or edited link may carry a value the API refuses (a merged brand, a removed category): that filter goes, the
  // list comes back, and a toast says which one.
  const refused = useEffectEvent((keys: readonly string[]) => {
    const { filters, dropped } = dropRefused(url.filters, keys);
    if (dropped.length === 0) return;
    const labels = dropped.map((chip) => chipLabel(chip, t, format.number, lookup)).join(', ');
    toast(t('filters.dropped', { count: dropped.length, labels }));
    updateRef.current({ ...url, filters });
  });
  useEffect(() => {
    if (validation) refused(Object.keys(validation.fieldErrors));
  }, [validation]);
  const offline = !online || overview.fetchStatus === 'paused';
  let state: ReactNode = null;
  let loading = false;
  const noResults = (shown: string) => (
    <View style={styles.states}>
      <EmptyState icon="magnifying-glass" title={t('noResults.title', { query: shown })} body={t('noResults.body')} testID={`${ROUTE}.noResults`} />
      <QueryChips title={t('suggestions.makes')} terms={makeNames} onPick={pick} testID={`${ROUTE}.suggestions`} />
    </View>
  );
  // FS-11: no result under filters is an illustration-free state with one way out, "Filter zurücksetzen"; the chips above stay
  // to take one filter off.
  const noFiltered = (
    <EmptyState
      icon="funnel"
      title={t('noResultsFiltered.title')}
      body={t('noResultsFiltered.body')}
      action={hasFilters(url.filters) ? { label: t('noResultsFiltered.action'), onPress: resetAll } : undefined}
      testID={`${ROUTE}.noResultsFiltered`}
    />
  );
  if (qaState === 'empty') {
    state = criteriaOn ? noFiltered : noResults(query);
  } else if (query === '' && !criteriaOn && qaState !== 'loading' && qaState !== 'error') {
    state =
      recent.length > 0 || makeNames.length > 0 ? (
        <View style={styles.states}>
          <QueryChips title={t('recent.title')} terms={recent} onPick={pick} onClear={clearRecentSearches} testID={`${ROUTE}.recent`} />
          <QueryChips title={t('suggestions.makes')} terms={makeNames} onPick={pick} testID={`${ROUTE}.suggestions`} />
        </View>
      ) : (
        <EmptyState icon="magnifying-glass" title={t('start.title')} body={t('start.body')} testID={`${ROUTE}.start`} />
      );
  } else if (
    qaState === 'loading' ||
    // A query shown with a stand-in reports success while its own answer is still pending.
    (qaState !== 'error' && !data && (overview.isPending || placeholder) && overview.fetchStatus !== 'paused')
  ) {
    loading = true;
    state = view === 'grid' && tab === 'vehicles' ? <GridSkeleton width={resultsWidth} columns={columns} /> : <SearchSkeleton width={cardWidth} />;
  } else if (validation) {
    const fieldMessage = Object.values(validation.fieldErrors)[0]?.[0];
    state = (
      <EmptyState
        icon="warning"
        title={t('invalid.title')}
        body={validation.fieldErrors.q?.[0] ?? fieldMessage ?? validation.message}
        action={hasFilters(url.filters) ? { label: t('noResultsFiltered.action'), onPress: resetAll } : undefined}
        testID={`${ROUTE}.invalid`}
      />
    );
  } else if (qaState === 'error' || !data) {
    state = (
      <BrowseErrorState
        routeId={ROUTE}
        title={t('error.title')}
        offline={qaState !== 'error' && offline}
        error={overview.error}
        onRetry={() => void overview.refetch()}
        retrying={overview.isFetching}
      />
    );
  } else if (criteriaOn && data.vehicles.count === 0 && tab === 'vehicles') {
    state = noFiltered;
  } else if (data.vehicles.count === 0 && data.members.count === 0) {
    state = noResults(data.query);
  } else if (rows.length === 0) {
    state = (
      <EmptyState
        icon={tab === 'vehicles' ? 'garage' : 'user'}
        title={tab === 'vehicles' ? t('noVehicles', { query: data.query }) : t('noMembers', { query: data.query })}
        testID={`${ROUTE}.tabEmpty`}
      />
    );
  }

  const column = kind === 'phone' ? undefined : COLUMN;
  // DQ-193, DQ-202: in the place of DISC-01's column, so field and title stay where they were when the search is sent: centred up to
  // the tablet, and from 1280 on the pane's start edge. From 1280 the results sit beside the filter panel and fill the pane.
  const columnStyle = useMemo(
    () =>
      desktop
        ? { paddingRight: gutter, width: '100%' as const }
        : { alignSelf: 'center' as const, maxWidth: COLUMN + 2 * gutter, paddingHorizontal: gutter, width: '100%' as const },
    [desktop, gutter],
  );
  const showTabs = membersTab && data !== undefined && !validation && (!state || (criteriaOn && tab === 'vehicles' && !loading));
  const tabsList = data
    ? [
        {
          value: 'vehicles' as const,
          label: t('tabs.vehicles', { count: countLabel(data.vehicles.count, data.vehicles.count_capped, format.number) }),
          testID: `${ROUTE}.tab.vehicles`,
        },
        {
          value: 'members' as const,
          label: t('tabs.members', { count: countLabel(data.members.count, data.members.count_capped, format.number) }),
          testID: `${ROUTE}.tab.members`,
        },
      ]
    : [];

  const resultsBar =
    !state && tab === 'vehicles' && data ? (
      <View style={[columnStyle, styles.firstBar]}>
        <ResultsBar
          countLabel={t('results.count', { count: data.vehicles.count, formatted: countLabel(data.vehicles.count, data.vehicles.count_capped, format.number) })}
          sort={effectiveSort(url)}
          onOpenSort={() => setSortOpen(true)}
          view={view}
          onChangeView={(next) => write({ ...url, view: next })}
          testID={`${ROUTE}.results`}
        />
      </View>
    ) : loading && tab === 'vehicles' ? (
      // DQ-327: the results bar's 44 row is kept while the first answer loads, so the first card does not move.
      <View style={[columnStyle, styles.firstBar]}>
        <Skeleton>
          <View style={styles.skeletonBar}>
            <SkeletonText variant="supporting" width="40%" />
          </View>
        </Skeleton>
      </View>
    ) : (
      <View style={styles.first} />
    );

  // The footer is a row of the column like the cards: 16/20 from the edge on a phone, on the column's edge beside the sidebar.
  const footerStyle = [columnStyle, styles.footer];
  let footer: ReactNode = <View style={footerStyle} />;
  if (!state && loadingMore) {
    footer = (
      <View style={footerStyle} testID={`${ROUTE}.loadingMore`}>
        <Spinner label={t('list.loadingMore')} />
      </View>
    );
  } else if (!state && more.isError) {
    footer = (
      <View style={[columnStyle, styles.footerError]} testID={`${ROUTE}.moreError`}>
        <Text variant="supporting" color="text.secondary">
          {t('list.moreError')}
        </Text>
        <Button label={common('actions.retry')} variant="secondary" size="m" onPress={() => void (more.data ? more.fetchNextPage() : more.refetch())} testID={`${ROUTE}.moreRetry`} />
      </View>
    );
  } else if (!state && moreLeft) {
    // BH-43: never a blank end while there is more. Offline it waits, under the banner that says why.
    footer = (
      <View style={footerStyle} testID={`${ROUTE}.moreRow`}>
        <Button label={t('list.more')} variant="secondary" size="m" disabled={!online} onPress={loadMore} testID={`${ROUTE}.more`} />
      </View>
    );
  }

  // While the draft's own count is on its way (typing settles, or the request runs) the old one would be wrong.
  const draftPending = !sameFilters(draft, draftForFacets) || drafted.isPlaceholderData;
  const draftTotal = draftPending ? undefined : drafted.data;
  const applyLabel = draftTotal
    ? draftTotal.total_capped
      ? t('filters.showCapped', { formatted: format.number(draftTotal.total) })
      : t('filters.show', { count: draftTotal.total, formatted: format.number(draftTotal.total) })
    : t('filters.showPending');

  // DQ-325: filters narrow the vehicles only, so with a Mitglieder tab the chip row sits under the tabs and only on Fahrzeuge.
  // Without that tab (filters alone, an interpreted text) it stays under the search field.
  const showChipRow = criteriaOn || hasFilters(url.filters) || (query !== '' && !desktop);
  const chipRow = showChipRow ? (
    <FilterChipRow chips={chips} count={filterCount} onOpenFilters={desktop ? null : openFilters} gutter={desktop ? 0 : gutter} testID={`${ROUTE}.chips`} />
  ) : null;
  const chipsUnderTabs = membersTab;
  const chipsBelowTabs = chipsUnderTabs && tab === 'vehicles' && chipRow ? <View style={[columnStyle, styles.chipsBelow]}>{chipRow}</View> : null;
  // DQ-332: at a large font the fixed band would take a third of a phone; only the search stays, the rest scrolls with the list.
  const bandScrolls = !desktop && fontScale >= LARGE_FONT_SCALE;
  const tabsBlock = showTabs ? (
    <View style={[styles.tabsRow, columnStyle]} aria-busy={overview.isFetching}>
      <ContentTabs
        tabs={tabsList}
        value={tab}
        onChange={(next) => setChosen({ key: requestKey, tab: next })}
        label={t('tabs.label')}
        gutter={false}
        bleed
        style={styles.tabs}
        testID={`${ROUTE}.tabs`}
      />
      {keepPrevious ? (
        <View style={styles.busy}>
          <Spinner size={16} label={t('list.searching')} testID={`${ROUTE}.searching`} />
        </View>
      ) : null}
    </View>
  ) : loading && membersTab ? (
    <View style={columnStyle}>
      <SearchTabsSkeleton width={cardWidth} />
    </View>
  ) : null;
  const band = (
    <>
      {chipsUnderTabs || !chipRow ? null : <View style={[columnStyle, styles.chipsAlone]}>{chipRow}</View>}
      {tabsBlock}
      {chipsBelowTabs}
    </>
  );

  const top = (
    <>
      <View style={[styles.top, columnStyle]}>
        <SearchBar
          value={field.text}
          onChangeText={field.setText}
          placeholder={searchHint}
          onSubmit={submit}
          maxLength={SEARCH_MAX_LENGTH}
          autoFocus={query === '' && !criteriaOn}
          autoCorrect={false}
          autoCapitalize="none"
          testID={`${ROUTE}.search`}
        />
        <AiSearchAction text={field.text} onApply={applyAi} testID={`${ROUTE}.ai`} />
        {aiApplied?.key === requestKey ? <AiLabel label={`${aiApplied.label} · ${t('ai.applied')}`} testID={`${ROUTE}.ai.label`} /> : null}
        {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
        <View aria-live="polite" style={styles.announce} testID={`${ROUTE}.understood`}>
          {understood?.key === requestKey ? <Text variant="caption">{understood.text}</Text> : null}
        </View>
      </View>
      {bandScrolls ? null : band}
    </>
  );

  const listData = state ? [] : rows;
  const list = (
    // Fewer rows after a chip, a sort or the grid: the list frame drops a cell's late web layout event for a row that is gone.
    <GuardedFlashList
      ref={listRef}
      data={listData}
      keyExtractor={(row: Row) => (row.kind === 'vehicle' ? `v.${row.vehicle.id}` : row.kind === 'tiles' ? row.key : `m.${row.member.username}`)}
      getItemType={(row: Row) => row.kind}
      style={styles.list}
      contentContainerStyle={{ paddingBottom: inset }}
      // The skeleton holds nothing to focus: as a scroll region nobody could reach it by keyboard (axe
      // scrollable-region-focusable), and there is nothing to scroll to before the results arrive.
      scrollEnabled={!loading}
      keyboardShouldPersistTaps="handled"
      // BH-38: react-native-web blurs the focused field on every scroll event with this prop, not only on a drag.
      keyboardDismissMode={isWeb ? undefined : 'on-drag'}
      maintainVisibleContentPosition={NO_ANCHOR}
      ListHeaderComponent={
        bandScrolls ? (
          <>
            {band}
            {resultsBar}
          </>
        ) : (
          resultsBar
        )
      }
      ListEmptyComponent={state ? <View style={columnStyle}>{state}</View> : null}
      ListFooterComponent={footer}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item }: { item: Row }) =>
        item.kind === 'vehicle' ? (
          <View style={[styles.cardGap, columnStyle]}>
            <FeedVehicleCard vehicle={item.vehicle} width={cardWidth} onOpen={openVehicle} onOpenUpdate={openUpdate} testID={`${ROUTE}.vehicle.${item.vehicle.id}`} />
          </View>
        ) : item.kind === 'tiles' ? (
          <View style={[styles.tiles, columnStyle]}>
            {item.vehicles.map((vehicle) => (
              <View key={vehicle.id} style={tileStyle}>
                <ResultTile vehicle={vehicle} width={tileWidth} onOpen={openVehicle} testID={`${ROUTE}.tile.${vehicle.id}`} />
              </View>
            ))}
          </View>
        ) : (
          <View style={columnStyle}>
            <SearchMemberRow member={item.member} onOpen={openMember} divider={!item.last} testID={`${ROUTE}.member.${item.member.username}`} />
          </View>
        )
      }
      testID={`${ROUTE}.list`}
    />
  );

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        title={common('routes.search')}
        onBack={back}
        contentMaxWidth={desktop ? layout.contentMax : column ? column + 2 * gutter : undefined}
        contentAlign={desktop ? 'start' : 'center'}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('offline')} />
      {desktop ? (
        <View style={styles.desktopRow}>
          {/* DQ-423: the filters narrow the vehicles only, so the panel stands beside the Fahrzeuge tab and nowhere else. */}
          {tab === 'vehicles' ? (
            <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled" testID={`${ROUTE}.panel`}>
              <View role="region" aria-label={t('filters.panelLabel')}>
                <View style={styles.panelHead}>
                  <Text variant="titleM" role="heading" {...({ 'aria-level': 2 } as object)}>
                    {t('filters.title')}
                  </Text>
                  {filterCount > 0 ? (
                    <Button label={t('filters.reset')} variant="tertiary" size="s" flush="end" onPress={resetAll} testID={`${ROUTE}.panel.reset`} />
                  ) : null}
                </View>
                <FilterPanel
                  filters={panelFilters}
                  onChange={setPanelPending}
                  surface="panel"
                  options={appliedOptions}
                  status={live ? facetStatus(applied) : 'ready'}
                  onRetry={() => void applied.refetch()}
                  retrying={applied.isFetching}
                  onOpenPicker={setPicker}
                  makeLabel={labelFor('make', panelFilters.make, lookup)}
                  modelLabel={labelFor('model', panelFilters.model, lookup)}
                  generationLabel={generationLabelFor(panelFilters.generation, lookup)}
                  testID={`${ROUTE}.panel.filters`}
                />
              </View>
            </ScrollView>
          ) : null}
          <View style={[styles.main, tab === 'vehicles' ? null : styles.mainAlone]} onLayout={onMainLayout} testID={`${ROUTE}.main`}>
            {top}
            {list}
          </View>
        </View>
      ) : (
        <>
          {top}
          {list}
        </>
      )}
      <FilterSheet
        visible={sheet.open}
        onClose={() => setSheet((before) => ({ ...before, open: false }))}
        page={sheet.page}
        onChangePage={(page) => setSheet({ open: true, page })}
        draft={draft}
        onChangeDraft={changeDraft}
        options={draftOptions}
        status={facetStatus(drafted)}
        onRetry={() => void drafted.refetch()}
        retrying={drafted.isFetching}
        applyLabel={applyLabel}
        onApply={() => {
          setSheet((before) => ({ ...before, open: false }));
          setFilters(draftRef.current);
        }}
        onReset={() => changeDraft(resetFilters({ ...url, filters: draftRef.current }).filters)}
        makeLabel={labelFor('make', draft.make, draftLookup)}
        modelLabel={labelFor('model', draft.model, draftLookup)}
        generationLabel={generationLabelFor(draft.generation, draftLookup)}
        testID={`${ROUTE}.filterSheet`}
      />
      <SortSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        sorts={availableSorts(query)}
        value={effectiveSort(url)}
        onChange={(sort) => write({ ...url, sort })}
        testID={`${ROUTE}.sortSheet`}
      />
      {desktop ? (
        <Sheet
          visible={picker !== null}
          onClose={() => setPicker(null)}
          title={picker === 'model' ? t('filters.chooseModel') : t('filters.chooseMake')}
          narrow
          testID={`${ROUTE}.pickerSheet`}
        >
          {picker ? (
            <PickerList
              field={picker}
              options={(picker === 'make' ? appliedOptions.make : appliedOptions.model) ?? []}
              value={picker === 'make' ? url.filters.make : url.filters.model}
              loading={applied.isPending}
              onPick={(value) => {
                setPicker(null);
                setFilters(setSingle(url.filters, picker, value));
              }}
              testID={`${ROUTE}.picker.${picker}`}
            />
          ) : null}
        </Sheet>
      ) : null}
    </Screen>
  );
}
