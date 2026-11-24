import { forwardRef, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

import type { BuildScore } from '@/api/queries/buildScore';
import type { BuildUpdate, PublicVehicle } from '@/api/queries/vehicles';
import { photoFields, visiblePhotos } from '@/features/vehicle/media';
import { updatePairs, type PhotoPair } from '@/features/updates/model';
import { haptics } from '@/lib/haptics';
import { useFormat } from '@/lib/useFormat';
import { createStyles, fontScaleCap, layout, size, space, ThemeScope, typography, typographyDesktop, useTheme } from '@/theme';
import { BeforeAfterPair } from '@/ui/BeforeAfterPair';
import { AppWordmark } from '@/features/auth/AppWordmark';
// R6-3/R7-1: the page's gauge size (144; half the card before round 6), so the photo keeps most of the card and the gauge stays a companion.
import { BuildScoreGauge, GAUGE_BOX } from '@/ui/BuildScoreGauge';
import { Button } from '@/ui/Button';
import { DisplayTitle } from '@/ui/DisplayTitle';
import { Photo } from '@/ui/Photo';
import { Sheet } from '@/ui/Sheet';
import { Text, useDesktopType } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { useSafeInset } from '@/ui/safeArea';
import { GAUGE_MAX } from '@/ui/buildScoreGaugeMath';

import { canCaptureJourney, downloadJourneyCard, shareJourneyCard } from '../journeyShare';
import { updateKindOf } from '../model';

/**
 * ADR-518 b: the card is a fixed composition, laid out at one design width and scaled as a whole by its preview, so a narrow sheet
 * never reflows its words. 400 (five eighths of the feed column) is the widest the sheet ever showed it: the server's story PNG is
 * exactly 2.7 times it (1080 × 1920), and at the capped type (1.3) the name keeps whole words on at most three lines, "8 Einträge im
 * Verlauf" fits beside the gauge and the photo keeps about a third of the card.
 */
export const JOURNEY_CARD_WIDTH = (layout.feedColumn * 5) / 8;
const STORY_RATIO = 9 / 16;
export const JOURNEY_CARD_HEIGHT = JOURNEY_CARD_WIDTH / STORY_RATIO;
/** ADR-518 a: a story card's type grows with the system font only up to the cap of a label in a fixed frame (as WRP-01's CardFrame). */
export const JOURNEY_CARD_FONT_SCALE_CAP = fontScaleCap.pill;
const PAIR_PHOTO_WIDTH = layout.feedColumn / 2;
const INNER_WIDTH = JOURNEY_CARD_WIDTH - 2 * space[20];
const WORDMARK_WIDTH = Math.round(JOURNEY_CARD_WIDTH * 0.36);
/** ADR-518 c: the DOM audit reads the card's type against the story-card cap (web only; native ignores dataSet). */
const STORY_CARD = { qaExempt: 'story-card' } as const;

const useStyles = createStyles((t) => ({
  // The dark stage in every theme (ADR-421 b): the card is a photo object, its text in the on-photo tones.
  card: {
    backgroundColor: t.color.scrim.photoEnd,
    borderRadius: t.radius.xl,
    gap: t.space[12],
    height: JOURNEY_CARD_HEIGHT,
    overflow: 'hidden',
    padding: t.space[20],
    width: JOURNEY_CARD_WIDTH,
  },
  // The photo takes what the card leaves after the fixed parts and is cropped to it; concentric inside the card's 20 radius and
  // 20 padding: the floor of 4 (09 §4.3).
  media: { borderRadius: t.radius.xs, flex: 1, justifyContent: 'center', minHeight: 0, overflow: 'hidden' },
  bottom: { alignItems: 'center', columnGap: t.space[16], flexDirection: 'row' },
  bottomText: { flex: 1, gap: t.space[4], minWidth: 0 },
  body: { gap: t.space[16], paddingBottom: t.space[16] },
  footer: { gap: t.space[8] },
  // The preview box clips at the card's own radius, so the scaled card keeps the 20 corner of a sheet's media (09 §4.3).
  preview: { alignSelf: 'center', borderRadius: t.radius.xl, overflow: 'hidden' },
  scaled: { left: 0, position: 'absolute', top: 0, transformOrigin: 'top left' },
}));

/**
 * DQ-P5G-23 (round 2): the preview's width so the whole 9:16 card stands above the sticky footer at every font scale, as VEH-07
 * scales its card. The room is the sheet's panel (`size.sheetMaxHeightRatio` of the window, rounded as Sheet rounds it) less what
 * Sheet draws around the body, each as Sheet lays it out: the header (8 above the grabber, whose 44 target is an absolute hit area
 * and takes only its 4 in the layout, 12, the title's line, 8), the body's hint, its 16 gap and 16 bottom padding, and the footer
 * panel (12 above the buttons, the buttons as measured, the safe area plus 12 below). No floor: a preview that does not fit is
 * smaller, never under the footer (the card is a scaled picture and keeps its words, ADR-518 b).
 */
export function journeyCardWidth(o: {
  column: number;
  windowHeight: number;
  titleLine: number;
  hint: number;
  /** The footer's content (the buttons) as measured, without the Sheet footer's own padding. */
  footer: number;
  safeBottom: number;
}): number {
  const header = space[8] + size.grabber.height + space[12] + o.titleLine + space[8];
  const body = o.hint + space[16] + space[16];
  const footer = space[12] + o.footer + o.safeBottom + space[12];
  const room = Math.round(o.windowHeight * size.sheetMaxHeightRatio) - header - body - footer;
  const fit = Math.floor(room * STORY_RATIO);
  return Math.max(0, Math.min(o.column, JOURNEY_CARD_WIDTH, fit));
}

/**
 * Whether a footer button's label stands on one line beside its 20 icon in a button `width` wide (body.strong at `fontScale`; an
 * upper bound of Inter SemiBold's advance per character). A label that would wrap takes its short form instead (DQ-P5G-23): a
 * wrapped label stacks the icon over two lines and the footer then took 30 % of the screen at 200 %.
 */
const LABEL_ADVANCE_EM = 0.62;
export function footerLabelFits(label: string, width: number, fontScale: number): boolean {
  const text = [...label].length * typography.bodyStrong.fontSize * fontScale * LABEL_ADVANCE_EM;
  return text + size.icon.m + space[8] + 2 * size.buttonPaddingX.l <= width;
}

/** The factor that shows the card at the preview's width (never enlarged past its design size). */
export function journeyPreviewScale(previewWidth: number): number {
  return Math.max(0, Math.min(1, previewWidth / JOURNEY_CARD_WIDTH));
}

/** The newest before/after of the build, the before/after posts first, then any pair of a post. */
export function latestPair(updates: readonly BuildUpdate[]): { update: BuildUpdate; pair: PhotoPair } | null {
  const sorted = [...updates].sort((a, b) => Number(updateKindOf(b) === 'before_after') - Number(updateKindOf(a) === 'before_after'));
  for (const update of sorted) {
    const pair = updatePairs(update)[0];
    if (pair) return { update, pair };
  }
  return null;
}

export type JourneyCardProps = { vehicle: PublicVehicle; score: BuildScore; testID?: string };

/**
 * M5.9c Journey card (contract §5): 9:16 on the dark stage — the wordmark, the newest before/after (or the cover), the name in
 * `display.title`, the gauge at rest (no motion: it is an image to share) and the number of Verlauf entries. Plates are already
 * pixelated in the stored photos (ADR-509). Always laid out at `JOURNEY_CARD_WIDTH` with its type capped at 1.3 (ADR-518): the root
 * is the view-shot target, so the phone shares the card at its design size whatever the preview's scale.
 */
export const JourneyCard = forwardRef<ComponentRef<typeof View>, JourneyCardProps>(function JourneyCard(props, ref) {
  const theme = useTheme();
  return (
    <ThemeScope name={theme.name} fontScaleCap={JOURNEY_CARD_FONT_SCALE_CAP}>
      <CardBody ref={ref} {...props} />
    </ThemeScope>
  );
});

const CardBody = forwardRef<ComponentRef<typeof View>, JourneyCardProps>(function CardBody({ vehicle, score, testID }, ref) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const latest = latestPair(vehicle.updates);
  const cover = visiblePhotos(vehicle.photos)[0];
  const mod = latest && updateKindOf(latest.update) === 'before_after' ? latest.update.modifications[0]?.title : undefined;
  const value = format.number(score.total);
  return (
    <View ref={ref} collapsable={false} dataSet={STORY_CARD} style={styles.card} testID={testID}>
      <AppWordmark width={WORDMARK_WIDTH} tone="white" decorative />
      <View style={styles.media}>
        {latest ? (
          <BeforeAfterPair
            before={{ ...photoFields(latest.pair.before, PAIR_PHOTO_WIDTH), label: t('update.before') }}
            after={{ ...photoFields(latest.pair.after, PAIR_PHOTO_WIDTH), label: t('update.after') }}
            caption={mod ? t('score.pairCaption', { mod }) : undefined}
            captionColor="onPhoto.secondary"
            corner="xs"
            label={t('update.beforeAfter')}
            testID={testID ? `${testID}.pair` : undefined}
          />
        ) : cover ? (
          <Photo {...photoFields(cover, PAIR_PHOTO_WIDTH * 2)} aspect="4:5" corner="none" testID={testID ? `${testID}.cover` : undefined} />
        ) : null}
      </View>
      <DisplayTitle placement="card" layoutWidth={INNER_WIDTH} color="onPhoto.primary" testID={testID ? `${testID}.title` : undefined}>
        {vehicle.full_title}
      </DisplayTitle>
      <View style={styles.bottom}>
        <BuildScoreGauge
          total={score.total}
          valueText={value}
          scaleText={t('score.scale', { max: format.number(GAUGE_MAX) })}
          stageText={t('score.stage', { stage: score.stage })}
          accessibilityLabel={t('score.a11y', { value, max: format.number(GAUGE_MAX), stage: score.stage })}
          box={GAUGE_BOX}
          tone="onPhoto"
          desktopSize={false}
          testID={testID ? `${testID}.gauge` : undefined}
        />
        <View style={styles.bottomText}>
          <Text variant="labelCaps" color="onPhoto.secondary" hyphenate={false} desktopSize={false}>
            {t('score.title')}
          </Text>
          {vehicle.updates_count > 0 ? (
            <Text variant="caption" color="onPhoto.secondary" numeric desktopSize={false}>
              {t('score.journey.updates', { count: vehicle.updates_count })}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/**
 * ADR-518 b: the card at its design width, scaled as one picture to the preview's width (transform from the top-left corner, so
 * layout and view-shot keep the design size). One image to assistive technology: the label names it, the card's words are its
 * pixels.
 */
export function JourneyPreview({ width, label, children, testID }: { width: number; label: string; children: ReactNode; testID?: string }) {
  const styles = useStyles();
  const scale = journeyPreviewScale(width);
  return (
    <View role="img" aria-label={label} style={[styles.preview, { width, height: width / STORY_RATIO }]} testID={testID}>
      <View style={[styles.scaled, { transform: [{ scale }] }]} testID={testID ? `${testID}.scaled` : undefined}>
        {children}
      </View>
    </View>
  );
}

export type JourneySheetProps = {
  visible: boolean;
  onClose: () => void;
  vehicle: PublicVehicle;
  score: BuildScore;
  routeId: string;
};

/**
 * "Journey teilen": the card in a sheet. The phone shares the card it shows (view-shot → share sheet); the member web offers the
 * server's card as a story or a square download (no on-device drawing on the web, spike §4).
 */
export function JourneySheet({ visible, onClose, vehicle, score, routeId }: JourneySheetProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const card = useRef<ComponentRef<typeof View>>(null);
  const { height: windowHeight } = useWindowDimensions();
  const { fontScale } = useTheme();
  const desktop = useDesktopType();
  const safeBottom = useSafeInset('bottom');
  const [width, setWidth] = useState(0);
  const [hint, setHint] = useState(0);
  const [footer, setFooter] = useState(0);
  const [busy, setBusy] = useState<'share' | 'story' | 'square' | null>(null);
  const id = `${routeId}.score.journeySheet`;
  // The sheet's title on the web desktop takes the desktop role (26/32), everywhere else the mobile one (22/28).
  const titleLine = (desktop ? typographyDesktop.title2.lineHeight : typography.title2.lineHeight) * fontScale;
  const cardWidth = width > 0 && footer > 0 ? journeyCardWidth({ column: width, windowHeight, titleLine, hint, footer, safeBottom }) : 0;
  // DQ-P5G-23: each footer button keeps its icon inline and its label on one line; where the full words would wrap, the short form
  // ("Story", "Quadrat") is the visible label and the full words stay its accessible name.
  const short = width > 0 && !(footerLabelFits(t('score.journey.story'), width, fontScale) && footerLabelFits(t('score.journey.square'), width, fontScale));

  const run = async (kind: 'share' | 'story' | 'square') => {
    setBusy(kind);
    try {
      const outcome = kind === 'share' ? await shareJourneyCard(card, vehicle.full_title) : await downloadJourneyCard(vehicle.id, kind);
      if (outcome === 'failed') {
        haptics.error();
        toast(t('score.journey.failed'), { testID: `${id}.toast` });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('score.journey.title')}
      testID={id}
      footer={
        <View style={styles.footer} onLayout={(event) => setFooter(event.nativeEvent.layout.height)}>
          {canCaptureJourney ? (
            <Button label={t('score.journey.shareAction')} icon="share-network" size="l" fullWidth loading={busy === 'share'} disabled={busy !== null} onPress={() => void run('share')} testID={`${id}.share`} />
          ) : (
            <>
              <Button
                label={short ? t('score.journey.storyShort') : t('score.journey.story')}
                accessibilityLabel={t('score.journey.story')}
                icon="download-simple"
                size="l"
                fullWidth
                loading={busy === 'story'}
                disabled={busy !== null}
                onPress={() => void run('story')}
                testID={`${id}.story`}
              />
              <Button
                label={short ? t('score.journey.squareShort') : t('score.journey.square')}
                accessibilityLabel={t('score.journey.square')}
                icon="download-simple"
                variant="secondary"
                size="l"
                fullWidth
                loading={busy === 'square'}
                disabled={busy !== null}
                onPress={() => void run('square')}
                testID={`${id}.square`}
              />
            </>
          )}
        </View>
      }
    >
      <View style={styles.body} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <Text variant="callout" color="text.secondary" onLayout={(event) => setHint(event.nativeEvent.layout.height)}>
          {vehicle.is_owner ? t('score.journey.hint') : t('score.journey.hintVisitor')}
        </Text>
        {cardWidth > 0 ? (
          <JourneyPreview width={cardWidth} label={t('score.journey.previewLabel', { vehicle: vehicle.full_title })} testID={`${id}.preview`}>
            <JourneyCard ref={card} vehicle={vehicle} score={score} testID={`${id}.card`} />
          </JourneyPreview>
        ) : null}
      </View>
    </Sheet>
  );
}
