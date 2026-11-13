import { useImperativeHandle, useMemo, useRef, useState, type ComponentRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { VehicleMedia } from '@/api/queries/vehicles';
import { isWeb } from '@/lib/platform';
import { createStyles, radius, space, useBreakpoint } from '@/theme';
import { useMotionPreference } from '@/ui/motion';
import { Icon, Photo, PhotoStageScrim, PressableScale, Text, type PhotoAspect } from '@/ui';

import { photoFields } from '../media';

export type ProfileHeroHandle = {
  /** Scrolls the pager to a photo, for the desktop thumbnails. */
  show: (index: number) => void;
};

export type ProfileHeroProps = {
  /** Photos with a file, in the owner's order. */
  photos: readonly VehicleMedia[];
  /** The hero's width in points: the pager pages by it. */
  width: number;
  /** `none` edge to edge on a phone, `md` (12) in the tablet and desktop columns. */
  corner: 'none' | 'md';
  /** "Nissan Skyline GT-R R34", the alt text of a photo without its own. */
  vehicleTitle: string;
  /** Names the owner in the photo-less state; null when the owner is hidden (ADR-148). */
  ownerUsername?: string | null;
  onOpen: (index: number) => void;
  onIndexChange?: (index: number) => void;
  /** Width / height: 4:5 edge to edge on a phone (09 §7.6), 16:9 across the content from 768 (DQ-1048). */
  ratio?: number;
  /** The photo's aspect token, matching `ratio`. */
  aspect?: PhotoAspect;
  /**
   * DQ-1047: the photo fades into the dark stage (`scrim.photo`) and the identity sits over its bottom; the counter then rides
   * this far above the bottom edge (the text-safe line + 8) instead of 12.
   */
  identityOverlap?: number;
  /** `<routeId>.hero`, `.photoCount`, `.heroEmpty`, `.hero.<n>`. */
  routeId: string;
  ref?: Ref<ProfileHeroHandle>;
};

/** Slides this far from the current one stay mounted, so a swipe never shows a blank page. */
const WINDOW = 1;
const HERO_RATIO = 4 / 3;

const useStyles = createStyles((t) => ({
  hero: { backgroundColor: t.color.bg.surface, overflow: 'hidden' },
  pager: { flex: 1 },
  slide: { overflow: 'hidden' },
  // The counter of FS-3 and WEB-01: onPhoto chip, radius 4, 8 × 4 padding, 12 from the bottom right corner.
  counter: {
    backgroundColor: t.color.onPhoto.chipBg,
    borderRadius: t.radius.xs,
    bottom: t.space[12],
    paddingHorizontal: t.space[8],
    paddingVertical: t.space[4],
    pointerEvents: 'none',
    position: 'absolute',
    right: t.space[12],
  },
  counterText: { fontVariant: ['tabular-nums'] },
  empty: {
    borderBottomColor: t.color.border.subtle,
    borderBottomWidth: isWeb ? t.size.border.control : StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'flex-end',
  },
  emptyTitle: { marginTop: t.space[12] },
  emptyBody: { marginTop: t.space[4] },
}));

/**
 * FS-3 hero: edge-to-edge pager (4:5 on a phone, 4:3 in the columns) with the counter "1/12" bottom right. Each photo opens the viewer. Without photos the
 * same 4:3 box holds the designed empty state of WEB-01, so nothing below moves when the first photo arrives.
 */
export function ProfileHero({ photos, width, corner, vehicleTitle, ownerUsername, onOpen, onIndexChange, ratio = HERO_RATIO, aspect = '4:3', identityOverlap, routeId, ref }: ProfileHeroProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const motion = useMotionPreference();
  const { gutter } = useBreakpoint();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;
  const height = width / ratio;
  const box = useMemo(
    () => ({ width, height, borderRadius: corner === 'none' ? 0 : radius[corner] }),
    [corner, height, width],
  );
  const slideBox = useMemo(() => ({ width, height }), [height, width]);

  const settle = (next: number) => {
    const clamped = Math.min(count - 1, Math.max(0, next));
    if (clamped === index) return;
    setIndex(clamped);
    onIndexChange?.(clamped);
  };

  useImperativeHandle(
    ref,
    () => ({
      show: (next: number) => {
        scroller.current?.scrollTo({ x: next * width, animated: motion.enabled && !motion.reduced });
        settle(next);
      },
    }),
  );

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) settle(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  if (count === 0) {
    return (
      <View style={[styles.hero, box]} testID={`${routeId}.hero`}>
        <View style={[styles.empty, { padding: gutter }]} testID={`${routeId}.heroEmpty`}>
          <Icon name="image" size={48} color="text.tertiary" />
          <Text variant="headline" style={styles.emptyTitle}>
            {t('hero.noPhotoTitle')}
          </Text>
          <Text variant="callout" color="text.secondary" style={styles.emptyBody}>
            {ownerUsername ? t('hero.noPhotoOwner', { username: ownerUsername }) : t('hero.noPhotoBody')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View dataSet={{ qaExempt: 'photo' }} style={[styles.hero, box]} testID={`${routeId}.hero`}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        style={styles.pager}
        aria-label={t('hero.galleryLabel', { title: vehicleTitle })}
      >
        {photos.map((photo, position) => (
          <View key={photo.id} style={[styles.slide, slideBox]}>
            {Math.abs(position - index) > WINDOW ? null : (
              <PressableScale
                role="button"
                aria-label={t('hero.open', { alt: photo.alt || vehicleTitle, current: position + 1, total: count })}
                feedback={false}
                ring="inset"
                onPress={() => onOpen(position)}
                testID={`${routeId}.hero.${position}`}
                style={slideBox}
              >
                <Photo {...photoFields(photo, width)} aspect={aspect} style={slideBox} />
              </PressableScale>
            )}
          </View>
        ))}
      </ScrollView>
      {identityOverlap !== undefined ? <PhotoStageScrim /> : null}
      {count > 1 ? (
        <View style={[styles.counter, identityOverlap !== undefined ? { bottom: identityOverlap + space[8] } : null]} testID={`${routeId}.photoCount`}>
          <Text variant="caption" color="onPhoto.primary" selectable={false} hyphenate={false} style={styles.counterText}>
            {`${index + 1}/${count}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
