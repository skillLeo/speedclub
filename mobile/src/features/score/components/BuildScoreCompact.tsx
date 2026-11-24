import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { vehicleBuildScoreOf } from '@/api/queries/buildScore';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size } from '@/theme';
import { BuildScoreMeter } from '@/ui/BuildScoreGauge';
import { SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { qaCardScore } from '../qaScore';

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  text: { flexShrink: 1, gap: t.space[2], minWidth: 0 },
}));

/** Whether the resource speaks of a score at all: an answer from before M5.9c has no `build_score` key, and then nothing shows. */
function carriesScore(card: object): boolean {
  return 'build_score' in card;
}

/**
 * DQ-P5G-24 (10 §16.3: the Build Score replaces the §6.2 progress ring): whether GAR-01's card shows the compact score, which is
 * then the card's only progress, without the old completeness line.
 */
export function showsBuildScore(card: { id: string }): boolean {
  return carriesScore(card) || qaCardScore(card.id) !== null;
}

export type BuildScoreCompactProps = {
  /** A garage card (`VehicleCardResource` with `build_score: {total, stage} | null`). */
  card: { id: string };
  style?: StyleProp<ViewStyle>;
  /** `GAR-01.score.<id>`; sub-testIDs `.value`, `.stage`, `.pending`. */
  testID?: string;
};

/**
 * GAR-01 (contract §5): a car's Build Score under its card — the arc filled to the score (no needle, no motion in a list), the number
 * in `hero.numeral.s` like the mini spec above it, and the stage. While the server has not computed it yet, one quiet line.
 */
export function BuildScoreCompact({ card, style, testID }: BuildScoreCompactProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const score = vehicleBuildScoreOf(card) ?? qaCardScore(card.id);
  if (!score) {
    if (!carriesScore(card)) return null;
    return (
      <View style={[styles.row, style]} testID={testID ? `${testID}.pending` : undefined}>
        <BuildScoreMeter total={0} />
        <Text variant="caption" color="text.secondary">
          {t('score.compactPending')}
        </Text>
      </View>
    );
  }
  const value = format.number(score.total);
  return (
    <View accessible role="img" aria-label={t('score.compact', { value, stage: score.stage })} style={[styles.row, style]} testID={testID}>
      <BuildScoreMeter total={score.total} />
      <Text variant="heroNumeralS" numeric hyphenate={false} testID={testID ? `${testID}.value` : undefined}>
        {value}
      </Text>
      <View style={styles.text}>
        <Text variant="labelCaps" color="text.secondary" hyphenate={false}>
          {t('score.title')}
        </Text>
        <Text variant="caption" color="text.primary" hyphenate={false} testID={testID ? `${testID}.stage` : undefined}>
          {t('score.stage', { stage: score.stage })}
        </Text>
      </View>
    </View>
  );
}

/** The compact score's place in GAR-01's card skeleton: the arc's box and the two lines beside it. */
export function BuildScoreCompactSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.row, style]}>
      <SkeletonBlock width={size.avatar.md} height={size.avatar.md} corner="full" />
      <View style={styles.text}>
        <SkeletonText variant="labelCaps" width={size.avatar.xl} />
        <SkeletonText variant="caption" width={size.avatar.lg} />
      </View>
    </View>
  );
}
