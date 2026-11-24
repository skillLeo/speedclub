import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useCachedCard, useSetMainVehicle, useVehicle } from '@/api/queries/garage';
import { MAINTENANCE_FLAG } from '@/api/queries/maintenance';
import { NextHuChip, useNextHu } from '@/features/maintenance/components/NextHuChip';
import { myVehiclesKey } from '@/api/queries/profile';
import { usePublicVehicle, type PublicVehicle } from '@/api/queries/vehicles';
import { MoreSheet, type MoreAction } from '@/features/vehicle/components/MoreSheet';
import { StateScreen } from '@/features/vehicle/components/StateScreen';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { VehicleProfileSkeleton } from '@/features/vehicle/components/VehicleProfileSkeleton';
import { withoutContent } from '@/features/vehicle/model';
import { anchorFromParams } from '@/features/vehicle/sections';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useVehicleShare } from '@/features/vehicle/share';
import { canShareCard, SHARE_CARD_FLAG, shareCardHref } from '@/features/vehicle/shareCard';
import { RouteStateBody, routeStateOf } from '@/features/vehicle/states';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { toast } from '@/ui/toast';

import { GoneState, RestrictedNotice, SignInState, useGarageAccess } from '../components/frames';
import { CompletenessHints, OwnerEditSheet, ownerCapsuleOf, VisibilityNote } from '../components/OwnerToolbar';
import { isGone, saveErrorMessage } from '../errors';

const ROUTE = 'GAR-02';

const useStyles = createStyles((t) => ({
  owner: { gap: t.space[16] },
}));

/**
 * GAR-02's "Mehr" (the hero's dots): the owner's actions on this car. R7-4a: "Als Karte teilen" (VEH-07) is here too, as in VEH-01's
 * "Mehr", for a published, not private build while `sig.share_cards` is on; the garage's own sheet had left it out.
 */
export function garageMoreActions(
  vehicle: Pick<PublicVehicle, 'id' | 'status' | 'visibility' | 'is_main' | 'qr'>,
  deps: {
    t: TFunction<'garage'>;
    go: (path: string | ReturnType<typeof shareCardHref>) => void;
    maintenance: boolean;
    shareCards: boolean;
    makeMain: () => void;
    share: () => void;
    copy: () => void;
  },
): MoreAction[] {
  const { t, go } = deps;
  return [
    // M4.13 MNT-01: the owner's maintenance of this car (09 §8.8), behind the `maintenance` flag.
    ...(deps.maintenance ? [{ key: 'maintenance', icon: 'service-wrench' as const, label: t('maintenance.open'), onPress: () => go(`/garage/${vehicle.id}/maintenance`) }] : []),
    ...(vehicle.status === 'published' && !vehicle.is_main ? [{ key: 'main', icon: 'star' as const, label: t('owner.makeMain'), onPress: deps.makeMain }] : []),
    ...(vehicle.qr ? [{ key: 'preview', icon: 'eye' as const, label: t('owner.viewPublic'), onPress: () => go(`/stickers/${vehicle.id}/preview`) }] : []),
    ...(vehicle.status === 'published' && vehicle.visibility !== 'private' ? [{ key: 'share', icon: 'share-network' as const, label: t('owner.share'), onPress: deps.share }] : []),
    ...(canShareCard(vehicle, deps.shareCards) ? [{ key: 'shareCard', icon: 'image' as const, label: t('owner.shareCard'), onPress: () => go(shareCardHref(vehicle.id)) }] : []),
    { key: 'visibility', icon: vehicle.visibility === 'private' ? ('lock-simple' as const) : ('eye' as const), label: t('owner.visibility'), onPress: () => go(`/garage/${vehicle.id}/visibility`) },
    { key: 'copyLink', icon: 'link', label: t('owner.copyLink'), onPress: deps.copy },
  ];
}

/**
 * GAR-02 /garage/[id]: the public layout of VEH-01 with the owner toolbar and the completeness hints (04_SCREEN_REGISTER).
 * The owner reads the page through the public route, also for a private vehicle or a draft (handover).
 */
export function GarageVehicleScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const params = useLocalSearchParams<{ id: string; section?: string; tab?: string }>();
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
  const { share, copy } = useVehicleShare(ROUTE);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const maintenance = useFlag(MAINTENANCE_FLAG);
  const shareCardEnabled = useFlag(SHARE_CARD_FLAG);
  // DQ-M53R2-03: the HU chip only when there is an HU to name (the hook answers null with the flag off or without an HU/AU item).
  const nextHu = useNextHu(id);
  // M5.3 (ADR-505): one scroll; `?section=` (or a 2.0 link's `?tab=`) opens GAR-02 at that section.
  const initialSection = anchorFromParams(paramOf(params.section), paramOf(params.tab));
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
      <VehicleProfileSkeleton routeId={ROUTE} onBack={back} owner photoCount={known?.photo_count} known={known} />
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
  const visibilityNote = vehicle.status !== 'published' || vehicle.visibility !== 'public';
  const incomplete = Boolean(vehicle.completeness && !vehicle.completeness.is_complete);
  const ownerHasContent = Boolean(nextHu) || Boolean(access.restriction) || visibilityNote || incomplete;
  const capsule = ownerCapsuleOf(vehicle, ROUTE, {
    t,
    go: (path) => router.push(path as never),
    onEdit: () => setEditing(true),
    onShare: () => void share(vehicle),
    // R7-4a: the garage's way to the share card (VEH-07), as VEH-01's "Mehr" has it; [SIG] behind `sig.share_cards`.
    onShareCard: canShareCard(vehicle, shareCardEnabled) ? () => router.push(shareCardHref(vehicle.id)) : undefined,
  });
  const moreActions = garageMoreActions(vehicle, {
    t,
    go: (path) => router.push(path as never),
    maintenance,
    shareCards: shareCardEnabled,
    makeMain: () =>
      setMain.mutate(vehicle.id, {
        onSuccess: () => toast(t('owner.mainSet'), { testID: `${ROUTE}.toast` }),
        onError: (error) => toast(saveErrorMessage(t, error), { testID: `${ROUTE}.toast` }),
      }),
    share: () => void share(vehicle),
    copy: () => void copy(vehicle),
  });

  return (
    <>
      <VehicleProfile
        vehicle={vehicle}
        routeId={ROUTE}
        onBack={back}
        initialSection={initialSection}
        // DQ-1062 (DQ-942): at most two floating controls on the hero, back and "Mehr"; the owner's actions are the capsule.
        headerActions={[{ icon: 'dots-three', label: t('owner.more'), onPress: () => setMoreOpen(true), testID: `${ROUTE}.moreActions` }]}
        capsule={capsule}
        ownerContent={
          // Only when a part has something to say (DQ-M53R2-03): an element that renders nothing still takes the section's first block.
          ownerHasContent ? (
            <View style={styles.owner}>
              {nextHu ? <NextHuChip vehicleId={vehicle.id} routeId={ROUTE} /> : null}
              {access.restriction ? <RestrictedNotice message={access.restriction} testID={`${ROUTE}.restricted`} /> : null}
              {visibilityNote ? <VisibilityNote vehicle={vehicle} routeId={ROUTE} /> : null}
              {incomplete ? <CompletenessHints vehicle={vehicle} routeId={ROUTE} /> : null}
            </View>
          ) : undefined
        }
      />
      <OwnerEditSheet vehicle={vehicle} routeId={ROUTE} visible={editing} onClose={() => setEditing(false)} />
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={vehicle.full_title} actions={moreActions} testID={`${ROUTE}.moreSheet`} />
    </>
  );
}

