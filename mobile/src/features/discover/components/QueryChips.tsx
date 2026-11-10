import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles } from '@/theme';
import { Chip, SectionHeader } from '@/ui';

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  // DQ-187: a term of up to 100 characters stays inside the row; the chip ends it in an ellipsis.
  item: { maxWidth: '100%' },
}));

export type QueryChipsProps = {
  title: string;
  terms: readonly string[];
  onPick: (term: string) => void;
  /** "Löschen" for the recent searches. */
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
  /** `<ROUTE-ID>.recent`; each chip adds `.<index>`. */
  testID: string;
};

/** FS-11: recent searches as chips with "Löschen", and the same row for suggestions from the real makes. */
export function QueryChips({ title, terms, onPick, onClear, style, testID }: QueryChipsProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  if (terms.length === 0) return null;
  return (
    <View style={style} testID={testID}>
      <SectionHeader
        title={title}
        actionLabel={onClear ? t('recent.clear') : undefined}
        actionAccessibilityLabel={onClear ? t('recent.clearLabel') : undefined}
        onAction={onClear}
        style={styles.header}
        testID={`${testID}.header`}
      />
      <View role="list" style={styles.chips}>
        {terms.map((term, index) => (
          <View key={term} role="listitem" style={styles.item}>
            <Chip label={term} onPress={() => onPick(term)} testID={`${testID}.${index}`} />
          </View>
        ))}
      </View>
    </View>
  );
}
