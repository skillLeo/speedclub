import '@/features/parts/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';

import { flattenById, usePartsOn, useProduct, useProductBuilds, type ProductDetail } from '@/api/queries/parts';
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
import { Button, Icon, PressableScale, Skeleton, SkeletonBlock, SkeletonText, SpecRow, StatusPill, Text } from '@/ui';

import { BuildsEmpty, BuildsWall } from '../components/BuildsWall';
import { PageStateBody, pageStateOf } from '../components/PageStates';
import { PartsPage } from '../components/PartsPage';
import { buildsLabel, websiteUrl } from '../model';
import { openUrl } from '../openUrl';

const ROUTE = 'BRD-02';
const SKELETON_ATTRIBUTES = 4;

const useStyles = createStyles((t) => ({
  column: { gap: t.space[32], paddingTop: t.space[16] },
  head: { gap: t.space[8] },
  brand: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: t.size.touchMin, minWidth: t.size.touchMin },
  category: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  meta: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  groupHeader: { marginBottom: t.space[12] },
  links: { alignItems: 'flex-start', gap: t.space[12] },
  affiliate: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  states: { paddingTop: t.space[16] },
}));

/**
 * BRD-02 Produkt `/products/[id]` (09 §7.11, §8.9): the brand (a link to BRD-01) as its wordmark, the product in title.1, category and
 * line with the real count "In 14 Builds", the key attributes table from the catalogue, the maker's page, the affiliate link only while
 * `affiliate_links` is on and then labelled "Anzeige", and "Builds mit {Produkt}". An archived product still answers (mods link it); a
 * merged one answers as its survivor, and the address follows it.
 */
export function ProductScreen() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = paramOf(params.id) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const flag = usePartsOn();
  const restriction = useBrowseRestriction();
  const back = useBack('/discover');
  const column = useDiscoverColumn();
  const query = useProduct(id);
  const state = pageStateOf(query, flag, online, qaState);
  const product = state === 'ready' ? query.data : undefined;
  const survivor = product && product.id !== id ? product.id : null;

  useEffect(() => {
    if (survivor) router.setParams({ id: survivor });
  }, [router, survivor]);

  return (
    <PartsPage routeId={ROUTE} title={product ? keepNameTogether(product.full_name) : t('product.screenTitle')} onBack={back} offlineLabel={t('states.offlineBanner')}>
      {(collapseOn) => (
        <View style={[column.style, styles.column]}>
          {restriction ? <RestrictionNotice message={restriction} testID={`${ROUTE}.restricted`} /> : null}
          {product ? (
            <ProductBody product={product} collapseOn={collapseOn} />
          ) : state === 'loading' ? (
            <ProductSkeleton />
          ) : (
            <View style={styles.states}>
              <PageStateBody
                state={state === 'ready' ? 'error' : state}
                routeId={ROUTE}
                icon="part-box"
                area="parts"
                notFound={{
                  title: t('product.notFoundTitle'),
                  body: t('product.notFoundBody'),
                  preview: <SampleWall testID={`${ROUTE}.notFound.sample`} />,
                  actionLabel: t('brand.toDiscover'),
                  onAction: () => router.navigate('/discover'),
                }}
                errorTitle={t('product.errorTitle')}
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

function ProductSkeleton() {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.column} aria-label={t('product.loading')}>
        <View style={styles.head}>
          <SkeletonText variant="displayWordmark" width="20%" />
          <SkeletonText variant="title1" width="65%" />
          <SkeletonText variant="callout" width="45%" />
        </View>
        <View>
          <SkeletonText variant="headline" width="35%" style={styles.groupHeader} />
          <SkeletonBlock width="100%" height={SKELETON_ATTRIBUTES * size.row.single} corner="md" />
        </View>
      </View>
    </Skeleton>
  );
}

function ProductBody({ product, collapseOn }: { product: ProductDetail; collapseOn: (event: LayoutChangeEvent) => void }) {
  const { t } = useTranslation('parts');
  const styles = useStyles();
  const router = useRouter();
  const format = useFormat();
  const column = useDiscoverColumn();
  const { width, kind } = useBreakpoint();
  const builds = useProductBuilds(product.id);
  const buildRows = useMemo(() => flattenById(builds.data?.pages).filter((vehicle) => vehicle.cover), [builds.data?.pages]);
  const count = buildsLabel(product.builds, t, (n) => format.number(n));
  const official = websiteUrl(product.url);
  const affiliate = product.affiliate ? websiteUrl(product.affiliate.url) : null;
  const phone = kind === 'phone';
  const caption = [product.line, count].filter(Boolean).join(' · ');

  return (
    <>
      <View style={styles.head} onLayout={collapseOn}>
        <PressableScale
          role="link"
          aria-label={t('product.brandLabel', { brand: product.brand.name })}
          onPress={() => router.push({ pathname: '/brands/[slug]', params: { slug: product.brand.slug } })}
          style={styles.brand}
          testID={`${ROUTE}.brand`}
        >
          <Text variant="displayWordmark" color="text.secondary" hyphenate={false}>
            {product.brand.name}
          </Text>
        </PressableScale>
        <Text variant="title1" role="heading" {...({ 'aria-level': 1 } as object)} testID={`${ROUTE}.title`}>
          {product.name}
        </Text>
        <View style={styles.category}>
          <Icon name={categoryIcon(product.category.icon)} size={20} color="text.secondary" />
          <Text variant="callout" color="text.secondary">
            {product.category.name}
          </Text>
        </View>
        {caption || product.status === 'archived' ? (
          <View style={styles.meta}>
            {caption ? (
              <Text variant="callout" color="text.secondary" numeric testID={`${ROUTE}.count`}>
                {caption}
              </Text>
            ) : null}
            {product.status === 'archived' ? <StatusPill label={t('product.archived')} testID={`${ROUTE}.archived`} /> : null}
          </View>
        ) : null}
      </View>

      {product.attributes.length > 0 ? (
        <View testID={`${ROUTE}.attributes`}>
          <GroupHeader title={t('product.attributes')} style={styles.groupHeader} />
          <RowCard>
            {product.attributes.map((row, index) => (
              <SpecRow
                key={`${row.label}.${index}`}
                label={row.label}
                value={row.value}
                divider={index < product.attributes.length - 1}
                inset={space[16]}
                testID={`${ROUTE}.attribute.${index}`}
              />
            ))}
          </RowCard>
        </View>
      ) : null}

      {official || affiliate ? (
        <View style={styles.links}>
          {official ? (
            <Button
              label={t('product.official')}
              icon="arrow-square-out"
              variant="secondary"
              size="m"
              role="link"
              accessibilityLabel={t('product.officialLabel', { brand: product.brand.name })}
              onPress={() => void openUrl(official, t('links.failed'), `${ROUTE}.toast`)}
              testID={`${ROUTE}.official`}
            />
          ) : null}
          {affiliate && product.affiliate ? (
            // 09 §8.9 / UWG: a paid link is labelled "Anzeige" where it stands; the Blade page carries rel="sponsored".
            <View style={styles.affiliate} testID={`${ROUTE}.affiliate`}>
              <Button
                label={t('product.buy')}
                icon="arrow-square-out"
                variant="tertiary"
                size="m"
                role="link"
                accessibilityLabel={t('product.buyLabel', { label: product.affiliate.label })}
                onPress={() => void openUrl(affiliate, t('links.failed'), `${ROUTE}.toast`)}
                testID={`${ROUTE}.affiliate.link`}
              />
              <Text variant="labelBadge" color="text.secondary" testID={`${ROUTE}.affiliate.label`}>
                {product.affiliate.label}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <BuildsWall
        title={t('product.builds', { product: keepNameTogether(product.full_name) })}
        vehicles={buildRows}
        width={phone ? width : column.inner}
        columns={WALL_COLUMNS_BY_KIND[kind]}
        loading={builds.isPending && builds.fetchStatus !== 'paused'}
        hasMore={builds.hasNextPage}
        loadingMore={builds.isFetchingNextPage}
        onMore={() => void builds.fetchNextPage()}
        bleed={phone ? column.gutter : 0}
        empty={<BuildsEmpty routeId={ROUTE} name={product.full_name} failed={builds.isError} onRetry={() => void builds.refetch()} />}
        testID={`${ROUTE}.builds`}
      />
    </>
  );
}
