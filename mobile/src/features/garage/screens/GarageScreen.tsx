import type { FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useDeleteVehicle, useReorderVehicles } from '@/api/queries/garage';
import { useMyVehicles, type VehicleCardData } from '@/api/queries/profile';
import { photoFields } from '@/features/profile/media';
import { UpcomingSection } from '@/features/maintenance/components/UpcomingSection';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { keepNameTogether, keepValuesTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';
import { motionDuration, useMotionPreference } from '@/ui/motion';
import {
  Button,
  CollapsingFlashList,
  Dialog,
  Hairline,
  Header,
  HeaderLargeTitle,
  Icon,
  IconButton,
  ListRow,
  Photo,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  toast,
  useCollapsingHeader,
  VehicleCard,
  VehicleCardSkeleton,
  type HeaderAction,
} from '@/ui';
import { CarouselSnap, PageIndicator } from '@/ui/motion/kit';
import { useStacksAtFontScale } from '@/ui/rowParts';
import { estimateLines } from '@/ui/Skeleton';

import { estimatedPaneWidth, LoadErrorState, RestrictedNotice, SignInState, useGarageAccess, HEADER_TEXT_ACTION } from '../components/frames';
import { GarageEmpty } from '../components/GarageEmpty';
import { QuickActions, QuickActionsSkeleton, type QuickAction } from '../components/QuickActions';
import { SortHandleSlot, Sortable } from '../components/Sortable';
import { saveErrorMessage } from '../errors';
import { garageCardProps } from '../card';
import { completenessBar, moveItem, resumeStep, splitGarage } from '../model';
import { postUpdateHref, wizardPath } from '../navigation';

const ROUTE = 'GAR-01';
const EDGES: readonly Edge[] = ['left', 'right'];
/**
 * Title, stats and drafts share the feed column up to the tablet, centred (DQ-202, ADR-160); from 1280 the page uses the content
 * width from the pane's start edge, with the cards two to a row (DQ-921: no phone column stretched over a desktop).
 */
const COLUMN_MAX = layout.feedColumn;
const SORT_ROW = size.row.withThumb;
/** "Build zu 70 % vollständig": the server's line, not known before the list arrives. */
const TYPICAL_COMPLETENESS_CHARS = 25;
/** SM16: how much of each neighbour shows beside the focused card, on top of the gap. */
const CAROUSEL_PEEK = space[24];
const CAROUSEL_GAP = space[12];
const DESKTOP_COLUMNS = 2;
const DESKTOP_GAP = layout.grid.desktop.gutter;

type Row =
  | { kind: 'carousel' }
  | { kind: 'grid'; cards: VehicleCardData[]; last: boolean }
  | { kind: 'stats' }
  /** M4.13 "Nächste Fälligkeiten" (09 §8.8): renders nothing while nothing is due. */
  | { kind: 'due' }
  | { kind: 'draftsHeader' }
  | { kind: 'draft'; card: VehicleCardData; first: boolean; last: boolean };

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'center', maxWidth: COLUMN_MAX + 2 * layout.gutter.desktop, width: '100%' },
  columnWide: { alignSelf: 'flex-start', maxWidth: layout.contentMax },
  carousel: { paddingBottom: t.space[8] },
  pills: { alignItems: 'center', paddingTop: t.space[12] },
  // The row lines up with the centred card, not the page's gutters.
  focusedRow: { alignSelf: 'center' },
  gridRow: { columnGap: DESKTOP_GAP, flexDirection: 'row', paddingBottom: t.space[32] },
  gridCell: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  stats: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], paddingBottom: t.space[24], paddingTop: t.space[16] },
  statsText: { flexShrink: 1 },
  sectionGap: { paddingBottom: t.space[12], paddingTop: t.space[8] },
  notice: { paddingBottom: t.space[16] },
  draft: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  first: { borderTopLeftRadius: t.radius.md, borderTopRightRadius: t.radius.md },
  last: { borderBottomLeftRadius: t.radius.md, borderBottomRightRadius: t.radius.md },
  end: { paddingBottom: t.space[32] },
  scroll: { flex: 1 },
  sortHint: { paddingBottom: t.space[16] },
  sortGroup: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  sortRow: { alignItems: 'center', backgroundColor: t.color.bg.surface, flexDirection: 'row', gap: t.space[12], height: SORT_ROW, paddingLeft: t.space[16], paddingRight: t.space[4] },
  sortRowActive: { backgroundColor: t.color.bg.raised },
  sortThumb: { width: t.size.thumb.row },
  sortText: { flex: 1, gap: t.space[2], minWidth: 0 },
  pinned: { paddingRight: t.space[16] },
  skeletonCards: { flexDirection: 'row', gap: DESKTOP_GAP },
  skeletonCell: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingHorizontal: t.space[16] },
  skeletonText: { flex: 1, gap: t.space[4] },
  // VehicleCard's footer: 8 under the chips, then the completeness line with its bar.
  skeletonFooter: { gap: t.space[8], marginTop: t.space[8] },
  skeletonStats: { paddingBottom: t.space[24], paddingTop: t.space[16] },
}));

/** One card's skeleton: VehicleCard, its completeness line and bar (DQ-166), the quick actions. */
function CardSkeleton({ pills = false, testID }: { pills?: boolean; testID?: string }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <View>
      <VehicleCardSkeleton variant="garage" />
      <View style={styles.skeletonFooter} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} testID={testID}>
        <SkeletonText variant="callout" width="60%" lines={estimateLines(TYPICAL_COMPLETENESS_CHARS, 'callout', fontScale, width)} />
        <SkeletonBlock height={size.progress.height} />
      </View>
      {/* DQ-1067 b: the carousel's page pills (8 high, space.12 above as in the content), then the action row at its height. */}
      {pills ? (
        <View style={styles.pills}>
          <SkeletonBlock width={space[48]} height={space[8]} corner="full" />
        </View>
      ) : null}
      <QuickActionsSkeleton />
    </View>
  );
}

function GarageSkeleton({ wide, carouselWidth }: { wide: boolean; carouselWidth: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {wide ? (
        <View style={styles.skeletonCards}>
          {Array.from({ length: DESKTOP_COLUMNS }, (_, index) => (
            <View key={index} style={styles.skeletonCell}>
              <CardSkeleton testID={index === 0 ? `${ROUTE}.skeleton.footer` : undefined} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ width: carouselWidth }}>
          <CardSkeleton pills testID={`${ROUTE}.skeleton.footer`} />
        </View>
      )}
      <View style={styles.skeletonStats}>
        <SkeletonText variant="callout" width="50%" />
      </View>
      <View style={styles.sectionGap}>
        <SkeletonText variant="headline" width="30%" />
      </View>
      <View style={[styles.draft, styles.first, styles.last]}>
        <View style={styles.skeletonRow}>
          <SkeletonBlock width={size.thumb.row} aspectRatio={1} corner="sm" />
          <View style={styles.skeletonText}>
            <SkeletonText variant="body" width="55%" />
            <SkeletonText variant="callout" width="40%" />
          </View>
        </View>
      </View>
    </Skeleton>
  );
}

type CardProps = {
  card: VehicleCardData;
  width: number;
  onOpen: (card: VehicleCardData) => void;
  /** The QR control on the photo (09 §5), once the car has a code. */
  /** The grid's cards carry their own actions; the carousel has one row for the centred card instead. */
  onAction?: (action: QuickAction, card: VehicleCardData) => void;
  /** Restricted: the editing actions take no taps (DQ-1067 a). */
  locked?: boolean;
  /** DQ-1120: this card's "Update posten" is the screen's one filled control (the main car in the desktop grid). */
  primary?: boolean;
};

/**
 * FS-4 / 09 §7.6: the card with the neutral Hauptfahrzeug badge (ADR-431 f) and the completeness line and bar, then the quick
 * actions of this car. The actions sit below the pressable card, because controls must not nest.
 */
const GarageCard = memo(function GarageCard({ card, width, onOpen, onAction, locked = false, primary = true }: CardProps) {
  const { t } = useTranslation('garage');
  return (
    <View>
      <VehicleCard
        {...garageCardProps(card, width, t)}
        completeness={completenessBar(card)}
        onPress={() => onOpen(card)}
        testID={`${ROUTE}.card.${card.id}`}
      />
      {onAction ? <QuickActions card={card} onAction={onAction} disabled={locked} primary={primary} testID={`${ROUTE}.card.${card.id}`} /> : null}
    </View>
  );
});

/** "3 Fahrzeuge · 41 Mods · 126 Fotos": private (the lock says so), tabular, only from what the list carries. */
function GarageStats({ vehicles }: { vehicles: readonly VehicleCardData[] }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const format = useFormat();
  const mods = vehicles.reduce((sum, card) => sum + card.mod_count, 0);
  const photos = vehicles.reduce((sum, card) => sum + card.photo_count, 0);
  const line = keepValuesTogether(
    [
      t('garage.statsVehicles', { count: vehicles.length, formatted: format.number(vehicles.length) }),
      t('garage.statsMods', { count: mods, formatted: format.number(mods) }),
      t('garage.statsPhotos', { count: photos, formatted: format.number(photos) }),
    ].join(' · '),
  );
  return (
    <View style={styles.stats} testID={`${ROUTE}.stats`}>
      <Icon name="lock-simple" size={16} color="text.secondary" label={t('garage.statsPrivate')} />
      <Text variant="callout" color="text.secondary" numeric style={styles.statsText} testID={`${ROUTE}.stats.line`}>
        {line}
      </Text>
    </View>
  );
}

type DraftRowProps = { card: VehicleCardData; first: boolean; last: boolean; onResume: (card: VehicleCardData) => void; onMore: (card: VehicleCardData) => void };

/** "Entwurf · Schritt 2 von 4" + "Fortsetzen"; the more button opens the draft's sheet with "Entwurf löschen". */
const DraftRow = memo(function DraftRow({ card, first, last, onResume, onMore }: DraftRowProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const largeFont = useStacksAtFontScale();
  const step = card.wizard?.step ?? 1;
  const total = card.wizard?.total_steps ?? 4;
  return (
    <View style={[styles.draft, first ? styles.first : null, last ? styles.last : null]}>
      {/* DQ-152: "Fortsetzen" goes under the text when it would squeeze it, and "Schritt 2 von 4" never splits. */}
      <ListRow
        thumb={photoFields(card.cover, size.thumb.row)}
        title={keepNameTogether(card.full_title.trim() || t('wizard.untitled'))}
        subtitle={keepValuesTogether(t('garage.draftLine', { step, total }), !largeFont)}
        value={t('garage.resume')}
        adaptiveValue
        onPress={() => onResume(card)}
        control={<IconButton icon="dots-three" label={t('garage.draftActions', { vehicle: card.full_title.trim() || t('wizard.untitled') })} onPress={() => onMore(card)} testID={`${ROUTE}.draft.${card.id}.more`} />}
        inset={space[16]}
        divider={!last}
        testID={`${ROUTE}.draft.${card.id}`}
      />
    </View>
  );
});

/** A compact row while sorting: thumb, name, the drag handle. */
function SortRow({ card, active, pinned = false }: { card: VehicleCardData; active: boolean; pinned?: boolean }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  return (
    <View style={[styles.sortRow, active ? styles.sortRowActive : null, pinned ? styles.pinned : null]}>
      <Photo {...photoFields(card.cover, size.thumb.row)} aspect="1:1" corner="sm" style={styles.sortThumb} />
      <View style={styles.sortText}>
        <Text variant="body" numberOfLines={1}>
          {card.full_title}
        </Text>
        <Text variant="callout" color="text.secondary" numberOfLines={1}>
          {pinned ? t('garage.mainPinned') : card.subline_parts.slice(0, 2).join(' · ')}
        </Text>
      </View>
      {pinned ? null : <SortHandleSlot />}
    </View>
  );
}

/** Pairs for the desktop grid. */
function pairs<T>(list: readonly T[], count: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += count) out.push(list.slice(index, index + count));
  return out;
}

/** GAR-01 /garage (09 §7.6 ★, FS-4): carousel (SM16) or the desktop grid, quick actions, private stats, drafts, sort mode. */
export function GarageScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotionPreference();
  const online = useOnline();
  const qaState = useQaState();
  const access = useGarageAccess();
  const addVehicle = useAddVehicle();
  const header = useCollapsingHeader();
  const padding = useTabBarPadding();
  const inset = useTabBarInset();
  const { gutter, kind, width } = useBreakpoint();
  const query = useMyVehicles();
  const reorder = useReorderVehicles();
  const remove = useDeleteVehicle();
  const listRef = useRef<FlashListRef<Row>>(null);
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<VehicleCardData[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draftActions, setDraftActions] = useState<VehicleCardData | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<VehicleCardData | null>(null);
  const [measured, setMeasured] = useState(0);
  const [focused, setFocused] = useState(0);
  const page = useSharedValue(0);

  const wide = kind === 'desktop';
  const cards = useMemo(() => (qaState === 'empty' ? [] : query.data), [qaState, query.data]);
  const { vehicles, drafts } = useMemo(() => splitGarage(cards), [cards]);
  // DQ-1120: one filled "Update posten" in the desktop grid, the main car's (else the first car's).
  const primaryCardId = (vehicles.find((card) => card.is_main) ?? vehicles[0])?.id;
  const gutterStyle = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);
  // The pane beside the rail or the sidebar: estimated for the first frame, then measured.
  const paneWidth = measured || estimatedPaneWidth(width, kind);
  const content = (wide ? Math.min(paneWidth, layout.contentMax) : Math.min(paneWidth, COLUMN_MAX + 2 * layout.gutter.desktop)) - 2 * gutter;
  const gridCardWidth = (content - DESKTOP_GAP * (DESKTOP_COLUMNS - 1)) / DESKTOP_COLUMNS;
  const available = paneWidth - 2 * gutter;
  const carouselWidth = Math.min(vehicles.length > 1 ? available - CAROUSEL_PEEK : available, COLUMN_MAX);
  const column = useMemo(() => [styles.column, wide ? styles.columnWide : null], [wide, styles.column, styles.columnWide]);
  const locked = access.restriction !== null;
  const canSort = vehicles.length > 2 || (vehicles.length === 2 && !vehicles.some((card) => card.is_main));
  const main = vehicles.find((card) => card.is_main) ?? null;
  const sortable = order ?? vehicles.filter((card) => card !== main);
  // The centred card of the carousel (a reorder or a delete can leave the index past the end).
  const focusedIndex = Math.min(focused, Math.max(0, vehicles.length - 1));
  const focusedCard = wide ? null : (vehicles[focusedIndex] ?? null);
  const qrTarget = (focusedCard?.qr ? focusedCard : null) ?? (main?.qr ? main : null) ?? vehicles.find((card) => card.qr) ?? null;

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (vehicles.length > 0) {
      if (wide) {
        const grid = pairs(vehicles, DESKTOP_COLUMNS);
        grid.forEach((group, index) => list.push({ kind: 'grid', cards: group, last: index === grid.length - 1 }));
      } else list.push({ kind: 'carousel' });
      list.push({ kind: 'stats' }, { kind: 'due' });
    }
    if (drafts.length > 0) {
      list.push({ kind: 'draftsHeader' });
      drafts.forEach((card, index) => list.push({ kind: 'draft', card, first: index === 0, last: index === drafts.length - 1 }));
    }
    return list;
  }, [drafts, vehicles, wide]);

  // As TabRootScreen: a tab hidden under a pushed screen is display:none on web, the browser keeps its offset, but the
  // scroll event on the way back can report 0, so on web the element is the truth.
  const scrollNode = () =>
    (sorting ? scrollRef.current?.getScrollableNode() : listRef.current?.getScrollableNode()) as { scrollTop?: number } | null | undefined;
  useTabScrollToTop(() => {
    const node = isWeb ? scrollNode() : null;
    const before = typeof node?.scrollTop === 'number' ? node.scrollTop : header.scrollY.get();
    if (before <= 0) return false;
    const animated = motion.enabled && !motion.reduced;
    if (sorting) scrollRef.current?.scrollTo({ y: 0, animated });
    else listRef.current?.scrollToOffset({ offset: 0, animated });
    if (node) {
      // WebKit ignores element.scroll() on an element that was display:none, until something else scrolls it.
      setTimeout(() => {
        if (node.scrollTop === before) node.scrollTop = 0;
      }, motionDuration('effect.default'));
    }
    return true;
  });

  const open = useCallback((card: VehicleCardData) => router.push(`/garage/${card.id}`), [router]);
  const resume = useCallback((card: VehicleCardData) => router.push(wizardPath(card.id, resumeStep(card)), { withAnchor: true }), [router]);
  const onAction = useCallback(
    (action: QuickAction, card: VehicleCardData) => {
      if (action === 'update') router.push(postUpdateHref(card.id));
      else if (action === 'mods') router.push(`/garage/${card.id}/mods`);
      else if (action === 'photos') router.push(`/garage/${card.id}/photos`);
      else router.push(`/qr/${card.id}`);
    },
    [router],
  );

  const saveOrder = (ids: string[]) =>
    reorder.mutate(ids, {
      onSuccess: () => toast(t('garage.sortSaved'), { testID: `${ROUTE}.toast` }),
      onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
    });

  const finishSorting = () => {
    const next = order;
    setSorting(false);
    setOrder(null);
    if (!next) return;
    saveOrder([...(main ? [main.id] : []), ...next.map((card) => card.id)]);
  };

  /** SM16 long-press reorder in the carousel: the main vehicle keeps the first place, as in the sort list. */
  const reorderInCarousel = (from: number, to: number) => {
    if (locked || !online) {
      toast(locked ? (access.restriction ?? t('garage.sortOffline')) : t('garage.sortOffline'), { testID: `${ROUTE}.toast` });
      return;
    }
    if (main && (from === 0 || to === 0)) {
      toast(t('garage.mainStays'), { testID: `${ROUTE}.toast` });
      return;
    }
    saveOrder(moveItem(vehicles, from, to).map((card) => card.id));
  };

  const deleteDraft = (card: VehicleCardData) => {
    remove.mutate(card, {
      onSuccess: () => {
        setDraftToDelete(null);
        toast(t('garage.draftDeleted'), { testID: `${ROUTE}.toast` });
      },
      onError: (error) => {
        setDraftToDelete(null);
        toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` });
      },
    });
  };

  const qrAction: HeaderAction[] =
    access.status === 'member' && !sorting && qrTarget
      ? [{ icon: 'qr-code', label: t('garage.qrFor', { vehicle: qrTarget.full_title }), onPress: () => router.push(`/qr/${qrTarget.id}`), testID: `${ROUTE}.qr` }]
      : [];
  // DQ-084: from 1280 the sidebar holds "Fahrzeug hinzufügen", so the header does not repeat it.
  const actions: HeaderAction[] =
    wide || sorting || access.status !== 'member'
      ? qrAction
      : [{ icon: 'plus', label: t('garage.add'), onPress: addVehicle, disabled: locked, testID: `${ROUTE}.add` }, ...qrAction];
  const trailing =
    access.status === 'member' && (sorting || canSort) ? (
      <Button
        label={sorting ? t('garage.sortDone') : t('garage.sort')}
        variant="tertiary"
        size="s"
        style={HEADER_TEXT_ACTION}
        disabled={!sorting && (locked || !online)}
        loading={reorder.isPending}
        onPress={sorting ? finishSorting : () => setSorting(true)}
        testID={`${ROUTE}.${sorting ? 'sortDone' : 'sort'}`}
      />
    ) : null;

  let state: ReactNode = null;
  let empty = false;
  if (access.status === 'guest') state = <SignInState routeId={ROUTE} returnTo="/garage" />;
  else if (qaState === 'loading' || access.status === 'loading' || (!cards && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default'))
    state = <GarageSkeleton wide={wide} carouselWidth={carouselWidth} />;
  else if (qaState === 'error' || !cards)
    state = (
      <LoadErrorState
        routeId={ROUTE}
        offline={!online || query.fetchStatus === 'paused'}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        // DQ-1078: the page's own words and the cause, not "Das hat nicht geklappt".
        title={t('garage.loadErrorTitle')}
        message={t('garage.loadErrorBody')}
      />
    );
  else if (cards.length === 0) {
    empty = true;
    state = <GarageEmpty onAdd={addVehicle} disabled={locked} paneWidth={paneWidth} />;
  }

  const titleBlock = (
    <>
      <HeaderLargeTitle title={t('garage.title')} scroll={header} style={column} testID={`${ROUTE}.title`} />
      {access.restriction ? (
        <View style={[column, styles.notice, { paddingHorizontal: gutter }]}>
          <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} />
        </View>
      ) : null}
    </>
  );

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'carousel') {
      return (
        <View style={styles.carousel}>
          <CarouselSnap
            items={vehicles}
            keyOf={(card) => card.id}
            labelOf={(card) => card.full_title}
            itemWidth={carouselWidth}
            gap={CAROUSEL_GAP}
            // No move labels and no onOpen: the card stays a group whose own controls (card, quick actions) keep their focus;
            // screen readers and keyboards reorder in "Sortieren" (handles + arrow keys).
            onReorder={vehicles.length > 1 ? reorderInCarousel : undefined}
            renderItem={(card) => <GarageCard card={card} width={carouselWidth} onOpen={open} />}
            progress={page}
            onIndexChange={setFocused}
            testID={`${ROUTE}.carousel`}
          />
          {vehicles.length > 1 ? (
            <View style={styles.pills}>
              <PageIndicator
                progress={page}
                count={vehicles.length}
                label={t('garage.page', { index: focusedIndex + 1, count: vehicles.length })}
                testID={`${ROUTE}.pages`}
              />
            </View>
          ) : null}
          {focusedCard ? (
            // One row for the centred car (09 §7.6); its ids follow the car, so `GAR-01.card.<id>.qr` stays the car's own.
            <View style={[styles.focusedRow, { width: carouselWidth }]}>
              <QuickActions card={focusedCard} onAction={onAction} disabled={locked} testID={`${ROUTE}.card.${focusedCard.id}`} />
            </View>
          ) : null}
        </View>
      );
    }
    return (
      <View style={[column, gutterStyle]}>
        {item.kind === 'grid' ? (
          <View style={styles.gridRow} testID={`${ROUTE}.grid`}>
            {Array.from({ length: DESKTOP_COLUMNS }, (_, index) => {
              const card = item.cards[index];
              return (
                <View key={card?.id ?? `gap.${index}`} style={styles.gridCell}>
                  {card ? <GarageCard card={card} width={gridCardWidth} onOpen={open} onAction={onAction} locked={locked} primary={card.id === primaryCardId} /> : null}
                </View>
              );
            })}
          </View>
        ) : item.kind === 'stats' ? (
          <GarageStats vehicles={vehicles} />
        ) : item.kind === 'due' ? (
          <UpcomingSection />
        ) : item.kind === 'draftsHeader' ? (
          <SectionHeader title={t('garage.drafts')} style={styles.sectionGap} testID={`${ROUTE}.drafts`} />
        ) : (
          <DraftRow card={item.card} first={item.first} last={item.last} onResume={resume} onMore={setDraftActions} />
        )}
      </View>
    );
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" title={t('garage.title')} scroll={header} actions={actions} trailing={trailing} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      {sorting ? (
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          scrollEnabled={!dragging}
          style={styles.scroll}
          contentContainerStyle={padding}
          testID={`${ROUTE}.sortList`}
        >
          {titleBlock}
          <View style={[styles.column, gutterStyle, wide ? styles.columnWide : null]}>
            <Text variant="callout" color="text.secondary" style={styles.sortHint} testID={`${ROUTE}.sortHint`}>
              {isWeb ? t('garage.sortHintWeb') : t('garage.sortHint')}
            </Text>
            <View style={styles.sortGroup}>
              {main ? (
                <>
                  <SortRow card={main} active={false} pinned />
                  <Hairline />
                </>
              ) : null}
              <Sortable
                items={sortable}
                keyOf={(card) => card.id}
                labelOf={(card) => card.full_title}
                rowHeight={SORT_ROW}
                gap={0}
                onChange={setOrder}
                onDragging={setDragging}
                renderItem={(card, { active }) => <SortRow card={card} active={active} />}
                testID={`${ROUTE}.sortable`}
              />
            </View>
          </View>
          <View style={styles.end} />
        </Animated.ScrollView>
      ) : (
        <View style={styles.list} onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}>
          <CollapsingFlashList
            ref={listRef}
            {...header.scrollProps}
            data={state ? [] : rows}
            keyExtractor={(row: Row) =>
              row.kind === 'draft' ? `draft.${row.card.id}` : row.kind === 'grid' ? `grid.${row.cards.map((card) => card.id).join('.')}` : row.kind
            }
            getItemType={(row: Row) => row.kind}
            // Widths and the lock come from the screen, not the rows: a rotation or a restriction redraws the cards.
            extraData={`${carouselWidth}:${gridCardWidth}:${locked}:${online}:${focusedCard?.id ?? ''}`}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: inset }}
            ListHeaderComponent={titleBlock}
            ListEmptyComponent={state ? empty ? state : <View style={[column, gutterStyle]}>{state}</View> : null}
            ListFooterComponent={<View style={styles.end} />}
            renderItem={renderRow}
            testID={`${ROUTE}.list`}
          />
        </View>
      )}
      <Sheet
        visible={draftActions !== null}
        onClose={() => setDraftActions(null)}
        title={draftActions?.full_title.trim() || t('wizard.untitled')}
        expandable={false}
        narrow
        testID={`${ROUTE}.draftSheet`}
      >
        <ListRow
          icon="arrow-right"
          title={t('garage.resume')}
          role="button"
          chevron={false}
          onPress={() => {
            const card = draftActions;
            setDraftActions(null);
            if (card) resume(card);
          }}
          inset={space[0]}
          divider
          testID={`${ROUTE}.draftSheet.resume`}
        />
        <ListRow
          icon="trash"
          title={t('garage.deleteDraft')}
          role="button"
          chevron={false}
          destructive
          onPress={() => {
            setDraftToDelete(draftActions);
            setDraftActions(null);
          }}
          inset={space[0]}
          testID={`${ROUTE}.draftSheet.delete`}
        />
      </Sheet>
      <Dialog
        visible={draftToDelete !== null}
        onClose={() => setDraftToDelete(null)}
        title={t('garage.deleteDraftTitle')}
        body={t('garage.deleteDraftBody')}
        testID={`${ROUTE}.deleteDraft`}
        actions={[
          { label: t('common.cancel'), variant: 'secondary', onPress: () => setDraftToDelete(null), testID: `${ROUTE}.deleteDraft.cancel` },
          {
            label: t('garage.deleteDraftConfirm'),
            destructive: true,
            loading: remove.isPending,
            onPress: () => draftToDelete && deleteDraft(draftToDelete),
            testID: `${ROUTE}.deleteDraft.confirm`,
          },
        ]}
      />
    </Screen>
  );
}
