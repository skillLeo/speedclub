import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { keepNameTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { Chip, Hairline, ListRow } from '@/ui';

export type ModelRowGeneration = { slug: string; name: string; count: number; years: string | null };

export type ModelRowProps = {
  name: string;
  count: number;
  generations: readonly ModelRowGeneration[];
  onOpen: () => void;
  onOpenGeneration: (slug: string) => void;
  divider: boolean;
  /** `<ROUTE-ID>.model.<slug>`; generation chips add `.generation.<slug>`. */
  testID: string;
};

const useStyles = createStyles((t) => ({
  // DQ-319: the chips wrap inside the card, so none is cut at its edge ("E90/E92/E93 · 2007–").
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], paddingBottom: t.space[12], paddingHorizontal: t.space[16] },
  item: { maxWidth: '100%' },
}));

/** DISC-03: one model with its real count, then its generations as chips ("G82 · 12"), each leading to DISC-04 at that generation. */
export const ModelRow = memo(function ModelRow({ name, count, generations, onOpen, onOpenGeneration, divider, testID }: ModelRowProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const format = useFormat();
  return (
    <View>
      <ListRow
        title={keepNameTogether(name)}
        value={t('make.modelCount', { count, formatted: format.number(count) })}
        hyphenate={false}
        role="link"
        onPress={onOpen}
        inset={space[16]}
        testID={testID}
      />
      {generations.length > 0 ? (
        <View role="list" aria-label={t('make.generations', { model: name })} style={styles.list}>
            {generations.map((generation) => (
              <View key={generation.slug} role="listitem" style={styles.item}>
                <Chip
                  label={generation.years ? `${generation.name} · ${generation.years}` : generation.name}
                  count={generation.count}
                  onPress={() => onOpenGeneration(generation.slug)}
                  testID={`${testID}.generation.${generation.slug}`}
                />
              </View>
            ))}
        </View>
      ) : null}
      {divider ? <Hairline inset={space[16]} /> : null}
    </View>
  );
});
