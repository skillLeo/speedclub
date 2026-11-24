// Visual registry entries of M5.5 Shop, app part (docs/10_CLIENT_ROUND_1.md §3, ADR-502, ADR-519, contract
// docs/reports/phase-5/m5.5-contract.md). Same fields as the entries in routes.mjs, which merges this list. SHOP-01 itself (routes-m52.mjs)
// stays the flag-off shell: its cells stage app-config with `shop: false`. The catalogue cells are SHOP-01-* (flagship variants).
//
// Local data (ShopSampleSeeder, contract §7): one active hero ("Dein Build. Dein Sticker.", cover-night-city-01.jpg, 3:2) and three badged
// sticker samples: car-sticker (sticker_designer, S · M · L), schriftzug-banner and round-badge (shopify without a URL, "Bald im Shop
// erhältlich"); no store configured, no Kleidung or Accessoires. States no seed reaches are staged on the server's own answer
// (`patch`): the samples as real products would look, a store product with an external
// buy. Slugs as the seeder writes them (checked against GET /api/v1/shop/products, 2026-11-16).

const ALL_STATES = ['default', 'loading', 'empty', 'error', 'offline'];

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const STORE = { configured: true, host: 'shop.joinspeedclub.com', shipping_url: 'https://shop.joinspeedclub.com/policies/shipping-policy' };

/**
 * The seeded cards and hero without the sample flag: how the wall looks with the client's real products (no "Beispiel").
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 */
async function asRealProducts({ stage }) {
  await stage('**/api/v1/shop', {
    patch: (/** @type {{ data: { hero: { is_sample: boolean } | null } }} */ body) => {
      if (body.data.hero) body.data.hero.is_sample = false;
      return body;
    },
  });
  await stage(/\/api\/v1\/shop\/products(\?.*)?$/, {
    patch: (/** @type {{ data: { is_sample: boolean }[] }} */ body) => {
      body.data = body.data.map((card) => ({ ...card, is_sample: false }));
      return body;
    },
  });
}

/**
 * schriftzug-banner with a store: an external buy on the product, a cart permalink per variant, the shipping page.
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 */
async function withStore({ stage }) {
  await stage(/\/api\/v1\/shop\/products\/schriftzug-banner(\?.*)?$/, {
    patch: (/** @type {{ data: Record<string, any> }} */ body) => {
      body.data.buy = { available: true, kind: 'external', url: 'https://shop.joinspeedclub.com/products/schriftzug-banner', path: null, reason: null, message: null };
      body.data.store = STORE;
      body.data.variants = (body.data.variants ?? []).map((/** @type {{ id: string }} */ variant, /** @type {number} */ index) => ({
        ...variant,
        buy: { available: true, kind: 'external', url: `https://shop.joinspeedclub.com/cart/4401234567890${index}:1?storefront=true`, path: null, reason: null, message: null },
      }));
      return body;
    },
  });
}

const GRID =
  'the 2-column wall (3 from 768, 4 from 1280) of 4:5 product photos, 0 radius, 2 apart, edge to edge on phones; under each the name in headline (2 lines, more at a large font) and the price in tnum with "inkl. MwSt." in caption; "Dein Sticker" (qr-sticker glyph, headline, one callout line, caret; a link to STK-01) after the grid. No cart, no count, no rating.';

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM55 = [
  {
    id: 'SHOP-01-catalogue',
    path: '/app/shop',
    phase: 3,
    auth: 'guest',
    states: ALL_STATES,
    ready: loadedOr('[data-testid="SHOP-01.categories"]', 'SHOP-01.root'),
    capture: 'expanded',
    maxHeight: 3200,
    p4: { en: true, tablet: true },
    notes:
      'R5-3 SHOP-01 ★ with the shop flag on (R5DQ-01): large title "Shop"; the available category (Sticker) as the lead: its first product photo (the Car-Sticker tail-light shot; R5DQ-22, the banner stays SHOP-03\'s hero), full-bleed 4:5 on phones; from 768 a split (R5DQ-27): the 4:5 photo on about 5 of 12 columns, radius 12 with a hairline edge, name and line beside it on its centre line; "Beispiel" on the sample, the name in title.2 with a caret, one callout line, no pill; under it the coming categories in the server\'s order as a compact row of 1:1 tiles (phones edge to edge, 2 apart; from 768 a quarter column each), "Bald verfügbar" on the photo over scrim.top, the name in headline (callout.strong from 1280), not pressable; at 200 % they stack as rows (an 88 photo, the name and the pill beside it, R5DQ-21). Nothing else of the catalogue. loading = the lead block and two tiles; empty (QA) = the app defaults; error = "Der Shop lädt gerade nicht" + retry; offline = the banner over the cached page (or the offline state).',
  },
  {
    id: 'SHOP-03-sticker',
    path: '/app/shop/c/sticker',
    phase: 3,
    auth: 'guest',
    states: ALL_STATES,
    ready: loadedOr('[data-testid^="SHOP-03.product."]', 'SHOP-03.root'),
    capture: 'expanded',
    maxHeight: 3200,
    p4: { en: true, tablet: true },
    notes: `R5-3 SHOP-03 Sticker: large title "Sticker" with back; the admin's hero (it opens this category) edge to edge, 16:9, "Dein Build. Dein Sticker." in display.title on the photo's dark stage, "Beispiel" on it, not a link here; ${GRID.replace(' "Dein Sticker" (qr-sticker glyph, headline, one callout line, caret; a link to STK-01) after the grid.', '')} Then "Dein Sticker" (no own headline under the hero): the lead, the five points with their glyphs, ONE primary "Sticker bestellen". loading = the banner block (R5DQ-18) and two rows of tiles; empty = the badged sample tile, "Noch keine Produkte im Shop", then the sticker block; error = "Diese Kategorie lädt gerade nicht" + retry; offline = the banner over the cached wall.`,
  },
  {
    id: 'SHOP-03-soon',
    path: '/app/shop/c/apparel',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="SHOP-03.soon"]',
    capture: 'expanded',
    maxHeight: 3200,
    notes: 'R5-3 SHOP-03 for a coming category opened by link (also /shop?category=apparel): large title "Kleidung" with back, the cockpit photo 16:9 radius 12, "Kleidung kommt bald" (no pill, R5DQ-09), one line, "Zum Shop" (secondary M). Never an empty list.',
  },
  {
    id: 'SHOP-03-live',
    path: '/app/shop/c/sticker',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid^="SHOP-03.product."]',
    capture: 'expanded',
    maxHeight: 3200,
    prepare: asRealProducts,
    notes:
      'SHOP-03 as the client\'s real products will look: the seeded hero and cards with the sample flag staged off, so the wall shows without the "Beispiel" badges (photo, name, price, "inkl. MwSt." only).',
  },
  {
    id: 'SHOP-02-external',
    path: '/app/shop/schriftzug-banner',
    phase: 3,
    auth: 'guest',
    states: ALL_STATES,
    ready: loadedOr('[data-testid="SHOP-02.buy"]', 'SHOP-02.root'),
    capture: 'expanded',
    fs2: true,
    p4: { en: true, tablet: true },
    prepare: withStore,
    notes:
      'M5.5 SHOP-02 with a store (staged external buy, contract §3.3): phones = the gallery edge to edge under the clear photo header (4:5, swipe, page pill when more than one photo; a tap opens the zoom viewer), from 768 in the 640 column with radius 12, from 1280 the photos stacked on 7 columns beside the facts on 5. "Sticker" (callout), the name in title.1, the gross price (headline, tnum) with "inkl. MwSt., zzgl. Versand"; the variant chips under their kind ("Größe"), a radio group, none chosen; ONE filled CTA "Im Shop kaufen" (L, full width, arrow-square-out; named "…, öffnet den Online-Shop shop.joinspeedclub.com"), the caption "Du wechselst zum Online-Shop shop.joinspeedclub.com. Bezahlt wird dort, nie in der App.", "Versand" (tertiary S, the store’s shipping policy), "Beschreibung". empty = "Dieses Produkt gibt es nicht mehr" + "Zum Shop"; loading = gallery block, identity, chips, the L button and three body lines.',
  },
  {
    id: 'SHOP-02-designer',
    path: '/app/shop/car-sticker',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    p4: { tablet: true, black: true, small: true },
    ready: '[data-testid="SHOP-02.buy"]',
    capture: 'expanded',
    fs2: true,
    notes:
      'SHOP-02 of the Car-Sticker (purchase_mode sticker_designer, the seed): six template drawings in the gallery, the S · M · L chips with their mm sizes, "Sticker gestalten" (primary L; a guest is asked to sign in, then STK-01) with "Du gestaltest den Sticker für dein Auto in der App. Bestellt wird danach im Online-Shop." No shipping link (no store configured).',
  },
  {
    id: 'SHOP-02-unavailable',
    path: '/app/shop/round-badge',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    // DQ-P5-031: the axes this page changes (09 §14.1).
    p4: { tablet: true, black: true, small: true },
    ready: '[data-testid="SHOP-02.buy"]',
    capture: 'expanded',
    fs2: true,
    notes: 'SHOP-02 of a store product without a store (the seed): the primary is disabled and says the server\'s line "Bald im Shop erhältlich"; no caption, no shipping link.',
  },
];
