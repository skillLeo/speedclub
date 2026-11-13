import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import { useMe, type Me } from '@/api/queries/auth';
import { useMyVehicles } from '@/api/queries/profile';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, useBreakpoint } from '@/theme';
import { ErrorState, toast, useCollapsingHeader, type HeaderAction } from '@/ui';

import { GuestInvitation, guestHeroHeight } from '../components/GuestInvitation';
import { PROFILE_COLUMN_MAX, PROFILE_WIDE_MAX, ProfileHeader, profileCover, profileCoverHeight } from '../components/ProfileHeader';
import { ProfileFrame } from '../components/ProfileFrame';
import { ProfileSkeleton } from '../components/ProfileSkeleton';
import { EventsPanel, GaragePanel, initialProfileTab, ProfileTabBar, profileTabs, SavedPanel, UpdatesPanel, useProfileTabFlags, type ProfileTab } from '../components/ProfileTabs';
import { profileVehicles } from '../media';
import { publicProfileUrl, shareLink } from '../share';

const ROUTE = 'PROF-01';
const PROFILE_PATH = '/profile';

const useStyles = createStyles((t) => ({
  column: { maxWidth: PROFILE_COLUMN_MAX, width: '100%' },
  wideColumn: { maxWidth: PROFILE_WIDE_MAX },
  centred: { flexGrow: 1, justifyContent: 'center', paddingTop: t.space[24] },
}));

/** A restriction that keeps the member from changing the profile (PATCH me/profile is `not-restricted:publishing`). */
export function useProfileRestriction(me: Me | undefined): string | null {
  const { t } = useTranslation('profile');
  const format = useFormat();
  const qaState = useQaState();
  if (qaState === 'restricted') return t('restricted');
  const publishing = me?.restrictions.publishing;
  if (!me || !(me.restrictions.suspended || publishing?.restricted)) return null;
  return publishing?.until ? t('restrictedUntil', { date: format.dateTime(new Date(publishing.until)) }) : t('restricted');
}

/**
 * PROF-01 Mein Profil ★ (09 §7.7): header pattern (b) — the 16:9 cover edge to edge (the member's cover, else the main build's
 * photo) with the settings gear floating over `scrim.top`; avatar, name, counts and the actions; then Garage · Updates · Treffen ·
 * Gespeichert. Signed in: auth/me and me/vehicles, both kept for offline use. A guest gets the brand invitation.
 */
export function ProfileScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const sessionMember = useSessionStore((state) => state.member);
  const me = useMe();
  const vehiclesQuery = useMyVehicles();
  const addVehicle = useAddVehicle();
  const header = useCollapsingHeader();
  const flags = useProfileTabFlags();
  const { width: windowWidth } = useWindowDimensions();
  const { gutter, kind } = useBreakpoint();
  const [width, setWidth] = useState(windowWidth);
  const [sharing, setSharing] = useState(false);
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<ProfileTab>(() => initialProfileTab(params.tab));
  const restriction = useProfileRestriction(me.data);
  const loaded = status === 'member' ? me.data : undefined;
  // The empty state has no vehicles, so its count says 0 (DQ-123).
  const member = loaded && qaState === 'empty' ? { ...loaded, stats: { ...loaded.stats, vehicles: 0 } } : loaded;
  const vehicles = qaState === 'empty' ? [] : profileVehicles(vehiclesQuery.data);
  const cardCovers = vehicles.map((vehicle) => vehicle.cover);
  const cover = member ? profileCover(member, cardCovers) : null;
  const columnWidth = Math.min(width, PROFILE_COLUMN_MAX);
  const inner = Math.max(0, columnWidth - 2 * gutter);
  // Desktop Garage tab: the wide column, the cards side by side (GaragePanel garageColumns).
  const wideInner = Math.max(0, Math.min(width, PROFILE_WIDE_MAX) - 2 * gutter);
  const reachable = online && me.fetchStatus !== 'paused';
  const tabs = profileTabs(true, flags);
  const current = tabs.includes(tab) ? tab : 'garage';

  const share = async () => {
    if (!member?.username) return;
    const url = publicProfileUrl(member.username);
    if (!url) return;
    setSharing(true);
    try {
      const outcome = await shareLink({ url, title: t('share.title', { name: member.display_name || `@${member.username}` }) });
      if (outcome === 'copied') toast(t('share.copied'), { testID: `${ROUTE}.toast` });
      if (outcome === 'failed') toast(t('share.failed', { url }), { testID: `${ROUTE}.toast` });
    } finally {
      setSharing(false);
    }
  };

  const settings: HeaderAction = { icon: 'gear-six', label: t('rows.settings'), onPress: () => router.push('/settings'), testID: `${ROUTE}.settings` };
  const loading = qaState === 'loading' || status === 'loading' || (status === 'member' && me.isPending && me.fetchStatus !== 'paused' && qaState !== 'error');
  const guest = !loading && status === 'guest';
  const coverHeight = guest ? guestHeroHeight(width, kind) : cover ? profileCoverHeight(width, kind) : 0;
  // The bar turns solid as the cover's bottom passes under it.
  const collapseAt = Math.max(0, coverHeight - size.header);

  let content: ReactNode;
  let overPhoto = false;
  if (loading) {
    const withCover = Boolean(me.data?.cover ?? sessionMember?.hasCover);
    // DQ-1092: the skeleton takes the content's header pattern (b): with a cover the bar floats over it, so the cover block starts
    // at y 0 as the cover will, and nothing jumps 44 up when the profile arrives.
    overPhoto = withCover;
    content = <ProfileSkeleton width={width} columnWidth={columnWidth} withCover={withCover} />;
  } else if (qaState === 'error' || (status === 'member' && !me.data)) {
    content = (
      <View style={[styles.centred, styles.column, { paddingHorizontal: gutter }]}>
        <ErrorState
          title={reachable ? t('error.title') : t('error.offlineTitle')}
          message={reachable ? undefined : t('error.offlineBody')}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
          testID={`${ROUTE}.error`}
        />
      </View>
    );
  } else if (!member) {
    overPhoto = true;
    content = <GuestInvitation routeId={ROUTE} returnTo={PROFILE_PATH} width={width} />;
  } else {
    overPhoto = cover !== null;
    let panel: ReactNode;
    if (current === 'garage') {
      panel = <GaragePanel routeId={ROUTE} own vehicles={vehicles} query={vehiclesQuery} width={kind === 'desktop' ? wideInner : inner} onAdd={addVehicle} />;
    } else if (current === 'updates') {
      const main = vehicles[0];
      panel = (
        <UpdatesPanel
          routeId={ROUTE}
          own
          vehicles={vehicles}
          ready={vehiclesQuery.data !== undefined}
          onPost={main ? () => router.push({ pathname: '/post-update', params: { vehicleId: main.id } }) : addVehicle}
        />
      );
    } else if (current === 'events') {
      panel = <EventsPanel routeId={ROUTE} />;
    } else {
      panel = <SavedPanel routeId={ROUTE} width={inner} />;
    }
    content = (
      <>
        <ProfileHeader
          me={member}
          width={width}
          cardCovers={cardCovers}
          sharing={sharing}
          onEdit={() => router.push('/profile/edit')}
          onShare={() => void share()}
          onQrCodes={() => router.push('/profile/qr')}
          onFollowers={() => router.push({ pathname: '/profile/connections', params: { tab: 'followers' } })}
          onFollowing={() => router.push({ pathname: '/profile/connections', params: { tab: 'following' } })}
          onNameBottom={cover ? undefined : (bottom) => header.collapseAt.set(bottom)}
          notice={restriction ? <FormNotice message={restriction} tone="info" testID={`${ROUTE}.restricted`} /> : null}
          readOnly={restriction !== null}
        />
        <View style={[styles.column, kind === 'desktop' ? styles.wideColumn : null, { paddingHorizontal: gutter }]}>
          <ProfileTabBar routeId={ROUTE} tabs={tabs} value={current} onChange={setTab} />
          {/* The other tabs keep the feed column inside the wide one: rows and lists do not stretch to 1200. */}
          {current === 'garage' ? panel : <View style={{ maxWidth: inner }}>{panel}</View>}
        </View>
      </>
    );
  }

  return (
    <ProfileFrame
      routeId={ROUTE}
      overPhoto={overPhoto}
      title={member ? member.display_name || `@${member.username ?? ''}` : t('title')}
      actions={[settings]}
      header={header}
      collapseAt={collapseAt}
      onWidth={setWidth}
      bodyTestID="screen.profile"
      // DQ-125: nothing waits to be sent here. A member sees the profile as last loaded, a guest needs the network to sign in.
      offlineLabel={status === 'member' ? t('offline') : status === 'guest' ? t('guest.offline') : undefined}
    >
      {content}
    </ProfileFrame>
  );
}
