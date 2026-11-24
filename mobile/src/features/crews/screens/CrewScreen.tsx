import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { newIdempotencyKey } from '@/api/client';
import {
  flattenPages,
  isCrewUnavailable,
  useAcceptCrewInvite,
  useCrew,
  useCrewMembers,
  useCrewsOn,
  useJoinCrew,
  useLeaveCrew,
  useWithdrawCrewRequest,
  type Crew,
} from '@/api/queries/crews';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { photoFields } from '@/features/profile/media';
import { shareLink } from '@/features/profile/share';
import {
  AVATAR_OVERLAP_EXEMPT,
  PROFILE_COLUMN_MAX,
  profileAvatarOverlap,
  profileAvatarSize,
  profileCoverAspect,
  profileCoverHeight,
  profileCoverWidth,
} from '@/features/profile/components/ProfileHeader';
import { ProfileFrame } from '@/features/profile/components/ProfileFrame';
import { useReport } from '@/features/safety/useReport';
import { siteUrl } from '@/features/settings/markdown/links';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Avatar } from '@/ui/Avatar';
import { SampleBadge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { type HeaderAction } from '@/ui/Header';
import { Photo } from '@/ui/Photo';
import { PhotoTopScrim } from '@/ui/PhotoStageScrim';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';

import { useCrewAccess } from '../access';
import { cachedCrewHasCover } from '../cache';
import { CrewMemberRow, CrewMembersSkeleton } from '../components/CrewMemberRow';
import { CrewMosaic, crewMosaicTiles } from '../components/CrewMosaic';
import { FactLine, facts } from '../components/FactLine';
import { canManage, crewAction, crewEditPath, crewErrorText, crewManagePath, crewPath, CREWS_PATH, joinModeLabel, memberCountLabel, tx } from '../model';

const ROUTE = 'CREW-01';

const useStyles = createStyles((t) => ({
  column: { alignSelf: 'flex-start', maxWidth: PROFILE_COLUMN_MAX, width: '100%' },
  identity: { gap: t.space[12] },
  logoWrap: { alignSelf: 'flex-start' },
  // No cover, no photo (R4DQ-04): the identity starts under the bar.
  plain: { paddingTop: t.space[16] },
  // The canvas ring (09 §7.7) that separates the logo from the photo it overlaps: a circle around the circle, the logo plus twice
  // the ring (R4DQ-18).
  ring: { backgroundColor: t.color.bg.canvas, borderRadius: t.radius.full, padding: t.space[2] },
  logo: { borderRadius: t.radius.full, overflow: 'hidden' },
  names: { gap: t.space[4] },
  facts: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[4] },
  members: { gap: t.space[12], marginTop: t.space[32] },
  more: { alignSelf: 'flex-start' },
  state: { flexGrow: 1, justifyContent: 'center', paddingTop: t.space[24] },
  skeleton: { gap: t.space[12] },
}));

/**
 * CREW-01 Crew `/crews/[slug]` (11 R4-2.3, contract §2/§3): header pattern (b) over the crew's 16:9 cover (desktop 3:1, as the profile
 * cover, R4-1.3) with the round logo overlapping it; a crew without a cover has no photo and the plain bar (R4DQ-04); the name, Bundesland and since when, the description, the join mode and the member count
 * as facts, the viewer's one action by `viewer.state` (Beitreten / Anfrage senden / Anfrage zurückziehen / Einladung annehmen /
 * Verlassen; founder and admins Bearbeiten and Verwalten), then the members (founder → admins → members) with their public builds.
 * Teilen and Melden in the header (report target `crew`). An old slug answers the crew under its new one: the address follows (C7).
 */
export function CrewScreen() {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = (paramOf(params.slug) ?? '').toLowerCase();
  const qaState = useQaState();
  const online = useOnline();
  const flag = useCrewsOn();
  const back = useBack(CREWS_PATH as Href);
  const query = useCrew(slug);
  // R4DQ-53: the members load beside the crew; a crew without a cover waits for them, as its header is made of their cars.
  const members = useCrewMembers(slug);
  const header = useCollapsingHeader();
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const client = useQueryClient();

  // C7: a renamed crew answers its old slug with the new one; the page moves to it so a share or a reload uses the current address.
  const current = query.data?.slug;
  useEffect(() => {
    if (current && current !== slug) router.replace(crewPath(current) as Href);
  }, [current, router, slug]);

  const pending = query.isPending && query.fetchStatus !== 'paused';
  const membersSettling = Boolean(query.data && !query.data.cover) && members.isPending && members.fetchStatus === 'fetching' && members.failureCount === 0;
  const loading = qaState === 'loading' || (qaState === 'default' && flag && (pending || membersSettling));
  const offline = qaState === 'offline' || (!query.data && (!online || query.fetchStatus === 'paused'));
  if (query.data && !loading && qaState !== 'error' && qaState !== 'offline' && qaState !== 'empty') {
    return <CrewView crew={query.data} onBack={back} header={header} />;
  }

  let body: ReactNode;
  if (loading) {
    const withCover = cachedCrewHasCover(client, slug) === true;
    return (
      <ProfileFrame routeId={ROUTE} overPhoto={withCover} onBack={back} header={header} scrollEnabled={false} offlineLabel={t('states.offlineBanner')}>
        <CrewSkeleton withCover={withCover} />
      </ProfileFrame>
    );
  }
  if (!flag && qaState === 'default') {
    body = <EmptyState icon="users" title={t('list.unavailableTitle')} body={t('list.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else if (qaState === 'empty' || (qaState === 'default' && isCrewUnavailable(query.error))) {
    body = (
      <EmptyState
        icon="users"
        title={t('page.notFoundTitle')}
        body={t('page.notFoundBody')}
        action={{ label: t('page.toCrews'), onPress: () => router.navigate(CREWS_PATH as Href), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else {
    const isOffline = qaState === 'offline' || (qaState !== 'error' && offline);
    body = (
      <ErrorState
        title={isOffline ? t('states.offlineTitle') : t('page.errorTitle')}
        message={isOffline ? t('states.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${isOffline ? 'offline' : 'error'}`}
      />
    );
  }
  return (
    <ProfileFrame routeId={ROUTE} overPhoto={false} title={t('title')} onBack={back} header={header} offlineLabel={t('states.offlineBanner')}>
      <View style={[styles.column, styles.state, { paddingHorizontal: gutter }]}>{body}</View>
    </ProfileFrame>
  );
}

function CrewView({ crew, onBack, header }: { crew: Crew; onBack: () => void; header: ReturnType<typeof useCollapsingHeader> }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const access = useCrewAccess();
  const requireAuth = useRequireAuth();
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const [width, setWidth] = useState(windowWidth);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const joinKey = useRef(newIdempotencyKey());

  const members = useCrewMembers(crew.slug);
  const rows = useMemo(() => flattenPages(members.data?.pages, (row) => row.member.username ?? row.joined_at), [members.data?.pages]);
  const join = useJoinCrew();
  const accept = useAcceptCrewInvite();
  const withdraw = useWithdrawCrewRequest();
  const leave = useLeaveCrew();

  const action = crewAction(crew);
  const manage = canManage(crew);
  const founder = crew.founder?.username ?? undefined;
  const isFounder = crew.viewer?.role === 'founder';
  const report = useReport(isFounder ? null : { type: 'crew', id: crew.id, label: crew.name, owner: founder }, { routeId: ROUTE });

  const coverWidth = profileCoverWidth(width, kind);
  const collapseAt = Math.max(0, profileCoverHeight(width, kind) - size.header);
  const logoSize = profileAvatarSize(kind);
  // R4DQ-53: without a cover the page opens on its members' cars (2–3 tiles in the cover's place); with none, on the plain bar.
  const tiles = useMemo(() => (crew.cover ? [] : crewMosaicTiles(rows)), [crew.cover, rows]);
  const hasCover = Boolean(crew.cover) || tiles.length > 0;
  const restriction = access.restriction;
  const writesBlocked = restriction !== null || !online;

  const failed = (error: unknown) => {
    haptics.error();
    toast(crewErrorText(t, error), { testID: `${ROUTE}.toast` });
  };

  const doJoin = () => {
    if (restriction) {
      toast(restriction, { testID: `${ROUTE}.toast` });
      return;
    }
    join.mutate(
      { slug: crew.slug, idempotencyKey: joinKey.current },
      {
        onSuccess: (next) => {
          joinKey.current = newIdempotencyKey();
          if (next.viewer?.state === 'member') {
            haptics.success();
            toast(t('page.joined', { name: crew.name }), { testID: `${ROUTE}.toast` });
          } else {
            haptics.light();
            toast(t('page.requested'), { testID: `${ROUTE}.toast` });
          }
        },
        onError: (error) => {
          joinKey.current = newIdempotencyKey();
          failed(error);
        },
      },
    );
  };
  const doAccept = () => {
    const inviteId = crew.viewer?.invite_id;
    if (!inviteId) {
      doJoin();
      return;
    }
    if (restriction) {
      toast(restriction, { testID: `${ROUTE}.toast` });
      return;
    }
    accept.mutate(
      { inviteId, idempotencyKey: joinKey.current, slug: crew.slug },
      {
        onSuccess: () => {
          joinKey.current = newIdempotencyKey();
          haptics.success();
          toast(t('page.joined', { name: crew.name }), { testID: `${ROUTE}.toast` });
        },
        onError: (error) => {
          joinKey.current = newIdempotencyKey();
          failed(error);
        },
      },
    );
  };
  const doWithdraw = () =>
    withdraw.mutate(crew.slug, {
      onSuccess: () => {
        haptics.light();
        toast(t('page.withdrawn'), { testID: `${ROUTE}.toast` });
      },
      onError: failed,
    });
  const doLeave = () =>
    leave.mutate(crew.slug, {
      onSuccess: () => {
        setLeaving(false);
        haptics.success();
        toast(t('page.left', { name: crew.name }), { testID: `${ROUTE}.toast` });
      },
      onError: (error) => {
        setLeaving(false);
        failed(error);
      },
    });

  const share = async () => {
    const site = siteUrl();
    if (!site) return;
    const url = `${site.replace(/\/+$/, '')}/app${crew.share_path}`;
    setSharing(true);
    try {
      const outcome = await shareLink({ url, title: crew.name });
      if (outcome === 'copied') toast(t('page.copied'), { testID: `${ROUTE}.toast` });
      if (outcome === 'failed') toast(t('page.shareFailed', { url }), { testID: `${ROUTE}.toast` });
    } finally {
      setSharing(false);
    }
  };

  const headerActions: HeaderAction[] = [{ icon: 'share-network', label: t('page.share'), onPress: () => void share(), disabled: sharing, testID: `${ROUTE}.share` }];
  const moreActions: MoreAction[] = [];
  if (report.available && !isFounder) moreActions.push({ key: 'report', icon: 'flag', label: report.label, onPress: report.open });
  if (moreActions.length > 0) headerActions.push({ icon: 'dots-three', label: t('page.more'), onPress: () => setMoreOpen(true), testID: `${ROUTE}.more` });

  const returnTo = crewPath(crew.slug);
  const busy = join.isPending || accept.isPending || withdraw.isPending || leave.isPending;
  let primary: ReactNode = null;
  switch (action) {
    case 'join':
    case 'request':
      primary = (
        <Button
          label={action === 'join' ? t('page.join') : t('page.request')}
          variant="primary"
          size="m"
          loading={join.isPending}
          disabled={writesBlocked || busy}
          onPress={doJoin}
          testID={`${ROUTE}.${action}`}
        />
      );
      break;
    case 'signIn':
      primary = (
        <Button
          label={crew.join_mode === 'open' ? t('page.join') : t('page.request')}
          variant="primary"
          size="m"
          onPress={() => requireAuth(undefined, { returnTo })}
          testID={`${ROUTE}.signIn`}
        />
      );
      break;
    case 'accept':
      primary = (
        <Button label={t('page.accept')} variant="primary" size="m" loading={accept.isPending || join.isPending} disabled={writesBlocked || busy} onPress={doAccept} testID={`${ROUTE}.accept`} />
      );
      break;
    case 'withdraw':
      primary = <Button label={t('page.withdraw')} variant="secondary" size="m" loading={withdraw.isPending} disabled={!online || busy} onPress={doWithdraw} testID={`${ROUTE}.withdraw`} />;
      break;
    case 'leave':
      primary = <Button label={t('page.leave')} variant="secondary" size="m" disabled={!online || busy} onPress={() => setLeaving(true)} testID={`${ROUTE}.leave`} />;
      break;
    default:
      primary = null;
  }

  const pendingCount = crew.pending_requests_count ?? 0;
  const meta = [crew.bundesland_label, crew.created_at ? t('page.since', { date: format.monthYear(new Date(crew.created_at)) }) : null].filter(Boolean).join(' · ');
  const factParts = facts([{ text: joinModeLabel(t, crew.join_mode) }, !crew.is_sample && { text: memberCountLabel(t, crew.member_count, format.number), numeric: true }]);
  const logoView = crew.logo ? (
    <Photo {...photoFields(crew.logo, logoSize)} aspect="1:1" corner="full" label={t('page.logoLabel', { name: crew.name })} style={[styles.logo, { width: logoSize }]} testID={`${ROUTE}.logo`} />
  ) : (
    <Avatar name={crew.name} size={logoSize} decorative testID={`${ROUTE}.logo`} />
  );

  const content = (
    <>
      {/* R4DQ-04: a crew without a cover shows no stand-in; R4DQ-53: its members' cars lead instead, when they show any. */}
      {width > 0 && !crew.cover && tiles.length > 0 ? (
        <CrewMosaic tiles={tiles} width={coverWidth} height={profileCoverHeight(width, kind)} testID={`${ROUTE}.mosaic`} />
      ) : null}
      {width > 0 && crew.cover ? (
        <Photo
          {...photoFields(crew.cover, coverWidth)}
          aspect={profileCoverAspect(kind)}
          label={t('page.coverLabel', { name: crew.name })}
          priority="high"
          style={{ width: coverWidth }}
          testID={`${ROUTE}.cover`}
        >
          <PhotoTopScrim />
        </Photo>
      ) : null}
      <View style={[styles.column, hasCover ? null : styles.plain, { paddingHorizontal: gutter }]}>
        <View style={styles.identity} testID={`${ROUTE}.identity`}>
          <View style={[styles.logoWrap, hasCover ? { marginTop: -profileAvatarOverlap(kind) } : null]} dataSet={AVATAR_OVERLAP_EXEMPT}>
            <View style={styles.ring}>{logoView}</View>
          </View>
          <View style={styles.names}>
            <Text variant="title1" role="heading" aria-level={1} testID={`${ROUTE}.name`}>
              {crew.name}
            </Text>
            {meta ? (
              <Text variant="caption" color="text.tertiary" testID={`${ROUTE}.meta`}>
                {meta}
              </Text>
            ) : null}
          </View>
          <View style={styles.facts}>
            <FactLine parts={factParts} variant="callout" color="text.secondary" testID={`${ROUTE}.facts`} />
            {crew.is_sample ? <SampleBadge testID={`${ROUTE}.sample`} /> : null}
            {crew.viewer?.role ? <StatusPill label={tx(t, `page.yourRole.${crew.viewer.role}`)} testID={`${ROUTE}.role`} /> : null}
          </View>
          {crew.description ? (
            <Text variant="body" testID={`${ROUTE}.description`}>
              {crew.description}
            </Text>
          ) : null}
          {crew.status !== 'active' ? <FormNotice tone="info" message={tx(t, `page.status.${crew.status}`)} testID={`${ROUTE}.status`} /> : null}
          {restriction && status === 'member' && (action === 'join' || action === 'request' || action === 'accept') ? (
            <FormNotice tone="info" message={restriction} testID={`${ROUTE}.restricted`} />
          ) : null}
          <View style={styles.actions} testID={`${ROUTE}.actions`}>
            {primary}
            {crew.viewer?.can.edit ? (
              <Button label={t('page.edit')} variant="secondary" size="m" icon="pencil-simple" onPress={() => router.push(crewEditPath(crew.slug) as Href)} testID={`${ROUTE}.edit`} />
            ) : null}
            {manage ? (
              <Button
                label={pendingCount > 0 ? t('page.manageWithRequests', { count: pendingCount, value: format.number(pendingCount) }) : t('page.manage')}
                variant="secondary"
                size="m"
                icon="gear-six"
                onPress={() => router.push(crewManagePath(crew.slug) as Href)}
                testID={`${ROUTE}.manage`}
              />
            ) : null}
          </View>
          {action === 'inviteOnly' ? (
            <Text variant="caption" color="text.secondary" testID={`${ROUTE}.inviteOnly`}>
              {t('page.inviteOnly')}
            </Text>
          ) : null}
          {action === 'withdraw' ? (
            <Text variant="caption" color="text.secondary" testID={`${ROUTE}.requestPending`}>
              {t('page.requestPending')}
            </Text>
          ) : null}
        </View>
        <View style={styles.members} testID={`${ROUTE}.members`}>
          <Text variant="title2" role="heading" aria-level={2}>
            {t('page.members')}
          </Text>
          {members.isPending && members.fetchStatus !== 'paused' ? (
            <CrewMembersSkeleton testID={`${ROUTE}.members.skeleton`} />
          ) : members.isError && rows.length === 0 ? (
            <ErrorState title={t('page.membersError')} onRetry={() => void members.refetch()} retrying={members.isFetching} testID={`${ROUTE}.members.error`} />
          ) : (
            rows.map((row, index) => (
              <View key={row.member.username ?? index}>
                {index > 0 ? <Hairline /> : null}
                <CrewMemberRow
                  row={row}
                  inheritSample={crew.is_sample}
                  selfLabel={t('page.you')}
                  onOpenMember={(username) => router.push(`/u/${username}` as Href)}
                  onOpenVehicle={(vehicleSlug) => router.push(`/v/${vehicleSlug}` as Href)}
                  testID={`${ROUTE}.member.${row.member.username ?? index}`}
                />
              </View>
            ))
          )}
          {members.hasNextPage ? (
            <Button
              label={t('page.moreMembers')}
              variant="tertiary"
              size="m"
              flush="start"
              loading={members.isFetchingNextPage}
              onPress={() => void members.fetchNextPage()}
              style={styles.more}
              testID={`${ROUTE}.members.more`}
            />
          ) : null}
        </View>
      </View>
    </>
  );

  return (
    <ProfileFrame
      routeId={ROUTE}
      overPhoto={hasCover}
      title={crew.name}
      onBack={onBack}
      actions={headerActions}
      header={header}
      collapseAt={hasCover ? collapseAt : undefined}
      photoWidth={hasCover && kind === 'desktop' ? coverWidth : undefined}
      onWidth={setWidth}
      offlineLabel={t('states.offlineBanner')}
      bodyTestID={`${ROUTE}.body`}
      overlays={
        <>
          <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={crew.name} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
          <Dialog
            visible={leaving}
            onClose={() => setLeaving(false)}
            title={t('page.leaveTitle', { name: crew.name })}
            body={crew.join_mode === 'open' ? t('page.leaveBodyOpen') : t('page.leaveBody')}
            actions={[
              { label: t('page.leaveConfirm'), onPress: doLeave, destructive: true, loading: leave.isPending, testID: `${ROUTE}.leave.confirm` },
              { label: t('cancel'), onPress: () => setLeaving(false), variant: 'tertiary', testID: `${ROUTE}.leave.cancel` },
            ]}
            testID={`${ROUTE}.leaveDialog`}
          />
          {report.element}
        </>
      }
    >
      {content}
    </ProfileFrame>
  );
}

/**
 * The page while it loads, in its geometry: the cover block when the crew has one (else the plain bar, R4DQ-04), the logo as the
 * circle it is (R4DQ-32), name and fact lines, the action, and member rows.
 */
function CrewSkeleton({ withCover }: { withCover: boolean }) {
  const styles = useStyles();
  const { gutter, kind, width } = useBreakpoint();
  const logoSize = profileAvatarSize(kind);
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      {withCover ? <SkeletonBlock width={profileCoverWidth(width, kind)} height={profileCoverHeight(width, kind)} corner="none" /> : null}
      <View style={[styles.column, styles.skeleton, withCover ? null : styles.plain, { paddingHorizontal: gutter }]}>
        <View style={[styles.logoWrap, withCover ? { marginTop: -profileAvatarOverlap(kind) } : null]} dataSet={AVATAR_OVERLAP_EXEMPT}>
          <View style={styles.ring}>
            <SkeletonBlock width={logoSize} height={logoSize} corner="full" />
          </View>
        </View>
        <SkeletonText variant="title1" width="60%" />
        <SkeletonText variant="caption" width="40%" />
        <SkeletonText variant="callout" width="50%" />
        <SkeletonText variant="body" width="90%" lines={2} />
        <SkeletonBlock width="45%" height={size.button.m} corner="sm" />
        <View style={styles.members}>
          <SkeletonText variant="title2" width="35%" />
          <CrewMembersSkeleton />
        </View>
      </View>
    </Skeleton>
  );
}
