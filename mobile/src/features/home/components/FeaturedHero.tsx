import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { homeKeys, type FeaturedBuild, type FeedVehicle } from '@/api/queries/home';
import { usePublicViewer } from '@/api/queries/vehicles';
import { photoFields } from '@/features/profile/media';
import { isWeb } from '@/lib/platform';
import { createStyles, space, useTheme } from '@/theme';
import {
  DisplayTitle,
  displayTitleSkeleton,
  Photo,
  PhotoScrim,
  PressableScale,
  SampleBadges,
  SkeletonBlock,
  SkeletonText,
  Text,
  useSampleBadgeLabels,
  type PhotoCorner,
} from '@/ui';
import { certainlyOneLine, drawnScale, type DisplayTitlePlacement } from '@/ui/displayTitleLayout';
import { joinLabel, useStacksAtFontScale } from '@/ui/rowParts';

import { featuredByline } from '../model';

const useStyles = createStyles((t) => ({
  body: { overflow: 'hidden' },
  rounded: { borderRadius: t.radius.md },
  hoverLayer: { backgroundColor: t.color.state.hover },
  sampleBadges: { left: 0, position: 'absolute', top: t.space[12] },
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
/**
 * The title the skeleton decides with while no featured build is cached: a featured name at German length, the seeded featured
 * build (DQ-808). Not shown; a car name, not copy. NH-R3-2: where the featured builds are cached (an offline start, a refetch,
 * the stream loading after them) the skeleton decides from the real title instead. Without one the typical title is the best
 * guess there is; a short real title then sits on the photo band and the block under the photo goes (one jump on the first
 * load only, ADR-426 d).
 */
const TYPICAL_TITLE = 'Volkswagen Golf GTI VIII (CD)'; // i18n-ignore

export type FeaturedHeroLayout = {
  /** Eyebrow, title and byline under the photo in page colours, the photo clear (ADR-426 d, and from 200 % font). */
  stacked: boolean;
  /** The title's width, known before layout (MF-R2-1). */
  textWidth: number;
  /** ADR-426 a: `card` on the photo band (and inside the column's card), `page` under a bleed photo. */
  placement: DisplayTitlePlacement;
};

/**
 * ADR-426 d, before the first paint (ADR-425): a bleed phone hero keeps its identity on the photo only when the title certainly
 * fits one line there, at 30 or at 24 (the card rule then sets it on that line); otherwise it stacks and the photo stays clear.
 * The decision uses the estimate DisplayTitle uses, so the skeleton, the first frame and the final layout agree. Inside the
 * column (tablet, desktop) the band stays on the photo up to the font scale where every hero stacks (`fontStacked`).
 */
export function featuredHeroLayout({
  title,
  width,
  bleed,
  gutter,
  fontScale,
  fontStacked,
}: {
  title: string;
  width: number;
  bleed: boolean;
  gutter: number;
  fontScale: number;
  fontStacked: boolean;
}): FeaturedHeroLayout {
  const onBand = width - 2 * (bleed ? gutter : space[16]);
  const below = bleed ? width - 2 * gutter : width;
  const stacked = fontStacked || (bleed && !certainlyOneLine(title, onBand, drawnScale(fontScale)));
  return { stacked, textWidth: stacked ? below : onBand, placement: stacked && bleed ? 'page' : 'card' };
}

/**
 * NH-R3-2: the title of the featured build the hero will show, when the featured builds are already in the query cache (read,
 * never fetched: the screen's useFeaturedBuilds owns the request). Without a QueryClient (a primitive's test) nothing is cached.
 */
function useCachedFeaturedTitle(): string | null {
  const client = useContext(QueryClientContext);
  const viewer = usePublicViewer();
  return client?.getQueryData<FeaturedBuild[]>(homeKeys.featured(viewer))?.[0]?.vehicle.full_title ?? null;
}

/**
 * DQ-191: the featured build while Start loads: the 16:9 photo and, where the loaded hero stacks (ADR-426 d, decided for the
 * cached featured title when there is one, else for a typical title, as for the real one; from 200 % font always), eyebrow,
 * title and byline under it. `width` is the photo's width. Put it inside a `Skeleton`.
 */
export function FeaturedHeroSkeleton({ width, bleed, gutter }: { width: number; bleed: boolean; gutter: number }) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const fontStacked = useStacksAtFontScale();
  const sample = useCachedFeaturedTitle() ?? TYPICAL_TITLE;
  const { stacked, textWidth, placement } = featuredHeroLayout({ title: sample, width, bleed, gutter, fontScale, fontStacked });
  const title = displayTitleSkeleton(sample, fontScale, textWidth, placement);
  return (
    <View>
      <SkeletonBlock aspectRatio={EDITORIAL_W / EDITORIAL_H} corner="md" style={bleed ? styles.square : null} testID="HOME-01.skeleton.featured.photo" />
      {stacked ? (
        <View style={[styles.below, bleed ? { paddingHorizontal: gutter } : null]} testID="HOME-01.skeleton.featured.below">
          <SkeletonText variant="caption" width="35%" />
          {/* As DisplayTitle: the desktop size only for a page title at full size; a card title and a shrunk one (title.2's 28) keep theirs. */}
          <SkeletonText
            variant={title.variant}
            desktopSize={title.variant === 'displayTitle' && placement === 'page'}
            width="80%"
            lines={title.lines}
            testID="HOME-01.skeleton.featured.title"
          />
          <SkeletonText variant="callout" width="45%" />
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
 * FS-2 featured build: 16:9 photo, the "FEATURED BUILD" marker in `caption` (v1 eyebrow, retired in 2.0; the HOME-01 rebuild
 * decides its fate), `display.title` title (DisplayTitle), `callout` "@lukas.sc · Stuttgart". On the photo the three lines sit on
 * the band over the scrim in `onPhoto.*`. ADR-426 d: on a bleed phone hero they stay there only for a title on one line;
 * otherwise, and from 200 % font everywhere, they move under the photo in the page's own colours (featuredHeroLayout).
 */
export function FeaturedHero({ vehicle, width, bleed, gutter, eyebrow: showEyebrow = true, onOpen, testID }: FeaturedHeroProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const fontStacked = useStacksAtFontScale();
  const byline = featuredByline(vehicle.owner);
  const corner: PhotoCorner = bleed ? 'none' : 'md';
  const side = { paddingHorizontal: bleed ? gutter : space[16] };
  const eyebrow = t('featured.eyebrow');
  const sample = { is_sample: vehicle.is_sample };
  const sampleLabels = useSampleBadgeLabels(sample);
  // MF-R2-1 / ADR-426 d: stacked or on the photo, and the title's width, before the first paint.
  const { stacked, textWidth, placement } = featuredHeroLayout({ title: vehicle.full_title, width, bleed, gutter, fontScale, fontStacked });

  const lines = (onPhoto: boolean) => (
    <>
      {showEyebrow ? (
        <Text variant="caption" color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'} testID={`${testID}.eyebrow`}>
          {eyebrow}
        </Text>
      ) : null}
      {/* DQ-802/808, ADR-426 a: a car name, never hyphenated; on the band a card title, under a bleed photo a page title. */}
      <DisplayTitle placement={placement} layoutWidth={textWidth} color={onPhoto ? 'onPhoto.primary' : 'text.primary'} testID={`${testID}.title`}>
        {vehicle.full_title}
      </DisplayTitle>
      {byline ? (
        <Text variant="callout" color={onPhoto ? 'onPhoto.secondary' : 'text.secondary'} hyphenate={false} testID={`${testID}.byline`}>
          {byline}
        </Text>
      ) : null}
    </>
  );

  return (
    <PressableScale
      role="link"
      aria-label={isWeb ? undefined : joinLabel([showEyebrow && eyebrow, ...sampleLabels, vehicle.full_title.trim(), byline])}
      onPress={() => onOpen(vehicle)}
      contentStyle={[styles.body, bleed ? null : styles.rounded]}
      testID={testID}
    >
      {(state) => (
        <>
          <Photo {...photoFields(vehicle.cover, width)} aspect="16:9" corner={corner} testID={`${testID}.photo`}>
            {state.hovered ? <View style={[StyleSheet.absoluteFill, styles.hoverLayer]} /> : null}
            {/* 09 §8.19: a sample build carries Beispiel on its photo, top left, on the badge's own photo ground. */}
            <SampleBadges flags={sample} tone="onPhoto" style={[styles.sampleBadges, side]} testID={`${testID}.sample`} />
            {stacked ? null : (
              <View style={[styles.band, side]} testID={`${testID}.band`}>
                <PhotoScrim style={styles.fade} />
                {lines(true)}
              </View>
            )}
          </Photo>
          {stacked ? (
            <View style={[styles.below, bleed ? { paddingHorizontal: gutter } : null]} testID={`${testID}.below`}>
              {lines(false)}
            </View>
          ) : null}
        </>
      )}
    </PressableScale>
  );
}
