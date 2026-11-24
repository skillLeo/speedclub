import '@/features/shop/i18n';

import type { FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { isShopDisabled, useShopHead, useShopProducts, type ShopCategoryKey, type ShopProductCard } from '@/api/queries/shop';
import { estimatedPane, WALL_COLUMNS_BY_KIND, wideWallWidth } from '@/features/discover/layout';
import { BrowseErrorState } from '@/features/home/components/BrowseStates';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { aspect, createStyles, layout, space, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Header, HeaderLargeTitle } from '@/ui/Header';
import { MediaCard, MediaCardSkeleton } from '@/ui/MediaCard';
import { Photo } from '@/ui/Photo';
import { Screen } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { CollapsingFlashList, useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { useMotionPreference } from '@/ui/motion';

import { CATEGORY_PHOTOS } from '../components/CategoryCard';
import { ProductTile, ProductTileSkeleton } from '../components/ProductTile';
import { SamplePreview } from '../components/SamplePreview';
import { ShopClosed } from '../components/ShopClosed';
import { StickerPromo } from '../components/StickerPromo';
import { categoryParam, categoryStatus, categoryTiles, cellWidth, filledColumns, heroCopy, heroForCategory, rowsOf, shopPhoto, uniqueCards, wallColumns } from '../model';
import { productPath, SHOP_FLAG } from '../navigation';

const ROUTE = 'SHOP-03';
const EDGES: readonly Edge[] = ['left', 'right'];
/** 09 §5 wall: 2 px between the photos, 0 radius. */
const WALL_GAP = space[2];
/** Rows of tiles while the first page loads. */
const SKELETON_ROWS = 2;
const SHOP_PATH = '/shop';

type Row = { kind: 'row'; key: string; cards: readonly ShopProductCard[] };

const useStyles = createStyles((t) => ({
  flex: { flex: 1 },
  hero: { paddingBottom: t.space[16] },
  row: { flexDirection: 'row', gap: WALL_GAP, paddingBottom: t.space[24] },
  promo: { paddingBottom: t.space[24] },
  more: { alignItems: 'flex-start', paddingBottom: t.space[24] },
  states: { paddingBottom: t.space[32], paddingTop: t.space[16] },
  end: { paddingBottom: t.space[16] },
}));

/**
 * SHOP-03 Kategorie `/shop/c/[category]` (R5-3). The category SHOP-01's card opened. Flag off: the shell. A coming category (opened by
 * a link): "Bald verfügbar" with the way back, never an empty list. An available one: the admin's hero banner when it belongs here,
 * the wall of its products (SHOP-01's former wall: 2 columns of 4:5 photos, 3 from 768, 4 from 1280, name and "inkl. MwSt.") linking
 * to SHOP-02, and for stickers "Dein Sticker" under it: what the sticker does and the one order action (designer of the member's car,
 * else STK-01; guests sign in first).
 */
export function ShopCategoryScreen() {
  const { t } = useTranslation('shop');
  const flagOn = useFlag(SHOP_FLAG);
  const params = useLocalSearchParams<{ category?: string | string[] }>();
  const raw = paramOf(params.category);
  const category = categoryParam(raw);
  const back = useBack(SHOP_PATH);
  const title = category ? t(`categories.${category}`) : t('category.screenTitle');

  if (!flagOn) {
    return (
      <StateFrame title={title} onBack={back}>
        <ShopClosed routeId={ROUTE} />
      </StateFrame>
    );
  }
  if (!category) return <NotFound title={title} onBack={back} />;
  return <CategoryPage category={category} title={title} onBack={back} />;
}

/** A plain frame for the states without products: the large title with back, the offline banner, one column. */
function StateFrame({ title, onBack, padded = false, children }: { title: string; onBack: () => void; padded?: boolean; children: ReactNode }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const inset = useTabBarInset();
  const header = useCollapsingHeader();
  const { gutter, kind } = useBreakpoint();
  const column = useColumn(kind, gutter);
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" title={title} scroll={header} onBack={onBack} contentMaxWidth={column.headerWidth} contentAlign={column.align} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('offline')} />
      <Animated.ScrollView {...header.scrollProps} style={styles.flex} contentContainerStyle={{ paddingBottom: inset }} testID={`${ROUTE}.scroll`}>
        <View style={column.frame}>
          <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />
        </View>
        <View style={[column.frame, padded ? [styles.states, { paddingHorizontal: gutter }] : null]} testID={`${ROUTE}.body`}>
          {children}
        </View>
      </Animated.ScrollView>
    </Screen>
  );
}

function useColumn(kind: ReturnType<typeof useBreakpoint>['kind'], gutter: number) {
  return useMemo(() => {
    if (kind === 'phone') return { frame: { width: '100%' as const }, headerWidth: undefined, align: 'center' as const };
    return {
      frame: { alignSelf: kind === 'desktop' ? ('flex-start' as const) : ('center' as const), maxWidth: layout.contentMax + 2 * gutter, width: '100%' as const },
      headerWidth: layout.contentMax + 2 * gutter,
      align: kind === 'desktop' ? ('start' as const) : ('center' as const),
    };
  }, [gutter, kind]);
}

function NotFound({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation('shop');
  const router = useRouter();
  return (
    <StateFrame title={title} onBack={onBack} padded>
      <EmptyState
        icon="bag"
        title={t('category.notFoundTitle')}
        body={t('category.notFoundBody')}
        action={{ label: t('product.toShop'), onPress: () => router.navigate(SHOP_PATH), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.notFound`}
      />
    </StateFrame>
  );
}

/** R4-3.2, R5-3: a category that is not in the shop yet, opened by a link. Its photo, "Bald verfügbar", and the way back. */
function ComingSoon({ category, title, onBack }: { category: ShopCategoryKey; title: string; onBack: () => void }) {
  const { t } = useTranslation('shop');
  const router = useRouter();
  return (
    <StateFrame title={title} onBack={onBack} padded>
      <EmptyState
        preview={
          <View aria-hidden>
            {/* R5DQ-09: no pill over the headline; "Kleidung kommt bald" says it. */}
            <Photo {...CATEGORY_PHOTOS[category]} aspect={aspect.editorial} corner="md" testID={`${ROUTE}.soon.photo`} />
          </View>
        }
        title={t(`category.soon.${category}`)}
        body={t('category.soonBody')}
        action={{ label: t('product.toShop'), onPress: () => router.navigate(SHOP_PATH), variant: 'secondary', size: 'm' }}
        testID={`${ROUTE}.soon`}
      />
    </StateFrame>
  );
}

function CategoryPage({ category, title, onBack }: { category: ShopCategoryKey; title: string; onBack: () => void }) {
  const { t, i18n } = useTranslation('shop');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const listRef = useRef<FlashListRef<Row>>(null);
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const { fontScale } = useTheme();
  const phone = kind === 'phone';
  const desktop = kind === 'desktop';

  const [measuredPane, setMeasuredPane] = useState<number | null>(null);
  const pane = measuredPane ?? estimatedPane(kind, windowWidth);
  const measurePane = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) setMeasuredPane(width);
  };
  const wallWidth = phone ? pane : wideWallWidth(pane, gutter);
  const baseColumns = WALL_COLUMNS_BY_KIND[kind];
  const twoUpText = cellWidth(wallWidth, baseColumns, WALL_GAP) - gutter - space[12];
  const fontColumns = wallColumns(baseColumns, phone, twoUpText, fontScale);
  const column = useColumn(kind, gutter);
  const padded = useMemo(() => (phone ? null : { paddingHorizontal: gutter }), [gutter, phone]);
  const gutterPad = useMemo(() => ({ paddingHorizontal: gutter }), [gutter]);

  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const head = useShopHead(live);
  const headData = live ? head.data : undefined;
  const headCategories = headData?.categories;
  const tiles = useMemo(() => categoryTiles(headCategories), [headCategories]);
  // The server's status once the head is in; before that the default (stickers available), so the wall starts loading at once.
  const status = qaState === 'empty' || qaState === 'error' || qaState === 'loading' ? 'available' : categoryStatus(category, tiles);
  const available = status === 'available';
  const products = useShopProducts(category, live && available);
  const cards = useMemo(() => (live ? uniqueCards(products.data?.pages) : []), [live, products.data?.pages]);
  const columns = filledColumns(fontColumns, phone, cards.length, products.isSuccess && !products.hasNextPage);
  const cell = cellWidth(wallWidth, columns, WALL_GAP);
  const cellStyle = useMemo(() => ({ width: cell }), [cell]);
  const rows = useMemo<Row[]>(
    () => rowsOf(cards, columns).map((group, index) => ({ kind: 'row', key: group[0]?.id ?? String(index), cards: group })),
    [cards, columns],
  );
  const sticker = category === 'sticker';

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    listRef.current?.scrollToOffset({ offset: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const openProduct = useCallback((product: ShopProductCard) => router.push(productPath(product.slug)), [router]);
  const retry = () => {
    void head.refetch();
    void products.refetch();
  };

  // ADR-519: the server switched the shop off since the app last read its config. The shell, not an error.
  if (isShopDisabled(head.error) || isShopDisabled(products.error)) {
    return (
      <StateFrame title={title} onBack={onBack}>
        <ShopClosed routeId={ROUTE} />
      </StateFrame>
    );
  }
  // A category the app expects later is only called "Bald verfügbar" once the server has said so (or cannot be asked).
  const awaitingHead = live && !head.data && head.isPending && head.fetchStatus === 'fetching';
  const headUnknown = live && !head.data && !awaitingHead && (head.isError || head.fetchStatus === 'paused' || !online);
  if (!available && headUnknown) {
    return (
      <StateFrame title={title} onBack={onBack} padded>
        <BrowseErrorState
          routeId={ROUTE}
          title={t('category.errorTitle')}
          offline={!online || head.fetchStatus === 'paused'}
          error={head.error}
          onRetry={() => void head.refetch()}
          retrying={head.isFetching}
        />
      </StateFrame>
    );
  }
  if (!available && !awaitingHead) return <ComingSoon category={category} title={title} onBack={onBack} />;

  const firstLoad =
    qaState === 'loading' || (!available && awaitingHead) || (live && !products.data && products.isPending && products.fetchStatus === 'fetching');
  const failed = qaState === 'error' || (live && !products.data && !firstLoad && (products.isError || products.fetchStatus === 'paused' || !online));
  let state: ReactNode = null;
  if (failed) {
    state = (
      <View style={[styles.states, gutterPad]}>
        <BrowseErrorState
          routeId={ROUTE}
          title={t('category.errorTitle')}
          offline={qaState !== 'error' && (!online || products.fetchStatus === 'paused')}
          error={products.error}
          onRetry={retry}
          retrying={products.isFetching}
        />
      </View>
    );
  } else if (qaState === 'empty' || (!firstLoad && cards.length === 0)) {
    // 09 §5 EmptyState: what a product will look like (badged "Beispiel") and one line. For stickers "Dein Sticker" follows with
    // the order action, so the state brings no second one; elsewhere the way back to the shop.
    state = (
      <View style={[styles.states, gutterPad]}>
        <EmptyState
          preview={<SamplePreview testID={`${ROUTE}.empty.sample`} />}
          title={t(sticker ? 'empty.title' : 'catalogue.filteredEmptyTitle')}
          body={t(sticker ? 'empty.body' : 'catalogue.filteredEmptyBody')}
          action={sticker ? undefined : { label: t('product.toShop'), onPress: () => router.navigate(SHOP_PATH), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.empty`}
        />
      </View>
    );
  }

  const gridSkeleton = (count: number) => (
    <View style={[column.frame, padded]}>
      {Array.from({ length: count }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: columns }, (__, index) => (
            <View key={index} style={cellStyle}>
              <ProductTileSkeleton {...insetsOf(index, columns, phone, gutter)} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  // R5-3: the admin's banner leads the page it belongs to (heroForCategory); R4B-008: its words in the app's language.
  const placed = headData ? heroForCategory(headData.hero, category, cards) : null;
  const heroWords = placed ? heroCopy(placed.hero, i18n.language) : null;
  const heroSlug = placed?.hero.link.product?.slug;
  // While the page loads: a banner may lead it until the head says there is none, or one that belongs to another category.
  const headHero = headData?.hero;
  const heroMayLead =
    qaState === 'loading' ||
    (!headData && live) ||
    (!!headHero && (headHero.link.kind === 'product' || (headHero.link.kind === 'category' && headHero.link.category === category)));
  const hero = placed ? (
    <View style={[styles.hero, padded]}>
      <MediaCard
        variant="lead"
        wide
        cinema
        title={heroWords && !heroWords.admin ? t(`hero.${heroWords.key}.title`) : placed.hero.title}
        spec={heroWords && !heroWords.admin ? t(`hero.${heroWords.key}.subtitle`) : (placed.hero.subtitle ?? undefined)}
        photo={shopPhoto(placed.hero.image, wallWidth)}
        sample={{ is_sample: placed.hero.is_sample }}
        layoutWidth={wallWidth}
        priority="high"
        onPress={placed.opens === 'product' && heroSlug ? () => router.push(productPath(heroSlug)) : undefined}
        testID={`${ROUTE}.hero`}
      />
    </View>
  ) : null;

  // "Dein Sticker" (R4-3.2): what the sticker does and the one order action, under the wall and under the empty state, never over an
  // error. Under the hero, which already says "Dein Build. Dein Sticker.", the block has no headline of its own (R4DQ-13).
  const promo =
    sticker && !firstLoad && !failed ? (
      <View style={[column.frame, styles.promo, gutterPad]}>
        <StickerPromo titled={!hero} testID={`${ROUTE}.promo`} />
      </View>
    ) : null;

  const listHeader = (
    <View>
      <View style={column.frame}>
        <HeaderLargeTitle title={title} scroll={header} testID={`${ROUTE}.title`} />
      </View>
      <View style={column.frame}>
        {hero}
        {firstLoad ? (
          <Skeleton testID={`${ROUTE}.skeleton`} label={t('category.loading')}>
            {/* R5DQ-18: the banner's geometry above the wall while it may still come, so the wall does not jump when it does. */}
            {heroMayLead ? (
              <View style={[padded, styles.hero]} testID={`${ROUTE}.skeleton.hero`}>
                <MediaCardSkeleton variant="lead" wide cinema owner={false} />
              </View>
            ) : null}
            {gridSkeleton(SKELETON_ROWS)}
          </Skeleton>
        ) : null}
      </View>
    </View>
  );

  const footer = (
    <View>
      {!state && products.isFetchingNextPage ? <Skeleton testID={`${ROUTE}.more`}>{gridSkeleton(1)}</Skeleton> : null}
      {!state && products.isFetchNextPageError ? (
        <View style={[column.frame, styles.more, gutterPad]}>
          <Button label={common('actions.retry')} variant="secondary" size="m" onPress={() => void products.fetchNextPage()} testID={`${ROUTE}.moreRetry`} />
        </View>
      ) : null}
      {promo}
      <View style={styles.end} />
    </View>
  );

  const renderItem = ({ item }: { item: Row }) => (
    <View style={[column.frame, padded]}>
      {/* Review M5.5: no list role per row (FlashList recycles each row as an element of its own); each card is a link. */}
      <View style={styles.row}>
        {item.cards.map((card, index) => (
          <View key={card.id} style={cellStyle}>
            <ProductTile product={card} width={cell} {...insetsOf(index, columns, phone, gutter)} onOpen={openProduct} testID={`${ROUTE}.product.${card.slug}`} />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header variant="large" title={title} scroll={header} onBack={onBack} contentMaxWidth={column.headerWidth} contentAlign={desktop ? 'start' : 'center'} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('offline')} />
      <View style={styles.flex} onLayout={measurePane} testID={`${ROUTE}.body`}>
        <CollapsingFlashList
          ref={listRef}
          {...header.scrollProps}
          data={state || firstLoad ? [] : rows}
          keyExtractor={(row: Row) => row.key}
          extraData={`${cell}|${columns}`}
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: inset }}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={state ? <View style={column.frame}>{state}</View> : null}
          ListFooterComponent={footer}
          onEndReached={() => {
            if (products.hasNextPage && !products.isFetchingNextPage && !products.isFetchNextPageError) void products.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          renderItem={renderItem}
          testID={`${ROUTE}.list`}
        />
      </View>
    </Screen>
  );
}

/** The text inset of a cell: on an edge-to-edge phone wall the outer cells line up with the page's gutter. */
function insetsOf(index: number, columns: number, phone: boolean, gutter: number): { insetStart: number; insetEnd: number } {
  if (!phone) return { insetStart: 0, insetEnd: space[12] };
  return { insetStart: index === 0 ? gutter : space[12], insetEnd: index === columns - 1 ? gutter : space[12] };
}
