import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import type { VehicleCardData } from '@/api/queries/profile';
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
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarPadding } from '@/features/shell/tabBarLayout';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, layout, useBreakpoint, useMotion } from '@/theme';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import {
  Button,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
  toast,
  useCollapsingHeader,
  VehicleCardSkeleton,
} from '@/ui';

import { FollowButton } from '../components/FollowButton';
import { GarageStrip, stripCardWidth } from '../components/GarageStrip';
import { ProfileIdentity } from '../components/ProfileHeader';
import { ProfileSkeleton } from '../components/ProfileSkeleton';
import { profileVehicles } from '../media';
import { publicProfileUrl, shareLink } from '../share';

const ROUTE = 'PROF-02';
const EDGES: readonly Edge[] = ['left', 'right'];
/** The column of PROF-01 (DQ-114): 640 plus its gutters, on the start edge; the cover alone runs full width. */
const COLUMN_MAX = layout.feedColumn + 2 * layout.gutter.desktop;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32] },
  column: { maxWidth: COLUMN_MAX, width: '100%' },
  section: { marginTop: t.space[32] },
  sectionHeader: { marginBottom: t.space[12] },
  stateBody: { alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
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

type GarageProps = {
  username: string;
  width: number;
  empty: boolean;
  /** The page is being left after a block: it asks for nothing more and shows what it showed. */
  frozen?: readonly MemberVehicle[];
};

function MemberGarage({ username, width, empty, frozen }: GarageProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const { gutter, kind } = useBreakpoint();
  const query = useMemberVehicles(username, !frozen);
  const data = frozen ?? query.data;
  const vehicles = empty ? [] : profileVehicles(data);
  const open = useCallback((vehicle: VehicleCardData) => router.push(`/v/${vehicle.slug}`), [router]);
  const column = { paddingHorizontal: gutter };

  let body: ReactNode;
  if (!empty && !data && query.isPending && query.fetchStatus !== 'paused') {
    body = (
      <Skeleton testID={`${ROUTE}.garage.skeleton`} style={column}>
        <View style={{ width: stripCardWidth(width, gutter, kind) }}>
          <VehicleCardSkeleton />
        </View>
      </Skeleton>
    );
  } else if (!empty && !data) {
    body = (
      <ErrorState
        title={t('member.garageError')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.garage.error`}
      />
    );
  } else if (vehicles.length === 0) {
    body = (
      <View style={column}>
        <Text variant="bodyDense" color="text.secondary" testID={`${ROUTE}.garage.empty`}>
          {t('member.garageEmpty')}
        </Text>
      </View>
    );
  } else {
    body = <GarageStrip vehicles={vehicles} width={width} gutter={gutter} kind={kind} onOpen={open} routeId={ROUTE} />;
  }

  return (
    <View style={[styles.section, styles.column]} testID={`${ROUTE}.garage`}>
      <SectionHeader title={t('garage.title')} style={[styles.sectionHeader, column]} testID={`${ROUTE}.garage.header`} />
      {body}
    </View>
  );
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
  const params = useLocalSearchParams<{ username: string }>();
  const username = paramOf(params.username) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotion();
  const padding = useTabBarPadding();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const { gutter, kind } = useBreakpoint();
  const back = useBack('/');
  const header = useCollapsingHeader();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [width, setWidth] = useState(0);
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
  const columnWidth = Math.min(width, COLUMN_MAX);

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

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

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
      <View style={styles.stateBody}>
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
      <View style={styles.stateBody}>
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
    body = (
      <>
        <ProfileIdentity
          profile={profile}
          routeId={ROUTE}
          width={width}
          badge={profile.follows_you ? t('member.followsYou') : undefined}
          other
          onFollowers={connections('followers')}
          onFollowing={connections('following')}
          onNameBottom={(bottom) => header.collapseAt.set(bottom)}
          footer={
            messageHelper ? (
              <Text variant="helper" color="text.secondary" testID={`${ROUTE}.messageHelper`}>
                {messageHelper}
              </Text>
            ) : undefined
          }
          actions={
            <>
              <FollowButton
                username={profile.username ?? username}
                following={status === 'member' && profile.is_following}
                name={name}
                testID={`${ROUTE}.follow`}
              />
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
        <MemberGarage username={profile.username ?? username} width={columnWidth} empty={qaState === 'empty'} frozen={left ? (left.vehicles ?? []) : undefined} />
      </>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={name}
        scroll={header}
        onBack={back}
        contentMaxWidth={kind === 'phone' ? undefined : COLUMN_MAX}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('member.offlineBanner')} />
      {state === 'ready' ? (
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          style={styles.scroll}
          contentContainerStyle={[styles.content, padding]}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          testID={`${ROUTE}.scroll`}
        >
          {body}
        </Animated.ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, padding, state === 'loading' ? null : { paddingHorizontal: gutter }]}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          testID={`${ROUTE}.scroll`}
        >
          {body}
        </ScrollView>
      )}
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={handle} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
      <BlockDialog
        username={blocking}
        onClose={() => setBlocking(null)}
        onBlocked={leaveAfterBlock}
        testID={`${ROUTE}.blockDialog`}
      />
      {report.element}
    </Screen>
  );
}
