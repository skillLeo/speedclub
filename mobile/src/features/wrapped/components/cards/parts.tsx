import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { WrappedPhoto } from '@/api/queries/wrapped';
import { createStyles, fontScaleCap, ThemeScope, useTheme } from '@/theme';
import { Badge } from '@/ui/Badge';
import { Photo } from '@/ui/Photo';
import { Text } from '@/ui/Text';

/**
 * DQ-P5G-04: a story card is a fixed 9:16 composition, exported as a 1080 × 1920 picture, so its type grows with the system font only
 * up to the cap of a label in a fixed frame (`fontScaleCap.pill`, 1.3, the numerals' role cap). Past it the card keeps its layout:
 * nothing is cut, the QR stays whole. The player's controls around the card still follow the full font scale.
 */
export const CARD_FONT_SCALE_CAP = fontScaleCap.pill;

/**
 * ADR-518 c: the card's root (a 9:16 box) tells the DOM audit to read its type at min(font scale, 1.3), the story-card cap above.
 * Web only (native ignores dataSet); the clip and mid-word checks stay as they are.
 */
export const STORY_CARD_DATASET = { qaExempt: 'story-card' } as const;

const useStyles = createStyles((t) => ({
  // ADR-421 b: dark in every theme; the text in the on-photo tones, the card is a picture to share.
  // The card is one tonal step above the black stage, so it reads as a card on screen and fills the exported image edge to edge.
  frame: { backgroundColor: t.color.bg.surface, gap: t.space[24], overflow: 'hidden', padding: t.space[24] },
  top: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], justifyContent: 'space-between', minHeight: t.size.statusPill },
  scroll: { flex: 1, minHeight: 0 },
  // With a full-bleed lead (the intro, DQ-P5G-58) the words take what they need and the lead takes the rest.
  scrollHugs: { flexBasis: 'auto', flexGrow: 0, flexShrink: 1 },
  // Edge to edge: the frame's padding given back on both sides; the frame's overflow cuts it at the card's edges.
  lead: { flexGrow: 1, flexShrink: 1, gap: t.space[16], marginHorizontal: -t.space[24], minHeight: t.size.touchMin * 2 },
  body: { flexGrow: 1, gap: t.space[16], justifyContent: 'center' },
  footer: { flexShrink: 0 },
  numeralRow: { alignItems: 'flex-end', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  unit: { paddingBottom: t.space[8] },
  // ADR-516 a: the member's own car, inset radius 8 like the share card's photo. The slot takes what the card leaves after its words
  // and crops the photo around its focal point; with the words at their capped size it never takes less than this floor.
  photo: { borderRadius: t.radius.sm, flexGrow: 1, flexShrink: 1, minHeight: t.size.touchMin * 2, overflow: 'hidden' },
  photoFill: { left: 0, position: 'absolute', right: 0 },
}));

export type CardFrameProps = {
  width: number;
  height: number;
  /** The data label over the card ("GESPOTTET"); the season on the intro and the share card. */
  eyebrow: string | null;
  sample: boolean;
  children: ReactNode;
  /** Distributes the body: `center` (default) or `between` (the share card's photo grows). */
  bodyStyle?: StyleProp<ViewStyle>;
  /** Pinned under the body, never scrolled away (the share card's QR row). */
  footer?: ReactNode;
  /**
   * Full-bleed lead between the top row and the body (the intro's photo, DQ-P5G-58): it runs to the card's edges, takes the room
   * the words leave and never scrolls; the body then hugs its words.
   */
  lead?: ReactNode;
  testID: string;
};

/**
 * The card's frame: the data label and the "Beispiel" badge on top, the body in the middle, an optional pinned footer. The view-shot
 * target. A card is a 9:16 picture, so its type stops growing at `CARD_FONT_SCALE_CAP` (DQ-P5G-04): the frame lays its subtree out at
 * the capped font scale (web and every scale-aware part), and each text on it takes the same cap on native. Should the words still
 * not fit, the body scrolls inside the frame instead of being cut; the footer never scrolls.
 */
export const CardFrame = forwardRef<ComponentRef<typeof View>, CardFrameProps>(function CardFrame(
  { width, height, eyebrow, sample, children, bodyStyle, footer, lead, testID },
  ref,
) {
  const theme = useTheme();
  return (
    <ThemeScope name={theme.name} fontScaleCap={CARD_FONT_SCALE_CAP}>
      <FrameBody ref={ref} width={width} height={height} eyebrow={eyebrow} sample={sample} bodyStyle={bodyStyle} footer={footer} lead={lead} testID={testID}>
        {children}
      </FrameBody>
    </ThemeScope>
  );
});

const FrameBody = forwardRef<ComponentRef<typeof View>, CardFrameProps>(function FrameBody(
  { width, height, eyebrow, sample, children, bodyStyle, footer, lead, testID },
  ref,
) {
  const styles = useStyles();
  return (
    <View ref={ref} collapsable={false} dataSet={STORY_CARD_DATASET} style={[styles.frame, { width, height }]} testID={testID}>
      <View style={styles.top}>
        {eyebrow ? (
          <Text variant="labelCaps" color="onPhoto.secondary" hyphenate={false} desktopSize={false} fontScaleCap={CARD_FONT_SCALE_CAP} testID={`${testID}.eyebrow`}>
            {eyebrow}
          </Text>
        ) : (
          <View />
        )}
        {sample ? <Badge kind="sample" tone="onPhoto" testID={`${testID}.sample`} /> : null}
      </View>
      {lead ? (
        <View style={styles.lead} testID={`${testID}.lead`}>
          {lead}
        </View>
      ) : null}
      <ScrollView style={[styles.scroll, lead ? styles.scrollHugs : null]} contentContainerStyle={[styles.body, bodyStyle]} showsVerticalScrollIndicator={false} testID={`${testID}.body`}>
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
});

/** The share card's photo ratio: the cover is cropped from a 4:5 picture (09 §4.6 hero crop). */
const PHOTO_RATIO = 4 / 5;

/**
 * ADR-516 a: a photo of the member's own car on a card (intro, score, Build Spirit, share). The slot grows into what the card leaves
 * and crops the 4:5 picture around its focal point (so a wide slot keeps the car, not the sky), inset radius 8, no text on it: the
 * words stand on the card's dark ground below, in the on-photo tones.
 */
export function CardPhoto({ photo, label, width, style, testID }: { photo: WrappedPhoto; label: string; width: number; style?: StyleProp<ViewStyle>; testID: string }) {
  const styles = useStyles();
  const [slot, setSlot] = useState(0);
  const photoHeight = width / PHOTO_RATIO;
  const focalY = photo.focal?.y ?? 0.5;
  // The focal point in the middle of the slot, without showing past the picture's edges.
  const top = slot > 0 ? Math.min(0, Math.max(slot - photoHeight, slot / 2 - focalY * photoHeight)) : 0;
  const onLayout = (event: LayoutChangeEvent) => setSlot(event.nativeEvent.layout.height);
  return (
    <View style={[styles.photo, style]} onLayout={onLayout} testID={testID}>
      <View style={[styles.photoFill, { top }]}>
        <Photo source={photo.source} blurhash={photo.blurhash} thumbhash={photo.thumbhash} focal={photo.focal} aspect="4:5" corner="none" label={label} testID={`${testID}.image`} />
      </View>
    </View>
  );
}

/** A hero numeral with its unit beside it (09 §4.2: tabular, label.unit next to the number). */
export function Numeral({ value, unit, small = false, testID }: { value: string; unit?: string; small?: boolean; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.numeralRow} testID={testID}>
      <Text variant={small ? 'heroNumeralS' : 'heroNumeral'} color="onPhoto.primary" hyphenate={false} desktopSize={false} fontScaleCap={CARD_FONT_SCALE_CAP}>
        {value}
      </Text>
      {unit ? (
        <Text variant="labelUnit" color="onPhoto.secondary" hyphenate={false} desktopSize={false} fontScaleCap={CARD_FONT_SCALE_CAP} style={styles.unit}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

/** A running line on the card: body or callout in the on-photo tones. */
export function CardLine({
  children,
  variant = 'body',
  tone = 'primary',
  numeric = false,
  testID,
}: {
  children: string;
  variant?: 'body' | 'callout' | 'caption' | 'headline' | 'title2';
  tone?: 'primary' | 'secondary';
  numeric?: boolean;
  testID?: string;
}) {
  return (
    <Text
      variant={variant}
      color={tone === 'primary' ? 'onPhoto.primary' : 'onPhoto.secondary'}
      numeric={numeric}
      desktopSize={false}
      fontScaleCap={CARD_FONT_SCALE_CAP}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** "Düsseldorf, Köln und Essen": a list as a sentence says it, in the app's language. */
export function useListText(): (items: readonly string[]) => string {
  const { t } = useTranslation('profile');
  return (items) => {
    if (items.length <= 1) return items[0] ?? '';
    return t('wrapped.list', { items: items.slice(0, -1).join(', '), last: items[items.length - 1] });
  };
}
