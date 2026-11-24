import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import { useQrCode, useQrSvg, type QrCodeData } from '@/api/queries/qr';
import { useMyStickers, useStickerStats } from '@/api/queries/stickers';
import { photoFields } from '@/features/profile/media';
import { shareLink, withShareVia } from '@/features/profile/share';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { ListRow } from '@/ui/ListRow';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { displayQrCode, displayQrUrl } from '../code';
import { DownloadSheet } from '../components/DownloadSheet';
import { QrPage } from '../components/QrPage';
import { QrNotice, QrRowGroup, QrSignInState, QrState } from '../components/parts';
import { ReissueDialog } from '../components/ReissueDialog';
import { CardArt, STAGE_RATIO } from '../components/StickerHubCard';
import { StickerStage } from '../components/StickerStage';
import { SCAN_STATS_FLAG } from '../stats';
import { isBlockedByStaff } from '../status';
import { useQrDownload } from '../useQrDownload';

const ROUTE = 'STK-02';
/** QR-Code, Teilen, Öffentliche Seite, Platzierung, Scan-Statistik: the rows under the two buttons (DQ-M54R2-12). */
const SKELETON_ROWS = 5;
/** The default design's proportion (Classic, 156 × 65 mm) while the drawing loads. */
const ART_RATIO = 156 / 65;

const useStyles = createStyles((t) => ({
  // DQ-M54-10: the sticker on its car leads, 16:9 like the hub's cards; full bleed on a phone, inset (radius 20) from 768.
  stage: { aspectRatio: STAGE_RATIO, padding: t.space[24] },
  stageInset: { borderRadius: t.radius.xl },
  // DQ-1065: from 768 the stage (7) and the actions (5) stand side by side across the content width.
  split: { alignItems: 'flex-start', columnGap: t.space[32], flexDirection: 'row' },
  splitStage: { flexBasis: 0, flexGrow: 7, minWidth: 0 },
  splitSide: { flexBasis: 0, flexGrow: 5, minWidth: 0 },
  firstInSide: { marginTop: t.space[0] },
  stageSkeleton: { alignItems: 'center', backgroundColor: t.color.media.ground, justifyContent: 'center' },
  notice: { marginTop: t.space[16] },
  actions: { gap: t.space[12], marginTop: t.space[24] },
  rows: { marginTop: t.space[24] },
  danger: { marginTop: t.space[24] },
  hint: { marginTop: t.space[8], paddingHorizontal: t.space[16] },
  blocked: {
    alignItems: 'flex-start',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    gap: t.space[8],
    padding: t.space[24],
  },
  skeletonGroup: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16] },
}));

/** DQ-M54-11: the page's geometry while it loads: the stage in its place and ratio, the two buttons, the rows. */
function DetailSkeleton() {
  const styles = useStyles();
  const stage = useStageInset();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <SplitLayout
        split={stage.split}
        stage={
          <View style={[styles.stage, styles.stageSkeleton, stage.style]}>
            <SkeletonBlock width="100%" aspectRatio={ART_RATIO} corner="sm" />
          </View>
        }
        side={
          <>
            <View style={[styles.actions, stage.split ? styles.firstInSide : null]}>
              <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
              <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
            </View>
            <View style={[styles.rows, styles.skeletonGroup]}>
              {Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <View key={row}>
                  <View style={styles.skeletonRow}>
                    <SkeletonText variant="body" width="55%" />
                  </View>
                  {row < SKELETON_ROWS - 1 ? <Hairline inset={space[16]} /> : null}
                </View>
              ))}
            </View>
            {/* "QR-Code ersetzen" on its own, and its hint. */}
            <View style={[styles.danger, styles.skeletonGroup]}>
              <View style={styles.skeletonRow}>
                <SkeletonText variant="body" width="45%" />
              </View>
            </View>
            <SkeletonText variant="callout" width="80%" style={styles.hint} />
          </>
        }
      />
    </Skeleton>
  );
}

/** The staff takedown of ADR-148 (e): nothing to print and nothing to replace; only staff issue the next code. */
function BlockedCard() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  return (
    <View style={styles.blocked} role="status" testID={`${ROUTE}.blocked`}>
      <Text variant="headline" role="heading" aria-level={2}>
        {t('blocked.title')}
      </Text>
      <Text variant="body" color="text.secondary">
        {t('blocked.body')}
      </Text>
    </View>
  );
}

function useSuspended(): boolean {
  const qaState = useQaState();
  const me = useMe();
  return qaState === 'restricted' || me.data?.restrictions.suspended === true;
}

/** The stage reaches past the column to the screen's edges on a phone (full bleed); from 768 it is inset media with radius 20. */
function useStageInset() {
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const bleed = kind === 'phone';
  return {
    split: !bleed,
    style: bleed ? { marginHorizontal: -gutter } : styles.stageInset,
  };
}

/** Phones: one column. From 768: the stage on the left, everything else on the right (DQ-1065). */
function SplitLayout({ split, stage, side }: { split: boolean; stage: ReactNode; side: ReactNode }) {
  const styles = useStyles();
  if (!split) {
    return (
      <>
        {stage}
        {side}
      </>
    );
  }
  return (
    <View style={styles.split} testID={`${ROUTE}.split`}>
      <View style={styles.splitStage}>{stage}</View>
      <View style={styles.splitSide}>{side}</View>
    </View>
  );
}

function DetailBody({ qr, vehicleId }: { qr: QrCodeData; vehicleId: string }) {
  const { t } = useTranslation('qr');
  const { t: viewAsT } = useTranslation('auth');
  // View-as (m3.2-contract §3): a new code would be a write in the member's name.
  const readOnly = useViewAsReadOnly();
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const suspended = useSuspended();
  const code = useQrCode(vehicleId);
  const blocked = isBlockedByStaff(qr);
  const active = qr.status === 'active' && qr.code !== null;
  const svg = useQrSvg(vehicleId, qr.code, active);
  const cards = useMyStickers();
  const card = cards.data?.find((entry) => entry.vehicle.id === vehicleId);
  const scans = useFlag(SCAN_STATS_FLAG);
  const stats = useStickerStats(scans ? vehicleId : undefined);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  const vehicle = qr.vehicle.full_title;
  const stage = useStageInset();
  // "Sticker-PDF" (the A6 sheet) starts its file at once; the QR sheet keeps every other format.
  const direct = useQrDownload(
    { vehicleId, code: qr.code ?? '', dialogTitle: t('download.shareTitle', { vehicle }) },
    (outcome) => {
      if (outcome.kind === 'saved')
        toast(t('download.started', { file: outcome.fileName }), { testID: `${ROUTE}.downloadToast` });
    },
    (error) => {
      if (error.status === 404) void code.refetch();
      else toast(t('detail.downloadFailed'), { testID: `${ROUTE}.downloadToast` });
    },
  );

  const share = async () => {
    setSharing(true);
    const outcome = await shareLink({
      // M5.7 (contract §2.4): the shared address carries `?via=share`.
      url: withShareVia(qr.vehicle.public_url),
      title: t('detail.shareTitle', { vehicle }),
    });
    setSharing(false);
    if (outcome === 'copied') toast(t('detail.linkCopied'), { testID: `${ROUTE}.shareToast` });
    if (outcome === 'failed') toast(t('detail.shareFailed'), { testID: `${ROUTE}.shareToast` });
  };

  const live = active && !blocked;
  // DQ-M54-10: one filled action. "Sticker bestellen" once the design passed its Scan-Test (its print files exist) and the shop can take
  // the order, else "Sticker gestalten" (DQ-P5-301: with no store set up the order screen could only say "bald verfügbar", as STK-01 does).
  const ordering = card?.actions.download === true && card.actions.order.reason !== 'not_configured';
  const writable = !suspended && !readOnly;

  const hero = blocked ? (
    <BlockedCard />
  ) : (
    <StickerStage
      cover={photoFields(qr.vehicle.cover, stageWidth || size.railCard * 2)}
      style={[styles.stage, stage.style]}
      onLayout={(event: LayoutChangeEvent) => setStageWidth(event.nativeEvent.layout.width)}
      testID={`${ROUTE}.stage`}
    >
      {card ? (
        <CardArt
          card={card}
          width={stageWidth}
          label={t('hub.artLabel', { vehicle, design: designLineOf(card, t) })}
          testID={ROUTE}
        />
      ) : (
        <SkeletonBlock width="80%" aspectRatio={ART_RATIO} corner="sm" />
      )}
    </StickerStage>
  );

  const busy = direct.active;
  const thirty = stats.data?.total_30_days;
  return (
    <SplitLayout
      split={stage.split}
      stage={hero}
      side={
        <>
          {live && qr.scan_state === 'private' ? (
            <QrNotice
              message={t('detail.privateNotice')}
              icon="lock-simple"
              style={styles.notice}
              testID={`${ROUTE}.private`}
            />
          ) : null}
          {suspended && !blocked ? (
            <QrNotice
              message={t('detail.suspendedNotice')}
              style={styles.notice}
              testID={`${ROUTE}.restricted`}
            />
          ) : null}
          {live ? (
            <View
              style={[
                styles.actions,
                stage.split && !(qr.scan_state === 'private') && !suspended ? styles.firstInSide : null,
              ]}
            >
              {/* DQ-M54-23: a suspended owner gets no way into the designer or the order they cannot use. */}
              {writable ? (
                <Button
                  label={ordering ? t('detail.orderSticker') : t('detail.design')}
                  icon={ordering ? 'bag' : 'pencil-simple'}
                  size="l"
                  fullWidth
                  onPress={() =>
                    router.push({
                      pathname: ordering ? '/stickers/[vehicleId]/order' : '/stickers/[vehicleId]/design',
                      params: { vehicleId },
                    })
                  }
                  testID={`${ROUTE}.primary`}
                />
              ) : null}
              <Button
                label={t('detail.stickerPdf')}
                icon="download-simple"
                variant="secondary"
                size="l"
                fullWidth
                disabled={!svg.data || (busy !== null && busy !== 'pdf')}
                loading={busy === 'pdf'}
                onPress={() => void direct.start('pdf')}
                testID={`${ROUTE}.stickerPdf`}
              />
            </View>
          ) : null}
          <QrRowGroup style={styles.rows} testID={`${ROUTE}.rows`}>
            {live && ordering && writable ? (
              <ListRow
                icon="pencil-simple"
                title={t('detail.design')}
                onPress={() =>
                  router.push({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId } })
                }
                inset={space[16]}
                divider
                testID={`${ROUTE}.design`}
              />
            ) : null}
            {live ? (
              <>
                <ListRow
                  icon="qr-code"
                  title={t('detail.qrCode')}
                  value={qr.display_code ?? displayQrCode(qr.code ?? '')}
                  role="button"
                  disabled={!svg.data}
                  onPress={() => setSheet(true)}
                  inset={space[16]}
                  divider
                  testID={`${ROUTE}.download`}
                />
                <ListRow
                  icon="share-network"
                  title={t('detail.share')}
                  role="button"
                  chevron={false}
                  disabled={sharing}
                  onPress={() => void share()}
                  inset={space[16]}
                  divider
                  testID={`${ROUTE}.share`}
                />
              </>
            ) : null}
            <ListRow
              icon="eye"
              title={t('detail.publicPage')}
              onPress={() =>
                router.push({ pathname: '/stickers/[vehicleId]/preview', params: { vehicleId } })
              }
              inset={space[16]}
              divider={!blocked || scans}
              testID={`${ROUTE}.publicPage`}
            />
            {blocked ? null : (
              <ListRow
                icon="qr-sticker"
                title={t('detail.placement')}
                onPress={() =>
                  router.push({ pathname: '/stickers/[vehicleId]/placement', params: { vehicleId } })
                }
                inset={space[16]}
                divider={scans}
                testID={`${ROUTE}.placement`}
              />
            )}
            {/* FS-9 [SIG]: the scan counts, private; the 30 days fold into the row's value (DQ-M54-10). */}
            {scans ? (
              <ListRow
                icon="chart-bar"
                title={t('detail.scanStats')}
                value={
                  thirty === undefined
                    ? undefined
                    : t('detail.scansThirty', { count: thirty, total: format.number(thirty) })
                }
                adaptiveValue
                onPress={() =>
                  router.push({ pathname: '/stickers/[vehicleId]/stats', params: { vehicleId } })
                }
                inset={space[16]}
                testID={`${ROUTE}.stats`}
              />
            ) : null}
          </QrRowGroup>
          {live ? (
            <>
              <QrRowGroup style={styles.danger}>
                <ListRow
                  icon="arrow-clockwise"
                  title={t('detail.reissue')}
                  role="button"
                  destructive
                  chevron={false}
                  disabled={suspended || readOnly}
                  onPress={() => setDialog(true)}
                  inset={space[16]}
                  testID={`${ROUTE}.reissue`}
                />
              </QrRowGroup>
              <Text
                variant="callout"
                color="text.secondary"
                style={styles.hint}
                testID={`${ROUTE}.reissueHint`}
              >
                {readOnly ? viewAsT('viewAs.readOnly') : t('detail.reissueHint')}
              </Text>
              <DownloadSheet
                visible={sheet}
                onClose={() => setSheet(false)}
                vehicleId={vehicleId}
                code={qr.code ?? ''}
                vehicleTitle={vehicle}
                onGone={() => void code.refetch()}
                card={
                  svg.data
                    ? {
                        svg: svg.data,
                        label: t('detail.cardLabel', { vehicle }),
                        code: qr.display_code ?? displayQrCode(qr.code ?? ''),
                        url: qr.url ? displayQrUrl(qr.url) : undefined,
                      }
                    : undefined
                }
              />
              <ReissueDialog visible={dialog} onClose={() => setDialog(false)} vehicleId={vehicleId} />
            </>
          ) : null}
        </>
      }
    />
  );
}

/** "Classic · M · 156 × 65 mm" or "Noch nicht gestaltet", for the drawing's accessible description. */
function designLineOf(
  card: NonNullable<ReturnType<typeof useMyStickers>['data']>[number],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const design = card.design;
  if (!design) return t('hub.notDesigned');
  return [t(`designer.template.names.${design.template}`), t(`designer.size.${design.options.size}`)].join(
    ' · ',
  );
}

/** STK-02 (FS-9, DQ-M54-10): the sticker on its car, design or order, the QR code, sharing, the public page, placement, scans, "QR-Code ersetzen". */
export function QrDetailScreen() {
  const { t } = useTranslation('qr');
  const router = useRouter();
  const { vehicleId: param } = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = typeof param === 'string' ? param : '';
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const query = useQrCode(vehicleId);
  const qr = query.data;
  const answered =
    query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  let body: ReactNode;
  if (session === 'guest') {
    body = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!qr && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')
  ) {
    body = <DetailSkeleton />;
  } else if (qaState === 'empty' || (!qr && answered)) {
    body = (
      <QrState
        routeId={ROUTE}
        name="unavailable"
        icon="qr-code"
        title={t('unavailable.title')}
        body={t('unavailable.body')}
        action={{
          label: t('unavailable.garage'),
          onPress: () => router.navigate('/garage'),
          variant: 'secondary',
          size: 'm',
        }}
      />
    );
  } else if (qr && qaState === 'default' && qr.status !== 'active' && !isBlockedByStaff(qr)) {
    // A published vehicle always has an active code unless staff took it down; anything else is a moment between two states.
    body = (
      <QrState
        routeId={ROUTE}
        name="inactive"
        icon="qr-code"
        title={t('inactive.title')}
        body={t('inactive.body')}
        action={{ label: t('common.retry'), onPress: () => void query.refetch() }}
      />
    );
  } else if (qaState === 'error' || !qr) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('detail.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    body = <DetailBody qr={qr} vehicleId={vehicleId} />;
  }

  return (
    <QrPage
      routeId={ROUTE}
      wide
      title={t('detail.title')}
      subtitle={qr ? keepNameTogether(qr.vehicle.full_title) : undefined}
      subtitlePending={
        !qr &&
        session !== 'guest' &&
        (qaState === 'loading' || session === 'loading' || query.fetchStatus === 'fetching')
      }
      fallback="/stickers"
      offlineLabel={t('common.offlineBanner')}
    >
      {body}
    </QrPage>
  );
}
