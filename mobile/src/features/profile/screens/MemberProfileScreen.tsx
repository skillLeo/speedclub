import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import {
  forgetBlockedMember,
  isMemberUnavailable,
  memberIdOf,
  memberKeys,
  useMemberProfile,
  useMemberVehicles,
  type MemberProfile,
  type MemberVehicle,
} from '@/api/queries/social';
import { usePublicViewer } from '@/api/queries/vehicles';
import { newMessageHref, useMessageBlock } from '@/features/messages/entry';
import { BlockDialog } from '@/features/safety/BlockDialog';
import { useReport } from '@/features/safety/useReport';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, useBreakpoint } from '@/theme';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import { Button, EmptyState, ErrorState, IconButton, Text, toast, useCollapsingHeader } from '@/ui';

import { FollowButton } from '../components/FollowButton';
import { PROFILE_COLUMN_MAX, PROFILE_WIDE_MAX, profileCover, profileCoverHeight, ProfileIdentity } from '../components/ProfileHeader';
import { ProfileFrame } from '../components/ProfileFrame';
import { ProfileSkeleton } from '../components/ProfileSkeleton';
import { GaragePanel, initialProfileTab, ProfileTabBar, profileTabs, UpdatesPanel, useProfileTabFlags, type ProfileTab } from '../components/ProfileTabs';
import { profileVehicles } from '../media';
import { publicProfileUrl, shareLink } from '../share';

const ROUTE = 'PROF-02';

const useStyles = createStyles((t) => ({
  column: { maxWidth: PROFILE_COLUMN_MAX, width: '100%' },
  wideColumn: { maxWidth: PROFILE_WIDE_MAX },
  stateBody: { flexGrow: 1, justifyContent: 'center', paddingTop: t.space[24] },
}));

type ScreenState = 'loading' | 'ready' | 'unavailable' | 'error' | 'offline';

function stateOf(query: ReturnType<typeof useMemberProfile>, online: boolean, qaState: ReturnType<typeof useQaState>): ScreenState {
  if (qaState === 'loading') return 'loading';
  if (qaState === 'error') return 'error';
  // A public page has no account limit of its own: as on VEH-01, the matrix shows the one calm state of a hidden member.
  if (qaState === 'restricted') return 'unavailable';
  // The server's 404 wins over a copy: a member who blocked the viewer or left must not stay visible from the cache.
  if (isMemberUnavailable(query.error)) return 'unavailable';
  if (query.data !== undefined) return 'ready';
  if (query.error) return online ? 'error' : 'offline';
  if (query.fetchStatus === 'paused') return 'offline';
  return 'loading';
}

/**
 * PROF-02 /u/[username], FS-8 for another member: identity and stats (links to PROF-04), Folgen, Nachricht and more (Teilen,
 * Blockieren), then the public garage. A guest sees all of it; Folgen and Nachricht open the auth-required sheet. Your own name
 * goes to PROF-01, an old name (§3.1, 14 days) to the current one. Every hidden member is one calm "Profil nicht verfügbar".
 */
export function MemberProfileScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ username: string; tab?: string }>();
  const username = paramOf(params.username) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const { gutter, kind } = useBreakpoint();
  const back = useBack('/');
  const header = useCollapsingHeader();
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const [tab, setTab] = useState<ProfileTab>(() => initialProfileTab(params.tab));
  const flags = useProfileTabFlags();
  const [moreOpen, setMoreOpen] = useState(false);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // After a block the page is left, and its copy of the member is dropped: until it is gone it shows what it showed, asking nothing.
  const [left, setLeft] = useState<{ profile: MemberProfile; vehicles?: MemberVehicle[] } | null>(null);
  const viewer = usePublicViewer();
  const client = useQueryClient();
  const redirected = useRef<string | null>(null);

  const query = useMemberProfile(left ? undefined : username);
  const state = left ? 'ready' : stateOf(query, online, qaState);
  const loaded = left?.profile ?? (state === 'ready' ? query.data : undefined);
  const profile = loaded && qaState === 'empty' ? { ...loaded, bio: null, stats: { ...loaded.stats, vehicles: 0 } } : loaded;
  const canonical = query.data?.username;
  const isSelf = !left && query.data?.is_self === true;
  const columnWidth = Math.min(width, PROFILE_COLUMN_MAX);
  const inner = Math.max(0, columnWidth - 2 * gutter);
  // Desktop Garage tab: the wide column, the cards side by side (GaragePanel garageColumns).
  const wideInner = Math.max(0, Math.min(width, PROFILE_WIDE_MAX) - 2 * gutter);
  const vehiclesQuery = useMemberVehicles(profile?.username ?? username, !left && state === 'ready');
  const vehicleData = left ? left.vehicles : vehiclesQuery.data;
  const vehicles = qaState === 'empty' ? [] : profileVehicles(vehicleData);
  const garageQuery = left
    ? { data: left.vehicles ?? [], isPending: false, isFetching: false, fetchStatus: 'idle' as const, refetch: () => undefined }
    : vehiclesQuery;
  const cover = profile ? profileCover(profile, vehicles.map((vehicle) => vehicle.cover)) : null;
  const tabs = profileTabs(false, flags);
  const current = tabs.includes(tab) ? tab : 'garage';

  useEffect(() => {
    if (isSelf) {
      // Your own name belongs to PROF-01. In any stack, a deep link or the web's redirect included: this page leaves its stack
      // and the Profil tab opens. Once per name, and the page shows a real state meanwhile, never an endless skeleton.
      if (redirected.current === memberIdOf(username)) return;
      redirected.current = memberIdOf(username);
      if (router.canGoBack()) {
        router.back();
        router.navigate('/profile');
      } else {
        router.replace('/profile');
      }
    } else if (canonical && memberIdOf(canonical) !== memberIdOf(username)) {
      router.setParams({ username: canonical });
    }
  }, [canonical, isSelf, router, username]);

  const name = profile ? profile.display_name || `@${profile.username ?? username}` : '';
  const handle = `@${profile?.username ?? username}`;
  const connections = (tab: 'followers' | 'following') => () =>
    router.push({ pathname: '/u/[username]/connections', params: { username: profile?.username ?? username, tab } });

  const share = async () => {
    const url = publicProfileUrl(profile?.username ?? username);
    if (!url) return;
    setSharing(true);
    try {
      const outcome = await shareLink({ url, title: t('share.title', { name }) });
      if (outcome === 'copied') toast(t('member.shareCopied'), { testID: `${ROUTE}.toast` });
      if (outcome === 'failed') toast(t('share.failed', { url }), { testID: `${ROUTE}.toast` });
    } finally {
      setSharing(false);
    }
  };

  // DQ-265, M2.4: a guest's Nachricht asks to sign in and comes back here. A member's opens MSG-03 for this member, which goes
  // straight to an existing thread; when `can_message` is off the button stays disabled with the reason under the actions.
  const messageBlock = useMessageBlock(profile?.can_message ?? false);
  const memberMessage = status === 'member';
  const messageLock = useViewAsLock('messages');
  const message = () => {
    if (!memberMessage) requireAuth(undefined, { returnTo: pathname });
    else if (!messageBlock) router.push(newMessageHref({ to: profile?.username ?? username }));
  };
  const messageHelper = !memberMessage || !messageBlock
    ? null
    : messageBlock === 'unverified'
      ? t('member.messageUnverified')
      : messageBlock === 'restricted'
        ? t('member.messageRestricted')
        : t('member.messageClosed', { name: `@${profile?.username ?? username}` });

  const leaveAfterBlock = (blocked: string) => {
    setBlocking(null);
    if (profile) setLeft({ profile, vehicles: client.getQueryData<MemberVehicle[]>(memberKeys.vehicles(blocked, viewer)) });
    back();
    forgetBlockedMember(client, blocked);
  };
  const memberName = profile?.username ?? username;
  const report = useReport({ type: 'member', id: memberName, label: `@${memberName}`, owner: memberName }, { routeId: ROUTE, onBlocked: leaveAfterBlock });

  const moreActions: MoreAction[] = [
    { key: 'share', icon: 'share-network', label: t('member.share'), onPress: () => void share() },
    ...(report.available ? [{ key: 'report', icon: 'flag' as const, label: report.label, onPress: report.open }] : []),
    {
      key: 'block',
      icon: 'prohibit',
      label: t('member.block'),
      onPress: () => requireAuth(() => setBlocking(profile?.username ?? username), { returnTo: pathname }),
    },
  ];

  let body: ReactNode;
  let overPhoto = false;
  if (isSelf && profile) {
    body = (
      <ProfileIdentity
        profile={profile}
        routeId={ROUTE}
        width={width}
        actions={
          <Button label={t('member.ownProfile')} variant="secondary" size="m" onPress={() => router.navigate('/profile')} testID={`${ROUTE}.self`} />
        }
      />
    );
  } else if (state === 'loading') {
    body = <ProfileSkeleton width={width} columnWidth={columnWidth} variant="member" withMessage routeId={ROUTE} />;
  } else if (state === 'unavailable') {
    body = (
      <View style={[styles.stateBody, styles.column, { paddingHorizontal: gutter }]}>
        <EmptyState
          icon="user"
          title={t('member.unavailableTitle')}
          body={t('member.unavailableBody')}
          action={{ label: t('member.unavailableAction'), onPress: () => router.navigate('/discover'), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.unavailable`}
        />
      </View>
    );
  } else if (state !== 'ready' || !profile) {
    const offline = state === 'offline';
    body = (
      <View style={[styles.stateBody, styles.column, { paddingHorizontal: gutter }]}>
        <ErrorState
          title={offline ? t('error.offlineTitle') : t('member.errorTitle')}
          message={offline ? t('member.offlineBody') : undefined}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
        />
      </View>
    );
  } else {
    overPhoto = cover !== null;
    const memberName = profile.username ?? username;
    body = (
      <>
        <ProfileIdentity
          profile={profile}
          routeId={ROUTE}
          width={width}
          cardCovers={vehicles.map((vehicle) => vehicle.cover)}
          badge={profile.follows_you ? t('member.followsYou') : undefined}
          other
          onFollowers={connections('followers')}
          onFollowing={connections('following')}
          onNameBottom={cover ? undefined : (bottom) => header.collapseAt.set(bottom)}
          footer={
            messageHelper ? (
              <Text variant="caption" color="text.secondary" testID={`${ROUTE}.messageHelper`}>
                {messageHelper}
              </Text>
            ) : undefined
          }
          actions={
            <>
              <FollowButton username={memberName} following={status === 'member' && profile.is_following} name={name} testID={`${ROUTE}.follow`} />
              <Button
                label={t('member.message')}
                variant="secondary"
                size="m"
                disabled={memberMessage && messageBlock !== null}
                locked={messageLock}
                onPress={message}
                testID={`${ROUTE}.message`}
              />
              <IconButton icon="dots-three" label={t('member.more')} onPress={() => setMoreOpen(true)} loading={sharing} testID={`${ROUTE}.more`} />
            </>
          }
        />
        <View style={[styles.column, kind === 'desktop' ? styles.wideColumn : null, { paddingHorizontal: gutter }]}>
          <ProfileTabBar routeId={ROUTE} tabs={tabs} value={current} onChange={setTab} />
          {current === 'updates' ? (
            <View style={{ maxWidth: inner }}>
              <UpdatesPanel routeId={ROUTE} own={false} vehicles={vehicles} ready={vehicleData !== undefined} />
            </View>
          ) : (
            <GaragePanel routeId={ROUTE} own={false} vehicles={vehicles} query={garageQuery} width={kind === 'desktop' ? wideInner : inner} />
          )}
        </View>
      </>
    );
  }

  const coverHeight = overPhoto ? profileCoverHeight(width, kind) : 0;

  return (
    <ProfileFrame
      routeId={ROUTE}
      overPhoto={overPhoto}
      title={name}
      onBack={back}
      header={header}
      collapseAt={Math.max(0, coverHeight - size.header)}
      onWidth={setWidth}
      offlineLabel={t('member.offlineBanner')}
      overlays={
        <>
          <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={handle} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
          <BlockDialog username={blocking} onClose={() => setBlocking(null)} onBlocked={leaveAfterBlock} testID={`${ROUTE}.blockDialog`} />
          {report.element}
        </>
      }
    >
      {body}
    </ProfileFrame>
  );
}
