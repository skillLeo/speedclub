import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useInsights, type Insights, type WeekPair } from '@/api/queries/insights';
import { QrColumns } from '@/features/qr/components/parts';
import { QrPage } from '@/features/qr/components/QrPage';
import { profileShareUrl, shareLink, vehicleShareUrl } from '@/features/profile/share';
import { photoFields } from '@/features/vehicle/media';
import { keepNameTogether } from '@/lib/format';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, space, useBreakpoint } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { ListRow } from '@/ui/ListRow';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { RowGroup } from '@/ui/RowGroup';

import { INSIGHTS_CHART_HEIGHT, InsightsChart, InsightsSampleChart } from '../components/InsightsChart';
import { countingSinceInside, deltaLine, isQuiet, reactionSummary, topSources } from '../model';
import { insightsHref, INSIGHTS_ROUTE } from '../navigation';
import { zeroInsights } from '../zero';

const ROUTE = INSIGHTS_ROUTE;
const THUMB = size.thumb.row;

const useStyles = createStyles((t) => ({
  headline: { marginBottom: t.space[24] },
  kpis: { columnGap: t.space[32], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[16] },
  kpi: { gap: t.space[4] },
  numeral: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  chart: { gap: t.space[12], marginTop: t.space[32] },
  // DQ-P5-035 a: the chart's header on the same inset as the grouped lists' headers (RowGroup: 16 inside the card's edge).
  chartTitle: { paddingHorizontal: t.space[16] },
  sampleHead: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: t.space[16], rowGap: t.space[4] },
  group: { marginTop: t.space[32] },
  groupBeside: { marginTop: t.space[0] },
  privacy: { marginTop: t.space[16] },
  quietAction: { alignSelf: 'flex-start', marginTop: t.space[24] },
  skeletonAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  skeletonChart: { gap: t.space[8] },
}));

const week = (pair: WeekPair | null | undefined) => pair ?? null;

/**
 * The loaded page's geometry (DQ-P5-020): the sentence, the three numbers, the chart's header, plot, date axis and legend, then each
 * group with its header and period caption above its rows. The labels and headings are the page's own static words (not data): with
 * them the numbers row wraps exactly as the page's does in every language and at every font size ("AUFRUFE 30 TAGE" on a second line
 * at 393, which the bars of fixed widths did not, 74 px).
 */
function InsightsSkeleton({ scope }: { scope: 'account' | 'vehicle' }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.headline}>
        <SkeletonText variant="body" lines={2} />
      </View>
      <View style={styles.kpis}>
        <View style={styles.kpi}>
          <Text variant="labelCaps" color="text.secondary">
            {t('insights.thisWeek')}
          </Text>
          <SkeletonText variant="heroNumeral" width={space[80]} />
        </View>
        <View style={styles.kpi}>
          <Text variant="labelCaps" color="text.secondary">
            {t('insights.lastWeek')}
          </Text>
          <SkeletonText variant="heroNumeralS" width={space[48]} />
        </View>
        <View style={styles.kpi}>
          <Text variant="labelCaps" color="text.secondary">
            {t('insights.days30')}
          </Text>
          <SkeletonText variant="heroNumeralS" width={space[64]} />
        </View>
      </View>
      <View style={styles.chart}>
        <Text variant="calloutStrong" color="text.secondary" style={styles.chartTitle}>
          {t('insights.chart.title')}
        </Text>
        <View style={styles.skeletonChart}>
          <SkeletonBlock height={INSIGHTS_CHART_HEIGHT} corner="sm" />
          <View style={styles.skeletonAxis}>
            <SkeletonText variant="caption" width={space[48]} />
            <SkeletonText variant="caption" width={space[48]} />
          </View>
          <SkeletonText variant="caption" width="45%" testID={`${ROUTE}.skeleton.legend`} />
        </View>
      </View>
      <RowGroup title={t('insights.sources.title')} caption={t('insights.sources.caption')} style={styles.group}>
        <SkeletonBlock height={size.row.single * 4} corner="md" />
      </RowGroup>
      <RowGroup title={t('insights.week.title')} caption={t('insights.week.caption')} style={styles.group}>
        <SkeletonBlock height={size.row.withThumb * (scope === 'account' ? 6 : 5)} corner="md" />
      </RowGroup>
    </Skeleton>
  );
}

/** One row of "Diese Woche": this week's number, last week's as a plain line (never a loss word). */
function WeekRow({ title, pair, subtitle, divider, testID }: { title: string; pair: WeekPair; subtitle?: string | null; divider: boolean; testID: string }) {
  const { t } = useTranslation('profile');
  const format = useFormat();
  const lastWeek = t('insights.week.lastWeek', { value: format.number(pair.last_week) });
  return (
    <ListRow
      title={title}
      // DQ-P5-035 b: last week's number keeps its own line under a breakdown ("Stark 9 · Sauber 6 …"), never "· Letzte Woche" at a line start.
      subtitle={subtitle ? `${lastWeek}\n${subtitle}` : lastWeek}
      value={format.number(pair.this_week)}
      adaptiveValue={false}
      inset={space[16]}
      divider={divider}
      testID={testID}
    />
  );
}

function PrivacyNote() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  return (
    <>
      <Hairline style={styles.privacy} />
      <Text variant="caption" color="text.tertiary" style={styles.privacy} testID={`${ROUTE}.privacy`}>
        {t('insights.privacy')}
      </Text>
    </>
  );
}

function useShareOwnPage(insights: Insights) {
  const { t } = useTranslation('profile');
  const username = useSessionStore((state) => state.member?.username ?? null);
  const [sharing, setSharing] = useState(false);
  const vehicle = insights.vehicle;
  const url = vehicle ? vehicleShareUrl(vehicle.slug) : username ? profileShareUrl(username) : null;
  const share = async () => {
    if (!url) return;
    setSharing(true);
    try {
      const outcome = await shareLink({ url, title: vehicle ? vehicle.full_title : t('insights.shareProfileTitle') });
      if (outcome === 'copied') toast(t('insights.copied'), { testID: `${ROUTE}.toast` });
      if (outcome === 'failed') toast(t('insights.shareFailed', { url }), { testID: `${ROUTE}.toast` });
    } finally {
      setSharing(false);
    }
  };
  return { share: url ? share : null, sharing };
}

/**
 * Nothing counted in the 30 days (DQ-P5-019, DQ-P5-036): one sentence, what will show here and why sharing helps (its verb and object
 * the button's: "Teil dein Profil" over "Profil teilen"), a badged "Beispiel" of the curve in a neutral tone (no numbers, no dates),
 * and one way on. Never an empty chart frame, never counters of zeros. The page's own words, since the server's zero sentence names a
 * build on the profile's page too.
 */
function QuietBody({ insights }: { insights: Insights }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const { share, sharing } = useShareOwnPage(insights);
  return (
    <View testID={`${ROUTE}.quiet`}>
      <Text variant="title2" role="heading" aria-level={2} testID={`${ROUTE}.headline`}>
        {t('insights.quietTitle')}
      </Text>
      <Text variant="body" color="text.secondary" style={styles.privacy}>
        {insights.vehicle ? t('insights.quietBodyVehicle') : t('insights.quietBodyAccount')}
      </Text>
      <View style={styles.chart} testID={`${ROUTE}.sample`}>
        <View style={styles.sampleHead}>
          <Text variant="calloutStrong" color="text.secondary">
            {t('insights.chart.title')}
          </Text>
          <SampleBadge testID={`${ROUTE}.sample.badge`} />
        </View>
        <InsightsSampleChart testID={`${ROUTE}.sample.chart`} />
      </View>
      {share ? (
        <Button
          label={insights.vehicle ? t('insights.shareVehicle') : t('insights.shareProfile')}
          variant="secondary"
          size="m"
          icon="share-network"
          loading={sharing}
          style={styles.quietAction}
          onPress={() => void share()}
          testID={`${ROUTE}.share`}
        />
      ) : null}
      <PrivacyNote />
    </View>
  );
}

function InsightsBody({ insights }: { insights: Insights }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const { kind } = useBreakpoint();
  const n = (value: number) => format.number(value);
  const since = countingSinceInside(insights);
  const sources = topSources(insights);
  const reactions = reactionSummary(insights, format);

  const weekRows: { key: string; title: string; pair: WeekPair; subtitle?: string | null }[] = [];
  if (insights.sticker_scans) weekRows.push({ key: 'scans', title: t('insights.week.scans'), pair: insights.sticker_scans });
  const spots = week(insights.spots);
  if (spots) weekRows.push({ key: 'spots', title: t('insights.week.spots'), pair: spots });
  const profileFollows = week(insights.follows.profile);
  if (profileFollows) weekRows.push({ key: 'followers', title: t('insights.week.followers'), pair: profileFollows });
  weekRows.push({ key: 'vehicleFollowers', title: t('insights.week.vehicleFollowers'), pair: insights.follows.vehicles });
  weekRows.push({ key: 'saves', title: t('insights.week.saves'), pair: insights.saves });
  weekRows.push({ key: 'reactions', title: t('insights.week.reactions'), pair: insights.reactions, subtitle: reactions });

  const main = (
    <>
      <Text variant="body" style={styles.headline} testID={`${ROUTE}.headline`}>
        {insights.headline}
      </Text>
      {/* DQ-P5-018: every number names its period. This week beside last week as a plain number (10 §16: a drop is never a percentage or
          a loss word) and the 30 days; the comparison in words lives once, in the sentence above. */}
      <View style={styles.kpis}>
        <View style={styles.kpi}>
          <Text variant="labelCaps" color="text.secondary">
            {t('insights.thisWeek')}
          </Text>
          <Text variant="heroNumeral" numeric testID={`${ROUTE}.thisWeek`}>
            {n(insights.views.this_week)}
          </Text>
        </View>
        <View style={styles.kpi} testID={`${ROUTE}.delta`}>
          <Text variant="labelCaps" color="text.secondary">
            {t('insights.lastWeek')}
          </Text>
          <Text variant="heroNumeralS" numeric testID={`${ROUTE}.lastWeek`}>
            {n(insights.views.last_week)}
          </Text>
        </View>
        <View style={styles.kpi}>
          <Text variant="labelCaps" color="text.secondary">
            {t('insights.days30')}
          </Text>
          <Text variant="heroNumeralS" numeric testID={`${ROUTE}.total30`}>
            {n(insights.views.total_30_days)}
          </Text>
        </View>
      </View>
      {insights.headline ? null : (
        <Text variant="callout" color="text.secondary" style={styles.privacy} testID={`${ROUTE}.deltaLine`}>
          {deltaLine(t, insights.views, format)}
        </Text>
      )}
      <View style={styles.chart}>
        <Text variant="calloutStrong" color="text.secondary" role="heading" aria-level={2} style={styles.chartTitle}>
          {t('insights.chart.title')}
        </Text>
        <InsightsChart insights={insights} testID={`${ROUTE}.chart`} />
        {since ? (
          <Text variant="caption" color="text.tertiary" testID={`${ROUTE}.countingSince`}>
            {t('insights.countingSince', { date: format.dayMonth(new Date(`${since}T12:00:00`)) })}
          </Text>
        ) : null}
      </View>
    </>
  );

  const side = (
    <>
      <RowGroup title={t('insights.sources.title')} caption={t('insights.sources.caption')} style={[styles.group, kind === 'desktop' ? styles.groupBeside : null]} testID={`${ROUTE}.sources`}>
        {sources.map((row, index) => (
          <ListRow
            key={row.source}
            title={row.label}
            value={row.percent === null ? n(row.views) : t('insights.sources.value', { views: n(row.views), percent: n(row.percent) })}
            inset={space[16]}
            divider={index < sources.length - 1}
            testID={`${ROUTE}.source.${row.source}`}
          />
        ))}
      </RowGroup>
      <RowGroup title={t('insights.week.title')} caption={t('insights.week.caption')} style={styles.group} testID={`${ROUTE}.week`}>
        {weekRows.map((row, index) => (
          <WeekRow key={row.key} title={row.title} pair={row.pair} subtitle={row.subtitle} divider={index < weekRows.length - 1} testID={`${ROUTE}.week.${row.key}`} />
        ))}
      </RowGroup>
      {insights.scope === 'account' && insights.breakdown.length > 0 ? (
        <RowGroup title={t('insights.breakdown.title')} caption={t('insights.breakdown.caption')} style={styles.group} testID={`${ROUTE}.breakdown`}>
          {insights.breakdown.map((row, index) => {
            const divider = index < insights.breakdown.length - 1;
            const value = t('insights.breakdown.value', { count: row.views_this_week, value: n(row.views_this_week) });
            if (row.subject === 'profile' || !row.vehicle) {
              return <ListRow key="profile" icon="user" title={t('insights.breakdown.profile')} value={value} inset={space[16]} divider={divider} testID={`${ROUTE}.breakdown.profile`} />;
            }
            const vehicle = row.vehicle;
            return (
              <ListRow
                key={vehicle.id}
                thumb={photoFields(vehicle.cover, THUMB)}
                title={keepNameTogether(vehicle.full_title)}
                value={value}
                onPress={() => router.push(insightsHref(vehicle.id))}
                inset={space[16]}
                divider={divider}
                testID={`${ROUTE}.breakdown.${vehicle.id}`}
              />
            );
          })}
        </RowGroup>
      ) : null}
      <PrivacyNote />
    </>
  );

  return <QrColumns testID={`${ROUTE}.columns`} main={main} side={side} />;
}

/** A guest: sign in, then back here. */
function GuestState() {
  const { t } = useTranslation('profile');
  const pathname = usePathname();
  const requireAuth = useRequireAuth();
  return (
    <EmptyState
      icon="chart-bar"
      title={t('insights.guest.title')}
      body={t('insights.guest.body')}
      action={{ label: t('insights.guest.signIn'), onPress: () => requireAuth(undefined, { returnTo: pathname }) }}
      testID={`${ROUTE}.guest`}
    />
  );
}

export type InsightsScreenProps = { scope: 'account' | 'vehicle' };

/**
 * INS-01 "Statistiken" (10 §6.1, m5.7-contract §3): from Profil the member's profile and every car, from the owner's vehicle that car.
 * This week against the week before in plain words (a drop is never a percentage or a loss word, 10 §16), the 30 days as one accent
 * line with the sticker scans as a neutral one, where the views came from, this week's scans, spots, new followers, saves and
 * reactions, and the server's sentence on top. Sums only, never who viewed. Owner-only: another member's car, and staff in view-as
 * (403 `view_as_read_only`), get the restricted state.
 */
export function InsightsScreen({ scope }: InsightsScreenProps) {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const params = useLocalSearchParams<{ id?: string }>();
  const vehicleId = scope === 'vehicle' && typeof params.id === 'string' ? params.id : '';
  const query = useInsights(scope === 'account' ? { kind: 'account' } : { kind: 'vehicle', vehicleId });
  const data = query.data;
  const error = query.error instanceof ApiError ? query.error : null;
  const forbidden = !data && error?.status === 403;

  let body: ReactNode;
  if (status === 'guest') {
    body = <GuestState />;
  } else if (qaState === 'loading' || status === 'loading' || (!data && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) {
    body = <InsightsSkeleton scope={scope} />;
  } else if (qaState === 'restricted' || (forbidden && error?.code === 'view_as_read_only')) {
    body = (
      <EmptyState icon="lock-simple" title={t('insights.restricted.title')} body={t('insights.restricted.body')} testID={`${ROUTE}.restricted`} />
    );
  } else if (!data && error?.status === 404 && error.code === 'feature_disabled') {
    body = <EmptyState icon="chart-bar" title={t('insights.disabled.title')} body={t('insights.disabled.body')} testID={`${ROUTE}.disabled`} />;
  } else if (forbidden || (!data && error?.status === 404)) {
    body = (
      <EmptyState
        icon="chart-bar"
        title={t('insights.unavailable.title')}
        body={t('insights.unavailable.body')}
        action={{ label: t('insights.unavailable.garage'), onPress: () => router.navigate('/garage'), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.unavailable`}
      />
    );
  } else if (qaState === 'error' || (!data && qaState !== 'empty')) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('insights.offlineTitle') : t('insights.errorTitle')}
        message={offline ? t('insights.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    const shown = qaState === 'empty' || !data ? zeroInsights(data, now(), t('insights.quietTitle')) : data;
    body = isQuiet(shown) ? <QuietBody insights={shown} /> : <InsightsBody insights={shown} />;
  }

  const subtitle = scope === 'vehicle' ? (data?.vehicle?.full_title ? keepNameTogether(data.vehicle.full_title) : null) : t('insights.accountSubtitle');
  return (
    <QrPage
      routeId={ROUTE}
      title={t('insights.title')}
      subtitle={subtitle}
      subtitlePending={scope === 'vehicle' && !data && query.isPending && status === 'member'}
      fallback={scope === 'vehicle' && vehicleId ? `/garage/${vehicleId}` : '/profile'}
      offlineLabel={t('insights.offlineBanner')}
      wide
    >
      {body}
    </QrPage>
  );
}
