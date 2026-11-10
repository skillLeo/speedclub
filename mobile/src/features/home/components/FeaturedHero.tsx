import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { photoFields } from '@/features/profile/media';
import { isWeb } from '@/lib/platform';
import { keepNameTogether } from '@/lib/format';
import { createStyles, space, useTheme } from '@/theme';
import { estimateLines, Photo, PhotoScrim, PressableScale, SkeletonBlock, SkeletonText, Text, type PhotoCorner } from '@/ui';
import { joinLabel, useStacksAtFontScale } from '@/ui/rowParts';

import { featuredByline } from '../model';

const useStyles = createStyles((t) => ({
  body: { overflow: 'hidden' },
  rounded: { borderRadius: t.radius.md },
  hoverLayer: { backgroundColor: t.color.state.hover },
  // ADR-129: a scrim share cannot carry three lines on any photo, so the text sits on a band of the scrim's end colour
  // with the fade above it.
  band: {
    backgroundColor: t.color.overlay.photoScrimEnd,
    bottom: 0,
    gap: t.space[4],
    left: 0,
    paddingBottom: t.space[16],
    paddingTop: t.space[4],
    position: 'absolute',
    right: 0,
  },
  fade: { bottom: '100%', height: t.space[48] },
  below: { gap: t.space[4], paddingTop: t.space[12] },
  square: { borderRadius: 0 },
}));

const [EDITORIAL_W = 16, EDITORIAL_H = 9] = '16:9'.split(':').map(Number);
/** Typical length of a featured title ("Nissan Skyline GT-R R34"). */
const TYPICAL_TITLE_CHARS = 23;

/**
 * DQ-191: the featured build while Start loads: the 16:9 photo and, from the font scale at which the lines move under the
 * photo, eyebrow, title and byline there. `width` is the photo's width. Put it inside a `Skeleton`.
 */
export function FeaturedHeroSkeleton({ width, bleed, gutter }: { width: number; bleed: boolean; gutter: number }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const stacked = useStacksAtFontScale();
  const textWidth = bleed ? width - 2 * gutter : width;
  const titleLines = estimateLines(TYPICAL_TITLE_CHARS, 'displayM', fontScale, textWidth);
  return (
    <View>
      <SkeletonBlock aspectRatio={EDITORIAL_W / EDITORIAL_H} corner="md" style={bleed ? styles.square : null} />
      {stacked ? (
        <View style={[styles.below, bleed ? { paddingHorizontal: gutter } : null]}>
          <SkeletonText variant="eyebrow" width="35%" />
          <SkeletonText variant="displayM" width="80%" lines={titleLines} />
          <SkeletonText variant="supporting" width="45%" />
        </View>
      ) : null}
    </View>
  );
}

export type FeaturedHeroProps = {
  vehicle: FeedVehicle;
  /** The photo's width on screen, for the variant. */
  width: number;
  /** Phone: edge to edge with the text on the gutter. Wider: inside the column, radius 12. */
  bleed: boolean;
  gutter: number;
  /** Off where a section header above already says "Featured Builds" (the rail). */
  eyebrow?: boolean;
  onOpen: (vehicle: FeedVehicle) => void;
  testID: string;
};

/**
 * FS-2 featured build: 16:9 photo, eyebrow "FEATURED BUILD", `display.m` title, `supporting` "@lukas.sc · Stuttgart". From
 * 200 % font the three lines would cover the car, so they move under the photo in the page's own colours.
 */
export function FeaturedHero({ vehicle, width, bleed, gutter, eyebrow: showEyebrow = true, onOpen, testID }: FeaturedHeroProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const stacked = useStacksAtFontScale();
  const byline = featuredByline(vehicle.owner);
  const title = keepNameTogether(vehicle.full_title);
  const corner: PhotoCorner = bleed ? 'none' : 'md';
  const side = { paddingHorizontal: bleed ? gutter : space[16] };
  const eyebrow = t('featured.eyebrow');

  const lines = (onPhoto: boolean) => (
    <>
      {showEyebrow ? (
        <Text variant="eyebrow" color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'} testID={`${testID}.eyebrow`}>
          {eyebrow}
        </Text>
      ) : null}
      <Text variant="displayM" color={onPhoto ? 'onPhoto.primary' : 'text.primary'} testID={`${testID}.title`}>
        {title}
      </Text>
      {byline ? (
        <Text variant="supporting" color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'} hyphenate={false} testID={`${testID}.byline`}>
          {byline}
        </Text>
      ) : null}
    </>
  );

  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([showEyebrow && eyebrow, title, byline])}
      onPress={() => onOpen(vehicle)}
      contentStyle={[styles.body, bleed ? null : styles.rounded]}
      testID={testID}
    >
      {(state) => (
        <>
          <Photo {...photoFields(vehicle.cover, width)} aspect="16:9" corner={corner} testID={`${testID}.photo`}>
            {state.hovered ? <View style={[StyleSheet.absoluteFill, styles.hoverLayer]} /> : null}
            {stacked ? null : (
              <View style={[styles.band, side]}>
                <PhotoScrim style={styles.fade} />
                {lines(true)}
              </View>
            )}
          </Photo>
          {stacked ? <View style={[styles.below, bleed ? { paddingHorizontal: gutter } : null]}>{lines(false)}</View> : null}
        </>
      )}
    </PressableScale>
  );
}
