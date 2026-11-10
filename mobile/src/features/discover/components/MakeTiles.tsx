import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import type { MakeTile } from '@/api/queries/discover';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { PressableScale, Skeleton, SkeletonBlock, Text } from '@/ui';
import { longestWord } from '@/ui/ListRow';
import { joinLabel } from '@/ui/rowParts';

const GAP = space[12];
/** The tile's side padding. */
const PADDING = space[12];
/** FS-11: three columns where every make's longest word fits a tile, then two, then one row per make. */
const COLUMN_STEPS = [3, 2] as const;
/** The skeleton's tiles: as many as the catalogue's common makes with builds, so the next section starts where it will (DQ-327). */
const SKELETON_TILES = 10;
/**
 * Measurement sample for the skeleton, which has no makes yet: the widest name of the catalogue's common makes, kept whole as
 * the tiles keep it, so the skeleton takes the column count the tiles will take (DQ-327). It is never shown.
 */
const SAMPLE_MAKE = keepNameTogether('Mercedes-Benz'); // i18n-ignore

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  list: { gap: GAP },
  tile: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[2],
    justifyContent: 'center',
    minHeight: t.size.row.single,
    paddingHorizontal: PADDING,
    paddingVertical: t.space[8],
  },
  // One column: name on the start edge, the count on the end edge, wrapping under the name where both do not fit.
  tileRow: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  rowName: { flexShrink: 1, minWidth: 0 },
  hover: { backgroundColor: t.color.bg.raised },
  // Tiles of one row share the height of the tallest, as a make like "Alfa Romeo" wraps at its space.
  cell: { flexDirection: 'column' },
  fill: { flexGrow: 1 },
  // Measures the longest words on one line each. Invisible, and out of the layout and the accessibility tree.
  measure: { alignItems: 'flex-start', left: 0, opacity: 0, pointerEvents: 'none', position: 'absolute', top: 0 },
}));

function tileWidth(width: number, columns: number): number {
  return width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;
}

/**
 * DQ-186: the most columns in which the widest word of any make fits its tile beside the padding, so a name never breaks
 * inside the word at any font scale; 1 is the list of full-width rows. Until both are measured, three.
 */
export function columnsFor(width: number, widestWord: number): number {
  if (width <= 0 || widestWord <= 0) return COLUMN_STEPS[0];
  for (const columns of COLUMN_STEPS) if (tileWidth(width, columns) - 2 * PADDING >= widestWord) return columns;
  return 1;
}

/** The widest of the given words in label.s at the current scale, measured off screen. */
function useWidestWord() {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const measured = useCallback(
    (word: string) => (event: LayoutChangeEvent) => {
      const next = Math.ceil(event.nativeEvent.layout.width);
      setWidths((current) => (current[word] === next ? current : { ...current, [word]: next }));
    },
    [],
  );
  return { widths, measured };
}

function Measure({ words, measured }: { words: readonly string[]; measured: (word: string) => (event: LayoutChangeEvent) => void }) {
  const styles = useStyles();
  return (
    <View aria-hidden style={styles.measure}>
      {words.map((word) => (
        <Text key={word} variant="labelS" hyphenate={false} selectable={false} onLayout={measured(word)}>
          {word}
        </Text>
      ))}
    </View>
  );
}

type TileProps = { make: MakeTile; row: boolean; onOpen: (make: MakeTile) => void; testID: string };

const Tile = memo(function Tile({ make, row, onOpen, testID }: TileProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const format = useFormat();
  const count = t('makes.count', { count: make.vehicle_count, formatted: format.number(make.vehicle_count) });
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([make.name, count])}
      onPress={() => onOpen(make)}
      style={styles.fill}
      contentStyle={(state) => [styles.tile, row ? styles.tileRow : null, state.hovered || state.pressed ? styles.hover : null]}
      testID={testID}
    >
      <Text variant="labelS" hyphenate={false} style={row ? styles.rowName : null} testID={`${testID}.name`}>
        {keepNameTogether(make.name)}
      </Text>
      <Text variant="caption" color="text.tertiary">
        {count}
      </Text>
    </PressableScale>
  );
});

export type MakeTilesProps = {
  makes: readonly MakeTile[];
  onOpen: (make: MakeTile) => void;
  /** `<ROUTE-ID>.makes`; each tile adds `.<slug>`. */
  testID: string;
};

/** FS-11 "Marken": text tiles (no manufacturer marks, §6), 56 high, radius 12, the make and its real count of builds. */
export function MakeTiles({ makes, onOpen, testID }: MakeTilesProps) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const { widths, measured } = useWidestWord();
  const words = [...new Set(makes.map((make) => longestWord(keepNameTogether(make.name))))];
  const widest = words.every((word) => widths[word] !== undefined) ? Math.max(0, ...words.map((word) => widths[word] ?? 0)) : 0;
  const columns = columnsFor(width, widest);
  const tile = columns > 1 ? tileWidth(width, columns) : 0;
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View role="list" style={columns > 1 ? styles.grid : styles.list} testID={testID}>
        {makes.map((make) => (
          <View key={make.id} role="listitem" style={[styles.cell, tile > 0 ? { width: tile } : null]}>
            <Tile make={make} row={columns === 1} onOpen={onOpen} testID={`${testID}.${make.slug}`} />
          </View>
        ))}
      </View>
      <Measure words={words} measured={measured} />
    </View>
  );
}

/** The same grid while the tiles load. */
export function MakeTilesSkeleton({ testID }: { testID: string }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const { widths, measured } = useWidestWord();
  const columns = columnsFor(width, widths[SAMPLE_MAKE] ?? 0);
  const tile = columns > 1 ? tileWidth(width, columns) : 0;
  return (
    <Skeleton testID={testID}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={columns > 1 ? styles.grid : styles.list}>
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <SkeletonBlock key={index} width={tile > 0 ? tile : '100%'} height={size.row.single} corner="md" />
          ))}
        </View>
        <Measure words={[SAMPLE_MAKE]} measured={measured} />
      </View>
    </Skeleton>
  );
}
