import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useCachedPublicVehicle, usePublicMod, usePublicVehicle } from '@/api/queries/vehicles';
import { useReport } from '@/features/safety/useReport';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { EmptyState, IconButton, OfflineBanner, Screen, Spinner } from '@/ui';

import { PhotoViewer } from '../components/PhotoViewer';
import { StateScreen } from '../components/StateScreen';
import { isMediaCategory, photosIn, visiblePhotos } from '../media';
import { paramOf } from '../navigation';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-04';
const EDGES: readonly Edge[] = ['top', 'left', 'right', 'bottom'];

const useStyles = createStyles((t) => ({
  // §7: the viewer is always pure black, in every theme.
  black: { backgroundColor: t.color.media.ground },
  centre: { alignItems: 'center', flex: 1, justifyContent: 'center' },
}));

/**
 * VEH-04 (modals)/viewer?slug=&index=&category=&mod=: the viewer for a direct link. Inside the app the vehicle screens open
 * the same viewer over themselves, so the photo does not travel through a modal transition first.
 */
export function ViewerScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; index?: string; category?: string; mod?: string }>();
  const slug = paramOf(params.slug) ?? '';
  const modId = paramOf(params.mod);
  const category = paramOf(params.category);
  const requested = Number.parseInt(paramOf(params.index) ?? '0', 10);
  const vehicle = usePublicVehicle(modId ? undefined : slug);
  const mod = usePublicMod(modId ? slug : undefined, modId);
  const query = modId ? mod : vehicle;
  const state = useRouteState(query);
  // §8: offline with a copy is the cached photos under the offline banner; the viewer covers the shell's, so it brings its own.
  const online = useOnline();

  const photos = useMemo(() => {
    if (mod.data) return visiblePhotos(mod.data.photos);
    if (vehicle.data) return photosIn(vehicle.data.photos, isMediaCategory(category) ? category : 'all');
    return [];
  }, [category, mod.data, vehicle.data]);
  const fallbackAlt = mod.data?.title ?? vehicle.data?.full_title ?? '';
  const index = Number.isFinite(requested) ? Math.min(Math.max(0, requested), Math.max(0, photos.length - 1)) : 0;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace(slug ? `/v/${slug}` : '/');
  };

  // M2.6: "Melden" for the photo on screen, never on the member's own build, and only once the build says whose it is: a mod's
  // photos ask for the build as well (it is usually cached already). A block from the flow closes the viewer.
  const safety = useTranslation('safety').t;
  const cached = useCachedPublicVehicle(slug);
  const ownerQuery = usePublicVehicle(modId && !cached ? slug : undefined);
  const build = vehicle.data ?? cached ?? ownerQuery.data;
  const owner = build?.owner?.username;
  const ownershipKnown = build !== undefined;
  const own = Boolean(build?.is_owner || build?.owner?.is_self);
  const report = useReport(null, { routeId: ROUTE_ID, onBlocked: close });
  const reportPhoto =
    report.available && ownershipKnown && !own
      ? (photo: (typeof photos)[number]) => (
          <IconButton
            icon="flag"
            label={report.label}
            variant="onPhoto"
            onPress={() => report.openFor({ type: 'photo', id: photo.id, label: safety('targetLabels.photo', { label: build?.full_title ?? fallbackAlt }), ...(owner ? { owner } : {}) })}
            testID={`${ROUTE_ID}.report`}
          />
        )
      : undefined;

  if (state !== 'ready' && state !== 'loading') {
    return (
      <StateScreen routeId={ROUTE_ID} onBack={close} backIcon="close">
        <RouteStateBody state={state} routeId={ROUTE_ID} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </StateScreen>
    );
  }

  if (state === 'ready' && photos.length === 0) {
    return (
      <StateScreen routeId={ROUTE_ID} onBack={close} backIcon="close">
        <EmptyState icon="image" title={t('gallery.emptyTitle')} body={t('gallery.emptyBody')} testID={`${ROUTE_ID}.empty`} />
      </StateScreen>
    );
  }

  return (
    <Screen edges={EDGES} style={styles.black} testID={`${ROUTE_ID}.root`}>
      {state === 'loading' ? (
        <View style={styles.centre}>
          <Spinner color="onPhoto.primary" label={t('viewer.loading')} testID={`${ROUTE_ID}.loading`} />
        </View>
      ) : (
        <PhotoViewer
          photos={photos}
          fallbackAlt={fallbackAlt}
          index={index}
          onClose={close}
          actions={reportPhoto}
          notice={online ? null : <OfflineBanner label={t('viewer.offline')} testID={`${ROUTE_ID}.offline`} />}
        />
      )}
      {report.element}
    </Screen>
  );
}
