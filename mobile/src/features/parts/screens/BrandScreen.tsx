import '@/features/parts/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import {
  countOf,
  flattenById,
  useBrand,
  useBrandBuilds,
  useBrandProducts,
  usePartsOn,
  type BrandPage,
} from '@/api/queries/parts';
import { SampleWall } from '@/features/discover/components/SampleWall';
import { useDiscoverColumn, WALL_COLUMNS_BY_KIND } from '@/features/discover/layout';
import { RestrictionNotice, useBrowseRestriction } from '@/features/home/components/BrowseStates';
import { GroupHeader, RowCard } from '@/features/vehicle/components/RowCard';
import { categoryIcon } from '@/features/vehicle/model';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { keepNameTogether } from '@/lib/format';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { createStyles, size, space, useBreakpoint } from '@/theme';
import {
  Button,
  DisplayTitle,
  ProductRow,
  ProductRowSkeleton,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  SpecRow,
  Text,
} from '@/ui';

import { BuildsEmpty, BuildsWall } from '../components/BuildsWall';
import { PageStateBody, pageStateOf } from '../components/PageStates';
import { PartsPage } from '../components/PartsPage';
import { buildsLabel, websiteLabel, websiteUrl } from '../model';
import { openUrl } from '../openUrl';

const ROUTE = 'BRD-01';
const SKELETON_PRODUCTS = 4;

const useStyles = createStyles((t) => ({
  column: { gap: t.space[32], paddingTop: t.space[16] },
  // 09 §7.11 BRD-01: the brand's wordmark in display.title on a surface-1 band.
  band: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[8], padding: t.space[20] },
  website: { alignSelf: 'flex-start', marginTop: t.space[8] },
  groupHeader: { marginBottom: t.space[12] },
  more: { alignSelf: 'flex-start', marginTop: t.space[12] },
  states: { paddingTop: t.space[16] },
}));

/**
 * BRD-01 Marke `/brands/[slug]` (09 §7.11, §8.9): the part brand as its text wordmark (display.title, no maker mark) on a surface-1
 * band with its real counts, the catalogue's about line and the website, the product lines, the active products (each opens BRD-02,
 * "In 14 Builds") and "Builds mit {Marke}", the visible builds that run it, as a photo wall.
 */
export function BrandScreen() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = (paramOf(params.slug) ?? '').toLowerCase();
  const qaState = useQaState();
  const online = useOnline();
  const flag = usePartsOn();
  const restriction = useBrowseRestriction();
  const back = useBack('/discover');
  const column = useDiscoverColumn();
  const query = useBrand(slug);
  const state = pageStateOf(query, flag, online, qaState);
  const brand = state === 'ready' ? query.data : undefined;

  return (
    <PartsPage routeId={ROUTE} title={brand ? keepNameTogether(brand.name) : t('brand.screenTitle')} onBack={back} offlineLabel={t('states.offlineBanner')}>
      {(collapseOn) => (
        <View style={[column.style, styles.column]}>
          {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
          {brand ? (
            <BrandBody brand={brand} collapseOn={collapseOn} />
          ) : state === 'loading' ? (
            <BrandSkeleton />
          ) : (
            <View style={styles.states}>
              <PageStateBody
                state={state === 'ready' ? 'error' : state}
                routeId={ROUTE}
                icon="part-box"
                area="parts"
                notFound={{
                  title: t('brand.notFoundTitle'),
                  body: t('brand.notFoundBody'),
                  preview: <SampleWall testID={`${ROUTE}.notFound.sample`} />,
                  actionLabel: t('brand.toDiscover'),
                  onAction: () => router.navigate('/discover'),
                }}
                errorTitle={t('brand.errorTitle')}
                error={query.error}
                onRetry={() => void query.refetch()}
                retrying={query.isFetching}
              />
            </View>
          )}
        </View>
      )}
    </PartsPage>
  );
}

function BrandSkeleton() {
  const styles = useStyles();
  const { t } = useTranslation('parts');
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.column} aria-label={t('brand.loading')}>
        <View style={styles.band}>
          <SkeletonText variant="displayTitle" width="45%" />
          <SkeletonText variant="callout" width="40%" />
          <SkeletonText variant="body" lines={2} lastLineWidth="70%" />
          <SkeletonBlock width="30%" height={size.button.s} corner="sm" style={styles.website} />
        </View>
        <View>
          <SkeletonText variant="headline" width="30%" style={styles.groupHeader} />
          <RowCard>
            <ProductRowSkeleton rows={SKELETON_PRODUCTS} />
          </RowCard>
        </View>
      </View>
    </Skeleton>
  );
}

function BrandBody({ brand, collapseOn }: { brand: BrandPage; collapseOn: (event: LayoutChangeEvent) => void }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const column = useDiscoverColumn();
  const { width, kind } = useBreakpoint();
  const products = useBrandProducts(brand.slug);
  const builds = useBrandBuilds(brand.slug);
  const productRows = useMemo(() => flattenById(products.data?.pages), [products.data?.pages]);
  const buildRows = useMemo(() => flattenById(builds.data?.pages).filter((vehicle) => vehicle.cover), [builds.data?.pages]);
  const buildCount = countOf(brand.builds);
  const productCount = countOf(brand.products);
  const site = websiteUrl(brand.website);
  const phone = kind === 'phone';
  const wallWidth = phone ? width : column.inner;
  const counts = [
    buildCount > 0 ? t('counts.builds', { count: buildCount, value: format.number(buildCount) }) : null,
    productCount > 0 ? t('counts.products', { count: productCount, value: format.number(productCount) }) : null,
  ].filter(Boolean);

  return (
    <>
      <View style={styles.band} onLayout={collapseOn} testID={`${ROUTE}.band`}>
        <DisplayTitle placement="page" layoutWidth={column.inner - 2 * space[20]} role="heading" {...({ 'aria-level': 1 } as object)} testID={`${ROUTE}.title`}>
          {brand.name}
        </DisplayTitle>
        {counts.length > 0 ? (
          <Text variant="callout" color="text.secondary" numeric testID={`${ROUTE}.counts`}>
            {counts.join(' · ')}
          </Text>
        ) : null}
        {brand.about ? (
          <Text variant="body" testID={`${ROUTE}.about`}>
            {brand.about}
          </Text>
        ) : null}
        {site ? (
          <Button
            label={websiteLabel(site)}
            icon="arrow-square-out"
            variant="secondary"
            size="s"
            role="link"
            accessibilityLabel={t('brand.websiteLabel', { brand: brand.name })}
            onPress={() => void openUrl(site, t('links.failed'), `${ROUTE}.toast`)}
            style={styles.website}
            testID={`${ROUTE}.website`}
          />
        ) : null}
      </View>

      {brand.lines.length > 0 ? (
        <View testID={`${ROUTE}.lines`}>
          <GroupHeader title={t('brand.lines')} style={styles.groupHeader} />
          <RowCard>
            {brand.lines.map((line, index) => (
              <SpecRow
                key={line.name}
                label={line.name}
                value={t('counts.products', { count: line.products, value: format.number(line.products) })}
                divider={index < brand.lines.length - 1}
                inset={space[16]}
                testID={`${ROUTE}.line.${index}`}
              />
            ))}
          </RowCard>
        </View>
      ) : null}

      <View testID={`${ROUTE}.products`}>
        <GroupHeader title={t('brand.products')} style={styles.groupHeader} />
        {products.isPending && products.fetchStatus !== 'paused' ? (
          <RowCard>
            <ProductRowSkeleton rows={SKELETON_PRODUCTS} />
          </RowCard>
        ) : productRows.length > 0 ? (
          <RowCard>
            {productRows.map((product, index) => (
              <ProductRow
                key={product.id}
                icon={categoryIcon(product.category.icon)}
                brand={product.brand.name}
                name={product.name}
                category={product.line ? `${product.category.name} · ${product.line}` : product.category.name}
                builds={buildsLabel(product.builds, t, (n) => format.number(n))}
                onPress={() => router.push({ pathname: '/products/[id]', params: { id: product.id } })}
                divider={index < productRows.length - 1}
                inset={space[16]}
                testID={`${ROUTE}.product.${product.id}`}
              />
            ))}
          </RowCard>
        ) : (
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.products.empty`}>
            {products.isError ? t('brand.productsError') : t('brand.productsEmpty')}
          </Text>
        )}
        {products.hasNextPage ? (
          <Button
            label={t('brand.moreProducts')}
            variant="secondary"
            size="m"
            loading={products.isFetchingNextPage}
            onPress={() => void products.fetchNextPage()}
            style={styles.more}
            testID={`${ROUTE}.products.more`}
          />
        ) : null}
      </View>

      <BuildsWall
        title={t('brand.builds', { brand: keepNameTogether(brand.name) })}
        count={buildCount > 0 ? t('counts.builds', { count: buildCount, value: format.number(buildCount) }) : null}
        vehicles={buildRows}
        width={wallWidth}
        columns={WALL_COLUMNS_BY_KIND[kind]}
        loading={builds.isPending && builds.fetchStatus !== 'paused'}
        hasMore={builds.hasNextPage}
        loadingMore={builds.isFetchingNextPage}
        onMore={() => void builds.fetchNextPage()}
        bleed={phone ? column.gutter : 0}
        empty={<BuildsEmpty routeId={ROUTE} name={brand.name} failed={builds.isError} onRetry={() => void builds.refetch()} />}
        testID={`${ROUTE}.builds`}
      />
    </>
  );
}
