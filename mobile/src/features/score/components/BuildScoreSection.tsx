import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { useBuildScore, type BuildScore, type BuildScoreRank } from '@/api/queries/buildScore';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, useBreakpoint, useTheme } from '@/theme';
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
 * Client round 7 (R7-1, "back to the place where it was before, a little bigger on mobile"): the gauge is again the centred block
 * under "Build Score" in Überblick, on every width (round 6 had set it beside the stage at 120, and on the web desktop into the side
 * card): the stage inside the gauge under "von 1.000", the rise and the rank lines centred under it, then the way to the formula and
 * "Journey teilen". Its box is `GAUGE_BOX` (144; 120 in round 6, 208 in round 4) on phones and on the desktop alike, grown with the
 * font up to the numerals' cap (1.3), never past the column.
 */
export { GAUGE_BOX };
/** From this font scale the details sit start-aligned under the gauge (R4DQ-10): wrapped centred lines read badly. */
export const START_ALIGNED_FONT_SCALE = 1.3;

/** How the rise, the ranks and "So entsteht …" sit under the gauge: centred, or start-aligned at a large font. */
export function detailsLayout(fontScale: number): 'centred' | 'start' {
  return fontScale > START_ALIGNED_FONT_SCALE ? 'start' : 'centred';
}

const useStyles = createStyles((t) => ({
  root: { gap: t.space[16] },
  block: { gap: t.space[12] },
  details: { gap: t.space[8], minWidth: 0 },
  detailsCentred: { alignItems: 'center' },
  ranks: { gap: t.space[4] },
  rankCentred: { textAlign: 'center' },
  actions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[4] },
  actionsCentred: { justifyContent: 'center' },
  next: { gap: t.space[8], marginTop: t.space[8] },
  quiet: { alignItems: 'center', gap: t.space[4] },
  // DQ-P5G-21: the inline error on the section's start edge: what failed, why, and the retry.
  error: { alignItems: 'flex-start', gap: t.space[8] },
  // DQ-P5G-22: with `next`'s 8 the section gap of 32 (09 §4.3) between the gauge block and "Nächstes Upgrade".
  gaugeBlock: { paddingBottom: t.space[24] },
  centred: { textAlign: 'center' },
  // DQ-P5G-15: under the centred gauge the way to the formula is centred too, as in the narrow ready state.
  centredAction: { alignSelf: 'center' },
}));

/**
 * The gauge's box for a column: 144 on every width (the web desktop's hero.numeral.s of 48 fits the needle's inner circle at 144 as
 * well), grown with the font scale up to the numerals' cap, so the numeral keeps inside the needle's inner circle; never past the
 * column.
 */
export function gaugeBoxFor(width: number, fontScale: number): number {
  const grown = GAUGE_BOX * Math.min(GAUGE_TEXT_CAP, Math.max(1, fontScale));
  return Math.floor(Math.max(0, Math.min(width, grown)));
}

/** The gauge's box and laid-out height for a column, as the ready section draws it (the skeleton and the quiet states use it too). */
function useGaugeFrame(column: number): { box: number; height: number; layout: 'centred' | 'start' } {
  const { fontScale, fontScaleCap } = useTheme();
  const desktopType = useDesktopType();
  const box = gaugeBoxFor(column, fontScale);
  // Three digits and the stage under "von 1.000": the height of nearly every score (a grouped "1.000" sets a smaller numeral).
  const { height } = gaugeLayout(box, { valueText: '000', scale: gaugeTextScale(fontScale, fontScaleCap), desktop: desktopType, stage: true });
  return { box, height, layout: detailsLayout(fontScale) };
}

export type BuildScoreSectionProps = {
  vehicle: PublicVehicle;
  /** `VEH-01` or GAR-02's: the section's ids are `<routeId>.score.*`. */
  routeId: string;
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
export function BuildScoreSection({ vehicle, routeId, style }: BuildScoreSectionProps) {
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
  const column = width ?? dimensions.width - 2 * gutter;
  const frame = useGaugeFrame(column);
  const { box } = frame;

  // No score for this vehicle and viewer (or a server without the feature): no section, no empty frame.
  if (query.data?.status === 'unavailable') return null;

  let body;
  if (query.data?.status === 'ready') {
    const score = query.data.score;
    body = (
      <ScoreBody
        vehicle={vehicle}
        score={score}
        box={box}
        layout={frame.layout}
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
  layout: 'centred' | 'start';
  routeId: string;
  onFormula: () => void;
  onJourney: () => void;
};

function ScoreBody({ vehicle, score, box, layout, routeId, onFormula, onJourney }: ScoreBodyProps) {
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
  const delta = scoreDelta(score.previous_total, score.total);

  return (
    <View>
      <View style={[styles.block, owner ? styles.gaugeBlock : null]}>
        {/* R7-1: the stage inside the gauge, under "von 1.000", as before round 6. */}
        <BuildScoreGauge
          total={score.total}
          previousTotal={score.previous_total}
          valueText={value}
          scaleText={t('score.scale', { max })}
          stageText={t('score.stage', { stage: score.stage })}
          accessibilityLabel={t('score.a11y', { value, max, stage: score.stage })}
          box={box}
          first={first}
          testID={`${id}.gauge`}
        />
        <View style={[styles.details, centred ? styles.detailsCentred : null]}>
          {/* The rise under the gauge, not above its numeral: at 144 the needle's tip would touch a chip there. */}
          {delta !== null ? (
            <View aria-hidden>
              <ScoreDelta text={t('score.delta', { points: format.number(delta) })} testID={`${id}.gauge.delta`} />
            </View>
          ) : null}
          {ranks.length > 0 ? (
            <View style={styles.ranks} testID={`${id}.ranks`}>
              {ranks.map((rank) => (
                <RankLine key={rank.scope} rank={rank} centred={centred} testID={`${id}.rank.${rank.scope}`} />
              ))}
            </View>
          ) : null}
          <View style={[styles.actions, centred ? styles.actionsCentred : null]}>
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
      </View>
      {owner ? <NextUpgrades items={items} vehicleId={vehicle.id} routeId={routeId} /> : null}
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
    <Text variant="body" numeric aria-label={label} style={centred ? styles.rankCentred : null} testID={testID}>
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

export function NextUpgrades({ items, vehicleId, routeId }: { items: readonly UpgradeItem[]; vehicleId: string; routeId: string }) {
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
    <View style={styles.next} testID={id}>
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

/** The loading body in the ready state's geometry: the track at the gauge's box and height, the rank lines centred under it. */
function BuildScoreSkeletonBody({
  frame,
  testID,
  trackTestID,
}: {
  frame: { box: number; height: number; layout: 'centred' | 'start' };
  testID?: string;
  trackTestID?: string;
}) {
  const styles = useStyles();
  const centred = frame.layout === 'centred';
  return (
    <Skeleton testID={testID}>
      <View style={styles.block}>
        <BuildScoreGaugeTrack box={frame.box} height={frame.height} testID={trackTestID} />
        <View style={[styles.details, centred ? styles.detailsCentred : null]}>
          <SkeletonText variant="body" width="70%" lines={2} />
        </View>
      </View>
    </Skeleton>
  );
}

/**
 * The section in VEH-01's loading skeleton: the header line and the gauge block, at the size and layout the gauge will take (the
 * Überblick column on every width).
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
