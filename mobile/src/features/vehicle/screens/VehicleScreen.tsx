import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { publicIdOf, usePublicVehicle } from '@/api/queries/vehicles';
import { NextHuChip, useNextHu } from '@/features/maintenance/components/NextHuChip';
import { useQaState } from '@/lib/qa';

import { StateScreen } from '../components/StateScreen';
import { VehicleProfile } from '../components/VehicleProfile';
import { VehicleProfileSkeleton } from '../components/VehicleProfileSkeleton';
import { isProfileTab, withoutContent, type ProfileTab } from '../model';
import { paramOf, useBack } from '../navigation';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-01';

/**
 * VEH-01 /v/[slug], FS-3. The content tab lives in `?tab=` (Übersicht is the default and stays out of the URL), so a link
 * can open Verlauf directly. An old slug is replaced by the canonical one the API answered with.
 */
export function VehicleScreen() {
  const params = useLocalSearchParams<{ slug: string; tab?: string; mod?: string }>();
  const slug = paramOf(params.slug) ?? '';
  const router = useRouter();
  const qaState = useQaState();
  const back = useBack('/');
  const query = usePublicVehicle(slug);
  const state = useRouteState(query);
  const canonical = query.data?.slug;
  const tabParam = paramOf(params.tab);
  const tab = isProfileTab(tabParam) ? tabParam : undefined;
  // DQ-1073: the owner sees "Nächste HU" under the owner row, as on GAR-02; private, so nobody else ever asks for it.
  const ownId = query.data?.is_owner ? query.data.id : '';
  const nextHu = useNextHu(ownId);

  useEffect(() => {
    if (canonical && canonical !== slug && publicIdOf(canonical) === publicIdOf(slug)) router.setParams({ slug: canonical });
  }, [canonical, router, slug]);

  // M4.14: a business_tag notification or push opens /v/{slug}?mod={id} (NotificationTexts::path): VEH-02 of that mod, once, where
  // the owner confirms or declines "Eingebaut von".
  const modParam = paramOf(params.mod);
  const openedMod = useRef<string | null>(null);
  useEffect(() => {
    if (!modParam || !canonical || openedMod.current === modParam || !/^[0-9a-z]{26}$/i.test(modParam)) return;
    openedMod.current = modParam;
    router.setParams({ mod: undefined });
    router.push({ pathname: '/v/[slug]/mods/[modId]', params: { slug: canonical, modId: modParam } });
  }, [canonical, modParam, router]);

  const changeTab = (next: ProfileTab) => router.setParams({ tab: next === 'overview' ? undefined : next });

  if (state === 'loading') return <VehicleProfileSkeleton routeId={ROUTE_ID} onBack={back} />;
  if (state !== 'ready' || !query.data) {
    return (
      <StateScreen routeId={ROUTE_ID} onBack={back}>
        <RouteStateBody
          state={state === 'ready' ? 'error' : state}
          routeId={ROUTE_ID}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </StateScreen>
    );
  }

  const vehicle = qaState === 'empty' ? withoutContent(query.data) : query.data;
  return (
    <VehicleProfile
      vehicle={vehicle}
      routeId={ROUTE_ID}
      onBack={back}
      tab={tab ?? 'overview'}
      onTabChange={changeTab}
      updatedAt={query.dataUpdatedAt}
      ownerContent={nextHu && ownId ? <NextHuChip vehicleId={ownId} routeId={ROUTE_ID} /> : undefined}
    />
  );
}
