import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useAppConfig, useFlag } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import { useQrCode, useQrSvg, type QrCodeData } from '@/api/queries/qr';
import { photoFields } from '@/features/profile/media';
import { shareLink } from '@/features/profile/share';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space, useBreakpoint, useTheme } from '@/theme';
import {
  Button,
  ErrorState,
  Hairline,
  ListRow,
  QRDisplay,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  toast,
} from '@/ui';
import { QrReveal } from '@/ui/motion/kit';

import { displayQrCode, displayQrUrl } from '../code';
import { DownloadSheet } from '../components/DownloadSheet';
import { QrPage } from '../components/QrPage';
import { QrNotice, QrRowGroup, QrSignInState, QrState } from '../components/parts';
import { ReissueDialog } from '../components/ReissueDialog';
import { SCAN_STATS_FLAG, ScanStats } from '../components/ScanStats';
import { openPublicPage } from '../openPublicPage';
import { useRevealOnce } from '../reveal';
import { isBlockedByStaff } from '../status';
import { STICKER_SHOP_FLAG, stickerShopUrl } from '../stickerShop';
import { useQrDownload } from '../useQrDownload';

const ROUTE = 'QR-02';
/** QrPage's column from 768: the QR card at its §8 maximum (QR 320 + 2 × 24). */
const QR_COLUMN = size.qrMaxOnScreen + space[24] * 2;
/** Mehr Formate, Teilen, Vorschau, Platzierung: the rows under the two buttons. */
const SKELETON_ROWS = 4;

const useStyles = createStyles((t) => ({
  // §8 QR display, stretched to the column so its edges meet the title's and the buttons' (DQ-035).
  card: { alignSelf: 'stretch', maxWidth: '100%' },
  stage: { paddingVertical: t.space[32] },
  stageInset: { borderRadius: t.radius.xl },
  // DQ-1065: from 768 the stage (7) and the actions (5) stand side by side across the content width; the stage spans its whole
  // column, never a framed box around the card (DQ-1053).
  split: { alignItems: 'flex-start', columnGap: t.space[32], flexDirection: 'row' },
  splitStage: { flexBasis: 0, flexGrow: 7, minWidth: 0 },
  splitSide: { flexBasis: 0, flexGrow: 5, minWidth: 0 },
  stageWide: {
    alignSelf: 'stretch',
    borderRadius: t.radius.xl,
    paddingHorizontal: t.space[24],
    paddingVertical: t.space[64],
  },
  firstInSide: { marginTop: t.space[0] },
  stageSkeleton: { backgroundColor: t.color.media.ground },
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
  skeletonCard: {
    alignItems: 'center',
    backgroundColor: t.color.qr.bg,
    borderRadius: t.radius.md,
    gap: t.space[4],
    padding: t.space[24],
  },
  skeletonCode: { marginBottom: t.space[12], maxWidth: t.size.qrMaxOnScreen },
  skeletonShortCode: { width: '40%' },
  skeletonUrl: { width: '60%' },
  skeletonGroup: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16] },
}));

/** The white card's skeleton: code, short code, URL. */
function CardSkeleton({ testID }: { testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.skeletonCard} testID={testID}>
      <SkeletonBlock width="100%" aspectRatio={1} corner="sm" style={styles.skeletonCode} />
      {/* Centred like the code and the URL: the line takes the width of its box, so the box carries the width. */}
      <SkeletonText variant="headline" style={styles.skeletonShortCode} />
      <SkeletonText variant="caption" style={styles.skeletonUrl} />
    </View>
  );
}

function DetailSkeleton() {
  const styles = useStyles();
  const stage = useStageInset();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <SplitLayout
        split={stage.split}
        stage={
          <View
            style={
              stage.split
                ? [styles.stageWide, styles.stageSkeleton, { alignItems: 'center' }]
                : [
                    styles.stage,
                    styles.stageSkeleton,
                    { marginHorizontal: -stage.inset, paddingHorizontal: stage.inset },
                  ]
            }
          >
            <View style={{ width: stage.columnWidth }}>
              <CardSkeleton />
            </View>
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

/** The stage reaches past the column: to the screen's edges on a phone (full bleed), by 24 on each side from 768 (inset media). */
function useStageInset(): { inset: number; columnWidth: number; bleed: boolean; split: boolean } {
  const { gutter, kind, width } = useBreakpoint();
  const bleed = kind === 'phone';
  return {
    inset: bleed ? gutter : space[24],
    columnWidth: bleed ? width - 2 * gutter : QR_COLUMN,
    bleed,
    split: !bleed,
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
  const theme = useTheme();
  const suspended = useSuspended();
  const code = useQrCode(vehicleId);
  const blocked = isBlockedByStaff(qr);
  const active = qr.status === 'active' && qr.code !== null;
  const svg = useQrSvg(vehicleId, qr.code, active);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scans = useFlag(SCAN_STATS_FLAG);
  const shop = useFlag(STICKER_SHOP_FLAG);
  const { config } = useAppConfig();
  const shopUrl = shop ? stickerShopUrl(config.links) : null;
  const vehicle = qr.vehicle.full_title;
  const revealed = useRevealOnce(Boolean(svg.data));
  const stage = useStageInset();
  const stageStyle = useMemo(
    () =>
      stage.split
        ? [styles.stageWide]
        : [styles.stage, { marginHorizontal: -stage.inset, paddingHorizontal: stage.inset }],
    [stage.split, stage.inset, styles.stage, styles.stageWide],
  );
  // "In Fotos sichern" and "Sticker-PDF" start their file at once; the sheet keeps every other format.
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
      url: qr.vehicle.public_url,
      title: t('detail.shareTitle', { vehicle }),
    });
    setSharing(false);
    if (outcome === 'copied') toast(t('detail.linkCopied'), { testID: `${ROUTE}.shareToast` });
    if (outcome === 'failed') toast(t('detail.shareFailed'), { testID: `${ROUTE}.shareToast` });
  };

  const openShop = async () => {
    if (!shopUrl) return;
    if (!(await openPublicPage(shopUrl, theme)))
      toast(t('detail.shopFailed'), { testID: `${ROUTE}.shopToast` });
  };

  const svgFailed = svg.isError || svg.fetchStatus === 'paused';
  const live = active && !blocked;

  let card: ReactNode;
  if (blocked) {
    card = <BlockedCard />;
  } else if (live && !svgFailed) {
    // SM13: the car's photo blurred behind, the card scales in once its code is drawn (medium haptic).
    card = (
      <QrReveal
        photo={
          qr.vehicle.cover ? photoFields(qr.vehicle.cover, stage.columnWidth + 2 * stage.inset) : undefined
        }
        revealed={revealed}
        placeholder={
          <View style={{ width: stage.columnWidth }}>
            <CardSkeleton testID={`${ROUTE}.cardSkeleton`} />
          </View>
        }
        style={stageStyle}
        testID={`${ROUTE}.stage`}
      >
        <View style={{ width: stage.columnWidth }}>
          {svg.data ? (
            <QRDisplay
              svg={svg.data}
              label={t('detail.cardLabel', { vehicle })}
              code={qr.display_code ?? displayQrCode(qr.code ?? '')}
              url={qr.url ? displayQrUrl(qr.url) : undefined}
              style={styles.card}
              testID={`${ROUTE}.card`}
            />
          ) : (
            // Hidden under the placeholder: the card's shape, so the stage keeps its height when the code appears.
            <CardSkeleton />
          )}
        </View>
      </QrReveal>
    );
  } else {
    card = (
      <ErrorState
        title={t('detail.cardErrorTitle')}
        onRetry={() => void svg.refetch()}
        retrying={svg.isFetching}
        testID={`${ROUTE}.cardError`}
      />
    );
  }

  const busy = direct.active;
  return (
    <SplitLayout
      split={stage.split}
      stage={card}
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
            // Stacked at every width: side by side in the 368 column, "In Fotos sichern" would wrap.
            <View
              style={[
                styles.actions,
                stage.split && !(qr.scan_state === 'private') && !suspended ? styles.firstInSide : null,
              ]}
            >
              <Button
                label={isWeb ? t('detail.saveImage') : t('detail.savePhoto')}
                icon="download-simple"
                size="l"
                fullWidth
                disabled={!svg.data || (busy !== null && busy !== 'png')}
                loading={busy === 'png'}
                onPress={() => void direct.start('png')}
                testID={`${ROUTE}.savePhoto`}
              />
              <Button
                label={t('detail.stickerPdf')}
                icon="qr-code"
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
            {live ? (
              <>
                <ListRow
                  icon="grid-four"
                  title={t('detail.moreFormats')}
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
              onPress={() => router.push({ pathname: '/qr/[vehicleId]/preview', params: { vehicleId } })}
              inset={space[16]}
              divider={!blocked}
              testID={`${ROUTE}.publicPage`}
            />
            {blocked ? null : (
              <ListRow
                icon="qr-sticker"
                title={t('detail.placement')}
                onPress={() => router.push({ pathname: '/qr/[vehicleId]/placement', params: { vehicleId } })}
                inset={space[16]}
                divider={live && shopUrl !== null}
                testID={`${ROUTE}.placement`}
              />
            )}
            {live && shopUrl ? (
              <ListRow
                icon="arrow-square-out"
                title={t('detail.orderSticker')}
                role="link"
                chevron={false}
                onPress={() => void openShop()}
                inset={space[16]}
                testID={`${ROUTE}.orderSticker`}
              />
            ) : null}
            {/* FS-9 [SIG]: the scan counts, private; a code taken down by staff still counted its scans. */}
            {scans ? <ScanStats vehicleId={vehicleId} routeId={ROUTE} /> : null}
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
              />
              <ReissueDialog visible={dialog} onClose={() => setDialog(false)} vehicleId={vehicleId} />
            </>
          ) : null}
        </>
      }
    />
  );
}

/** QR-02 (FS-9): the card, downloads, sharing, the public page, the placement guide and "QR-Code ersetzen". */
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
      fallback="/profile/qr"
      offlineLabel={t('common.offlineBanner')}
    >
      {body}
    </QrPage>
  );
}
