import '@/features/events/i18n';

import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useFlag } from '@/api/queries/appConfig';
import {
  EVENTS_FLAG,
  isUnavailable,
  useEvent,
  useEventAttendees,
  useEventUpdates,
  type EventDetail,
} from '@/api/queries/events';
import { useOpenMember } from '@/features/home/navigation';
import { photoFields } from '@/features/profile/media';
import { shareLink } from '@/features/profile/share';
import { useReport } from '@/features/safety/useReport';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import {
  estimatedContentWidth,
  ProfileFrame,
  useEstimatedOverlayHeight,
} from '@/features/vehicle/components/ProfileFrame';
import {
  DESKTOP_CARD_FLEX,
  DESKTOP_GALLERY_FLEX,
  heroIdentityOverlap,
  useSticky,
} from '@/features/vehicle/layout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { concentric, createStyles, layout, size, space, useBreakpoint } from '@/theme';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  EventDateBlock,
  Header,
  Hairline,
  Photo,
  PhotoStageScrim,
  PhotoTopScrim,
  PressableScale,
  SampleBadges,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  StatusPill,
  Text,
  toast,
  useCollapsingHeader,
  type HeaderAction,
} from '@/ui';

import { EventSection, ReviewBanner, RulesList } from '../components/EventParts';
import { RsvpBar } from '../components/RsvpBar';
import { EventMap } from '../map/EventMap';
import { AREA_ZOOM, CITY_ZOOM } from '../map/mapConfig';
import {
  countsLine,
  dateBlock,
  editorPath,
  eventHero,
  hasEnded,
  mapPoint,
  parseInstant,
  placeText,
  reviewNotice,
  routeUrl,
  spotsLeft,
  statusLabel,
  textOf,
  timeRange,
} from '../model';

const ROUTE = 'EVT-02';
const SNIPPET_HEIGHT = size.avatar.xl * 2;
const ATTENDEE_FACES = 5;
const HERO_RATIO = 16 / 9;

const useStyles = createStyles((t) => ({
  column: {
    alignSelf: 'flex-start',
    gap: t.space[32],
    maxWidth: layout.feedColumn,
    paddingBottom: t.space[32],
    paddingTop: t.space[24],
    width: '100%',
  },
  identity: { gap: t.space[12] },
  when: { alignItems: 'center', flexDirection: 'row', gap: t.space[16] },
  whenText: { flex: 1, gap: t.space[2], minWidth: 0 },
  badges: {
    alignItems: 'center',
    columnGap: t.space[8],
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: t.space[4],
  },
  organiser: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.touchMin,
    paddingVertical: t.space[4],
  },
  organiserText: { alignItems: 'flex-start', flex: 1, gap: t.space[2], minWidth: 0 },
  place: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  placeBody: { gap: t.space[4], padding: t.space[16] },
  placeAction: { alignSelf: 'flex-start', marginTop: t.space[8] },
  faces: { flexDirection: 'row', gap: t.space[4] },
  updates: { gap: t.space[16] },
  update: { gap: t.space[4] },
  centred: { flexGrow: 1, justifyContent: 'center' },
  skeleton: { gap: t.space[16] },
  skeletonHeader: { left: 0, position: 'absolute', right: 0, top: 0 },
  hero: { alignSelf: 'center', maxWidth: layout.fullBleedMax, width: '100%' },
  // DQ-1114: from 1280 the photo fades into the dark stage (every theme, ADR-421 b) with the date and the title on it, as on VEH-01.
  stage: {
    alignSelf: 'center',
    backgroundColor: t.color.scrim.photoEnd,
    maxWidth: layout.fullBleedMax,
    width: '100%',
  },
  stageIdentity: { gap: t.space[12], justifyContent: 'flex-end', paddingBottom: t.space[24] },
  desktopRow: {
    alignItems: 'stretch',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: t.space[24],
    maxWidth: layout.contentMax + 2 * t.space[24],
    padding: t.space[24],
    width: '100%',
  },
  desktopMain: { flex: DESKTOP_GALLERY_FLEX, gap: t.space[32], minWidth: 0 },
  desktopAside: { flex: DESKTOP_CARD_FLEX, minWidth: 0 },
  card: {
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[16],
    padding: t.space[24],
  },
  cardPlace: { gap: t.space[4] },
  cardMap: { borderRadius: concentric(t.radius.md, t.space[24]), overflow: 'hidden' },
}));

/**
 * EVT-02 Treffen-Detail ★ `/events/[slug]` (09 §7.10): header pattern (b) over the 16:9 cover, the date block with the time range,
 * the title in title.1, the organiser, the review or cancellation notice (ADR-439), the place card (map snippet, venue and address,
 * or "Ort wird nach deiner Zusage angezeigt" with the area, ADR-437 c) with "Route", description, Regeln, Teilnehmende with the real
 * counts, the organiser's updates, and the floating RSVP bar: "Zusagen" / "Interessiert", then "Zugesagt" with "In Kalender" and
 * "Teilen". Reporting is in "Mehr".
 */
export function EventScreen() {
  const { t } = useTranslation('events');
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = paramOf(params.slug) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const flag = useFlag(EVENTS_FLAG);
  const back = useBack('/events');
  const query = useEvent(slug);

  const event =
    qaState === 'default' || qaState === 'restricted' || qaState === 'offline' ? query.data : undefined;
  const loading =
    qaState === 'loading' ||
    (qaState === 'default' && !query.data && query.isPending && query.fetchStatus !== 'paused');

  if (event) return <EventDetailView event={event} onBack={back} />;

  let body: ReactNode;
  if (!flag && qaState === 'default') {
    body = (
      <EmptyState
        icon="meet"
        title={t('list.unavailableTitle')}
        body={t('list.unavailableBody')}
        testID={`${ROUTE}.unavailable`}
      />
    );
  } else if (loading) {
    return <EventDetailSkeleton onBack={back} />;
  } else if (qaState === 'empty' || isUnavailable(query.error)) {
    body = (
      <EmptyState
        icon="meet"
        title={t('detail.goneTitle')}
        body={t('detail.goneBody')}
        action={{ label: t('detail.toEvents'), onPress: back, variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else {
    const offline =
      qaState === 'offline' || (qaState !== 'error' && (!online || query.fetchStatus === 'paused'));
    body = (
      <ErrorState
        title={offline ? t('list.offlineTitle') : t('detail.errorTitle')}
        message={offline ? t('list.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  }
  return <StateFrame onBack={back}>{body}</StateFrame>;
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
 * The detail in its geometry while it loads (SM15): the 16:9 cover from the top edge (under the floating bar on a phone, DQ-1092
 * class: no jump when the photo arrives), the date row, the title, the place card.
 */
function EventDetailSkeleton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const phone = kind === 'phone';
  const scroll = useCollapsingHeader();
  return (
    <Screen edges={['left', 'right']} testID={`${ROUTE}.root`}>
      {phone ? null : (
        <Header
          variant={kind === 'desktop' ? 'compact' : 'large'}
          onBack={onBack}
          testID={`${ROUTE}.header`}
        />
      )}
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View aria-label={t('detail.loadingLabel')} style={styles.hero}>
          <SkeletonBlock aspectRatio={HERO_RATIO} corner="none" />
        </View>
        <View style={[styles.column, { paddingHorizontal: gutter }]}>
          <View style={styles.skeleton}>
            <SkeletonText variant="heroNumeralS" width="20%" />
            <SkeletonText variant="title1" lines={2} lastLineWidth="60%" />
            <SkeletonText variant="callout" width="40%" />
          </View>
          <SkeletonBlock height={SNIPPET_HEIGHT} corner="md" />
          <SkeletonText variant="body" lines={3} lastLineWidth="70%" />
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

function EventDetailView({ event, onBack }: { event: EventDetail; onBack: () => void }) {
  const { t } = useTranslation('events');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const header = useCollapsingHeader();
  const openMember = useOpenMember();
  const status = useSessionStore((state) => state.status);
  const own = useSessionStore((state) => state.member?.username);
  const { gutter, kind, width } = useBreakpoint();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [contentWidth, setContentWidth] = useState(() => estimatedContentWidth(kind, width));
  const [stageHeight, setStageHeight] = useState(0);
  const barHeight = useEstimatedOverlayHeight();
  const cardSticky = useSticky(header.scrollY, space[24], stageHeight + space[24]);
  const organiser =
    own !== undefined && own !== null && own.toLowerCase() === event.organiser.username.toLowerCase();

  const start = parseInstant(event.starts_at);
  const end = parseInstant(event.ends_at);
  const block = start ? dateBlock(start, format.locale) : null;
  const ended = hasEnded(event, now());
  const cancelled = event.status === 'cancelled';
  const open = event.status === 'published' || cancelled;
  const notice = reviewNotice(event);
  const shownNotice = notice && (organiser || notice.kind === 'cancelled') ? notice : null;
  const place = placeText(event.location, t);
  const point = mapPoint(event.location);
  const route = routeUrl(
    event.location,
    Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
  );
  const description = textOf(event.description);
  const organiserRules = textOf(event.organiser_rules);
  const counts = countsLine(event.counts, t, (n) => format.number(n));
  const left = spotsLeft(event);
  const phone = kind === 'phone';
  const desktop = kind === 'desktop';
  // DQ-1114: 16:9 edge to edge at every width (at most fullBleedMax), never inset or rounded.
  const heroWidth = phone ? contentWidth : Math.min(contentWidth, layout.fullBleedMax);
  const heroHeight = heroWidth / HERO_RATIO;
  // DQ-1111: never photo-free. The event's cover, else the organiser's car, else the fallback, each with its credit line.
  const hero = eventHero(event, heroWidth);
  const overHero = phone;
  const overlap = desktop ? heroIdentityOverlap(heroWidth, HERO_RATIO) : 0;
  const editable = event.status === 'draft' || event.status === 'rejected';

  const attendees = useEventAttendees(event.slug, null, event.can.view_attendees && !event.is_sample);
  const faces = (attendees.data?.pages[0]?.data ?? []).slice(0, ATTENDEE_FACES);
  const updates = useEventUpdates(event.slug, event.can.view_updates);

  const report = useReport(
    { type: 'event', id: event.id, label: event.title, owner: event.organiser.username },
    { routeId: ROUTE, onBlocked: () => onBack() },
  );

  const share = async () => {
    const outcome = await shareLink({ url: event.share_url, title: event.title });
    if (outcome === 'copied') toast(t('detail.linkCopied'), { testID: `${ROUTE}.toast` });
    if (outcome === 'failed')
      toast(t('detail.shareFailed', { url: event.share_url }), { testID: `${ROUTE}.toast` });
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(event.share_url);
      toast(t('detail.linkCopied'), { testID: `${ROUTE}.toast` });
    } catch {
      toast(t('detail.copyFailed', { url: event.share_url }), { testID: `${ROUTE}.toast` });
    }
  };
  const openUrl = async (url: string, failed: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast(failed, { testID: `${ROUTE}.toast` });
    }
  };
  const manage = () => router.push({ pathname: '/events/[slug]/manage', params: { slug: event.slug } });

  const more: MoreAction[] = [
    ...(open
      ? [
          {
            key: 'share',
            icon: 'share-network',
            label: t('rsvp.share'),
            onPress: () => void share(),
          } satisfies MoreAction,
        ]
      : []),
    { key: 'copyLink', icon: 'link', label: t('detail.copyLink'), onPress: () => void copy() },
    ...(organiser
      ? [{ key: 'manage', icon: 'gear-six', label: t('rsvp.manage'), onPress: manage } satisfies MoreAction]
      : []),
    ...(report.available && event.can.report && !event.is_sample
      ? [
          {
            key: 'report',
            icon: 'flag',
            label: t('detail.report'),
            onPress: report.open,
          } satisfies MoreAction,
        ]
      : []),
  ];
  const actions: HeaderAction[] = [
    {
      icon: 'dots-three',
      label: t('detail.more'),
      onPress: () => setMoreOpen(true),
      testID: `${ROUTE}.moreActions`,
    },
  ];

  const rsvp = (inline: boolean) => (
    <RsvpBar
      event={event}
      organiser={organiser}
      guest={status === 'guest'}
      ended={ended}
      onShare={() => void share()}
      onCalendar={() =>
        event.calendar_url ? void openUrl(event.calendar_url, t('detail.calendarFailed')) : undefined
      }
      onManage={manage}
      routeId={ROUTE}
      inline={inline}
    />
  );

  const photo = (
    <Photo
      {...hero.photo}
      aspect="16:9"
      label={hero.source === 'fallback' ? t('detail.coverFallbackLabel') : (hero.alt ?? undefined)}
      style={{ width: heroWidth }}
      testID={`${ROUTE}.cover`}
    >
      {overHero ? <PhotoTopScrim /> : null}
      {desktop ? <PhotoStageScrim /> : null}
    </Photo>
  );

  const coverNote =
    hero.source === 'own' ? null : (
      <Text variant="caption" color="text.secondary" testID={`${ROUTE}.coverNote`}>
        {hero.source === 'organiserCar'
          ? t('detail.coverOrganiserCar', { username: event.organiser.username })
          : organiser && editable
            ? t('detail.coverFallbackOrganiser')
            : t('detail.coverFallback')}
      </Text>
    );

  const when =
    block && start ? (
      <View style={styles.when} testID={`${ROUTE}.when`}>
        <EventDateBlock
          day={block.day}
          month={block.month}
          weekday={block.weekday}
          muted={cancelled || ended}
          onPhoto={desktop}
        />
        <View style={styles.whenText}>
          <Text
            variant="headline"
            numeric
            color={desktop ? 'onPhoto.primary' : 'text.primary'}
            testID={`${ROUTE}.time`}
          >
            {timeRange(start, end, format.locale, t)}
          </Text>
          <Text variant="caption" color={desktop ? 'onPhoto.primary' : 'text.secondary'}>
            {t(`type.${event.type}`)}
          </Text>
        </View>
      </View>
    ) : null;

  const title = (
    <Text
      variant="title1"
      role="heading"
      aria-level={1}
      color={desktop ? 'onPhoto.primary' : 'text.primary'}
      testID={`${ROUTE}.title`}
    >
      {event.title}
    </Text>
  );

  const badges =
    event.is_sample || event.organiser.is_editorial || organiser || cancelled ? (
      <View style={styles.badges}>
        {organiser || cancelled ? (
          <StatusPill label={statusLabel(event.status, t)} testID={`${ROUTE}.status`} />
        ) : null}
        <SampleBadges
          flags={{
            is_sample: event.is_sample,
            is_editorial: event.organiser.is_editorial && !event.is_sample,
          }}
        />
      </View>
    ) : null;

  const organiserName = event.organiser.display_name ?? `@${event.organiser.username}`;
  const organiserRow = (
    <PressableScale
      role="link"
      aria-label={t('detail.organiserLabel', {
        name: event.organiser.display_name ?? event.organiser.username,
      })}
      onPress={() => openMember(event.organiser.username)}
      contentStyle={styles.organiser}
      testID={`${ROUTE}.organiser`}
    >
      <Avatar
        name={organiserName}
        uri={photoFields(event.organiser.avatar, size.avatar.sm).source as string | null}
        size={32}
        decorative
      />
      <View style={styles.organiserText}>
        <Text variant="caption" color="text.secondary">
          {t('detail.organiser')}
        </Text>
        {/* DQ-1117: the name wraps to a second line at large text instead of "SPEED CLUB Edi…". */}
        <Text variant="headline" numberOfLines={2}>
          {organiserName}
        </Text>
        {/* DQ-1117: "Verifiziert" on its own line under the name, so the name keeps the width at every font scale. */}
        {event.organiser.verified ? <Badge kind="verified" testID={`${ROUTE}.organiser.verified`} /> : null}
      </View>
    </PressableScale>
  );

  const review = shownNotice ? (
    <ReviewBanner
      notice={shownNotice}
      byStaff={event.cancelled_by_staff}
      organiser={organiser}
      onAction={() => router.push(editorPath(event.slug))}
      testID={`${ROUTE}.review`}
    />
  ) : null;

  const placeLines = (
    <>
      <Text variant="headline" testID={`${ROUTE}.place.title`}>
        {place.title}
      </Text>
      {place.lines.map((line) => (
        <Text key={line} variant="callout" color="text.secondary">
          {line}
        </Text>
      ))}
      {organiser && event.location.visibility === 'after_rsvp' ? (
        <Text variant="caption" color="text.tertiary">
          {t('place.afterRsvpOrganiser')}
        </Text>
      ) : null}
      {route ? (
        <Button
          label={t('place.route')}
          icon="navigation-arrow"
          variant="secondary"
          size="s"
          accessibilityLabel={t('place.routeLabel', { place: place.title })}
          onPress={() => void openUrl(route, t('detail.routeFailed'))}
          style={styles.placeAction}
          testID={`${ROUTE}.route`}
        />
      ) : null}
    </>
  );
  const map = point ? (
    <EventMap
      mode="snippet"
      height={SNIPPET_HEIGHT}
      center={point}
      zoom={point.exact ? CITY_ZOOM + 2 : AREA_ZOOM}
      exact={point.exact}
      label={t('place.mapLabel')}
      testID={`${ROUTE}.map`}
    />
  ) : null;

  const sections = (
    <>
      {description ? (
        <EventSection title={t('detail.description')} testID={`${ROUTE}.description`}>
          <Text variant="body">{description}</Text>
        </EventSection>
      ) : null}

      <EventSection title={t('detail.rules')}>
        <RulesList rules={event.rules} organiserRules={organiserRules} testID={`${ROUTE}.rules`} />
      </EventSection>

      <EventSection
        title={t('detail.attendees')}
        trailing={
          event.can.view_attendees && !event.is_sample && open ? (
            <Button
              label={t('detail.attendeesAll')}
              variant="tertiary"
              size="s"
              flush="end"
              accessibilityLabel={t('detail.attendeesAllLabel')}
              onPress={() =>
                router.push({ pathname: '/events/[slug]/attendees', params: { slug: event.slug } })
              }
              testID={`${ROUTE}.attendeesAll`}
            />
          ) : undefined
        }
        testID={`${ROUTE}.attendees`}
      >
        {faces.length > 0 ? (
          <View style={styles.faces} aria-hidden>
            {faces.map((row) => (
              <Avatar
                key={row.member.username}
                name={row.member.display_name ?? row.member.username}
                uri={photoFields(row.member.avatar, size.avatar.sm).source as string | null}
                size={32}
                decorative
              />
            ))}
          </View>
        ) : null}
        {/* DQ-1118: no "0 Zusagen" before publication, a sentence instead of a zero after it. */}
        <Text
          variant="body"
          numeric
          color={counts && open ? 'text.primary' : 'text.secondary'}
          testID={`${ROUTE}.counts`}
        >
          {event.is_sample
            ? t('detail.sampleCounts')
            : !open
              ? t('detail.notOpenYet')
              : event.counts && event.counts.going + event.counts.interested === 0
                ? t('detail.noAttendees')
                : counts}
        </Text>
        {event.capacity !== null && open ? (
          <Text variant="callout" numeric color="text.secondary" testID={`${ROUTE}.capacity`}>
            {left === 0
              ? t('counts.full')
              : left !== null
                ? t('counts.spotsLeft', { count: left, value: format.number(left) })
                : t('detail.capacity', { value: format.number(event.capacity) })}
          </Text>
        ) : null}
      </EventSection>

      {event.can.view_updates ? (
        <EventSection title={t('detail.updates')} testID={`${ROUTE}.updates`}>
          {updates.data && updates.data.length > 0 ? (
            <View style={styles.updates}>
              {updates.data.map((update, index) => (
                <View key={update.id} style={styles.update} testID={`${ROUTE}.update.${update.id}`}>
                  {index > 0 ? <Hairline /> : null}
                  <Text variant="caption" color="text.secondary" numeric>
                    {update.created_at ? format.relative(new Date(update.created_at)) : ''}
                  </Text>
                  <Text variant="body">{update.body}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text variant="callout" color="text.secondary">
              {updates.isError ? t('detail.updatesError') : t('detail.updatesEmpty')}
            </Text>
          )}
        </EventSection>
      ) : null}
      <Text variant="caption" color="text.tertiary">
        {t('time.zone')}
      </Text>
    </>
  );

  let body: ReactNode;
  if (desktop) {
    // DQ-1114: the full-width hero with the date and title on its scrim, then 8 columns (the story) beside the sticky 4-column card
    // (place, map, Route, the answer), as VEH-01 (DQ-1048).
    body = (
      <>
        <View
          style={styles.stage}
          onLayout={(event_) => setStageHeight(event_.nativeEvent.layout.height)}
          testID={`${ROUTE}.stage`}
        >
          {photo}
          <View
            style={[
              styles.stageIdentity,
              { marginTop: -overlap, minHeight: overlap, paddingHorizontal: gutter },
            ]}
          >
            {when}
            {title}
          </View>
        </View>
        <View style={styles.desktopRow}>
          <View style={styles.desktopMain}>
            <View style={styles.identity}>
              {badges}
              {organiserRow}
              {coverNote}
            </View>
            {review}
            {sections}
          </View>
          <View style={styles.desktopAside}>
            <Animated.View
              style={[styles.card, cardSticky.style]}
              onLayout={cardSticky.onLayout}
              testID={`${ROUTE}.card`}
            >
              {map ? <View style={styles.cardMap}>{map}</View> : null}
              <View style={styles.cardPlace} testID={`${ROUTE}.place`}>
                {placeLines}
              </View>
              {rsvp(true)}
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
            {when}
            {title}
            {badges}
            {organiserRow}
            {coverNote}
          </View>
          {review}
          <View style={styles.place} testID={`${ROUTE}.place`}>
            {map}
            <View style={styles.placeBody}>{placeLines}</View>
          </View>
          {sections}
        </View>
      </>
    );
  }

  return (
    <ProfileFrame
      routeId={ROUTE}
      layout={kind}
      overHero={overHero}
      title={event.title}
      onBack={onBack}
      actions={actions}
      header={header}
      photoCollapseAt={Math.max(0, heroHeight - barHeight)}
      scrollRef={scrollRef}
      onWidth={setContentWidth}
      offlineLabel={t('detail.offlineBanner')}
      floating={desktop ? undefined : rsvp(false)}
      overlays={
        <>
          <MoreSheet
            visible={moreOpen}
            onClose={() => setMoreOpen(false)}
            title={event.title}
            actions={more}
            testID={`${ROUTE}.more`}
          />
          {report.element}
        </>
      }
    >
      {body}
    </ProfileFrame>
  );
}
