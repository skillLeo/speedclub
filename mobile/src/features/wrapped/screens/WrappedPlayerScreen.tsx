import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, useExclusiveGestures, useLongPressGesture, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { ApiError } from '@/api/client';
import { parseSeasonKey, useMarkWrappedShared, useMyWrapped, useWrapped, type WrappedPayload, type WrappedShareCard } from '@/api/queries/wrapped';
import { useScreenReader } from '@/features/messages/useScreenReader';
import { useAccountRestrictionKind } from '@/features/safety/components/states';
import { isWeb } from '@/lib/platform';
import { qa, useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { openAuthPrompt, useSessionStore } from '@/state/session';
import { createStyles, size, space, ThemeScope, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { IconButton } from '@/ui/IconButton';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Skeleton, SkeletonBlock } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { shouldDismiss } from '@/ui/imageViewerMath';
import { useMotionPreference } from '@/ui/motion';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { WrappedCardView } from '../components/cards';
import { CARD_FONT_SCALE_CAP } from '../components/cards/parts';
import { ShareCard } from '../components/cards/ShareCard';
import { StoryProgress } from '../components/StoryProgress';
import {
  initialCardIndex,
  ROUTE,
  seasonName,
  STORY_CLOSE_ACTIVE_Y,
  STORY_CLOSE_FAIL_X,
  STORY_HOLD_MS,
  STORY_PREVIOUS_ZONE,
  STORY_TAP_MAX_MS,
  storyFrame,
  storyKeyAction,
} from '../model';
import { QA_QR_SVG, qaWrappedPayload } from '../qaWrapped';
import { exportWrappedCard, wrappedExportMode } from '../share';
import { usePlayer } from '../usePlayer';

const useStyles = createStyles((t) => ({
  // A brand moment: the dark stage in every theme (as ONB/Welcome and DEX-03), the cards are the light in it.
  stage: { backgroundColor: t.color.media.ground, flex: 1 },
  // From the tablet on, bars, card and controls keep to one column in the middle of the stage.
  column: { alignSelf: 'center', flex: 1, maxWidth: t.layout.feedColumn, width: '100%' },
  top: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row' },
  progress: { flex: 1 },
  middle: { alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'center', minHeight: 0 },
  room: { alignItems: 'center', alignSelf: 'stretch', flex: 1, justifyContent: 'center', minWidth: 0 },
  side: { alignItems: 'center', justifyContent: 'center', width: t.size.touchMin + 2 * t.space[16] },
  frame: { borderRadius: t.radius.md, overflow: 'hidden' },
  bottom: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', justifyContent: 'space-between', paddingTop: t.space[8] },
  controls: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row' },
  centred: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  stateColumn: { gap: t.space[24], maxWidth: t.layout.feedColumn, width: '100%' },
  notice: { paddingBottom: t.space[8] },
  preview: { alignSelf: 'center' },
  previewCard: { borderRadius: t.radius.xl, left: 0, overflow: 'hidden', position: 'absolute', top: 0, transformOrigin: 'top left' },
}));

/** The share card's QR: the server's drawing of the car's public page (`share.qr_svg`, ADR-514), the sample's own in QA. */
function useShareQr(payload: WrappedPayload | null): string | null {
  const share = payload?.cards.find((entry) => entry.card.kind === 'share')?.card as WrappedShareCard | undefined;
  if (payload?.is_sample === true) return QA_QR_SVG;
  // ADR-514: the server draws the car's public page as the QR (never the sticker code, so a shared card cannot spot the car).
  return share?.qr_svg ?? null;
}

/** Closes the story: back where it was opened from, or Start for a link opened cold. */
function useClose() {
  const router = useRouter();
  return useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
}

type PlayerProps = { payload: WrappedPayload; shareAllowed: boolean; restricted: string | null; offline: boolean };

/**
 * The story itself (spike §8): tap right/left = next/previous, hold = pause, swipe down = close (RNGH 3 hooks, exclusive), the same
 * with ← → Space Esc on the web and with the visible buttons for everyone (screen readers included). Auto-advance every 6 s, never
 * while a screen reader runs. A new card crossfades in (reduced motion: the crossfade alone, no slide).
 */
function StoryPlayer({ payload, shareAllowed, restricted, offline }: PlayerProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ card?: string | string[] }>();
  const { gutter, kind } = useBreakpoint();
  const motion = useMotionPreference();
  // react-native-web always answers true (it cannot tell); the web keeps auto-advance with its visible pause button and Space.
  const screenReader = useScreenReader() && !isWeb;
  const focused = useScreenFocused();
  const close = useClose();
  const markShared = useMarkWrappedShared(payload.season_key);
  const qrSvg = useShareQr(payload);
  const [exporting, setExporting] = useState(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const total = payload.cards.length;
  // A QA link to one card holds it, so the visual matrix captures it before the clock moves on.
  const pinned = qa.wrapped !== undefined && params.card !== undefined;
  const player = usePlayer({
    total,
    initialIndex: initialCardIndex(params.card, total),
    startPaused: pinned,
    screenReader,
    blocked: exporting || !focused,
  });
  const placed = payload.cards[player.index] ?? payload.cards[0];
  const desktop = kind !== 'phone';
  const frame = storyFrame(room.width, room.height);
  // DQ-P5G-04: past the cards' cap the share control is the icon alone (its words stay its accessible name), so the controls keep
  // one 44 row and the card keeps its room.
  const compactControls = useTheme().fontScale > CARD_FONT_SCALE_CAP;
  const shareLabel = wrappedExportMode === 'server' ? t('wrapped.player.download') : t('wrapped.player.share');
  const shareIcon = wrappedExportMode === 'server' ? 'download-simple' : 'share-network';

  // The card change: a crossfade (effect.default) in every mode, a short slide in the direction of travel with full motion.
  const fade = useSharedValue(1);
  const slide = useSharedValue(0);
  const drag = useSharedValue(0);
  const previousIndex = useRef(player.index);
  useEffect(() => {
    if (previousIndex.current === player.index) return;
    const forward = player.index > previousIndex.current;
    previousIndex.current = player.index;
    fade.set(0);
    fade.set(motion.effectTo(1, 'default'));
    if (motion.reduced) {
      slide.set(0);
    } else {
      slide.set(forward ? space[16] : -space[16]);
      slide.set(motion.springTo(0, 'calm'));
    }
  }, [fade, motion, player.index, slide]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateX: slide.get() }, { translateY: drag.get() }] }));

  const onTapAt = useCallback(
    (x: number) => {
      if (x < frame.width * STORY_PREVIOUS_ZONE) player.previous();
      else player.next();
    },
    [frame.width, player],
  );
  const setHeld = player.setHeld;

  // Swipe down follows the finger and closes past the viewer's threshold (distance or velocity), else springs back.
  const pan = usePanGesture({
    activeOffsetY: STORY_CLOSE_ACTIVE_Y,
    failOffsetX: STORY_CLOSE_FAIL_X,
    testID: `${ROUTE}.pan`,
    onUpdate: (event) => {
      'worklet';
      drag.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      'worklet';
      if (event.translationY > 0 && shouldDismiss(event.translationY, event.velocityY)) {
        scheduleOnRN(close);
      } else {
        drag.set(motion.springTo(0, 'default'));
      }
    },
  });
  const hold = useLongPressGesture({
    minDuration: STORY_HOLD_MS,
    testID: `${ROUTE}.hold`,
    onActivate: () => {
      'worklet';
      scheduleOnRN(setHeld, true);
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(setHeld, false);
    },
  });
  const tap = useTapGesture({
    maxDuration: STORY_TAP_MAX_MS,
    testID: `${ROUTE}.tap`,
    onActivate: (event) => {
      'worklet';
      scheduleOnRN(onTapAt, event.x);
    },
  });
  const gesture = useExclusiveGestures(pan, hold, tap);

  // The web: ← → go, Space pauses, Escape closes. A focused button keeps its own Space and Enter.
  useEffect(() => {
    if (!isWeb || !focused) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const action = storyKeyAction(event.key, event.target as HTMLElement | null);
      if (!action) return;
      event.preventDefault();
      if (action === 'next') player.next();
      else if (action === 'previous') player.previous();
      else if (action === 'pause') player.togglePause();
      else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, focused, player]);

  const share = async () => {
    setExporting(true);
    try {
      const outcome = await exportWrappedCard({ card: cardRef, seasonKey: payload.season_key, n: placed?.n ?? 1, title: t('wrapped.player.shareTitle') });
      if (outcome === 'failed') {
        toast(wrappedExportMode === 'server' ? t('wrapped.player.downloadFailed') : t('wrapped.player.shareFailed'), { testID: `${ROUTE}.toast` });
        return;
      }
      if (outcome === 'saved') toast(t('wrapped.player.saved'), { testID: `${ROUTE}.toast` });
      markShared.mutate();
    } finally {
      setExporting(false);
    }
  };

  const onRoom = (event: LayoutChangeEvent) => setRoom({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
  const pausedNow = player.paused || player.held;
  const atStart = player.index === 0;
  const atEnd = player.index >= total - 1;
  const previousButton = <IconButton icon="caret-left" label={t('wrapped.player.previous')} variant="onPhoto" disabled={atStart} onPress={player.previous} testID={`${ROUTE}.previous`} />;
  const nextButton = <IconButton icon="caret-right" label={t('wrapped.player.next')} variant="onPhoto" disabled={atEnd} onPress={player.next} testID={`${ROUTE}.next`} />;
  const pauseButton = screenReader ? null : (
    <IconButton
      icon={pausedNow ? 'play' : 'pause'}
      label={pausedNow ? t('wrapped.player.play') : t('wrapped.player.pause')}
      variant="onPhoto"
      selected={pausedNow}
      onPress={player.togglePause}
      testID={`${ROUTE}.pause`}
    />
  );

  return (
    <View style={[styles.stage, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[8], paddingHorizontal: gutter }]}>
      <View style={desktop ? styles.column : styles.stage}>
      <View style={styles.top}>
        <View style={styles.progress}>
          <StoryProgress total={total} index={player.index} running={player.running} testID={`${ROUTE}.progress`} />
        </View>
        <IconButton icon="x" label={t('wrapped.player.close')} variant="onPhoto" onPress={close} testID={`${ROUTE}.close`} />
      </View>
      {offline ? <OfflineBanner label={t('wrapped.player.offline')} testID={`${ROUTE}.offline`} /> : null}
      <View style={styles.middle}>
        {desktop ? <View style={styles.side}>{previousButton}</View> : null}
        <View style={styles.room} onLayout={onRoom} testID={`${ROUTE}.room`}>
          {frame.width > 0 && placed ? (
            <GestureDetector gesture={gesture}>
              <Animated.View style={[styles.frame, cardStyle]} aria-label={t('wrapped.player.label', { season: seasonName(t, payload.season_key) })} testID={`${ROUTE}.stage`}>
                <WrappedCardView
                  key={placed.n}
                  ref={cardRef}
                  placed={placed}
                  payload={payload}
                  qrSvg={qrSvg}
                  width={frame.width}
                  height={frame.height}
                  testID={`${ROUTE}.card`}
                />
              </Animated.View>
            </GestureDetector>
          ) : null}
        </View>
        {desktop ? <View style={styles.side}>{nextButton}</View> : null}
      </View>
      {restricted ? (
        <Text variant="callout" color="onPhoto.secondary" style={styles.notice} testID={`${ROUTE}.restricted`}>
          {restricted}
        </Text>
      ) : null}
      <View style={styles.bottom}>
        <View style={styles.controls}>
          {desktop ? null : previousButton}
          {pauseButton}
          {desktop ? null : nextButton}
        </View>
        {shareAllowed ? (
          compactControls ? (
            <IconButton icon={shareIcon} label={shareLabel} variant="onPhoto" loading={exporting} onPress={() => void share()} testID={`${ROUTE}.share`} />
          ) : (
            <Button label={shareLabel} icon={shareIcon} variant="onPhoto" size="m" loading={exporting} onPress={() => void share()} testID={`${ROUTE}.share`} />
          )
        ) : null}
      </View>
      </View>
    </View>
  );
}

/** The loading state in the player's geometry: the bars and close, the 9:16 frame, the controls and the share button. */
function PlayerSkeleton() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { gutter } = useBreakpoint();
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const frame = storyFrame(room.width, room.height);
  const compactControls = useTheme().fontScale > CARD_FONT_SCALE_CAP;
  return (
    <Skeleton label={t('wrapped.player.loading')} style={[styles.stage, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[8], paddingHorizontal: gutter }]} testID={`${ROUTE}.skeleton`}>
      <View style={styles.top}>
        <View style={styles.progress}>
          <SkeletonBlock width="100%" height={size.progress.height} corner="full" />
        </View>
        <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
      </View>
      <View style={styles.middle}>
        <View style={styles.room} onLayout={(event) => setRoom({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
          {frame.width > 0 ? <SkeletonBlock width={frame.width} height={frame.height} corner="md" /> : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <SkeletonBlock width={size.touchMin * 3} height={size.touchMin} corner="full" />
        {compactControls ? (
          <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
        ) : (
          <SkeletonBlock width={size.touchMin * 3} height={size.button.m} corner="sm" />
        )}
      </View>
    </Skeleton>
  );
}

/** A state on the stage: the close button over a centred column (not released, none, error, guest). */
function StateStage({ children, offline }: { children: ReactNode; offline: boolean }) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { gutter } = useBreakpoint();
  const close = useClose();
  return (
    <View style={[styles.stage, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + gutter, paddingHorizontal: gutter }]}>
      <View style={styles.top}>
        <View style={styles.progress} />
        <IconButton icon="x" label={t('wrapped.player.close')} variant="onPhoto" onPress={close} testID={`${ROUTE}.close`} />
      </View>
      {offline ? <OfflineBanner label={t('wrapped.player.offline')} testID={`${ROUTE}.offline`} /> : null}
      <View style={styles.centred}>
        <View style={styles.stateColumn}>{children}</View>
      </View>
    </View>
  );
}

/** The preview card is drawn at a phone card's width and shown at half that size, so its type keeps the card's proportions. */
const PREVIEW_CARD_WIDTH = size.railCard * 2;
const PREVIEW_SCALE = 0.5;

/**
 * The empty state's real preview: the sample share card, small and badged "Beispiel" (SKILL "Never empty"). DQ-P5G-62: it is the
 * real card root (`WRP-01.card.share`, the 9:16 CardFrame) at its design size inside a scale wrapper, as the Journey preview
 * (ADR-518 b), so the story-card marker sits on a root the audit accepts (ADR-518 c).
 */
function SamplePreview() {
  const styles = useStyles();
  const sample = qaWrappedPayload();
  const placed = sample.cards[sample.cards.length - 1];
  if (!placed || placed.card.kind !== 'share') return null;
  const height = Math.floor((PREVIEW_CARD_WIDTH * 16) / 9);
  return (
    <View style={[styles.preview, { width: PREVIEW_CARD_WIDTH * PREVIEW_SCALE, height: height * PREVIEW_SCALE }]} aria-hidden testID={`${ROUTE}.preview`}>
      <View style={[styles.previewCard, { transform: [{ scale: PREVIEW_SCALE }] }]}>
        <ShareCard card={placed.card} payload={sample} qrSvg={QA_QR_SVG} width={PREVIEW_CARD_WIDTH} height={height} testID={`${ROUTE}.card.share`} />
      </View>
    </View>
  );
}

/**
 * WRP-01 Season Wrapped ★ (10 §16.5, contract m5.9e §6): the member's season as a full-screen story of up to nine cards on the dark
 * stage (in every theme, as ONB/Welcome), the last one the share card with the QR. Every card can be shared as a 1080 × 1920 image:
 * drawn on the phone, the server's on the web. States: loading (the player's geometry), not released yet, no Wrapped, error + retry,
 * offline (the cached season with a banner), restricted (watch, no sharing), guest (sign in).
 */
export function WrappedPlayerScreen() {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const parent = useTheme();
  const format = useFormat();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const status = useSessionStore((state) => state.status);
  const restriction = useAccountRestrictionKind();
  const params = useLocalSearchParams<{ season?: string | string[] }>();
  const rawSeason = typeof params.season === 'string' ? params.season : null;
  const seasonKey = rawSeason && parseSeasonKey(rawSeason) ? rawSeason : null;
  const query = useWrapped(seasonKey);
  const list = useMyWrapped(query.error instanceof ApiError && query.error.kind === 'forbidden');
  // A brand moment: dark in every theme (Schwarz stays Schwarz, Hell takes Carbon).
  const scope = parent.colorScheme === 'dark' ? parent.name : 'carbon';
  const offline = !online || qaState === 'offline';
  const returnTo = rawSeason ? `/wrapped/${encodeURIComponent(rawSeason)}` : '/';

  let content: ReactNode;
  const error = query.error instanceof ApiError ? query.error : null;
  const payload = qaState === 'loading' || qaState === 'error' || qaState === 'empty' ? null : (query.data ?? null);
  if (status === 'guest') {
    content = (
      <StateStage offline={offline}>
        {/* DQ-P5G-30: the badged sample share card on the stage, then the left-aligned line and one action (as "noch nicht da"). */}
        <EmptyState
          preview={<SamplePreview />}
          title={t('wrapped.guest.title')}
          body={t('wrapped.guest.body')}
          action={{ label: t('wrapped.guest.action'), onPress: () => openAuthPrompt({ returnTo }) }}
          testID={`${ROUTE}.guest`}
        />
      </StateStage>
    );
  } else if (qaState === 'loading' || status === 'loading' || (!payload && query.isPending && query.fetchStatus === 'fetching')) {
    content = <PlayerSkeleton />;
  } else if (!payload && error?.kind === 'forbidden') {
    const countdown = list.data?.countdown?.season_key === seasonKey ? list.data.countdown : null;
    const release = countdown ? new Date(countdown.release_at) : null;
    content = (
      <StateStage offline={offline}>
        <EmptyState
          preview={<SamplePreview />}
          title={t('wrapped.notReleased.title', { season: seasonKey ? seasonName(t, seasonKey) : '' })}
          body={release ? t('wrapped.notReleased.body', { date: format.longDate(release), time: format.time(release) }) : t('wrapped.notReleased.bodyNoDate')}
          action={{ label: t('wrapped.player.close'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/')), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.notReleased`}
        />
      </StateStage>
    );
  } else if (!payload && (qaState === 'empty' || !seasonKey || error?.kind === 'not_found')) {
    content = (
      <StateStage offline={offline}>
        <EmptyState
          title={t('wrapped.empty.title')}
          body={t('wrapped.empty.body')}
          preview={<SamplePreview />}
          action={{ label: t('wrapped.empty.action'), onPress: () => router.replace('/garage'), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.empty`}
        />
      </StateStage>
    );
  } else if (!payload) {
    content = (
      <StateStage offline={offline}>
        <ErrorState
          title={t('wrapped.error.title')}
          message={offline || query.fetchStatus === 'paused' ? t('wrapped.player.offline') : undefined}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          testID={`${ROUTE}.error`}
        />
      </StateStage>
    );
  } else {
    // A forum ban (M5.8) blocks the forum only, not sharing a Wrapped.
    const blocked = restriction !== null && restriction !== 'messaging' && restriction !== 'forum';
    content = (
      <StoryPlayer
        payload={payload}
        offline={offline}
        shareAllowed={!blocked && !(offline && wrappedExportMode === 'server')}
        restricted={blocked ? t('wrapped.player.restricted') : null}
      />
    );
  }

  return (
    <ThemeScope name={scope}>
      {/* DQ-1045: on the web the stage names its theme, so the audit checks its colours against that theme's tokens. */}
      <View
        style={styles.stage}
        dataSet={{ themeScope: scope }}
        testID={`${ROUTE}.root`}
      >
        {content}
      </View>
    </ThemeScope>
  );
}
