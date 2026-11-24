import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { RARITIES, type DexFilter, type DexMake, type DexSet, type Rarity } from '@/api/queries/dex';
import { createStyles } from '@/theme';
import { Chip } from '@/ui/Chip';
import { ListRow } from '@/ui/ListRow';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { RowGroup } from '@/ui/RowGroup';
import { haptics } from '@/ui/motion';

const useStyles = createStyles((t) => ({
  chips: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  body: { gap: t.space[12], paddingBottom: t.space[8] },
}));

type Picker = 'rarity' | 'make' | 'sets' | null;

export type DexFiltersProps = {
  value: DexFilter;
  onChange: (next: DexFilter) => void;
  /** The makes of the member's cards, with their slugs. */
  makes: readonly DexMake[];
  sets: readonly DexSet[];
  /** The side gutter: the chip row scrolls edge to edge and starts on the column. */
  gutter: number;
  /** `DEX-01.filters`: `.all`, `.rarity`, `.make`, `.sets`, `.picker.<kind>`, `.option.<value>`. */
  testID: string;
};

/**
 * DEX-01's chips (contract §8): Alle · Rarität · Marke · Sets. "Alle" applies at once; the other three open a short list to
 * pick from, and the chip then names what is picked. Inverted when selected (09 §5), one selection haptic per change.
 */
export function DexFilters({ value, onChange, makes, sets, gutter, testID }: DexFiltersProps) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const [picker, setPicker] = useState<Picker>(null);
  const pick = (next: DexFilter) => {
    setPicker(null);
    haptics.selection();
    onChange(next);
  };
  const label = (kind: Exclude<Picker, null>) => {
    if (kind === 'rarity' && value.kind === 'rarity') return t(`rarity.${value.tier}`);
    if (kind === 'make' && value.kind === 'make') return value.name;
    if (kind === 'sets' && value.kind === 'set') return value.name;
    return t(`home.filters.${kind}`);
  };

  const options = () => {
    if (picker === 'rarity') {
      return RARITIES.map((tier: Rarity, index) => (
        <ListRow
          key={tier}
          title={t(`rarity.${tier}`)}
          role="button"
          chevron={false}
          selected={value.kind === 'rarity' && value.tier === tier}
          onPress={() => pick({ kind: 'rarity', tier })}
          divider={index < RARITIES.length - 1}
          testID={`${testID}.option.${tier}`}
        />
      ));
    }
    if (picker === 'make') {
      if (makes.length === 0) return null;
      return makes.map(({ slug, name: make }, index) => {
        return (
          <ListRow
            key={slug}
            title={make}
            role="button"
            chevron={false}
            selected={value.kind === 'make' && value.slug === slug}
            onPress={() => pick({ kind: 'make', slug, name: make })}
            divider={index < makes.length - 1}
            testID={`${testID}.option.${slug}`}
          />
        );
      });
    }
    if (picker === 'sets') {
      if (sets.length === 0) return null;
      return sets.map((set, index) => (
        <ListRow
          key={set.key}
          title={set.name}
          value={t('sets.progress', { progress: set.progress, target: set.target })}
          role="button"
          chevron={false}
          selected={value.kind === 'set' && value.key === set.key}
          onPress={() => pick({ kind: 'set', key: set.key, name: set.name })}
          divider={index < sets.length - 1}
          testID={`${testID}.option.${set.key}`}
        />
      ));
    }
    return null;
  };
  const rows = options();
  const empty = picker === 'make' ? t('home.filters.noMakes') : picker === 'sets' ? t('home.filters.noSets') : null;
  const title = picker === 'rarity' ? t('home.filters.rarityTitle') : picker === 'make' ? t('home.filters.makeTitle') : t('home.filters.setsTitle');

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{ paddingHorizontal: gutter }}
        testID={testID}
      >
        <View style={styles.chips} role="radiogroup" aria-label={t('home.filters.label')}>
          <Chip
            label={t('home.filters.all')}
            selected={value.kind === 'all'}
            selectionRole="radio"
            onPress={() => value.kind !== 'all' && pick({ kind: 'all' })}
            testID={`${testID}.all`}
          />
          <Chip label={label('rarity')} selected={value.kind === 'rarity'} selectionRole="radio" icon="caret-down" onPress={() => setPicker('rarity')} testID={`${testID}.rarity`} />
          <Chip label={label('make')} selected={value.kind === 'make'} selectionRole="radio" icon="caret-down" onPress={() => setPicker('make')} testID={`${testID}.make`} />
          <Chip label={label('sets')} selected={value.kind === 'set'} selectionRole="radio" icon="caret-down" onPress={() => setPicker('sets')} testID={`${testID}.sets`} />
        </View>
      </ScrollView>
      <Sheet visible={picker !== null} onClose={() => setPicker(null)} title={title} narrow testID={`${testID}.picker${picker ? `.${picker}` : ''}`}>
        <View style={styles.body}>
          {rows ? (
            <RowGroup>{rows}</RowGroup>
          ) : empty ? (
            <Text variant="body" color="text.secondary" testID={`${testID}.pickerEmpty`}>
              {empty}
            </Text>
          ) : null}
        </View>
      </Sheet>
    </>
  );
}
