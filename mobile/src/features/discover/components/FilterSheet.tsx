import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createStyles } from '@/theme';
import { Button, Sheet } from '@/ui';

import { setSingle, type FilterOptions, type SearchFilters } from '../filters';
import { FilterPanel, type FilterPanelStatus } from './FilterPanel';
import { PickerList } from './PickerList';

export type FilterSheetPage = 'filters' | 'make' | 'model';

export type FilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  page: FilterSheetPage;
  onChangePage: (page: FilterSheetPage) => void;
  /** The sheet edits a draft: the results only change with "… Ergebnisse anzeigen". */
  draft: SearchFilters;
  onChangeDraft: (next: SearchFilters) => void;
  options: FilterOptions;
  status: FilterPanelStatus;
  onRetry: () => void;
  retrying?: boolean;
  /** "124 Ergebnisse anzeigen", the live total of the draft from the facets; "Ergebnisse anzeigen" while it loads. */
  applyLabel: string;
  onApply: () => void;
  onReset: () => void;
  makeLabel: string | null;
  modelLabel: string | null;
  generationLabel?: string | null;
  /** `<ROUTE-ID>.filterSheet`. */
  testID: string;
};

const useStyles = createStyles((t) => ({
  footer: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  reset: { flexShrink: 0 },
  apply: { flexBasis: '50%', flexGrow: 1, flexShrink: 1, minWidth: 0 },
  back: { alignSelf: 'flex-start', marginBottom: t.space[8] },
}));

/**
 * FS-11 filter sheet: full height, the grouped sections, a sticky Primary L with the live count and "Zurücksetzen" beside
 * it. The make and model pickers open as pages of the same sheet, with a way back, so one overlay holds the focus (§8).
 */
export function FilterSheet({
  visible,
  onClose,
  page,
  onChangePage,
  draft,
  onChangeDraft,
  options,
  status,
  onRetry,
  retrying,
  applyLabel,
  onApply,
  onReset,
  makeLabel,
  modelLabel,
  generationLabel = null,
  testID,
}: FilterSheetProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const title = page === 'make' ? t('filters.chooseMake') : page === 'model' ? t('filters.chooseModel') : t('filters.title');

  const footer =
    page === 'filters' ? (
      <View style={styles.footer}>
        {/* DQ-320: flush on the start edge, so the primary keeps the width for "124 Builds anzeigen" on one line at 360. */}
        <Button label={t('filters.reset')} variant="tertiary" size="l" flush="start" onPress={onReset} style={styles.reset} testID={`${testID}.reset`} />
        <Button
          label={applyLabel}
          variant="primary"
          size="l"
          fullWidth
          onPress={onApply}
          style={styles.apply}
          testID={`${testID}.apply`}
        />
      </View>
    ) : undefined;

  return (
    <Sheet visible={visible} onClose={onClose} title={title} initialSnap="full" footer={footer} testID={testID}>
      {page === 'filters' ? (
        <FilterPanel
          filters={draft}
          onChange={onChangeDraft}
          options={options}
          status={status}
          onRetry={onRetry}
          retrying={retrying}
          onOpenPicker={onChangePage}
          makeLabel={makeLabel}
          modelLabel={modelLabel}
          generationLabel={generationLabel}
          testID={`${testID}.panel`}
        />
      ) : (
        <View>
          <Button
            label={t('filters.back')}
            variant="tertiary"
            size="m"
            icon="caret-left"
            flush="start"
            onPress={() => onChangePage('filters')}
            style={styles.back}
            testID={`${testID}.back`}
          />
          <PickerList
            field={page}
            options={(page === 'make' ? options.make : options.model) ?? []}
            value={page === 'make' ? draft.make : draft.model}
            loading={status === 'loading'}
            onPick={(value) => {
              onChangeDraft(setSingle(draft, page, value));
              onChangePage('filters');
            }}
            testID={`${testID}.picker.${page}`}
          />
        </View>
      )}
    </Sheet>
  );
}
