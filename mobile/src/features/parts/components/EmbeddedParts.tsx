import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { MakeTile } from '@/api/queries/discover';
import { countOf, flattenById, useProductSearch, useTopBrands } from '@/api/queries/parts';
import { useDebouncedValue } from '@/features/auth/forms';
import { columnsFor, MakeTiles, MakeTilesSkeleton, TOP_MAKES, TOP_MAKES_PHONE, widestWordmarkWord, wordmarkScale } from '@/features/discover/components/MakeTiles';
import { wholeRows } from '@/features/discover/layout';
import { categoryIcon } from '@/features/vehicle/model';
import { GroupHeader, RowCard } from '@/features/vehicle/components/RowCard';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, space, useTheme } from '@/theme';
import { Button, EmptyState, ErrorState, ProductRow, ProductRowSkeleton, SampleBadge, Text } from '@/ui';

import { buildsLabel, sampleProduct } from '../model';
import { useGarageEntry } from './useGarageEntry';

const SKELETON_ROWS = 4;
/** The search follows what is typed after this pause, never every keystroke. */
export const TYPING_MS = 300;

const useStyles = createStyles((t) => ({
  root: { gap: t.space[32] },
  section: { gap: t.space[12] },
  more: { alignSelf: 'flex-start' },
  sample: { gap: t.space[8] },
}));

/**
 * DISC-01 scope "Teile" (09 §7.5, §8.9): the part brands most run on visible builds as BrandTiles (each opens BRD-01, its real count)
 * and the catalogue's products as ProductRows with "In 14 Builds" (each opens BRD-02). What is typed in Entdecken's search narrows
 * both. Shown only while `parts_catalogue` is on.
 */
export function EmbeddedParts({ query: typed, width, phone, routeId }: { query: string; width: number; phone: boolean; routeId: string }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const { fontScale } = useTheme();
  const garage = useGarageEntry();
  const query = useDebouncedValue(typed, TYPING_MS);
  const id = `${routeId}.partsScope`;
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const brands = useTopBrands(live);
  const products = useProductSearch(query, null, live);
  const q = query.trim().toLowerCase();
  const tiles = useMemo<MakeTile[]>(
    () =>
      (qaState === 'empty' ? [] : (brands.data ?? []))
        .filter((brand) => !q || brand.name.toLowerCase().includes(q))
        .map((brand, index) => ({ id: index, slug: brand.slug, name: brand.name, vehicle_count: countOf(brand.builds) })),
    [brands.data, q, qaState],
  );
  const columns = useMemo(() => columnsFor(width, widestWordmarkWord(tiles.map((tile) => tile.name), wordmarkScale(fontScale))), [fontScale, tiles, width]);
  const shownTiles = tiles.slice(0, wholeRows(tiles.length, columns, phone ? TOP_MAKES_PHONE : TOP_MAKES));
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenById(products.data?.pages)), [products.data?.pages, qaState]);
  const openBrand = useCallback((tile: MakeTile) => router.push({ pathname: '/brands/[slug]', params: { slug: tile.slug } }), [router]);

  const loading = qaState === 'loading' || (live && ((brands.isPending && brands.fetchStatus !== 'paused') || (products.isPending && products.fetchStatus !== 'paused')));
  if (loading) {
    return (
      <View style={styles.root} testID={`${id}.skeleton`}>
        <MakeTilesSkeleton width={width} count={phone ? TOP_MAKES_PHONE : TOP_MAKES} testID={`${id}.brands.skeleton`} />
        <RowCard>
          <ProductRowSkeleton rows={SKELETON_ROWS} />
        </RowCard>
      </View>
    );
  }
  if (qaState === 'error' || (brands.isError && products.isError) || (!brands.data && !products.data && qaState !== 'empty')) {
    const offline = qaState !== 'error' && (!online || brands.fetchStatus === 'paused');
    return (
      <ErrorState
        title={offline ? t('states.offlineTitle') : t('scope.partsError')}
        message={offline ? t('states.offlineBody') : undefined}
        onRetry={() => {
          void brands.refetch();
          void products.refetch();
        }}
        retrying={brands.isFetching || products.isFetching}
        testID={`${id}.${offline ? 'offline' : 'error'}`}
      />
    );
  }
  if (shownTiles.length === 0 && rows.length === 0) {
    const sample = sampleProduct(t);
    return (
      <EmptyState
        preview={
          <View style={styles.sample} aria-hidden>
            <SampleBadge testID={`${id}.empty.badge`} />
            <RowCard>
              <ProductRow icon="coilover" brand={sample.brand.name} name={sample.name} category={sample.category.name} inset={space[16]} testID={`${id}.empty.sample`} />
            </RowCard>
          </View>
        }
        title={q ? t('scope.partsNoMatch', { query: query.trim() }) : t('scope.partsEmptyTitle')}
        body={q ? t('scope.partsNoMatchBody') : t('scope.partsEmptyBody')}
        action={{ label: t('builds.toGarage'), onPress: garage, variant: 'secondary', size: 'm' }}
        testID={`${id}.empty`}
      />
    );
  }
  return (
    <View style={styles.root} testID={id}>
      {shownTiles.length > 0 ? (
        <View style={styles.section}>
          <GroupHeader title={t('scope.brands')} />
          <MakeTiles makes={shownTiles} width={width} onOpen={openBrand} testID={`${id}.brands`} />
        </View>
      ) : null}
      <View style={styles.section}>
        <GroupHeader title={q ? t('scope.productsMatching', { query: query.trim() }) : t('scope.products')} />
        {rows.length > 0 ? (
          <RowCard testID={`${id}.products`}>
            {rows.map((product, index) => (
              <ProductRow
                key={product.id}
                icon={categoryIcon(product.category.icon)}
                brand={product.brand.name}
                name={product.name}
                category={product.category.name}
                builds={buildsLabel(product.builds, t, (n) => format.number(n))}
                onPress={() => router.push({ pathname: '/products/[id]', params: { id: product.id } })}
                divider={index < rows.length - 1}
                inset={space[16]}
                testID={`${id}.product.${product.id}`}
              />
            ))}
          </RowCard>
        ) : (
          <Text variant="callout" color="text.secondary" testID={`${id}.products.none`}>
            {t('scope.partsNoMatchBody')}
          </Text>
        )}
        {products.hasNextPage ? (
          <Button
            label={t('scope.moreProducts')}
            variant="secondary"
            size="m"
            loading={products.isFetchingNextPage}
            onPress={() => void products.fetchNextPage()}
            style={styles.more}
            testID={`${id}.products.more`}
          />
        ) : null}
      </View>
    </View>
  );
}
