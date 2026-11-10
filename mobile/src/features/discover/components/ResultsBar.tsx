import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Icon, IconButton, PressableScale, Text } from '@/ui';

import type { ResultView, SearchSort } from '../filters';

export type ResultsBarProps = {
  /** "124 Builds"; null while the count is not known yet. */
  countLabel: string | null;
  sort: SearchSort;
  onOpenSort: () => void;
  view: ResultView;
  onChangeView: (view: ResultView) => void;
  /** `<ROUTE-ID>.results`. */
  testID: string;
};

const useStyles = createStyles((t) => ({
  bar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], minHeight: t.size.touchMin },
  summary: { alignItems: 'center', flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexWrap: 'wrap', minWidth: 0 },
  sort: { borderRadius: t.radius.sm, minHeight: t.size.touchMin },
  sortInner: { alignItems: 'center', flexDirection: 'row', gap: t.space[4], minHeight: t.size.touchMin, paddingHorizontal: t.space[4] },
  sortHover: { backgroundColor: t.color.state.hover },
  count: { fontVariant: ['tabular-nums'] },
  views: { flexDirection: 'row', marginLeft: 'auto' },
}));

/** FS-11: `supporting` "124 Builds · Relevanz ▾" (the sort sheet) and the list/grid toggle at the end of the line. */
export function ResultsBar({ countLabel, sort, onOpenSort, view, onChangeView, testID }: ResultsBarProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const sortName = t(`sort.${sort}`);
  return (
    <View style={styles.bar} testID={testID}>
      <View style={styles.summary}>
        {countLabel ? (
          <Text variant="supporting" color="text.secondary" style={styles.count} testID={`${testID}.count`}>
            {`${countLabel}\u00A0·\u00A0`}
          </Text>
        ) : null}
        <PressableScale
          role="button"
          aria-label={t('results.sortLabel', { sort: sortName })}
          aria-haspopup="dialog"
          onPress={onOpenSort}
          style={styles.sort}
          contentStyle={(state) => [styles.sortInner, styles.sort, state.hovered || state.pressed ? styles.sortHover : null]}
          testID={`${testID}.sort`}
        >
          {/* DQ-335: the control reads as one, the count beside it as information. */}
          <Text variant="labelS" color="text.primary" hyphenate={false}>
            {sortName}
          </Text>
          <Icon name="caret-down" size={16} color="text.primary" />
        </PressableScale>
      </View>
      <View style={styles.views} role="group" aria-label={t('results.viewLabel')}>
        <IconButton
          icon="list"
          label={t('results.viewList')}
          selected={view === 'list'}
          color={view === 'list' ? 'text.primary' : 'text.secondary'}
          onPress={() => onChangeView('list')}
          testID={`${testID}.view.list`}
        />
        <IconButton
          icon="grid-four"
          label={t('results.viewGrid')}
          selected={view === 'grid'}
          color={view === 'grid' ? 'text.primary' : 'text.secondary'}
          onPress={() => onChangeView('grid')}
          testID={`${testID}.view.grid`}
        />
      </View>
    </View>
  );
}
