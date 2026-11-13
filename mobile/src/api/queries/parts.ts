/**
 * M4.14 Parts catalogue in the app (09 §8.9, §7.11, ADR-455): BRD-01 Marke (`brands/{slug}` with its products and the builds that run
 * it), BRD-02 Produkt (`products/{id}` with its builds), the Teile scope of Entdecken (top brands and the product search with real
 * counts) and the mod editor's product autocomplete (`products?q&category&per_page=8`, no counts).
 *
 * Every hook waits for the flag `parts_catalogue`: while it is off the server answers 404 feature_disabled, so nothing is asked.
 * Counts are real ("In 14 Builds"); the API never pads or rounds them.
 */
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api, apiData, ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import type { FeedVehicle } from '@/api/queries/home';
import { retryUnlessAnswered } from '@/api/queries/vehicles';
import type { components } from '@/api/schema';

export type BrandTile = components['schemas']['BrandTileResource'];
export type BrandPage = components['schemas']['BrandPageResource'];
export type ProductRowData = components['schemas']['ProductRowResource'];
export type ProductDetail = components['schemas']['ProductResource'];

/** 09 §8.18: the catalogue flag (off until the M4.14 design QA passed, ADR-455). */
export const PARTS_FLAG = 'parts_catalogue';

export const PRODUCT_CODES = { unavailable: 'product_unavailable' } as const;

/** The Teile scope's product list and the brand page's products. */
export const PRODUCTS_PAGE_SIZE = 20;
/** GAR-10's autocomplete: eight suggestions (the API's documented `per_page=8`). */
export const AUTOCOMPLETE_SIZE = 8;
/** BRD-01 / BRD-02 "Builds mit …": whole rows of the wall on every width (2 × 6, 3 × 4, 4 × 3). */
export const BUILDS_PAGE_SIZE = 12;
/** config/speedclub.php `parts.query_min`: a shorter text is not sent (it would be a 422); the list then shows everything. */
export const QUERY_MIN = 2;
/** VEH-02 "Builds mit {Produkt}": a rail of up to eight cards (09 §5 rails). */
export const PRODUCT_RAIL_SIZE = 8;

type Page<T> = { data: T[]; meta: { next_cursor: string | null } };

export const partsKeys = {
  all: ['parts'] as const,
  brands: ['parts', 'brands'] as const,
  brand: (slug: string) => ['parts', 'brand', slug] as const,
  brandProducts: (slug: string) => ['parts', 'brand', slug, 'products'] as const,
  brandBuilds: (slug: string) => ['parts', 'brand', slug, 'builds'] as const,
  products: (q: string, brand: string | null) => ['parts', 'products', q, brand ?? '-'] as const,
  suggestions: (q: string, category: string | null) => ['parts', 'suggest', q, category ?? '-'] as const,
  product: (id: string) => ['parts', 'product', id] as const,
  productBuilds: (id: string) => ['parts', 'product', id, 'builds'] as const,
};

/** The plain calls, shared by the hooks and the tests. */
export const partsApi = {
  async brands(signal?: AbortSignal): Promise<BrandTile[]> {
    return (await apiData(api.GET('/brands', { signal }))).data;
  },
  async brand(slug: string, signal?: AbortSignal): Promise<BrandPage> {
    return (await apiData(api.GET('/brands/{slug}', { params: { path: { slug } }, signal }))).data;
  },
  async brandProducts(slug: string, cursor: string | null, signal?: AbortSignal): Promise<Page<ProductRowData>> {
    return apiData(
      api.GET('/brands/{slug}/products', {
        params: { path: { slug }, query: { per_page: PRODUCTS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async brandBuilds(slug: string, cursor: string | null, signal?: AbortSignal): Promise<Page<FeedVehicle>> {
    return apiData(
      api.GET('/brands/{slug}/builds', {
        params: { path: { slug }, query: { per_page: BUILDS_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
  async products(
    query: { q?: string; brand?: string | null; category?: string | null; counts?: boolean; perPage?: number; cursor?: string | null },
    signal?: AbortSignal,
  ): Promise<Page<ProductRowData>> {
    return apiData(
      api.GET('/products', {
        params: {
          query: {
            per_page: query.perPage ?? PRODUCTS_PAGE_SIZE,
            ...(query.q && query.q.trim().length >= QUERY_MIN ? { q: query.q.trim() } : {}),
            ...(query.brand ? { brand: query.brand } : {}),
            ...(query.category ? { category: query.category } : {}),
            // Laravel's `boolean` rule takes 1/0 in a query string, never the word "true" the generated type would send.
            ...(query.counts ? { counts: 1 as unknown as boolean } : {}),
            ...(query.cursor ? { cursor: query.cursor } : {}),
          },
        },
        signal,
      }),
    );
  },
  async product(id: string, signal?: AbortSignal): Promise<ProductDetail> {
    return (await apiData(api.GET('/products/{product}', { params: { path: { product: id } }, signal }))).data;
  },
  async productBuilds(id: string, cursor: string | null, perPage: number = BUILDS_PAGE_SIZE, signal?: AbortSignal): Promise<Page<FeedVehicle>> {
    return apiData(
      api.GET('/products/{product}/builds', {
        params: { path: { product: id }, query: { per_page: perPage, ...(cursor ? { cursor } : {}) } },
        signal,
      }),
    );
  },
};

/** 404 `product_unavailable` / `not_found` / `feature_disabled`: there is nothing to show for this reader. */
export function isPartsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found';
}

/**
 * The scramble type of a few counts is a string (BrandTileResource.builds, BrandPageResource.builds/products) while the API sends whole
 * numbers; either way the screen formats a number.
 */
export function countOf(value: number | string | null | undefined): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

const nextCursor = (page: Page<unknown>) => page.meta.next_cursor ?? undefined;

/** Every row of an infinite list once, by id (a cursor page can repeat a row that moved). */
export function flattenById<T extends { id: string }>(pages: readonly Page<T>[] | undefined): T[] {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const page of pages ?? []) {
    for (const row of page.data) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

export function usePartsOn(): boolean {
  return useFlag(PARTS_FLAG);
}

/** Entdecken › Teile: the brands most run on builds the reader may see, at most 24. */
export function useTopBrands(enabled: boolean = true) {
  const on = usePartsOn();
  return useQuery({
    queryKey: partsKeys.brands,
    queryFn: ({ signal }) => partsApi.brands(signal),
    enabled: on && enabled,
    retry: retryUnlessAnswered,
  });
}

/** BRD-01. */
export function useBrand(slug: string) {
  const on = usePartsOn();
  return useQuery({
    queryKey: partsKeys.brand(slug),
    queryFn: ({ signal }) => partsApi.brand(slug, signal),
    enabled: on && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** BRD-01 Produkte, by line and name. */
export function useBrandProducts(slug: string, enabled: boolean = true) {
  const on = usePartsOn();
  return useInfiniteQuery({
    queryKey: partsKeys.brandProducts(slug),
    queryFn: ({ pageParam, signal }) => partsApi.brandProducts(slug, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** BRD-01 "Builds mit {Marke}". */
export function useBrandBuilds(slug: string, enabled: boolean = true) {
  const on = usePartsOn();
  return useInfiniteQuery({
    queryKey: partsKeys.brandBuilds(slug),
    queryFn: ({ pageParam, signal }) => partsApi.brandBuilds(slug, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && slug !== '',
    retry: retryUnlessAnswered,
  });
}

/** Entdecken › Teile: the product search with real counts ("In 14 Builds"). */
export function useProductSearch(q: string, brand: string | null = null, enabled: boolean = true) {
  const on = usePartsOn();
  return useInfiniteQuery({
    queryKey: partsKeys.products(q, brand),
    queryFn: ({ pageParam, signal }) => partsApi.products({ q, brand, counts: true, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
    placeholderData: keepPreviousData,
  });
}

/** GAR-10 product autocomplete: eight active products of the mod's category matching what is typed (no counts). */
export function useProductSuggestions(q: string, category: string | null, enabled: boolean = true) {
  const on = usePartsOn();
  return useQuery({
    queryKey: partsKeys.suggestions(q, category),
    queryFn: async ({ signal }) => (await partsApi.products({ q, category, perPage: AUTOCOMPLETE_SIZE }, signal)).data,
    enabled: on && enabled,
    retry: retryUnlessAnswered,
    placeholderData: keepPreviousData,
    meta: { persist: false },
  });
}

/** BRD-02. An archived product still answers; a merged one answers as its survivor (compare `id`). */
export function useProduct(id: string) {
  const on = usePartsOn();
  return useQuery({
    queryKey: partsKeys.product(id),
    queryFn: ({ signal }) => partsApi.product(id, signal),
    enabled: on && id !== '',
    retry: retryUnlessAnswered,
  });
}

/** BRD-02 "Builds mit {Produkt}". */
export function useProductBuilds(id: string, enabled: boolean = true) {
  const on = usePartsOn();
  return useInfiniteQuery({
    queryKey: partsKeys.productBuilds(id),
    queryFn: ({ pageParam, signal }) => partsApi.productBuilds(id, pageParam, BUILDS_PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    enabled: on && enabled && id !== '',
    retry: retryUnlessAnswered,
  });
}

/** VEH-02 "Builds mit {Produkt}" (DQ-1070): the first rail page only; the build of the mod itself is left out by the screen. */
export function useProductRail(id: string | null) {
  const on = usePartsOn();
  return useQuery({
    queryKey: [...partsKeys.productBuilds(id ?? ''), 'rail'] as const,
    queryFn: async ({ signal }) => (await partsApi.productBuilds(id ?? '', null, PRODUCT_RAIL_SIZE + 1, signal)).data,
    enabled: on && id !== null && id !== '',
    retry: retryUnlessAnswered,
  });
}
