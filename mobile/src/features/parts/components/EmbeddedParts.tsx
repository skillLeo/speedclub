import '@/features/parts/i18n';

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { MakeTile } from '@/api/queries/discover';
import { countOf, flattenById, useProductSearch, useTopBrands, type BuildPhoto, type ProductRowData } from '@/api/queries/parts';
import { useDebouncedValue } from '@/features/auth/forms';
import { railCardWidth } from '@/features/discover/components/DiscoverSections';
import {
  columnsFor,
  MakeTiles,
  MakeTilesSkeleton,
  TOP_MAKES,
  TOP_MAKES_PHONE,
  WIDE_COLUMN_STEPS,
  widestWordmarkWord,
  wordmarkScale,
} from '@/features/discover/components/MakeTiles';
import { wholeRows } from '@/features/discover/layout';
import { photoFields } from '@/features/profile/media';
import { categoryIcon } from '@/features/vehicle/model';
import { GroupHeader, RowCard } from '@/features/vehicle/components/RowCard';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, space, useTheme } from '@/theme';
import { SampleBadge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { MediaCard, MediaCardSkeleton } from '@/ui/MediaCard';
import { ProductRow, ProductRowSkeleton } from '@/ui/ProductRow';
import { Skeleton, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

import { buildsLabel, sampleProduct } from '../model';
import { useGarageEntry } from './useGarageEntry';

/** DQ-1138: the first rows of the list; "Alle Teile" shows the rest. */
export const FIRST_PRODUCTS = 8;
/** The search follows what is typed after this pause, never every keystroke. */
export const TYPING_MS = 300;
/** DQ-1149: the skeleton measures with a long part-brand name, as the loaded tiles do (part brands are shorter than car makes). */
const SAMPLE_BRAND = 'Akrapovič'; // i18n-ignore (a brand name)
/** "Beliebt in Builds" needs at least two cards beside the lead to be a rail. */
const RAIL_MIN = 2;
/** Rail cards the skeleton draws (the screen's width shows two and a half on a phone). */
const RAIL_SKELETON = 3;
/** DQ-1142: products two side by side from 768. */
const PRODUCT_COLUMN_GAP = space[12];

const useStyles = createStyles((t) => ({
  root: { gap: t.space[32] },
  section: { gap: t.space[12] },
  more: { alignSelf: 'flex-start' },
  sample: { gap: t.space[8] },
  rail: { flexDirection: 'row', gap: t.space[12] },
  railSkeleton: { flexDirection: 'row', gap: t.space[12], overflow: 'hidden' },
  productColumns: { alignItems: 'flex-start', flexDirection: 'row', gap: PRODUCT_COLUMN_GAP },
  productColumn: { flex: 1, minWidth: 0 },
}));

/** The rail's photos without the lead's own build, one per build. */
export function railPhotos(lead: BuildPhoto | null | undefined, photos: readonly BuildPhoto[] | undefined): BuildPhoto[] {
  const seen = new Set<string>(lead ? [lead.vehicle.id] : []);
  const out: BuildPhoto[] = [];
  for (const photo of photos ?? []) {
    if (seen.has(photo.vehicle.id)) continue;
    seen.add(photo.vehicle.id);
    out.push(photo);
  }
  return out;
}

/** Rows into `columns` lists of equal length (first column takes the extra row), in reading order down each column. */
export function splitColumns<T>(rows: readonly T[], columns: number): T[][] {
  if (columns <= 1) return [rows.slice()];
  const per = Math.ceil(rows.length / columns);
  return Array.from({ length: columns }, (_, index) => rows.slice(index * per, (index + 1) * per)).filter((column) => column.length > 0);
}

/**
 * DISC-01 scope "Teile" (09 §7.5, §8.9, ADR-457): photo first. The most-used product on a real build that carries it (MediaCard
 * `lead`, 4:5 edge to edge on a phone, 16:9 in the content width from 768, "In 20 Builds" tnum), the part brands most run on visible
 * builds as BrandTiles (BRD-01), "Beliebt in Builds" (a rail of build photos, one product each) and the products sorted by their
 * real build count, each with a 1:1 thumbnail from a real build (the glyph only where no build has one), the first 8 then "Alle
 * Teile". What is typed in Entdecken's search narrows tiles and products; photos stay out of a search. Only while `parts_catalogue`
 * is on.
 */
export function EmbeddedParts({ query: typed, width, phone, bleed, routeId }: { query: string; width: number; phone: boolean; bleed: number; routeId: string }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const qaState = useQaState();
  const online = useOnline();
  const { fontScale } = useTheme();
  const garage = useGarageEntry();
  const query = useDebouncedValue(typed, TYPING_MS);
  const [expanded, setExpanded] = useState(false);
  const id = `${routeId}.partsScope`;
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const brands = useTopBrands(live);
  const products = useProductSearch(query, null, live);
  const q = query.trim().toLowerCase();
  const steps = phone ? undefined : WIDE_COLUMN_STEPS;
  const tiles = useMemo<MakeTile[]>(
    () =>
      (qaState === 'empty' ? [] : (brands.data ?? []))
        .filter((brand) => !q || brand.name.toLowerCase().includes(q))
        .map((brand, index) => ({ id: index, slug: brand.slug, name: brand.name, vehicle_count: countOf(brand.builds) })),
    [brands.data, q, qaState],
  );
  const columns = useMemo(
    () => columnsFor(width, widestWordmarkWord(tiles.map((tile) => tile.name), wordmarkScale(fontScale)), steps),
    [fontScale, steps, tiles, width],
  );
  const shownTiles = tiles.slice(0, wholeRows(tiles.length, columns, phone ? TOP_MAKES_PHONE : Math.max(TOP_MAKES / 2, columns)));
  const rows = useMemo(() => (qaState === 'empty' ? [] : flattenById(products.data?.pages)), [products.data?.pages, qaState]);
  const first = products.data?.pages[0];
  const lead = !q && qaState !== 'empty' ? (first?.lead_photo ?? null) : null;
  const rail = useMemo(() => (q || qaState === 'empty' ? [] : railPhotos(lead, first?.build_photos)), [first?.build_photos, lead, q, qaState]);
  const openBrand = useCallback((tile: MakeTile) => router.push({ pathname: '/brands/[slug]', params: { slug: tile.slug } }), [router]);
  const openPhoto = useCallback(
    (photo: BuildPhoto) =>
      photo.product
        ? router.push({ pathname: '/products/[id]', params: { id: photo.product.id } })
        : router.push({ pathname: '/v/[slug]', params: { slug: photo.vehicle.slug } }),
    [router],
  );
  const countFor = (productId: string | undefined) => buildsLabel(rows.find((row) => row.id === productId)?.builds, t, (n) => format.number(n));
  const railWidth = railCardWidth(width, fontScale);
  const productColumns = phone ? 1 : 2;

  const loading = qaState === 'loading' || (live && ((brands.isPending && brands.fetchStatus !== 'paused') || (products.isPending && products.fetchStatus !== 'paused')));
  if (loading) {
    return (
      <View style={styles.root} testID={`${id}.skeleton`}>
        <View style={phone ? { marginHorizontal: -bleed } : null}>
          <MediaCardSkeleton variant="lead" wide={!phone} testID={`${id}.lead.skeleton`} />
        </View>
        <View style={styles.section}>
          <Skeleton>
            <SkeletonText variant="headline" width="25%" />
          </Skeleton>
          <MakeTilesSkeleton width={width} count={phone ? TOP_MAKES_PHONE : TOP_MAKES / 2} sample={SAMPLE_BRAND} steps={steps} testID={`${id}.brands.skeleton`} />
        </View>
        <View style={styles.section}>
          <Skeleton>
            <SkeletonText variant="headline" width="40%" />
          </Skeleton>
          <View style={[styles.railSkeleton, { marginHorizontal: -bleed, paddingHorizontal: bleed }]}>
            {Array.from({ length: RAIL_SKELETON }, (_, index) => (
              <Skeleton key={index} style={{ width: railWidth }}>
                <MediaCardSkeleton variant="rail" />
              </Skeleton>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Skeleton>
            <SkeletonText variant="headline" width="35%" />
          </Skeleton>
          <View style={styles.productColumns}>
            {Array.from({ length: productColumns }, (_, index) => (
              <RowCard key={index} style={styles.productColumn}>
                <ProductRowSkeleton rows={FIRST_PRODUCTS / productColumns} thumb />
              </RowCard>
            ))}
          </View>
        </View>
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
              <ProductRow icon="coilover" brand={sample.brand.name} name={sample.name} category={sample.category.name} photo={null} inset={space[16]} testID={`${id}.empty.sample`} />
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
  const shownRows = expanded || q ? rows : rows.slice(0, FIRST_PRODUCTS);
  const hidden = rows.length > shownRows.length || (!expanded && !q && products.hasNextPage);
  const leadTitle = lead?.product ? keepNameTogether(lead.product.full_name) : lead ? keepNameTogether(lead.vehicle.full_title) : '';
  const leadSpec = lead ? [lead.product ? countFor(lead.product.id) : null, lead.product ? lead.vehicle.full_title : null].filter(Boolean).join(' · ') : '';

  return (
    <View style={styles.root} testID={id}>
      {lead ? (
        <View style={phone ? { marginHorizontal: -bleed } : null}>
          <MediaCard
            variant="lead"
            title={leadTitle}
            spec={leadSpec || undefined}
            photo={photoFields(lead.photo, phone ? width + 2 * bleed : width)}
            sample={{ is_sample: lead.vehicle.is_sample }}
            wide={!phone}
            layoutWidth={phone ? width + 2 * bleed : width}
            onPress={() => openPhoto(lead)}
            testID={`${id}.lead`}
          />
        </View>
      ) : null}
      {shownTiles.length > 0 ? (
        <View style={styles.section}>
          <GroupHeader title={t('scope.brands')} />
          <MakeTiles makes={shownTiles} width={width} onOpen={openBrand} steps={steps} testID={`${id}.brands`} />
        </View>
      ) : null}
      {rail.length >= RAIL_MIN ? (
        <View style={styles.section} testID={`${id}.popular`}>
          <GroupHeader title={t('scope.popular')} />
          <View style={{ marginHorizontal: -bleed }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, { paddingHorizontal: bleed }]} role="list" testID={`${id}.popular.rail`}>
              {rail.map((photo) => (
                <View key={photo.vehicle.id} role="listitem" style={{ width: railWidth }}>
                  <MediaCard
                    variant="rail"
                    title={photo.product ? photo.product.full_name : photo.vehicle.full_title}
                    spec={photo.product ? photo.vehicle.full_title : undefined}
                    photo={photoFields(photo.photo, railWidth)}
                    sample={{ is_sample: photo.vehicle.is_sample }}
                    onPress={() => openPhoto(photo)}
                    testID={`${id}.popular.${photo.vehicle.id}`}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
      <View style={styles.section}>
        <GroupHeader title={q ? t('scope.productsMatching', { query: query.trim() }) : t('scope.products')} />
        {shownRows.length > 0 ? (
          <View style={styles.productColumns} testID={`${id}.products`}>
            {splitColumns(shownRows, productColumns).map((column, columnIndex) => (
              <RowCard key={columnIndex} style={styles.productColumn}>
                {column.map((product, index) => (
                  <ProductItem
                    key={product.id}
                    product={product}
                    builds={buildsLabel(product.builds, t, (n) => format.number(n))}
                    onPress={() => router.push({ pathname: '/products/[id]', params: { id: product.id } })}
                    divider={index < column.length - 1}
                    testID={`${id}.product.${product.id}`}
                  />
                ))}
              </RowCard>
            ))}
          </View>
        ) : (
          <Text variant="callout" color="text.secondary" testID={`${id}.products.none`}>
            {t('scope.partsNoMatchBody')}
          </Text>
        )}
        {hidden ? (
          <Button label={t('scope.allProducts')} variant="secondary" size="m" onPress={() => setExpanded(true)} style={styles.more} testID={`${id}.products.all`} />
        ) : products.hasNextPage ? (
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

/** One product row of the scope: brand wordmark, name, category, the real count and the build thumbnail. */
function ProductItem({ product, builds, onPress, divider, testID }: { product: ProductRowData; builds: string | null; onPress: () => void; divider: boolean; testID: string }) {
  return (
    <ProductRow
      icon={categoryIcon(product.category.icon)}
      brand={product.brand.name}
      name={product.name}
      category={product.category.name}
      builds={builds}
      photo={product.thumbnail ? photoFields(product.thumbnail, size.thumb.row) : null}
      onPress={onPress}
      divider={divider}
      inset={space[16]}
      testID={testID}
    />
  );
}
