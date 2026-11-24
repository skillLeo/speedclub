import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import {
  useMyStickers,
  useStickerDesign,
  useStickerOrderLink,
  useStickerSvg,
  useStickerTemplates,
  type StickerCard,
  type StickerDesign,
} from '@/api/queries/stickers';
import { formatNumber, keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, size, space, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { ListRow } from '@/ui/ListRow';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { photoFields } from '@/features/profile/media';

import { QrColumns, QrNotice, QrRowGroup, QrSignInState, QrState } from '../components/parts';
import { QrPage } from '../components/QrPage';
import { StickerArt } from '../components/StickerArt';
import { CardArt } from '../components/StickerHubCard';
import { StickerStage } from '../components/StickerStage';
import { mayOrder, scanGate } from '../designer/model';
import { openOrderUrl, prepareOrderTab } from '../stickerOrder';

const ROUTE = 'STK-06';
const STAGE_RATIO = 16 / 9;
/** Design-ID, Vorlage, Größe, Druckfarbe, Folie, Scan-Test. */
const SUMMARY_ROWS = 6;
/** The default design's proportion (Classic, 156 × 65 mm) while the design loads. */
const ART_RATIO = 156 / 65;

const useStyles = createStyles((t) => ({
  stage: {
    alignItems: 'center',
    aspectRatio: STAGE_RATIO,
    backgroundColor: t.color.media.ground,
    borderRadius: t.radius.md,
    justifyContent: 'center',
    padding: t.space[24],
  },
  stageBox: { aspectRatio: STAGE_RATIO, borderRadius: t.radius.md, padding: t.space[24] },
  rows: { marginTop: t.space[24] },
  action: { gap: t.space[12], marginTop: t.space[24] },
  // Beside the summary from 1280: level with the stage's top.
  actionBeside: { marginTop: t.space[0] },
  notReadyText: { gap: t.space[8], marginTop: t.space[24] },
  notReadyAction: { alignSelf: 'flex-start', marginTop: t.space[16] },
  besideStage: { marginTop: t.space[0] },
  note: { marginTop: t.space[12] },
}));

function OrderSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.stage}>
        <SkeletonBlock width="70%" aspectRatio={ART_RATIO} corner="sm" />
      </View>
      {/* DQ-M54R2-04: the six summary rows (Design-ID … Scan-Test), then the notice, the button and the shop sentence. */}
      <View style={styles.rows}>
        <SkeletonBlock height={size.row.single * SUMMARY_ROWS} corner="md" />
      </View>
      <View style={styles.action}>
        <SkeletonBlock height={size.touchMin} corner="sm" />
        <SkeletonBlock height={size.button.l} corner="sm" />
        <SkeletonText variant="callout" lines={2} />
      </View>
    </Skeleton>
  );
}

function OrderBody({
  design,
  vehicleId,
  suspended,
  notConfigured,
  cover,
}: {
  design: StickerDesign;
  vehicleId: string;
  suspended: boolean;
  /** The hub already knows the store is not set up (OA-44): say it before the tap. */
  notConfigured: boolean;
  cover?: StickerCard['vehicle']['cover'];
}) {
  const { kind } = useBreakpoint();
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  const theme = useTheme();
  const format = useFormat();
  const templates = useStickerTemplates();
  const svg = useStickerSvg(design.id, design.updated_at);
  const order = useStickerOrderLink(vehicleId);
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  const [width, setWidth] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const mm = (value: number) => formatNumber(value, format.locale);
  const templateName =
    templates.data?.templates.find((entry) => entry.key === design.template)?.name ??
    t(`designer.template.names.${design.template}`);
  const colourway =
    templates.data?.colourways.find((entry) => entry.key === design.options.colourway)?.name ??
    t(`designer.print.colourways.${design.options.colourway}.name`);
  const material =
    templates.data?.materials.find((entry) => entry.key === design.options.material)?.name ??
    t(`designer.print.materials.${design.options.material}`);
  const sizeText = `${t(`designer.size.${design.options.size}`)} · ${t('designer.size.mm', { width: mm(design.size_mm.width), height: mm(design.size_mm.height) })}`;

  const start = async () => {
    // A second tap before the first answer would open a second blank tab (review nit): one order request at a time.
    if (!design.id || busy.current) return;
    busy.current = true;
    setNotice(null);
    // Inside the tap: the web opens the tab now and fills it when the link is there.
    const pending = prepareOrderTab();
    key.current ??= newIdempotencyKey();
    try {
      const link = await order.mutateAsync({ designId: design.id, idempotencyKey: key.current });
      key.current = null;
      if (!link.available || !link.url) {
        pending?.cancel();
        setNotice({ text: link.message ?? t('order.soon'), tone: 'info' });
        return;
      }
      if (!(await openOrderUrl(link.url, pending, theme))) {
        toast(t('order.openFailed'), { testID: `${ROUTE}.openToast` });
      }
    } catch (error) {
      key.current = null;
      pending?.cancel();
      if (error instanceof ApiError && error.status === 409)
        setNotice({ text: t('order.stale'), tone: 'error' });
      else if (error instanceof ApiError && error.status === 403)
        setNotice({ text: t('order.forbidden'), tone: 'error' });
      else
        setNotice({
          text:
            error instanceof ApiError && error.kind === 'network' ? t('order.offline') : t('order.failed'),
          tone: 'error',
        });
    } finally {
      busy.current = false;
    }
  };

  const drawn =
    width > 0
      ? Math.min(
          width - 2 * space[24],
          ((width / STAGE_RATIO - 2 * space[24]) * design.size_mm.width) / design.size_mm.height,
        )
      : 0;

  return (
    <QrColumns
      main={
        <>
          <StickerStage
            cover={photoFields(cover ?? null, width || size.railCard * 2)}
            style={styles.stageBox}
            onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
            testID={`${ROUTE}.stage`}
          >
            {svg.data && drawn > 0 ? (
              <StickerArt
                svg={svg.data}
                width={drawn}
                widthMm={design.size_mm.width}
                heightMm={design.size_mm.height}
                label={t('order.artLabel', { template: templateName, size: sizeText })}
                testID={`${ROUTE}.art`}
              />
            ) : (
              <SkeletonBlock
                width="70%"
                aspectRatio={design.size_mm.width / design.size_mm.height}
                corner="sm"
              />
            )}
          </StickerStage>
          <QrRowGroup style={styles.rows} testID={`${ROUTE}.summary`}>
            <ListRow
              title={t('order.reference')}
              value={design.reference ?? ''}
              inset={space[16]}
              divider
              testID={`${ROUTE}.reference`}
            />
            <ListRow title={t('order.template')} value={templateName} inset={space[16]} divider />
            <ListRow
              title={t('order.size')}
              value={sizeText}
              adaptiveValue
              inset={space[16]}
              divider
              testID={`${ROUTE}.size`}
            />
            <ListRow title={t('order.print')} value={colourway} adaptiveValue inset={space[16]} divider />
            <ListRow
              title={t('order.material')}
              value={design.options.mirrored ? `${material} · ${t('order.mirrored')}` : material}
              adaptiveValue
              inset={space[16]}
              divider
            />
            <ListRow
              icon={design.scan_test === 'passed' ? 'check-circle' : 'info'}
              title={
                design.scan_test === 'passed' ? t('designer.scan.passed') : t('designer.scan.notApplicable')
              }
              inset={space[16]}
              testID={`${ROUTE}.scanTest`}
            />
          </QrRowGroup>
        </>
      }
      side={
        <View style={[styles.action, kind === 'desktop' ? styles.actionBeside : null]}>
          {notice ? (
            <QrNotice message={notice.text} tone={notice.tone} testID={`${ROUTE}.notice`} />
          ) : notConfigured ? (
            <QrNotice message={t('order.soon')} testID={`${ROUTE}.notice`} />
          ) : null}
          <Button
            label={t('order.cta')}
            icon="arrow-square-out"
            role="link"
            size="l"
            fullWidth
            loading={order.isPending}
            disabled={suspended || notConfigured}
            onPress={() => void start()}
            testID={`${ROUTE}.cta`}
          />
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.hint`}>
            {t('order.hint', { reference: design.reference ?? '' })}
          </Text>
          {notice?.tone === 'error' ? (
            <Button
              label={t('order.toDesigner')}
              variant="tertiary"
              size="m"
              flush="start"
              // The designer this page came from, never a second one on top of it (review MF-3).
              onPress={() =>
                router.dismissTo({ pathname: '/stickers/[vehicleId]/design', params: { vehicleId } })
              }
              testID={`${ROUTE}.toDesigner`}
            />
          ) : null}
        </View>
      }
    />
  );
}

/** The current drawing on its car for the "Erst der Scan-Test" state. */
function NotReadyStage({ card }: { card: StickerCard | undefined }) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  return (
    <StickerStage
      cover={photoFields(card?.vehicle.cover ?? null, width || size.railCard * 2)}
      style={styles.stageBox}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      testID={`${ROUTE}.notReady.stage`}
    >
      {card ? (
        <CardArt
          card={card}
          width={width}
          label={t('hub.artLabel', { vehicle: card.vehicle.full_title, design: t('hub.draft') })}
          testID={`${ROUTE}.notReady`}
        />
      ) : (
        <SkeletonBlock width="70%" aspectRatio={ART_RATIO} corner="sm" />
      )}
    </StickerStage>
  );
}

/** STK-06 Sticker bestellen (10 §2.3, ADR-502): the checked design, its id, and the way to the Shopify cart (never a checkout here). */
export function StickerOrderScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const { kind } = useBreakpoint();
  const router = useRouter();
  const { vehicleId: param } = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = typeof param === 'string' ? param : '';
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const me = useMe();
  const design = useStickerDesign(vehicleId);
  const cards = useMyStickers();
  const card = cards.data?.find((entry) => entry.vehicle.id === vehicleId);
  const title = card?.vehicle.full_title;
  const suspended = qaState === 'restricted' || me.data?.restrictions.suspended === true;
  const loaded = design.data && !design.isPlaceholderData ? design.data : undefined;
  const answered =
    design.error instanceof ApiError && (design.error.status === 403 || design.error.status === 404);

  let body: ReactNode;
  if (session === 'guest') {
    body = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!loaded &&
      (design.isPending || design.isFetching) &&
      design.fetchStatus !== 'paused' &&
      qaState === 'default')
  ) {
    body = <OrderSkeleton />;
  } else if (qaState === 'empty' || (!loaded && answered)) {
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
  } else if (qaState === 'error' || !loaded) {
    const offline = !online || design.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('order.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => void design.refetch()}
        retrying={design.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (!mayOrder(scanGate({ design: loaded, unsaved: false }))) {
    // Order needs a design that passed its Scan-Test (contract §7): first the designer. A suspended member cannot edit, so
    // the suspension notice takes the place of the way into the designer.
    // DQ-M54-15: the member's own drawing on its car, then one line and one way on (left-aligned), never the centred glyph pattern.
    body = (
      <View testID={`${ROUTE}.notReady`}>
        {suspended ? (
          <QrNotice
            message={t('order.suspended')}
            style={{ marginBottom: space[16] }}
            testID={`${ROUTE}.restricted`}
          />
        ) : null}
        {/* DQ-M54R2-05: from 1280 the stage takes 8 columns and the words with their action 4, so the action is in view. */}
        <QrColumns
          main={<NotReadyStage card={card} />}
          side={
            <>
              <View style={[styles.notReadyText, kind === 'desktop' ? styles.besideStage : null]}>
                <Text variant="title2" role="heading" aria-level={2} testID={`${ROUTE}.notReady.title`}>
                  {t('order.notReadyTitle')}
                </Text>
                <Text variant="body" color="text.secondary">
                  {t('order.notReadyBody')}
                </Text>
                {/* DQ-M54-23: a suspended member is not sent to a test they cannot start. */}
                {suspended ? null : (
                  <Text variant="callout" color="text.secondary">
                    {t('order.notReadyHint')}
                  </Text>
                )}
              </View>
              {suspended ? null : (
                <Button
                  label={t('designer.scan.run')}
                  size="l"
                  style={styles.notReadyAction}
                  onPress={() =>
                    router.dismissTo({
                      pathname: '/stickers/[vehicleId]/design',
                      params: { vehicleId, scan: '1' },
                    })
                  }
                  testID={`${ROUTE}.notReady.action`}
                />
              )}
            </>
          }
        />
      </View>
    );
  } else {
    body = (
      <>
        {suspended ? (
          <QrNotice
            message={t('order.suspended')}
            style={{ marginBottom: space[16] }}
            testID={`${ROUTE}.restricted`}
          />
        ) : null}
        <OrderBody
          design={loaded}
          vehicleId={vehicleId}
          suspended={suspended}
          notConfigured={card?.actions.order.reason === 'not_configured'}
          cover={card?.vehicle.cover}
        />
      </>
    );
  }

  return (
    <QrPage
      routeId={ROUTE}
      title={t('order.title')}
      subtitle={title ? keepNameTogether(title) : undefined}
      subtitlePending={!title && session !== 'guest' && cards.isPending}
      fallback="/stickers"
      offlineLabel={t('common.offlineBanner')}
    >
      {body}
    </QrPage>
  );
}
