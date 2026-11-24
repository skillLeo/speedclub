/**
 * M5.5 Shop (10 §3, ADR-502, ADR-519; server contract docs/reports/phase-5/m5.5-contract.md §3). SHOP-01 reads the head (hero,
 * category counts, store) and the product cards, SHOP-02 one product with its gallery, variants and the server-built `buy` object.
 * The app never composes a shop URL and does no price or cart maths: every link and price comes from these answers.
 *
 * Through the generated client (`ShopOverviewResource`, `ShopProductCardResource`, `ShopProductResource`, `ShopBuyResource`,
 * `ShopImageResource`; docs/api/openapi.json).
 *
 * Public reads: guests get the same answer as members (no per-viewer field, contract §3), so the keys carry the language only
 * (category labels and the formatted price follow `Accept-Language`). 404 `feature_disabled` while the flag `shop` is off: the
 * screens then show the M5.2 shell (ADR-519), never an error. 4xx answers are answers and are not retried.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api, apiData, ApiError } from '@/api/client';
import type { components } from '@/api/schema';

import { retryUnlessAnswered } from './vehicles';

// -- Shapes (contract §3.1–§3.4)

type Schemas = components['schemas'];

/** `ShopCategory`. "Alle" is the absence of a filter, never a row of its own. */
export type ShopCategoryKey = Schemas['ShopCategory'];
export const SHOP_CATEGORY_KEYS: readonly ShopCategoryKey[] = ['sticker', 'apparel', 'accessories'];

/** `ShopImageResource` (§3.4): 4:5 for products, the banner's real ratio for the hero. WebP variants 320/640/1080/1600. */
export type ShopImage = Schemas['ShopImageResource'];

/**
 * `ShopBuyResource` (§3.3), server-built only: `external` = an https address on the configured store (product page or cart
 * permalink), `designer` = an in-app path (STK-01), unavailable = `available: false` with the reason and the line to show.
 */
export type ShopBuy = Schemas['ShopBuyResource'];

/** `GET /shop` `data` (§3.1): the one active banner (admin-curated), the category counts, the store. */
export type ShopHead = Schemas['ShopOverviewResource'];
export type ShopHero = NonNullable<ShopHead['hero']>;
/** One chip's count: used to hide empty chips, never shown as a number (contract §3.1). */
export type ShopCategoryCount = ShopHead['categories'][number];
/** The store (§3.1): its host for "Du wechselst zum Online-Shop", the shipping policy, or nothing configured. */
export type ShopStore = ShopHead['store'];

/** The card (§3.2). The price is gross, incl. MwSt. (PAngV); `formatted` is the server's ("14,90 €" / "€14.90"). */
export type ShopProductCard = Schemas['ShopProductCardResource'];
export type ShopPrice = ShopProductCard['price'];

/** The detail (§3.3); each variant has its own `buy` (the cart permalink with its Shopify variant id, or the product's link). */
export type ShopProduct = Schemas['ShopProductResource'];
export type ShopVariant = ShopProduct['variants'][number];

/** SHOP-01 asks for whole rows at 2, 3 and 4 columns (24 = 2 × 12 = 3 × 8 = 4 × 6); the server allows 1…48 (contract §3). */
export const SHOP_PAGE_SIZE = 24;

export const shopKeys = {
  all: ['shop'] as const,
  head: (language: string) => ['shop', 'head', language] as const,
  products: (language: string, category: ShopCategoryKey | null) => ['shop', 'products', language, category ?? 'all'] as const,
  product: (language: string, idOrSlug: string) => ['shop', 'product', language, idOrSlug] as const,
};

/** 404 `feature_disabled`: the flag `shop` is off on the server. Not an error: the tab shows the M5.2 shell (ADR-519). */
export function isShopDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'feature_disabled';
}

/** 404 `shop_product_unavailable` (unknown, hidden, deleted, a sample while samples are off): "Dieses Produkt gibt es nicht mehr". */
export function isProductUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && !isShopDisabled(error);
}

// -- Reads

/** SHOP-01 head: the hero banner, the category counts (to hide empty chips) and the store. */
export function useShopHead(enabled: boolean) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: shopKeys.head(i18n.language),
    queryFn: async ({ signal }) => (await apiData(api.GET('/shop', { signal }))).data,
    enabled,
    retry: retryUnlessAnswered,
  });
}

/** SHOP-01 grid: the cards of one category (null = all), in the admin's order, by the contract's cursor. */
export function useShopProducts(category: ShopCategoryKey | null, enabled: boolean) {
  const { i18n } = useTranslation();
  return useInfiniteQuery({
    queryKey: shopKeys.products(i18n.language, category),
    queryFn: ({ pageParam, signal }) =>
      apiData(
        api.GET('/shop/products', {
          params: { query: { per_page: SHOP_PAGE_SIZE, ...(category ? { category } : {}), ...(pageParam ? { cursor: pageParam } : {}) } },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.next_cursor ?? undefined,
    enabled,
    retry: retryUnlessAnswered,
  });
}

/** SHOP-02: one product by ULID or slug. */
export function useShopProduct(idOrSlug: string, enabled: boolean) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: shopKeys.product(i18n.language, idOrSlug),
    queryFn: async ({ signal }) => (await apiData(api.GET('/shop/products/{product}', { params: { path: { product: idOrSlug } }, signal }))).data,
    enabled: enabled && idOrSlug !== '',
    retry: retryUnlessAnswered,
  });
}
