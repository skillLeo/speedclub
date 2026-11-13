import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { createStyles } from '@/theme';
import { Chip } from '@/ui';

export type ActiveChip = {
  id: string;
  label: string;
  onRemove: () => void;
};

/**
 * DQ-1037 (09 §7.5 DISC-02): one chip per filter of the blueprint's rail (Marke, Modell, Baujahr, Leistung, Mods, Sortieren), each
 * opening its sheet. A field with one value shows that value inverted with its × (the active chip it replaces, same testID);
 * a field with several values or a sort is inverted and says so in its label.
 */
export type FieldChip = {
  key: string;
  /** "Marke", or the state when `selected`: "Mods", "Meiste PS". */
  label: string;
  /** The field's one active value: the chip shows it, inverted, with its ×. */
  value?: ActiveChip;
  /** Set without a single value (several mods, a sort): inverted. */
  selected?: boolean;
  /** How many values a multi-value field has, as on the "Filter" chip. */
  count?: number;
  /** Names the chip when its label alone says too little ("Mods, 2 aktiv"). Starts with the visible label. */
  accessibilityLabel?: string;
  onPress: () => void;
};

export type FilterChipRowProps = {
  /** The active filters without a field chip of their own: removable. */
  chips: readonly ActiveChip[];
  /** DQ-1037: the field chips after "Filter" (phones and tablets; from 1280 the panel has the fields). */
  fields?: readonly FieldChip[];
  /** The number on the "Filter" chip. */
  count: number;
  /** Null hides the "Filter" chip: from 1280 the panel beside the results is always open. */
  onOpenFilters: (() => void) | null;
  /** The screen's gutter: the row scrolls under it to the screen edge and starts on the column. */
  gutter: number;
  /** `<ROUTE-ID>.chips`; the filter chip is `.filter`, a field chip `.field.<key>` (with a value `.<field>.<value>`), each active chip `.<field>.<value>`. */
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
export function FilterChipRow({ chips, fields = [], count, onOpenFilters, gutter, testID }: FilterChipRowProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  if (!onOpenFilters && chips.length === 0 && fields.length === 0) return null;
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
        {fields.map((field) =>
          field.value ? (
            <View key={field.key} role="listitem" style={styles.item}>
              <Chip
                label={field.value.label}
                selected
                onPress={field.onPress}
                onRemove={field.value.onRemove}
                removeLabel={t('chips.remove', { label: field.value.label })}
                accessibilityLabel={`${field.value.label}, ${field.label}`}
                testID={`${testID}.${field.value.id.replace(':', '.')}`}
              />
            </View>
          ) : (
            <View key={field.key} role="listitem" style={styles.item}>
              <Chip
                label={field.label}
                selected={field.selected ? true : undefined}
                count={field.count}
                accessibilityLabel={field.accessibilityLabel}
                onPress={field.onPress}
                testID={`${testID}.field.${field.key}`}
              />
            </View>
          ),
        )}
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
