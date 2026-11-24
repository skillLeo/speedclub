import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useDexCard, type DexCard, type DexPage, type SpotCard } from '@/api/queries/dex';
import { RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Header } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { scannerAvailable } from '../availability';
import { RaritySheet } from '../components/RaritySheet';
import { SpotCardFace, SPOT_CARD_MAX_WIDTH } from '../components/SpotCardFace';
import { DEX_HOME_ROUTE, SCAN_ROUTE } from '../navigation';
import { QA_CARDS, qaDexActive, samplePhoto } from '../qaDex';

const ROUTE = 'DEX-04';
const EDGES: readonly Edge[] = ['left', 'right'];
/** The QA car that has not been spotted yet (`/dex/car/sample-preview?qaDex=sample`). */
export const QA_UNSPOTTED_ID = 'sample-preview';

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { alignItems: 'center', paddingTop: t.space[8] },
  column: { gap: t.space[20], maxWidth: SPOT_CARD_MAX_WIDTH, paddingBottom: t.space[32], width: '100%' },
  details: { gap: t.space[12] },
  actions: { gap: t.space[8] },
  skeletonCard: { borderRadius: t.radius.xl, overflow: 'hidden' },
  skeletonBody: { gap: t.space[12], padding: t.layout.cardPadding },
}));

/** The card from DEX-01's pages when it is there, so DEX-04 opens without waiting. */
export function cachedDexCard(client: QueryClient, vehicleId: string): SpotCard | undefined {
  for (const [, data] of client.getQueriesData<{ pages: DexPage[] }>({ queryKey: ['dex', 'mine'] })) {
    const card = data?.pages.flatMap((page) => page.data).find((entry) => entry.vehicle.id === vehicleId);
    if (card) return card;
  }
  return undefined;
}

/** DEX-04 under `qaDex`: a QA card, or the R34 as a car not spotted yet. */
export function qaDexCard(vehicleId: string): DexCard | null {
  const card = QA_CARDS.find((entry) => entry.vehicle.id === vehicleId);
  if (card) return { spotted: true, card };
  if (vehicleId !== QA_UNSPOTTED_ID) return null;
  const r34 = QA_CARDS[0] as SpotCard;
  return { spotted: false, card: { ...r34, spot_id: null, spotted_at: null, spotted: false, first_spotter: false, cities_count_label: null } };
}

function CardSkeleton({ width }: { width: number }) {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.column}>
        <View style={[styles.skeletonCard, { width }]}>
          <SkeletonBlock width="100%" aspectRatio={4 / 5} corner="none" />
          <View style={styles.skeletonBody}>
            {/* The Dex number on the stage above the name (DQ-P5G-01). */}
            <SkeletonText variant="heroNumeralS" width="40%" />
            <SkeletonText variant="displayTitle" width="80%" />
            <SkeletonText variant="callout" width="45%" />
            <SkeletonText variant="callout" width="55%" />
          </View>
        </View>
        <SkeletonText variant="caption" width="50%" />
        <SkeletonBlock width="100%" height={size.button.m} corner="sm" />
      </View>
    </Skeleton>
  );
}

/**
 * DEX-04 Karte (contract §3/§8): the car as its card — photo, Dex number, rarity (Ghost frame), top 3 mods, owner, "gespottet in 9
 * Städten" (day spots only, the server's line) — when it was spotted, and the way to the car's page. A public car the member has
 * not spotted yet shows as a preview without spot data: "Noch nicht gespottet" and the scanner.
 */
export function DexCardScreen() {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const client = useQueryClient();
  const format = useFormat();
  const online = useOnline();
  const qaState = useQaState();
  const inset = useTabBarInset();
  const back = useBack(DEX_HOME_ROUTE);
  const requireAuth = useRequireAuth();
  const restriction = useBrowseRestriction();
  const status = useSessionStore((state) => state.status);
  const { gutter, width: windowWidth } = useBreakpoint();
  const [rarityOpen, setRarityOpen] = useState(false);
  const params = useLocalSearchParams<{ vehicleId?: string | string[] }>();
  const vehicleId = paramOf(params.vehicleId) ?? null;
  const sample = qaDexActive() && vehicleId ? qaDexCard(vehicleId) : null;
  const placeholder = useMemo(() => (vehicleId ? cachedDexCard(client, vehicleId) : undefined), [client, vehicleId]);
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const query = useDexCard(sample || !live ? null : vehicleId, placeholder);
  const shown = live ? (sample ?? query.data ?? null) : null;
  const cardWidth = Math.min(windowWidth - 2 * gutter, SPOT_CARD_MAX_WIDTH);

  let body: ReactNode;
  const notFound = qaState === 'empty' || (!sample && query.error instanceof ApiError && query.error.kind === 'not_found');
  if (status === 'guest') {
    body = (
      <EmptyState
        icon="qr-sticker"
        title={t('home.guest.title')}
        body={t('home.guest.body')}
        action={{ label: t('home.guest.signIn'), onPress: () => requireAuth(undefined, { returnTo: vehicleId ? `/dex/car/${vehicleId}` : DEX_HOME_ROUTE }) }}
        testID={`${ROUTE}.guest`}
      />
    );
  } else if (notFound) {
    body = (
      <EmptyState
        icon="qr-sticker"
        title={t('card.notFound.title')}
        body={t('card.notFound.body')}
        action={{ label: t('card.notFound.action'), onPress: () => router.navigate(DEX_HOME_ROUTE), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'loading' || status === 'loading' || (!shown && query.isPending && query.fetchStatus !== 'paused' && qaState !== 'error')) {
    body = <CardSkeleton width={cardWidth} />;
  } else if (qaState === 'error' || !shown) {
    const offline = qaState !== 'error' && (!online || query.fetchStatus === 'paused');
    body = (
      <ErrorState
        title={offline ? t('card.offline') : t('card.errorTitle')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.${offline ? 'offline' : 'error'}`}
      />
    );
  } else {
    const { spotted, card } = shown;
    const photo = samplePhoto(card.vehicle.id) ?? (sample && !spotted ? samplePhoto('sample-r34') : undefined);
    const spottedAt = spotted && card.spotted_at ? new Date(card.spotted_at) : null;
    const canScan = scannerAvailable();
    body = (
      <View style={styles.column}>
        {restriction ? <RestrictionNotice message={t('home.restricted')} testID={`${ROUTE}.restricted`} /> : null}
        <SpotCardFace
          card={card}
          width={cardWidth}
          firstSpotter={card.first_spotter}
          sampleLabel={spotted ? undefined : t('card.notSpotted')}
          showRarity={spotted}
          photo={photo}
          testID={`${ROUTE}.card`}
        />
        <View style={styles.details}>
          {spottedAt && !Number.isNaN(spottedAt.getTime()) ? (
            <Text variant="caption" color="text.secondary" numeric testID={`${ROUTE}.spottedOn`}>
              {t('card.spottedOn', { date: format.longDate(spottedAt) })}
            </Text>
          ) : null}
          {spotted ? null : (
            <Text variant="callout" color="text.secondary" testID={`${ROUTE}.notSpotted`}>
              {canScan ? t('card.notSpottedBody') : `${t('card.notSpottedBody')} ${t('card.notSpottedWeb')}`}
            </Text>
          )}
        </View>
        <View style={styles.actions}>
          {spotted || !canScan ? null : <Button label={t('card.scan')} size="l" fullWidth onPress={() => router.push(SCAN_ROUTE)} testID={`${ROUTE}.scan`} />}
          {card.vehicle.slug && !card.vehicle.slug.startsWith('sample') ? (
            <Button
              label={t('card.toVehicle')}
              variant="secondary"
              size="l"
              fullWidth
              role="link"
              onPress={() => router.push(`/v/${card.vehicle.slug}`)}
              testID={`${ROUTE}.toVehicle`}
            />
          ) : null}
          <Button label={t('home.rarityHelp')} variant="tertiary" size="m" flush="start" onPress={() => setRarityOpen(true)} testID={`${ROUTE}.rarityHelp`} />
        </View>
      </View>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="compact" title={t('card.title')} onBack={back} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('card.offline')} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: inset }]} testID={`${ROUTE}.scroll`}>
        {body}
      </ScrollView>
      <RaritySheet visible={rarityOpen} onClose={() => setRarityOpen(false)} testID={`${ROUTE}.raritySheet`} />
    </Screen>
  );
}
