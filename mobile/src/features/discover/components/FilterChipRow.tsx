import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { createStyles } from '@/theme';
import { Chip } from '@/ui';

export type ActiveChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

export type FilterChipRowProps = {
  chips: readonly ActiveChip[];
  /** The number on the "Filter" chip. */
  count: number;
  /** Null hides the "Filter" chip: from 1280 the panel beside the results is always open. */
  onOpenFilters: (() => void) | null;
  /** The screen's gutter: the row scrolls under it to the screen edge and starts on the column. */
  gutter: number;
  /** `<ROUTE-ID>.chips`; the filter chip is `.filter`, each active chip `.<field>.<value>`. */
  testID: string;
};

const useStyles = createStyles((t) => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  item: { flexShrink: 0 },
}));

/**
 * FS-11 chip row: "Filter" with its icon and the active count, then one removable chip per active filter ("BMW ×" "M4 ×"
 * "19″ ×"). One line that scrolls sideways, as the content tabs do, so a long set never pushes the results down.
 */
export function FilterChipRow({ chips, count, onOpenFilters, gutter, testID }: FilterChipRowProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  if (!onOpenFilters && chips.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.row, { paddingHorizontal: gutter }]}
      // The bleed: the row reaches the screen edge on both sides, its first chip stays on the column.
      style={{ marginHorizontal: -gutter }}
      testID={testID}
    >
      <View role="list" aria-label={t('chips.label')} style={styles.row}>
        {onOpenFilters ? (
          <View role="listitem" style={styles.item}>
            <Chip
              label={t('chips.filter')}
              icon="funnel"
              count={count > 0 ? count : undefined}
              accessibilityLabel={count > 0 ? t('chips.filterLabel', { count }) : undefined}
              onPress={onOpenFilters}
              testID={`${testID}.filter`}
            />
          </View>
        ) : null}
        {chips.map((chip) => (
          <View key={chip.id} role="listitem" style={styles.item}>
            <Chip
              label={chip.label}
              onRemove={chip.onRemove}
              removeLabel={t('chips.remove', { label: chip.label })}
              testID={`${testID}.${chip.id.replace(':', '.')}`}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
