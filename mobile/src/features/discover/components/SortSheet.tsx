import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Sheet } from '@/ui';

import type { SearchSort } from '../filters';
import { OptionRow } from './OptionRow';

export type SortSheetProps = {
  visible: boolean;
  onClose: () => void;
  sorts: readonly SearchSort[];
  value: SearchSort;
  onChange: (sort: SearchSort) => void;
  /** `<ROUTE-ID>.sortSheet`; each row adds `.<sort>`. */
  testID: string;
};

/** §3.7 sorts: Relevanz (with a text) · Neueste · Zuletzt aktualisiert · Meiste PS. A choice applies and closes. */
export function SortSheet({ visible, onClose, sorts, value, onChange, testID }: SortSheetProps) {
  const { t } = useTranslation('discover');
  return (
    <Sheet visible={visible} onClose={onClose} title={t('sort.title')} expandable={false} narrow testID={testID}>
      <View role="radiogroup" aria-label={t('sort.title')}>
        {sorts.map((sort, index) => (
          <OptionRow
            key={sort}
            label={t(`sort.${sort}`)}
            role="radio"
            selected={sort === value}
            onPress={() => {
              onClose();
              if (sort !== value) onChange(sort);
            }}
            divider={index < sorts.length - 1}
            testID={`${testID}.${sort}`}
          />
        ))}
      </View>
    </Sheet>
  );
}
