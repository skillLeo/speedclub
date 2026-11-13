import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useModCategories, type ModCategory } from '@/api/queries/catalog';
import { categoryIcon } from '@/features/vehicle/model';
import { createStyles, size } from '@/theme';
import { ErrorState, Icon, PressableScale, Sheet, Skeleton, SkeletonBlock, Text } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';

/** The skeleton's tiles: the catalogue has about a dozen systems. */
const SKELETON_TILES = 8;

const useStyles = createStyles((t) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  cell: { flexBasis: '45%', flexGrow: 1, minWidth: 0 },
  // 200 %: one tile per line, so a long system name ("Abgasanlage & Auspuff") keeps whole words.
  cellStacked: { flexBasis: '100%' },
  tile: {
    alignItems: 'center',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.md,
    flexDirection: 'row',
    gap: t.space[12],
    minHeight: t.size.row.single,
    paddingHorizontal: t.space[12],
    paddingVertical: t.space[8],
  },
  name: { flex: 1 },
}));

/**
 * The category picker of GAR-09 → GAR-10 (09 §7.6 "category grid with glyphs"): two columns of tiles, the system's auto glyph
 * beside its name (glyph and name on one line, not icon-on-top cards), one column at a large font.
 */
export function CategorySheet({ visible, onClose, onPick, testID }: { visible: boolean; onClose: () => void; onPick: (category: ModCategory) => void; testID: string }) {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const stacked = useStacksAtFontScale();
  const categories = useModCategories();
  const list = categories.data ?? [];
  const cell = [styles.cell, stacked ? styles.cellStacked : null];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('mods.pickCategory')} testID={testID}>
      {categories.isPending && categories.fetchStatus !== 'idle' ? (
        <Skeleton style={styles.grid} testID={`${testID}.skeleton`}>
          {Array.from({ length: SKELETON_TILES }, (_, index) => (
            <View key={index} style={cell}>
              <SkeletonBlock height={size.row.single} corner="md" />
            </View>
          ))}
        </Skeleton>
      ) : categories.isError && !categories.data ? (
        <ErrorState title={t('catalog.errorTitle')} onRetry={() => void categories.refetch()} retrying={categories.isFetching} testID={`${testID}.error`} />
      ) : (
        <View style={styles.grid}>
          {list.map((category) => (
            <PressableScale
              key={category.key}
              role="button"
              aria-label={category.name}
              onPress={() => {
                onClose();
                onPick(category);
              }}
              style={cell}
              contentStyle={styles.tile}
              testID={`${testID}.${category.key}`}
            >
              <Icon name={categoryIcon(category.icon)} size={24} color="text.primary" />
              <Text variant="body" style={styles.name}>
                {category.name}
              </Text>
            </PressableScale>
          ))}
        </View>
      )}
    </Sheet>
  );
}
