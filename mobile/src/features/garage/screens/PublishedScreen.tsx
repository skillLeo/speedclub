import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useVehicle } from '@/api/queries/garage';
import { useQrCode, useQrSvg } from '@/api/queries/qr';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { shareLink } from '@/features/profile/share';
import { displayQrCode, displayQrUrl } from '@/features/qr/code';
import { useRevealOnce } from '@/features/qr/reveal';
import { paramOf } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, size, space, typography, useBreakpoint, useTheme } from '@/theme';
import {
  Button,
  Header,
  OfflineBanner,
  QRDisplay,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  toast,
} from '@/ui';
import { PrintWipe, QrReveal } from '@/ui/motion/kit';
import { SlotText, slot } from '@/ui/SlotText';
import { nameInText } from '@/ui/textBreaks';

import { photoFields } from '@/features/profile/media';

import { CentredState, GoneState, LoadErrorState, SignInState, useGarageAccess } from '../components/frames';
import { isGone } from '../errors';
import { useCloseModal } from '../navigation';

const ROUTE = 'GAR-04';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const WORDMARK_WIDTH = 160;
/** DQ-1064: the brush logo on a short phone, so the moment fits 667 with the card at its scannable minimum. */
const WORDMARK_WIDTH_SHORT = 120;
const COLUMN_MAX = size.qrMaxOnScreen + 2 * space[24];
/** The QR card's height beyond its width: the code's margin, the short code (headline), 4, the URL (caption), 4 + 4 gaps. */
const CARD_EXTRA = space[12] + space[4] * 2 + typography.headline.lineHeight + typography.caption.lineHeight;
/** A phone window shorter than this (iPhone SE 667) gets the tight stage and the paired actions. */
const SHORT_WINDOW = 760;
/** Below this font scale the page fits its window; above it the text grows and the page scrolls (200 % reflow). */
const FIT_SCALE = 1.3;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32] },
  contentShort: { paddingBottom: t.space[16] },
  stage: { paddingBottom: t.space[40], paddingTop: t.space[32] },
  stageShort: { paddingBottom: t.space[16], paddingTop: t.space[16] },
  stageColumnShort: { gap: t.space[16] },
  // Desktop (DQ-1064): the ONB split — stage with the card on the left, the words and the actions on the right.
  split: {
    alignItems: 'center',
    columnGap: t.space[48],
    flexDirection: 'row',
    flexGrow: 1,
    paddingHorizontal: t.space[48],
  },
  splitStage: { borderRadius: t.radius.xl, flexBasis: 0, flexGrow: 7, overflow: 'hidden' },
  splitCopy: { flexBasis: 0, flexGrow: 5, maxWidth: COLUMN_MAX },
  // Short phones: Teilen and Zur Garage share a row under the one filled button.
  pair: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[8] },
  pairItem: { flexBasis: 0, flexGrow: 1, minWidth: 0 },
  stageColumn: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: t.space[24],
    maxWidth: COLUMN_MAX,
    width: '100%',
  },
  mark: { alignItems: 'center', gap: t.space[8] },
  card: { alignSelf: 'stretch' },
  cardSlot: { alignSelf: 'stretch', aspectRatio: 1 },
  column: { alignSelf: 'center', maxWidth: COLUMN_MAX, paddingTop: t.space[24], width: '100%' },
  body: { marginTop: t.space[8] },
  actions: { gap: t.space[12], marginTop: t.space[24] },
  columnShort: { paddingTop: t.space[16] },
  actionsInner: { gap: t.space[12] },
  stageSkeleton: { backgroundColor: t.color.media.ground },
}));

/**
 * GAR-04 Veröffentlicht + QR ★ (09 §7.6, SM13): the car's photo blurred behind, the brush logo with the katakana (a brand
 * moment), the QR card that prints top → bottom while the accent rule draws under the logo, then `title.2` "Dein Build ist live."
 * and the three ways on: "QR-Code ansehen" (the one filled CTA), "Teilen", "Zur Garage". The reveal gives the medium haptic
 * (09 §4.8 "QR revealed"); the success haptic belongs to the publish itself (GAR-03).
 */
export function PublishedScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const close = useCloseModal();
  const access = useGarageAccess();
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const { fontScale } = useTheme();
  const [viewport, setViewport] = useState(0);
  const [below, setBelow] = useState(0);
  const [mark, setMark] = useState(0);
  const params = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = paramOf(params.vehicleId) ?? '';
  const query = useVehicle(vehicleId);
  const vehicle = query.data;
  const code = vehicle?.qr?.code ?? null;
  const svg = useQrSvg(vehicleId, code, qaState !== 'loading');
  // The public page's address for "Teilen" (the sticker's own URL would count the share as a scan).
  const qr = useQrCode(code ? vehicleId : undefined);
  const [sharing, setSharing] = useState(false);
  const ready = useRevealOnce(qaState !== 'loading' && Boolean(vehicle && code && svg.data));

  /** The modal closes, then the next screen opens in the tab underneath. */
  const leaveTo = (path: string) => {
    close();
    router.push(path as never);
  };

  let body;
  if (access.status === 'guest') {
    body = <SignInState routeId={ROUTE} returnTo={`/published/${vehicleId}`} />;
  } else if (qaState === 'error' || (query.isError && !vehicle && !isGone(query.error))) {
    body = (
      <LoadErrorState
        routeId={ROUTE}
        offline={!online}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (
    (query.isError && isGone(query.error)) ||
    (vehicle && (vehicle.status !== 'published' || !code))
  ) {
    body = <GoneState routeId={ROUTE} title={t('published.goneTitle')} body={t('published.goneBody')} />;
  }
  if (body) {
    return (
      <Screen edges={EDGES} testID={`${ROUTE}.root`}>
        <Header backIcon="close" onBack={close} testID={`${ROUTE}.header`} />
        <CentredState>{body}</CentredState>
      </Screen>
    );
  }

  const title = vehicle?.full_title ?? '';
  const desktop = kind === 'desktop';
  // DQ-1064: on a phone the moment fits its window up to font scale 1.3 — the card shrinks (floor 0.75), short windows tighten
  // the stage and pair the two quiet actions. QrReveal centres its card: the column gets a number for its percentages.
  const natural = Math.min(windowWidth - 2 * gutter, COLUMN_MAX);
  const short = !desktop && fontScale < FIT_SCALE && viewport > 0 && viewport < SHORT_WINDOW;
  const stagePad = short ? space[16] + space[16] : space[32] + space[40];
  // Everything under the card counts: the copy column, the stage's padding, the mark and its gap, the scroller's end padding.
  const markGap = short ? space[16] : space[24];
  const withMark = viewport - below - stagePad - mark - markGap - CARD_EXTRA - (short ? space[16] : space[32]);
  // DQ-1064: the card may shrink to the scannable minimum (QR 200) so the moment fits the window (r2: 393 × 852 was 13 over at 3/4).
  const floor = size.qrMinOnScreen + 2 * space[24];
  // DQ-1064 r3 (iPhone SE 375 × 667, 33 over at the floor): when even the smallest card leaves the actions below the fold, the
  // wordmark gives way: the card, the title and the actions are what this moment needs on the smallest phone. `mark` keeps its
  // last measured height, so the decision does not flip back once the mark is gone.
  const cramped = short && mark > 0 && withMark < floor;
  const fit = cramped ? withMark + mark + markGap : withMark;
  const columnWidth = desktop
    ? COLUMN_MAX
    : fontScale < FIT_SCALE && viewport > 0 && below > 0
      ? Math.max(floor, Math.min(natural, fit))
      : natural;
  const publicUrl = qr.data?.vehicle.public_url ?? null;

  const share = async () => {
    if (!publicUrl) return;
    setSharing(true);
    const outcome = await shareLink({ url: publicUrl, title });
    setSharing(false);
    if (outcome === 'copied') toast(t('published.linkCopied'), { testID: `${ROUTE}.toast` });
    if (outcome === 'failed') toast(t('published.shareFailed'), { testID: `${ROUTE}.toast` });
  };

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header backIcon="close" onBack={close} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner testID={`${ROUTE}.offline`} />}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, short ? styles.contentShort : null, desktop ? styles.split : null]}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
      >
        {vehicle ? (
          // Mounted once the car is known, hidden until its code is drawn: the card and the mark then reveal together (SM13).
          <QrReveal
            photo={vehicle.cover ? photoFields(vehicle.cover, windowWidth) : undefined}
            revealed={ready}
            // While the code loads: the stage keeps the column's shape, the hidden column below holds its height.
            placeholder={
              <Skeleton style={[styles.stageColumn, { width: columnWidth }]} testID={`${ROUTE}.skeleton`}>
                <SkeletonText variant="headline" width="40%" />
                <SkeletonBlock aspectRatio={1} corner="md" style={styles.card} />
              </Skeleton>
            }
            style={[
              styles.stage,
              short ? styles.stageShort : null,
              desktop ? styles.splitStage : { paddingHorizontal: gutter },
            ]}
            testID={`${ROUTE}.stage`}
          >
            <View style={[styles.stageColumn, short ? styles.stageColumnShort : null, { width: columnWidth }]}>
              {/* DQ-1064: the brush logo with its own katakana is the brand moment, once; no second katakana line, no extra rule. */}
              {cramped ? null : (
                <View style={styles.mark} onLayout={(event) => setMark(event.nativeEvent.layout.height)}>
                  <AppWordmark width={short ? WORDMARK_WIDTH_SHORT : WORDMARK_WIDTH} tone="white" decorative testID={`${ROUTE}.wordmark`} />
                </View>
              )}
              <View style={styles.card}>
                {ready && vehicle.qr && svg.data ? (
                  <PrintWipe printing={ready} testID={`${ROUTE}.print`}>
                    <QRDisplay
                      svg={svg.data}
                      label={t('published.qrLabel', { vehicle: title })}
                      code={displayQrCode(vehicle.qr.code)}
                      url={displayQrUrl(vehicle.qr.url)}
                      testID={`${ROUTE}.qr`}
                    />
                  </PrintWipe>
                ) : (
                  // Hidden under the placeholder: the card's box, so the stage keeps its height when the code appears.
                  <View style={styles.cardSlot} testID={`${ROUTE}.cardSlot`} />
                )}
              </View>
            </View>
          </QrReveal>
        ) : (
          <Skeleton
            style={[styles.stage, styles.stageSkeleton, { paddingHorizontal: gutter }]}
            testID={`${ROUTE}.skeleton`}
          >
            <View style={styles.stageColumn}>
              <SkeletonText variant="headline" width="40%" />
              <SkeletonBlock aspectRatio={1} corner="md" style={styles.card} />
            </View>
          </Skeleton>
        )}
        <View
          style={
            desktop
              ? styles.splitCopy
              : [styles.column, short ? styles.columnShort : null, { paddingHorizontal: gutter }]
          }
          onLayout={(event) => setBelow(event.nativeEvent.layout.height)}
        >
          <Text variant="title2" role="heading" aria-level={1} testID={`${ROUTE}.title`}>
            {t('published.title')}
          </Text>
          {/* DQ-926: the name never breaks at its own hyphen ("GT- / R") and its code stays with it. */}
          <SlotText
            variant="body"
            color="text.secondary"
            style={styles.body}
            text={title ? t('published.body', { vehicle: slot('vehicle') }) : t('published.bodyFallback')}
            slots={title ? { vehicle: nameInText(title) } : undefined}
            testID={`${ROUTE}.body`}
          />
          <View style={styles.actions}>
            <Button
              label={t('published.viewQr')}
              size="l"
              fullWidth
              icon="qr-code"
              disabled={!vehicle}
              onPress={() => leaveTo(`/qr/${vehicleId}`)}
              testID={`${ROUTE}.viewQr`}
            />
            <View style={short ? styles.pair : styles.actionsInner}>
              <Button
                label={t('published.share')}
                variant="secondary"
                size={short ? 'm' : 'l'}
                fullWidth={!short}
                icon="share-network"
                loading={sharing}
                disabled={!publicUrl}
                onPress={() => void share()}
                style={short ? styles.pairItem : undefined}
                testID={`${ROUTE}.share`}
              />
              <Button
                label={t('published.toGarage')}
                variant="tertiary"
                size="m"
                fullWidth={!short}
                onPress={() => leaveTo('/garage')}
                style={short ? styles.pairItem : undefined}
                testID={`${ROUTE}.toGarage`}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
