import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { View } from 'react-native';

import type { FeedVehicle } from '@/api/queries/home';
import { railCardWidth } from '@/features/discover/components/DiscoverSections';
import { railSpec } from '@/features/home/components/NewInGarageRail';
import { photoFields } from '@/features/profile/media';
import { useDistinctCover } from '@/features/vehicle/distinctCover';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { aspect, createStyles, useTheme } from '@/theme';
import { SampleBadges } from '@/ui/Badge';
import { Photo, type PhotoAspect } from '@/ui/Photo';
import { PressableScale } from '@/ui/PressableScale';
import { SectionHeader } from '@/ui/SectionHeader';
import { Text } from '@/ui/Text';
import { joinLabel } from '@/ui/rowParts';

import { BuildsWall, type BuildsWallProps } from '../BuildsWall';

/** DQ-1145: below this many builds the portfolio is shown as cards; from it on, as the 2-column wall. */
export const PORTFOLIO_WALL_FROM = 3;

const useStyles = createStyles((t) => ({
  header: { gap: t.space[2], paddingBottom: t.space[12] },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[12] },
  text: { gap: t.space[2], marginTop: t.space[8] },
  badges: { left: t.space[8], position: 'absolute', top: t.space[8] },
  hover: { backgroundColor: t.color.state.hover, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
}));

export type PortfolioBuildsProps = BuildsWallProps & {
  /** Desktop: a single build is one 16:9 feature across the column; on a phone it is one 3:4 card across the column (DQ-1145). */
  feature?: boolean;
  /**
   * DQ-1215: the photo the page's hero shows (the business cover, or its fallback: the newest portfolio build). A card whose cover is
   * that photo shows its build's next gallery photo, so the same picture never stands twice in the first scroll.
   */
  heroPhotoId?: string | null;
};

/**
 * "Builds aus unserer Werkstatt" (BIZ-01, BIZ-03; DQ-1145). One or two builds would leave a half-empty row of 1:1 wall tiles that
 * read as thumbnails, so they become 09 §5 rail cards (3:4, radius 12, the car in Archivo, the spec line in tnum); one build takes the
 * column (3:4 on a phone, a 16:9 feature on desktop). From three builds, or while more pages follow, it is the result wall (BuildsWall) as before.
 */
export function PortfolioBuilds({ feature = false, heroPhotoId, ...wall }: PortfolioBuildsProps) {
  const styles = useStyles();
  const router = useRouter();
  const { fontScale } = useTheme();
  const open = useCallback((vehicle: FeedVehicle) => router.push(`/v/${vehicle.slug}`), [router]);
  const { vehicles, title, count, testID, width, bleed = 0 } = wall;
  const asCards = !wall.loading && !wall.hasMore && vehicles.length > 0 && vehicles.length < PORTFOLIO_WALL_FROM;
  if (!asCards) return <BuildsWall {...wall} />;

  // The wall runs edge to edge on a phone (bleed); the cards keep the column's gutter.
  const column = width - 2 * bleed;
  // DQ-1145: one build is never a half-width tile beside an empty half: it takes the column, 16:9 on desktop, 3:4 elsewhere.
  const single = vehicles.length === 1;
  const cardWidth = single ? column : railCardWidth(column, fontScale);
  return (
    <View testID={testID}>
      <View style={styles.header}>
        <SectionHeader title={title} testID={`${testID}.header`} />
        {count ? (
          <Text variant="callout" color="text.secondary" numeric testID={`${testID}.count`}>
            {count}
          </Text>
        ) : null}
      </View>
      <View role="list" style={styles.cards}>
        {vehicles.map((vehicle) => (
          <View key={vehicle.id} role="listitem" style={{ width: cardWidth }}>
            <PortfolioCard
              vehicle={vehicle}
              width={cardWidth}
              ratio={single && feature ? aspect.heroWeb : aspect.rail}
              avoid={heroPhotoId}
              onOpen={open}
              testID={`${testID}.build.${vehicle.id}`}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function PortfolioCard({
  vehicle,
  width,
  ratio,
  avoid,
  onOpen,
  testID,
}: {
  vehicle: FeedVehicle;
  width: number;
  ratio: PhotoAspect;
  avoid: string | null | undefined;
  onOpen: (vehicle: FeedVehicle) => void;
  testID: string;
}) {
  const styles = useStyles();
  const cover = useDistinctCover(vehicle, avoid);
  const name = keepNameTogether(vehicle.full_title);
  const spec = railSpec(vehicle);
  const content = (hovered: boolean): ReactNode => (
    <>
      <Photo {...photoFields(cover, width)} aspect={ratio} corner="md" testID={`${testID}.photo`}>
        {hovered ? <View style={styles.hover} /> : null}
        <SampleBadges flags={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }} tone="onPhoto" style={styles.badges} testID={`${testID}.sample`} />
      </Photo>
      <View style={styles.text}>
        {/* Cars speak Archivo (SKILL §3); a car name is never cut (ADR-128). */}
        <Text variant="displayWordmark" hyphenate={false} testID={`${testID}.title`}>
          {name}
        </Text>
        {spec ? (
          <Text variant="caption" color="text.secondary" numeric hyphenate={false} testID={`${testID}.spec`}>
            {spec}
          </Text>
        ) : null}
      </View>
    </>
  );
  return (
    <PressableScale role="link" aria-label={isWeb ? undefined : joinLabel([name, spec])} onPress={() => onOpen(vehicle)} ring="card" testID={testID}>
      {(state) => content(state.hovered)}
    </PressableScale>
  );
}
