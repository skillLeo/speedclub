import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useMe } from '@/api/queries/auth';
import { useQrCode, useQrSvg, type QrCodeData } from '@/api/queries/qr';
import { shareLink } from '@/features/profile/share';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space } from '@/theme';
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

import { displayQrCode, displayQrUrl } from '../code';
import { DownloadSheet } from '../components/DownloadSheet';
import { QrPage } from '../components/QrPage';
import { QrNotice, QrRowGroup, QrSignInState, QrState } from '../components/parts';
import { ReissueDialog } from '../components/ReissueDialog';
import { SCAN_STATS_FLAG, ScanStats } from '../components/ScanStats';
import { isBlockedByStaff } from '../status';

const ROUTE = 'QR-02';

const useStyles = createStyles((t) => ({
  // §8 QR display, stretched to the column so its edges meet the title's and the buttons' (DQ-035).
  card: { alignSelf: 'stretch', maxWidth: '100%' },
  notice: { marginTop: t.space[16] },
  actions: { gap: t.space[12], marginTop: t.space[24] },
  rows: { marginTop: t.space[32] },
  danger: { marginTop: t.space[24] },
  hint: { marginTop: t.space[8], paddingHorizontal: t.space[16] },
  blocked: {
    alignItems: 'flex-start',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.lg,
    gap: t.space[8],
    padding: t.space[24],
  },
  skeletonCard: {
    alignItems: 'center',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.lg,
    gap: t.space[4],
    padding: t.space[24],
  },
  skeletonCode: { marginBottom: t.space[12], maxWidth: t.size.qrMaxOnScreen },
  skeletonShortCode: { width: '40%' },
  skeletonUrl: { width: '60%' },
  skeletonGroup: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { justifyContent: 'center', minHeight: t.size.row.single, paddingHorizontal: t.space[16] },
}));

function DetailSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.skeletonCard}>
        <SkeletonBlock width="100%" aspectRatio={1} corner="sm" style={styles.skeletonCode} />
        {/* Centred like the code and the URL: the line takes the width of its box, so the box carries the width. */}
        <SkeletonText variant="code" style={styles.skeletonShortCode} />
        <SkeletonText variant="caption" style={styles.skeletonUrl} />
      </View>
      <View style={styles.actions}>
        <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
        <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
      </View>
      <View style={[styles.rows, styles.skeletonGroup]}>
        {[0, 1].map((row) => (
          <View key={row}>
            <View style={styles.skeletonRow}>
              <SkeletonText variant="body" width="55%" />
            </View>
            {row === 0 ? <Hairline inset={space[16]} /> : null}
          </View>
        ))}
      </View>
    </Skeleton>
  );
}

/** The staff takedown of ADR-148 (e): nothing to print and nothing to replace; only staff issue the next code. */
function BlockedCard() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  return (
    <View style={styles.blocked} role="status" testID={`${ROUTE}.blocked`}>
      <Text variant="titleS" role="heading" aria-level={2}>
        {t('blocked.title')}
      </Text>
      <Text variant="bodyDense" color="text.secondary">
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

function DetailBody({ qr, vehicleId }: { qr: QrCodeData; vehicleId: string }) {
  const { t } = useTranslation('qr');
  const { t: viewAsT } = useTranslation('auth');
  // View-as (m3.2-contract §3): a new code would be a write in the member's name.
  const readOnly = useViewAsReadOnly();
  const styles = useStyles();
  const router = useRouter();
  const suspended = useSuspended();
  const code = useQrCode(vehicleId);
  const blocked = isBlockedByStaff(qr);
  const active = qr.status === 'active' && qr.code !== null;
  const svg = useQrSvg(vehicleId, qr.code, active);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scans = useFlag(SCAN_STATS_FLAG);
  const vehicle = qr.vehicle.full_title;

  const share = async () => {
    setSharing(true);
    const outcome = await shareLink({ url: qr.vehicle.public_url, title: t('detail.shareTitle', { vehicle }) });
    setSharing(false);
    if (outcome === 'copied') toast(t('detail.linkCopied'), { testID: `${ROUTE}.shareToast` });
    if (outcome === 'failed') toast(t('detail.shareFailed'), { testID: `${ROUTE}.shareToast` });
  };

  const svgFailed = svg.isError || svg.fetchStatus === 'paused';
  if (active && !blocked && !svg.data && !svgFailed) return <DetailSkeleton />;

  let card: ReactNode;
  if (blocked) {
    card = <BlockedCard />;
  } else if (svg.data) {
    card = (
      <QRDisplay
        svg={svg.data}
        label={t('detail.cardLabel', { vehicle })}
        code={qr.display_code ?? displayQrCode(qr.code ?? '')}
        url={qr.url ? displayQrUrl(qr.url) : undefined}
        style={styles.card}
        testID={`${ROUTE}.card`}
      />
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

  return (
    <>
      {card}
      {active && !blocked && qr.scan_state === 'private' ? (
        <QrNotice message={t('detail.privateNotice')} icon="lock-simple" style={styles.notice} testID={`${ROUTE}.private`} />
      ) : null}
      {suspended && !blocked ? (
        <QrNotice message={t('detail.suspendedNotice')} style={styles.notice} testID={`${ROUTE}.restricted`} />
      ) : null}
      {active && !blocked ? (
        // Stacked at every width: side by side in the 368 column, "Herunterladen" would wrap.
        <View style={styles.actions}>
          <Button
            label={t('detail.download')}
            icon="download-simple"
            size="l"
            fullWidth
            disabled={!svg.data}
            onPress={() => setSheet(true)}
            testID={`${ROUTE}.download`}
          />
          <Button
            label={t('detail.share')}
            icon="share-network"
            variant="secondary"
            size="l"
            fullWidth
            loading={sharing}
            onPress={() => void share()}
            testID={`${ROUTE}.share`}
          />
        </View>
      ) : null}
      <QrRowGroup style={styles.rows} testID={`${ROUTE}.rows`}>
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
            icon="info"
            title={t('detail.placement')}
            onPress={() => router.push({ pathname: '/qr/[vehicleId]/placement', params: { vehicleId } })}
            inset={space[16]}
            testID={`${ROUTE}.placement`}
          />
        )}
        {/* FS-9 [SIG]: the scan counts sit after the placement guide; a code taken down by staff still counted its scans. */}
        {scans ? <ScanStats vehicleId={vehicleId} routeId={ROUTE} /> : null}
      </QrRowGroup>
      {active && !blocked ? (
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
          <Text variant="supporting" color="text.secondary" style={styles.hint} testID={`${ROUTE}.reissueHint`}>
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
  const answered = query.error instanceof ApiError && (query.error.status === 403 || query.error.status === 404);

  let body: ReactNode;
  if (session === 'guest') {
    body = <QrSignInState routeId={ROUTE} />;
  } else if (qaState === 'loading' || session === 'loading' || (!qr && query.isPending && query.fetchStatus !== 'paused' && qaState === 'default')) {
    body = <DetailSkeleton />;
  } else if (qaState === 'empty' || (!qr && answered)) {
    body = (
      <QrState
        routeId={ROUTE}
        name="unavailable"
        icon="qr-code"
        title={t('unavailable.title')}
        body={t('unavailable.body')}
        action={{ label: t('unavailable.garage'), onPress: () => router.navigate('/garage'), variant: 'secondary', size: 'm' }}
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
      title={t('detail.title')}
      subtitle={qr ? keepNameTogether(qr.vehicle.full_title) : undefined}
      subtitlePending={
        !qr && session !== 'guest' && (qaState === 'loading' || session === 'loading' || query.fetchStatus === 'fetching')
      }
      fallback="/profile/qr"
      offlineLabel={t('common.offlineBanner')}
    >
      {body}
    </QrPage>
  );
}
