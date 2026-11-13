import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { queryClient } from '@/api/queryClient';
import { __resetRemovalsForTests } from '@/features/collections/deferred';
import { EmbeddedBusinesses } from '@/features/parts/components/EmbeddedBusinesses';
import { EmbeddedParts } from '@/features/parts/components/EmbeddedParts';
import { BrandScreen } from '@/features/parts/screens/BrandScreen';
import { BusinessApplyScreen } from '@/features/parts/screens/BusinessApplyScreen';
import { BusinessDashboardScreen } from '@/features/parts/screens/BusinessDashboardScreen';
import { BusinessRequestsScreen } from '@/features/parts/screens/BusinessRequestsScreen';
import { BusinessScreen } from '@/features/parts/screens/BusinessScreen';
import { ProductScreen } from '@/features/parts/screens/ProductScreen';
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

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/b/werkstatt-nord',
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
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('react-native-webview', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { WebView: (props: { testID?: string }) => createElement(View, { testID: props.testID }) };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const page = (data: unknown[], next: string | null = null) => ({ data, links: {}, meta: { next_cursor: next, prev_cursor: null, per_page: 20, path: null } });
const media = (id: string) => ({
  id,
  status: 'ready',
  category: 'exterior',
  width: 1440,
  height: 1920,
  blurhash: null,
  thumbhash: null,
  focal_x: 0.5,
  focal_y: 0.5,
  alt: 'Blauer R34 von hinten',
  sort: 1,
  variants: [{ width: 640, height: 853, url: `https://speedclub.test/m/${id}-640.webp` }],
  created_at: null,
});
const build = (id: string, slug: string, title = 'Nissan Skyline GT-R R34') => ({ id, slug, full_title: title, cover: media(`c${id}`), is_sample: false, spec_strip: [] });

const BRAND = {
  slug: 'kw',
  name: 'KW',
  about: 'Gewindefahrwerke aus Fichtenberg.',
  website: 'https://www.kwsuspensions.de',
  country: 'DE',
  category: 'suspension',
  builds: '1204',
  products: '5',
  lines: [{ name: 'Variante', products: 3 }],
  share_path: '/brands/kw',
};
const PRODUCT_ROW = {
  id: '01JPRODUCT0000000000000001',
  slug: 'kw-variante-3',
  name: 'Variante 3',
  full_name: 'KW Variante 3',
  line: 'Variante',
  brand: { slug: 'kw', name: 'KW' },
  category: { key: 'suspension', name: 'Fahrwerk', icon: 'coilover' },
  builds: 14,
  status: 'active',
};
const PRODUCT = {
  ...PRODUCT_ROW,
  attributes: [
    { label: 'Bauart', value: 'Gewindefahrwerk' },
    { label: 'Dämpfung', value: 'Zug- und Druckstufe getrennt' },
  ],
  url: 'https://www.kwsuspensions.de/variante-3',
  affiliate: { url: 'https://shop.example/kw-v3', label: 'Anzeige', rel: 'sponsored' },
  brand_path: '/brands/kw',
};
const IMPRESSUM = {
  legal_name: 'Werkstatt Nord GmbH',
  legal_form: 'gmbh',
  legal_form_label: 'GmbH',
  representative: 'Jana Nord',
  street: 'Hafenweg 3',
  postcode: '20095',
  city: 'Hamburg',
  country: 'DE',
  email: 'kontakt@werkstatt-nord.de',
  phone: null,
  register_court: 'Amtsgericht Hamburg',
  register_number: 'HRB 123456',
  vat_id: 'DE123456789',
  is_sample: false,
};
const BUSINESS = {
  id: '01JBUSINESS000000000000001',
  slug: 'werkstatt-nord',
  name: 'Werkstatt Nord',
  kind: 'workshop',
  kind_label: 'Werkstatt',
  city: 'Hamburg',
  subline: 'Werkstatt · Hamburg',
  services: ['Fahrwerk', 'Abgasanlage', 'Achsvermessung'],
  logo: null,
  verified: true,
  is_sample: false,
  distance_km: null,
  share_path: '/b/werkstatt-nord',
  cover: media('cover1'),
  about: 'Fahrwerk, Abgasanlage und Achsvermessung auf der eigenen Bühne.',
  opening_hours: [
    { day: 'mon', ranges: [{ opens: '08:00', closes: '17:30' }], today: true },
    { day: 'tue', ranges: [{ opens: '08:00', closes: '17:30' }], today: false },
    { day: 'sun', ranges: [], today: false },
  ],
  address: { street: 'Hafenweg 3', postcode: '20095', city: 'Hamburg', country: 'DE', lat: 53.55, lng: 10 },
  contact: { phone: '+49 40 123456', email: 'kontakt@werkstatt-nord.de', website: 'https://werkstatt-nord.de', message_username: 'jana.nord' },
  portfolio_count: 2,
  impressum: IMPRESSUM,
  viewer_role: null,
};
const MY_BUSINESS = {
  ...BUSINESS,
  viewer_role: 'owner',
  status: 'verified',
  removed: false,
  status_reason: null,
  submitted_at: '2026-10-01T08:00:00Z',
  verified_at: '2026-10-02T08:00:00Z',
  document_note: null,
  identity_locked: true,
  team: [
    { username: 'jana.nord', role: 'owner' },
    { username: 'tom.schrauber', role: 'staff' },
  ],
  pending_requests: 1,
  views_30d: '128',
};
const TAG = {
  id: '01JTAG00000000000000000001',
  status: 'pending',
  initiated_by: 'member',
  mod: { id: '01JMOD00000000000000000001', title: 'KW Variante 3', category: 'suspension' },
  vehicle: { id: 'v1', slug: 'nissan-skyline-gt-r-r34-ab12cd34', full_title: 'Nissan Skyline GT-R R34', cover: media('t1'), is_sample: false },
  owner_username: 'max.r34',
  business: { slug: 'werkstatt-nord', name: 'Werkstatt Nord' },
  decided_at: null,
  created_at: '2026-11-10T09:00:00Z',
};

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) =>
  renderWith(
    <>
      {element}
      <ToastHost />
    </>,
    client,
  );

function flags(on: Record<string, boolean> = { parts_catalogue: true, businesses: true, collections: true }) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: on }, confirmed: true });
}
function signIn(username = 'jana.nord') {
  useSessionStore.setState({ status: 'member', member: { id: 'me', username, displayName: 'Jana', avatarUrl: null } });
}
const callsTo = (calls: Request[], method: string, path: string) => calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(path));
const asked = (calls: Request[], path: string) => calls.some((call) => new URL(call.url).pathname.includes(path));

beforeAll(async () => {
  await hydrateThemePreference();
});
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  dismissToast();
  __resetRemovalsForTests();
  jest.useRealTimers();
  client.clear();
  queryClient.clear();
});

describe('BRD-01 Marke', () => {
  beforeEach(() => {
    mockParams = { slug: 'kw' };
  });

  it('shows the wordmark with its real counts, the products with "In 14 Builds" and the builds wall', async () => {
    flags();
    stubFetch({
      '/brands/kw': { body: { data: BRAND } },
      '/brands/kw/products': { body: page([PRODUCT_ROW]) },
      '/brands/kw/builds': { body: page([build('b1', 'nissan-skyline-gt-r-r34-ab12cd34'), build('b2', 'bmw-m3-e46-cd34ef56', 'BMW M3 E46')]) },
    });
    await renderScreen(<BrandScreen />);
    await waitFor(() => expect(screen.getByTestId('BRD-01.title')).toHaveTextContent('KW'));
    expect(screen.getByTestId('BRD-01.counts')).toHaveTextContent('1.204 Builds · 5 Produkte');
    await waitFor(() => expect(screen.getByTestId(`BRD-01.product.${PRODUCT_ROW.id}.caption`)).toHaveTextContent('Fahrwerk · Variante · In 14 Builds'));
    expect(screen.getByTestId('BRD-01.line.0')).toHaveTextContent('3 Produkte', { exact: false });
    await waitFor(() => expect(screen.getByTestId('BRD-01.builds.build.b1')).toBeTruthy());
    expect(screen.getByTestId('BRD-01.builds.header')).toHaveTextContent('Builds mit KW');
    await act(async () => fireEvent.press(screen.getByTestId(`BRD-01.product.${PRODUCT_ROW.id}.body`)));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/products/[id]', params: { id: PRODUCT_ROW.id } });
  });

  it('says the catalogue is off and asks nothing while the flag is off', async () => {
    flags({});
    const { fetchMock } = stubFetch({});
    await renderScreen(<BrandScreen />);
    expect(screen.getByTestId('BRD-01.unavailable')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the not-found state with a sample preview for an unknown brand', async () => {
    flags();
    stubFetch({ '/brands/kw': { status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } } });
    await renderScreen(<BrandScreen />);
    await waitFor(() => expect(screen.getByTestId('BRD-01.notFound')).toBeTruthy());
    expect(screen.getByTestId('BRD-01.notFound.sample', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('BRD-02 Produkt', () => {
  it('shows the attributes, the maker’s page and the paid link labelled "Anzeige"', async () => {
    flags();
    mockParams = { id: PRODUCT.id };
    stubFetch({
      [`/products/${PRODUCT.id}`]: { body: { data: PRODUCT } },
      [`/products/${PRODUCT.id}/builds`]: { body: page([]) },
    });
    await renderScreen(<ProductScreen />);
    await waitFor(() => expect(screen.getByTestId('BRD-02.title')).toHaveTextContent('Variante 3'));
    expect(screen.getByTestId('BRD-02.count')).toHaveTextContent('Variante · In 14 Builds');
    expect(screen.getByTestId('BRD-02.attribute.0')).toHaveTextContent('Gewindefahrwerk', { exact: false });
    expect(screen.getByTestId('BRD-02.official')).toBeTruthy();
    expect(screen.getByTestId('BRD-02.affiliate.label')).toHaveTextContent('Anzeige');
    await waitFor(() => expect(screen.getByTestId('BRD-02.builds.empty')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('BRD-02.brand')));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/brands/[slug]', params: { slug: 'kw' } });
  });

  it('follows a merged product to its survivor', async () => {
    flags();
    mockParams = { id: '01JOLDPRODUCT0000000000001' };
    stubFetch({ '/products/01JOLDPRODUCT0000000000001': { body: { data: PRODUCT } }, [`/products/${PRODUCT.id}/builds`]: { body: page([]) } });
    await renderScreen(<ProductScreen />);
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledWith({ id: PRODUCT.id }));
  });
});

describe('BIZ-01 Betriebsprofil', () => {
  beforeEach(() => {
    mockParams = { slug: 'werkstatt-nord' };
  });

  it('shows the profile with today highlighted, contact, portfolio and the Impressum', async () => {
    flags();
    stubFetch({
      '/businesses/werkstatt-nord': { body: { data: BUSINESS } },
      '/businesses/werkstatt-nord/portfolio': { body: page([build('b1', 'nissan-skyline-gt-r-r34-ab12cd34')]) },
    });
    await renderScreen(<BusinessScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-01.title')).toHaveTextContent('Werkstatt Nord'));
    expect(screen.getByTestId('BIZ-01.subline')).toHaveTextContent('Werkstatt · Hamburg');
    expect(screen.getByTestId('BIZ-01.verified')).toBeTruthy();
    expect(screen.getByTestId('BIZ-01.hours.today')).toHaveTextContent('Heute');
    expect(screen.getByTestId('BIZ-01.hours.sun')).toHaveTextContent('Geschlossen', { exact: false });
    expect(screen.getByTestId('BIZ-01.impressum.register')).toHaveTextContent('Amtsgericht Hamburg, HRB 123456', { exact: false });
    expect(screen.getByTestId('BIZ-01.impressum.vatId')).toHaveTextContent('DE123456789', { exact: false });
    await waitFor(() => expect(screen.getByTestId('BIZ-01.portfolio.build.b1')).toBeTruthy());
    expect(screen.getByTestId('BIZ-01.portfolio.count')).toHaveTextContent('2 Builds');
  });

  it('"Nachricht" asks a guest to sign in and opens the conversation for a member', async () => {
    flags();
    signIn('max.r34');
    stubFetch({ '/businesses/werkstatt-nord': { body: { data: BUSINESS } }, '/portfolio': { body: page([]) } });
    await renderScreen(<BusinessScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-01.message')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-01.message')));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/new-message', params: { to: 'jana.nord' } });
  });

  it('a sample business shows its placeholder Impressum and no counts', async () => {
    flags();
    const { calls } = stubFetch({
      '/businesses/werkstatt-nord': { body: { data: { ...BUSINESS, is_sample: true, portfolio_count: null, impressum: { ...IMPRESSUM, is_sample: true } } } },
    });
    await renderScreen(<BusinessScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-01.sample')).toBeTruthy());
    expect(screen.getByTestId('BIZ-01.impressum.note')).toHaveTextContent('Beispieldaten', { exact: false });
    expect(screen.getByTestId('BIZ-01.portfolio.sample')).toBeTruthy();
    expect(asked(calls, '/portfolio')).toBe(false);
  });

  it('a business that is not public is not found', async () => {
    flags();
    stubFetch({ '/businesses/werkstatt-nord': { status: 404, body: { message: 'Nicht gefunden', code: 'business_unavailable' } } });
    await renderScreen(<BusinessScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-01.notFound')).toBeTruthy());
  });
});

describe('BIZ-02 Bewerbung', () => {
  it('walks the steps, refuses an incomplete step and sends the application with an Idempotency-Key', async () => {
    flags();
    signIn('max.r34');
    let created = false;
    const { calls } = stubFetch({
      '/me/business': () =>
        created
          ? { body: { data: { ...MY_BUSINESS, status: 'applied', verified: false, identity_locked: false } } }
          : { status: 404, body: { message: 'Kein Betrieb', code: 'business_unavailable' } },
    });
    await renderScreen(<BusinessApplyScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-02.name')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByText('Bitte ausfüllen.')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('BIZ-02.name'), 'Werkstatt Nord');
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('BIZ-02.step')).toHaveTextContent('Impressum', { exact: false }));
    await fireEvent.changeText(screen.getByTestId('BIZ-02.legalName'), 'Werkstatt Nord GmbH');
    await fireEvent.changeText(screen.getByTestId('BIZ-02.representative'), 'Jana Nord');
    await fireEvent.changeText(screen.getByTestId('BIZ-02.registerCourt'), 'Amtsgericht Hamburg');
    await fireEvent.changeText(screen.getByTestId('BIZ-02.registerNumber'), 'HRB 123456');
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('BIZ-02.street')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('BIZ-02.street'), 'Hafenweg 3');
    await fireEvent.changeText(screen.getByTestId('BIZ-02.postcode'), '20095');
    await fireEvent.changeText(screen.getByTestId('BIZ-02.city'), 'Hamburg');
    await fireEvent.changeText(screen.getByTestId('BIZ-02.email'), 'kontakt@werkstatt-nord.de');
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('BIZ-02.hours.mon')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('BIZ-02.acceptTerms')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.acceptTerms')));
    created = true;
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/me/business')).toHaveLength(1));
    const request = callsTo(calls, 'POST', '/me/business')[0];
    expect(request?.headers.get('Idempotency-Key')).toBeTruthy();
    const body = (await request?.clone().json()) as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'Werkstatt Nord', legal_form: 'gmbh', register_number: 'HRB 123456', accept_terms: true, country: 'DE' });
    expect(body.opening_hours).toMatchObject({ mon: [['09:00', '18:00']] });
  });

  it('puts a 422 on its field and goes back to its step', async () => {
    flags();
    signIn('jana.nord');
    mockParams = { edit: '1' };
    const { calls } = stubFetch({
      '/me/business': () => {
        const patch = calls.some((call) => call.method === 'PATCH');
        return patch
          ? { status: 422, body: { message: 'Die Angaben sind nicht gültig.', code: 'validation_failed', errors: { register_number: ['Die Registernummer passt nicht zum Registergericht.'] } } }
          : { body: { data: { ...MY_BUSINESS, status: 'rejected', status_reason: 'Registernummer fehlt.', identity_locked: false, verified: false } } };
      },
    });
    await renderScreen(<BusinessApplyScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-02.name')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('BIZ-02.about'), 'Neu: Klimaservice.');
    for (let step = 0; step < 4; step += 1) await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByTestId('BIZ-02.cta.primary')).toHaveTextContent('Speichern und erneut senden'));
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-02.cta.primary')));
    await waitFor(() => expect(screen.getByText('Die Registernummer passt nicht zum Registergericht.')).toBeTruthy());
    expect(screen.getByTestId('BIZ-02.step')).toHaveTextContent('Impressum', { exact: false });
    expect(callsTo(calls, 'POST', '/me/business/submit')).toHaveLength(0);
  });

  it('shows the status of an application in review with the way to withdraw it', async () => {
    flags();
    signIn('jana.nord');
    stubFetch({ '/me/business': { body: { data: { ...MY_BUSINESS, status: 'applied', verified: false, identity_locked: false } } } });
    await renderScreen(<BusinessApplyScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-02.status')).toBeTruthy());
    expect(screen.getByTestId('BIZ-02.status.pill')).toHaveTextContent('In Prüfung');
    expect(screen.getByTestId('BIZ-02.withdraw')).toBeTruthy();
  });

  it('sends a verified business on to its dashboard', async () => {
    flags();
    signIn('jana.nord');
    stubFetch({ '/me/business': { body: { data: MY_BUSINESS } } });
    await renderScreen(<BusinessApplyScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/business'));
  });
});

describe('BIZ-03 Betriebs-Dashboard', () => {
  it('shows the private views, the open requests and the team', async () => {
    flags();
    signIn('jana.nord');
    stubFetch({ '/me/business': { body: { data: MY_BUSINESS } }, '/portfolio': { body: page([]) } });
    await renderScreen(<BusinessDashboardScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-03.views')).toHaveTextContent('128', { exact: false }));
    expect(screen.getByTestId('BIZ-03.requests')).toHaveTextContent('1 offen', { exact: false });
    expect(screen.getByTestId('BIZ-03.team.tom.schrauber.remove')).toBeTruthy();
    expect(screen.queryByTestId('BIZ-03.team.jana.nord.remove')).toBeNull();
  });

  it('invites a member without a business with a sample card', async () => {
    flags();
    signIn('max.r34');
    stubFetch({ '/me/business': { status: 404, body: { message: 'Kein Betrieb', code: 'business_unavailable' } } });
    await renderScreen(<BusinessDashboardScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-03.empty')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByText('Betrieb anmelden')));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/business/apply');
  });
});

describe('BIZ-04 Anfragen', () => {
  it('confirms a request only after the undo toast, and "Rückgängig" keeps it', async () => {
    flags();
    signIn('jana.nord');
    const { calls } = stubFetch({
      '/me/business': { body: { data: MY_BUSINESS } },
      '/me/business/tag-requests': { body: page([TAG]) },
      [`/me/business/tag-requests/${TAG.id}`]: { body: { data: { ...TAG, status: 'accepted' } } },
    });
    await renderScreen(<BusinessRequestsScreen />);
    await waitFor(() => expect(screen.getByTestId(`BIZ-04.tag.${TAG.id}`)).toBeTruthy());
    jest.useFakeTimers();
    await act(async () => fireEvent.press(screen.getByTestId(`BIZ-04.tag.${TAG.id}.accept`)));
    expect(screen.queryByTestId(`BIZ-04.tag.${TAG.id}`)).toBeNull();
    expect(screen.getByTestId('BIZ-04.toast')).toHaveTextContent('Bestätigt: KW Variante 3', { exact: false });
    await act(async () => fireEvent.press(screen.getByTestId('BIZ-04.toast.action')));
    expect(screen.getByTestId(`BIZ-04.tag.${TAG.id}`)).toBeTruthy();
    await act(async () => jest.advanceTimersByTimeAsync(6000));
    expect(callsTo(calls, 'PATCH', `/tag-requests/${TAG.id}`)).toHaveLength(0);

    await act(async () => fireEvent.press(screen.getByTestId(`BIZ-04.tag.${TAG.id}.accept`)));
    await act(async () => jest.advanceTimersByTimeAsync(6000));
    jest.useRealTimers();
    await waitFor(() => expect(callsTo(calls, 'PATCH', `/tag-requests/${TAG.id}`)).toHaveLength(1));
    expect(await callsTo(calls, 'PATCH', `/tag-requests/${TAG.id}`)[0]?.clone().json()).toEqual({ decision: 'accepted' });
  });

  it('waits for the verification before there are requests', async () => {
    flags();
    signIn('jana.nord');
    stubFetch({ '/me/business': { body: { data: { ...MY_BUSINESS, status: 'applied', verified: false } } }, '/tag-requests': { body: page([]) } });
    await renderScreen(<BusinessRequestsScreen />);
    await waitFor(() => expect(screen.getByTestId('BIZ-04.notVerified')).toBeTruthy());
  });
});

describe('Entdecken scopes', () => {
  it('Teile lists the brands and the products with their counts', async () => {
    flags();
    stubFetch({ '/brands': { body: { data: [{ slug: 'kw', name: 'KW', builds: '30' }] } }, '/products': { body: page([PRODUCT_ROW]) } });
    await renderScreen(<EmbeddedParts query="" width={350} phone routeId="DISC-01" />);
    await waitFor(() => expect(screen.getByTestId('DISC-01.partsScope.brands.kw')).toBeTruthy());
    expect(screen.getByTestId(`DISC-01.partsScope.product.${PRODUCT_ROW.id}.caption`)).toHaveTextContent('In 14 Builds', { exact: false });
  });

  it('Betriebe lists the business cards and filters by kind', async () => {
    flags();
    const { calls } = stubFetch({ '/businesses': { body: page([BUSINESS]) } });
    await renderScreen(<EmbeddedBusinesses query="" bleed={20} routeId="DISC-01" />);
    await waitFor(() => expect(screen.getByTestId('DISC-01.businessesScope.business.werkstatt-nord')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('DISC-01.businessesScope.kind.tuner')));
    await waitFor(() => expect(calls.some((call) => call.url.includes('kind=tuner'))).toBe(true));
  });
});
