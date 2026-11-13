import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { useCompare } from '@/api/queries/signature';
import { isVehicleUnavailable } from '@/api/queries/vehicles';
import { useCloseModal } from '@/features/garage/navigation';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { EmptyState, ErrorState, Hairline, Header, Icon, Photo, PressableScale, Screen, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';
import { vehicleNameText } from '@/ui/textBreaks';
import { keepShortNamesTogether } from '@/lib/format';

import { COMPARE_FLAG, compareItems, compareSummary, type CompareData, type CompareItem, type CompareModCategory, type CompareSide, type CompareSpecRow, type CompareVehicle } from '../compare';
import { photoFields } from '../media';
import { ComparePicker } from '../components/ComparePicker';
import { categoryIcon } from '../model';
import { paramOf } from '../navigation';

const ROUTE = 'VEH-06';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const SIDES: readonly CompareSide[] = ['a', 'b'];
/** Thumbs of the sticky header: half the column, well below the 4:3 card width. */
const THUMB_WIDTH = 320;
/** The skeleton's spec rows: no more than a loaded pair shows under its first group, so it never runs longer than the content. */
const SKELETON_ROWS = 4;

const useStyles = createStyles((t) => ({
  list: { flex: 1 },
  column: { alignSelf: 'center', maxWidth: layout.feedColumn, width: '100%' },
  // The ground spans the window, so rows scroll under the pinned pair edge to edge; the pair itself keeps to the gutter.
  sticky: { backgroundColor: t.color.bg.canvas, paddingBottom: t.space[12], paddingTop: t.space[8] },
  pair: { flexDirection: 'row', gap: t.space[12] },
  cell: { flex: 1, minWidth: 0 },
  car: { flex: 1, gap: t.space[8], minWidth: 0 },
  carVisual: { borderRadius: t.radius.sm, gap: t.space[8] },
  section: { gap: t.space[4], paddingTop: t.space[32] },
  group: { paddingBottom: t.space[4], paddingTop: t.space[16] },
  row: { gap: t.space[4], paddingVertical: t.space[12] },
  mods: { gap: t.space[12], paddingTop: t.space[16] },
  modHead: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  modList: { flex: 1, gap: t.space[8], minWidth: 0 },
  mod: { gap: t.space[2] },
  end: { paddingBottom: t.space[32] },
  state: { flex: 1, justifyContent: 'center', paddingVertical: t.space[32] },
  skeleton: { flex: 1, overflow: 'hidden' },
}));

/**
 * DQ-414: each row pads itself to the gutter. FlashList draws its sticky header outside the content container, so a padding there
 * left the pinned pair at x 0 while the table below started at the gutter. Both now share one edge: column A at x = gutter, each
 * column (width − 2 · gutter − 12) / 2 wide.
 */
function useGutterEdge(gutter: number): ViewStyle {
  return useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);
}

/** VEH-06 (modals)/compare?a={slug}&b={slug} [SIG `sig.compare`]: the two builds side by side. */
export function CompareScreen() {
  const { t } = useTranslation('vehicle');
  const params = useLocalSearchParams<{ a?: string; b?: string }>();
  const a = paramOf(params.a) ?? '';
  const b = paramOf(params.b) ?? '';
  const enabled = useFlag(COMPARE_FLAG);
  const qaState = useQaState();
  const online = useOnline();
  const close = useCloseModal('/discover');
  const { gutter } = useBreakpoint();
  const sheet = useStyles();
  const router = useRouter();
  const query = useCompare(enabled ? a : '', enabled ? b : '');
  const [picking, setPicking] = useState(false);

  let state: ReactNode = null;
  let loading = false;
  if (!enabled || a === '' || b === '' || qaState === 'empty') {
    state = <EmptyState icon="info" title={t('compare.missingTitle')} body={t('compare.missingBody')} testID={`${ROUTE}.missing`} />;
  } else if (query.same) {
    // DQ-430: §8 empty state with its one button, which offers the second build again.
    state = (
      <EmptyState
        icon="info"
        title={t('compare.sameTitle')}
        body={t('compare.sameBody')}
        action={{ label: t('compare.pickOther'), onPress: () => setPicking(true), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.same`}
      />
    );
  } else if (qaState !== 'error' && query.error && isVehicleUnavailable(query.error)) {
    state = <EmptyState icon="eye-slash" title={t('compare.unavailableTitle')} body={t('compare.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (qaState === 'error' || (!query.data && (query.error || query.isPaused))) {
    const offline = !online || query.isPaused;
    state = (
      <ErrorState
        title={offline ? t('error.offlineTitle') : t('compare.errorTitle')}
        message={offline ? t('error.offlineBody') : undefined}
        onRetry={query.refetch}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (qaState === 'loading' || !query.data) {
    loading = true;
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header backIcon="close" onBack={close} title={t('compare.title')} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      {loading ? (
        // DQ-422: in the list's place, not in the centred state frame, so the pair starts where the loaded pair does.
        <CompareSkeleton gutter={gutter} />
      ) : state || !query.data ? (
        <View style={[sheet.state, { paddingHorizontal: gutter }]}>{state}</View>
      ) : (
        <CompareList data={query.data} gutter={gutter} />
      )}
      {enabled && query.same ? (
        <ComparePicker
          visible={picking}
          onClose={() => setPicking(false)}
          current={a}
          onPick={(other) => {
            setPicking(false);
            router.setParams({ b: other });
          }}
          testID={`${ROUTE}.picker`}
        />
      ) : null}
    </Screen>
  );
}

function CompareList({ data, gutter }: { data: CompareData; gutter: number }) {
  const sheet = useStyles();
  const items = useMemo(() => compareItems(data), [data]);
  const edge = useGutterEdge(gutter);
  return (
    <FlashList
      data={items}
      keyExtractor={(item: CompareItem) => (item.kind === 'header' ? 'header' : item.key)}
      getItemType={(item: CompareItem) => item.kind}
      stickyHeaderIndices={[0]}
      style={sheet.list}
      ListFooterComponent={<View style={sheet.end} />}
      renderItem={({ item }: { item: CompareItem }) => <CompareRow item={item} data={data} edge={edge} />}
      testID={`${ROUTE}.list`}
    />
  );
}

const CompareRow = memo(function CompareRow({ item, data, edge }: { item: CompareItem; data: CompareData; edge: ViewStyle }) {
  const styles = useStyles();
  let body: ReactNode;
  switch (item.kind) {
    case 'header':
      return (
        <View style={[edge, styles.sticky]} testID={`${ROUTE}.sticky`}>
          <View style={styles.column}>
            <CarPair a={data.a} b={data.b} />
          </View>
        </View>
      );
    case 'section':
      body = <SectionTitle kind={item.title === 'specs' ? 'specs' : 'mods'} data={data} />;
      break;
    case 'group':
      body = (
        <View style={styles.group}>
          <Text variant="labelCaps" color="text.secondary" role="heading" {...({ 'aria-level': 3 } as object)}>
            {item.title}
          </Text>
        </View>
      );
      break;
    case 'spec':
      body = <SpecPair row={item.row} differs={item.differs} last={item.last} />;
      break;
    case 'mods':
      body = <ModPair category={item.category} />;
      break;
    case 'noMods':
      body = <NoMods />;
      break;
  }
  return (
    <View style={edge}>
      <View style={styles.column}>{body}</View>
    </View>
  );
});

/** The sticky pair: thumb and title of each build, each opening its page. */
function CarPair({ a, b }: { a: CompareVehicle; b: CompareVehicle }) {
  const styles = useStyles();
  return (
    <View style={styles.pair} testID={`${ROUTE}.cars`}>
      <Car vehicle={a} side="a" />
      <Car vehicle={b} side="b" />
    </View>
  );
}

function Car({ vehicle, side }: { vehicle: CompareVehicle; side: CompareSide }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  return (
    <PressableScale
      role="link"
      aria-label={t('compare.open', { vehicle: vehicle.title })}
      onPress={() => router.push(`/v/${vehicle.slug}`)}
      style={styles.car}
      contentStyle={styles.carVisual}
      testID={`${ROUTE}.car.${side}`}
    >
      <Photo {...photoFields(vehicle.cover, THUMB_WIDTH)} aspect="4:3" corner="sm" testID={`${ROUTE}.car.${side}.photo`} />
      {/* §4: make and model are never cut; the title wraps instead (three lines at twice the size). */}
      <Text variant="callout" color="text.primary" hyphenate={false} testID={`${ROUTE}.car.${side}.title`}>
        {/* DQ-438: "GT-R" and "C 63" stay whole at twice the size; the title wraps at its other spaces. */}
        {vehicleNameText(vehicle.title)}
      </Text>
    </PressableScale>
  );
}

function SectionTitle({ kind, data }: { kind: 'specs' | 'mods'; data: CompareData }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const summary = compareSummary(data);
  return (
    <View style={styles.section}>
      <Text variant="headline" role="heading" {...({ 'aria-level': 2 } as object)}>
        {kind === 'specs' ? t('compare.specs') : t('compare.mods')}
      </Text>
      {kind === 'specs' && summary.rows > 0 ? (
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.summary`}>
          {t('compare.summary', { differences: summary.differences, rows: summary.rows })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One spec, the label above both values. A difference is set in `body.strong` on both sides and named for screen readers;
 * equal values stay regular (weight, not colour alone).
 */
function SpecPair({ row, differs, last }: { row: CompareSpecRow; differs: boolean; last: boolean }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const missing = t('compare.missing');
  const value = (side: CompareSide) => row[side] ?? missing;
  return (
    <View>
      <View
        accessible
        aria-label={t('compare.rowLabel', { label: row.label, a: value('a'), b: value('b'), state: differs ? t('compare.differs') : t('compare.same') })}
        style={styles.row}
        testID={`${ROUTE}.spec.${row.key}`}
      >
        <Text variant="callout" color="text.secondary">
          {row.label}
        </Text>
        <View style={styles.pair}>
          {SIDES.map((side) => (
            <View key={side} style={styles.cell}>
              <Text
                variant={differs ? 'bodyStrong' : 'body'}
                color={row[side] === null ? 'text.tertiary' : 'text.primary'}
                testID={`${ROUTE}.spec.${row.key}.${side}`}
              >
                {row[side] ?? '–'}
              </Text>
            </View>
          ))}
        </View>
      </View>
      {last ? null : <Hairline />}
    </View>
  );
}

function ModPair({ category }: { category: CompareModCategory }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  return (
    <View style={styles.mods} testID={`${ROUTE}.mods.${category.key}`}>
      <View style={styles.modHead}>
        <Icon name={categoryIcon(category.icon)} size={20} color="text.secondary" />
        <Text variant="bodyStrong" role="heading" {...({ 'aria-level': 3 } as object)}>
          {category.label}
        </Text>
      </View>
      <View style={styles.pair}>
        {SIDES.map((side) => (
          <View key={side} style={styles.modList} testID={`${ROUTE}.mods.${category.key}.${side}`}>
            {category[side].length === 0 ? (
              <Text variant="callout" color="text.tertiary">
                {t('compare.noModsSide')}
              </Text>
            ) : (
              category[side].map((mod) => (
                <View key={mod.id} style={styles.mod}>
                  {/* DQ-926: a part name never breaks at its own hyphen ("Slip- / On"). */}
                  <Text variant="callout">{keepShortNamesTogether(mod.title)}</Text>
                  {mod.summary && mod.summary !== mod.title ? (
                    <Text variant="caption" color="text.secondary">
                      {mod.summary}
                    </Text>
                  ) : null}
                  <Text variant="caption" color="text.tertiary">
                    {mod.status}
                  </Text>
                </View>
              ))
            )}
          </View>
        ))}
      </View>
      <Hairline />
    </View>
  );
}

function NoMods() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  return (
    <View style={styles.mods}>
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.noMods`}>
        {t('compare.noMods')}
      </Text>
    </View>
  );
}

/**
 * DQ-422: the loaded list's geometry, row for row: the pinned pair in the gutter (photo 4:3 and a title line), the section title with
 * its summary, the first group's eyebrow and its spec rows with their hairlines. It never runs longer than the content.
 */
function CompareSkeleton({ gutter }: { gutter: number }) {
  const styles = useStyles();
  const edge = useGutterEdge(gutter);
  return (
    <Skeleton style={styles.skeleton} testID={`${ROUTE}.skeleton`}>
      <View style={[edge, styles.sticky]} testID={`${ROUTE}.skeleton.sticky`}>
        <View style={[styles.column, styles.pair]}>
          {SIDES.map((side) => (
            <View key={side} style={styles.car} testID={`${ROUTE}.skeleton.car.${side}`}>
              <SkeletonBlock width="100%" aspectRatio={4 / 3} corner="sm" testID={`${ROUTE}.skeleton.car.${side}.photo`} />
              <SkeletonText variant="callout" width="80%" testID={`${ROUTE}.skeleton.car.${side}.title`} />
            </View>
          ))}
        </View>
      </View>
      <View style={edge}>
        <View style={[styles.column, styles.section]}>
          <SkeletonText variant="headline" width="30%" />
          <SkeletonText variant="callout" width="55%" />
        </View>
        <View style={[styles.column, styles.group]}>
          <SkeletonText variant="labelCaps" width="20%" />
        </View>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View key={index} style={styles.column} testID={`${ROUTE}.skeleton.row`}>
            <View style={styles.row}>
              <SkeletonText variant="callout" width="35%" />
              <View style={styles.pair}>
                <View style={styles.cell}>
                  <SkeletonText variant="body" width="60%" />
                </View>
                <View style={styles.cell}>
                  <SkeletonText variant="body" width="60%" />
                </View>
              </View>
            </View>
            {index === SKELETON_ROWS - 1 ? null : <Hairline />}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}
