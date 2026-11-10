import type { FlashListRef } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useModCategories, type ModCategory } from '@/api/queries/catalog';
import { useVehicle } from '@/api/queries/garage';
import { useReorderMods, useVehicleMods, type OwnerMod } from '@/api/queries/mods';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { GroupHeader } from '@/features/vehicle/components/RowCard';
import { useLegalPill } from '@/features/vehicle/legal';
import { categoryIcon, modValues } from '@/features/vehicle/model';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, size, space, useBreakpoint } from '@/theme';
import { Button, DiscardGuardDialog, EmptyState, Header, ModRow, Screen, Skeleton, SkeletonText, StatusPill, Text, toast, type HeaderAction } from '@/ui';

import { CategorySheet } from '../components/CategorySheet';
import { FORM_MAX_WIDTH, LoadErrorState, RestrictedNotice, SignInState, useGarageAccess, usePushedHeaderWidth, HEADER_TEXT_ACTION } from '../components/frames';
import { SortHandleSlot, Sortable } from '../components/Sortable';
import { saveErrorMessage } from '../errors';

const ROUTE = 'GAR-09';
const EDGES: readonly Edge[] = ['left', 'right'];
const SORT_ROW = size.row.single;

type Group = { category: { key: string; name: string; icon: string | null }; mods: OwnerMod[] };
type Row = { kind: 'header'; group: Group; first: boolean } | { kind: 'mod'; mod: OwnerMod; first: boolean; last: boolean };

/** Groups in the catalogue's order (as VEH-01's Mods tab), the member's order inside each. Unknown categories go last. */
export function groupMods(mods: readonly OwnerMod[], categories: readonly ModCategory[] | undefined): Group[] {
  const order = new Map((categories ?? []).map((category, index) => [category.key, index]));
  const groups = new Map<string, Group>();
  for (const mod of mods) {
    const group = groups.get(mod.category.key) ?? { category: mod.category, mods: [] };
    group.mods.push(mod);
    groups.set(mod.category.key, group);
  }
  return [...groups.values()].sort(
    (a, b) => (order.get(a.category.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.category.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  // DQ-156: from 768 the column starts on the gutter under back (frames.tsx usePushedHeaderWidth).
  column: { alignSelf: 'flex-start', maxWidth: FORM_MAX_WIDTH, width: '100%' },
  header: { paddingBottom: t.space[12] },
  headerGap: { paddingTop: t.space[32] },
  card: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  first: { borderTopLeftRadius: t.radius.md, borderTopRightRadius: t.radius.md },
  last: { borderBottomLeftRadius: t.radius.md, borderBottomRightRadius: t.radius.md },
  top: { gap: t.space[16], paddingBottom: t.space[24], paddingTop: t.space[16] },
  end: { paddingBottom: t.space[32] },
  disclaimer: { paddingTop: t.space[16] },
  sortGroup: { gap: t.space[12], paddingBottom: t.space[32] },
  sortCard: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  sortRow: { alignItems: 'center', backgroundColor: t.color.bg.surface, flexDirection: 'row', gap: t.space[12], height: SORT_ROW, paddingLeft: t.space[16], paddingRight: t.space[4] },
  sortRowActive: { backgroundColor: t.color.bg.raised },
  sortText: { flex: 1, minWidth: 0 },
  skeletonRow: { justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16] },
}));

const ModItem = memo(function ModItem({ mod, first, last, onOpen }: { mod: OwnerMod; first: boolean; last: boolean; onOpen: (mod: OwnerMod) => void }) {
  const styles = useStyles();
  const legalPill = useLegalPill();
  return (
    <View style={[styles.card, first ? styles.first : null, last ? styles.last : null]}>
      <ModRow
        icon={categoryIcon(mod.category.icon)}
        name={mod.title}
        values={modValues(mod)}
        status={mod.status_label}
        {...legalPill(mod)}
        onPress={() => onOpen(mod)}
        inset={space[16]}
        divider={!last}
        testID={`${ROUTE}.mod.${mod.id}`}
      />
    </View>
  );
});

function ModsSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.header}>
        <SkeletonText variant="titleS" width="40%" />
      </View>
      <View style={[styles.card, styles.first, styles.last]}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonText variant="bodyStrong" width="55%" />
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** GAR-09 /garage/[id]/mods: grouped by category with status pills; "+" picks a category, "Sortieren" reorders. */
export function ModsScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const access = useGarageAccess();
  const back = useBack('/garage');
  const params = useLocalSearchParams<{ id: string }>();
  const id = paramOf(params.id) ?? '';
  const vehicle = useVehicle(id);
  const query = useVehicleMods(id);
  const categories = useModCategories();
  const reorder = useReorderMods({ id, slug: vehicle.data?.slug ?? '' });
  const inset = useTabBarInset();
  const { gutter } = useBreakpoint();
  const headerWidth = usePushedHeaderWidth(FORM_MAX_WIDTH);
  const listRef = useRef<FlashListRef<Row>>(null);
  const [picking, setPicking] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [order, setOrder] = useState<Record<string, OwnerMod[]>>({});

  const mods = useMemo(() => (qaState === 'empty' ? [] : query.data), [qaState, query.data]);
  const legalPill = useLegalPill();
  // 08_LEGAL §7: a stated legal status always shows with the disclaimer, at the end of the list as on VEH-01's Mods tab.
  const statesLegal = (mods ?? []).some((mod) => legalPill(mod).legalStatus !== undefined);
  const groups = useMemo(() => groupMods(mods ?? [], categories.data), [categories.data, mods]);
  const locked = access.restriction !== null;
  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap((group, groupIndex) => [
        { kind: 'header' as const, group, first: groupIndex === 0 },
        ...group.mods.map((mod, index) => ({ kind: 'mod' as const, mod, first: index === 0, last: index === group.mods.length - 1 })),
      ]),
    [groups],
  );

  useTabScrollToTop(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    return false;
  });

  const open = useCallback((mod: OwnerMod) => router.push(`/garage/${id}/mods/${mod.id}`), [id, router]);
  const create = (category: ModCategory) => router.push({ pathname: '/garage/[id]/mods/[modId]', params: { id, modId: 'new', category: category.key } });

  const finish = () => {
    setSorting(false);
    if (Object.keys(order).length === 0) return;
    const ids = groups.flatMap((group) => (order[group.category.key] ?? group.mods).map((mod) => mod.id));
    setOrder({});
    reorder.mutate(ids, {
      onSuccess: () => toast(t('mods.sortSaved'), { testID: `${ROUTE}.toast` }),
      onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
    });
  };

  const canSort = groups.some((group) => group.mods.length > 1);
  const actions: HeaderAction[] =
    access.status === 'member' && !sorting && mods
      ? [{ icon: 'plus', label: t('mods.add'), onPress: () => setPicking(true), disabled: locked || !online, testID: `${ROUTE}.add` }]
      : [];
  const trailing =
    canSort || sorting ? (
      <Button
        label={sorting ? t('garage.sortDone') : t('garage.sort')}
        variant="tertiary"
        size="s"
        style={HEADER_TEXT_ACTION}
        disabled={!sorting && (locked || !online)}
        onPress={sorting ? finish : () => setSorting(true)}
        testID={`${ROUTE}.${sorting ? 'sortDone' : 'sort'}`}
      />
    ) : null;

  let state: ReactNode = null;
  if (access.status === 'guest') state = <SignInState routeId={ROUTE} returnTo={`/garage/${id}/mods`} />;
  else if (qaState === 'loading' || access.status === 'loading' || (!mods && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) state = <ModsSkeleton />;
  else if (qaState === 'error' || !mods)
    state = <LoadErrorState routeId={ROUTE} offline={!online || query.fetchStatus === 'paused'} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  else if (mods.length === 0)
    state = (
      <EmptyState
        icon="wrench"
        title={t('mods.emptyTitle')}
        body={t('mods.emptyBody')}
        action={{ label: t('mods.add'), onPress: () => setPicking(true), disabled: locked || !online }}
        testID={`${ROUTE}.empty`}
      />
    );

  const top = (
    <View style={[styles.column, styles.top]}>
      {access.restriction ? <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} /> : null}
      {vehicle.data ? (
        <Text variant="supporting" color="text.secondary" testID={`${ROUTE}.vehicle`}>
          {vehicle.data.full_title}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={t('mods.title')} onBack={back} actions={actions} trailing={trailing} contentMaxWidth={headerWidth} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      {sorting ? (
        <ScrollView scrollEnabled={!dragging} style={styles.list} contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: inset }} testID={`${ROUTE}.sortList`}>
          <View style={styles.column}>
            <Text variant="supporting" color="text.secondary" style={styles.top} testID={`${ROUTE}.sortHint`}>
              {isWeb ? t('mods.sortHintWeb') : t('mods.sortHint')}
            </Text>
            {groups.map((group) => (
              <View key={group.category.key} style={styles.sortGroup}>
                <GroupHeader title={group.category.name} icon={categoryIcon(group.category.icon)} count={group.mods.length} />
                <View style={styles.sortCard}>
                  <Sortable
                    items={order[group.category.key] ?? group.mods}
                    keyOf={(mod) => mod.id}
                    labelOf={(mod) => mod.title}
                    rowHeight={SORT_ROW}
                    gap={0}
                    onChange={(next) => setOrder((current) => ({ ...current, [group.category.key]: next }))}
                    onDragging={setDragging}
                    renderItem={(mod, { active }) => (
                      <View style={[styles.sortRow, active ? styles.sortRowActive : null]}>
                        <View style={styles.sortText}>
                          <Text variant="bodyStrong" numberOfLines={1}>
                            {mod.title}
                          </Text>
                        </View>
                        <StatusPill label={mod.status_label} />
                        <SortHandleSlot />
                      </View>
                    )}
                    testID={`${ROUTE}.sortable.${group.category.key}`}
                  />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <FlashList
          ref={listRef}
          data={state ? [] : rows}
          keyExtractor={(row: Row) => (row.kind === 'header' ? `header.${row.group.category.key}` : row.mod.id)}
          getItemType={(row: Row) => row.kind}
          style={styles.list}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: inset }}
          ListHeaderComponent={top}
          ListEmptyComponent={state ? <View style={styles.column}>{state}</View> : null}
          ListFooterComponent={
            <View style={[styles.column, styles.end]}>
              {statesLegal && !state ? (
                <Text variant="helper" color="text.tertiary" style={styles.disclaimer} testID={`${ROUTE}.legalDisclaimer`}>
                  {t('mods.legalStatusHelper')}
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item }: { item: Row }) => (
            <View style={styles.column}>
              {item.kind === 'header' ? (
                <View style={[styles.header, item.first ? null : styles.headerGap]}>
                  <GroupHeader
                    title={item.group.category.name}
                    icon={categoryIcon(item.group.category.icon)}
                    count={item.group.mods.length}
                    countLabel={t('mods.count', { count: item.group.mods.length })}
                    testID={`${ROUTE}.group.${item.group.category.key}`}
                  />
                </View>
              ) : (
                <ModItem mod={item.mod} first={item.first} last={item.last} onOpen={open} />
              )}
            </View>
          )}
          testID={`${ROUTE}.list`}
        />
      )}
      <CategorySheet visible={picking} onClose={() => setPicking(false)} onPick={create} testID={`${ROUTE}.categories`} />
      {/* A sort is saved by "Fertig", which clears the order first, so only leaving without it asks. */}
      <DiscardGuardDialog dirty={sorting && Object.keys(order).length > 0} testID={`${ROUTE}.discard`} />
    </Screen>
  );
}
