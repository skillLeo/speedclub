import type { FlashListRef } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useDeleteVehicle, useReorderVehicles } from '@/api/queries/garage';
import { useMyVehicles, type VehicleCardData } from '@/api/queries/profile';
import { photoFields, vehicleCardProps } from '@/features/profile/media';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset, useTabBarPadding } from '@/features/shell/tabBarLayout';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { keepNameTogether, keepValuesTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, space, useBreakpoint, useMotion, useTheme } from '@/theme';
import {
  Button,
  CollapsingFlashList,
  Dialog,
  EmptyState,
  Hairline,
  Header,
  HeaderLargeTitle,
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
import { useStacksAtFontScale } from '@/ui/rowParts';
import { estimateLines } from '@/ui/Skeleton';

import { LoadErrorState, RestrictedNotice, SignInState, useGarageAccess, HEADER_TEXT_ACTION } from '../components/frames';
import { SortHandleSlot, Sortable } from '../components/Sortable';
import { saveErrorMessage } from '../errors';
import { completenessBar, resumeStep, splitGarage } from '../model';
import { wizardPath } from '../navigation';

const ROUTE = 'GAR-01';
const EDGES: readonly Edge[] = ['left', 'right'];
/**
 * Cards and rows share the feed column on wide screens (§5): centred up to the tablet, and from 1280 on the pane's start edge, so
 * the large title stays put between the tabs (DQ-202, ADR-160). A phone uses the full width minus the gutters.
 */
const COLUMN_MAX = layout.feedColumn;
const SORT_ROW = size.row.withThumb;
/** "Build zu 70 % vollständig": the server's line, not known before the list arrives. */
const TYPICAL_COMPLETENESS_CHARS = 25;

type Row =
  | { kind: 'vehicle'; card: VehicleCardData; last: boolean }
  | { kind: 'draftsHeader' }
  | { kind: 'draft'; card: VehicleCardData; first: boolean; last: boolean };

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'center', maxWidth: COLUMN_MAX + 2 * layout.gutter.desktop, width: '100%' },
  columnStart: { alignSelf: 'flex-start' },
  cardGap: { paddingBottom: t.space[24] },
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
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.row.withThumb, paddingHorizontal: t.space[16] },
  skeletonText: { flex: 1, gap: t.space[4] },
  // VehicleCard's footer: 8 under the chips, the line with its bar, 12, then the 44 QR button with its 24 glyph.
  skeletonFooter: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], marginTop: t.space[8] },
  skeletonCompleteness: { flex: 1, gap: t.space[8], minWidth: 0 },
  skeletonQr: { alignItems: 'center', height: t.size.touchMin, justifyContent: 'center', width: t.size.touchMin },
}));

function GarageSkeleton() {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.cardGap}>
        <VehicleCardSkeleton />
        {/* DQ-166: FS-4's owner part of the card, as in GarageCardRow. */}
        <View style={styles.skeletonFooter} testID={`${ROUTE}.skeleton.footer`}>
          <View style={styles.skeletonCompleteness} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            <SkeletonText variant="supporting" width="60%" lines={estimateLines(TYPICAL_COMPLETENESS_CHARS, 'supporting', fontScale, width)} />
            <SkeletonBlock height={size.progress.height} />
          </View>
          <View style={styles.skeletonQr}>
            <SkeletonBlock width={size.icon.l} height={size.icon.l} corner="xs" />
          </View>
        </View>
      </View>
      <View style={styles.sectionGap}>
        <SkeletonText variant="titleS" width="30%" />
      </View>
      <View style={[styles.draft, styles.first, styles.last]}>
        <View style={styles.skeletonRow}>
          <SkeletonBlock width={size.thumb.row} aspectRatio={1} corner="sm" />
          <View style={styles.skeletonText}>
            <SkeletonText variant="body" width="55%" />
            <SkeletonText variant="supporting" width="40%" />
          </View>
        </View>
      </View>
    </Skeleton>
  );
}

type CardRowProps = { card: VehicleCardData; width: number; last: boolean; onOpen: (card: VehicleCardData) => void; onQr: (card: VehicleCardData) => void };

/** FS-4: the card with the Hauptfahrzeug badge, the completeness line and bar, and the trailing QR button. */
const GarageCardRow = memo(function GarageCardRow({ card, width, last, onOpen, onQr }: CardRowProps) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  return (
    <View style={last ? null : styles.cardGap}>
      <VehicleCard
        {...vehicleCardProps(card, width)}
        completeness={completenessBar(card)}
        onPress={() => onOpen(card)}
        trailing={
          card.qr ? (
            <IconButton icon="qr-code" label={t('garage.qrFor', { vehicle: card.full_title })} onPress={() => onQr(card)} testID={`${ROUTE}.card.${card.id}.qr`} />
          ) : null
        }
        testID={`${ROUTE}.card.${card.id}`}
      />
    </View>
  );
});

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
        <Text variant="supporting" color="text.secondary" numberOfLines={1}>
          {pinned ? t('garage.mainPinned') : card.subline_parts.slice(0, 2).join(' · ')}
        </Text>
      </View>
      {pinned ? null : <SortHandleSlot />}
    </View>
  );
}

/** GAR-01 /garage, FS-4. */
export function GarageScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const motion = useMotion();
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

  const cards = useMemo(() => (qaState === 'empty' ? [] : query.data), [qaState, query.data]);
  const { vehicles, drafts } = useMemo(() => splitGarage(cards), [cards]);
  const gutterStyle = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);
  const columnWidth = Math.min(COLUMN_MAX + 2 * layout.gutter.desktop, width) - 2 * gutter;
  const column = useMemo(() => [styles.column, kind === 'desktop' ? styles.columnStart : null], [kind, styles.column, styles.columnStart]);
  const locked = access.restriction !== null;
  const canSort = vehicles.length > 2 || (vehicles.length === 2 && !vehicles.some((card) => card.is_main));
  const main = vehicles.find((card) => card.is_main) ?? null;
  const sortable = order ?? vehicles.filter((card) => card !== main);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = vehicles.map((card, index) => ({ kind: 'vehicle', card, last: index === vehicles.length - 1 && drafts.length === 0 }));
    if (drafts.length > 0) {
      list.push({ kind: 'draftsHeader' });
      drafts.forEach((card, index) => list.push({ kind: 'draft', card, first: index === 0, last: index === drafts.length - 1 }));
    }
    return list;
  }, [drafts, vehicles]);

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
      }, motion.duration.small);
    }
    return true;
  });

  const open = useCallback((card: VehicleCardData) => router.push(`/garage/${card.id}`), [router]);
  const openQr = useCallback((card: VehicleCardData) => router.push(`/qr/${card.id}`), [router]);
  const resume = useCallback((card: VehicleCardData) => router.push(wizardPath(card.id, resumeStep(card)), { withAnchor: true }), [router]);

  const finishSorting = () => {
    const next = order;
    setSorting(false);
    setOrder(null);
    if (!next) return;
    const ids = [...(main ? [main.id] : []), ...next.map((card) => card.id)];
    reorder.mutate(ids, {
      onSuccess: () => toast(t('garage.sortSaved'), { testID: `${ROUTE}.toast` }),
      onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
    });
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

  // DQ-084: from 1280 the sidebar holds "Fahrzeug hinzufügen", so the header does not repeat it.
  const actions: HeaderAction[] =
    kind === 'desktop' || sorting || access.status !== 'member'
      ? []
      : [{ icon: 'plus', label: t('garage.add'), onPress: addVehicle, disabled: locked, testID: `${ROUTE}.add` }];
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
  if (access.status === 'guest') state = <SignInState routeId={ROUTE} returnTo="/garage" />;
  else if (qaState === 'loading' || access.status === 'loading' || (!cards && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default'))
    state = <GarageSkeleton />;
  else if (qaState === 'error' || !cards)
    state = (
      <LoadErrorState routeId={ROUTE} offline={!online || query.fetchStatus === 'paused'} onRetry={() => void query.refetch()} retrying={query.isFetching} />
    );
  else if (cards.length === 0)
    state = (
      <EmptyState
        variant="brand"
        icon="wheel"
        title={t('garage.emptyTitle')}
        body={t('garage.emptyBody')}
        hyphenateBody={false}
        action={{ label: t('garage.add'), onPress: addVehicle }}
        testID={`${ROUTE}.empty`}
      />
    );

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
          <View style={[column, gutterStyle]}>
            <Text variant="supporting" color="text.secondary" style={styles.sortHint} testID={`${ROUTE}.sortHint`}>
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
        <CollapsingFlashList
          ref={listRef}
          {...header.scrollProps}
          data={state ? [] : rows}
          keyExtractor={(row: Row) => (row.kind === 'draftsHeader' ? 'drafts' : `${row.kind}.${row.card.id}`)}
          getItemType={(row: Row) => row.kind}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: inset }}
          ListHeaderComponent={titleBlock}
          ListEmptyComponent={state ? <View style={[column, gutterStyle]}>{state}</View> : null}
          ListFooterComponent={<View style={styles.end} />}
          renderItem={({ item }: { item: Row }) => (
            <View style={[column, gutterStyle]}>
              {item.kind === 'vehicle' ? (
                <GarageCardRow card={item.card} width={columnWidth} last={item.last} onOpen={open} onQr={openQr} />
              ) : item.kind === 'draftsHeader' ? (
                <SectionHeader title={t('garage.drafts')} style={styles.sectionGap} testID={`${ROUTE}.drafts`} />
              ) : (
                <DraftRow card={item.card} first={item.first} last={item.last} onResume={resume} onMore={setDraftActions} />
              )}
            </View>
          )}
          testID={`${ROUTE}.list`}
        />
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
