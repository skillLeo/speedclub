import { useTranslation } from 'react-i18next';

import { useModCategories, type ModCategory } from '@/api/queries/catalog';
import { categoryIcon } from '@/features/vehicle/model';
import { space } from '@/theme';
import { ErrorState, ListRow, Sheet, Skeleton, SkeletonText } from '@/ui';

/** The category picker overlay of GAR-09 (04_SCREEN_REGISTER): one row per category with its glyph (§6). */
export function CategorySheet({ visible, onClose, onPick, testID }: { visible: boolean; onClose: () => void; onPick: (category: ModCategory) => void; testID: string }) {
  const { t } = useTranslation('garage');
  const categories = useModCategories();
  const list = categories.data ?? [];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('mods.pickCategory')} testID={testID}>
      {categories.isPending && categories.fetchStatus !== 'idle' ? (
        <Skeleton testID={`${testID}.skeleton`}>
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonText key={index} variant="body" width="45%" />
          ))}
        </Skeleton>
      ) : categories.isError && !categories.data ? (
        <ErrorState title={t('catalog.errorTitle')} onRetry={() => void categories.refetch()} retrying={categories.isFetching} testID={`${testID}.error`} />
      ) : (
        list.map((category, index) => (
          <ListRow
            key={category.key}
            icon={categoryIcon(category.icon)}
            title={category.name}
            onPress={() => {
              onClose();
              onPick(category);
            }}
            inset={space[0]}
            divider={index < list.length - 1}
            testID={`${testID}.${category.key}`}
          />
        ))
      )}
    </Sheet>
  );
}
