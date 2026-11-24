import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useVehicle } from '@/api/queries/garage';
import { isAnonymous, spotSettingsOf, STREET_FAMOUS_TIERS, useSpotStats, type SpotStats } from '@/api/queries/dex';
import { estimatedPane, useDiscoverColumn, wideWallWidth } from '@/features/discover/layout';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { qa, useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { photoFields } from '@/features/vehicle/media';
import { aspect, createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Header } from '@/ui/Header';
import { ListRow } from '@/ui/ListRow';
import { MemberRow } from '@/ui/MemberRow';
import { Photo, type PhotoFields } from '@/ui/Photo';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';
import { Screen } from '@/ui/Screen';
import { SectionHeader } from '@/ui/SectionHeader';
import { estimateLines, Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { ratioOf } from '@/ui/Photo';
import { RowGroup } from '@/ui/RowGroup';

import { CHART_HEIGHT, SpotBars } from '../components/SpotBars';
import { spotSettingsRoute } from '../navigation';
import { qaDexActive, qaSpotStats } from '../qaDex';

const ROUTE = 'DEX-06';
const EDGES: readonly Edge[] = ['left', 'right'];

/** The cities the loading state draws rows for: the six a car's page usually lists. */
const SKELETON_CITIES = 6;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { gap: t.space[32], paddingBottom: t.space[32], paddingTop: t.space[8] },
  // DQ-P5G-06: whose numbers these are, as the car's 16:9 cover into the dark stage (ADR-421 b) with its name on the stage.
  hero: { backgroundColor: t.color.scrim.photoEnd, overflow: 'hidden' },
  heroInset: { borderRadius: t.radius.xl },
  identity: { paddingBottom: t.space[20], paddingHorizontal: t.layout.cardPadding },
  // DQ-P5G-20: from 1280 the 12-column grid's 8/4 split, the numbers left and the people and settings right.
  wide: { alignSelf: 'flex-start', width: '100%' },
  desktop: { flexDirection: 'row', gap: t.space[32] },
  main: { flex: 2, gap: t.space[32], minWidth: 0 },
  side: { flex: 1, gap: t.space[32], minWidth: 0 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[24] },
  kpi: { gap: t.space[4], minWidth: t.size.railCard / 2 },
  section: { gap: t.space[12] },
  famous: { gap: t.space[4] },
  note: { paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
  // DQ-P5G-19: the sample takes the column's width, so its bars and axis are the real chart's.
  preview: { alignItems: 'stretch', gap: t.space[12], width: '100%' },
  previewBadge: { alignSelf: 'flex-start' },
  skeleton: { gap: t.space[32] },
  skeletonKpis: { flexDirection: 'row', gap: t.space[24] },
  // SpotBars' own gap between the chart and its end labels.
  skeletonDays: { gap: t.space[8] },
}));

/** The next Street Famous step above the current number of unique spotters, or null past the last one. */
export function nextFamousTier(uniqueSpotters: number): number | null {
  return STREET_FAMOUS_TIERS.find((tier) => tier > uniqueSpotters) ?? null;
}

function Kpi({ value, label, testID }: { value: string; label: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.kpi} accessible aria-label={`${value} ${label}`} testID={testID}>
      <Text variant="heroNumeralS" numeric hyphenate={false} aria-hidden>
        {value}
      </Text>
      <Text variant="labelCaps" color="text.secondary" aria-hidden>
        {label}
      </Text>
    </View>
  );
}

/** A sample Street Famous step for the skeleton's body lines (the words the loaded block usually says). */
const SKELETON_FAMOUS_TIER = 10;
const SKELETON_FAMOUS_NEXT = 50;
/** The spotters the skeleton's side block draws: the three the page lists. */
const SKELETON_SPOTTERS = 3;

/**
 * The loading state in the loaded page's geometry (DQ-P5G-44): the KPIs, the Street Famous title and its body lines (as many as the
 * real words take at this width and font scale), "Letzte 30 Tage" over the chart and its end labels (SpotBars' 8 gap), the cities
 * with their night line; from 1280 the 8/4 columns with "Zuletzt gespottet von" on the right. Every block starts at its real y.
 */
function OwnerSpotsSkeleton({ textWidth, wide }: { textWidth: number; wide: boolean }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const format = useFormat();
  const { fontScale } = useTheme();
  const famousBody = `${t('owner.famous.body', { tier: format.number(SKELETON_FAMOUS_TIER) })} ${t('owner.famous.next', { next: format.number(SKELETON_FAMOUS_NEXT) })}`;
  const famousLines = estimateLines(famousBody.length, 'callout', fontScale, textWidth);
  const nightLines = estimateLines(t('owner.cities.night').length, 'caption', fontScale, textWidth);
  const main = (
    <>
      <View style={styles.skeletonKpis}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.kpi}>
            <SkeletonText variant="heroNumeralS" width={size.railCard / 2} />
            <SkeletonText variant="labelCaps" width={size.railCard / 3} />
          </View>
        ))}
      </View>
      <View style={styles.famous}>
        <SkeletonText variant="headline" width="45%" />
        <SkeletonText variant="callout" lines={famousLines} width="100%" lastLineWidth="70%" />
      </View>
      <View style={styles.section}>
        <SkeletonText variant="headline" width="40%" />
        <View style={styles.skeletonDays}>
          <SkeletonBlock width="100%" height={CHART_HEIGHT} corner="xs" />
          <SkeletonText variant="caption" width="100%" />
        </View>
      </View>
      <View style={styles.section}>
        <SkeletonText variant="headline" width="25%" />
        <SkeletonBlock width="100%" height={size.row.single * SKELETON_CITIES} corner="md" />
        <SkeletonText variant="caption" lines={nightLines} width="100%" lastLineWidth="60%" />
      </View>
    </>
  );
  if (!wide) {
    return (
      <Skeleton testID={`${ROUTE}.skeleton`} style={styles.skeleton}>
        {main}
      </Skeleton>
    );
  }
  return (
    <Skeleton testID={`${ROUTE}.skeleton`} style={styles.desktop}>
      <View style={styles.main}>{main}</View>
      <View style={styles.side}>
        <View style={styles.section}>
          <SkeletonText variant="headline" width="60%" />
          <SkeletonBlock width="100%" height={size.row.single * SKELETON_SPOTTERS} corner="md" />
        </View>
        <SkeletonBlock width="100%" height={size.row.single} corner="md" />
      </View>
    </Skeleton>
  );
}

/** The numbers, the month, the cities and who spotted the car: the loaded page (8/4 from 1280, one column below). */
function StatsBody({ stats, vehicleId, citiesHidden, wide }: { stats: SpotStats; vehicleId: string; citiesHidden: boolean; wide: boolean }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const today = qa.now ?? new Date();
  const tier = stats.street_famous.tier;
  const next = nextFamousTier(stats.unique_spotters);
  const main = (
    <>
      <View style={styles.kpis} testID={`${ROUTE}.kpis`}>
        <Kpi value={format.number(stats.total)} label={t('owner.kpi.total')} testID={`${ROUTE}.total`} />
        <Kpi value={format.number(stats.unique_spotters)} label={t('owner.kpi.people')} testID={`${ROUTE}.people`} />
        {citiesHidden ? null : <Kpi value={format.number(stats.cities_count)} label={t('owner.kpi.cities')} testID={`${ROUTE}.citiesCount`} />}
      </View>
      {tier ? (
        <View style={styles.famous} testID={`${ROUTE}.famous`}>
          <Text variant="headline" numeric>
            {t('owner.famous.title', { tier })}
          </Text>
          <Text variant="callout" color="text.secondary" numeric>
            {t('owner.famous.body', { tier: format.number(tier) })}
            {next ? ` ${t('owner.famous.next', { next: format.number(next) })}` : ''}
          </Text>
        </View>
      ) : null}
      <View style={styles.section}>
        <SectionHeader title={t('owner.days.title')} testID={`${ROUTE}.days.header`} />
        <SpotBars days={stats.last_30_days} today={today} testID={`${ROUTE}.days`} />
      </View>
      <View style={styles.section} testID={`${ROUTE}.cities`}>
        <SectionHeader title={t('owner.cities.title')} />
        <RowGroup>
          {citiesHidden ? (
            <Text variant="callout" color="text.secondary" style={styles.note} testID={`${ROUTE}.cities.hidden`}>
              {t('owner.cities.hidden')}
            </Text>
          ) : stats.cities.length === 0 ? (
            <Text variant="callout" color="text.secondary" style={styles.note} testID={`${ROUTE}.cities.none`}>
              {t('owner.cities.none')}
            </Text>
          ) : (
            stats.cities.map((city, index) => (
              <ListRow
                key={city.name}
                title={city.name}
                value={format.number(city.count)}
                divider={index < stats.cities.length - 1}
                inset={space[16]}
                testID={`${ROUTE}.city.${index}`}
              />
            ))
          )}
        </RowGroup>
        {citiesHidden ? null : (
          <Text variant="caption" color="text.tertiary" testID={`${ROUTE}.cities.night`}>
            {t('owner.cities.night')}
          </Text>
        )}
      </View>
    </>
  );
  const side = (
    <>
      {stats.recent_spotters.length > 0 ? (
        <View style={styles.section} testID={`${ROUTE}.spotters`}>
          <SectionHeader title={t('owner.spotters.title')} />
          <RowGroup>
            {stats.recent_spotters.map((spotter, index) => {
              const divider = index < stats.recent_spotters.length - 1;
              if (isAnonymous(spotter)) {
                return (
                  // No monogram for "jemand": the 40 avatar slot with a person glyph, so no letter stands in for a name the spotter
                  // keeps private, and the row keeps the named rows' text edge and separator inset (DQ-P5G-57).
                  <MemberRow
                    key={`anonymous.${index}`}
                    name={t('owner.spotters.someone')}
                    meta={t('owner.spotters.someoneHelper')}
                    avatarIcon="user"
                    divider={divider}
                    testID={`${ROUTE}.spotter.${index}`}
                  />
                );
              }
              return (
                <MemberRow
                  key={spotter.username}
                  name={spotter.display_name || `@${spotter.username}`}
                  meta={spotter.display_name ? `@${spotter.username}` : undefined}
                  avatarUri={spotter.avatar?.url ?? null}
                  onPress={() => router.push(`/u/${spotter.username}`)}
                  divider={divider}
                  testID={`${ROUTE}.spotter.${index}`}
                />
              );
            })}
          </RowGroup>
        </View>
      ) : null}
      <RowGroup>
        <ListRow icon="gear-six" title={t('owner.settings')} onPress={() => router.push(spotSettingsRoute(vehicleId))} inset={space[16]} testID={`${ROUTE}.settings`} />
      </RowGroup>
    </>
  );
  if (!wide) {
    return (
      <>
        {main}
        {side}
      </>
    );
  }
  return (
    <View style={styles.desktop} testID={`${ROUTE}.columns`}>
      <View style={styles.main}>{main}</View>
      <View style={styles.side}>{side}</View>
    </View>
  );
}

/** Review SF-4: the hero's slot while the car loads, in its geometry, so the page does not jump when the cover arrives. */
function CarHeroSkeleton({ width, inset }: { width: number; inset: boolean }) {
  return <SkeletonBlock width={width} aspectRatio={ratioOf(aspect.heroWeb)} corner={inset ? 'xl' : 'none'} testID={`${ROUTE}.hero.skeleton`} />;
}

/** DQ-P5G-06: the car's cover (16:9, full-bleed on a phone, inset at radius 20 in the desktop column) and its name on the stage. */
function CarHero({ name, photo, width, inset }: { name: string; photo: PhotoFields; width: number; inset: boolean }) {
  const styles = useStyles();
  const textWidth = width - 2 * layout.cardPadding;
  return (
    <View style={[styles.hero, inset ? styles.heroInset : null, { width }]} testID={`${ROUTE}.hero`}>
      <Photo {...photo} aspect={aspect.heroWeb} priority="high" testID={`${ROUTE}.hero.photo`}>
        <PhotoStageScrim />
      </Photo>
      <View style={styles.identity}>
        <DisplayTitle placement="card" color="onPhoto.primary" layoutWidth={textWidth > 0 ? textWidth : undefined} role="heading" aria-level={2} testID={`${ROUTE}.vehicle`}>
          {name}
        </DisplayTitle>
      </View>
    </View>
  );
}

/**
 * DEX-06 Spots of one car, for its owner (contract §4/§8; embedded in INS-01 later): total, unique spotters and cities in the numeral
 * face; Street Famous; the last 30 days as bars (today the one accent); the cities of day spots (never a night city, none while the
 * owner hides them); who spotted it lately, or "jemand" for a spotter who keeps their spots to themselves; the spot settings.
 */
export function OwnerSpotsScreen() {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const inset = useTabBarInset();
  const column = useDiscoverColumn();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const vehicleId = paramOf(params.id) ?? '';
  const back = useBack(vehicleId ? `/garage/${vehicleId}` : '/garage');
  const sample = qaDexActive();
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const query = useSpotStats(sample || !live ? '' : vehicleId);
  // The car itself is always the member's own (the identity header, DQ-P5G-06); under `qaDex` only the numbers are the QA set's.
  const vehicle = useVehicle(vehicleId);
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const wide = kind === 'desktop';
  const stats = live ? (sample ? qaSpotStats() : query.data) : undefined;
  const citiesHidden = sample ? false : spotSettingsOf(vehicle.data).hide_spot_cities;
  const name = vehicle.data?.full_title ?? null;
  // From 1280 the page uses the content width (DQ-P5G-20); the hero sits over the 8 left columns.
  const wideInner = wideWallWidth(estimatedPane(kind, windowWidth), gutter);
  const heroWidth = wide ? Math.floor(((wideInner - space[32]) * 2) / 3) : kind === 'phone' ? windowWidth : column.inner;

  let body: ReactNode;
  const error = query.error instanceof ApiError ? query.error : null;
  if (status === 'guest') {
    body = (
      <EmptyState
        icon="qr-sticker"
        title={t('owner.guest.title')}
        body={t('owner.guest.body')}
        action={{ label: t('owner.guest.signIn'), onPress: () => requireAuth(undefined, { returnTo: `/vehicles/${vehicleId}/spots` }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (qaState === 'restricted' || (!sample && error?.kind === 'forbidden')) {
    // Owner only (contract §4): anybody else is told whose numbers these are, nothing more.
    body = <EmptyState icon="lock-simple" title={t('owner.restricted')} testID={`${ROUTE}.restricted`} />;
  } else if (!sample && error?.kind === 'not_found') {
    body = <EmptyState icon="qr-sticker" title={t('owner.notFound.title')} body={t('owner.notFound.body')} testID={`${ROUTE}.notFound`} />;
  } else if (qaState === 'loading' || status === 'loading' || (!stats && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error' && qaState !== 'empty')) {
    body = <OwnerSpotsSkeleton textWidth={wide ? heroWidth : column.inner} wide={wide} />;
  } else if (qaState === 'error' || (!stats && qaState !== 'empty')) {
    const offline = qaState !== 'error' && (!online || query.fetchStatus === 'paused');
    body = (
      <ErrorState
        title={offline ? t('owner.offline') : t('owner.errorTitle')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else if (qaState === 'empty' || !stats || stats.total === 0) {
    // 09 §5 "never empty": what the month will look like, badged, and the way to the sticker.
    body = (
      <EmptyState
        preview={
          <View style={styles.preview} testID={`${ROUTE}.empty.sample`}>
            <SampleBadge />
            <SpotBars days={qaSpotStats(qa.now ?? new Date()).last_30_days} today={qa.now ?? new Date()} testID={`${ROUTE}.empty.sample.days`} />
          </View>
        }
        title={t('owner.empty.title')}
        body={t('owner.empty.body')}
        action={{ label: t('owner.empty.action'), onPress: () => router.push(`/stickers/${vehicleId}`), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.empty`}
      />
    );
  } else {
    body = <StatsBody stats={stats} vehicleId={vehicleId} citiesHidden={citiesHidden} wide={wide} />;
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="compact" title={t('owner.title')} onBack={back} contentMaxWidth={column.headerWidth} contentAlign={column.headerAlign} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('owner.offline')} />
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: inset }} testID={`${ROUTE}.scroll`}>
        {kind === 'phone' ? (
          name ? (
            <CarHero name={name} photo={photoFields(vehicle.data?.cover, heroWidth)} width={heroWidth} inset={false} />
          ) : vehicle.isPending ? (
            <CarHeroSkeleton width={heroWidth} inset={false} />
          ) : null
        ) : null}
        <View style={[wide ? [styles.wide, { maxWidth: layout.contentMax + 2 * gutter, paddingHorizontal: gutter }] : column.style, styles.content]}>
          {kind !== 'phone' ? (
            name ? (
              <CarHero name={name} photo={photoFields(vehicle.data?.cover, heroWidth)} width={heroWidth} inset />
            ) : vehicle.isPending ? (
              <CarHeroSkeleton width={heroWidth} inset />
            ) : null
          ) : null}
          {body}
        </View>
      </ScrollView>
    </Screen>
  );
}
