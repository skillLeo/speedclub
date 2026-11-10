import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { createStyles, size, space, useTheme } from '@/theme';
import { Hairline, Photo, PressableScale, SkeletonBlock, SkeletonText, Text, type PhotoFields } from '@/ui';
import { joinLabel, LARGE_FONT_SCALE } from '@/ui/rowParts';
import { ValueText } from '@/ui/ValueText';

/** The fields of a set-up in the lead's fixed order (DQ-323), the same in the cards and the table. */
export const WHEEL_COLUMNS = ['wheel', 'size', 'et', 'tyres', 'suspension', 'lowering'] as const;
export type WheelColumn = (typeof WHEEL_COLUMNS)[number];
/** Names wrap at their spaces ("Rays Volk Racing / TE37 SL", DQ-316); sizes stay whole values. */
const NAME_COLUMNS: ReadonlySet<WheelColumn> = new Set(['wheel', 'suspension']);

/** One build's set-up, its cells already in §3.9's notation with front and rear merged where equal (`wheelRows.ts`). */
export type WheelTableRow = {
  id: string;
  slug: string;
  title: string;
  /** "@kenji.r34", or null when the owner hides the name (ADR-148 a). */
  owner: string | null;
  thumb: PhotoFields;
  cells: Readonly<Record<WheelColumn, string>>;
};

/**
 * Column widths at font scale 1, sized to their content (DQ-436): a name column wraps at its spaces, a value column holds its
 * longest value whole ("255/35 R19", "−25 mm", "Tieferlegung"). From the spacing scale; together 960, so the table fits the
 * 1280 pane without a sideways scroll. They grow with the font, and share out spare width to fill the pane.
 */
const BUILD_WIDTH = space[64] * 2 + space[48] + space[8];
const COLUMN_WIDTH: Readonly<Record<WheelColumn, number>> = {
  wheel: space[64] * 2 + space[48],
  size: space[64] + space[48],
  et: space[64] + space[8],
  tyres: space[64] + space[48] + space[8],
  suspension: space[64] * 2 + space[48],
  lowering: space[64] + space[48] + space[8],
};
const MAX_WIDTH_SCALE = 2;
/** DQ-322: the pinned build column never takes more than this share of the visible table. */
export const PINNED_SHARE = 0.4;

const useStyles = createStyles((t) => ({
  table: {
    backgroundColor: t.color.bg.surface,
    borderColor: t.color.border.subtle,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.control,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row' },
  headerRow: { backgroundColor: t.color.bg.raised, flexDirection: 'row' },
  cell: { justifyContent: 'center', paddingHorizontal: t.space[12], paddingVertical: t.space[12] },
  // The build column stays in place while the others scroll under it: its own surface covers them (DQ-333: surface, not canvas).
  sticky: { backgroundColor: t.color.bg.surface, borderColor: t.color.border.subtle, borderRightWidth: t.size.border.control, zIndex: t.zIndex.sticky },
  stickyHeader: { backgroundColor: t.color.bg.raised },
  // The link is a real 44 target (web ignores hitSlop): the 40 thumb and a one-line name alone measure 40 (M2.8 round 2).
  buildTarget: { minHeight: t.size.touchMin },
  build: { alignItems: 'flex-start', borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[8] },
  buildHover: { backgroundColor: t.color.state.hover },
  // A fixed 40 square, never stretched by a tall title (DQ-322).
  thumb: { alignSelf: 'flex-start', flexGrow: 0, flexShrink: 0, width: t.size.avatar.md },
  buildText: { flex: 1, minWidth: 0 },
  rowHover: { backgroundColor: t.color.state.hover },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  fields: { gap: t.space[8] },
  field: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  fieldLabel: { flexBasis: '35%', flexGrow: 0, flexShrink: 0 },
  fieldValue: { flexBasis: '55%', flexGrow: 1, flexShrink: 1, minWidth: 0 },
  // DQ-448: from the large font scale a label no longer fits its column; it stands above its value, a hairline between rows.
  fieldStacked: { gap: t.space[4] },
}));

type BuildLinkProps = { row: WheelTableRow; onOpen: (row: WheelTableRow) => void; testID: string };

/** Thumb, name and @owner: one link whose name is the visible text, owner included (F3, WCAG 2.5.3). */
function BuildLink({ row, onOpen, testID }: BuildLinkProps) {
  const styles = useStyles();
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([row.title, row.owner])}
      onPress={() => onOpen(row)}
      style={styles.buildTarget}
      contentStyle={(state) => [styles.build, state.hovered || state.focused ? styles.buildHover : null]}
      testID={`${testID}.open`}
    >
      <Photo {...row.thumb} aspect="1:1" corner="sm" style={styles.thumb} />
      <View style={styles.buildText}>
        <Text variant="labelS" hyphenate={false}>
          {keepNameTogether(row.title)}
        </Text>
        {row.owner ? (
          <Text variant="caption" color="text.tertiary" hyphenate={false}>
            {row.owner}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

export type WheelSetupCardProps = { row: WheelTableRow; onOpen: (row: WheelTableRow) => void; testID: string };

/**
 * Below 768 (lead ruling, DQ-322/323): one compact card per build, the same fields in the same order, so reading down the cards
 * compares the set-ups without a sideways scroll at any font size.
 */
export const WheelSetupCard = memo(function WheelSetupCard({ row, onOpen, testID }: WheelSetupCardProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const stacked = useTheme().fontScale >= LARGE_FONT_SCALE;
  const id = `${testID}.${row.id}`;
  return (
    <View style={styles.card} testID={id}>
      <BuildLink row={row} onOpen={onOpen} testID={id} />
      <View role="list" style={styles.fields}>
        {WHEEL_COLUMNS.map((column, index) => (
          <View key={column} role="listitem" style={stacked ? styles.fieldStacked : styles.field} testID={`${id}.${column}.row`}>
            {stacked && index > 0 ? <Hairline /> : null}
            <Text variant="supporting" color="text.secondary" hyphenate={false} style={stacked ? null : styles.fieldLabel} testID={`${id}.${column}.label`}>
              {t(`wheelTable.${column}`)}
            </Text>
            <View style={stacked ? null : styles.fieldValue} testID={`${id}.${column}`}>
              <ValueText variant="supporting" values={row.cells[column]} hyphenate={false} wholeValues={!NAME_COLUMNS.has(column)} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
});

/** The geometry of a `WheelSetupCard` while the set-ups load: the 44 build link (40 thumb, name, owner), then the six fields. */
export function WheelSetupCardSkeleton({ testID }: { testID?: string }) {
  const styles = useStyles();
  const stacked = useTheme().fontScale >= LARGE_FONT_SCALE;
  return (
    <View style={styles.card} testID={testID}>
      <View style={[styles.build, styles.buildTarget]}>
        <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="sm" />
        <View style={styles.buildText}>
          <SkeletonText variant="labelS" width="60%" />
          <SkeletonText variant="caption" width="35%" />
        </View>
      </View>
      <View style={styles.fields}>
        {WHEEL_COLUMNS.map((column, index) => (
          <View key={column} style={stacked ? styles.fieldStacked : styles.field}>
            {stacked && index > 0 ? <Hairline /> : null}
            <SkeletonText variant="supporting" width="30%" style={stacked ? null : styles.fieldLabel} />
            <SkeletonText variant="supporting" width="45%" style={stacked ? null : styles.fieldValue} />
          </View>
        ))}
      </View>
    </View>
  );
}

function useStickyStyle(scrollX: SharedValue<number>, pinned: boolean) {
  return useAnimatedStyle(() => ({ transform: [{ translateX: pinned ? scrollX.get() : 0 }] }));
}

type Layout = { widths: Readonly<Record<WheelColumn, number>>; build: number; pinned: boolean };

/** The width the table needs at this font scale for every column to show whole, its frame included. */
export function tableNaturalWidth(fontScale: number): number {
  const scale = Math.min(MAX_WIDTH_SCALE, Math.max(1, fontScale));
  const columns = BUILD_WIDTH + WHEEL_COLUMNS.reduce((sum, column) => sum + COLUMN_WIDTH[column], 0);
  return Math.ceil(columns * scale) + 2 * size.border.control;
}

/**
 * DQ-436: the table only where all its columns fit (`room`, the pane's inner width); elsewhere the cards, which never scroll
 * sideways. So a tablet and every large font read cards, and the table's own sideways scroll stays a fallback.
 */
export function wheelTableFits(room: number, fontScale: number): boolean {
  return room >= tableNaturalWidth(fontScale);
}

/**
 * The columns for a table this wide: each at its width for the font scale; spare width is shared out so the table fills the
 * pane (DQ-323). When the columns do not fit, the table scrolls sideways and the build column is pinned, at most 40 % of it.
 */
export function tableLayout(tableWidth: number, fontScale: number): Layout {
  const scale = Math.min(MAX_WIDTH_SCALE, Math.max(1, fontScale));
  const base = Object.fromEntries(WHEEL_COLUMNS.map((column) => [column, COLUMN_WIDTH[column] * scale])) as Record<WheelColumn, number>;
  const build = BUILD_WIDTH * scale;
  const total = build + WHEEL_COLUMNS.reduce((sum, column) => sum + base[column], 0);
  if (tableWidth <= 0 || total <= tableWidth) {
    const grow = tableWidth > 0 ? tableWidth / total : 1;
    const widths = Object.fromEntries(WHEEL_COLUMNS.map((column) => [column, Math.floor(base[column] * grow)])) as Record<WheelColumn, number>;
    const buildWidth = Math.floor(build * grow);
    // DQ-447: rounding every column down left the rows up to 7 short of the frame; the last column takes the rest.
    if (tableWidth > 0) {
      const used = buildWidth + WHEEL_COLUMNS.reduce((sum, column) => sum + widths[column], 0);
      const last = WHEEL_COLUMNS[WHEEL_COLUMNS.length - 1] as WheelColumn;
      widths[last] += tableWidth - used;
    }
    return { widths, build: buildWidth, pinned: false };
  }
  const rounded = Object.fromEntries(WHEEL_COLUMNS.map((column) => [column, Math.round(base[column])])) as Record<WheelColumn, number>;
  return { widths: rounded, build: Math.round(Math.min(build, tableWidth * PINNED_SHARE)), pinned: true };
}

type RowProps = {
  row: WheelTableRow;
  layout: Layout;
  scrollX: SharedValue<number>;
  divider: boolean;
  onOpen: (row: WheelTableRow) => void;
  testID: string;
};

const TableRow = memo(function TableRow({ row, layout, scrollX, divider, onOpen, testID }: RowProps) {
  const styles = useStyles();
  const sticky = useStickyStyle(scrollX, layout.pinned);
  const id = `${testID}.${row.id}`;
  return (
    <View>
      {/* A tap anywhere on the row opens the build; the keyboard and screen readers reach it through the build's own link. */}
      <Pressable
        onPress={() => onOpen(row)}
        accessible={false}
        focusable={false}
        {...(isWeb ? { tabIndex: -1 } : {})}
        style={(state) => [styles.row, (state as { hovered?: boolean }).hovered ? styles.rowHover : null]}
        role="row"
        testID={id}
      >
        <Animated.View role="rowheader" style={[styles.cell, styles.sticky, { width: layout.build }, sticky]}>
          <BuildLink row={row} onOpen={onOpen} testID={id} />
        </Animated.View>
        {WHEEL_COLUMNS.map((column) => (
          <View key={column} role="cell" style={[styles.cell, { width: layout.widths[column] }]} testID={`${id}.${column}`}>
            <ValueText variant="supporting" values={row.cells[column]} hyphenate={false} wholeValues={!NAME_COLUMNS.has(column)} />
          </View>
        ))}
      </Pressable>
      {divider ? <Hairline /> : null}
    </View>
  );
});

function HeaderRow({ layout, scrollX }: Pick<RowProps, 'layout' | 'scrollX'>) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const sticky = useStickyStyle(scrollX, layout.pinned);
  return (
    <View role="row" style={styles.headerRow}>
      <Animated.View role="columnheader" style={[styles.cell, styles.sticky, styles.stickyHeader, { width: layout.build }, sticky]}>
        <Text variant="caption" color="text.secondary">
          {t('wheelTable.build')}
        </Text>
      </Animated.View>
      {WHEEL_COLUMNS.map((column) => (
        <View key={column} role="columnheader" style={[styles.cell, { width: layout.widths[column] }]}>
          <Text variant="caption" color="text.secondary">
            {t(`wheelTable.${column}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export type WheelSetupTableProps = {
  rows: readonly WheelTableRow[];
  /** "Räder-Vergleich: BMW M4": the table's accessible name. */
  caption: string;
  onOpen: (row: WheelTableRow) => void;
  /** `<ROUTE-ID>.wheels`; rows add `.<id>`, cells `.<id>.<column>`. */
  testID: string;
};

/**
 * DISC-04 Räder-Vergleich from 768 (brief §5 "compare wheel setups"): a real table across the pane, one row per build, tabular
 * values. Table, row, header and cell roles give screen readers the grid; a row opens VEH-01.
 */
export function WheelSetupTable({ rows, caption, onOpen, testID }: WheelSetupTableProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const [width, setWidth] = useState(0);
  const layout = tableLayout(width, fontScale);
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(Math.max(0, event.contentOffset.x));
  });
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.floor(event.nativeEvent.layout.width - 2 * styles.table.borderWidth));
  return (
    <View role="table" aria-label={caption} style={styles.table} onLayout={onLayout} testID={testID}>
      <Animated.ScrollView
        horizontal
        scrollEnabled={layout.pinned}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={layout.pinned}
        testID={`${testID}.scroll`}
      >
        <View role="rowgroup">
          <HeaderRow layout={layout} scrollX={scrollX} />
          <Hairline />
          {rows.map((row, index) => (
            <TableRow key={row.id} row={row} layout={layout} scrollX={scrollX} divider={index < rows.length - 1} onOpen={onOpen} testID={testID} />
          ))}
        </View>
      </Animated.ScrollView>
    </View>
  );
}
