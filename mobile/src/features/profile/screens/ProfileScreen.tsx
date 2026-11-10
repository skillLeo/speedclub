import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useMe, type Me } from '@/api/queries/auth';
import { useMyVehicles, type VehicleCardData } from '@/api/queries/profile';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { RowGroup } from '@/ui/RowGroup';
import { TabRootScreen } from '@/features/shell/TabRootScreen';
import { useAddVehicle } from '@/features/shell/useAddVehicle';
import { SAVE_ICON, SAVED_BUILDS_FLAG } from '@/features/vehicle/save';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, space, useBreakpoint } from '@/theme';
import { Button, EmptyState, ErrorState, ListRow, SectionHeader, Skeleton, toast, VehicleCardSkeleton } from '@/ui';

import { GarageStrip, stripCardWidth } from '../components/GarageStrip';
import { GuestInvitation } from '../components/GuestInvitation';
import { ProfileHeader } from '../components/ProfileHeader';
import { ProfileSkeleton } from '../components/ProfileSkeleton';
import { profileVehicles } from '../media';
import { publicProfileUrl, shareLink } from '../share';

const PROFILE_PATH = '/profile';
/**
 * DQ-114, one desktop model for the profile tab: a column of 640 plus its gutters on the left, under the large title. The
 * identity, the garage with its header and strip, and the rows share its edges; the cover alone runs full width.
 */
const COLUMN_MAX = layout.feedColumn + 2 * layout.gutter.desktop;

const useStyles = createStyles((t) => ({
  root: { flexGrow: 1, paddingBottom: t.space[32] },
  column: { maxWidth: COLUMN_MAX, width: '100%' },
  section: { marginTop: t.space[32] },
  sectionHeader: { marginBottom: t.space[12] },
  rows: { marginTop: t.space[32] },
  centred: { flexGrow: 1, justifyContent: 'center' },
  // In the header's row the action centres on the title, as SectionHeader's own action does.
  sectionAction: { alignSelf: 'center' },
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

function OwnRows({ guest = false }: { guest?: boolean }) {
  const { t } = useTranslation('profile');
  const router = useRouter();
  const addVehicle = useAddVehicle();
  // FS-8: Meine QR-Codes · Gespeichert [SIG] · Einstellungen.
  const saved = useFlag(SAVED_BUILDS_FLAG);
  if (guest) {
    return (
      <RowGroup testID="PROF-01.rows">
        <ListRow icon="gear-six" title={t('rows.settings')} onPress={() => router.push('/settings')} inset={space[16]} testID="PROF-01.settings" />
      </RowGroup>
    );
  }
  return (
    <RowGroup testID="PROF-01.rows">
      <ListRow icon="qr-code" title={t('rows.qrCodes')} onPress={() => router.push('/profile/qr')} inset={space[16]} divider testID="PROF-01.qrCodes" />
      {saved ? (
        <ListRow icon={SAVE_ICON} title={t('rows.saved')} onPress={() => router.push('/profile/saved')} inset={space[16]} divider testID="PROF-01.saved" />
      ) : null}
      <ListRow icon="gear-six" title={t('rows.settings')} onPress={() => router.push('/settings')} inset={space[16]} divider testID="PROF-01.settings" />
      <ListRow icon="plus" title={t('rows.addVehicle')} onPress={addVehicle} inset={space[16]} testID="PROF-01.addVehicle" />
    </RowGroup>
  );
}

/** `width` is the column's: the strip scrolls inside it, and its header ends on the column's edge. */
function GarageSection({ width }: { width: number }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const addVehicle = useAddVehicle();
  const { gutter, kind } = useBreakpoint();
  const query = useMyVehicles();
  const vehicles = qaState === 'empty' ? [] : profileVehicles(query.data);
  const open = useCallback((vehicle: VehicleCardData) => router.push(`/v/${vehicle.slug}`), [router]);
  const column = { paddingHorizontal: gutter };

  let body: ReactNode;
  if (query.isPending && query.fetchStatus !== 'paused' && qaState !== 'empty') {
    const cardWidth = stripCardWidth(width, gutter, kind);
    body = (
      <Skeleton testID="PROF-01.garage.skeleton" style={column}>
        <View style={{ width: cardWidth }}>
          <VehicleCardSkeleton />
        </View>
      </Skeleton>
    );
  } else if (!query.data && (query.isError || query.fetchStatus === 'paused') && qaState !== 'empty') {
    body = (
      <ErrorState
        title={t('garage.errorTitle')}
        message={t('garage.errorBody')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID="PROF-01.garage.error"
      />
    );
  } else if (vehicles.length === 0) {
    body = (
      <EmptyState
        variant="brand"
        icon="wheel"
        title={t('garage.emptyTitle')}
        body={t('garage.emptyBody')}
        hyphenateBody={false}
        action={{ label: t('garage.add'), onPress: addVehicle }}
        testID="PROF-01.garage.empty"
      />
    );
  } else {
    body = <GarageStrip vehicles={vehicles} width={width} gutter={gutter} kind={kind} onOpen={open} />;
  }

  return (
    <View style={[styles.section, styles.column]} testID="PROF-01.garage">
      <SectionHeader
        title={t('garage.title')}
        trailing={
          vehicles.length > 0 ? (
            // The label ends on the content edge, and may wrap at a large font instead of pushing past the screen.
            <Button
              label={t('garage.all')}
              onPress={() => router.navigate('/garage')}
              variant="tertiary"
              size="s"
              flush="end"
              style={styles.sectionAction}
              testID="PROF-01.garage.header.action"
            />
          ) : null
        }
        style={[styles.sectionHeader, column]}
        testID="PROF-01.garage.header"
      />
      {body}
    </View>
  );
}

/**
 * PROF-01, FS-8. Signed in: the own profile from auth/me and the garage from me/vehicles, both kept for offline use.
 * A guest gets an invitation to sign in, and the settings that work without an account.
 */
export function ProfileScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  // The garage strip mounts only once the member is there; asking for its vehicles here sends both requests at once
  // instead of one after the other. Same key, so the strip reads this very query.
  useMyVehicles();
  const { width: windowWidth } = useWindowDimensions();
  const { gutter } = useBreakpoint();
  const [width, setWidth] = useState(windowWidth);
  const [sharing, setSharing] = useState(false);
  const restriction = useProfileRestriction(me.data);
  const savedRow = useFlag(SAVED_BUILDS_FLAG);
  const sessionMember = useSessionStore((state) => state.member);
  const loaded = status === 'member' ? me.data : undefined;
  // The empty state has no vehicles, so its count says 0 (DQ-123).
  const member = loaded && qaState === 'empty' ? { ...loaded, stats: { ...loaded.stats, vehicles: 0 } } : loaded;
  const columnWidth = Math.min(width, COLUMN_MAX);
  const withCover = Boolean(me.data?.cover ?? sessionMember?.hasCover);
  // A request waiting for the network is paused, not loading: offline without a copy shows the offline state.
  const reachable = online && me.fetchStatus !== 'paused';

  const share = async () => {
    if (!member?.username) return;
    const url = publicProfileUrl(member.username);
    if (!url) return;
    setSharing(true);
    try {
      const outcome = await shareLink({ url, title: t('share.title', { name: member.display_name || `@${member.username}` }) });
      if (outcome === 'copied') toast(t('share.copied'), { testID: 'PROF-01.toast' });
      if (outcome === 'failed') toast(t('share.failed', { url }), { testID: 'PROF-01.toast' });
    } finally {
      setSharing(false);
    }
  };

  let content: ReactNode;
  if (qaState === 'loading' || status === 'loading' || (status === 'member' && me.isPending && me.fetchStatus !== 'paused' && qaState !== 'error')) {
    content = <ProfileSkeleton width={width} columnWidth={columnWidth} withCover={withCover} rows={savedRow ? 4 : 3} />;
  } else if (qaState === 'error' || (status === 'member' && !me.data)) {
    content = (
      <View style={styles.centred}>
        <ErrorState
          title={reachable ? t('error.title') : t('error.offlineTitle')}
          message={reachable ? undefined : t('error.offlineBody')}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
          testID="PROF-01.error"
        />
      </View>
    );
  } else if (!member) {
    content = (
      <>
        <View style={[styles.column, { paddingHorizontal: gutter }]}>
          <GuestInvitation routeId="PROF-01" returnTo={PROFILE_PATH} />
        </View>
        <View style={[styles.rows, styles.column, { paddingHorizontal: gutter }]}>
          <OwnRows guest />
        </View>
      </>
    );
  } else {
    content = (
      <>
        <ProfileHeader
          me={member}
          width={width}
          sharing={sharing}
          onEdit={() => router.push('/profile/edit')}
          onShare={() => void share()}
          onQrCodes={() => router.push('/profile/qr')}
          onFollowers={() => router.push({ pathname: '/profile/connections', params: { tab: 'followers' } })}
          onFollowing={() => router.push({ pathname: '/profile/connections', params: { tab: 'following' } })}
          notice={restriction ? <FormNotice message={restriction} tone="info" testID="PROF-01.restricted" /> : null}
          readOnly={restriction !== null}
        />
        <GarageSection width={columnWidth} />
        <View style={[styles.rows, styles.column, { paddingHorizontal: gutter }]}>
          <OwnRows />
        </View>
      </>
    );
  }

  return (
    <TabRootScreen
      routeId="PROF-01"
      title={t('title')}
      bodyTestID="screen.profile"
      // DQ-125: nothing waits to be sent here. A member sees the profile as last loaded, a guest needs the network to sign in.
      offlineLabel={status === 'member' ? t('offline') : status === 'guest' ? t('guest.offline') : undefined}
    >
      <View style={styles.root} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {content}
      </View>
    </TabRootScreen>
  );
}
