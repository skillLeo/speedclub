import '@/features/shop/i18n';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useShopProducts, type ShopCategoryKey } from '@/api/queries/shop';
import { aspect, createStyles, size } from '@/theme';
import { SampleBadges } from '@/ui/Badge';
import { Icon } from '@/ui/icons/Icon';
import { Photo, type PhotoAspect, type PhotoFields } from '@/ui/Photo';
import { PhotoTopScrim } from '@/ui/PhotoStageScrim';
import { PressableScale } from '@/ui/PressableScale';
import { SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';
import { joinLabel } from '@/ui/rowParts';

import { categoryLeadPhoto, shopPhoto } from '../model';
import { SHOP_PHOTO } from './ShopClosed';

/**
 * R5-3: the bundled photo of each category, licensed seed photos (design/seed-photos/manifest.json) so SHOP-01 shows them with no
 * network. A coming category keeps its mood photo (Kleidung: the black-and-white cockpit `generic-interior-01`; Accessoires: the
 * bronze wheel `generic-wheels-02`); an available one shows its product (R5DQ-10, categoryLeadPhoto) and falls back to these only
 * when the server has no photo for it. No plate, no face. Hashes and focal points as the other screens that bundle these files.
 */
export const CATEGORY_PHOTOS: Readonly<Record<ShopCategoryKey, PhotoFields>> = {
  sticker: SHOP_PHOTO,
  apparel: {
    source: require('@/assets/gallery/generic-interior-01.jpg') as number,
    blurhash: 'LPBM_PIUxut7~qM{oft7_3Rjofj[',
    focal: { x: 0.55, y: 0.5 },
  },
  accessories: {
    source: require('@/assets/gallery/generic-wheels-02.jpg') as number,
    blurhash: 'LED]9w0L?GxC-;?GxZWBM|_2IBt6',
    focal: { x: 0.42, y: 0.55 },
  },
};

const useStyles = createStyles((t) => ({
  hover: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.hover },
  badges: { left: t.space[12], position: 'absolute', top: t.space[12] },
  leadText: { gap: t.space[4], paddingTop: t.space[12] },
  // R5DQ-27 from 768: photo and words side by side, the words on the photo's centre line.
  split: { alignItems: 'center', flexDirection: 'row', gap: t.space[32] },
  splitText: { flex: 1, gap: t.space[8], minWidth: 0 },
  edge: {
    ...StyleSheet.absoluteFill,
    borderColor: t.color.border.hairline,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.control,
    pointerEvents: 'none',
  },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  name: { flexShrink: 1 },
  tileText: { paddingTop: t.space[8] },
  // The stacked form at a large font: the 1:1 photo at the start, the name and the pill beside it on its centre line.
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[12] },
  rowText: { alignItems: 'flex-start', flex: 1, gap: t.space[4], minWidth: 0 },
  // The 1:1 photo of a stacked row: the large thumbnail (88), so name and pill keep the width at 360 and 200 %.
  rowPhoto: { width: size.avatar.xl },
  // "Bald verfügbar" on the photo (09 §5 Badge on a photo: the photo chip ground, onPhoto text), over `scrim.top`.
  soonPill: {
    alignItems: 'center',
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    left: t.space[8],
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
    position: 'absolute',
    top: t.space[8],
  },
  skeletonText: { gap: t.space[4], paddingTop: t.space[12] },
}));

export type CategoryLeadProps = {
  category: ShopCategoryKey;
  /** False under a QA state without the server: the bundled frame, no request. */
  live: boolean;
  /** 4:5 on a phone, 16:9 on a tablet, 21:9 from 1280 (categoryLeadAspect). */
  photoAspect: PhotoAspect;
  corner: 'none' | 'md';
  /** The card's width, for the photo variant. */
  width: number;
  /** The text's inset: the page gutter under an edge-to-edge phone photo, none in the column. */
  inset: number;
  /**
   * R5DQ-27, from 768: the photo's width in the split (about 5 of 12 columns, 4:5, radius 12, hairline edge), the name, line and caret
   * beside it. Left out on a phone: the full-width 4:5 lead.
   */
  splitWidth?: number;
  onOpen: (category: ShopCategoryKey) => void;
  testID: string;
};

/**
 * R5DQ-01: an available category is the page's lead. A full-bleed photo of what it sells (R5DQ-10, R5DQ-22: its first product's
 * photo, where the sticker reads at card size, else the bundled frame; the banner stays SHOP-03's hero, so no photo shows twice), "Beispiel" on a sample, the name in `title.2` with the caret,
 * one line. The whole card is the link to SHOP-03; no "Verfügbar" pill (the caret and the photo say it).
 */
export const CategoryLead = memo(function CategoryLead({ category, live, photoAspect, corner, width, inset, splitWidth, onOpen, testID }: CategoryLeadProps) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  // R5DQ-22: the first page of the category's cards (the same query and cache SHOP-03 opens with); its first photo leads.
  const products = useShopProducts(category, live);
  const first = products.data?.pages[0]?.data[0];
  const loadingPhoto = live && !products.data && products.isPending && products.fetchStatus === 'fetching';
  const photo = categoryLeadPhoto(live ? first : null, CATEGORY_PHOTOS[category]);
  const photoWidth = splitWidth ?? width;
  const fields: PhotoFields = loadingPhoto ? { source: null } : photo.image ? shopPhoto(photo.image, photoWidth) : photo.fallback;
  const name = t(`categories.${category}`);
  const body = t(`categories.body.${category}`);
  return (
    <PressableScale role="link" aria-label={joinLabel([name, body])} onPress={() => onOpen(category)} testID={testID}>
      {(state) => {
        const image = (
          <Photo {...fields} aspect={splitWidth ? aspect.hero : photoAspect} corner={splitWidth ? 'md' : corner} priority="high" testID={`${testID}.photo`}>
            {state.hovered ? <View style={styles.hover} /> : null}
            {/* R5DQ-27: a hairline on the photo's edge, so a light product photo keeps its shape on Hell. */}
            {splitWidth ? <View style={styles.edge} /> : null}
            <SampleBadges flags={{ is_sample: photo.sample }} tone="onPhoto" style={styles.badges} testID={`${testID}.sample`} />
          </Photo>
        );
        const words = (
          <View style={[splitWidth ? styles.splitText : styles.leadText, splitWidth ? null : { paddingHorizontal: inset }]}>
            <View style={styles.nameRow}>
              <Text variant="title2" style={styles.name} testID={`${testID}.title`}>
                {name}
              </Text>
              <Icon name="caret-right" size={20} color="text.secondary" />
            </View>
            <Text variant="callout" color="text.secondary" testID={`${testID}.body`}>
              {body}
            </Text>
          </View>
        );
        return splitWidth ? (
          <View style={styles.split}>
            <View style={{ width: splitWidth }}>{image}</View>
            {words}
          </View>
        ) : (
          <>
            {image}
            {words}
          </>
        );
      }}
    </PressableScale>
  );
});

export type CategorySoonProps = {
  category: ShopCategoryKey;
  /** `tile`: the 1:1 photo with the name under it; `row` (stacked at a large font): the photo at the start, the name beside it. */
  form: 'tile' | 'row';
  /** The name's type: `headline`, or `callout.strong` beside a desktop lead (R5DQ-24: two steps under its `title.2`). */
  titleVariant?: 'headline' | 'calloutStrong';
  corner: 'none' | 'md';
  /** The name's inset (tile form): start and end, so an edge-to-edge phone pair lines up with the gutter. */
  insetStart: number;
  insetEnd: number;
  testID: string;
};

/**
 * R5DQ-01, R4-3.2: a category that is coming, clearly second. A compact 1:1 tile with "Bald verfügbar" on the photo over
 * `scrim.top` and the name in `headline`; no press, no caret, `aria-disabled`, so it never opens an empty list.
 */
export function CategorySoon({ category, form, titleVariant = 'headline', corner, insetStart, insetEnd, testID }: CategorySoonProps) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const name = t(`categories.${category}`);
  // Names wrap at their spaces only (R5DQ-21: never "Acces- / soires").
  const title = (
    <Text variant={form === 'row' ? 'headline' : titleVariant} hyphenate={false} testID={`${testID}.title`}>
      {name}
    </Text>
  );
  if (form === 'row') {
    // R5DQ-21 (360 at 200 %): the photo at a fixed small size, the pill in the text column under the name, never clipped by it.
    return (
      <View role="link" aria-disabled aria-label={t('categories.soonLabel', { label: name })} testID={testID}>
        <View aria-hidden style={styles.row}>
          <View style={styles.rowPhoto}>
            <Photo {...CATEGORY_PHOTOS[category]} aspect={aspect.grid} corner={corner} testID={`${testID}.photo`} />
          </View>
          <View style={styles.rowText}>
            {title}
            <StatusPill label={t('categories.soonBadge')} testID={`${testID}.soon`} />
          </View>
        </View>
      </View>
    );
  }
  return (
    <View role="link" aria-disabled aria-label={t('categories.soonLabel', { label: name })} testID={testID}>
      <View aria-hidden>
        <Photo {...CATEGORY_PHOTOS[category]} aspect={aspect.grid} corner={corner} testID={`${testID}.photo`}>
          <PhotoTopScrim />
          <View style={styles.soonPill} testID={`${testID}.soon`}>
            <Text variant="labelBadge" color="onPhoto.primary" hyphenate={false} numberOfLines={1}>
              {t('categories.soonBadge')}
            </Text>
          </View>
        </Photo>
        <View style={[styles.tileText, { paddingEnd: insetEnd, paddingStart: insetStart }]}>{title}</View>
      </View>
    </View>
  );
}

/** The lead while the head loads: the photo block at its aspect, the name and the line, in the loaded card's geometry. */
export function CategoryLeadSkeleton({ photoAspect, corner, inset, splitWidth }: Pick<CategoryLeadProps, 'photoAspect' | 'corner' | 'inset' | 'splitWidth'>) {
  const styles = useStyles();
  const [w = 1, h = 1] = photoAspect.split(':').map(Number);
  if (splitWidth) {
    return (
      <View style={styles.split}>
        <View style={{ width: splitWidth }}>
          <SkeletonBlock aspectRatio={4 / 5} corner="md" />
        </View>
        <View style={styles.splitText}>
          <SkeletonText variant="title2" width="35%" />
          <SkeletonText variant="callout" width="80%" />
        </View>
      </View>
    );
  }
  return (
    <View>
      <SkeletonBlock aspectRatio={w / h} corner={corner} />
      <View style={[styles.skeletonText, { paddingHorizontal: inset }]}>
        <SkeletonText variant="title2" width="35%" />
        <SkeletonText variant="callout" width="80%" />
      </View>
    </View>
  );
}

/** A coming tile while the head loads: the 1:1 block and the name's line. */
export function CategorySoonSkeleton({ corner, insetStart }: { corner: 'none' | 'md'; insetStart: number }) {
  const styles = useStyles();
  return (
    <View>
      <SkeletonBlock aspectRatio={1} corner={corner} />
      <View style={[styles.tileText, { paddingStart: insetStart }]}>
        <SkeletonText variant="headline" width="60%" />
      </View>
    </View>
  );
}

