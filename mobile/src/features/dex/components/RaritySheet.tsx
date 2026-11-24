import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { RARITIES, useRarityRules, type Rarity, type RarityRules } from '@/api/queries/dex';
import { useFormat } from '@/lib/useFormat';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { ErrorState } from '@/ui/ErrorState';
import { Hairline } from '@/ui/Hairline';
import { Sheet } from '@/ui/Sheet';
import { Skeleton, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { QA_RARITY_RULES, qaDexActive } from '../qaDex';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16], paddingBottom: t.space[8] },
  list: { gap: t.space[12] },
  row: { gap: t.space[4] },
  tier: {
    alignSelf: 'flex-start',
    backgroundColor: t.color.bg.inverse,
    borderRadius: t.radius.xs,
    justifyContent: 'center',
    minHeight: t.size.statusPill,
    paddingHorizontal: t.space[8],
  },
}));

/** The plain-German line of one tier, with the configured numbers. */
export function rarityRuleText(t: (key: string, options?: Record<string, unknown>) => string, tier: Rarity, rules: RarityRules, number: (value: number) => string): string {
  switch (tier) {
    case 'tuned':
      return t('rarityRules.tuned', { score: number(rules.tunedScore) });
    case 'rare':
      return t('rarityRules.rare', { max: number(rules.rareMax) });
    case 'legend':
      return t('rarityRules.legend', { score: number(rules.legendScore) });
    default:
      return t(`rarityRules.${tier}`);
  }
}

/**
 * "So entsteht die Rarität" (contract §3/§6): Street · Tuned · Rare · Legend · Ghost, each with its rule in plain words and
 * the thresholds from `GET /rarity-rules` (config `dex.rarity`). Reached from DEX-01 and DEX-03.
 */
export function RaritySheet({ visible, onClose, testID }: { visible: boolean; onClose: () => void; testID: string }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const format = useFormat();
  const sample = qaDexActive();
  const query = useRarityRules(visible && !sample);
  const rules = sample ? QA_RARITY_RULES : query.data;

  let content;
  if (rules) {
    content = (
      <View style={styles.list} role="list" testID={`${testID}.rules`}>
        {RARITIES.map((tier, index) => (
          <View key={tier} role="listitem" style={styles.list}>
            {index > 0 ? <Hairline /> : null}
            <View style={styles.row} testID={`${testID}.rule.${tier}`}>
              <View style={styles.tier}>
                <Text variant="labelBadge" color="text.inverse" hyphenate={false}>
                  {t(`rarity.${tier}`)}
                </Text>
              </View>
              <Text variant="callout" color="text.secondary" numeric>
                {rarityRuleText(t, tier, rules, (value) => format.number(value))}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  } else if (query.isError) {
    content = <ErrorState title={t('rarityRules.errorTitle')} onRetry={() => void query.refetch()} retrying={query.isFetching} testID={`${testID}.error`} />;
  } else {
    content = (
      <Skeleton testID={`${testID}.skeleton`}>
        <View style={styles.list}>
          {RARITIES.map((tier) => (
            <View key={tier} style={styles.row}>
              <SkeletonText variant="labelBadge" width="20%" />
              <SkeletonText variant="callout" width="85%" />
            </View>
          ))}
        </View>
      </Skeleton>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('rarityRules.title')}
      narrow
      footer={<Button label={t('rarityRules.close')} variant="secondary" size="l" fullWidth onPress={onClose} testID={`${testID}.close`} />}
      testID={testID}
    >
      <View style={styles.body}>
        <Text variant="body" color="text.secondary">
          {t('rarityRules.intro')}
        </Text>
        {content}
      </View>
    </Sheet>
  );
}
