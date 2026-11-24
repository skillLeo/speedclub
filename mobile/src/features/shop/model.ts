/**
 * SHOP-01/02/03 rules without React (10 §3, contract §3, R5-3): which categories show and in which order, what the buy button does, which photo variant fills a
 * cell. The app reads the server's answers here and never composes a shop link, a price or a cart.
 */
import { PixelRatio } from 'react-native';

import {
  SHOP_CATEGORY_KEYS,
  type ShopBuy,
  type ShopCategoryCount,
  type ShopCategoryKey,
  type ShopHero,
  type ShopImage,
  type ShopProduct,
  type ShopProductCard,
} from '@/api/queries/shop';
import { joinShortPrefixes } from '@/features/settings/markdown/parse';
import { isInternalPath } from '@/state/session';
import { keepShortNamesTogether } from '@/lib/format';
import type { PhotoFields } from '@/ui/Photo';

/** A category from an address: SHOP-03's `[category]`, or the old `/shop?category=sticker` that SHOP-01 forwards (R5-3). Anything else is null. */
export function categoryParam(value: string | string[] | undefined): ShopCategoryKey | null {
  const first = Array.isArray(value) ? value[0] : value;
  return (SHOP_CATEGORY_KEYS as readonly string[]).includes(first ?? '') ? (first as ShopCategoryKey) : null;
}

/** R4-3.2: whether a category can be shopped yet. */
export type ShopCategoryStatus = 'available' | 'coming_soon';

/** Until the server says otherwise (an older server sends no status): stickers are available, the rest comes later. */
export const DEFAULT_CATEGORY_STATUS: Readonly<Record<ShopCategoryKey, ShopCategoryStatus>> = {
  sticker: 'available',
  apparel: 'coming_soon',
  accessories: 'coming_soon',
};

export type CategoryTile = { key: ShopCategoryKey; label: string | null; status: ShopCategoryStatus };

/**
 * R4-3.2, R5-3: every category is visible with the server's label and status (the default above when it sends none). R5-3 (SHOP-01
 * as three category cards): in the server's order; a category the server leaves out follows in the app's order, so there are always
 * three. A `coming_soon` one is shown with "Bald verfügbar" and never opens, so it never leads to an empty list. The screens set the
 * app's own word for each key (R4DQ-27: "Kleidung", as the client says it, in the app's language); `label` keeps what the server sent.
 */
export function categoryTiles(categories: readonly ShopCategoryCount[] | undefined): CategoryTile[] {
  const known = SHOP_CATEGORY_KEYS as readonly string[];
  const sentKeys = (categories ?? []).map((category) => category.key).filter((key): key is ShopCategoryKey => known.includes(key));
  const order = [...new Set([...sentKeys, ...SHOP_CATEGORY_KEYS])];
  return order.map((key) => {
    const entry = (categories ?? []).find((category) => category.key === key);
    // An older server sends no status (and a cached answer may lack it): the default then.
    const sent: unknown = entry?.status;
    const status = sent === 'available' || sent === 'coming_soon' ? sent : DEFAULT_CATEGORY_STATUS[key];
    return { key, label: entry?.label?.trim() ? entry.label : null, status };
  });
}

/** R5-3: the status of one category, from the tiles (the default before the head is in). */
export function categoryStatus(category: ShopCategoryKey, tiles: readonly CategoryTile[]): ShopCategoryStatus {
  return tiles.find((tile) => tile.key === category)?.status ?? DEFAULT_CATEGORY_STATUS[category];
}

/** R5DQ-01 at a large font: the text width (at 100 %) below which the coming tiles stack as rows (photo beside the name). */
export const SOON_TEXT_MIN = 120;

/** R5DQ-01: the coming categories side by side as 1:1 tiles, or stacked as rows where a tile's name would be too narrow. */
export function soonForm(tileTextWidth: number, fontScale: number): 'tile' | 'row' {
  return tileTextWidth / Math.max(1, fontScale) < SOON_TEXT_MIN ? 'row' : 'tile';
}

/**
 * R5DQ-10, R5DQ-22: what the lead card of an available category shows: the category's first product photo (the sticker reads at card
 * size there), else the bundled frame. Never the banner: that leads SHOP-03, and the same photo twice in a row reads as a repeat.
 */
export function categoryLeadPhoto<F>(
  first: Pick<ShopProductCard, 'image' | 'is_sample'> | null | undefined,
  fallback: F,
): { image: ShopImage | null; sample: boolean; fallback: F } {
  if (first?.image) return { image: first.image, sample: first.is_sample, fallback };
  return { image: null, sample: false, fallback };
}

/**
 * R5-3: SHOP-01 no longer carries the hero banner (three category cards and nothing else); it leads the category page it belongs to.
 * A banner that opens a category belongs to that category; one that opens a product belongs to the category whose cards list it.
 * `opens` says whether pressing it goes anywhere from there (a banner of this very category does not).
 */
export function heroForCategory(
  hero: ShopHero | null | undefined,
  category: ShopCategoryKey,
  cards: readonly Pick<ShopProductCard, 'slug'>[],
): { hero: ShopHero; opens: 'product' | null } | null {
  if (!hero) return null;
  if (hero.link.kind === 'category') return hero.link.category === category ? { hero, opens: null } : null;
  const slug = hero.link.product?.slug;
  return slug && cards.some((card) => card.slug === slug) ? { hero, opens: 'product' } : null;
}

/** The language the admin writes the hero banner in (ADM shop banners are single-language, German). */
export const HERO_ADMIN_LANGUAGE = 'de';

/** Which of the app's own hero lines stands in for the admin text (`shop.hero.<key>`). */
export type HeroCopyKey = 'sticker' | 'other';

/**
 * R4B-008: the hero's words in the app's language. The banner's title and subtitle are admin content in one language (German), so
 * the German app shows them as written; any other language shows the app's own lines (`shop.hero.*` in shop.json) for what the
 * banner opens — the sticker, or anything else — instead of German text in an English page. A server that one day names the
 * banner's language (`locale`) is followed. Product names elsewhere stay admin content.
 */
export function heroCopy(hero: ShopHero, language: string): { admin: true } | { admin: false; key: HeroCopyKey } {
  const declared = (hero as ShopHero & { locale?: unknown }).locale;
  const written = typeof declared === 'string' && declared ? declared : HERO_ADMIN_LANGUAGE;
  if (language.split('-')[0] === written.split('-')[0]) return { admin: true };
  const sticker = hero.link.kind === 'category' && hero.link.category === 'sticker';
  return { admin: false, key: sticker ? 'sticker' : 'other' };
}

/** What the primary action on SHOP-02 does. */
export type BuyAction =
  | { kind: 'external'; url: string; host: string | null }
  | { kind: 'designer'; path: string }
  | { kind: 'unavailable'; message: string | null };

/** The host of an https address, for "Du wechselst zu shop.example.de". Null when it is no https address. */
export function httpsHost(url: string | null | undefined): string | null {
  const match = /^https:\/\/([^/?#:@]+)(?:[/?#:]|$)/i.exec(url ?? '');
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * The server's `buy` as one action (contract §3.3). An external link is used exactly as given and only when it is https; a designer
 * path only when it stays in the app. Anything else, including a malformed answer, is "unavailable", never a dead link.
 */
export function buyAction(buy: ShopBuy | null | undefined): BuyAction {
  if (buy?.available && buy.kind === 'external' && buy.url && httpsHost(buy.url)) {
    return { kind: 'external', url: buy.url, host: httpsHost(buy.url) };
  }
  if (buy?.available && buy.kind === 'designer' && isInternalPath(buy.path)) return { kind: 'designer', path: buy.path };
  return { kind: 'unavailable', message: buy?.message?.trim() ? buy.message.trim() : null };
}

/** The buy of the chosen variant (its cart permalink), or the product's when none is chosen or the choice is gone. */
export function chosenBuy(product: Pick<ShopProduct, 'buy' | 'variants'>, variantId: string | null): ShopBuy {
  const variant = variantId ? product.variants.find((candidate) => candidate.id === variantId) : undefined;
  return variant?.buy ?? product.buy;
}

/** The smallest variant that fills `width` points on this screen, or the largest there is. */
export function shopVariantUrl(image: ShopImage | null | undefined, width: number, pixelRatio: number = PixelRatio.get()): string | null {
  const variants = [...(image?.variants ?? [])].sort((a, b) => a.width - b.width);
  const needed = Math.ceil(width * pixelRatio);
  return (variants.find((variant) => variant.width >= needed) ?? variants[variants.length - 1])?.url ?? null;
}

/** What `Photo` needs from a shop image: the variant for `width`, thumbhash or blurhash, and the focal point. */
export function shopPhoto(image: ShopImage | null | undefined, width: number): PhotoFields {
  if (!image) return { source: null };
  return {
    source: shopVariantUrl(image, width),
    blurhash: image.blurhash,
    thumbhash: image.thumbhash,
    focal: { x: image.focal_x, y: image.focal_y },
  };
}

/** The description's paragraphs: plain text from the admin, split at blank lines (contract §1, no HTML, no Markdown). */
export function paragraphs(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    // p5r1 capture (SHOP-02 at 200 %): the staff's text broke "QR- / Code"; a short prefix stays with its word, as in the legal
    // texts and on the public pages (03 §4, DQ-145): a word joiner after the hyphen, the glyph unchanged.
    .map(joinShortPrefixes);
}

/** Cards in rows of `columns`; the last row may be short. */
export function rowsOf<T>(items: readonly T[], columns: number): T[][] {
  const step = Math.max(1, columns);
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += step) rows.push(items.slice(start, start + step));
  return rows;
}

/** One cell of a wall `width` wide in `columns` columns, `gap` apart (whole pixels). */
export function cellWidth(width: number, columns: number, gap: number): number {
  return columns > 0 && width > 0 ? Math.floor((width - gap * (columns - 1)) / columns) : 0;
}

/** The same card listed twice (a page boundary moved under the list) shows once, at its first place. */
export function uniqueCards<T extends { id: string }>(pages: readonly { data: readonly T[] }[] | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? []) {
    for (const card of page.data) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(card);
    }
  }
  return out;
}

/** DQ-P5-007: the text width (at 100 %) below which a phone wall drops to one column at a large font. */
export const WALL_TEXT_MIN = 160;

/**
 * The phone wall's columns: two, or one at a large font when a two-column cell's text would be narrower than WALL_TEXT_MIN at the
 * current scale (at 200 % names broke "Car- / Sticker / – dein / Design"). Tablets and the desktop keep their columns.
 */
export function wallColumns(base: number, phone: boolean, textWidth: number, fontScale: number): number {
  if (!phone || fontScale <= 1 || base < 2) return base;
  return textWidth / fontScale < WALL_TEXT_MIN ? 1 : base;
}

/**
 * A product name as a line sets it: a short hyphenated name whole ("Car-Sticker"), a long compound keeps its hyphen as the place to
 * wrap ("Schriftzug- / Banner"; joined it split mid-word as "Bann / er" in a desktop tile at 200 %, p5r2), a dash bound to the word
 * before it.
 */
export function productTitleText(title: string): string {
  return keepShortNamesTogether(title).replace(/ ([\u2013\u2014]) /g, '\u00A0$1 ');
}

/**
 * DQ-P5-049: from 768 a wall whose products are all on screen and fewer than its columns takes that many columns (at least two), so
 * three products fill a row instead of leaving a quarter of it empty. Phones, and a wall still loading or paging, keep their columns.
 */
export function filledColumns(columns: number, phone: boolean, count: number, complete: boolean): number {
  if (phone || !complete || count <= 0 || count >= columns) return columns;
  return Math.max(2, count);
}
