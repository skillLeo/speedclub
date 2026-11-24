import '@/features/shop/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { isShopDisabled, useShopHead, type ShopCategoryKey } from '@/api/queries/shop';
import { estimatedPane } from '@/features/discover/layout';
import { BrowseErrorState } from '@/features/home/components/BrowseStates';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { TabRootScreen } from '@/features/shell/TabRootScreen';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { aspect, createStyles, layout, space, useBreakpoint, useTheme } from '@/theme';
import { Header, HeaderLargeTitle } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { useMotionPreference } from '@/ui/motion';

import { CategoryLead, CategoryLeadSkeleton, CategorySoon, CategorySoonSkeleton } from '../components/CategoryCard';
import { ShopClosed } from '../components/ShopClosed';
import { categoryParam, categoryTiles, cellWidth, soonForm } from '../model';
import { categoryPath, SHOP_FLAG } from '../navigation';

const ROUTE = 'SHOP-01';
const EDGES: readonly Edge[] = ['left', 'right'];
/** From 768: the 12-column grid's gutter between the coming tiles. */
const GRID_GAP = space[16];
/** On a phone the coming tiles sit edge to edge as a pair of the wall (09 §5: 2 apart). */
const WALL_GAP = space[2];
/** From 768 a coming tile is a quarter of the column (three columns of twelve), about a third of the lead's height. */
const WIDE_SOON_COLUMNS = 4;
/** While the head loads: the default shape, one lead and two coming tiles. */
const SKELETON_SOON = 2;

const useStyles = createStyles((t) => ({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  // The leads, 24 apart, then the coming tiles 24 under them.
  page: { gap: t.space[24], paddingBottom: t.space[32], paddingTop: t.space[8] },
  leads: { gap: t.space[24] },
  soonPair: { flexDirection: 'row', gap: WALL_GAP },
  soonWide: { flexDirection: 'row', gap: GRID_GAP },
  soonRows: { gap: t.space[12] },
  states: { paddingBottom: t.space[32], paddingTop: t.space[16] },
}));

/**
 * SHOP-01 Shop ★ (10 §3; ADR-502, ADR-519; R5-3). The tab is always there; the flag `shop` gates only the catalogue. Off (app-config,
 * or the server's 404 `feature_disabled`): the M5.2 shell. On: the three category cards. An old `/shop?category=…` link (a hero, a
 * share, a notification) forwards to that category's page SHOP-03.
 */
export function ShopScreen() {
  const flagOn = useFlag(SHOP_FLAG);
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string | string[] }>();
  const forward = categoryParam(params.category);
  // R5-3: the filter moved to its own page; replace, so back from SHOP-03 does not land on the forwarding address again.
  useEffect(() => {
    if (forward) router.replace(categoryPath(forward));
  }, [forward, router]);
  return flagOn ? <ShopCategories /> : <ShopClosedFrame />;
}

function ShopClosedFrame() {
  const { t } = useTranslation('shop');
  const common = useTranslation('common').t;
  const styles = useClosedStyles();
  return (
    <TabRootScreen routeId={ROUTE} title={common('tabs.shop')} offlineLabel={t('offline')} bodyTestID={`${ROUTE}.body`}>
      <View style={styles.column}>
        <ShopClosed />
      </View>
    </TabRootScreen>
  );
}

const useClosedStyles = createStyles(() => ({
  column: { alignSelf: 'flex-start', maxWidth: layout.feedColumn + 2 * layout.gutter.desktop, width: '100%' },
}));

/**
 * R5-3 (client round 5: "only 3 categories"), R5DQ-01: a calm entry with one focal point. The large title "Shop"; every available
 * category as the lead (full-bleed 4:5 on a phone, 16:9 on a tablet, 21:9 from 1280; its product photo, title.2, caret, one line),
 * in the server's order; under them the coming ones as a compact row of 1:1 tiles with "Bald verfügbar" on the photo, not
 * pressable (R4-3.2), stacked as rows at a large font. No product wall, no chips, no sticker block: SHOP-03 has those.
 */
function ShopCategories() {
  const { t } = useTranslation('shop');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const motion = useMotionPreference();
  const header = useCollapsingHeader();
  const inset = useTabBarInset();
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
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
  // From 768 the cards sit in the content column (up to 1200), start-aligned on the desktop, centred on a tablet.
  const inner = phone ? pane : Math.max(0, Math.min(layout.contentMax, pane - 2 * gutter));
  const soonCell = phone ? cellWidth(pane, 2, WALL_GAP) : cellWidth(inner, WIDE_SOON_COLUMNS, GRID_GAP);
  const form = soonForm(phone ? soonCell - gutter - space[12] : soonCell, fontScale);
  const soonCellStyle = { width: soonCell };
  // The column; the large title brings its own gutter, the cards take the column's from 768.
  const titleFrame = useMemo(
    () =>
      phone
        ? { width: '100%' as const }
        : { alignSelf: desktop ? ('flex-start' as const) : ('center' as const), maxWidth: layout.contentMax + 2 * gutter, width: '100%' as const },
    [desktop, gutter, phone],
  );
  const frame = useMemo(() => (phone ? titleFrame : [titleFrame, { paddingHorizontal: gutter }]), [gutter, phone, titleFrame]);
  // Phones: the full-width 4:5 lead. From 768 (R5DQ-27): a split, the 4:5 photo on about 5 of 12 columns, the words beside it.
  const leadAspect = aspect.hero;
  const splitWidth = phone ? undefined : Math.round(cellWidth(inner, 12, GRID_GAP) * 5 + GRID_GAP * 4);
  const corner = phone ? ('none' as const) : ('md' as const);
  const textInset = phone ? gutter : 0;
  const soonInsets = (index: number) =>
    phone ? { insetStart: index === 0 ? gutter : space[12], insetEnd: index === 0 ? space[12] : gutter } : { insetStart: 0, insetEnd: 0 };

  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const head = useShopHead(live);
  const headData = live ? head.data : undefined;
  const headCategories = headData?.categories;
  // `empty` (QA): no answer from the server, the app's defaults (three categories, stickers available).
  const tiles = useMemo(() => categoryTiles(qaState === 'empty' ? undefined : headCategories), [headCategories, qaState]);

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const open = useCallback((category: ShopCategoryKey) => router.push(categoryPath(category)), [router]);

  // ADR-519: the server switched the shop off since the app last read its config. The shell, not an error.
  if (isShopDisabled(head.error)) return <ShopClosedFrame />;

  const loading = qaState === 'loading' || (live && !head.data && head.isPending && head.fetchStatus === 'fetching');
  // The availability is the server's (R4-3.2): without an answer, the error or offline state, never a guess.
  const failed = qaState === 'error' || (live && !head.data && !loading && (head.isError || head.fetchStatus === 'paused' || !online));

  const soonRow = (keys: readonly ShopCategoryKey[] | number) => {
    const count = typeof keys === 'number' ? keys : keys.length;
    if (count === 0) return null;
    if (form === 'row' && typeof keys !== 'number') {
      return (
        <View style={[styles.soonRows, phone ? { paddingHorizontal: gutter } : null]} testID={`${ROUTE}.soon`}>
          {keys.map((key) => (
            <CategorySoon key={key} category={key} form="row" corner="md" insetStart={0} insetEnd={0} testID={`${ROUTE}.category.${key}`} />
          ))}
        </View>
      );
    }
    return (
      <View style={phone ? styles.soonPair : styles.soonWide} testID={typeof keys === 'number' ? undefined : `${ROUTE}.soon`}>
        {Array.from({ length: count }, (_, index) => {
          const key = typeof keys === 'number' ? null : keys[index];
          return (
            <View key={key ?? index} style={soonCellStyle}>
              {key ? (
                <CategorySoon
                  category={key}
                  form="tile"
                  titleVariant={desktop ? 'calloutStrong' : 'headline'}
                  corner={corner}
                  {...soonInsets(index)}
                  testID={`${ROUTE}.category.${key}`}
                />
              ) : (
                <CategorySoonSkeleton corner={corner} insetStart={soonInsets(index).insetStart} />
              )}
            </View>
          );
        })}
      </View>
    );
  };

  let body: ReactNode;
  if (loading) {
    body = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <View style={styles.page}>
          <CategoryLeadSkeleton photoAspect={leadAspect} corner={corner} inset={textInset} splitWidth={splitWidth} />
          {soonRow(SKELETON_SOON)}
        </View>
      </Skeleton>
    );
  } else if (failed) {
    body = (
      <View style={[styles.states, phone ? { paddingHorizontal: gutter } : null]}>
        <BrowseErrorState
          routeId={ROUTE}
          title={t('catalogue.errorTitle')}
          offline={qaState !== 'error' && (!online || head.fetchStatus === 'paused')}
          error={head.error}
          onRetry={() => void head.refetch()}
          retrying={head.isFetching}
        />
      </View>
    );
  } else {
    // R5DQ-01: the available categories lead (a second one later leads too), the coming ones follow; each group in the server's order.
    const leads = tiles.filter((tile) => tile.status === 'available').map((tile) => tile.key);
    const coming = tiles.filter((tile) => tile.status !== 'available').map((tile) => tile.key);
    body = (
      <View aria-label={t('catalogue.categoriesLabel')} style={styles.page} testID={`${ROUTE}.categories`}>
        {leads.length > 0 ? (
          <View style={styles.leads}>
            {leads.map((key) => (
              <CategoryLead
                key={key}
                category={key}
                live={live}
                photoAspect={leadAspect}
                corner={corner}
                width={inner}
                inset={textInset}
                splitWidth={splitWidth}
                onOpen={open}
                testID={`${ROUTE}.category.${key}`}
              />
            ))}
          </View>
        ) : null}
        {soonRow(coming)}
      </View>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        variant="large"
        title={common('tabs.shop')}
        scroll={header}
        contentMaxWidth={phone ? undefined : layout.contentMax + 2 * gutter}
        contentAlign={desktop ? 'start' : 'center'}
        testID={`${ROUTE}.header`}
      />
      <ShellOfflineBanner label={t('offline')} />
      <View style={styles.flex} onLayout={measurePane} testID={`${ROUTE}.body`}>
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: inset }]}
          testID={`${ROUTE}.list`}
        >
          <View style={titleFrame}>
            <HeaderLargeTitle title={common('tabs.shop')} scroll={header} testID={`${ROUTE}.title`} />
          </View>
          <View style={frame}>{body}</View>
        </Animated.ScrollView>
      </View>
    </Screen>
  );
}
