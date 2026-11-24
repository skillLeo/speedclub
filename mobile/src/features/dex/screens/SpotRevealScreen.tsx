import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { spotNotCounted, useDexCard, useSpot, type DexCard, type SpotResponse } from '@/api/queries/dex';
import { usePublicVehicle } from '@/api/queries/vehicles';
import { qa, useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, size, space, ThemeScope, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { IconButton } from '@/ui/IconButton';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { haptics, useMotionPreference } from '@/ui/motion';
import { useScreenFocused } from '@/ui/SkeletonFocus';
import { useRevealOnce } from '@/features/qr/reveal';

import { FlipCard } from '../components/FlipCard';
import { FoilShine } from '../components/FoilShine';
import { RaritySheet } from '../components/RaritySheet';
import { RevealActions } from '../components/RevealActions';
import { SpotCardBack, SpotCardFace, SPOT_CARD_MAX_WIDTH } from '../components/SpotCardFace';
import { Tilt } from '../components/Tilt';
import { DEX_HOME_ROUTE } from '../navigation';
import { qaSpotResponse, SAMPLE_PHOTO, SAMPLE_SPOT_ID } from '../sample';
import { canShareSpotCard, shareSpotCard } from '../share';

const ROUTE = 'DEX-03';

const useStyles = createStyles((t) => ({
  // A brand moment: the dark stage in every theme (ThemeScope below), the card is the light in it.
  stage: { backgroundColor: t.color.media.ground, flex: 1 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: t.space[8] },
  scroll: { flex: 1 },
  content: { alignItems: 'center', flexGrow: 1, gap: t.space[24], justifyContent: 'center', paddingVertical: t.space[16] },
  column: { gap: t.space[24], maxWidth: SPOT_CARD_MAX_WIDTH, width: '100%' },
  status: { gap: t.space[8] },
  statusRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  newTag: {
    backgroundColor: t.color.accent.fill,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
  card: { position: 'relative' },
  skeleton: { gap: t.space[24], width: '100%' },
  skeletonCard: { backgroundColor: t.color.scrim.photoEnd, borderRadius: t.radius.xl, overflow: 'hidden' },
  skeletonBody: { gap: t.space[12], padding: t.layout.cardPadding },
}));

/** "NEU" or "Schon in deinem Dex", the young account's line, First Spotter, the set steps: above the card, short. */
function RevealStatus({ response }: { response: SpotResponse }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const { meta, data } = response;
  const notCounted = spotNotCounted(meta);
  const fresh = !notCounted && !meta.duplicate && meta.new_in_dex;
  return (
    <View style={styles.status} aria-live="polite" testID={`${ROUTE}.status`}>
      <View style={styles.statusRow}>
        {fresh ? (
          <View style={styles.newTag} testID={`${ROUTE}.new`}>
            <Text variant="labelBadge" color="text.onAccent" hyphenate={false}>
              {t('reveal.new')}
            </Text>
          </View>
        ) : null}
        <Text variant="calloutStrong" color="onPhoto.primary" testID={`${ROUTE}.statusLine`}>
          {notCounted
            ? t(meta.reason === 'sample_car' ? 'reveal.sampleCar' : 'reveal.notCounted')
            : meta.duplicate || !meta.new_in_dex
              ? t('reveal.duplicate')
              : t('reveal.newLine')}
        </Text>
      </View>
      {data.first_spotter && !notCounted ? (
        <Text variant="callout" color="onPhoto.secondary" testID={`${ROUTE}.firstSpotterLine`}>
          {t('reveal.firstSpotterLine')}
        </Text>
      ) : null}
      {notCounted
        ? null
        : meta.set_progress.slice(0, 2).map((set) => (
            <Text key={set.key} variant="callout" color="onPhoto.secondary" numeric testID={`${ROUTE}.set.${set.key}`}>
              {set.completed ? t('reveal.setDone', { name: set.name }) : t('reveal.setProgress', { name: set.name, progress: set.progress, target: set.target })}
            </Text>
          ))}
    </View>
  );
}

/** The loading state in the loaded geometry: the status line, the card (photo 4:5 and its body on the stage), the actions. */
function RevealSkeleton({ width }: { width: number }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  return (
    <Skeleton label={t('reveal.cardBack')} style={styles.skeleton} testID={`${ROUTE}.skeleton`}>
      <SkeletonText variant="calloutStrong" width="60%" />
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
      <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
    </Skeleton>
  );
}

/**
 * DQ-P5G-13, non-production only: the reveal of a real public car under `qaDex=live` (`/dex/spot/{slug}`), read as the signed-in
 * member: its page gives the id, its Dex card the face, so Folgen and Reaktion senden show as they do after a real scan. The "NEU"
 * line is the QA part; nothing is written.
 */
function liveResponse(entry: DexCard): SpotResponse {
  const { card } = entry;
  return {
    data: { ...card, spot_id: card.spot_id ?? 'live', spotted_at: card.spotted_at ?? new Date().toISOString() },
    meta: { new_in_dex: true, duplicate: false, first_spotter: card.first_spotter, counted: true, reason: null, set_progress: [] },
  };
}

/** The response this screen shows: `qaDex` on the sample or on a live car (non-production), else the spot. */
function useRevealData(spotId: string | null) {
  const liveSlug = qa.dex === 'live' && spotId !== null ? spotId : null;
  const sample = qa.dex !== undefined && qa.dex !== 'live' && spotId === SAMPLE_SPOT_ID ? qaSpotResponse(qa.dex) : null;
  const page = usePublicVehicle(liveSlug ?? undefined);
  const live = useDexCard(liveSlug ? (page.data?.id ?? null) : null);
  const spot = useSpot(sample || liveSlug ? null : spotId);
  if (liveSlug) {
    const query = page.isError ? page : live;
    return { sample, query, response: live.data ? liveResponse(live.data) : null };
  }
  return { sample, query: spot, response: sample ?? spot.data ?? null };
}

/**
 * DEX-03 Spot reveal ★ (10 §16.2, contract §8): the card turns over on spring.slow (reduced motion: a crossfade) with one success
 * haptic; the rarity label, "NEU" or "Schon in deinem Dex", the First Spotter foil; then Folgen · Reaktion senden · Zum Dex. A
 * subtle tilt on native with full motion. Opens from the scanner (the answer is in the cache) or from a link (the spot is loaded).
 */
export function SpotRevealScreen() {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const parent = useTheme();
  const insets = useSafeAreaInsets();
  const qaState = useQaState();
  const online = useOnline();
  const focused = useScreenFocused();
  const motion = useMotionPreference();
  const { gutter, width: windowWidth } = useBreakpoint();
  const params = useLocalSearchParams<{ spotId?: string | string[] }>();
  const spotId = typeof params.spotId === 'string' && params.spotId !== '' ? params.spotId : null;
  const { sample, query, response } = useRevealData(spotId);
  const [columnWidth, setColumnWidth] = useState(0);
  const [rarityOpen, setRarityOpen] = useState(false);
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const forced = qaState !== 'default' && qaState !== 'offline' && qaState !== 'restricted';
  const shown = forced ? null : response;
  const revealed = useRevealOnce(shown !== null);
  const celebrated = useRef(false);

  // One success haptic as the card turns (09 §4.8): once per visit.
  useEffect(() => {
    if (!revealed || celebrated.current) return;
    celebrated.current = true;
    haptics.success();
  }, [revealed]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  // A brand moment: dark in every theme (Schwarz stays Schwarz, Hell takes Carbon), as the brand layer of §2.
  const scope = parent.colorScheme === 'dark' ? parent.name : 'carbon';
  const cardWidth = Math.min(columnWidth > 0 ? columnWidth : windowWidth - 2 * gutter, SPOT_CARD_MAX_WIDTH);
  const onColumnLayout = (event: LayoutChangeEvent) => setColumnWidth(event.nativeEvent.layout.width);
  const share = async () => {
    if (!shown) return;
    const outcome = await shareSpotCard(cardRef, shown.data.vehicle.name);
    if (outcome === 'failed') toast(t('reveal.shareFailed'), { testID: `${ROUTE}.shareToast` });
  };

  let body: ReactNode;
  const notFound = qaState === 'empty' || (query.error instanceof ApiError && query.error.kind === 'not_found');
  if (qaState === 'loading') {
    body = <RevealSkeleton width={cardWidth} />;
  } else if (qaState === 'empty' || (notFound && !sample)) {
    // DQ-P5G-02: a forced empty state wins over the sample, so the matrix captures "Diesen Spot gibt es nicht mehr".
    body = (
      <EmptyState
        icon="qr-sticker"
        title={t('reveal.notFound.title')}
        body={t('reveal.notFound.body')}
        action={{ label: t('reveal.toDex'), onPress: () => router.replace(DEX_HOME_ROUTE), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    );
  } else if (qaState === 'error' || (!shown && (query.isError || query.fetchStatus === 'paused'))) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={t('reveal.errorTitle')}
        message={offline ? t('reveal.offline') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (!shown) {
    body = <RevealSkeleton width={cardWidth} />;
  } else {
    const { data } = shown;
    const readOnly = qaState === 'restricted';
    const card = (
      <FlipCard
        revealed={revealed}
        front={
          <View ref={cardRef} collapsable={false} style={styles.card}>
            <SpotCardFace
              card={data}
              photo={sample ? SAMPLE_PHOTO : undefined}
              width={cardWidth}
              firstSpotter={data.first_spotter}
              testID={`${ROUTE}.card`}
            />
            {data.first_spotter ? <FoilShine play={revealed} width={cardWidth} testID={`${ROUTE}.foil`} /> : null}
          </View>
        }
        back={<SpotCardBack width={cardWidth} testID={`${ROUTE}.cardBack`} />}
        testID={`${ROUTE}.flip`}
      />
    );
    body = (
      <>
        <RevealStatus response={shown} />
        <View accessible={false} aria-label={t('reveal.label', { name: data.vehicle.name })} testID={`${ROUTE}.cardFrame`}>
          {/* Spike §5: the tilt only on native with full motion, and only while this screen is on top (the sensor unregisters). */}
          <Tilt active={!motion.reduced && focused}>{card}</Tilt>
        </View>
        {readOnly ? (
          <Text variant="callout" color="onPhoto.secondary" testID={`${ROUTE}.restricted`}>
            {t('reveal.restricted')}
          </Text>
        ) : null}
        <RevealActions slug={sample ? null : data.vehicle.slug} vehicleId={data.vehicle.id} readOnly={readOnly} />
        {/* Part 2: what the rarity label means, the same sheet as on DEX-01. */}
        <Button label={t('home.rarityHelp')} variant="tertiary" size="m" flush="start" onPress={() => setRarityOpen(true)} testID={`${ROUTE}.rarityHelp`} />
      </>
    );
  }

  return (
    <ThemeScope name={scope}>
      {/* DQ-1045: on the web the stage names its theme, so the audit checks its colours against that theme's tokens. */}
      <View style={styles.stage} dataSet={{ themeScope: scope }} testID={`${ROUTE}.root`}>
        <View style={[styles.bar, { paddingTop: insets.top + space[8], paddingHorizontal: gutter }]}>
          <IconButton icon="x" label={t('reveal.close')} onPress={close} testID={`${ROUTE}.close`} />
          {canShareSpotCard && shown ? (
            <IconButton icon="share-network" label={t('reveal.share')} onPress={() => void share()} testID={`${ROUTE}.share`} />
          ) : null}
        </View>
        {online && qaState !== 'offline' ? null : <OfflineBanner label={t('reveal.offline')} testID={`${ROUTE}.offline`} />}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: insets.bottom + gutter }]}
          testID={`${ROUTE}.scroll`}
        >
          <View style={styles.column} onLayout={onColumnLayout}>
            {body}
          </View>
        </ScrollView>
        <RaritySheet visible={rarityOpen} onClose={() => setRarityOpen(false)} testID={`${ROUTE}.raritySheet`} />
      </View>
    </ThemeScope>
  );
}

