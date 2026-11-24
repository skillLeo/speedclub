import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { useBuildScore, type BuildScore, type BuildScoreRank } from '@/api/queries/buildScore';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, space, typography, typographyDesktop, useBreakpoint, useTheme } from '@/theme';
import { BuildScoreGauge, BuildScoreGaugeTrack, GAUGE_BOX, GAUGE_TEXT_CAP, gaugeLayout, gaugeTextScale, ScoreDelta } from '@/ui/BuildScoreGauge';
import { Button } from '@/ui/Button';
import { ListRow } from '@/ui/ListRow';
import { SectionHeader } from '@/ui/SectionHeader';
import { Skeleton, SkeletonText } from '@/ui/Skeleton';
import { Text, useDesktopType } from '@/ui/Text';
import { RowGroup } from '@/ui/RowGroup';
import { GAUGE_MAX, scoreDelta } from '@/ui/buildScoreGaugeMath';
import { useOdometerOnce } from '@/ui/motion/OdometerNumber';

import { rankLines, UPGRADE_ITEMS, upgradeHref, upgradeItems, type UpgradeItem } from '../model';
import '../qaScore';
import { FormulaSheet } from './FormulaSheet';
import { JourneySheet } from './JourneyCard';

/**
 * Client round 6 (R6-3): the gauge at `GAUGE_BOX` (120) beside the stage, not as a hero block. It grows with the text up to the
 * numerals' cap (1.3), never past the column; the web desktop × 48/40 (hero.numeral.s there) = 144, in the side card.
 */
export { GAUGE_BOX };
/** From this font scale the details sit start-aligned under the gauge (R4DQ-10): beside it they would wrap word by word. */
export const START_ALIGNED_FONT_SCALE = 1.3;
/** The details beside the gauge need at least a rail card's width (160), or they go under it. */
const DETAILS_MIN = size.railCard;

/** How the stage, the ranks and "So entsteht …" sit: beside the gauge, centred under it, or start-aligned under it at a large font. */
export function detailsLayout(wide: boolean, fontScale: number): 'beside' | 'centred' | 'start' {
  if (fontScale > START_ALIGNED_FONT_SCALE) return 'start';
  return wide ? 'beside' : 'centred';
}

/** Whether a column has room for the details beside a gauge of `box`. */
export function besideFits(column: number, box: number): boolean {
  return column >= box + space[16] + DETAILS_MIN;
}

const useStyles = createStyles((t) => ({
  root: { gap: t.space[16] },
  // R6-3: the gauge inline with its stage and ranks; the actions in their own row under both.
  row: { alignItems: 'center', columnGap: t.space[16], flexDirection: 'row' },
  stacked: { gap: t.space[12] },
  stackedCentred: { alignItems: 'center' },
  gaugeStart: { alignSelf: 'flex-start' },
  details: { flex: 1, gap: t.space[4], minWidth: 0 },
  detailsNarrow: { alignItems: 'center' },
  stageLine: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  stageLineCentred: { justifyContent: 'center' },
  ranks: { gap: t.space[4] },
  rankNarrow: { textAlign: 'center' },
  actions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[12] },
  actionsNarrow: { justifyContent: 'center' },
  next: { gap: t.space[8], marginTop: t.space[8] },
  nextAlone: { gap: t.space[8] },
  quiet: { alignItems: 'center', gap: t.space[4] },
  // DQ-P5G-21: the inline error on the section's start edge: what failed, why, and the retry.
  error: { alignItems: 'flex-start', gap: t.space[8] },
  // DQ-P5G-22: with `next`'s 8 the section gap of 32 (09 §4.3) between the gauge block and "Nächstes Upgrade".
  gaugeBlock: { paddingBottom: t.space[24] },
  centred: { textAlign: 'center' },
  // DQ-P5G-15: under the centred gauge the way to the formula is centred too, as in the narrow ready state.
  centredAction: { alignSelf: 'center' },
}));

/** The web desktop sets hero.numeral.s larger (09 §4.2: 48 instead of 40); the gauge grows by the same ratio, so the numeral keeps its room. */
const DESKTOP_GROWTH = typographyDesktop.heroNumeralS.fontSize / typography.heroNumeralS.fontSize;

/**
 * The gauge's box for a column: 120 (144 on the web desktop), grown with the font scale up to the numerals' cap, so the numeral
 * keeps inside the needle's inner circle; never past the column.
 */
export function gaugeBoxFor(width: number, fontScale: number, desktop: boolean = false): number {
  const grown = GAUGE_BOX * Math.min(GAUGE_TEXT_CAP, Math.max(1, fontScale)) * (desktop ? DESKTOP_GROWTH : 1);
  return Math.floor(Math.max(0, Math.min(width, grown)));
}

/** The gauge's box and laid-out height for a column, as the ready section draws it (the skeleton and the quiet states use it too). */
function useGaugeFrame(column: number): { box: number; height: number; layout: 'beside' | 'centred' | 'start' } {
  const { fontScale, fontScaleCap } = useTheme();
  const { kind } = useBreakpoint();
  const desktopType = useDesktopType();
  const box = gaugeBoxFor(column, fontScale, isWeb && kind === 'desktop');
  // Three digits: the height of nearly every score (a grouped "1.000" sets a smaller numeral, never a taller box).
  const { height } = gaugeLayout(box, { valueText: '000', scale: gaugeTextScale(fontScale, fontScaleCap), desktop: desktopType, stage: false });
  return { box, height, layout: detailsLayout(besideFits(column, box), fontScale) };
}

export type BuildScoreSectionProps = {
  vehicle: PublicVehicle;
  /** `VEH-01` or GAR-02's: the section's ids are `<routeId>.score.*`. */
  routeId: string;
  /**
   * R6-3: `all` (phones and tablets: the section in Überblick); on the web desktop `score` is the gauge block in the right-hand side
   * card and `next` the owner's "Nächstes Upgrade" left in Überblick.
   */
  part?: 'all' | 'score' | 'next';
  /** The column's width before the section's own layout (the side card's inner width), so the first frame has its final layout. */
  layoutWidth?: number;
  /** The gap to its neighbours, which the section brings itself (nothing renders when there is no score to show). */
  style?: StyleProp<ViewStyle>;
};

/**
 * M5.9c ★ VEH-01 Übersicht (and GAR-02, which shares the layout): the Build Score as a self-contained section — the gauge, the
 * rank lines the API returns ("#4 von 61 R34 in Deutschland", "#2 in NRW"), "So entsteht dein Build Score" (the formula sheet) and,
 * for the owner, "Nächstes Upgrade" (helpful, optional, most points first, each item opening its editor) and "Journey teilen". Its own
 * states: loading (the gauge's geometry), "wird berechnet", error with retry, offline. M5.3 moves the whole block into the one-scroll
 * layout as it is.
 */
export function BuildScoreSection({ vehicle, routeId, part = 'all', layoutWidth, style }: BuildScoreSectionProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const dimensions = useWindowDimensions();
  const online = useOnline();
  const owner = vehicle.is_owner;
  const query = useBuildScore(vehicle.id, { owner });
  const [width, setWidth] = useState<number | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const id = `${routeId}.score`;
  const column = width ?? layoutWidth ?? dimensions.width - 2 * gutter;
  const frame = useGaugeFrame(column);
  const { box } = frame;

  // No score for this vehicle and viewer (or a server without the feature): no section, no empty frame.
  if (query.data?.status === 'unavailable') return null;

  // The desktop's Überblick keeps only the owner's checklist (the gauge is in the side card): nothing until the score is there.
  if (part === 'next') {
    if (query.data?.status !== 'ready' || !owner) return null;
    return (
      <View style={[styles.nextAlone, style]}>
        <NextUpgrades items={upgradeItems(query.data.score.next_upgrades)} vehicleId={vehicle.id} routeId={routeId} alone />
      </View>
    );
  }

  let body;
  if (query.data?.status === 'ready') {
    const score = query.data.score;
    body = (
      <ScoreBody
        vehicle={vehicle}
        score={score}
        box={box}
        layout={frame.layout}
        next={part === 'all'}
        routeId={routeId}
        onFormula={() => setFormulaOpen(true)}
        onJourney={() => setJourneyOpen(true)}
      />
    );
  } else if (query.data?.status === 'pending') {
    body = (
      <View style={styles.quiet} testID={`${id}.pending`}>
        <BuildScoreGaugeTrack box={box} height={frame.height} />
        <Text variant="bodyStrong" style={styles.centred}>
          {owner ? t('score.pendingOwner') : t('score.pending')}
        </Text>
        <Text variant="callout" color="text.secondary" style={styles.centred}>
          {t('score.pendingBody')}
        </Text>
        <Button label={owner ? t('score.how') : t('score.howVisitor')} variant="tertiary" size="s" style={styles.centredAction} onPress={() => setFormulaOpen(true)} testID={`${id}.how`} />
      </View>
    );
  } else if (query.isError) {
    body = (
      <View style={styles.error} role="alert" testID={`${id}.error`}>
        <Text variant="bodyStrong">{t('score.errorTitle')}</Text>
        <Text variant="callout" color="text.secondary" testID={`${id}.error.cause`}>
          {t('score.errorBody')}
        </Text>
        <Button label={t('score.retry')} variant="secondary" size="m" loading={query.isFetching} onPress={() => void query.refetch()} testID={`${id}.retry`} />
      </View>
    );
  } else if (!online || query.fetchStatus === 'paused') {
    body = (
      <View style={styles.quiet} testID={`${id}.offline`}>
        <BuildScoreGaugeTrack box={box} height={frame.height} />
        <Text variant="callout" color="text.secondary" style={styles.centred}>
          {t('score.offline')}
        </Text>
      </View>
    );
  } else {
    body = <BuildScoreSkeletonBody frame={frame} testID={`${id}.skeleton`} />;
  }

  return (
    <View style={[styles.root, style]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} testID={id}>
      <SectionHeader title={t('score.title')} testID={`${id}.header`} />
      {body}
      <FormulaSheet visible={formulaOpen} onClose={() => setFormulaOpen(false)} owner={owner} routeId={routeId} />
      {query.data?.status === 'ready' && owner ? (
        <JourneySheet visible={journeyOpen} onClose={() => setJourneyOpen(false)} vehicle={vehicle} score={query.data.score} routeId={routeId} />
      ) : null}
    </View>
  );
}

type ScoreBodyProps = {
  vehicle: PublicVehicle;
  score: BuildScore;
  box: number;
  layout: 'beside' | 'centred' | 'start';
  /** "Nächstes Upgrade" under the gauge block (the owner's, not in the desktop's side card). */
  next: boolean;
  routeId: string;
  onFormula: () => void;
  onJourney: () => void;
};

function ScoreBody({ vehicle, score, box, layout, next, routeId, onFormula, onJourney }: ScoreBodyProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  // SM6: the needle sweeps and the digits roll once per vehicle per session; afterwards the gauge stands at its value.
  const first = useOdometerOnce(`build-score:${vehicle.id}`);
  const id = `${routeId}.score`;
  const value = format.number(score.total);
  const max = format.number(GAUGE_MAX);
  const ranks = rankLines(score.ranks);
  const owner = vehicle.is_owner;
  const items = owner ? upgradeItems(score.next_upgrades) : [];
  const shareable = owner && vehicle.status === 'published';
  const centred = layout === 'centred';
  const beside = layout === 'beside';
  const delta = scoreDelta(score.previous_total, score.total);

  return (
    <View>
      <View style={next && owner ? styles.gaugeBlock : null}>
        <View style={beside ? styles.row : [styles.stacked, centred ? styles.stackedCentred : null]}>
          <BuildScoreGauge
            total={score.total}
            previousTotal={score.previous_total}
            valueText={value}
            scaleText={t('score.scale', { max })}
            accessibilityLabel={t('score.a11y', { value, max, stage: score.stage })}
            box={box}
            first={first}
            style={layout === 'start' ? styles.gaugeStart : null}
            testID={`${id}.gauge`}
          />
          <View style={[styles.details, centred ? styles.detailsNarrow : null]}>
            {/* R6-3: the stage is the label the gauge sits beside, with the rise ("+25") as its chip. */}
            <View style={[styles.stageLine, centred ? styles.stageLineCentred : null]}>
              <Text variant="bodyStrong" hyphenate={false} aria-hidden testID={`${id}.gauge.stage`}>
                {t('score.stage', { stage: score.stage })}
              </Text>
              {delta !== null ? (
                <View aria-hidden>
                  <ScoreDelta text={t('score.delta', { points: format.number(delta) })} testID={`${id}.gauge.delta`} />
                </View>
              ) : null}
            </View>
            {ranks.length > 0 ? (
              <View style={styles.ranks} testID={`${id}.ranks`}>
                {ranks.map((rank) => (
                  <RankLine key={rank.scope} rank={rank} centred={centred} testID={`${id}.rank.${rank.scope}`} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
        <View style={[styles.actions, centred ? styles.actionsNarrow : null]}>
          <Button
            label={owner ? t('score.how') : t('score.howVisitor')}
            variant="tertiary"
            size="s"
            icon="question"
            // The glyph stays inline with its label: a flush button never stacks it (R4DQ-10).
            flush={centred ? undefined : 'start'}
            onPress={onFormula}
            testID={`${id}.how`}
          />
          {shareable ? (
            <Button label={t('score.journey.share')} variant="secondary" size="s" icon="share-network" onPress={onJourney} testID={`${id}.journey`} />
          ) : null}
        </View>
      </View>
      {next && owner ? <NextUpgrades items={items} vehicleId={vehicle.id} routeId={routeId} /> : null}
    </View>
  );
}

function RankLine({ rank, centred, testID }: { rank: BuildScoreRank; centred: boolean; testID: string }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const values = { rank: format.number(rank.rank), size: format.number(rank.group_size), label: rank.label, region: rank.region ?? '' };
  const [text, label] =
    rank.scope === 'bundesland'
      ? [t('score.rankBundesland', values), t('score.rankBundeslandA11y', values)]
      : rank.region
        ? [t('score.rankGeneration', values), t('score.rankGenerationA11y', values)]
        : [t('score.rankGenerationAll', values), t('score.rankGenerationAllA11y', values)];
  return (
    <Text variant="body" numeric aria-label={label} style={centred ? styles.rankNarrow : null} testID={testID}>
      {text}
    </Text>
  );
}

/**
 * "Nächstes Upgrade" (owner only): what would add points next, most first, each with its value ("4 Fotos mehr", "+80") and a row that
 * opens the editor. Helpful and optional: no counter of what is missing, no guilt; with nothing left it says so in one line.
 */
/** "Nächstes Upgrade" lists this many before "Alle Tipps (5)". */
const NEXT_SHOWN = 2;

export function NextUpgrades({ items, vehicleId, routeId, alone = false }: { items: readonly UpgradeItem[]; vehicleId: string; routeId: string; alone?: boolean }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const id = `${routeId}.score.next`;
  // DQ-M53-05 ("simpler, not busier"): the two that add most, the rest one tap away in place.
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, NEXT_SHOWN);
  const hidden = items.length - NEXT_SHOWN;
  const labelOf = (item: UpgradeItem) =>
    t(`score.next.items.${item.key}`, { count: item.missing, chars: format.number(item.progress.need) });
  return (
    <View style={alone ? styles.nextAlone : styles.next} testID={id}>
      <RowGroup title={t('score.next.title')} testID={`${id}.group`}>
        {items.length === 0 ? (
          <ListRow title={t('score.next.done')} testID={`${id}.done`} />
        ) : (
          shown.map((item, index) => {
            const label = labelOf(item);
            const points = t('score.next.points', { points: format.number(item.points) });
            return (
              <ListRow
                key={item.key}
                title={label}
                icon={UPGRADE_ITEMS[item.key].icon}
                value={points}
                accessibilityTitle={t('score.next.a11y', { label, points: format.number(item.points) })}
                role="link"
                onPress={() => router.push(upgradeHref(item.key, vehicleId))}
                divider={index < shown.length - 1 || hidden > 0}
                testID={`${id}.${item.key}`}
              />
            );
          })
        )}
        {hidden > 0 ? (
          <ListRow
            title={open ? t('score.next.less') : t('score.next.more', { count: items.length })}
            role="button"
            chevron={false}
            onPress={() => setOpen((value) => !value)}
            testID={`${id}.toggle`}
          />
        ) : null}
      </RowGroup>
      <Text variant="caption" color="text.tertiary" testID={`${id}.hint`}>
        {t('score.next.hint')}
      </Text>
    </View>
  );
}

/** The loading body in the ready state's geometry: the track at the gauge's box and height, beside (or under) the stage and rank lines. */
function BuildScoreSkeletonBody({
  frame,
  testID,
  trackTestID,
}: {
  frame: { box: number; height: number; layout: 'beside' | 'centred' | 'start' };
  testID?: string;
  trackTestID?: string;
}) {
  const styles = useStyles();
  const beside = frame.layout === 'beside';
  const centred = frame.layout === 'centred';
  return (
    <Skeleton testID={testID}>
      <View style={beside ? styles.row : [styles.stacked, centred ? styles.stackedCentred : null]}>
        <View style={frame.layout === 'start' ? styles.gaugeStart : null}>
          <BuildScoreGaugeTrack box={frame.box} height={frame.height} testID={trackTestID} />
        </View>
        <View style={[styles.details, centred ? styles.detailsNarrow : null]}>
          <SkeletonText variant="bodyStrong" width={size.avatar.xl} />
          <SkeletonText variant="body" width="90%" lines={2} />
        </View>
      </View>
    </Skeleton>
  );
}

/**
 * The section in VEH-01's loading skeleton: the header line and the gauge block, at the size and layout the gauge will take (the
 * page column on phones and tablets, the side card's inner width on the desktop).
 */
export function BuildScoreSectionSkeleton({ width, style, testID }: { width: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const styles = useStyles();
  const frame = useGaugeFrame(width);
  return (
    <View style={[styles.root, style]} testID={testID}>
      <SkeletonText variant="headline" width="35%" />
      <BuildScoreSkeletonBody frame={frame} trackTestID={testID ? `${testID}.track` : undefined} />
    </View>
  );
}
