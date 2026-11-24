import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { queryClient } from '@/api/queryClient';
import { ShopProductScreen } from '@/features/shop/screens/ShopProductScreen';
import { ShopCategoryScreen } from '@/features/shop/screens/ShopCategoryScreen';
import { ShopScreen } from '@/features/shop/screens/ShopScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, ToastHost } from '@/ui';

import { newQueryClient, renderScreen as renderWith, stubFetch } from '../settings/harness';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: Record<string, string> = {};
const mockQa: { state: string } = { state: 'default' };
const mockOpenBrowser = jest.fn((_url: string, _options?: unknown) => Promise.resolve({ type: 'dismiss' }));

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/shop',
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  usePreventRemove: jest.fn(),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
  onEndReached?: () => void;
  testID?: string;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const { View, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent, onEndReached, testID } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(
      View,
      { testID },
      ListHeaderComponent,
      data.length === 0 ? ListEmptyComponent : items,
      ListFooterComponent,
      // The end of the list, as a scroll would reach it.
      createElement(Pressable, { testID: `${testID}.end`, onPress: onEndReached }),
    );
  });
  return { FlashList };
});
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string, options?: unknown) => mockOpenBrowser(url, options) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const image = (id: string) => ({
  id,
  width: 1600,
  height: 2000,
  aspect: '4:5',
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  thumbhash: null,
  focal_x: 0.5,
  focal_y: 0.5,
  alt: null,
  variants: [640, 1080].map((width) => ({ width, height: (width * 5) / 4, url: `https://speedclub.test/storage/shop/${id}-${width}.webp` })),
});
const price = (cents: number, formatted: string) => ({ amount_cents: cents, currency: 'EUR', formatted, vat_included: true });
const card = (slug: string, title: string, category: 'sticker' | 'apparel', extra: Record<string, unknown> = {}) => ({
  id: `01J${slug.toUpperCase().replace(/-/g, '').padEnd(23, '0').slice(0, 23)}`,
  slug,
  title,
  category: { key: category, label: category === 'sticker' ? 'Sticker' : 'Bekleidung' },
  price: price(1490, '14,90 €'),
  image: image(`img-${slug}`),
  purchase_mode: 'shopify',
  is_sample: false,
  ...extra,
});
const page = (data: unknown[], next: string | null = null) => ({ data, links: {}, meta: { next_cursor: next, prev_cursor: null, per_page: 24 } });
const STORE = { configured: true, host: 'shop.joinspeedclub.com', shipping_url: 'https://shop.joinspeedclub.com/policies/shipping-policy' };
/** `status`: R4-3.2's `categories[].status` from the server; left out, the app's defaults apply (only stickers available). */
/** `order`: R5-3, the server's order of the categories (SHOP-01 follows it); the app's by default. */
const head = (
  counts: { sticker: number; apparel: number },
  hero: unknown = null,
  status: Record<string, string> = {},
  order: readonly string[] = ['sticker', 'apparel', 'accessories'],
) => {
  const rows: Record<string, unknown> = {
    sticker: { key: 'sticker', label: 'Sticker', count: counts.sticker, ...(status.sticker ? { status: status.sticker } : {}) },
    apparel: { key: 'apparel', label: 'Bekleidung', count: counts.apparel, ...(status.apparel ? { status: status.apparel } : {}) },
    accessories: { key: 'accessories', label: 'Accessoires', count: 0, ...(status.accessories ? { status: status.accessories } : {}) },
  };
  return {
    data: { hero, categories: [{ key: 'all', label: 'Alle', count: counts.sticker + counts.apparel }, ...order.map((key) => rows[key])], store: STORE },
  };
};
const HERO = {
  id: '01JHERO0000000000000000001',
  title: 'Dein Build. Dein Sticker.',
  subtitle: 'Gestalte ihn in der App, bestell ihn im Shop.',
  image: { ...image('hero'), aspect: '3:2', width: 2400, height: 1600 },
  link: { kind: 'category', category: 'sticker', product: null },
  is_sample: true,
};
const STICKER = card('car-sticker', 'Car-Sticker – dein Design', 'sticker', { purchase_mode: 'sticker_designer', is_sample: true });
const HOODIE = card('club-hoodie', 'Club-Hoodie Schwarz', 'apparel', { price: price(5990, '59,90 €') });
const BANNER = card('wordmark-banner', 'Wordmark-Banner', 'sticker', { price: price(990, '9,90 €') });

const buy = (over: Record<string, unknown>) => ({ available: true, kind: null, url: null, path: null, reason: null, message: null, ...over });
const detail = (base: ReturnType<typeof card>, over: Record<string, unknown>) => ({
  data: {
    ...base,
    description: 'Schweres Baumwoll-Hoodie mit gesticktem Wordmark.\n\nPflege: 30 °C, links gewendet.',
    images: [image('a'), image('b')],
    variant_kind: { key: 'size', label: 'Größe' },
    variants: [],
    buy: buy({ available: false, reason: 'not_configured', message: 'Bald im Shop erhältlich' }),
    store: STORE,
    ...over,
  },
});

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) =>
  renderWith(
    <>
      {element}
      <ToastHost />
    </>,
    client,
  );
function flags(on: Record<string, boolean> = { shop: true }) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: on }, confirmed: true });
}
const requests = (calls: Request[], path: string) => calls.filter((call) => new URL(call.url).pathname.endsWith(path));

beforeAll(async () => {
  await hydrateThemePreference();
});
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  mockQa.state = 'default';
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  dismissToast();
  client.clear();
  queryClient.clear();
});

describe('SHOP-01 Shop: three categories (R5-3)', () => {
  it('flag off: the M5.2 shell, and nothing is asked of the shop API', async () => {
    flags({});
    const { calls } = stubFetch({});
    await renderScreen(<ShopScreen />);
    expect(screen.getByTestId('SHOP-01.closed.title')).toHaveTextContent('Der Speedclub Shop zieht hier ein');
    expect(screen.getByTestId('SHOP-01.stickers')).toBeTruthy();
    expect(calls.some((call) => new URL(call.url).pathname.includes('/shop'))).toBe(false);
  });

  it('the server says feature_disabled: the shell too, not an error', async () => {
    flags();
    stubFetch({ '/shop': { status: 404, body: { message: 'Nicht verfügbar', code: 'feature_disabled' } } });
    await renderScreen(<ShopScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-01.closed')).toBeTruthy());
    expect(screen.queryByTestId('SHOP-01.error')).toBeNull();
  });

  it('the available category leads, the coming ones follow as tiles, each group in the server order; only the lead opens', async () => {
    flags();
    const { calls } = stubFetch({
      '/shop': { body: head({ sticker: 2, apparel: 0 }, HERO, {}, ['accessories', 'sticker', 'apparel']) },
      '/shop/products': { body: page([STICKER, BANNER]) },
    });
    await renderScreen(<ShopScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-01.categories')).toBeTruthy());
    // R5DQ-01: the lead first, then the coming tiles in the server's order (accessories before apparel); nothing else of the
    // catalogue: no wall, no chips, no sticker block, no banner of its own.
    const cards = screen.getAllByTestId(/^SHOP-01\.category\.(sticker|apparel|accessories)$/).map((node) => node.props.testID);
    expect(cards).toEqual(['SHOP-01.category.sticker', 'SHOP-01.category.accessories', 'SHOP-01.category.apparel']);
    expect(screen.getByTestId('SHOP-01.soon')).toBeTruthy();
    expect(screen.queryByTestId('SHOP-01.hero')).toBeNull();
    expect(screen.queryByTestId('SHOP-01.promo')).toBeNull();
    expect(screen.queryByTestId('SHOP-01.category.all')).toBeNull();
    expect(screen.queryAllByTestId(/^SHOP-01\.product\./)).toHaveLength(0);
    // R5DQ-22: one request, for the lead's photo (Sticker's first page, the cache SHOP-03 opens with), never the wall here.
    expect(requests(calls, '/shop/products').map((call) => new URL(call.url).searchParams.get('category'))).toEqual(['sticker']);
    // Sticker: its first product's photo (R5DQ-10/22, not the banner; "Beispiel" on the sample), name, line; no "Verfügbar" pill.
    expect(screen.getByTestId('SHOP-01.category.sticker.title')).toHaveTextContent('Sticker');
    expect(screen.getByTestId('SHOP-01.category.sticker.body')).toHaveTextContent(/Sticker für dein Auto, gestaltet in der App\./);
    expect(screen.queryByTestId('SHOP-01.category.sticker.available')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('SHOP-01.category.sticker.photo.image').props.source).toEqual([expect.objectContaining({ uri: expect.stringContaining('img-car-sticker') })]),
    );
    expect(screen.getByTestId('SHOP-01.category.sticker.sample.sample')).toBeTruthy();
    expect(screen.getByTestId('SHOP-01.category.sticker')).toHaveProp('role', 'link');
    // R4DQ-27: the app's word "Kleidung" (the server says "Bekleidung"); coming: "Bald verfügbar", disabled, no press handler.
    const apparel = screen.getByTestId('SHOP-01.category.apparel');
    expect(screen.getByTestId('SHOP-01.category.apparel.title', { includeHiddenElements: true })).toHaveTextContent('Kleidung');
    expect(screen.getByTestId('SHOP-01.category.apparel.soon', { includeHiddenElements: true })).toHaveTextContent('Bald verfügbar');
    expect(apparel.props['aria-label']).toBe('Kleidung, bald verfügbar, noch nicht auswählbar');
    expect(apparel).toBeDisabled();
    expect(apparel.props.onClick).toBeUndefined();
    expect(screen.getByTestId('SHOP-01.category.accessories')).toBeDisabled();
    await fireEvent.press(apparel);
    expect(mockRouter.push).not.toHaveBeenCalled();
    // No count anywhere.
    expect(screen.queryByText(/\d/)).toBeNull();

    await fireEvent.press(screen.getByTestId('SHOP-01.category.sticker'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/shop/c/[category]', params: { category: 'sticker' } });
  });

  it('follows the server when a further category becomes available', async () => {
    flags();
    const seen: { calls: Request[] } = { calls: [] };
    seen.calls = stubFetch({
      '/shop': { body: head({ sticker: 2, apparel: 1 }, null, { apparel: 'available' }) },
      // Each category's own first page (the call is recorded before it is answered).
      '/shop/products': () => ({ body: page(new URL(seen.calls.at(-1)?.url ?? 'http://x').searchParams.get('category') === 'apparel' ? [HOODIE] : [STICKER]) }),
    }).calls;
    await renderScreen(<ShopScreen />);
    // A second available category leads too, before the coming one; its photo is its first product's.
    await waitFor(() => expect(screen.getByTestId('SHOP-01.category.apparel.photo.image').props.source).toEqual([expect.objectContaining({ uri: expect.stringContaining('img-club-hoodie') })]));
    const order = screen.getAllByTestId(/^SHOP-01\.category\.(sticker|apparel|accessories)$/).map((node) => node.props.testID);
    expect(order).toEqual(['SHOP-01.category.sticker', 'SHOP-01.category.apparel', 'SHOP-01.category.accessories']);
    expect(screen.getByTestId('SHOP-01.category.apparel')).toHaveProp('role', 'link');
    await fireEvent.press(screen.getByTestId('SHOP-01.category.apparel'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/shop/c/[category]', params: { category: 'apparel' } });
    expect(screen.getByTestId('SHOP-01.category.accessories')).toBeDisabled();
  });

  it('an old /shop?category= link forwards to the category page; an unknown one stays on the shop', async () => {
    flags();
    stubFetch({ '/shop': { body: head({ sticker: 2, apparel: 0 }) } });
    mockParams = { category: 'sticker' };
    await renderScreen(<ShopScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/shop/c/[category]', params: { category: 'sticker' } });
    await screen.unmount();
    mockRouter.replace.mockClear();
    mockParams = { category: 'cars' };
    await renderScreen(<ShopScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-01.categories')).toBeTruthy());
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('forwards even while the shop is off (the category page shows the shell)', async () => {
    flags({});
    stubFetch({});
    mockParams = { category: 'apparel' };
    await renderScreen(<ShopScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/shop/c/[category]', params: { category: 'apparel' } });
  });

  it('loading: three card skeletons; qaState=empty: the app defaults without a request', async () => {
    flags();
    mockQa.state = 'loading';
    stubFetch({});
    await renderScreen(<ShopScreen />);
    expect(screen.getByTestId('SHOP-01.skeleton', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('SHOP-01.categories')).toBeNull();
    await screen.unmount();
    mockQa.state = 'empty';
    const { calls } = stubFetch({});
    await renderScreen(<ShopScreen />);
    expect(screen.getByTestId('SHOP-01.category.sticker')).toHaveProp('role', 'link');
    expect(screen.getByTestId('SHOP-01.category.apparel')).toBeDisabled();
    expect(calls).toHaveLength(0);
  });

  it('a failing shop: the error state, and retry asks again', async () => {
    flags();
    const { calls } = stubFetch({ '/shop': { status: 503, body: { message: 'Der Shop ist gerade nicht erreichbar.', code: 'shop_unavailable' } } });
    await renderScreen(<ShopScreen />);
    // A 5xx is retried twice (1 s, 2 s) before the state shows.
    await waitFor(() => expect(screen.getByTestId('SHOP-01.error')).toBeTruthy(), { timeout: 6000 });
    expect(screen.queryByTestId('SHOP-01.categories')).toBeNull();
    const before = requests(calls, '/shop').length;
    await fireEvent.press(screen.getByText('Erneut versuchen'));
    await waitFor(() => expect(requests(calls, '/shop').length).toBeGreaterThan(before));
  }, 20_000);
});

describe('SHOP-03 Kategorie (R5-3)', () => {
  beforeEach(() => {
    mockParams = { category: 'sticker' };
  });

  it('sticker: the products, linking to SHOP-02; under them what the sticker does and the one order action', async () => {
    flags();
    const { calls } = stubFetch({ '/shop': { body: head({ sticker: 2, apparel: 0 }) }, '/shop/products': { body: page([STICKER, BANNER]) } });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.product.car-sticker.title')).toHaveTextContent('Car-⁠Sticker – dein Design'));
    expect(screen.getByTestId('SHOP-03.title')).toHaveTextContent('Sticker');
    expect(screen.getByTestId('SHOP-03.product.wordmark-banner.price')).toHaveTextContent('9,90 €');
    expect(screen.getByTestId('SHOP-03.product.wordmark-banner.vat')).toHaveTextContent('inkl. MwSt.');
    expect(screen.getByTestId('SHOP-03.product.car-sticker.sample.sample')).toBeTruthy();
    expect(new URL(requests(calls, '/shop/products')[0]?.url ?? '').searchParams.get('category')).toBe('sticker');
    // "Dein Sticker": its headline (no hero above), the lead, the five points, one primary.
    expect(screen.getByTestId('SHOP-03.promo.title')).toHaveTextContent('Dein Sticker');
    expect(screen.getByTestId('SHOP-03.promo.body')).toHaveTextContent(/^Ein QR-.*Sticker für dein Auto/);
    for (const point of ['page', 'meets', 'control', 'insights', 'design']) expect(screen.getByTestId(`SHOP-03.promo.point.${point}`)).toBeTruthy();
    expect(screen.getByTestId('SHOP-03.promo.point.control')).toHaveTextContent(/Ein Kennzeichen steht nie darauf\./);
    expect(screen.getByTestId('SHOP-03.promo.order')).toHaveTextContent('Sticker bestellen');
    await fireEvent.press(screen.getByTestId('SHOP-03.product.wordmark-banner'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/shop/[product]', params: { product: 'wordmark-banner' } });
    // A guest signs in before ordering, and lands on the stickers.
    await fireEvent.press(screen.getByTestId('SHOP-03.promo.order'));
    expect(useSessionStore.getState().intent).toMatchObject({ returnTo: '/stickers' });
  });

  it('a member orders for their main car (the designer STK-05)', async () => {
    flags();
    useSessionStore.setState({ status: 'member', member: { id: 'me', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }, promptOpen: false });
    stubFetch({
      '/shop': { body: head({ sticker: 1, apparel: 0 }) },
      '/shop/products': { body: page([STICKER]) },
      '/me/vehicles': { body: { data: [{ id: 'v1', is_main: false }, { id: 'v2', is_main: true }] } },
    });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.promo.order')).toBeTruthy());
    await waitFor(async () => {
      await fireEvent.press(screen.getByTestId('SHOP-03.promo.order'));
      expect(mockRouter.push).toHaveBeenLastCalledWith('/stickers/v2/design');
    });
  });

  it('the admin banner of this category leads the page (without opening itself); its headline replaces the block’s', async () => {
    flags();
    stubFetch({ '/shop': { body: head({ sticker: 2, apparel: 0 }, HERO) }, '/shop/products': { body: page([STICKER, BANNER]) } });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.hero.title')).toHaveTextContent('Dein Build. Dein Sticker.'));
    // No link to the page it is already on.
    expect(screen.getByTestId('SHOP-03.hero.open').props.role).toBeUndefined();
    expect(screen.getByTestId('SHOP-03.hero.open').props.onClick).toBeUndefined();
    expect(screen.queryByTestId('SHOP-03.promo.title')).toBeNull();
  });

  it('a product banner leads the category that lists the product, and opens it', async () => {
    flags();
    const hero = { ...HERO, link: { kind: 'product', category: null, product: { id: BANNER.id, slug: 'wordmark-banner' } } };
    stubFetch({ '/shop': { body: head({ sticker: 2, apparel: 0 }, hero) }, '/shop/products': { body: page([STICKER, BANNER]) } });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.hero.open')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('SHOP-03.hero.open'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/shop/[product]', params: { product: 'wordmark-banner' } });
  });

  it('a coming category opened by link: "Bald verfügbar" and the way back, never an empty list', async () => {
    flags();
    mockParams = { category: 'apparel' };
    const { calls } = stubFetch({ '/shop': { body: head({ sticker: 2, apparel: 0 }) }, '/shop/products': { body: page([]) } });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.soon')).toBeTruthy());
    expect(screen.getByTestId('SHOP-03.title')).toHaveTextContent('Kleidung');
    expect(screen.getByText('Kleidung kommt bald')).toBeTruthy();
    expect(screen.queryByTestId('SHOP-03.empty')).toBeNull();
    expect(screen.queryByTestId('SHOP-03.promo')).toBeNull();
    expect(requests(calls, '/shop/products')).toHaveLength(0);
    await fireEvent.press(screen.getByText('Zum Shop'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/shop');
  });

  it('a coming category without the server\'s answer: the error state with retry, never a guessed "Bald verfügbar"', async () => {
    flags();
    mockParams = { category: 'apparel' };
    stubFetch({ '/shop': { status: 503, body: { message: 'Der Shop ist gerade nicht erreichbar.', code: 'shop_unavailable' } } });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.error')).toBeTruthy(), { timeout: 6000 });
    expect(screen.queryByTestId('SHOP-03.soon')).toBeNull();
  }, 20_000);

  it('no stickers yet: the badged sample and the line, then the sticker block with its order action', async () => {
    flags();
    stubFetch({ '/shop': { body: head({ sticker: 0, apparel: 0 }) }, '/shop/products': { body: page([]) } });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.empty')).toBeTruthy());
    expect(screen.getByTestId('SHOP-03.empty.sample.badge.sample', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('SHOP-03.promo.order')).toBeTruthy();
    expect(screen.queryByText('Zum Shop')).toBeNull();
  });

  it('loads the next page by its cursor', async () => {
    flags();
    const { calls } = stubFetch({
      '/shop': { body: head({ sticker: 2, apparel: 0 }) },
      '/shop/products': () => ({ body: requests(calls, '/shop/products').length > 1 ? page([BANNER]) : page([STICKER], 'c2') }),
    });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.product.car-sticker')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('SHOP-03.list.end'));
    await waitFor(() => expect(requests(calls, '/shop/products')).toHaveLength(2));
    expect(new URL(requests(calls, '/shop/products')[1]?.url ?? '').searchParams.get('cursor')).toBe('c2');
    await waitFor(() => expect(screen.getByTestId('SHOP-03.product.wordmark-banner')).toBeTruthy());
  });

  it('a failing category: the error state with retry, and no sticker block over it', async () => {
    flags();
    const { calls } = stubFetch({
      '/shop': { body: head({ sticker: 2, apparel: 0 }) },
      '/shop/products': { status: 503, body: { message: 'Der Shop ist gerade nicht erreichbar.', code: 'shop_unavailable' } },
    });
    await renderScreen(<ShopCategoryScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-03.error')).toBeTruthy(), { timeout: 6000 });
    expect(screen.queryByTestId('SHOP-03.promo')).toBeNull();
    const before = requests(calls, '/shop/products').length;
    await fireEvent.press(screen.getByText('Erneut versuchen'));
    await waitFor(() => expect(requests(calls, '/shop/products').length).toBeGreaterThan(before));
  }, 20_000);

  it('loading: the wall skeleton', async () => {
    flags();
    mockQa.state = 'loading';
    stubFetch({});
    await renderScreen(<ShopCategoryScreen />);
    expect(screen.getByTestId('SHOP-03.skeleton', { includeHiddenElements: true })).toBeTruthy();
    // R5DQ-18: the banner's geometry above the wall while it may still come.
    expect(screen.getByTestId('SHOP-03.skeleton.hero', { includeHiddenElements: true })).toBeTruthy();
  });

  it('flag off: the shell; an unknown category: "Diese Kategorie gibt es nicht"', async () => {
    flags({});
    const { calls } = stubFetch({});
    await renderScreen(<ShopCategoryScreen />);
    expect(screen.getByTestId('SHOP-03.closed')).toBeTruthy();
    expect(calls).toHaveLength(0);
    await screen.unmount();
    flags();
    mockParams = { category: 'cars' };
    await renderScreen(<ShopCategoryScreen />);
    expect(screen.getByTestId('SHOP-03.notFound')).toHaveTextContent(/Diese Kategorie gibt es nicht/);
  });

  it('back: to where the member came from, else to the shop', async () => {
    flags();
    stubFetch({ '/shop': { body: head({ sticker: 2, apparel: 0 }) }, '/shop/products': { body: page([STICKER]) } });
    mockRouter.canGoBack.mockReturnValue(false);
    await renderScreen(<ShopCategoryScreen />);
    await fireEvent.press(screen.getByTestId('SHOP-03.header.back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/shop');
    mockRouter.canGoBack.mockReturnValue(true);
  });
});

describe('SHOP-02 Produkt', () => {
  beforeEach(() => {
    mockParams = { product: 'club-hoodie' };
  });

  it('external: "Im Shop kaufen" opens the server URL exactly, named as opening the online shop; a variant takes its cart permalink', async () => {
    flags();
    const productUrl = 'https://shop.joinspeedclub.com/products/club-hoodie';
    const cartUrl = 'https://shop.joinspeedclub.com/cart/44012345678901:1?storefront=true';
    stubFetch({
      '/shop/products/club-hoodie': {
        body: detail(HOODIE, {
          variants: [
            { id: 'k3m9x2ab', label: 'M', buy: buy({ kind: 'external', url: cartUrl }) },
            { id: 'p9q8r7s6', label: 'L', buy: buy({ kind: 'external', url: productUrl }) },
          ],
          buy: buy({ kind: 'external', url: productUrl }),
        }),
      },
    });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.title')).toHaveTextContent('Club-Hoodie Schwarz'));
    expect(screen.getByTestId('SHOP-02.price')).toHaveTextContent('59,90 €');
    expect(screen.getByTestId('SHOP-02.vat')).toHaveTextContent('inkl. MwSt., zzgl. Versand');
    expect(screen.getByTestId('SHOP-02.buy')).toHaveTextContent('Im Shop kaufen');
    expect(screen.getByTestId('SHOP-02.buy')).toHaveProp('accessibilityLabel', 'Im Shop kaufen, öffnet den Online-Shop shop.joinspeedclub.com');
    expect(screen.getByTestId('SHOP-02.buyNote')).toHaveTextContent('Du wechselst zum Online-Shop shop.joinspeedclub.com. Bezahlt wird dort, nie in der App.');
    expect(screen.getByTestId('SHOP-02.description')).toHaveTextContent(/Pflege: 30 °C/);

    await fireEvent.press(screen.getByTestId('SHOP-02.buy'));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenLastCalledWith(productUrl, expect.anything()));

    await fireEvent.press(screen.getByTestId('SHOP-02.variant.k3m9x2ab'));
    await waitFor(() => expect(screen.getByTestId('SHOP-02.variant.k3m9x2ab')).toBeChecked());
    await fireEvent.press(screen.getByTestId('SHOP-02.buy'));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenLastCalledWith(cartUrl, expect.anything()));

    // Radio semantics (review M5.5): a second tap keeps the choice; another chip moves it, and takes its own link.
    await fireEvent.press(screen.getByTestId('SHOP-02.variant.k3m9x2ab'));
    expect(screen.getByTestId('SHOP-02.variant.k3m9x2ab')).toBeChecked();
    expect(screen.getByTestId('SHOP-02.variant.k3m9x2ab')).toHaveProp('role', 'radio');
    await fireEvent.press(screen.getByTestId('SHOP-02.variant.p9q8r7s6'));
    await waitFor(() => expect(screen.getByTestId('SHOP-02.variant.p9q8r7s6')).toBeChecked());
    expect(screen.getByTestId('SHOP-02.variant.k3m9x2ab')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('SHOP-02.buy'));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenLastCalledWith(productUrl, expect.anything()));

    expect(screen.getByTestId('SHOP-02.shipping')).toHaveTextContent('Versand');
    await fireEvent.press(screen.getByTestId('SHOP-02.shipping'));
    await waitFor(() => expect(mockOpenBrowser).toHaveBeenLastCalledWith(STORE.shipping_url, expect.anything()));
  });

  it('designer: "Sticker gestalten" goes to the sticker hub; a guest is asked to sign in first', async () => {
    flags();
    mockParams = { product: 'car-sticker' };
    stubFetch({ '/shop/products/car-sticker': { body: detail(STICKER, { buy: buy({ kind: 'designer', path: '/stickers' }) }) } });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.buy')).toHaveTextContent('Sticker gestalten'));
    await fireEvent.press(screen.getByTestId('SHOP-02.buy'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
    expect(useSessionStore.getState().intent).toMatchObject({ returnTo: '/stickers' });
    expect(mockRouter.push).not.toHaveBeenCalled();

    useSessionStore.setState({ status: 'member', member: { id: 'me', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null }, promptOpen: false });
    await fireEvent.press(screen.getByTestId('SHOP-02.buy'));
    expect(mockRouter.push).toHaveBeenCalledWith('/stickers');
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it('unavailable: disabled with "Bald im Shop erhältlich", and pressing opens nothing', async () => {
    flags();
    mockParams = { product: 'wordmark-banner' };
    stubFetch({ '/shop/products/wordmark-banner': { body: detail(BANNER, {}) } });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.buy')).toHaveTextContent('Bald im Shop erhältlich'));
    expect(screen.getByTestId('SHOP-02.buy')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('SHOP-02.buy'));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
    expect(screen.queryByTestId('SHOP-02.buyNote')).toBeNull();
  });

  it('a product that is gone: "Dieses Produkt gibt es nicht mehr" and the way back to the shop', async () => {
    flags();
    stubFetch({ '/shop/products/club-hoodie': { status: 404, body: { message: 'Nicht gefunden', code: 'shop_product_unavailable' } } });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.notFound')).toBeTruthy());
    expect(screen.getByText('Dieses Produkt gibt es nicht mehr')).toBeTruthy();
    await fireEvent.press(screen.getByText('Zum Shop'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/shop');
  });

  it('R5-4: one photo is a plain page, no ScrollView (react-native-web makes a disabled one touch-action: none); two are the pager', async () => {
    flags();
    stubFetch({ '/shop/products/club-hoodie': { body: detail(HOODIE, { images: [image('a')] }) } });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.gallery.pager')).toBeTruthy());
    const single = screen.getByTestId('SHOP-02.gallery.pager');
    expect(single.type).toBe('View');
    expect(single.props.scrollEnabled).toBeUndefined();
    expect(StyleSheet.flatten(single.props.style)?.touchAction).toBeUndefined();
    expect(screen.getByTestId('SHOP-02.gallery.page.0')).toBeTruthy();
    expect(screen.queryByTestId('SHOP-02.gallery.pages')).toBeNull();
    await screen.unmount();
    client.clear();
    flags();
    stubFetch({ '/shop/products/club-hoodie': { body: detail(HOODIE, {}) } });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.gallery.pager')).toBeTruthy());
    expect(screen.getByTestId('SHOP-02.gallery.pager').type).toBe('RCTScrollView');
    expect(screen.getByTestId('SHOP-02.gallery.pager').props.scrollEnabled).not.toBe(false);
  });

  it('R5-3: back from a product opened cold goes to its category page', async () => {
    flags();
    mockRouter.canGoBack.mockReturnValue(false);
    stubFetch({ '/shop/products/club-hoodie': { body: detail(HOODIE, {}) } });
    await renderScreen(<ShopProductScreen />);
    await waitFor(() => expect(screen.getByTestId('SHOP-02.title')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('SHOP-02.header.back'));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/shop/c/[category]', params: { category: 'apparel' } });
    mockRouter.canGoBack.mockReturnValue(true);
  });

  it('flag off: the shell, and the product is not asked for', async () => {
    flags({});
    const { calls } = stubFetch({});
    await renderScreen(<ShopProductScreen />);
    expect(screen.getByTestId('SHOP-02.closed')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
