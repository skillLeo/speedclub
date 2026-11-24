import { memo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useStickerDefaultPreview, useStickerSvg, type StickerCard } from '@/api/queries/stickers';
import { formatNumber, keepNameTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, space } from '@/theme';
import { photoFields } from '@/features/profile/media';
import { SampleBadge } from '@/ui/Badge';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/icons/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { StatusPill } from '@/ui/StatusPill';
import { Text } from '@/ui/Text';

import { StickerArt } from './StickerArt';
import { StickerStage } from './StickerStage';

/** The vinyl stage: the sticker on dark film, 16:9 (09 §5 inset media). */
export const STAGE_RATIO = 16 / 9;
/** The default design's proportion (Classic, 156 × 65 mm) while its drawing loads. */
const ART_RATIO = 156 / 65;

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, marginBottom: t.space[16], overflow: 'hidden' },
  stage: {
    alignItems: 'center',
    aspectRatio: STAGE_RATIO,
    backgroundColor: t.color.media.ground,
    justifyContent: 'center',
    padding: t.space[24],
    width: '100%',
  },
  stageBox: { aspectRatio: STAGE_RATIO, padding: t.space[24], width: '100%' },
  body: { gap: t.space[12], padding: t.space[16] },
  identity: { gap: t.space[4] },
  row: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  // The row is the link to STK-04: at least 44 high (touch target), the numeral and its line on one baseline inside.
  scans: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', minHeight: t.size.touchMin },
  scansText: { alignItems: 'flex-end', columnGap: t.space[8], flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  actions: { columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[8] },
  skeletonActions: { flexDirection: 'row', gap: t.space[8] },
  tertiary: { alignSelf: 'flex-start' },
  sample: { alignItems: 'center', gap: t.space[12], justifyContent: 'center' },
  sampleBadge: { position: 'absolute', right: t.space[12], top: t.space[12] },
  sampleSticker: {
    alignItems: 'flex-start',
    borderColor: t.color.onPhoto.border,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    gap: t.space[8],
    paddingHorizontal: t.space[20],
    paddingVertical: t.space[16],
  },
}));

/** The live drawing of a card: the saved version's preview, or the default the designer starts from (also STK-02's hero). */
export function CardArt({ card, width, label, testID }: { card: StickerCard; width: number; label: string; testID: string }) {
  const design = card.design;
  const saved = useStickerSvg(design?.id ?? null, design?.updated_at ?? null);
  const fallback = useStickerDefaultPreview(card.vehicle.id, !design?.id && card.sticker.status !== 'revoked');
  const svg = design?.id ? saved.data : fallback.data?.svg;
  const mm = design?.id ? design.size_mm : fallback.data?.size_mm;
  if (!svg || !mm || width <= 0) {
    return <SkeletonBlock width="70%" aspectRatio={ART_RATIO} corner="sm" testID={`${testID}.artSkeleton`} />;
  }
  // As large as the stage allows: banners by width, the JDM column by height.
  const stageHeight = width / STAGE_RATIO - 2 * space[24];
  const room = width - 2 * space[24];
  const drawn = Math.min(room, (stageHeight * mm.width) / mm.height);
  return <StickerArt svg={svg} width={drawn} widthMm={mm.width} heightMm={mm.height} label={label} testID={`${testID}.art`} />;
}

export type StickerHubCardProps = {
  card: StickerCard;
  columnStyle: StyleProp<ViewStyle>;
  onOpen: (vehicleId: string) => void;
  onDesign: (vehicleId: string) => void;
  onOrder: (card: StickerCard) => void;
  onDownload: (card: StickerCard) => void;
  onStats: (vehicleId: string) => void;
  suspended: boolean;
  routeId: string;
};

/**
 * STK-01's card (10 §2.2): the live sticker on a dark vinyl stage, the car, status aktiv/gesperrt, scans this week (tnum), and the
 * three actions Gestalten · Bestellen · Herunterladen. What an action cannot do yet is said under them, never a dead button alone.
 */
export const StickerHubCard = memo(function StickerHubCard({
  card,
  columnStyle,
  onOpen,
  onDesign,
  onOrder,
  onDownload,
  onStats,
  suspended,
  routeId,
}: StickerHubCardProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const format = useFormat();
  const [stageWidth, setStageWidth] = useState(0);
  const id = card.vehicle.id;
  const testID = `${routeId}.card.${id}`;
  const status = card.sticker.status;
  const design = card.design;
  const order = card.actions.order;
  const name = keepNameTogether(card.vehicle.full_title);
  const templateName = design ? t(`designer.template.names.${design.template}`) : null;
  const designLine = design
    ? [
        templateName,
        t(`designer.size.${design.options.size}`),
        t('designer.size.mm', {
          width: formatNumber(design.size_mm.width, format.locale),
          height: formatNumber(design.size_mm.height, format.locale),
        }),
        design.state === 'validated' ? t(design.scan_test === 'not_applicable' ? 'hub.noScanNeeded' : 'hub.scanPassed') : t('hub.draft'),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('hub.notDesigned');
  const orderNote =
    order.reason === 'not_configured'
      ? t('hub.orderSoon')
      : !card.actions.download && status === 'active'
        ? t('hub.afterScanTest')
        : null;

  const onStageLayout = (event: LayoutChangeEvent) => setStageWidth(event.nativeEvent.layout.width);

  return (
    <View style={columnStyle}>
      <View style={styles.card} testID={testID}>
        <PressableScale
          role="link"
          aria-label={t('hub.openCard', { vehicle: card.vehicle.full_title })}
          onPress={() => onOpen(id)}
          testID={`${testID}.open`}
        >
          <StickerStage cover={photoFields(card.vehicle.cover, stageWidth || size.railCard * 2)} style={styles.stageBox} onLayout={onStageLayout}>
            {status === 'revoked' ? (
              <Text variant="callout" color="onPhoto.secondary" testID={`${testID}.blocked`}>
                {t('hub.blockedStage')}
              </Text>
            ) : (
              <CardArt card={card} width={stageWidth} label={t('hub.artLabel', { vehicle: card.vehicle.full_title, design: designLine })} testID={testID} />
            )}
          </StickerStage>
        </PressableScale>
        <View style={styles.body}>
          <View style={styles.identity}>
            <Text variant="displayWordmark" role="heading" aria-level={2} testID={`${testID}.name`}>
              {name}
            </Text>
            <View style={styles.row}>
              <StatusPill label={t(`hub.status.${status}`)} testID={`${testID}.status`} />
              <Text variant="callout" color="text.secondary" testID={`${testID}.designLine`}>
                {designLine}
              </Text>
            </View>
          </View>
          <PressableScale
            role="link"
            // The visible text leads the name (WCAG 2.5.3): "Noch keine Scans diese Woche" when there are none.
            aria-label={card.scans_this_week > 0 ? t('hub.scansLabel', { count: card.scans_this_week }) : t('hub.scansLabelNone')}
            onPress={() => onStats(id)}
            testID={`${testID}.scans`}
          >
            <View style={styles.scans}>
              {/* DQ-M54-08: a count is a hero only when there is one; no week starts with a big zero. */}
              <View style={styles.scansText}>
                {card.scans_this_week > 0 ? (
                  <>
                    <Text variant="heroNumeralS" numeric testID={`${testID}.scansCount`}>
                      {formatNumber(card.scans_this_week, format.locale)}
                    </Text>
                    <Text variant="callout" color="text.secondary">
                      {t('hub.scansThisWeek', { count: card.scans_this_week })}
                    </Text>
                  </>
                ) : (
                  <Text variant="callout" color="text.secondary" testID={`${testID}.scansNone`}>
                    {t('hub.noScansThisWeek')}
                  </Text>
                )}
              </View>
              <Icon name="caret-right" size={16} color="text.tertiary" />
            </View>
          </PressableScale>
          <View style={styles.actions}>
            <Button
              label={t('hub.design')}
              icon="pencil-simple"
              variant="secondary"
              size="m"
              disabled={!card.actions.design || suspended || status !== 'active'}
              onPress={() => onDesign(id)}
              testID={`${testID}.design`}
            />
            {/* DQ-M54R2-15: before a design passed its Scan-Test the button says what it does: it opens the test. */}
            <Button
              label={card.actions.download ? t('hub.order') : t('hub.scanTest')}
              icon={card.actions.download ? 'bag' : 'qr-code'}
              variant="secondary"
              size="m"
              disabled={order.reason === 'not_configured' || status !== 'active'}
              onPress={() => onOrder(card)}
              testID={`${testID}.order`}
            />
          </View>
          {/* DQ-M54-21: the tertiary action on its own line, its label on the text gutter. */}
          <Button
            label={t('hub.download')}
            icon="download-simple"
            variant="tertiary"
            size="m"
            flush="start"
            style={styles.tertiary}
            disabled={!card.actions.download}
            onPress={() => onDownload(card)}
            testID={`${testID}.download`}
          />
          {orderNote ? (
            <Text variant="caption" color="text.secondary" testID={`${testID}.note`}>
              {orderNote}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/** The card's loading geometry. */
export function StickerHubCardSkeleton({ columnStyle }: { columnStyle: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={columnStyle}>
      <View style={styles.card}>
        <View style={styles.stage}>
          <SkeletonBlock width="70%" aspectRatio={ART_RATIO} corner="sm" />
        </View>
        {/* DQ-M54-09: the card body line by line, so nothing moves when the data lands. */}
        <View style={styles.body}>
          <View style={styles.identity}>
            <SkeletonText variant="displayWordmark" width="60%" />
            <SkeletonText variant="callout" width="45%" />
          </View>
          <View style={styles.scans}>
            <SkeletonText variant="callout" width="55%" />
          </View>
          <View style={styles.skeletonActions}>
            <SkeletonBlock width="32%" height={size.button.m} corner="sm" />
            <SkeletonBlock width="32%" height={size.button.m} corner="sm" />
          </View>
          <SkeletonBlock width="38%" height={size.button.m} corner="sm" />
          <SkeletonText variant="caption" lines={2} />
        </View>
      </View>
    </View>
  );
}

/**
 * The empty hub's preview (SKILL "Never empty"): a sticker as it could look, drawn from the bundled logo and a sample name, without a
 * code (a sample never carries a scannable code), badged "Beispiel".
 */
export function SampleStickerPreview({ testID }: { testID: string }): ReactNode {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  return (
    <View style={[styles.stage, styles.sample]} role="img" aria-label={t('hub.sampleLabel')} testID={testID}>
      <View style={styles.sampleSticker}>
        <AppWordmark width={space[96] + space[64]} tone="white" decorative />
        <Text variant="displayWordmark" color="onPhoto.primary">
          {t('hub.sampleName')}
        </Text>
      </View>
      <SampleBadge tone="onPhoto" style={styles.sampleBadge} />
    </View>
  );
}
