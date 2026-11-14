import '@/features/parts/i18n';
import '@/features/events/i18n';

import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useFlag } from '@/api/queries/appConfig';
import { flattenById } from '@/api/queries/parts';
import { useBusiness, useBusinessesOn, usePortfolio, type BusinessDetail } from '@/api/queries/businesses';
import { SOCIAL_FLAGS } from '@/api/queries/social2';
import { SaveSheet } from '@/features/collections/components/SaveSheet';
import { SampleWall } from '@/features/discover/components/SampleWall';
import { WALL_COLUMNS_BY_KIND } from '@/features/discover/layout';
import { EventMap } from '@/features/events/map/EventMap';
import { CITY_ZOOM } from '@/features/events/map/mapConfig';
import { newMessageHref } from '@/features/messages/entry';
import { photoFields } from '@/features/profile/media';
import { shareLink } from '@/features/profile/share';
import { useReport } from '@/features/safety/useReport';
import { siteUrl } from '@/features/settings/markdown/links';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { estimatedContentWidth, ProfileFrame, useEstimatedOverlayHeight } from '@/features/vehicle/components/ProfileFrame';
import { GroupHeader, RowCard } from '@/features/vehicle/components/RowCard';
import { DESKTOP_CARD_FLEX, DESKTOP_GALLERY_FLEX, heroIdentityOverlap, useSticky } from '@/features/vehicle/layout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { concentric, createStyles, layout, size, space, typography, typographyDesktop, useBreakpoint, useTheme } from '@/theme';
import {
  Badge,
  Button,
  Chip,
  Header,
  Hairline,
  Photo,
  PhotoStageScrim,
  PhotoTopScrim,
  SampleBadge,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  ListRow,
  Text,
  toast,
  useCollapsingHeader,
  type HeaderAction,
} from '@/ui';
import { identifierText } from '@/ui/textBreaks';

import { OpeningHours } from '../components/business/OpeningHours';
import { PortfolioBuilds } from '../components/business/PortfolioBuilds';
import { PageStateBody, pageStateOf } from '../components/PageStates';
import { addressLines, businessHero, hasHours, impressumRows, phoneUrl, routeUrl, websiteLabel, websiteUrl } from '../model';
import { openUrl } from '../openUrl';

const ROUTE = 'BIZ-01';
const HERO_RATIO = 16 / 9;
const MAP_HEIGHT = size.avatar.xl * 2;
/**
 * DQ-1157: the about text's measure, about 70 characters: Inter's average advance is close to half an em, so 35 em of the body size
 * (scaled with the font). Until a measure token exists in tokens.json, it is derived from the body role, never a pixel literal.
 */
const MEASURE_EM = 35;
/** DQ-1153: the skeleton's service chips fill two rows, its about text three lines. */
const SKELETON_CHIP_ROWS = 2;
const SKELETON_ABOUT_LINES = 3;

/** DOM audit: the identity's negative margin reaches up to the photo's large-text-safe line (ADR-421 b), a layout result. */
const SCRIM_OVERLAP = { qaExempt: 'scrim-overlap' } as const;

const useStyles = createStyles((t) => ({
  column: { alignSelf: 'flex-start', gap: t.space[32], maxWidth: layout.feedColumn, paddingBottom: t.space[32], paddingTop: t.space[24], width: '100%' },
  hero: { alignSelf: 'center', maxWidth: layout.fullBleedMax, width: '100%' },
  identity: { gap: t.space[12] },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[16] },
  nameText: { flex: 1, gap: t.space[4], minWidth: 0 },
  logo: { borderRadius: t.radius.md, height: t.size.avatar.lg, overflow: 'hidden', width: t.size.avatar.lg },
  // DQ-1154: on the stage the initial tile is the photo chip ground (every theme, ADR-421 b), never a light square on the scrim.
  // DQ-1154: "Werkstatt · Hamburg" and Verifiziert (or Beispiel) on one line; a badge that does not fit wraps whole.
  subline: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  sublineBadge: { alignSelf: 'center' },
  services: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  section: { gap: t.space[12] },
  impressumRow: { gap: t.space[2], paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
  place: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  placeBody: { gap: t.space[4], padding: t.space[16] },
  placeAction: { alignSelf: 'flex-start', marginTop: t.space[8] },
  note: { marginTop: t.space[4] },
  stage: { alignSelf: 'center', backgroundColor: t.color.scrim.photoEnd, maxWidth: layout.fullBleedMax, width: '100%' },
  stageIdentity: { gap: t.space[12], justifyContent: 'flex-end', paddingBottom: t.space[24] },
  desktopRow: { alignItems: 'stretch', alignSelf: 'center', flexDirection: 'row', gap: t.space[24], maxWidth: layout.contentMax + 2 * t.space[24], padding: t.space[24], width: '100%' },
  desktopMain: { flex: DESKTOP_GALLERY_FLEX, gap: t.space[32], minWidth: 0 },
  desktopAside: { flex: DESKTOP_CARD_FLEX, minWidth: 0 },
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[16], padding: t.space[24] },
  cardMap: { borderRadius: concentric(t.radius.md, t.space[24]), overflow: 'hidden' },
  centred: { flexGrow: 1, justifyContent: 'center' },
  skeletonHeader: { left: 0, position: 'absolute', right: 0, top: 0 },
  skeletonRow: { alignItems: 'center', flexDirection: 'row', gap: t.space[16] },
  skeletonIdentity: { gap: t.space[12] },
  skeletonChips: { gap: t.space[8] },
}));

/**
 * BIZ-01 Betriebsprofil ★ `/b/[slug]` (09 §7.11, §8.10, ADR-414): header pattern (b) over the 16:9 cover, logo 56, the name in title.1,
 * "Werkstatt · München" with Verifiziert, service chips, "Nachricht" (the one filled CTA), opening hours with today highlighted, the
 * address with the map snippet (behind "Karte anzeigen") and "Route", phone and website, "Builds aus unserer Werkstatt" (only builds
 * whose tag both sides confirmed, the real count) and the Impressum (§ 5 DDG). Speichern, Teilen and Melden are in the header.
 */
export function BusinessScreen() {
  const { t } = useTranslation('parts');
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = (paramOf(params.slug) ?? '').toLowerCase();
  const qaState = useQaState();
  const online = useOnline();
  const flag = useBusinessesOn();
  const back = useBack('/discover');
  const query = useBusiness(slug);
  const state = pageStateOf(query, flag, online, qaState);

  if (state === 'ready' && query.data) return <BusinessView business={query.data} onBack={back} restricted={qaState === 'restricted'} />;
  if (state === 'loading') return <BusinessSkeleton onBack={back} />;
  return (
    <StateFrame onBack={back}>
      <PageStateBody
        state={state === 'ready' ? 'error' : state}
        routeId={ROUTE}
        icon="workshop"
        area="businesses"
        notFound={{
          title: t('business.notFoundTitle'),
          body: t('business.notFoundBody'),
          preview: <SampleWall testID={`${ROUTE}.notFound.sample`} />,
          actionLabel: t('business.toDiscover'),
          onAction: () => router.navigate('/discover'),
        }}
        errorTitle={t('business.errorTitle')}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    </StateFrame>
  );
}

function StateFrame({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <Screen edges={['left', 'right']} testID={`${ROUTE}.root`}>
      <Header onBack={onBack} testID={`${ROUTE}.header`} />
      <View style={[styles.centred, { paddingHorizontal: gutter }]}>{children}</View>
    </Screen>
  );
}

/**
 * The page in its geometry while it loads (DQ-1153): the 16:9 cover from the top edge, the logo with the name and the subline (with its
 * badge), the button bar, two rows of service chips, three lines of the about text, then the hours card.
 */
function BusinessSkeleton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const phone = kind === 'phone';
  const scroll = useCollapsingHeader();
  return (
    <Screen edges={['left', 'right']} testID={`${ROUTE}.root`}>
      {phone ? null : <Header variant={kind === 'desktop' ? 'compact' : 'large'} onBack={onBack} testID={`${ROUTE}.header`} />}
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View aria-label={t('business.loading')} style={styles.hero}>
          <SkeletonBlock aspectRatio={HERO_RATIO} corner="none" />
        </View>
        <View style={[styles.column, { paddingHorizontal: gutter }]}>
          <View style={styles.skeletonIdentity}>
            <View style={styles.skeletonRow}>
              <SkeletonBlock width={size.avatar.lg} height={size.avatar.lg} corner="md" />
              <View style={styles.nameText}>
                <SkeletonText variant="title1" width="70%" />
                <SkeletonText variant="callout" width="65%" />
              </View>
            </View>
            <SkeletonBlock width="60%" height={size.button.m} corner="sm" testID={`${ROUTE}.skeleton.actions`} />
            <View style={styles.skeletonChips} testID={`${ROUTE}.skeleton.services`}>
              {Array.from({ length: SKELETON_CHIP_ROWS }, (_, row) => (
                <SkeletonBlock key={row} width={row === 0 ? '90%' : '55%'} height={size.chip} corner="full" />
              ))}
            </View>
            <SkeletonText variant="body" lines={SKELETON_ABOUT_LINES} lastLineWidth="60%" testID={`${ROUTE}.skeleton.about`} />
          </View>
          <View style={styles.section}>
            <SkeletonText variant="headline" width="40%" />
            <SkeletonBlock width="100%" height={7 * size.row.single} corner="md" />
          </View>
        </View>
      </Skeleton>
      {phone ? (
        <View style={styles.skeletonHeader}>
          <Header variant="photo" scroll={scroll} onBack={onBack} testID={`${ROUTE}.header`} />
        </View>
      ) : null}
    </Screen>
  );
}

function BusinessView({ business, onBack, restricted }: { business: BusinessDetail; onBack: () => void; restricted: boolean }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const header = useCollapsingHeader();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const own = useSessionStore((state) => state.member?.username ?? null);
  const collectionsOn = useFlag(SOCIAL_FLAGS.collections);
  const { gutter, kind, width } = useBreakpoint();
  const { fontScale } = useTheme();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [contentWidth, setContentWidth] = useState(() => estimatedContentWidth(kind, width));
  const [stageHeight, setStageHeight] = useState(0);
  const barHeight = useEstimatedOverlayHeight();
  const cardSticky = useSticky(header.scrollY, space[24], stageHeight + space[24]);
  const portfolio = usePortfolio(business.slug, !business.is_sample);
  const builds = useMemo(() => flattenById(portfolio.data?.pages).filter((vehicle) => vehicle.cover), [portfolio.data?.pages]);

  const phone = kind === 'phone';
  const desktop = kind === 'desktop';
  const heroWidth = phone ? contentWidth : Math.min(contentWidth, layout.fullBleedMax);
  const heroHeight = heroWidth / HERO_RATIO;
  const hero = businessHero(business, builds, heroWidth);
  // DQ-1215: the photo the hero shows (own cover or the API's portfolio pick), which no portfolio card repeats.
  const heroPhotoId = business.cover?.id ?? null;
  const overlap = desktop ? heroIdentityOverlap(heroWidth, HERO_RATIO) : 0;
  const team = business.viewer_role !== null;
  const messageTo = business.contact.message_username;
  const mayMessage = messageTo !== null && messageTo.toLowerCase() !== own?.toLowerCase();
  const phoneHref = phoneUrl(business.contact.phone);
  const site = websiteUrl(business.contact.website);
  const route = routeUrl(business.address, Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web');
  const point = business.address.lat !== null && business.address.lng !== null ? { lat: business.address.lat, lng: business.address.lng } : null;
  const shareUrl = `${(siteUrl() ?? '').replace(/\/+$/, '')}${business.share_path}`;
  const impressum = impressumRows(business.impressum, t);
  const wallColumns = WALL_COLUMNS_BY_KIND[kind];
  const aboutMeasure = { maxWidth: MEASURE_EM * (desktop ? typographyDesktop.body.fontSize : typography.body.fontSize) * fontScale };
  const maySave = collectionsOn && !business.is_sample && status !== 'loading';
  const mainWidth = desktop ? (Math.min(contentWidth, layout.contentMax + 2 * space[24]) - 3 * space[24]) * (DESKTOP_GALLERY_FLEX / (DESKTOP_GALLERY_FLEX + DESKTOP_CARD_FLEX)) : Math.min(layout.feedColumn, contentWidth - 2 * gutter);

  const report = useReport(
    { type: 'business', id: business.id, label: business.name, ...(messageTo ? { owner: messageTo } : {}) },
    { routeId: ROUTE, onBlocked: () => onBack() },
  );

  const share = async () => {
    const outcome = await shareLink({ url: shareUrl, title: business.name });
    if (outcome === 'copied') toast(t('business.linkCopied'), { testID: `${ROUTE}.toast` });
    if (outcome === 'failed') toast(t('business.shareFailed', { url: shareUrl }), { testID: `${ROUTE}.toast` });
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(shareUrl);
      toast(t('business.linkCopied'), { testID: `${ROUTE}.toast` });
    } catch {
      toast(t('business.shareFailed', { url: shareUrl }), { testID: `${ROUTE}.toast` });
    }
  };
  const message = () => {
    if (!messageTo) return;
    const href = newMessageHref({ to: messageTo });
    if (requireAuth(undefined, { returnTo: `/b/${business.slug}` })) router.push(href);
  };
  const save = () => {
    if (requireAuth(undefined, { returnTo: `/b/${business.slug}` })) setSaveOpen(true);
  };

  const more: MoreAction[] = [
    ...(business.is_sample ? [] : [{ key: 'share', icon: 'share-network', label: t('business.share'), onPress: () => void share() } satisfies MoreAction]),
    { key: 'copyLink', icon: 'link', label: t('business.copyLink'), onPress: () => void copy() },
    ...(team ? [{ key: 'manage', icon: 'gear-six', label: t('business.manage'), onPress: () => router.push('/business') } satisfies MoreAction] : []),
    ...(report.available && !team && !business.is_sample
      ? [{ key: 'report', icon: 'flag', label: t('business.report'), onPress: report.open } satisfies MoreAction]
      : []),
  ];
  // DQ-1143: two floating controls over the cover at most (back and "…"); Speichern sits beside "Nachricht".
  const actions: HeaderAction[] = [{ icon: 'dots-three', label: t('business.more'), onPress: () => setMoreOpen(true), testID: `${ROUTE}.moreActions` }];

  const photo = (
    <Photo
      {...hero.photo}
      aspect="16:9"
      label={hero.source === 'fallback' ? t('business.coverFallbackLabel') : (hero.alt ?? undefined)}
      style={{ width: heroWidth }}
      testID={`${ROUTE}.cover`}
    >
      {phone ? <PhotoTopScrim /> : null}
      {desktop ? <PhotoStageScrim /> : null}
    </Photo>
  );
  const coverNote =
    hero.source === 'own' ? null : (
      <Text variant="caption" color="text.secondary" testID={`${ROUTE}.coverNote`}>
        {hero.source === 'portfolio' && hero.vehicle ? t('business.coverPortfolio', { vehicle: hero.vehicle.full_title }) : t('business.coverFallback')}
      </Text>
    );

  // ADR-466 (DQ-1181, WEB-14 parity): a business without a logo shows none; never a letter in a tile.
  const logo = () =>
    business.logo ? <Photo {...photoFields(business.logo, size.avatar.lg)} aspect="1:1" corner="md" style={styles.logo} testID={`${ROUTE}.logo`} /> : null;
  // 09 §7.11 "Werkstatt · München" + Verifiziert: the badge follows the place on its line (DQ-1154). A sample never carries Verifiziert
  // (the API guarantees it, DQ-1144); the check here keeps it so whatever arrives.
  const nameBlock = (onPhoto: boolean) => {
    const tone = onPhoto ? 'onPhoto' : 'default';
    return (
      <View style={styles.nameRow}>
        {logo()}
        <View style={styles.nameText}>
          <Text variant="title1" role="heading" aria-level={1} color={onPhoto ? 'onPhoto.primary' : 'text.primary'} testID={`${ROUTE}.title`}>
            {business.name}
          </Text>
          <View style={styles.subline}>
            <Text variant="callout" color={onPhoto ? 'onPhoto.primary' : 'text.secondary'} testID={`${ROUTE}.subline`}>
              {business.subline}
            </Text>
            {business.verified && !business.is_sample ? <Badge kind="verified" tone={tone} style={styles.sublineBadge} testID={`${ROUTE}.verified`} /> : null}
            {business.is_sample ? <SampleBadge tone={tone} style={styles.sublineBadge} testID={`${ROUTE}.sample`} /> : null}
          </View>
        </View>
      </View>
    );
  };
  const services =
    business.services.length > 0 ? (
      <View role="list" aria-label={t('business.services')} style={styles.services} testID={`${ROUTE}.services`}>
        {business.services.map((service) => (
          <View key={service} role="listitem">
            <Chip label={service} />
          </View>
        ))}
      </View>
    ) : null;
  // "Nachricht" stays the one filled CTA; Speichern is the secondary beside it (DQ-1143), so the cover keeps two floating controls.
  const contactActions =
    mayMessage || maySave ? (
      <View style={styles.actions}>
        {mayMessage ? <Button label={t('business.message')} icon="chat-circle" variant="primary" size="m" onPress={message} testID={`${ROUTE}.message`} /> : null}
        {maySave ? <Button label={t('business.save')} icon="bookmark-simple" variant="secondary" size="m" onPress={save} testID={`${ROUTE}.save`} /> : null}
      </View>
    ) : null;

  const hours = hasHours(business.opening_hours) ? <OpeningHours days={business.opening_hours} testID={`${ROUTE}.hours`} /> : null;

  const placeLines = (
    <>
      <Text variant="headline" testID={`${ROUTE}.address.title`}>
        {business.name}
      </Text>
      {addressLines(business.address, t).map((line) => (
        <Text key={line} variant="callout" color="text.secondary">
          {line}
        </Text>
      ))}
      {route ? (
        <Button
          label={t('business.route')}
          icon="navigation-arrow"
          variant="secondary"
          size="s"
          accessibilityLabel={t('business.routeLabel', { name: business.name })}
          onPress={() => void openUrl(route, t('links.mapsFailed'), `${ROUTE}.toast`)}
          style={styles.placeAction}
          testID={`${ROUTE}.route`}
        />
      ) : null}
    </>
  );
  const map = point ? (
    <EventMap mode="snippet" height={MAP_HEIGHT} center={point} zoom={CITY_ZOOM + 2} exact label={t('business.mapLabel', { name: business.name })} testID={`${ROUTE}.map`} />
  ) : null;

  const contact =
    phoneHref || site ? (
      <RowCard testID={`${ROUTE}.contact`}>
        {phoneHref && business.contact.phone ? (
          <ListRow
            icon="phone"
            title={t('business.call')}
            subtitle={business.contact.phone}
            hyphenate={false}
            role="link"
            onPress={() => void openUrl(phoneHref, t('links.callFailed'), `${ROUTE}.toast`)}
            divider={Boolean(site)}
            testID={`${ROUTE}.phone`}
          />
        ) : null}
        {site ? (
          <ListRow
            icon="globe-simple"
            title={t('business.website')}
            subtitle={websiteLabel(site)}
            hyphenate={false}
            role="link"
            onPress={() => void openUrl(site, t('links.failed'), `${ROUTE}.toast`)}
            testID={`${ROUTE}.website`}
          />
        ) : null}
      </RowCard>
    ) : null;

  const portfolioWall = business.is_sample ? (
    <View style={styles.section} testID={`${ROUTE}.portfolio`}>
      <GroupHeader title={t('business.portfolio')} />
      <Text variant="callout" color="text.secondary" testID={`${ROUTE}.portfolio.sample`}>
        {t('business.portfolioSample')}
      </Text>
    </View>
  ) : (
    <PortfolioBuilds
      feature={!phone}
      heroPhotoId={heroPhotoId}
      title={t('business.portfolio')}
      count={business.portfolio_count ? t('counts.builds', { count: business.portfolio_count, value: format.number(business.portfolio_count) }) : null}
      vehicles={builds}
      width={phone ? contentWidth : mainWidth}
      columns={wallColumns}
      loading={portfolio.isPending && portfolio.fetchStatus !== 'paused'}
      hasMore={portfolio.hasNextPage}
      loadingMore={portfolio.isFetchingNextPage}
      onMore={() => void portfolio.fetchNextPage()}
      bleed={phone ? gutter : 0}
      empty={
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.portfolio.empty`}>
          {portfolio.isError ? t('builds.errorTitle') : team ? t('business.portfolioEmptyTeam') : t('business.portfolioEmpty')}
        </Text>
      }
      testID={`${ROUTE}.portfolio`}
    />
  );

  const impressumBlock = (
    <View style={styles.section} testID={`${ROUTE}.impressum`}>
      <GroupHeader title={t('impressum.title')} />
      {/* Label over value: a company name, an address or an e-mail address keeps the whole width of the card at any font size. */}
      <RowCard>
        {impressum.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <Hairline inset={space[16]} /> : null}
            <View style={styles.impressumRow} accessible aria-label={`${row.label}: ${row.value}`} testID={`${ROUTE}.impressum.${row.key}`}>
              <Text variant="caption" color="text.secondary" hyphenate={false}>
                {row.label}
              </Text>
              <Text variant="body" hyphenate={false}>
                {row.key === 'email' ? identifierText(row.value) : row.value}
              </Text>
            </View>
          </View>
        ))}
      </RowCard>
      <Text variant="caption" color="text.tertiary" testID={`${ROUTE}.impressum.note`}>
        {business.impressum.is_sample ? t('impressum.sampleNote') : t('impressum.note')}
      </Text>
    </View>
  );

  const about = business.about ? (
    <Text variant="body" style={aboutMeasure} testID={`${ROUTE}.about`}>
      {business.about}
    </Text>
  ) : null;
  const restrictedLine = restricted ? (
    <Text variant="callout" color="text.secondary" testID={`${ROUTE}.restricted`}>
      {t('business.restricted')}
    </Text>
  ) : null;

  let body: ReactNode;
  if (desktop) {
    body = (
      <>
        <View style={styles.stage} onLayout={(event) => setStageHeight(event.nativeEvent.layout.height)} testID={`${ROUTE}.stage`}>
          {photo}
          {/* The overlap is derived from the photo's large-text-safe line, not a scale step: a counted audit exemption (M4.18). */}
          <View dataSet={SCRIM_OVERLAP} style={[styles.stageIdentity, { marginTop: -overlap, minHeight: overlap, paddingHorizontal: gutter }]}>{nameBlock(true)}</View>
        </View>
        <View style={styles.desktopRow}>
          <View style={styles.desktopMain}>
            <View style={styles.identity}>
              {coverNote}
              {restrictedLine}
              {about}
              {services}
            </View>
            {portfolioWall}
            {impressumBlock}
          </View>
          <View style={styles.desktopAside}>
            <Animated.View style={[styles.card, cardSticky.style]} onLayout={cardSticky.onLayout} testID={`${ROUTE}.card`}>
              {contactActions}
              {map ? <View style={styles.cardMap}>{map}</View> : null}
              <View testID={`${ROUTE}.address`}>{placeLines}</View>
              {contact}
              {hours}
            </Animated.View>
          </View>
        </View>
      </>
    );
  } else {
    body = (
      <>
        <View style={styles.hero}>{photo}</View>
        <View style={[styles.column, { paddingHorizontal: gutter }]}>
          <View style={styles.identity}>
            {nameBlock(false)}
            {coverNote}
            {restrictedLine}
            {contactActions}
            {services}
            {about}
          </View>
          {hours}
          <View style={styles.section}>
            <GroupHeader title={t('business.addressTitle')} />
            <View style={styles.place} testID={`${ROUTE}.address`}>
              {map}
              <View style={styles.placeBody}>{placeLines}</View>
            </View>
            {contact}
          </View>
          {portfolioWall}
          {impressumBlock}
        </View>
      </>
    );
  }

  return (
    <ProfileFrame
      routeId={ROUTE}
      layout={kind}
      overHero={phone}
      title={business.name}
      onBack={onBack}
      actions={actions}
      header={header}
      photoCollapseAt={Math.max(0, heroHeight - barHeight)}
      scrollRef={scrollRef}
      onWidth={setContentWidth}
      offlineLabel={t('states.offlineBanner')}
      overlays={
        <>
          <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={business.name} actions={more} testID={`${ROUTE}.more`} />
          {status === 'member' && collectionsOn ? (
            <SaveSheet visible={saveOpen} onClose={() => setSaveOpen(false)} item={{ type: 'business', id: business.id }} routeId={ROUTE} />
          ) : null}
          {report.element}
        </>
      }
    >
      {body}
    </ProfileFrame>
  );
}
