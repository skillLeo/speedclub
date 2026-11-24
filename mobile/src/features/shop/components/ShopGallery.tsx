import '@/features/shop/i18n';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import type { ShopImage } from '@/api/queries/shop';
import { aspect, createStyles, space } from '@/theme';
import { SampleBadges } from '@/ui/Badge';
import { ImageViewer, type ViewerImage } from '@/ui/ImageViewer';
import { Photo, type PhotoCorner } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { pageAt } from '@/ui/mediaCardLayout';
import { PageIndicator } from '@/ui/motion/kit';

import { shopPhoto, shopVariantUrl } from '../model';

/** Desktop: the photos after the first, three to a row. */
const STACK_COLUMNS = 3;

const useStyles = createStyles((t) => ({
  hover: { ...StyleSheet.absoluteFill, backgroundColor: t.color.state.hover },
  // DQ-P5-003: at the photo's foot, never under the floating back button that sits on its top-left corner on phones.
  badges: { bottom: t.space[12], left: t.space[12], position: 'absolute' },
  pages: { alignItems: 'center' },
  stack: { gap: t.space[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] },
}));

export type ShopGalleryProps = {
  images: readonly ShopImage[];
  /** The gallery's width (the screen's on a phone), for the photo variants and the pages. */
  width: number;
  /**
   * `pager`: one photo at a time, swipe, page pill (phone, tablet). `stack` (desktop): the first photo at the gallery's width, the others
   * 3 up under it, 2 apart (DQ-P5-002: six stacked 4:5 frames made a 4233 px page).
   */
  mode: 'pager' | 'stack';
  corner?: PhotoCorner;
  /** The product's name, the alt text of a photo without its own. */
  title: string;
  sample: boolean;
  /** Sub-testIDs: `.page.<n>`, `.pages`, `.viewer` (`.viewer.close`, `.viewer.counter`, …). */
  testID: string;
};

/**
 * SHOP-02 gallery (10 §3): the 4:5 product photos, swiped page by page with the page pill (MediaCard `feed`'s pager), or stacked on
 * the desktop, where a mouse does not swipe. A photo opens the ImageViewer (pinch 1–4 ×, double tap, swipe, arrows and Escape on
 * the web, a crossfade under reduced motion): the zoom. "Beispiel" on the first photo of a sample.
 */
export function ShopGallery({ images, width, mode, corner, title, sample, testID }: ShopGalleryProps) {
  const { t } = useTranslation('shop');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const progress = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    if (width > 0) progress.set(event.contentOffset.x / width);
  });
  const many = images.length > 1;
  const viewerImages = useMemo<ViewerImage[]>(
    () =>
      images.flatMap((image) => {
        const uri = shopVariantUrl(image, Number.POSITIVE_INFINITY);
        return uri ? [{ uri, blurhash: image.blurhash ?? undefined, aspectRatio: image.width / image.height, alt: image.alt ?? title }] : [];
      }),
    [images, title],
  );
  const pageStyle = useMemo(() => ({ width }), [width]);

  const thumbWidth = Math.floor((width - (STACK_COLUMNS - 1) * space[2]) / STACK_COLUMNS);
  const thumbStyle = useMemo(() => ({ width: thumbWidth }), [thumbWidth]);
  const photo = (image: ShopImage, index: number) => (
    <PressableScale
      key={image.id}
      role="button"
      aria-label={t('product.zoom', { current: index + 1, total: images.length, title: image.alt ?? title })}
      onPress={() => setOpen(index)}
      style={mode === 'pager' ? pageStyle : index > 0 ? thumbStyle : null}
      testID={`${testID}.page.${index}`}
    >
      {(state) => (
        <Photo
          {...shopPhoto(image, mode === 'stack' && index > 0 ? thumbWidth : width)}
          aspect={aspect.gridTall}
          corner={corner}
          priority={index === 0 ? 'high' : undefined}
        >
          {state.hovered ? <View style={styles.hover} /> : null}
          {index === 0 ? <SampleBadges flags={{ is_sample: sample }} tone="onPhoto" style={styles.badges} testID={`${testID}.sample`} /> : null}
        </Photo>
      )}
    </PressableScale>
  );

  return (
    <View testID={testID}>
      {mode === 'stack' ? (
        <View style={styles.stack}>
          {images.slice(0, 1).map(photo)}
          {many ? <View style={styles.grid}>{images.slice(1).map((image, index) => photo(image, index + 1))}</View> : null}
        </View>
      ) : (
        <>
          {/* R5 (phone web): react-native-web gives a ScrollView with `scrollEnabled={false}` `touch-action: none`, so a lone photo in a
              disabled pager blocked the page's vertical scroll whenever a drag started on it. One photo is a plain page; only two
              or more get the horizontal pager. */}
          {many ? (
            <Animated.ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(event) => setPage(pageAt(event.nativeEvent.contentOffset.x, width, images.length))}
              testID={`${testID}.pager`}
            >
              {images.map(photo)}
            </Animated.ScrollView>
          ) : (
            <View testID={`${testID}.pager`}>{images.map(photo)}</View>
          )}
          {many ? (
            <View style={styles.pages}>
              <PageIndicator
                progress={progress}
                count={images.length}
                label={common('a11y.photoCounter', { current: page + 1, total: images.length })}
                testID={`${testID}.pages`}
              />
            </View>
          ) : null}
        </>
      )}
      <ImageViewer
        visible={open !== null}
        images={viewerImages}
        initialIndex={open ?? 0}
        onClose={() => setOpen(null)}
        testID={`${testID}.viewer`}
      />
    </View>
  );
}
