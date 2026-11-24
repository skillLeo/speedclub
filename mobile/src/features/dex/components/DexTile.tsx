import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type TextStyle } from 'react-native';

import type { Rarity, SpotCardLite, SetSilhouette } from '@/api/queries/dex';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { aspect, concentric, createStyles, fontScaleCap, size, space, typeScale, typography, useTheme } from '@/theme';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { PhotoStageScrim, PhotoTopScrim } from '@/ui/PhotoStageScrim';
import { PressableScale } from '@/ui/PressableScale';
import { SkeletonBlock, SkeletonText, SkeletonSurfaceContext } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { ratioOf } from '@/ui/Photo';
import { estimatedTitleLines, estimatedTitleWidth } from '@/ui/displayTitleLayout';
import { vehicleTitleText } from '@/ui/textBreaks';

import { dexNumberText } from '../copy';
import { coverPhoto, rarityOf } from './SpotCardFace';

/** 09 §5 grid media: 4:5 into the dark stage, as the DEX-03 card it stands for. */
export const TILE_PHOTO = aspect.gridTall;

const useStyles = createStyles((t) => ({
  // ADR-421 b: a card is a photo on the dark stage in every theme, so the whole tile is that stage with onPhoto text. The stage's
  // own 2-wide rim runs round every tile, so the rarity frames below always sit on the dark stage, on Hell too (DQ-P5G-11).
  frame: {
    backgroundColor: t.color.scrim.photoEnd,
    borderColor: t.color.scrim.photoEnd,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.focusRing,
    flexGrow: 1,
    overflow: 'hidden',
  },
  frameHost: { flexGrow: 1 },
  // The rarity frames inside the rim, monochrome (red stays for the one action): Tuned a hairline, Rare a 2 outline, Legend a 2
  // white outline, Ghost the 2 outline with an inner hairline frame (as DEX-03's card).
  ring: {
    borderRadius: concentric(t.radius.md, t.size.border.focusRing),
    bottom: 0,
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  tuned: { borderColor: t.color.onPhoto.border, borderWidth: t.size.border.control },
  rare: { borderColor: t.color.onPhoto.border, borderWidth: t.size.border.focusRing },
  legend: { borderColor: t.color.onPhoto.primary, borderWidth: t.size.border.focusRing },
  ghost: { borderColor: t.color.onPhoto.border, borderWidth: t.size.border.focusRing },
  ghostInner: {
    borderColor: t.color.onPhoto.border,
    borderRadius: concentric(t.radius.md, t.size.border.focusRing + t.space[4]),
    borderWidth: t.size.border.control,
    bottom: t.space[4],
    left: t.space[4],
    pointerEvents: 'none',
    position: 'absolute',
    right: t.space[4],
    top: t.space[4],
  },
  topRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.space[4],
    justifyContent: 'space-between',
    left: t.space[8],
    position: 'absolute',
    right: t.space[8],
    top: t.space[8],
  },
  tag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  body: { flexGrow: 1, gap: t.space[4], padding: t.space[12] },
  // A binder slot (DEX-05, 3 to a phone row): the number alone on the photo, less padding, the rarity as a tag under the name.
  bodyCompact: { padding: t.space[8] },
  topRowCompact: { left: t.space[4], right: t.space[4], top: t.space[4] },
  hover: { backgroundColor: t.color.state.hover, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  // The "???" slot (DQ-P5G-08): the stage with a hairline frame, the mark in a short 4:3 band, so open slots stay quieter than the
  // cards a member owns.
  silhouette: { borderColor: t.color.onPhoto.border, borderWidth: t.size.border.control },
  mark: { alignItems: 'center', aspectRatio: ratioOf(aspect.card), justifyContent: 'center', width: '100%' },
  // "+4 offen": the slot that stands for the rest of a count rule (DEX-05).
  remaining: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: t.space[8] },
  // The skeleton keeps the rim's width (as `frame`'s border) so the photo and the body sit where a card puts them.
  skeletonFrame: { borderRadius: t.radius.md, overflow: 'hidden', padding: t.size.border.focusRing },
  skeletonFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  skeletonPhoto: { aspectRatio: ratioOf(TILE_PHOTO), width: '100%' },
}));

/** A tag on the photo or the stage: label.badge on the photo chip ground (ADR-421 b). */
function Tag({ label, testID }: { label: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tag} testID={testID}>
      <Text variant="labelBadge" color="onPhoto.primary" numeric hyphenate={false} fontScaleCap={fontScaleCap.pill}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The tile's two lines: the make as a quiet caption over the rest of the name in the wordmark ("Nissan" / "Skyline GT-R R34"), so a
 * full car name stays within the wordmark's two lines in a half-column tile, at 200 % too. A name that does not start with its make
 * stays whole.
 */
export function splitName(name: string, make: string | null | undefined): { make: string | null; rest: string } {
  const trimmed = name.trim();
  if (make && trimmed.toLowerCase().startsWith(`${make.toLowerCase()} `)) return { make, rest: trimmed.slice(make.length).trim() };
  return { make: null, rest: trimmed };
}

function ringStyle(styles: ReturnType<typeof useStyles>, tier: Rarity) {
  return tier === 'street' ? null : [styles.ring, styles[tier]];
}

export type TileNameSize = 'full' | 'shrunk';

/**
 * ADR-515 (ADR-426 a for the tile's car name): `display.wordmark` at its full size while the name takes at most 2 lines there, else
 * its shrink pair (`minSize`/`minLineHeight`, 14/18, scaled like the role) with as many lines as it needs: a name is never truncated
 * and never set off the type scale. Decided before the first paint from the tile's width (ADR-425's estimate, never narrower than the
 * screen draws), at the scale the role is drawn at (the font scale, capped). Without a width yet (the grid before its first
 * layout) the full size.
 */
export function tileNameSize(name: string, textWidth: number, fontScale: number): TileNameSize {
  if (!(textWidth > 0)) return 'full';
  const fit = estimatedTitleLines(name, typography.displayWordmark.fontSize * wordmarkScale(fontScale), textWidth);
  return !fit.overflow && fit.lines <= typeScale.displayWordmark.maxLines ? 'full' : 'shrunk';
}

/**
 * R4DQ-56 (ADR-426 c, ADR-515): the tile's name as a display title sets it: the model letters and hyphens kept together, and a
 * trailing short code bound to the word before it ("Skyline GT-R R34" never ends on "R34" alone) where that pair fits the line
 * at the size the name is drawn. The size is decided on the bound text, so a name the binding pushes past two lines shrinks.
 */
export function tileNameText(rest: string, textWidth: number, fontScale: number): { text: string; size: TileNameSize } {
  const scale = wordmarkScale(fontScale);
  const bindAt = (fontSize: number) => vehicleTitleText(rest, (pair) => textWidth > 0 && estimatedTitleWidth(pair, fontSize) <= textWidth);
  const full = bindAt(typography.displayWordmark.fontSize * scale);
  const size = tileNameSize(full, textWidth, fontScale);
  return size === 'full' ? { text: full, size } : { text: bindAt(typeScale.displayWordmark.minSize * scale), size };
}

/** The scale `display.wordmark` is drawn at: the font scale, capped by the role (1.3). */
export function wordmarkScale(fontScale: number): number {
  return Math.min(fontScale, typeScale.displayWordmark.maxFontScale, fontScaleCap.pill);
}

/** The shrink pair of `display.wordmark` at `scale`, with the role's tracking (as DisplayTitle's shrunkStyle). */
function shrunkNameStyle(scale: number): TextStyle {
  const role = typography.displayWordmark;
  const { minSize, minLineHeight } = typeScale.displayWordmark;
  return { fontSize: minSize * scale, lineHeight: minLineHeight * scale, letterSpacing: (role.letterSpacing / role.fontSize) * minSize * scale };
}

/** The name's line width in a tile `width` wide: the body's padding and the widest rarity frame on both sides. */
export function tileTextWidth(width: number, compact: boolean): number {
  return width - 2 * (compact ? space[8] : space[12]) - 2 * size.border.focusRing;
}

export type DexTileProps = {
  card: SpotCardLite;
  /** The tile's width in the grid, known before its layout: the name's size is decided from it (tileNameFit). */
  width: number;
  /** A bundled photo in place of the cover (the QA set and the "Beispiel" preview). */
  photo?: PhotoFields;
  /** "Beispiel" on the photo: the empty state's preview. */
  sampleLabel?: string;
  /**
   * A binder slot (DEX-05): the number alone on the photo, the name and the rarity as a tag under it (DQ-P5G-68) besides the frame;
   * First Spotter through the accessible name only.
   */
  compact?: boolean;
  onPress?: () => void;
  /** `DEX-01.card.<vehicleId>`: `.photo`, `.number`, `.rarity.<tier>`, `.name`, `.firstSpotter`, `.ghostFrame`. */
  testID: string;
};

/**
 * One card of the Dex grid (DEX-01, DEX-05): the cover 4:5 into the dark stage, the Dex number and the rarity on the photo's top
 * scrim, the name as its wordmark below (cars speak Archivo), the First Spotter mark, and the rarity's frame (Ghost: the double
 * frame). Opens DEX-04.
 */
export const DexTile = memo(function DexTile({ card, width, photo, sampleLabel, compact = false, onPress, testID }: DexTileProps) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { vehicle } = card;
  const tier = rarityOf(vehicle);
  const tierName = t(`rarity.${tier}`);
  const number = dexNumberText(vehicle.dex_number);
  const name = splitName(vehicle.name, vehicle.make);
  const { text: nameText, size: nameSize } = tileNameText(name.rest, tileTextWidth(width, compact), fontScale);
  const label = [
    number ? t('tile.labelNumber', { name: vehicle.name, number, tier: tierName }) : t('tile.label', { name: vehicle.name, tier: tierName }),
    card.first_spotter ? t('tile.firstSpotter') : null,
    sampleLabel ?? null,
  ]
    .filter(Boolean)
    .join(', ');
  const content = (hovered: boolean) => (
    <View style={styles.frame}>
      <Photo
        {...(photo ?? coverPhoto(vehicle.cover))}
        aspect={TILE_PHOTO}
        testID={`${testID}.photo`}
      >
        <PhotoTopScrim />
        <PhotoStageScrim />
        {hovered ? <View style={styles.hover} /> : null}
        <View style={[styles.topRow, compact ? styles.topRowCompact : null]}>
          {number ? <Tag label={t('reveal.dexNumber', { number })} testID={`${testID}.number`} /> : <View />}
          {compact ? null : <Tag label={sampleLabel ?? tierName} testID={sampleLabel ? `${testID}.sample` : `${testID}.rarity.${tier}`} />}
        </View>
      </Photo>
      <View style={[styles.body, compact ? styles.bodyCompact : null]}>
        {name.make ? (
          <Text variant="caption" color="onPhoto.secondary" hyphenate={false} numberOfLines={1} testID={`${testID}.make`}>
            {name.make}
          </Text>
        ) : null}
        <Text
          variant="displayWordmark"
          color="onPhoto.primary"
          fontScaleCap={fontScaleCap.pill}
          hyphenate={false}
          numberOfLines={nameSize === 'full' ? typeScale.displayWordmark.maxLines : undefined}
          style={nameSize === 'shrunk' ? shrunkNameStyle(wordmarkScale(fontScale)) : null}
          testID={`${testID}.name`}
        >
          {nameText}
        </Text>
        {card.first_spotter && !compact ? <Tag label={t('tile.firstSpotter')} testID={`${testID}.firstSpotter`} /> : null}
        {/* DQ-P5G-68: in the 3-up binder the rarity is a word under the name too, never only the frame's tone (09 §4.10). */}
        {compact ? <Tag label={tierName} testID={`${testID}.rarity.${tier}`} /> : null}
      </View>
      {tier === 'street' ? null : <View style={ringStyle(styles, tier)} testID={`${testID}.frame.${tier}`} />}
      {tier === 'ghost' ? <View style={styles.ghostInner} testID={`${testID}.ghostFrame`} /> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View accessible aria-label={label} testID={testID}>
        {content(false)}
      </View>
    );
  }
  return (
    <PressableScale role="link" aria-label={isWeb ? undefined : label} onPress={onPress} ring="card" style={styles.frameHost} testID={testID}>
      {(state) => content(state.hovered)}
    </PressableScale>
  );
});

/** "Honda · EK9": the set rule's hint for an unfound slot, or null when the rule names none. */
export function silhouetteHint(silhouette: SetSilhouette | null): string | null {
  if (!silhouette) return null;
  const parts = [silhouette.make, silhouette.generation].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * An unfound slot of an active set ("???", DQ-P5G-08): a compact box on the stage with a hairline frame, "???" in the numeral face
 * in a short 4:3 band, then the hint as a found card writes its name (the make as a caption over the generation in the wordmark,
 * only when the set names them) and the set below. Never a photo, never a ghost car.
 */
export const SilhouetteTile = memo(function SilhouetteTile({
  silhouette,
  setName,
  compact = false,
  width,
  testID,
}: {
  silhouette: SetSilhouette | null;
  /** A binder slot (DEX-05): less padding, as the compact card beside it. */
  compact?: boolean;
  /** The set this slot belongs to (DEX-01); DEX-05 shows it in the page's head instead. */
  setName?: string;
  /** The slot's width in the grid: the hint takes the wordmark's shrink pair from it, as a card's name (ADR-515). */
  width?: number;
  testID: string;
}) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const hint = silhouetteHint(silhouette);
  const make = silhouette?.make && silhouette.generation ? silhouette.make : null;
  const word = keepNameTogether((make ? silhouette?.generation : hint) ?? t('tile.open'));
  const wordSize = width ? tileNameSize(word, tileTextWidth(width, compact), fontScale) : 'full';
  const label = [hint ? t('tile.silhouetteLabel', { hint }) : t('tile.silhouetteLabelPlain'), setName].filter(Boolean).join(', ');
  return (
    // R4DQ-46: the slot is one image to a screen reader ("Noch offen: …"), its texts hidden; a label needs the role on the web.
    <View style={[styles.frame, styles.silhouette]} accessible role="img" aria-label={label} testID={testID}>
      <View style={styles.mark}>
        <Text variant="heroNumeralS" color="onPhoto.secondary" hyphenate={false} aria-hidden>
          {t('tile.unknown')}
        </Text>
      </View>
      <View style={[styles.body, compact ? styles.bodyCompact : null]}>
        {make ? (
          <Text variant="caption" color="onPhoto.secondary" hyphenate={false} numberOfLines={1} aria-hidden testID={`${testID}.make`}>
            {make}
          </Text>
        ) : null}
        <Text
          variant="displayWordmark"
          color="onPhoto.secondary"
          fontScaleCap={fontScaleCap.pill}
          hyphenate={false}
          numberOfLines={wordSize === 'full' ? typeScale.displayWordmark.maxLines : undefined}
          style={wordSize === 'shrunk' ? shrunkNameStyle(wordmarkScale(fontScale)) : null}
          aria-hidden
          testID={`${testID}.hint`}
        >
          {word}
        </Text>
        {setName ? (
          <Text variant="caption" color="onPhoto.secondary" hyphenate={false} numberOfLines={2} aria-hidden testID={`${testID}.set`}>
            {setName}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

/**
 * DQ-P5G-09: the rest of a count rule ("5 Autos") as one slot, "+4 offen", in place of four identical "???" slots. In the slot's
 * box, never a photo.
 */
export const RemainingTile = memo(function RemainingTile({ count, testID }: { count: number; testID: string }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  return (
    <View style={[styles.frame, styles.silhouette]} accessible aria-label={t('tile.remainingLabel', { count })} testID={testID}>
      <View style={styles.remaining}>
        <Text variant="heroNumeralS" color="onPhoto.secondary" numeric hyphenate={false} aria-hidden>
          {t('tile.remainingCount', { count })}
        </Text>
        <Text variant="caption" color="onPhoto.secondary" hyphenate={false} aria-hidden>
          {t('tile.remaining', { count })}
        </Text>
      </View>
    </View>
  );
});

/**
 * A tile while the Dex loads, in the tile's geometry (DQ-P5G-12, round 2): one framed block of the real tile's height (the rim, the
 * 4:5 photo and the body below it, as a loaded card fades its photo into the stage), with the body's bars inside its lower part —
 * the make, the two wordmark lines and a tag (First Spotter; the rarity in a binder slot) — in the raised tone, so they read on the
 * block. The grid's row pitch is then the loaded grid's.
 */
export function DexTileSkeleton({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.skeletonFrame}>
      <SkeletonBlock corner="md" style={styles.skeletonFill} />
      <View style={styles.skeletonPhoto} />
      <SkeletonSurfaceContext value="raised">
        <View style={[styles.body, compact ? styles.bodyCompact : null]}>
          <SkeletonText variant="caption" width="40%" />
          <SkeletonText variant="displayWordmark" lines={2} width="85%" lastLineWidth="55%" />
          <SkeletonBlock width="50%" height={size.statusPill} corner="xs" />
        </View>
      </SkeletonSurfaceContext>
    </View>
  );
}
