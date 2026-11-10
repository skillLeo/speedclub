import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFormat } from '@/lib/useFormat';
import { createStyles, space } from '@/theme';
import { SearchBar, Skeleton, SkeletonBlock, Text } from '@/ui';

import type { FacetOption } from '../filters';
import { foldName } from '../fold';
import { OptionRow } from './OptionRow';

/** From this many options the list gets a field to narrow it ("BMW" among 40 makes). */
export const PICKER_SEARCH_FROM = 10;
const SKELETON_ROWS = 6;

export type PickerListProps = {
  field: 'make' | 'model';
  options: readonly FacetOption[];
  value: string | null;
  onPick: (value: string | null) => void;
  loading?: boolean;
  /** `<ROUTE-ID>.picker.<field>`; rows add `.<value>`, the first row `.all`. */
  testID: string;
};

const useStyles = createStyles((t) => ({
  root: { gap: t.space[12] },
  skeleton: { gap: t.space[8] },
}));

/** The make or model picker (FS-11): "Alle Marken" first, then each value with its real count, the chosen one checked. */
export function PickerList({ field, options, value, onPick, loading = false, testID }: PickerListProps) {
  const { t } = useTranslation('discover');
  const styles = useStyles();
  const format = useFormat();
  const [query, setQuery] = useState('');
  const folded = foldName(query);
  const shown = folded ? options.filter((option) => foldName(option.label).includes(folded)) : options;
  const countLabel = (option: FacetOption) =>
    t('make.modelCount', { count: option.count, formatted: format.number(option.count) });

  if (loading && options.length === 0) {
    return (
      <Skeleton testID={`${testID}.skeleton`}>
        <View style={styles.skeleton}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <SkeletonBlock key={index} width="100%" height={space[48]} corner="sm" />
          ))}
        </View>
      </Skeleton>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      {options.length >= PICKER_SEARCH_FROM ? (
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={field === 'make' ? t('filters.findMake') : t('filters.findModel')}
          autoCorrect={false}
          autoCapitalize="none"
          testID={`${testID}.search`}
        />
      ) : null}
      <View role="radiogroup" aria-label={field === 'make' ? t('filters.chooseMake') : t('filters.chooseModel')}>
        {folded === '' ? (
          <OptionRow
            label={field === 'make' ? t('filters.allMakes') : t('filters.allModels')}
            role="radio"
            selected={value === null}
            onPress={() => onPick(null)}
            divider={shown.length > 0}
            testID={`${testID}.all`}
          />
        ) : null}
        {shown.map((option, index) => (
          <OptionRow
            key={option.value}
            label={option.label}
            countLabel={countLabel(option)}
            formattedCount={format.number(option.count)}
            role="radio"
            selected={option.value === value}
            onPress={() => onPick(option.value)}
            divider={index < shown.length - 1}
            testID={`${testID}.${option.value}`}
          />
        ))}
        {folded !== '' && shown.length === 0 ? (
          <Text variant="body" color="text.secondary" testID={`${testID}.noMatch`}>
            {t('filters.noMatch', { query: query.trim() })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
