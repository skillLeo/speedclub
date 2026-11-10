import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCachedCard, useSetMainVehicle, useVehicle } from '@/api/queries/garage';
import { myVehiclesKey } from '@/api/queries/profile';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { StateScreen } from '@/features/vehicle/components/StateScreen';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { VehicleProfileSkeleton } from '@/features/vehicle/components/VehicleProfileSkeleton';
import { isProfileTab, withoutContent, type ProfileTab } from '@/features/vehicle/model';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useVehicleShare } from '@/features/vehicle/share';
import { RouteStateBody, routeStateOf } from '@/features/vehicle/states';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { toast } from '@/ui';

import { GoneState, RestrictedNotice, SignInState, useGarageAccess } from '../components/frames';
import { CompletenessHints, OwnerToolbar, ownerToolLabels, VisibilityNote } from '../components/OwnerToolbar';
import { isGone, saveErrorMessage } from '../errors';

const ROUTE = 'GAR-02';

const useStyles = createStyles((t) => ({
  owner: { gap: t.space[16] },
}));

/**
 * GAR-02 /garage/[id]: the public layout of VEH-01 with the owner toolbar and the completeness hints (04_SCREEN_REGISTER).
 * The owner reads the page through the public route, also for a private vehicle or a draft (handover).
 */
export function GarageVehicleScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = paramOf(params.id) ?? '';
  const back = useBack('/garage');
  const access = useGarageAccess();
  const card = useCachedCard(id);
  const own = useVehicle(id);
  const slug = own.data?.slug ?? card?.slug;
  const query = usePublicVehicle(slug);
  const online = useOnline();
  // DQ-160: restricted is the owner's account here, not the public page's content. The page renders and useGarageAccess
  // puts the restriction first in Übersicht, as on GAR-01; the public mapping to unavailable is for VEH-01 only.
  const state = routeStateOf(query, online, qaState === 'restricted' ? 'default' : qaState);
  const setMain = useSetMainVehicle();
  const { share, copy, sharing } = useVehicleShare(ROUTE);
  const [moreOpen, setMoreOpen] = useState(false);
  const tabParam = paramOf(params.tab);
  const tab = isProfileTab(tabParam) ? tabParam : 'overview';
  const client = useQueryClient();
  // The public page answers 404 for a vehicle deleted elsewhere, or after a delete whose answer was lost, while the owner's copy
  // may still be cached: that copy reads again, and its 404 shows the gone state instead of a connection error.
  const pageGone = isGone(query.error);
  const ownGone = isGone(own.error);
  const refetchOwn = own.refetch;
  useEffect(() => {
    if (pageGone) void refetchOwn();
  }, [pageGone, refetchOwn]);
  // The garage list still holds its card: it reads again, so the card goes too.
  useEffect(() => {
    if (ownGone) void client.invalidateQueries({ queryKey: myVehiclesKey });
  }, [client, ownGone]);

  if (access.status === 'guest') {
    return (
      <StateScreen routeId={ROUTE} onBack={back}>
        <SignInState routeId={ROUTE} returnTo={`/garage/${id}`} />
      </StateScreen>
    );
  }
  if (ownGone && qaState === 'default') {
    return (
      <StateScreen routeId={ROUTE} onBack={back}>
        <GoneState routeId={ROUTE} title={t('gone.vehicleTitle')} body={t('gone.vehicleBody')} />
      </StateScreen>
    );
  }
  const loading = state === 'loading' || (!slug && !own.error && qaState === 'default');
  if (loading) {
    // DQ-178, DQ-182: the title, the sub-line, the toolbar and the desktop thumbnails as the page will draw them, from what the
    // garage already knows.
    const known = own.data ?? card;
    return (
      <VehicleProfileSkeleton
        routeId={ROUTE}
        onBack={back}
        toolbarLabels={ownerToolLabels(t, known ? Boolean(known.qr) : true)}
        photoCount={known?.photo_count}
        known={known}
      />
    );
  }
  if (state !== 'ready' || !query.data) {
    return (
      <StateScreen routeId={ROUTE} onBack={back}>
        <RouteStateBody
          state={state === 'ready' || state === 'unavailable' ? 'error' : state}
          routeId={ROUTE}
          onRetry={() => {
            void own.refetch();
            void query.refetch();
          }}
          retrying={query.isFetching || own.isFetching}
        />
      </StateScreen>
    );
  }

  const vehicle = qaState === 'empty' ? withoutContent(query.data) : query.data;
  const changeTab = (next: ProfileTab) => router.setParams({ tab: next === 'overview' ? undefined : next });
  const moreActions: MoreAction[] = [
    ...(vehicle.status === 'published' && !vehicle.is_main
      ? [
          {
            key: 'main',
            icon: 'star' as const,
            label: t('owner.makeMain'),
            onPress: () =>
              setMain.mutate(vehicle.id, {
                onSuccess: () => toast(t('owner.mainSet'), { testID: `${ROUTE}.toast` }),
                onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
              }),
          },
        ]
      : []),
    ...(vehicle.qr ? [{ key: 'preview', icon: 'eye' as const, label: t('owner.viewPublic'), onPress: () => router.push(`/qr/${vehicle.id}/preview`) }] : []),
    { key: 'copyLink', icon: 'link', label: t('owner.copyLink'), onPress: () => void copy(vehicle) },
  ];

  return (
    <>
      <VehicleProfile
        vehicle={vehicle}
        routeId={ROUTE}
        onBack={back}
        tab={tab}
        onTabChange={changeTab}
        headerActions={[
          ...(vehicle.status === 'published' && vehicle.visibility !== 'private'
            ? [{ icon: 'share-network' as const, label: t('owner.share'), onPress: () => void share(vehicle), disabled: sharing, testID: `${ROUTE}.share` }]
            : []),
          { icon: 'dots-three', label: t('owner.more'), onPress: () => setMoreOpen(true), testID: `${ROUTE}.moreActions` },
        ]}
        ownerToolbar={<OwnerToolbar vehicle={vehicle} routeId={ROUTE} />}
        ownerContent={
          // Only when there is something to say: an empty block would still take the section gap above the description.
          access.restriction || vehicle.status !== 'published' || vehicle.visibility !== 'public' || (vehicle.completeness && !vehicle.completeness.is_complete) ? (
            <View style={styles.owner}>
              {access.restriction ? <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} /> : null}
              <VisibilityNote vehicle={vehicle} routeId={ROUTE} />
              <CompletenessHints vehicle={vehicle} routeId={ROUTE} />
            </View>
          ) : undefined
        }
      />
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={vehicle.full_title} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
    </>
  );
}

