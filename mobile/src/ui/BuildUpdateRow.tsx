import { useState } from 'react';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, size, space, useTheme } from '@/theme';

import { Icon, type IconName } from './icons/Icon';
import { Photo, type PhotoFields } from './Photo';
import { joinLabel, RowBody, RowDivider, useRowInset, useStacksAtFontScale, type RowInset } from './rowParts';
import { estimateLines, SkeletonBlock, SkeletonText } from './Skeleton';
import { Text } from './Text';
import { diffSegments, handleText, metaLineText } from './textBreaks';
import { ValueText } from './ValueText';

export type BuildUpdateRowProps = {
  /** "Fahrwerk geändert" */
  title: string;
  /** "Serie → KW V3 · −35 mm" */
  diff?: string;
  /**
   * "@jann.ptrs · vor 2 Std." or "BMW M4 Competition · @jann.ptrs · vor 2 Std.", cut by "·". It wraps at the "·" first; a short part
   * stays whole (DQ-061), a car name wraps at its spaces (DQ-291, `metaLineText`) and a handle stays whole (DQ-433, `updateMetaText`).
   */
  meta?: string;
  photo: PhotoFields;
  /**
   * DQ-1093: the system's glyph on a quiet tile, instead of the photo's empty frame, when the update has no photo of its own and
   * the list does not repeat the car's cover.
   */
  glyph?: IconName;
  onPress?: () => void;
  /** The hairline to the next row, inset to the text start. */
  divider?: boolean;
  inset?: RowInset;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const useStyles = createStyles((t) => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.withThumb,
    paddingVertical: t.space[12],
  },
  thumb: { alignSelf: 'center', flexShrink: 0, width: t.size.thumb.row },
  glyphTile: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.sm,
    flexShrink: 0,
    height: t.size.thumb.row,
    justifyContent: 'center',
    width: t.size.thumb.row,
  },
  text: { flex: 1, minWidth: 0 },
}));

/** A username has at most 24 characters (AUTH). At font scale 1 every handle fits a phone row's meta line whole. */
const HANDLE_WHOLE_CHARS = 24;
const HANDLE_PART = /^@\S+$/;

/**
 * DQ-433: the meta line of an update ("BMW M3 E46 · @marco.amg · vor 2 Std.") as `metaLineText` makes it, but a handle stays whole and
 * moves to the next line with the date after it, instead of splitting at its "." ("@marco." / "amg"). It may still break after its
 * "." or "_" when it alone would be wider than the line: more than 24 characters at the font scale (12 at twice the size).
 */
export function updateMetaText(meta: string, fontScale: number): string {
  let text = metaLineText(meta);
  for (const part of meta.split(' · ')) {
    if (HANDLE_PART.test(part) && (part.length - 1) * Math.max(1, fontScale) <= HANDLE_WHOLE_CHARS) {
      text = text.replace(handleText(part), part);
    }
  }
  return text;
}

/** Typical lengths of the three texts ("Fahrwerk geändert", "Serie → KW V3 · −35 mm", "@jann.ptrs · vor 2 Std."). */
const TYPICAL_CHARS = { title: 17, diff: 22, meta: 23 } as const;

/**
 * The loading state of the row, from the same styles and type variants, so a list does not jump when it arrives. Each
 * block takes the lines a typical text takes at the measured width, so a phone at a large font wraps and a desktop does
 * not. Put it inside a `Skeleton`, which owns the delay, the shimmer and the name for screen readers.
 */
export function BuildUpdateRowSkeleton({
  divider = true,
  inset,
  testID,
}: Pick<BuildUpdateRowProps, 'divider' | 'inset' | 'testID'>) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const { fontScale } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  // Until the first layout: a row across the window. The skeleton is still invisible then.
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? windowWidth - 2 * side - size.thumb.row - space[12];
  const lines = (chars: number, variant: 'bodyStrong' | 'callout' | 'caption') =>
    estimateLines(chars, variant, fontScale, width);
  return (
    <View testID={testID}>
      <View style={[styles.row, { paddingLeft: side, paddingRight: side }]} testID={testID ? `${testID}.row` : undefined}>
        <SkeletonBlock width={size.thumb.row} height={size.thumb.row} corner="sm" />
        <View
          style={styles.text}
          onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
          testID={testID ? `${testID}.text` : undefined}
        >
          <SkeletonText variant="bodyStrong" width="60%" lines={lines(TYPICAL_CHARS.title, 'bodyStrong')} />
          <SkeletonText variant="callout" width="80%" lines={lines(TYPICAL_CHARS.diff, 'callout')} />
          <SkeletonText variant="caption" width="40%" lines={lines(TYPICAL_CHARS.meta, 'caption')} />
        </View>
      </View>
      {divider ? <RowDivider inset={side} lead={size.thumb.row + space[12]} /> : null}
    </View>
  );
}

/** §8 build-update row: 56 thumb radius 8, `body.strong` title, diff with tabular figures in its numeric segments, tertiary meta. */
export function BuildUpdateRow({ title, diff, meta, photo, glyph, onPress, divider = true, inset, style, testID }: BuildUpdateRowProps) {
  const styles = useStyles();
  const side = useRowInset(inset);
  const largeFont = useStacksAtFontScale();
  const { fontScale } = useTheme();
  return (
    <View testID={testID} style={style}>
      <RowBody
        onPress={onPress}
        label={joinLabel([title, diff, meta])}
        style={[styles.row, { paddingLeft: side, paddingRight: side }]}
        testID={testID ? `${testID}.body` : undefined}
      >
        {({ pressed }) => (
          <>
            {glyph && !photo.source ? (
              <View aria-hidden style={styles.glyphTile} testID={testID ? `${testID}.glyph` : undefined}>
                <Icon name={glyph} size={24} color="text.secondary" />
              </View>
            ) : (
              <Photo {...photo} aspect="1:1" corner="sm" style={styles.thumb} testID={testID ? `${testID}.thumb` : undefined} />
            )}
            <View style={styles.text}>
              <Text variant="bodyStrong">{title}</Text>
              {diff ? (
                // DQ-313: the "·"-first rule of the meta line, with before and after held together around "→".
                <ValueText variant="callout" color="text.secondary" hyphenate={largeFont} values={diff} segments={diffSegments(diff, !largeFont)} />
              ) : null}
              {meta ? (
                // The pressed background leaves tertiary just under 4.5:1 on a raised surface in carbon.
                // DQ-061, DQ-291: short values stay whole ("vor 2 Std."), a car name wraps at its spaces, the line at its "·" first.
                <Text variant="caption" color={pressed ? 'text.secondary' : 'text.tertiary'} hyphenate={false}>
                  {updateMetaText(meta, fontScale)}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </RowBody>
      {divider ? <RowDivider inset={side} lead={size.thumb.row + space[12]} /> : null}
    </View>
  );
}
