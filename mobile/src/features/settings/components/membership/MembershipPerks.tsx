/**
 * MEM-01 / SET-24 perks (09 §7.13 "3–5 perks shown as real UI fragments", §8.16; DQ-1161): each candidate perk is its title, one
 * line and a small piece of the UI it would unlock, built from the real primitives with the bundled seed photos
 * (design/seed-photos/CREDITS.md, the files DEV-01, the empty garage and the system states already use). None is decided yet
 * (09 §16 #14), so every fragment is badged "Beispiel"; no fragment shows a figure (no price, no cost, no count). The fragments are
 * decorative: screen readers read the perk's title and line.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { QR_SAMPLE_SVG } from '@/features/gallery/qrSample';
import { accentPalette, createStyles, size, space, typography, type AccentSet } from '@/theme';
import { Avatar, BrandWordmark, Icon, Photo, SampleBadge, SkeletonBlock, SkeletonText, Text, type PhotoFields } from '@/ui';
import { ratioOf } from '@/ui/Photo';

export const MEMBERSHIP_PERKS = ['garage', 'stickers', 'costs', 'accent'] as const;
export type MembershipPerk = (typeof MEMBERSHIP_PERKS)[number];

/** Four builds: one more than a free garage holds (09 §8.16 "more than 3 vehicles"). Focal points and hashes from the seed manifest. */
const CARS: readonly { key: string; photo: PhotoFields }[] = [
  {
    key: 'r34',
    photo: { source: require('@/assets/gallery/nissan-r34-01.jpg') as number, blurhash: 'LoGlekxvjYof_Nt7ayj]M{j@ofWB', focal: { x: 0.54, y: 0.66 } },
  },
  {
    key: 'rs3',
    photo: { source: require('@/assets/gallery/audi-rs3-8y-01.jpg') as number, thumbhash: 'zvcJFQSVl4R4eGj3d5mHqKmCnxr4', focal: { x: 0.5, y: 0.53 } },
  },
  {
    key: 'p911',
    photo: { source: require('@/assets/gallery/porsche-992-01.jpg') as number, thumbhash: '0CgGBQLEqFZmmEcHmYfqVgWBKQSo', focal: { x: 0.5, y: 0.54 } },
  },
  {
    key: 'e46',
    photo: { source: require('@/assets/gallery/bmw-e46-01.jpg') as number, blurhash: 'LVEeGM-UE2V@}mxYR-jZ-QoJWXoL', focal: { x: 0.49, y: 0.59 } },
  },
];

/** The mini profile's cover: a wheel and caliper, so the accent colour, not a car, is what the fragment is about. */
const ACCENT_COVER: PhotoFields = {
  source: require('@/assets/gallery/generic-wheels-01.jpg') as number,
  blurhash: 'LAAJ=-~p9]?cxvMxITogyX-;whI[',
  focal: { x: 0.35, y: 0.5 },
};

/** The sample's choice among the accent sets of the token file (not the brand red, so the page keeps its red to the badge). */
const SAMPLE_ACCENT: AccentSet = 'racingBlue';
const ACCENT_SETS = Object.keys(accentPalette.sets) as AccentSet[];

/** Relative lengths of the cost bars: a shape, not data, and never labelled with a figure. */
const COST_BARS = [
  { key: 'suspension', share: '100%' },
  { key: 'wheels', share: '72%' },
  { key: 'exhaust', share: '48%' },
  { key: 'brakes', share: '30%' },
] as const;

const TILES = CARS.length;
const AVATAR_OVERLAP = space[24];
const STICKER_GAP = space[16];
const PLATE_PADDING = space[16];
const WORDMARK_HEIGHT = space[16];
const CAPTION_LINE = typography.caption.lineHeight;

const useStyles = createStyles((t) => ({
  list: { gap: t.space[32] },
  perk: { gap: t.space[12] },
  head: { gap: t.space[4] },
  titleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // Garage strip
  strip: { flexDirection: 'row', gap: t.space[8] },
  tileName: { marginTop: t.space[8] },
  // Sticker designs
  stickers: { alignItems: 'flex-start', flexDirection: 'row', gap: STICKER_GAP },
  stickerCaption: { marginTop: t.space[8] },
  round: { alignItems: 'center', backgroundColor: t.color.qr.bg, borderRadius: t.radius.full, justifyContent: 'center' },
  plate: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.hairline,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.control,
    gap: t.space[8],
    justifyContent: 'center',
    padding: PLATE_PADDING,
  },
  plateCode: { backgroundColor: t.color.qr.bg, borderRadius: t.radius.xs },
  // Cost chart crop
  chart: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[12], padding: t.space[16] },
  chartHead: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  barRow: { gap: t.space[4] },
  track: { backgroundColor: t.color.bg.raised, borderRadius: t.radius.full, height: t.space[8], overflow: 'hidden' },
  bar: { backgroundColor: t.color.text.tertiary, borderRadius: t.radius.full, height: t.space[8] },
  barLead: { backgroundColor: t.color.text.primary },
  // Accent mini header
  mini: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  miniBody: { gap: t.space[12], paddingBottom: t.space[16], paddingHorizontal: t.space[16] },
  miniAvatar: {
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.focusRing,
    // The avatar overlaps the cover by the scale step nearest half its height (an off-scale half would be a DOM-audit finding).
    marginTop: -AVATAR_OVERLAP,
    padding: t.space[2],
  },
  miniTabs: { flexDirection: 'row', gap: t.space[24] },
  miniTab: { gap: t.space[4] },
  indicator: { borderRadius: t.radius.full, height: t.size.contentTabIndicator },
  swatches: { flexDirection: 'row', gap: t.space[8] },
  swatchRing: { borderColor: t.color.bg.surface, borderRadius: t.radius.full, borderWidth: t.size.border.focusRing, padding: t.space[2] },
  swatch: { borderRadius: t.radius.full, height: t.size.icon.m, width: t.size.icon.m },
}));

/** The width of one of the four garage tiles in a strip `width` wide. */
function tileWidth(width: number): number {
  return Math.max(0, Math.floor((width - space[8] * (TILES - 1)) / TILES));
}

/** The side of each sticker: two side by side, never larger than a rail card. */
function stickerSide(width: number): number {
  return Math.max(0, Math.min(Math.floor((width - STICKER_GAP) / 2), size.railCard));
}

/**
 * The height of a perk's fragment at `width` and a font scale of 1: the loading state's blocks, so the skeleton has the page's
 * geometry (text grows with the font; the photos and stickers do not).
 */
export function perkFragmentHeight(perk: MembershipPerk, width: number): number {
  switch (perk) {
    case 'garage':
      return tileWidth(width) / ratioOf('3:4') + space[8] + 2 * CAPTION_LINE;
    case 'stickers':
      return stickerSide(width) + space[8] + CAPTION_LINE;
    case 'costs':
      return 2 * space[16] + CAPTION_LINE + COST_BARS.length * (space[12] + CAPTION_LINE + space[4] + space[8]);
    case 'accent':
      return (
        width / ratioOf('3:1') +
        (size.avatar.lg - AVATAR_OVERLAP) +
        size.border.focusRing +
        space[2] +
        3 * space[12] +
        typography.headline.lineHeight +
        typography.callout.lineHeight +
        space[4] +
        size.contentTabIndicator +
        size.icon.m +
        2 * (size.border.focusRing + space[2]) +
        space[16]
      );
  }
}

function GarageStrip({ width }: { width: number }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const tile = tileWidth(width);
  return (
    <View style={styles.strip}>
      {CARS.map((car) => (
        <View key={car.key} style={{ width: tile }}>
          <Photo {...car.photo} aspect="3:4" corner="sm" style={{ width: tile }} />
          <Text variant="caption" color="text.secondary" numberOfLines={2} style={styles.tileName}>
            {t(`membership.samples.cars.${car.key}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function StickerDesigns({ width }: { width: number }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const side = stickerSide(width);
  // The code fills the square inside the round sticker; on the plate it leaves room for the wordmark under it.
  const roundCode = Math.floor(side * Math.SQRT1_2);
  const plateCode = Math.max(0, side - 2 * PLATE_PADDING - space[8] - WORDMARK_HEIGHT - 2 * size.border.control);
  return (
    <View style={styles.stickers}>
      <View style={{ width: side }}>
        <View style={[styles.round, { height: side, width: side }]} dataSet={{ qaExempt: 'qr' }}>
          <SvgXml xml={QR_SAMPLE_SVG} width={roundCode} height={roundCode} />
        </View>
        <Text variant="caption" color="text.secondary" style={styles.stickerCaption}>
          {t('membership.samples.stickers.round')}
        </Text>
      </View>
      <View style={{ width: side }}>
        <View style={[styles.plate, { height: side, width: side }]} dataSet={{ qaExempt: 'qr' }}>
          <View style={styles.plateCode}>
            <SvgXml xml={QR_SAMPLE_SVG} width={plateCode} height={plateCode} />
          </View>
          <BrandWordmark width={plateCode} height={WORDMARK_HEIGHT} tone="white" decorative />
        </View>
        <Text variant="caption" color="text.secondary" style={styles.stickerCaption}>
          {t('membership.samples.stickers.plate')}
        </Text>
      </View>
    </View>
  );
}

function CostChart() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <Icon name="lock-simple" size={16} weight="regular" color="text.secondary" />
        <Text variant="caption" color="text.secondary">
          {t('membership.samples.costs.private')}
        </Text>
      </View>
      {COST_BARS.map((bar, index) => (
        <View key={bar.key} style={styles.barRow}>
          <Text variant="caption" color="text.secondary">
            {t(`membership.samples.costs.${bar.key}`)}
          </Text>
          <View style={styles.track}>
            <View style={[styles.bar, index === 0 ? styles.barLead : null, { width: bar.share }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function AccentHeader() {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  // MEM-01 is a Carbon stage in every theme (ADR-453 a): the dark half of the set.
  const accent = accentPalette.sets[SAMPLE_ACCENT].dark;
  const name = t('membership.samples.accent.name');
  return (
    <View style={styles.mini}>
      <Photo {...ACCENT_COVER} aspect="3:1" corner="none" />
      <View style={styles.miniBody}>
        <View style={[styles.miniAvatar, { borderColor: accent.fg }]}>
          <Avatar name={name} size={size.avatar.lg} decorative />
        </View>
        <Text variant="headline">{name}</Text>
        <View style={styles.miniTabs}>
          <View style={styles.miniTab}>
            <Text variant="callout">{t('membership.samples.accent.garage')}</Text>
            <View style={[styles.indicator, { backgroundColor: accent.fg }]} />
          </View>
          <Text variant="callout" color="text.secondary">
            {t('membership.samples.accent.updates')}
          </Text>
        </View>
        <View style={styles.swatches}>
          {ACCENT_SETS.map((set) => (
            <View key={set} style={[styles.swatchRing, set === SAMPLE_ACCENT ? { borderColor: accent.fg } : null]}>
              <View style={[styles.swatch, { backgroundColor: accentPalette.sets[set].dark.fill }]} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Fragment({ perk, width }: { perk: MembershipPerk; width: number }) {
  switch (perk) {
    case 'garage':
      return <GarageStrip width={width} />;
    case 'stickers':
      return <StickerDesigns width={width} />;
    case 'costs':
      return <CostChart />;
    case 'accent':
      return <AccentHeader />;
  }
}

export type MembershipPerksProps = {
  routeId: string;
  /** The column's width before its first layout; the measured width wins after it. */
  width: number;
};

/** The perk list: title and "Beispiel", one line, the fragment. */
export function MembershipPerks({ routeId, width: initialWidth }: MembershipPerksProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const [width, setWidth] = useState(initialWidth);
  return (
    <View
      style={styles.list}
      role="list"
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      testID={`${routeId}.perks`}
    >
      {MEMBERSHIP_PERKS.map((perk) => (
        <View key={perk} style={styles.perk} role="listitem" testID={`${routeId}.perk.${perk}`}>
          <View style={styles.head}>
            <View style={styles.titleRow}>
              <Text variant="headline">{t(`membership.perks.${perk}`)}</Text>
              <SampleBadge testID={`${routeId}.perk.${perk}.sample`} />
            </View>
            <Text variant="callout" color="text.secondary">
              {t(`membership.perks.${perk}Body`)}
            </Text>
          </View>
          <View aria-hidden testID={`${routeId}.perk.${perk}.fragment`}>
            {width > 0 ? <Fragment perk={perk} width={width} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** The perk list while the page loads, inside the page's `Skeleton`: the same titles, lines and fragment boxes. */
export function MembershipPerksSkeleton({ width }: { width: number }) {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {MEMBERSHIP_PERKS.map((perk) => (
        <View key={perk} style={styles.perk}>
          <View style={styles.head}>
            <SkeletonText variant="headline" width="55%" />
            <SkeletonText variant="callout" />
          </View>
          <SkeletonBlock height={perkFragmentHeight(perk, width)} corner="md" />
        </View>
      ))}
    </View>
  );
}
