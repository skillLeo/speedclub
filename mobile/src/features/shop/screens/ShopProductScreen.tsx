import '@/features/shop/i18n';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { isProductUnavailable, isShopDisabled, useShopProduct, type ShopProduct } from '@/api/queries/shop';
import { estimatedPane } from '@/features/discover/layout';
import { BrowseErrorState } from '@/features/home/components/BrowseStates';
import { useTabScrollToTop } from '@/features/shell/retap';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { useEstimatedOverlayHeight } from '@/features/vehicle/components/ProfileFrame';
import { paramOf, useBack } from '@/features/vehicle/navigation';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth } from '@/state/session';
import { createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { Header } from '@/ui/Header';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Screen } from '@/ui/Screen';
import { Skeleton, SkeletonBlock, SkeletonText } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { useCollapsingHeader } from '@/ui/useCollapsingHeader';
import { useMotionPreference } from '@/ui/motion';

import { ShopClosed } from '../components/ShopClosed';
import { ShopGallery } from '../components/ShopGallery';
import { buyAction, chosenBuy, httpsHost, paragraphs, type BuyAction } from '../model';
import { categoryPath, SHOP_FLAG } from '../navigation';
import { openShopUrl } from '../openShopUrl';

const ROUTE = 'SHOP-02';
const EDGES: readonly Edge[] = ['left', 'right'];
/** Desktop: the photos take 7 of 12 columns, the facts and the action 5 (as MEM-01's split). */
const DESKTOP_GALLERY_SHARE = 7 / 12;
const DESKTOP_GAP = space[40];

const useStyles = createStyles((t) => ({
  flex: { flex: 1 },
  clip: { overflow: 'hidden' },
  scrollContent: { flexGrow: 1 },
  info: { gap: t.space[24], paddingBottom: t.space[48], paddingTop: t.space[24] },
  identity: { gap: t.space[8] },
  price: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[2] },
  variants: { gap: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  buy: { gap: t.space[8] },
  shipping: { alignSelf: 'flex-start' },
  description: { gap: t.space[12] },
  split: { alignItems: 'flex-start', flexDirection: 'row', gap: DESKTOP_GAP, paddingTop: t.space[16] },
  desktopInfo: { flex: 1, minWidth: 0 },
  states: { paddingBottom: t.space[32], paddingTop: t.space[16] },
  skeletonPages: { height: t.size.touchMin },
}));

/**
 * SHOP-02 Produkt `/shop/[product]` (10 §3, contract §3.3): the gallery (swipe, zoom), the name, the gross price "inkl. MwSt., zzgl.
 * Versand" (PAngV), the variants as chips (informational; a chosen one takes the cart permalink the server built for it), the one
 * primary action from the server's `buy`, the store's shipping page (`shipping_url`, the shipping policy only, hence "Versand"), the description. No cart, no payment and no
 * price maths in the app: "Im Shop kaufen" opens the server's https address in the in-app browser (native) or a new tab (web).
 */
export function ShopProductScreen() {
  const { t } = useTranslation('shop');
  const flagOn = useFlag(SHOP_FLAG);
  const params = useLocalSearchParams<{ product?: string | string[] }>();
  const idOrSlug = paramOf(params.product) ?? '';
  const qaState = useQaState();
  const online = useOnline();
  const router = useRouter();
  const live = qaState === 'default' || qaState === 'offline' || qaState === 'restricted';
  const query = useShopProduct(idOrSlug, flagOn && live);
  // R5-3: opened from SHOP-03, back returns there; opened cold (a shared link), back goes to the product's category page.
  const productCategory = live ? query.data?.category.key : undefined;
  const fallback = useMemo(() => (productCategory ? categoryPath(productCategory) : '/shop'), [productCategory]);
  const back = useBack(fallback);

  // ADR-519: with the shop off a product link shows the shell, not a missing page.
  if (!flagOn || isShopDisabled(query.error)) {
    return (
      <StateFrame title={t('product.screenTitle')} onBack={back}>
        <ShopClosed routeId={ROUTE} />
      </StateFrame>
    );
  }
  const product = live ? query.data : undefined;
  if (product) return <ProductView product={product} onBack={back} />;
  if (qaState === 'loading' || (query.isPending && query.fetchStatus === 'fetching')) return <ProductSkeleton onBack={back} />;
  if (qaState === 'empty' || isProductUnavailable(query.error)) {
    return (
      <StateFrame title={t('product.screenTitle')} onBack={back} padded>
        {/* DQ-P5-010: a dead end, plain: a sample product above "gibt es nicht mehr" read as if that product were gone. */}
        <EmptyState
          icon="bag"
          title={t('product.notFoundTitle')}
          body={t('product.notFoundBody')}
          action={{ label: t('product.toShop'), onPress: () => router.navigate('/shop'), variant: 'secondary', size: 'm' }}
          testID={`${ROUTE}.notFound`}
        />
      </StateFrame>
    );
  }
  return (
    <StateFrame title={t('product.screenTitle')} onBack={back} padded>
      <BrowseErrorState
        routeId={ROUTE}
        title={t('product.errorTitle')}
        offline={qaState !== 'error' && (!online || query.fetchStatus === 'paused')}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    </StateFrame>
  );
}

function StateFrame({ title, onBack, padded = false, children }: { title: string; onBack: () => void; padded?: boolean; children: ReactNode }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const inset = useTabBarInset();
  const { gutter, kind } = useBreakpoint();
  const column = useColumn(kind, gutter);
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header title={title} onBack={onBack} contentMaxWidth={column.headerWidth} contentAlign={column.align} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner label={t('offline')} />
      <ScrollView style={styles.flex} contentContainerStyle={[styles.scrollContent, { paddingBottom: inset }]}>
        <View style={[column.frame, padded ? [styles.states, { paddingHorizontal: gutter }] : null]}>{children}</View>
      </ScrollView>
    </Screen>
  );
}

/** The page's column: the feed column from 768 (centred), the content width on the desktop (start edge). */
function useColumn(kind: ReturnType<typeof useBreakpoint>['kind'], gutter: number) {
  return useMemo(() => {
    if (kind === 'phone') return { frame: { width: '100%' as const }, headerWidth: undefined, align: 'center' as const, max: Number.POSITIVE_INFINITY };
    const max = kind === 'desktop' ? layout.contentMax : layout.feedColumn;
    return {
      frame: { alignSelf: kind === 'desktop' ? ('flex-start' as const) : ('center' as const), maxWidth: max + 2 * gutter, width: '100%' as const },
      headerWidth: max + 2 * gutter,
      align: kind === 'desktop' ? ('start' as const) : ('center' as const),
      max,
    };
  }, [gutter, kind]);
}

function ProductSkeleton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const inset = useTabBarInset();
  const scroll = useCollapsingHeader();
  const { gutter, kind } = useBreakpoint();
  const column = useColumn(kind, gutter);
  const phone = kind === 'phone';
  const desktop = kind === 'desktop';
  const info = (
    <View style={styles.info}>
      {/* DQ-P5-009: the common product, as the page draws it: a one-line name, no variant row (only a product with variants has one,
          and nothing is known about it while it loads), then the L button. */}
      <View style={styles.identity}>
        <SkeletonText variant="callout" width="20%" />
        <SkeletonText variant="title1" width="70%" />
        <SkeletonText variant="headline" width="30%" />
      </View>
      <SkeletonBlock height={size.button.l} corner="sm" />
      <SkeletonText variant="body" lines={3} lastLineWidth="70%" />
    </View>
  );
  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      {phone ? null : <Header onBack={onBack} title={t('product.screenTitle')} contentMaxWidth={column.headerWidth} contentAlign={column.align} testID={`${ROUTE}.header`} />}
      {/* R5 (phone web): a plain clipped box, not a ScrollView with `scrollEnabled={false}`, which react-native-web turns into
          `touch-action: none` (a touch trap); nothing scrolls while the page loads. */}
      <View style={[styles.flex, styles.clip, { paddingBottom: inset }]} testID={`${ROUTE}.skeletonBody`}>
        <Skeleton testID={`${ROUTE}.skeleton`} label={t('product.loading')}>
          <View style={[column.frame, phone ? null : { paddingHorizontal: gutter }]}>
            {desktop ? (
              <View style={styles.split}>
                <View style={{ flexBasis: `${DESKTOP_GALLERY_SHARE * 100}%` }}>
                  <SkeletonBlock aspectRatio={4 / 5} corner="none" />
                </View>
                <View style={styles.desktopInfo}>{info}</View>
              </View>
            ) : (
              <>
                <SkeletonBlock aspectRatio={4 / 5} corner={phone ? 'none' : 'md'} />
                {/* DQ-P5-009: the pager's page dots under the photo (a 44 row) stand in place while it loads. */}
                <View style={styles.skeletonPages} />
                <View style={phone ? { paddingHorizontal: gutter } : null}>{info}</View>
              </>
            )}
          </View>
        </Skeleton>
      </View>
      {phone ? <Header variant="photo" scroll={scroll} onBack={onBack} testID={`${ROUTE}.header`} /> : null}
    </Screen>
  );
}

function ProductView({ product, onBack }: { product: ShopProduct; onBack: () => void }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const header = useCollapsingHeader();
  const motion = useMotionPreference();
  const inset = useTabBarInset();
  const online = useOnline();
  const barHeight = useEstimatedOverlayHeight();
  const { gutter, kind, width: windowWidth } = useBreakpoint();
  const column = useColumn(kind, gutter);
  const phone = kind === 'phone';
  const desktop = kind === 'desktop';
  // A shown product always has a photo (contract §1); should one ever arrive without, the bar is never left floating over text.
  const overPhoto = phone && product.images.length > 0;
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);

  const [measuredPane, setMeasuredPane] = useState<number | null>(null);
  const pane = measuredPane ?? estimatedPane(kind, windowWidth);
  const measurePane = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) setMeasuredPane(width);
  };
  const inner = phone ? pane : Math.max(0, Math.min(column.max, pane - 2 * gutter));
  const galleryWidth = desktop ? Math.floor((inner - DESKTOP_GAP) * DESKTOP_GALLERY_SHARE) : inner;
  const galleryHeight = (galleryWidth * 5) / 4;

  useTabScrollToTop(() => {
    if (header.scrollY.get() <= 0) return false;
    scrollRef.current?.scrollTo({ y: 0, animated: motion.enabled && !motion.reduced });
    return true;
  });

  const gallery =
    product.images.length > 0 ? (
      <ShopGallery
        images={product.images}
        width={galleryWidth}
        mode={desktop ? 'stack' : 'pager'}
        corner={kind === 'tablet' ? 'md' : 'none'}
        title={product.title}
        sample={product.is_sample}
        testID={`${ROUTE}.gallery`}
      />
    ) : null;
  const info = <ProductInfo product={product} />;

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      {overPhoto ? null : (
        <>
          <Header title={product.title} scroll={header} onBack={onBack} contentMaxWidth={column.headerWidth} contentAlign={column.align} testID={`${ROUTE}.header`} />
          <ShellOfflineBanner label={t('offline')} />
        </>
      )}
      <View style={styles.flex} onLayout={measurePane}>
        <Animated.ScrollView
          ref={scrollRef}
          {...header.scrollProps}
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: inset }]}
          testID={`${ROUTE}.scroll`}
        >
          <View style={[column.frame, phone ? null : { paddingHorizontal: gutter }]}>
            {desktop ? (
              <View style={styles.split}>
                <View style={{ width: galleryWidth }}>{gallery}</View>
                <View style={styles.desktopInfo}>{info}</View>
              </View>
            ) : (
              <>
                {gallery}
                <View style={phone ? { paddingHorizontal: gutter } : null}>
                  {overPhoto && !online ? <OfflineBanner label={t('offline')} testID="shell.offline" /> : null}
                  {info}
                </View>
              </>
            )}
          </View>
        </Animated.ScrollView>
      </View>
      {/* 09 §6.2 b: over the photo the bar is clear; once the gallery has scrolled away it turns solid with the product's name. */}
      {overPhoto ? (
        <Header
          variant="photo"
          title={product.title}
          scroll={header}
          collapseAt={Math.max(0, galleryHeight - barHeight)}
          onBack={onBack}
          testID={`${ROUTE}.header`}
        />
      ) : null}
    </Screen>
  );
}

function ProductInfo({ product }: { product: ShopProduct }) {
  const { t } = useTranslation('shop');
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const [variantId, setVariantId] = useState<string | null>(null);
  const action = buyAction(chosenBuy(product, variantId));
  const shipping = httpsHost(product.store.shipping_url) ? product.store.shipping_url : null;
  const text = paragraphs(product.description);

  const open = (url: string) =>
    void openShopUrl(url, theme).then((opened) => {
      if (!opened) toast(t('product.openFailed'), { testID: `${ROUTE}.toast` });
    });

  return (
    <View style={styles.info}>
      <View style={styles.identity}>
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.category`}>
          {product.category.label}
        </Text>
        <Text variant="title1" role="heading" aria-level={1} testID={`${ROUTE}.title`}>
          {product.title}
        </Text>
        <View style={styles.price}>
          <Text variant="headline" numeric hyphenate={false} testID={`${ROUTE}.price`}>
            {product.price.formatted}
          </Text>
          <Text variant="caption" color="text.secondary" testID={`${ROUTE}.vat`}>
            {t('price.vatShipping')}
          </Text>
        </View>
      </View>

      {product.variants.length > 0 ? (
        <View style={styles.variants} testID={`${ROUTE}.variants`}>
          <Text variant="calloutStrong" nativeID={`${ROUTE}.variants.label`}>
            {product.variant_kind.label}
          </Text>
          <View role="radiogroup" aria-labelledby={`${ROUTE}.variants.label`} style={styles.chips}>
            {product.variants.map((variant) => (
              <Chip
                key={variant.id}
                label={variant.label}
                selected={variantId === variant.id}
                selectionRole="radio"
                // Informational (10 §3), real radio semantics (review M5.5): none is chosen at first (the product's own link applies),
                // a tap chooses one, a tap on another moves the choice; a second tap on the chosen one keeps it.
                onPress={() => setVariantId(variant.id)}
                testID={`${ROUTE}.variant.${variant.id}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.buy}>
        <BuyButton
          action={action}
          onExternal={open}
          onDesigner={(path) => requireAuth(() => router.push(path), { returnTo: path })}
        />
        {action.kind === 'external' ? (
          <Text variant="caption" color="text.secondary" testID={`${ROUTE}.buyNote`}>
            {action.host ? t('product.externalNote', { host: action.host }) : t('product.externalNoteNoHost')}
          </Text>
        ) : action.kind === 'designer' ? (
          <Text variant="caption" color="text.secondary" testID={`${ROUTE}.buyNote`}>
            {t('product.designerNote')}
          </Text>
        ) : null}
        {shipping ? (
          <Button
            label={t('product.shipping')}
            icon="arrow-square-out"
            variant="tertiary"
            size="s"
            flush="start"
            role="link"
            accessibilityLabel={t('product.shippingLabel')}
            onPress={() => open(shipping)}
            style={styles.shipping}
            testID={`${ROUTE}.shipping`}
          />
        ) : null}
      </View>

      {text.length > 0 ? (
        <View style={styles.description} testID={`${ROUTE}.description`}>
          <Text variant="calloutStrong" role="heading" aria-level={2}>
            {t('product.description')}
          </Text>
          {text.map((paragraph, index) => (
            <Text key={index} variant="body">
              {paragraph}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The one primary action (contract §3.3). `external`: "Im Shop kaufen", named as opening the online shop; `designer`: "Sticker
 * gestalten" to the sticker hub (a guest signs in first); unavailable: disabled with the server's line, "Bald im Shop erhältlich".
 */
export function BuyButton({ action, onExternal, onDesigner }: { action: BuyAction; onExternal: (url: string) => void; onDesigner: (path: string) => void }) {
  const { t } = useTranslation('shop');
  if (action.kind === 'external') {
    return (
      <Button
        label={t('product.buyExternal')}
        icon="arrow-square-out"
        size="l"
        fullWidth
        role="link"
        accessibilityLabel={action.host ? t('product.buyExternalLabel', { host: action.host }) : t('product.buyExternalLabelNoHost')}
        onPress={() => onExternal(action.url)}
        testID={`${ROUTE}.buy`}
      />
    );
  }
  if (action.kind === 'designer') {
    return <Button label={t('product.buyDesigner')} size="l" fullWidth role="link" onPress={() => onDesigner(action.path)} testID={`${ROUTE}.buy`} />;
  }
  return <Button label={action.message ?? t('product.soon')} size="l" fullWidth disabled testID={`${ROUTE}.buy`} />;
}
