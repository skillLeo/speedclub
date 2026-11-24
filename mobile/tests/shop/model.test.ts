import type { ShopBuy, ShopCategoryCount, ShopHero, ShopImage } from '@/api/queries/shop';
import { buyAction, categoryParam, categoryTiles, cellWidth, heroCopy, chosenBuy, httpsHost, paragraphs, productTitleText, rowsOf, shopVariantUrl, categoryStatus, soonForm, categoryLeadPhoto, heroForCategory, uniqueCards, wallColumns, filledColumns } from '@/features/shop/model';
import { openShopUrl } from '@/features/shop/openShopUrl';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

/** The round-4 head: stickers available, the rest coming. */
const counts = (sticker: number, apparel: number, accessories: number): ShopCategoryCount[] => [
  { key: 'all', label: 'Alle', count: sticker + apparel + accessories, status: 'available' },
  { key: 'sticker', label: 'Sticker', count: sticker, status: 'available' },
  { key: 'apparel', label: 'Bekleidung', count: apparel, status: 'coming_soon' },
  { key: 'accessories', label: 'Accessoires', count: accessories, status: 'coming_soon' },
];
/** An older server's head, without `status`. */
const legacy = (categories: ShopCategoryCount[]): ShopCategoryCount[] =>
  categories.map(({ status: _status, ...rest }) => rest) as unknown as ShopCategoryCount[];

const EXTERNAL: ShopBuy = { available: true, kind: 'external', url: 'https://shop.joinspeedclub.com/products/hoodie', path: null, reason: null, message: null };
const CART: ShopBuy = { available: true, kind: 'external', url: 'https://shop.joinspeedclub.com/cart/4711:1?storefront=true', path: null, reason: null, message: null };
const DESIGNER: ShopBuy = { available: true, kind: 'designer', url: null, path: '/stickers', reason: null, message: null };
const SOON: ShopBuy = { available: false, kind: null, url: null, path: null, reason: 'not_configured', message: 'Bald im Shop erhältlich' };

describe('SHOP-01 hero words (R4B-008)', () => {
  const hero = (link: ShopHero['link'], extra: Record<string, unknown> = {}) => ({ id: 'h', title: 'Dein Build. Dein Sticker.', subtitle: null, link, is_sample: false, ...extra }) as unknown as ShopHero;
  const sticker = { kind: 'category', category: 'sticker', product: null } as ShopHero['link'];
  const product = { kind: 'product', category: null, product: { id: 'p', slug: 'hoodie' } } as ShopHero['link'];

  it('shows the German admin text in German and the app’s own lines in any other language', () => {
    expect(heroCopy(hero(sticker), 'de')).toEqual({ admin: true });
    expect(heroCopy(hero(sticker), 'de-DE')).toEqual({ admin: true });
    expect(heroCopy(hero(sticker), 'en')).toEqual({ admin: false, key: 'sticker' });
    expect(heroCopy(hero(product), 'en')).toEqual({ admin: false, key: 'other' });
  });

  it('follows a language the server names for the banner', () => {
    expect(heroCopy(hero(sticker, { locale: 'en' }), 'en')).toEqual({ admin: true });
    expect(heroCopy(hero(sticker, { locale: 'en' }), 'de')).toEqual({ admin: false, key: 'sticker' });
  });
});

describe('SHOP-01 categories (R4-3.2)', () => {
  it('shows every category in the app order; without a server status stickers are available and the rest comes later', () => {
    expect(categoryTiles(legacy(counts(3, 0, 0)))).toEqual([
      { key: 'sticker', label: 'Sticker', status: 'available' },
      { key: 'apparel', label: 'Bekleidung', status: 'coming_soon' },
      { key: 'accessories', label: 'Accessoires', status: 'coming_soon' },
    ]);
    // Before the head is in: the app's own words (label null) with the default statuses.
    expect(categoryTiles(undefined).map((tile) => [tile.key, tile.label, tile.status])).toEqual([
      ['sticker', null, 'available'],
      ['apparel', null, 'coming_soon'],
      ['accessories', null, 'coming_soon'],
    ]);
  });

  it('follows the server status when it sends one, and ignores an unknown value', () => {
    const withStatus = counts(3, 2, 0).map((category) =>
      category.key === 'apparel' ? { ...category, status: 'available' } : category.key === 'sticker' ? { ...category, status: 'weird' } : category,
    ) as unknown as ShopCategoryCount[];
    expect(categoryTiles(withStatus).map((tile) => tile.status)).toEqual(['available', 'available', 'coming_soon']);
  });

  it('R5-3: the status of one category, the default before the head is in', () => {
    const tiles = categoryTiles(counts(3, 0, 0));
    expect(categoryStatus('sticker', tiles)).toBe('available');
    expect(categoryStatus('apparel', tiles)).toBe('coming_soon');
    expect(categoryStatus('accessories', categoryTiles(undefined))).toBe('coming_soon');
    expect(categoryStatus('sticker', [])).toBe('available');
  });

  it('R5-3: one card per category in the server order; a category it leaves out follows in the app order', () => {
    const reordered = [counts(1, 0, 0)[0], counts(1, 0, 0)[3], counts(1, 0, 0)[1], counts(1, 0, 0)[2]] as ShopCategoryCount[];
    expect(categoryTiles(reordered).map((tile) => tile.key)).toEqual(['accessories', 'sticker', 'apparel']);
    const partial = [counts(1, 0, 0)[2]] as ShopCategoryCount[];
    expect(categoryTiles(partial).map((tile) => tile.key)).toEqual(['apparel', 'sticker', 'accessories']);
    // "all" is no card, and an unknown key is ignored.
    const odd = [...counts(1, 0, 0), { key: 'cars', label: 'Autos', count: 1, status: 'available' }] as unknown as ShopCategoryCount[];
    expect(categoryTiles(odd)).toHaveLength(3);
  });

  it('R5DQ-01: the coming tiles sit side by side, and stack as rows where a name would be too narrow for the font', () => {
    expect(soonForm(162, 1)).toBe('tile');
    expect(soonForm(162, 2)).toBe('row');
    expect(soonForm(276, 2)).toBe('tile');
    expect(soonForm(150, 2)).toBe('row');
  });

  it('R5DQ-10, R5DQ-22: the lead shows its first product photo, else the bundled frame (never the banner)', () => {
    const productImage = { id: 'p' } as unknown as ShopImage;
    expect(categoryLeadPhoto({ image: productImage, is_sample: true }, 'bundled')).toEqual({ image: productImage, sample: true, fallback: 'bundled' });
    expect(categoryLeadPhoto({ image: null, is_sample: true }, 'bundled')).toEqual({ image: null, sample: false, fallback: 'bundled' });
    expect(categoryLeadPhoto(undefined, 'bundled').image).toBeNull();
  });

  it('takes only an enum key from the address', () => {
    expect(categoryParam('apparel')).toBe('apparel');
    expect(categoryParam(['sticker', 'apparel'])).toBe('sticker');
    expect(categoryParam('all')).toBeNull();
    expect(categoryParam('cars')).toBeNull();
    expect(categoryParam(undefined)).toBeNull();
  });
});

describe('SHOP-03 hero banner (R5-3)', () => {
  const hero = (link: ShopHero['link']) => ({ id: 'h', title: 'Dein Build. Dein Sticker.', subtitle: null, link, is_sample: false }) as unknown as ShopHero;
  const toSticker = hero({ kind: 'category', category: 'sticker', product: null } as ShopHero['link']);
  const toBanner = hero({ kind: 'product', category: null, product: { id: 'p', slug: 'wordmark-banner' } } as ShopHero['link']);

  it('leads the category it opens, without opening itself again', () => {
    expect(heroForCategory(toSticker, 'sticker', [])).toEqual({ hero: toSticker, opens: null });
    expect(heroForCategory(toSticker, 'apparel', [])).toBeNull();
  });

  it('a product banner leads the category whose cards list the product, and opens it', () => {
    expect(heroForCategory(toBanner, 'sticker', [{ slug: 'wordmark-banner' }])).toEqual({ hero: toBanner, opens: 'product' });
    expect(heroForCategory(toBanner, 'sticker', [{ slug: 'car-sticker' }])).toBeNull();
    expect(heroForCategory(null, 'sticker', [])).toBeNull();
  });
});

describe('SHOP-02 buy object (contract §3.3)', () => {
  it('external: the server URL exactly as given, with its host', () => {
    expect(buyAction(CART)).toEqual({ kind: 'external', url: CART.url, host: 'shop.joinspeedclub.com' });
  });

  it('designer: the in-app path', () => {
    expect(buyAction(DESIGNER)).toEqual({ kind: 'designer', path: '/stickers' });
  });

  it('unavailable: the server line, and every malformed answer is unavailable too, never a dead link', () => {
    expect(buyAction(SOON)).toEqual({ kind: 'unavailable', message: 'Bald im Shop erhältlich' });
    expect(buyAction({ ...EXTERNAL, url: 'http://shop.joinspeedclub.com/products/hoodie' })).toEqual({ kind: 'unavailable', message: null });
    expect(buyAction({ ...EXTERNAL, url: 'javascript:alert(1)' }).kind).toBe('unavailable');
    expect(buyAction({ ...EXTERNAL, url: null }).kind).toBe('unavailable');
    // Outside the schema's enum: what a broken or tampered answer would carry.
    expect(buyAction({ ...DESIGNER, path: '//evil.example/stickers' } as unknown as ShopBuy).kind).toBe('unavailable');
    expect(buyAction({ ...DESIGNER, path: 'https://evil.example' } as unknown as ShopBuy).kind).toBe('unavailable');
    expect(buyAction({ ...EXTERNAL, available: false }).kind).toBe('unavailable');
    expect(buyAction(null)).toEqual({ kind: 'unavailable', message: null });
  });

  it('a chosen variant takes its own buy (the cart permalink); none, or one that is gone, takes the product buy', () => {
    const product = { buy: EXTERNAL, variants: [{ id: 'k3m9x2ab', label: 'M', buy: CART }] };
    expect(chosenBuy(product, 'k3m9x2ab')).toBe(CART);
    expect(chosenBuy(product, null)).toBe(EXTERNAL);
    expect(chosenBuy(product, 'gone0000')).toBe(EXTERNAL);
  });

  it('reads only the host of an https address', () => {
    expect(httpsHost('https://Shop.Example.de/products/x?variant=1')).toBe('shop.example.de');
    expect(httpsHost('https://user@evil.example/')).toBeNull();
    expect(httpsHost('http://shop.example.de')).toBeNull();
    expect(httpsHost(null)).toBeNull();
  });
});

describe('the opener (ADR-502)', () => {
  it('refuses anything but https and opens nothing', async () => {
    const win = { open: jest.fn() };
    await expect(openShopUrl('http://shop.example.de/products/x', { color: {} as never }, win)).resolves.toBe(false);
    expect(win.open).not.toHaveBeenCalled();
  });
});

describe('grid helpers', () => {
  const image = (widths: number[]): ShopImage => ({
    id: 'i',
    width: 1600,
    height: 2000,
    aspect: '4:5',
    blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    thumbhash: null,
    focal_x: 0.5,
    focal_y: 0.5,
    alt: null,
    variants: widths.map((width) => ({ width, height: (width * 5) / 4, url: `https://cdn.test/${width}.webp` })),
  });

  it('picks the smallest variant that fills the cell at the pixel ratio', () => {
    expect(shopVariantUrl(image([1600, 320, 640, 1080]), 194, 3)).toBe('https://cdn.test/640.webp');
    expect(shopVariantUrl(image([320, 640]), 600, 3)).toBe('https://cdn.test/640.webp');
    expect(shopVariantUrl(null, 100, 2)).toBeNull();
  });

  it('cuts whole cells 2 apart and groups cards in rows', () => {
    expect(cellWidth(390, 2, 2)).toBe(194);
    expect(cellWidth(1152, 4, 2)).toBe(286);
    expect(rowsOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('lists a card that moved across a page boundary once', () => {
    expect(uniqueCards([{ data: [{ id: 'a' }, { id: 'b' }] }, { data: [{ id: 'b' }, { id: 'c' }] }]).map((card) => card.id)).toEqual(['a', 'b', 'c']);
  });

  it('splits the description at blank lines', () => {
    expect(paragraphs('Erste Zeile\nzweite Zeile\n\n  Absatz zwei  \n\n\n')).toEqual(['Erste Zeile\nzweite Zeile', 'Absatz zwei']);
    expect(paragraphs(null)).toEqual([]);
    // p5r1 capture: "QR-Code" never breaks after its two letters (a word joiner after the hyphen).
    expect(paragraphs('Runder Badge mit QR-Code in der Mitte.')).toEqual(['Runder Badge mit QR-\u2060Code in der Mitte.']);
  });
});

describe('DQ-P5-007: names at 200 %', () => {
  it('drops a phone wall to one column when a cell\u2019s text would be too narrow at the scale', () => {
    // 393: a two-column cell holds about 163 px of text.
    expect(wallColumns(2, true, 163, 1)).toBe(2);
    expect(wallColumns(2, true, 163, 2)).toBe(1);
    expect(wallColumns(2, true, 163, 1.3)).toBe(1);
    // 360 at 100 % keeps the spec's two columns; tablets and desktops keep theirs at any scale.
    expect(wallColumns(2, true, 147, 1)).toBe(2);
    expect(wallColumns(3, false, 120, 2)).toBe(3);
  });

  it('keeps hyphenated names whole and binds a dash to the word before it', () => {
    expect(productTitleText('Car-Sticker \u2013 dein Design')).toBe('Car-\u2060Sticker\u00A0\u2013 dein Design');
    // p5r2: a long compound keeps its hyphen as the place to wrap, never "Bann / er".
    expect(productTitleText('Schriftzug-Banner')).toBe('Schriftzug-Banner');
  });
});

describe('DQ-P5-049: a short wall fills its row', () => {
  it('takes as many columns as products from 768 once every product is there', () => {
    expect(filledColumns(4, false, 3, true)).toBe(3);
    expect(filledColumns(4, false, 1, true)).toBe(2);
    expect(filledColumns(4, false, 6, true)).toBe(4);
    // Still paging, on a phone, or nothing yet: the wall keeps its columns.
    expect(filledColumns(4, false, 3, false)).toBe(4);
    expect(filledColumns(2, true, 1, true)).toBe(2);
    expect(filledColumns(4, false, 0, true)).toBe(4);
  });
});
