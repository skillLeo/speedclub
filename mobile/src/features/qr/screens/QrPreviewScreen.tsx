import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type GestureResponderEvent } from 'react-native';

import { ApiError } from '@/api/client';
import { useQrCode, type QrCodeData } from '@/api/queries/qr';
import { photoFields } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space, useTheme } from '@/theme';
import { Button, ErrorState, Photo, Skeleton, SkeletonBlock, SkeletonText, Text, toast } from '@/ui';

import { displayQrUrl, guestViewUrl } from '../code';
import { QrPage } from '../components/QrPage';
import { QrNotice, QrSignInState, QrState } from '../components/parts';
import { openPublicPage } from '../openPublicPage';
import { isBlockedByStaff } from '../status';

const ROUTE = 'QR-04';
/** The 4:3 photo spans the column (QR card width from 768, the phone's column below); the variant is picked for that. */
const PHOTO_WIDTH = size.qrMaxOnScreen + space[24] * 2;

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  cardText: { gap: t.space[4], padding: t.space[16] },
  notice: { marginTop: t.space[16] },
  explain: { marginTop: t.space[16] },
  open: { marginTop: t.space[24] },
}));

function PreviewSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.card}>
        <SkeletonBlock width="100%" aspectRatio={4 / 3} corner="md" />
        <View style={styles.cardText}>
          <SkeletonText variant="headline" width="70%" />
          <SkeletonText variant="callout" width="55%" />
        </View>
      </View>
      <SkeletonText variant="body" lines={2} style={styles.explain} />
      <SkeletonBlock width="100%" height={size.button.l} corner="sm" style={styles.open} />
    </Skeleton>
  );
}

/** What a scan shows, in one line: the page, the page outside search and feed, or "privat". */
function explanationKey(qr: QrCodeData): 'preview.private' | 'preview.unlisted' | 'preview.active' {
  if (qr.scan_state === 'private' || qr.vehicle.visibility === 'private') return 'preview.private';
  return qr.vehicle.visibility === 'unlisted' ? 'preview.unlisted' : 'preview.active';
}

function PreviewBody({ qr }: { qr: QrCodeData }) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const theme = useTheme();
  const [opening, setOpening] = useState(false);
  const url = qr.vehicle.public_url;
  // The address shown stays the plain one a sticker leads to; the link asks for what a stranger gets there (BH-22).
  const guestUrl = guestViewUrl(url);
  const photo = photoFields(qr.vehicle.cover, PHOTO_WIDTH);

  const open = async () => {
    setOpening(true);
    const opened = await openPublicPage(guestUrl, theme);
    setOpening(false);
    if (!opened) toast(t('preview.openFailed'), { testID: `${ROUTE}.openError` });
  };

  // Web: a real link (href, so it can be copied or opened in the background), and a click opens it in a new tab, so the
  // member keeps the app next to the page. Native: the in-app browser.
  const onPress = (event: GestureResponderEvent) => {
    if (!isWeb) {
      void open();
      return;
    }
    event.preventDefault();
    window.open(guestUrl, '_blank', 'noopener');
  };

  return (
    <>
      <View style={styles.card} testID={`${ROUTE}.card`}>
        <Photo {...photo} aspect="4:3" corner="none" label={qr.vehicle.cover?.alt ?? undefined} testID={`${ROUTE}.photo`} />
        <View style={styles.cardText}>
          <Text variant="headline">{keepNameTogether(qr.vehicle.full_title)}</Text>
          <Text variant="callout" color="text.secondary" hyphenate={false} selectable testID={`${ROUTE}.url`}>
            {displayQrUrl(url)}
          </Text>
        </View>
      </View>
      {isBlockedByStaff(qr) ? (
        <QrNotice message={t('preview.blocked')} style={styles.notice} testID={`${ROUTE}.blocked`} />
      ) : null}
      <Text variant="body" color="text.secondary" style={styles.explain} testID={`${ROUTE}.explain`}>
        {t(explanationKey(qr))}
      </Text>
      <Button
        label={t('preview.open')}
        icon="arrow-right"
        role="link"
        href={isWeb ? guestUrl : undefined}
        size="l"
        fullWidth
        loading={opening}
        onPress={onPress}
        style={styles.open}
        testID={`${ROUTE}.open`}
      />
    </>
  );
}

/** QR-04: the real public page (WEB-01), opened in the system's in-app browser on native and as a link on web. */
export function QrPreviewScreen() {
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
    body = <PreviewSkeleton />;
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
  } else if (qaState === 'error' || !qr) {
    const offline = !online || query.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('preview.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    body = <PreviewBody qr={qr} />;
  }

  return (
    <QrPage
      routeId={ROUTE}
      title={t('preview.title')}
      subtitle={qr ? keepNameTogether(qr.vehicle.full_title) : undefined}
      subtitlePending={!qr && session !== 'guest' && (qaState === 'loading' || query.fetchStatus === 'fetching')}
      fallback="/profile/qr"
      offlineLabel={t('common.offlineBanner')}
    >
      {body}
    </QrPage>
  );
}
