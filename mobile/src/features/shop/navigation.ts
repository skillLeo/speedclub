/** The flag of the M5.5 catalogue (contract §8). It gates the catalogue only, never the tab (ADR-519). */
export const SHOP_FLAG = 'shop';

/** SHOP-02 `/shop/[product]`: the slug from the card (the server also answers to the ULID). */
export function productPath(slug: string) {
  return { pathname: '/shop/[product]', params: { product: slug } } as const;
}

/** R5-3 SHOP-03 `/shop/c/[category]`: one category's page (the sticker products, what the sticker does, the order). */
export function categoryPath(category: string) {
  return { pathname: '/shop/c/[category]', params: { category } } as const;
}
