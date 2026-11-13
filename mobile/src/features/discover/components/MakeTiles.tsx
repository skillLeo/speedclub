import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { MakeTile } from '@/api/queries/discover';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, fontScaleCap, space, typeScale, typography, useTheme } from '@/theme';
import { PressableScale, SampleBadge, Skeleton, SkeletonBlock, Text } from '@/ui';
import { estimatedTitleWidth } from '@/ui/displayTitleLayout';
import { joinLabel } from '@/ui/rowParts';

/** The tiles' gap and their padding: tight, so two wordmarks fit beside each other on a 390 phone (09 §7.5). */
const GAP = space[8];
const PADDING = space[8];
/** 09 §7.5: three columns of BrandTiles where every wordmark fits its tile, then two, then one row per make. */
const COLUMN_STEPS = [3, 2] as const;
/** DISC-01 shows the top makes (most builds first, the API's order); "Alle Marken" opens the rest. */
export const TOP_MAKES = 12;
/** DQ-1036 (ADR-438 b): a phone shows 6 makes (3 rows of 2), so the first photograph still reaches its first screen. */
export const TOP_MAKES_PHONE = 6;
/**
 * The wordmark is a brand mark in a fixed tile: it grows with the font scale up to the pill cap (1.3), like the numerals; the count
 * below it keeps scaling. At 200 % a wordmark of "Lamborghini" would no longer fit a phone's column on one line.
 */
const WORDMARK_SCALE_CAP = fontScaleCap.pill;
/** Lines of the wordmark: two at most, broken after a space or a hyphen ("Alfa / Romeo", "Mercedes- / Benz"; ADR-436). */
const WORDMARK_LINES = typeScale.displayWordmark.maxLines;

/**
 * Measurement sample for the skeleton, which has no makes yet: the widest name of the catalogue's common makes, so the skeleton takes
 * the column count the tiles will usually take. It is never shown.
 */
const SAMPLE_MAKE = 'Lamborghini'; // i18n-ignore

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  list: { gap: GAP },
  // 09 §5 BrandTile: the make as a text wordmark on surface-1, radius 12. No manufacturer marks (§4.6).
  tile: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[4],
    justifyContent: 'flex-end',
    minHeight: t.size.row.withThumb,
    padding: PADDING,
  },
  // One column: wordmark on the start edge, the count on the end edge, wrapping under the name where both do not fit.
  tileRow: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', minHeight: t.size.row.single },
  rowName: { flexShrink: 1, minWidth: 0 },
  hover: { backgroundColor: t.color.bg.raised },
  // Tiles of one row share the height of the tallest, as "Alfa Romeo" may take two lines.
  cell: { flexDirection: 'column' },
  fill: { flexGrow: 1 },
  sample: { gap: t.space[8] },
  sampleBadge: { alignSelf: 'flex-start' },
}));

/** The wordmark's drawn scale: the font scale, capped (`WORDMARK_SCALE_CAP`), never below 1 for the estimate. */
export function wordmarkScale(fontScale: number): number {
  return Math.min(Math.max(1, fontScale), WORDMARK_SCALE_CAP);
}

function tileWidth(width: number, columns: number): number {
  return width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;
}

/** The widest part of the names as the wordmark draws it: a make breaks after a space or a hyphen, never inside a word. */
export function widestWordmarkWord(names: readonly string[], scale: number): number {
  let widest = 0;
  for (const name of names) {
    for (const word of name.split(/ +|(?<=-)/)) widest = Math.max(widest, estimatedTitleWidth(word, typography.displayWordmark.fontSize * scale));
  }
  return Math.ceil(widest);
}

/**
 * DQ-186 / BUG-5 class: the most columns in which the widest wordmark word fits its tile beside the padding, so a make never breaks
 * inside a word; 1 is the list of full-width rows. Decided before the first paint from the column width and the shipped font's
 * advances (ADR-425's estimate, never narrower than the screen draws), so nothing is measured and nothing renders twice.
 */
export function columnsFor(width: number, widestWord: number): number {
  if (width <= 0) return COLUMN_STEPS[0];
  for (const columns of COLUMN_STEPS) if (tileWidth(width, columns) - 2 * PADDING >= widestWord) return columns;
  return 1;
}

type TileProps = { make: MakeTile; row: boolean; scale: number; onOpen: (make: MakeTile) => void; testID: string };

const Tile = memo(function Tile({ make, row, scale, onOpen, testID }: TileProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const format = useFormat();
  const count = t('makes.count', { count: make.vehicle_count, formatted: format.number(make.vehicle_count) });
  return (
    <PressableScale
      // Draws its own pressed fill from state.pressed: no second tone layer (SM7).
      toneShift={false}
      role="link"
      aria-label={isWeb ? undefined : joinLabel([make.name, count])}
      onPress={() => onOpen(make)}
      style={styles.fill}
      contentStyle={(state) => [styles.tile, row ? styles.tileRow : null, state.hovered || state.pressed ? styles.hover : null]}
      testID={testID}
    >
      <Text
        variant="displayWordmark"
        fontScaleCap={WORDMARK_SCALE_CAP}
        hyphenate={false}
        numberOfLines={WORDMARK_LINES}
        style={row ? styles.rowName : null}
        testID={`${testID}.name`}
      >
        {make.name}
      </Text>
      <Text variant="caption" color="text.tertiary" numeric>
        {count}
      </Text>
    </PressableScale>
  );
});

export type MakeTilesProps = {
  makes: readonly MakeTile[];
  /** The column's inner width: the grid decides its columns from it before it is drawn. */
  width: number;
  onOpen: (make: MakeTile) => void;
  /** `<ROUTE-ID>.makes`; each tile adds `.<slug>`. */
  testID: string;
};

/** 09 §7.5 "Marken": BrandTiles (text wordmarks in Archivo SemiExpanded, no marks), the make and its real count of builds. */
export function MakeTiles({ makes, width, onOpen, testID }: MakeTilesProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const scale = wordmarkScale(fontScale);
  const columns = useMemo(() => columnsFor(width, widestWordmarkWord(makes.map((make) => make.name), scale)), [makes, scale, width]);
  const tile = columns > 1 ? tileWidth(width, columns) : 0;
  return (
    <View role="list" style={columns > 1 ? styles.grid : styles.list} testID={testID}>
      {makes.map((make) => (
        <View key={make.id} role="listitem" style={[styles.cell, tile > 0 ? { width: tile } : null]}>
          <Tile make={make} row={columns === 1} scale={scale} onOpen={onOpen} testID={`${testID}.${make.slug}`} />
        </View>
      ))}
    </View>
  );
}

/** The same grid while the tiles load: the top makes' tiles at the columns the common makes take. */
export function MakeTilesSkeleton({ width, count = TOP_MAKES, testID }: { width: number; count?: number; testID: string }) {
  const styles = useStyles();
  const theme = useTheme();
  const scale = wordmarkScale(theme.fontScale);
  const columns = columnsFor(width, widestWordmarkWord([SAMPLE_MAKE], scale));
  const tile = columns > 1 ? tileWidth(width, columns) : 0;
  // The loaded tile: a one-line wordmark and the count, inside the padding, never under the tile's minimum.
  const wordmark = typography.displayWordmark.lineHeight * scale;
  const height =
    columns > 1
      ? Math.max(theme.size.row.withThumb, 2 * PADDING + wordmark + space[4] + theme.typography.caption.lineHeight * theme.fontScale)
      : Math.max(theme.size.row.single, 2 * PADDING + wordmark);
  return (
    <Skeleton testID={testID}>
      <View style={columns > 1 ? styles.grid : styles.list}>
        {Array.from({ length: columns > 1 ? count - (count % columns) : count }, (_, index) => (
          <SkeletonBlock key={index} width={tile > 0 ? tile : '100%'} height={height} corner="md" />
        ))}
      </View>
    </Skeleton>
  );
}

/** The empty state's preview (09 §4.9 "never empty"): three BrandTiles as they will look, badged "Beispiel", without counts. */
const SAMPLE_PREVIEW = ['BMW', 'Porsche', 'Nissan'] as const; // i18n-ignore (make names are the same in every language)

export function MakeTilesSample({ width, testID }: { width: number; testID: string }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const scale = wordmarkScale(fontScale);
  const columns = Math.min(SAMPLE_PREVIEW.length, columnsFor(width, widestWordmarkWord(SAMPLE_PREVIEW, scale)));
  const tile = columns > 1 ? tileWidth(width, columns) : 0;
  return (
    <View aria-hidden style={styles.sample} testID={testID}>
      <SampleBadge style={styles.sampleBadge} testID={`${testID}.badge`} />
      <View style={columns > 1 ? styles.grid : styles.list}>
        {SAMPLE_PREVIEW.slice(0, columns > 1 ? columns : 2).map((name) => (
          <View key={name} style={[styles.tile, columns > 1 ? { width: tile } : styles.tileRow]}>
            <Text variant="displayWordmark" fontScaleCap={WORDMARK_SCALE_CAP} hyphenate={false} color="text.secondary">
              {name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
