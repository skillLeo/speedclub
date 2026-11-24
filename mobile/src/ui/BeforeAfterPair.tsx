import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, type ColorToken } from '@/theme';

import { Photo, type PhotoAspect, type PhotoFields } from './Photo';
import { Text } from './Text';

export type BeforeAfterPairProps = {
  before: PhotoFields & { label: string; alt?: string };
  after: PhotoFields & { label: string; alt?: string };
  /** 4:5 by default: the two halves of a column stand like two rail photos. */
  aspect?: PhotoAspect;
  /** "Vorher/Nachher: KW V3" under the pair. */
  caption?: string;
  /** On the Journey card's dark stage the caption is `onPhoto.secondary`. */
  captionColor?: ColorToken;
  /** The row's corners: radius 8 as inset media (DQ-968); `xs` inside a card whose padding leaves less (concentric, 09 §4.3). */
  corner?: 'xs' | 'sm';
  /** The pair's name for screen readers: "Vorher / Nachher-Vergleich". */
  label: string;
  style?: StyleProp<ViewStyle>;
  /** Sub-testIDs: `.before`, `.after`, `.caption`. */
  testID?: string;
};

const useStyles = createStyles((t) => ({
  // DQ-968: inset media are radius 8; the pair is one inset piece, 2 apart like a result wall.
  row: { borderRadius: t.radius.sm, flexDirection: 'row', gap: t.space[2], overflow: 'hidden' },
  rowXs: { borderRadius: t.radius.xs },
  half: { flex: 1, minWidth: 0 },
  // The on-photo badge of the cards (neutral ground, label.badge), on the photo's top-left corner.
  badge: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    left: t.space[8],
    minHeight: t.size.statusPill,
    justifyContent: 'center',
    paddingHorizontal: t.space[8],
    position: 'absolute',
    top: t.space[8],
  },
  caption: { marginTop: t.space[8] },
}));

/**
 * M5.9c Build Journey: a before/after pair side by side (contract §2: Verlauf, the owner's history and the Journey card), each half
 * with its "Vorher" / "Nachher" badge on the photo, the optional mod under the pair. VEH-05 keeps the SM17 slider (`BeforeAfter`)
 * for the close look; a list shows both at once.
 */
export function BeforeAfterPair({ before, after, aspect = '4:5', caption, captionColor = 'text.secondary', corner = 'sm', label, style, testID }: BeforeAfterPairProps) {
  const styles = useStyles();
  const id = (part: string) => (testID ? `${testID}.${part}` : undefined);
  const half = (photo: BeforeAfterPairProps['before'], part: 'before' | 'after') => (
    <View style={styles.half}>
      <Photo
        source={photo.source}
        blurhash={photo.blurhash}
        thumbhash={photo.thumbhash}
        focal={photo.focal}
        aspect={aspect}
        corner="none"
        label={photo.alt ? `${photo.label}: ${photo.alt}` : photo.label}
        testID={id(part)}
      >
        <View style={styles.badge} aria-hidden>
          <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false}>
            {photo.label}
          </Text>
        </View>
      </Photo>
    </View>
  );
  return (
    <View role="group" aria-label={label} style={style} testID={testID}>
      <View style={[styles.row, corner === 'xs' ? styles.rowXs : null]}>
        {half(before, 'before')}
        {half(after, 'after')}
      </View>
      {caption ? (
        <Text variant="caption" color={captionColor} style={styles.caption} testID={id('caption')}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
