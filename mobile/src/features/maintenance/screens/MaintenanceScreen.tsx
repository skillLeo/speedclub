import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { useVehicle } from '@/api/queries/garage';
import {
  isGoneError,
  MAINTENANCE_FLAG,
  useMaintenanceCosts,
  useMaintenanceItems,
  useMaintenanceLogs,
  type MaintenanceItem,
  type MaintenanceLog,
} from '@/api/queries/maintenance';
import { estimatedPaneWidth, GoneState, LoadErrorState, RestrictedNotice, SignInState, useGarageAccess, usePushedHeaderWidth } from '@/features/garage/components/frames';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { Button, EmptyState, Header, ListRow, Screen, SectionHeader, Sheet, type HeaderAction } from '@/ui';
import { RowGroup } from '@/ui/RowGroup';

import {
  CostsBlock,
  HistoryTimeline,
  ItemCard,
  logEntries,
  MaintenanceSkeleton,
  OdometerRow,
  opStatus,
  PendingGroup,
  ROUTE,
  SamplePreview,
  VehicleBand,
} from '../components/MaintenanceParts';
import { heroItem, sortItems } from '../model';
import { maintenanceOutbox, useMaintenanceOutbox, type MaintenanceOutboxOp } from '../outbox';
import { useDistanceUnit } from '../units';

const EDGES: readonly Edge[] = ['left', 'right'];
const COLUMN = layout.feedColumn;

type Row =
  | { kind: 'band' }
  | { kind: 'next' }
  | { kind: 'items' }
  | { kind: 'pending' }
  | { kind: 'odometer' }
  | { kind: 'costs' }
  | { kind: 'history' }
  | { kind: 'grid'; main: readonly Row[]; side: readonly Row[] };

/** RN's style types know no `sticky`; React Native Web passes it through to CSS (as VEH-01's spec card). */
const STICKY_SIDE = { position: 'sticky', top: 0 } as unknown as ViewStyle;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'flex-start', maxWidth: COLUMN, width: '100%' },
  top: { gap: t.space[16], paddingTop: t.space[16] },
  section: { gap: t.space[12], paddingTop: t.space[32] },
  next: { gap: t.space[12], paddingTop: t.space[24] },
  historyHead: { paddingTop: t.space[32] },
  more: { alignItems: 'flex-start', paddingTop: t.space[16] },
  end: { paddingBottom: t.space[32] },
  state: { paddingTop: t.space[24] },
  addSheet: { paddingBottom: t.space[8] },
  // DQ-1099: from 1280 the content width, 8 columns of what is due and done, 4 of the numbers beside it.
  grid: { alignItems: 'flex-start', columnGap: t.space[32], flexDirection: 'row' },
  gridMain: { flexBasis: 0, flexGrow: 8, minWidth: 0 },
  gridSide: { flexBasis: 0, flexGrow: 4, minWidth: 0 },
  wide: { maxWidth: layout.contentMax, width: '100%' },
}));

/** The path of the editor (MNT-02, a modal) for a new item, an item, a new log entry or an entry. */
export function editorHref(vehicleId: string, target: { item?: string; log?: string; kind: 'item' | 'log'; type?: string }): string {
  const query = new URLSearchParams({ kind: target.kind, ...(target.item ? { item: target.item } : {}), ...(target.log ? { log: target.log } : {}), ...(target.type ? { type: target.type } : {}) });
  return `/maintenance-editor/${vehicleId}?${query.toString()}`;
}

/**
 * MNT-01 /garage/[id]/maintenance (09 §7.12, §8.8): the owner's maintenance of one vehicle. The car as a 16:9 band, the next due
 * item as the hero (countdown numeral and ring), every item with its due date, countdown and ring, writes still waiting for a
 * connection, the mileage, the private costs and the Verlauf of service entries. Owner only; staff view-as never sees it.
 */
export function MaintenanceScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const format = useFormat();
  const unit = useDistanceUnit();
  const access = useGarageAccess();
  const viewAs = useViewAsReadOnly();
  const flag = useFlag(MAINTENANCE_FLAG);
  const params = useLocalSearchParams<{ id: string }>();
  const id = paramOf(params.id) ?? '';
  const back = useBack(`/garage/${id}`);
  const inset = useTabBarInset();
  const { gutter, kind, width } = useBreakpoint();
  const grid = kind === 'desktop';
  const pushedWidth = usePushedHeaderWidth(COLUMN);
  // DQ-1099: from 1280 the page takes the content width (12 columns, at most contentMax), the header with it.
  const gridWidth = Math.min(layout.contentMax, estimatedPaneWidth(width, kind) - 2 * gutter);
  const headerWidth = kind === 'desktop' ? gridWidth + 2 * gutter : pushedWidth;
  const vehicle = useVehicle(id);
  const itemsQuery = useMaintenanceItems(id);
  const logsQuery = useMaintenanceLogs(id);
  const costs = useMaintenanceCosts(id);
  const ops = useMaintenanceOutbox(id);
  const [adding, setAdding] = useState(false);

  const empty = qaState === 'empty';
  const items = useMemo(() => (empty ? [] : sortItems(itemsQuery.data?.items ?? [])), [empty, itemsQuery.data]);
  const logs = useMemo(() => (empty ? [] : (logsQuery.data?.pages.flatMap((page) => page.data) ?? [])), [empty, logsQuery.data]);
  const next = heroItem(items);
  // The hero is not repeated in the list under it.
  const rest = useMemo(() => items.filter((entry) => entry !== next), [items, next]);
  const locked = access.restriction !== null;

  const openItem = useCallback((item: MaintenanceItem) => router.push(editorHref(id, { kind: 'item', item: item.id }) as never), [id, router]);
  const openLog = useCallback((log: MaintenanceLog) => router.push(editorHref(id, { kind: 'log', log: log.id }) as never), [id, router]);
  const add = (kindOf: 'item' | 'log', type?: string) => {
    setAdding(false);
    router.push(editorHref(id, { kind: kindOf, type }) as never);
  };
  const retry = (op: MaintenanceOutboxOp) => void maintenanceOutbox().retry(op.id);
  const discard = (op: MaintenanceOutboxOp) => maintenanceOutbox().discard(op.id);

  const statusOf = (item: MaintenanceItem) => {
    const op = ops.find((entry) => entry.target === item.id && entry.kind === 'item.update');
    return op ? opStatus(t as unknown as (key: string) => string, op, online) : null;
  };

  const actions: HeaderAction[] =
    access.status === 'member' && !viewAs && flag
      ? [{ icon: 'plus', label: t('maintenance.add'), onPress: () => setAdding(true), disabled: locked, testID: `${ROUTE}.add` }]
      : [];

  let state: ReactNode = null;
  const loading =
    qaState === 'loading' ||
    access.status === 'loading' ||
    (!itemsQuery.data && itemsQuery.isPending && itemsQuery.fetchStatus !== 'paused' && qaState === 'default');
  if (access.status === 'guest') state = <SignInState routeId={ROUTE} returnTo={`/garage/${id}/maintenance`} />;
  else if (viewAs) state = <EmptyState icon="lock-simple" title={t('maintenance.title')} body={t('maintenance.restricted.viewAs')} testID={`${ROUTE}.viewAs`} />;
  else if (!flag && qaState === 'default')
    state = <GoneState routeId={ROUTE} title={t('maintenance.unavailableTitle')} body={t('maintenance.unavailableBody')} />;
  else if ((isGoneError(vehicle.error) || isGoneError(itemsQuery.error)) && qaState === 'default')
    state = <GoneState routeId={ROUTE} title={t('gone.vehicleTitle')} body={t('gone.vehicleBody')} />;
  else if (loading) state = <MaintenanceSkeleton band={kind === 'phone'} />;
  else if (qaState === 'error' || !itemsQuery.data)
    state = (
      <LoadErrorState
        routeId={ROUTE}
        offline={!online || itemsQuery.fetchStatus === 'paused'}
        onRetry={() => {
          void itemsQuery.refetch();
          void logsQuery.refetch();
        }}
        retrying={itemsQuery.isFetching}
      />
    );
  else if (items.length === 0 && logs.length === 0 && ops.length === 0)
    state = (
      <EmptyState
        preview={<SamplePreview />}
        title={t('maintenance.empty.title')}
        body={t('maintenance.empty.body')}
        action={{ label: t('maintenance.empty.action'), onPress: () => add('item', 'hu_au'), disabled: locked }}
        testID={`${ROUTE}.empty`}
      />
    );

  const rows = useMemo<Row[]>(() => {
    if (state) return [];
    const list: Row[] = [];
    if (vehicle.data) list.push({ kind: 'band' });
    if (next) list.push({ kind: 'next' });
    if (ops.length > 0) list.push({ kind: 'pending' });
    if (rest.length > 0) list.push({ kind: 'items' });
    list.push({ kind: 'odometer' }, { kind: 'costs' }, { kind: 'history' });
    if (!grid) return list;
    // DQ-1099: the band across the content, then the 8/4 grid.
    const isSide = (row: Row) => row.kind === 'odometer' || row.kind === 'costs';
    return [
      ...list.filter((row) => row.kind === 'band'),
      { kind: 'grid', main: list.filter((row) => row.kind !== 'band' && !isSide(row)), side: list.filter(isSide) },
    ];
  }, [grid, rest.length, next, ops.length, state, vehicle.data]);

  const odometer = itemsQuery.data?.odometer ?? { km: null, recordedAt: null };
  const phone = kind === 'phone';
  const entries = logEntries(t, logs, unit, format.locale, openLog);

  const renderRow = ({ item: row }: { item: Row }): ReactElement | null => {
    if (row.kind === 'grid') {
      return (
        <View style={styles.grid} testID={`${ROUTE}.grid`}>
          <View style={styles.gridMain}>
            {row.main.map((entry) => (
              <View key={entry.kind}>{renderRow({ item: entry })}</View>
            ))}
          </View>
          <View style={[styles.gridSide, STICKY_SIDE]} testID={`${ROUTE}.side`}>
            {row.side.map((entry) => (
              <View key={entry.kind}>{renderRow({ item: entry })}</View>
            ))}
          </View>
        </View>
      );
    }
    if (row.kind === 'band' && vehicle.data) {
      // Full bleed on phones: the band leaves the gutter (09 §4.6 heroes 0 radius); inset with radius 20 from 768, across the
      // content width from 1280 (DQ-1099).
      return (
        <View style={phone ? { marginHorizontal: -gutter } : grid ? styles.wide : styles.column}>
          <VehicleBand vehicle={vehicle.data} inset={!phone} width={phone ? width : grid ? gridWidth : Math.min(COLUMN, width - 2 * gutter)} />
        </View>
      );
    }
    if (row.kind === 'next' && next) {
      return (
        // DQ-1127: on the desktop grid the hero starts at the side column's section top (32), so both titles share a line.
        <View style={[styles.column, grid ? styles.section : styles.next]} testID={`${ROUTE}.nextBlock`}>
          <SectionHeader title={t('maintenance.next')} />
          <ItemCard item={next} unit={unit} hero onOpen={openItem} />
        </View>
      );
    }
    if (row.kind === 'pending') {
      return (
        <View style={styles.column}>
          <PendingGroup ops={ops} items={items} unit={unit} onRetry={retry} onDiscard={discard} />
        </View>
      );
    }
    if (row.kind === 'items') {
      return (
        <View style={[styles.column, styles.section]} testID={`${ROUTE}.items`}>
          <SectionHeader title={t('maintenance.items')} />
          <RowGroup>
            {rest.map((item, index) => (
              <ItemCard key={item.id} item={item} unit={unit} status={statusOf(item)} divider={index < rest.length - 1} onOpen={openItem} />
            ))}
          </RowGroup>
        </View>
      );
    }
    if (row.kind === 'odometer') {
      return (
        <View style={styles.column}>
          <OdometerRow vehicleId={id} km={odometer.km} recordedAt={odometer.recordedAt} unit={unit} disabled={locked} />
        </View>
      );
    }
    if (row.kind === 'costs') {
      return (
        <View style={styles.column}>
          <CostsBlock costs={empty ? undefined : costs.data} />
        </View>
      );
    }
    return (
      <View style={[styles.column, styles.historyHead]}>
        <SectionHeader
          title={t('maintenance.history')}
          actionLabel={locked ? undefined : t('maintenance.addLog')}
          onAction={locked ? undefined : () => add('log')}
          testID={`${ROUTE}.historyHeader`}
        />
        {entries.length > 0 ? (
          <HistoryTimeline entries={entries} />
        ) : (
          <View style={styles.state}>
            <ListRow title={t('maintenance.log.emptyTitle')} subtitle={t('maintenance.log.emptyBody')} icon="service-wrench" testID={`${ROUTE}.historyEmpty`} />
          </View>
        )}
        {logsQuery.hasNextPage ? (
          <View style={styles.more}>
            <Button
              label={t('maintenance.log.more')}
              variant="secondary"
              size="m"
              loading={logsQuery.isFetchingNextPage}
              onPress={() => void logsQuery.fetchNextPage()}
              testID={`${ROUTE}.more`}
            />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={t('maintenance.title')} onBack={back} actions={actions} contentMaxWidth={headerWidth} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      <FlashList
        data={rows}
        keyExtractor={(row: Row) => row.kind}
        getItemType={(row: Row) => row.kind}
        style={styles.list}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: inset }}
        ListHeaderComponent={
          access.restriction && !viewAs ? (
            <View style={[styles.column, styles.top]}>
              <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} />
            </View>
          ) : null
        }
        ListEmptyComponent={state ? <View style={[styles.column, styles.state]}>{state}</View> : null}
        ListFooterComponent={<View style={styles.end} />}
        renderItem={renderRow}
        testID={`${ROUTE}.list`}
      />
      <Sheet visible={adding} onClose={() => setAdding(false)} title={t('maintenance.addSheetTitle')} narrow testID={`${ROUTE}.addSheet`}>
        <View style={styles.addSheet}>
          <RowGroup>
            <ListRow
              title={t('maintenance.addItem')}
              subtitle={t('maintenance.addItemHelper')}
              icon="hu-plakette"
              onPress={() => add('item')}
              divider
              testID={`${ROUTE}.addSheet.item`}
            />
            <ListRow title={t('maintenance.addLog')} subtitle={t('maintenance.addLogHelper')} icon="service-wrench" onPress={() => add('log')} testID={`${ROUTE}.addSheet.log`} />
          </RowGroup>
        </View>
      </Sheet>
    </Screen>
  );
}
