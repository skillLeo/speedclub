import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { publicIdOf, usePublicVehicle } from '@/api/queries/vehicles';
import { OwnerSpotLine, useOwnerSpotLine } from '@/features/dex/components/OwnerSpotLine';
import { NextHuChip, useNextHu } from '@/features/maintenance/components/NextHuChip';
import { useQaState } from '@/lib/qa';
import { createStyles } from '@/theme';

import { StateScreen } from '../components/StateScreen';
import { VehicleProfile } from '../components/VehicleProfile';
import { VehicleProfileSkeleton } from '../components/VehicleProfileSkeleton';
import { withoutContent } from '../model';
import { paramOf, useBack } from '../navigation';
import { anchorFromParams } from '../sections';
import { RouteStateBody, useRouteState } from '../states';

const ROUTE_ID = 'VEH-01';

const useStyles = createStyles((t) => ({
  // DQ-M53-05: the owner's HU chip and spot line as one meta line under the heading, wrapping when they do not fit.
  owner: { alignItems: 'center', columnGap: t.space[16], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[8] },
  // DQ-M53R2-01: each part at most the row's width and allowed to shrink, so at 200 % it wraps its own text instead of the page.
  ownerPart: { flexShrink: 1, maxWidth: '100%', minWidth: 0 },
}));

/**
 * VEH-01 /v/[slug], FS-3 as one scroll (10 §5, ADR-505). `?section=specs|mods|plans|history|gallery|similar` opens the page scrolled to
 * that section, and a 2.0 link's `?tab=` does the same; the section in view is never written back to the URL. An old slug is replaced
 * by the canonical one the API answered with.
 */
export function VehicleScreen() {
  const params = useLocalSearchParams<{ slug: string; section?: string; tab?: string; mod?: string }>();
  const slug = paramOf(params.slug) ?? '';
  const router = useRouter();
  const qaState = useQaState();
  const back = useBack('/');
  const query = usePublicVehicle(slug);
  const state = useRouteState(query);
  const canonical = query.data?.slug;
  const initialSection = anchorFromParams(paramOf(params.section), paramOf(params.tab));
  // DQ-1073: the owner sees "Nächste HU" under the owner row, as on GAR-02; private, so nobody else ever asks for it.
  const ownId = query.data?.is_owner ? query.data.id : '';
  const nextHu = useNextHu(ownId);
  // M5.9b: "Gespottet von 112 Leuten in 9 Städten" for the owner, to DEX-06; nothing while nobody has spotted the car.
  const spotLine = useOwnerSpotLine(ownId);
  const styles = useStyles();

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
      initialSection={initialSection}
      updatedAt={query.dataUpdatedAt}
      ownerContent={
        ownId && (nextHu || spotLine) ? (
          <View style={styles.owner}>
            {nextHu ? (
              <View style={styles.ownerPart}>
                <NextHuChip vehicleId={ownId} routeId={ROUTE_ID} />
              </View>
            ) : null}
            {spotLine ? (
              <View style={styles.ownerPart}>
                <OwnerSpotLine vehicleId={ownId} line={spotLine} routeId={ROUTE_ID} />
              </View>
            ) : null}
          </View>
        ) : undefined
      }
    />
  );
}
