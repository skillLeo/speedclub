import '@/features/shop/i18n';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { ShopProductCard } from '@/api/queries/shop';
import { isWeb } from '@/lib/platform';
import { aspect, createStyles } from '@/theme';
import { SampleBadges, useSampleBadgeLabels } from '@/ui/Badge';
import { Photo } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { joinLabel, useStacksAtFontScale } from '@/ui/rowParts';

import { productTitleText, shopPhoto } from '../model';

const TITLE_LINES = 2;

const useStyles = createStyles((t) => ({
  hover: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.hover },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
  text: { gap: t.space[2], paddingTop: t.space[8] },
  price: { alignItems: 'baseline', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap' },
}));

export type ProductTileProps = {
  product: ShopProductCard;
  /** The cell's width, for the photo variant. */
  width: number;
  /** Where the text starts inside the cell: the gutter in the first column of an edge-to-edge wall, so it lines up with the page. */
  insetStart: number;
  insetEnd: number;
  onOpen: (product: ShopProductCard) => void;
  testID: string;
};

/**
 * One cell of the SHOP-01 wall (10 §3, 09 §5 `wall`): the product's 4:5 photo, 0 radius, 2 apart, the name in `headline` (two lines;
 * at a large font as many as it needs) and the gross price in tnum with "inkl. MwSt." (PAngV) below the photo, never on it. "Beispiel"
 * on a sample, on the photo. No count, no rating, no cart.
 */
export const ProductTile = memo(function ProductTile({ product, width, insetStart, insetEnd, onOpen, testID }: ProductTileProps) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const largeFont = useStacksAtFontScale();
  const sample = { is_sample: product.is_sample };
  const badges = useSampleBadgeLabels(sample);
  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([...badges, product.title, product.price.formatted, t('price.vat')])}
      onPress={() => onOpen(product)}
      testID={testID}
    >
      {(state) => (
        <>
          <Photo {...shopPhoto(product.image, width)} aspect={aspect.gridTall} label={product.image?.alt ?? undefined} testID={`${testID}.photo`}>
            {state.hovered ? <View style={styles.hover} /> : null}
            <SampleBadges flags={sample} tone="onPhoto" style={styles.badges} testID={`${testID}.sample`} />
          </Photo>
          <View style={[styles.text, { paddingEnd: insetEnd, paddingStart: insetStart }]}>
            {/* DQ-P5-007, p5r2: names wrap at their spaces and a long compound's hyphen (productTitleText); a word that still does not
                fit hyphenates at a German break (house rule) instead of splitting mid-word. */}
            <Text variant="headline" numberOfLines={largeFont ? undefined : TITLE_LINES} hyphenate={largeFont} testID={`${testID}.title`}>
              {productTitleText(product.title)}
            </Text>
            <View style={styles.price}>
              <Text variant="callout" numeric hyphenate={false} testID={`${testID}.price`}>
                {product.price.formatted}
              </Text>
              <Text variant="caption" color="text.secondary" hyphenate={false} testID={`${testID}.vat`}>
                {t('price.vat')}
              </Text>
            </View>
          </View>
        </>
      )}
    </PressableScale>
  );
});

/** The cell while the grid loads: the 4:5 block, the name's two lines and the price line, in the loaded cell's geometry. */
export function ProductTileSkeleton({ insetStart, insetEnd }: { insetStart: number; insetEnd: number }) {
  const styles = useStyles();
  return (
    <View>
      <SkeletonBlock aspectRatio={4 / 5} corner="none" />
      <View style={[styles.text, { paddingEnd: insetEnd, paddingStart: insetStart }]}>
        <SkeletonText variant="headline" lines={2} lastLineWidth="55%" />
        <SkeletonText variant="callout" width="40%" />
      </View>
    </View>
  );
}
