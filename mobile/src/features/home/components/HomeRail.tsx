import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { useDiscover, type MakeTile } from '@/api/queries/discover';
import { useMyVehicles } from '@/api/queries/profile';
import { searchPath } from '@/features/discover/navigation';
import { profileVehicles } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, space, typography, useTheme } from '@/theme';
import { Button, estimateLines, ListRow, SectionHeader, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';

const ROUTE = 'HOME-01';
/** Discover shortcuts on the rail (§5): the makes with the most public builds. */
export const RAIL_MAKES = 5;
/** ListRow's own rule: from this font scale an adaptive value always takes its own line. */
const STACKED_VALUE_FONT_SCALE = 1.5;

/**
 * The height of one rail row at a font scale, for the skeleton: a 56 row while title and value share the line, and from
 * 150 % the value under the title, as ListRow's `adaptiveValue` lays them out, with 8 above and below.
 */
export function railRowHeight(fontScale: number): number {
  const lines =
    fontScale >= STACKED_VALUE_FONT_SCALE
      ? (typography.body.lineHeight + typography.supporting.lineHeight) * fontScale
      : typography.body.lineHeight * fontScale;
  return Math.max(fontScale >= STACKED_VALUE_FONT_SCALE ? size.row.withThumb : size.row.single, lines + 2 * space[8]);
}

/** Typical length of "Über SPEED CLUB" in German, for its skeleton. */
const ABOUT_CHARS = 150;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { gap: t.space[32], paddingBottom: t.space[32], paddingTop: t.space[16] },
  fromTop: { paddingTop: t.space[0] },
  header: { paddingBottom: t.space[12] },
  group: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  about: { gap: t.space[8] },
  aboutAction: { alignSelf: 'flex-start', marginTop: t.space[8] },
  skeletonTitle: { paddingBottom: t.space[12] },
  skeletonAction: { marginTop: t.space[8] },
}));

export type HomeRailSkeletonProps = {
  /** The rail's width, for the skeleton's line count. */
  width: number;
  /** Where the rail starts: the segmented control's top edge (DQ-297). The 16 of the content otherwise. */
  top?: number;
};

export type HomeRailProps = {
  /** DQ-199: scrolls with the page, instead of being a second scroller beside the feed. */
  inPage?: boolean;
  /** Where the rail starts: the segmented control's top edge (DQ-297). The 16 of the content otherwise. */
  top?: number;
};

/**
 * HOME-01 from 1280 (§5 "feed column 640 + right rail (Discover shortcuts, your garage)"): the makes with the most public
 * builds as shortcuts into the search, then "Deine Garage" for members and a short, true "Über SPEED CLUB" for guests.
 * The featured build stays at the top of the column, as on every other width, so no build is shown twice (DQ-188). Only
 * real numbers, never stats.
 */
export function HomeRail({ inPage = false, top }: HomeRailProps) {
  const { t } = useTranslation('home');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const discover = useDiscover();
  const garage = useMyVehicles();
  const makes: readonly MakeTile[] = (discover.data?.makes ?? []).slice(0, RAIL_MAKES);
  // BH-45: the Profile's number. Drafts and archived vehicles stay in the Garage tab; no value until the garage has answered.
  const vehicleCount = garage.data && profileVehicles(garage.data).length;
  // The makes answer after the feed: their place is held, so the garage below does not jump when they arrive.
  const makesPending = discover.isPending && discover.fetchStatus !== 'paused';

  const content = (
    <>
      {makesPending ? <MakesSkeleton /> : null}
      {makes.length > 0 ? (
        <View>
          <SectionHeader
            title={t('rail.makes')}
            actionLabel={t('rail.allMakes')}
            actionAccessibilityLabel={t('rail.allMakesLabel')}
            onAction={() => router.navigate('/discover')}
            style={styles.header}
            testID={`${ROUTE}.rail.makes`}
          />
          <View style={styles.group}>
            {makes.map((make, index) => (
              <ListRow
                key={make.id}
                title={keepNameTogether(make.name)}
                hyphenate={false}
                adaptiveValue
                value={t('rail.makeCount', { count: make.vehicle_count, formatted: format.number(make.vehicle_count) })}
                onPress={() => router.navigate(searchPath(make.name))}
                inset={space[16]}
                divider={index < makes.length - 1}
                testID={`${ROUTE}.rail.make.${make.slug}`}
              />
            ))}
          </View>
        </View>
      ) : null}
      {status === 'member' ? (
        <View testID={`${ROUTE}.rail.garage`}>
          <SectionHeader title={t('rail.garageTitle')} style={styles.header} />
          <View style={styles.group}>
            <ListRow
              icon="garage"
              title={t('rail.garageOpen')}
              adaptiveValue
              value={
                // DQ-311: no "0 Fahrzeuge". An empty garage is the Garage tab's designed first run (FS-4); "Fahrzeug hinzufügen" stays
                // the sidebar's, beside this rail on every width that has one (DQ-206).
                vehicleCount === undefined || vehicleCount === 0
                  ? undefined
                  : t('rail.vehicleCount', { count: vehicleCount, formatted: format.number(vehicleCount) })
              }
              onPress={() => router.navigate('/garage')}
              inset={space[16]}
              testID={`${ROUTE}.rail.garage.open`}
            />
          </View>
        </View>
      ) : null}
      {status === 'guest' ? (
        <View style={styles.about} testID={`${ROUTE}.rail.about`}>
          <SectionHeader title={t('rail.aboutTitle')} />
          <Text variant="bodyDense" color="text.secondary">
            {t('rail.aboutBody')}
          </Text>
          <Button
            label={t('rail.join')}
            variant="secondary"
            size="m"
            onPress={() => requireAuth(undefined, { returnTo: '/' })}
            style={styles.aboutAction}
            testID={`${ROUTE}.rail.join`}
          />
        </View>
      ) : null}
    </>
  );
  // DQ-297: a spacer as tall as the large title, not a padding of that measured height, which is off the spacing scale.
  const body = (
    <>
      {top === undefined ? null : <View style={{ height: top }} />}
      <View style={[styles.content, top === undefined ? null : styles.fromTop]}>{content}</View>
    </>
  );
  return inPage ? (
    <View testID={`${ROUTE}.rail`}>{body}</View>
  ) : (
    <ScrollView style={styles.scroll} testID={`${ROUTE}.rail`}>
      {body}
    </ScrollView>
  );
}

/** The makes group of the rail, in its loaded geometry. */
function MakesSkeleton() {
  const styles = useStyles();
  const { fontScale } = useTheme();
  return (
    <Skeleton testID={`${ROUTE}.rail.makes.skeleton`}>
      <SkeletonText variant="titleS" width="30%" style={styles.skeletonTitle} />
      <SkeletonBlock height={RAIL_MAKES * railRowHeight(fontScale)} corner="md" />
    </Skeleton>
  );
}

/** DQ-191: the rail while Start loads, in the loaded rail's geometry: the makes group, then the garage or the about block. */
export function HomeRailSkeleton({ width, top }: HomeRailSkeletonProps) {
  const styles = useStyles();
  const { fontScale } = useTheme();
  const status = useSessionStore((state) => state.status);
  const aboutLines = estimateLines(ABOUT_CHARS, 'bodyDense', fontScale, width);
  return (
    <Skeleton testID={`${ROUTE}.rail.skeleton`} style={styles.scroll}>
      {top === undefined ? null : <View style={{ height: top }} />}
      <View style={[styles.content, top === undefined ? null : styles.fromTop]}>
        <View>
          <SkeletonText variant="titleS" width="30%" style={styles.skeletonTitle} />
          <SkeletonBlock height={RAIL_MAKES * railRowHeight(fontScale)} corner="md" />
        </View>
        {status === 'member' ? (
          <View>
            <SkeletonText variant="titleS" width="45%" style={styles.skeletonTitle} />
            {/* "Zur Garage" with its count. "Fahrzeug hinzufügen" is the sidebar's, beside this rail on every width that has one (DQ-206). */}
            <SkeletonBlock height={railRowHeight(fontScale)} corner="md" />
          </View>
        ) : status === 'guest' ? (
          <View style={styles.about}>
            <SkeletonText variant="titleS" width="50%" />
            <SkeletonText variant="bodyDense" lines={aboutLines} />
            <SkeletonBlock width="45%" height={size.button.m} corner="sm" style={styles.skeletonAction} />
          </View>
        ) : null}
      </View>
    </Skeleton>
  );
}
