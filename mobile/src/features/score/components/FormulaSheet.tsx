import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useBuildScoreFormula, type BuildScoreFormula, type FormulaItem } from '@/api/queries/buildScore';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Hairline } from '@/ui/Hairline';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

const FORMULA_ITEMS = [
  'photos',
  'key_specs',
  'description',
  'cover_focal',
  'documented_mods',
  'registered_mods',
  'reactors',
  'spotters',
  'followers',
  'timeline',
  'before_after',
  'history_span',
] as const;
type FormulaItemKey = (typeof FORMULA_ITEMS)[number];

function isFormulaItem(key: string): key is FormulaItemKey {
  return (FORMULA_ITEMS as readonly string[]).includes(key);
}

const useStyles = createStyles((t) => ({
  body: { gap: t.space[20], paddingBottom: t.space[16] },
  never: { gap: t.space[4] },
  part: { gap: t.space[8] },
  line: { alignItems: 'baseline', columnGap: t.space[12], flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  lineText: { flexBasis: '60%', flexGrow: 1, flexShrink: 1 },
  stages: { gap: t.space[4] },
}));

export type FormulaSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The owner reads "So entsteht dein Build Score", everybody else "So entsteht der Build Score". */
  owner: boolean;
  routeId: string;
};

/**
 * "So entsteht dein Build Score" (contract §4 `GET build-score/formula`): the four parts with their caps, each rule in plain German
 * from the config values, the line "Nie Punkte für PS, Tempo, Sound oder Geld.", the each-person-once rule and the stages.
 */
export function FormulaSheet({ visible, onClose, owner, routeId }: FormulaSheetProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const formula = useBuildScoreFormula(visible);
  const id = `${routeId}.score.formula`;

  let content;
  if (formula.data) {
    content = <FormulaBody formula={formula.data} testID={id} />;
  } else if (formula.isError) {
    content = (
      <View style={styles.never} role="alert" testID={`${id}.error`}>
        <Text variant="callout" color="text.secondary">
          {t('score.formula.errorTitle')}
        </Text>
        <Button label={t('score.retry')} variant="secondary" size="m" loading={formula.isFetching} onPress={() => void formula.refetch()} testID={`${id}.retry`} />
      </View>
    );
  } else {
    content = (
      <Skeleton testID={`${id}.skeleton`}>
        <View style={styles.body}>
          <SkeletonText variant="body" lines={3} />
          <SkeletonText variant="callout" lines={6} />
        </View>
      </Skeleton>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={owner ? t('score.how') : t('score.howVisitor')}
      expandable
      testID={id}
      footer={<Button label={t('score.formula.close')} variant="secondary" size="l" fullWidth onPress={onClose} testID={`${id}.close`} />}
    >
      {content}
    </Sheet>
  );
}

function FormulaBody({ formula, testID }: { formula: BuildScoreFormula; testID: string }) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const format = useFormat();
  const number = (value: number) => format.number(value);
  const itemText = (key: FormulaItemKey, item: FormulaItem) =>
    t(`score.formula.items.${key}`, {
      points: number(item.points),
      limit: number(item.limit ?? 0),
      chars: number(item.min_chars ?? 0),
    });
  const stages = [...formula.stages].sort((a, b) => a.min - b.min);
  return (
    <View style={styles.body}>
      <Text variant="body" color="text.primary">
        {t('score.formula.intro', { max: number(formula.max) })}
      </Text>
      <Text variant="bodyStrong" color="text.primary" testID={`${testID}.never`}>
        {t('score.never')}
      </Text>
      {formula.parts.map((part) => (
        <View key={part.key} style={styles.part} testID={`${testID}.part.${part.key}`}>
          <Hairline />
          <View style={styles.line}>
            <Text variant="calloutStrong" color="text.primary" role="heading" {...({ 'aria-level': 3 } as object)} style={styles.lineText}>
              {t(`score.parts.${part.key}`)}
            </Text>
            <Text variant="caption" color="text.secondary" numeric hyphenate={false}>
              {t('score.formula.partMax', { max: number(part.max) })}
            </Text>
          </View>
          {part.items.map((item) =>
            isFormulaItem(item.key) ? (
              <View key={item.key} style={styles.line} testID={`${testID}.item.${item.key}`}>
                <Text variant="callout" color="text.secondary" style={styles.lineText}>
                  {itemText(item.key, item)}
                </Text>
                <Text variant="caption" color="text.tertiary" numeric hyphenate={false}>
                  {t('score.formula.itemMax', { max: number(item.max) })}
                </Text>
              </View>
            ) : null,
          )}
          {part.key === 'community' ? (
            <Text variant="caption" color="text.tertiary" testID={`${testID}.once`}>
              {t('score.formula.once')}
            </Text>
          ) : null}
        </View>
      ))}
      {stages.length > 0 ? (
        <View style={styles.part} testID={`${testID}.stages`}>
          <Hairline />
          <Text variant="calloutStrong" color="text.primary" role="heading" {...({ 'aria-level': 3 } as object)}>
            {t('score.formula.stages')}
          </Text>
          <View style={styles.stages}>
            {stages.map((stage, index) => {
              const next = stages[index + 1];
              return (
                <View key={stage.stage} style={styles.line}>
                  <Text variant="callout" color="text.secondary">
                    {t('score.stage', { stage: stage.stage })}
                  </Text>
                  <Text variant="callout" color="text.secondary" numeric hyphenate={false}>
                    {next
                      ? t('score.formula.stageRange', { from: number(stage.min), to: number(next.min - 1) })
                      : t('score.formula.stageFrom', { from: number(stage.min) })}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
