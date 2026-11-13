import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { queryClient } from '@/api/queryClient';
import { __resetRemovalsForTests } from '@/features/collections/deferred';
import { CollectionScreen } from '@/features/collections/screens/CollectionScreen';
import { CollectionsScreen } from '@/features/collections/screens/CollectionsScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, ToastHost } from '@/ui';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/profile/collections',
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
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const MEDIA = { id: 'm1', url: null, variants: [], blurhash: null, thumbhash: null, focal_x: null, focal_y: null };
const SAVED = { id: 'k0', name: 'Gespeichert', is_default: true, position: 2, items_count: 2, covers: [MEDIA], contains: null, created_at: null, updated_at: null };
const JDM = { id: 'k1', name: 'JDM', is_default: false, position: 1, items_count: 1, covers: [], contains: null, created_at: null, updated_at: null };
const VEHICLE = { id: 'v1', slug: 'nissan-skyline-gt-r-r34-5tf974vj', full_title: 'Nissan Skyline GT-R R34', cover: null, is_sample: false };
const ITEMS = [
  { type: 'vehicle', id: 'v1', position: 2, added_at: null, vehicle: VEHICLE, modification: null, build_update: null },
  { type: 'modification', id: 'm9', position: 1, added_at: null, vehicle: null, modification: { id: 'm9', title: 'KW V3', category: 'suspension', vehicle: VEHICLE }, build_update: null },
];

function signIn() {
  useSessionStore.setState({ status: 'member', member: { id: 'me', username: 'lukas.sc', displayName: 'Lukas Scholz', avatarUrl: null } });
}

function api(overrides: Record<string, Answer | (() => Answer)> = {}) {
  return stubFetch({
    '/me/collections/k0/items/order': { status: 204, body: null },
    '/me/collections/k0/items': { body: { data: ITEMS, links: {}, meta: { next_cursor: null, prev_cursor: null, per_page: 30, path: null } } },
    '/me/collections/k0/items/vehicle/v1': { status: 204, body: null },
    '/me/collections/k1': { body: { data: { ...JDM, name: 'Japan' } } },
    '/me/collections': { body: { data: [SAVED, JDM] } },
    ...overrides,
  });
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) =>
  renderWith(
    <>
      {element}
      <ToastHost />
    </>,
    client,
  );

beforeAll(async () => {
  await hydrateThemePreference();
  // The menu buttons open their ContextMenu at the button's place on screen.
  const native = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>('@react-native/jest-preset/jest/MockNativeMethods');
  native.default.measureInWindow.mockImplementation((done: (x: number, y: number, width: number, height: number) => void) => done(300, 400, 44, 44));
});
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  __resetRemovalsForTests();
  mockParams = {};
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  dismissToast();
  client.clear();
  queryClient.clear();
  jest.useRealTimers();
});

const methodOf = (calls: Request[], method: string, path: string) => calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(path));

describe('COL-01 Sammlungen', () => {
  it('shows the collections as private mosaic tiles, Gespeichert first, and opens one', async () => {
    signIn();
    api();
    await renderScreen(<CollectionsScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-01.collection.k0')).toBeTruthy());
    expect(screen.getByTestId('COL-01.collection.k0.name')).toHaveTextContent('Gespeichert');
    expect(screen.getByTestId('COL-01.private')).toHaveTextContent('Sammlungen sind privat.', { exact: false });
    expect(screen.getByTestId('COL-01.collection.k0')).toHaveProp('accessibilityLabel', 'Gespeichert, 2 Einträge, privat');
    await fireEvent.press(screen.getByTestId('COL-01.collection.k1'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/collections/k1');
  });

  it('invites with a sample preview when nothing is saved', async () => {
    signIn();
    api({ '/me/collections': { body: { data: [{ ...SAVED, items_count: 0, covers: [] }] } } });
    await renderScreen(<CollectionsScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-01.empty')).toBeTruthy());
    expect(screen.getByTestId('COL-01.empty.sample', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('COL-01.empty.action'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/discover');
  });

  it('renames through the sheet', async () => {
    signIn();
    const { calls } = api();
    await renderScreen(<CollectionsScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-01.collection.k1')).toBeTruthy());
    await act(async () => fireEvent(screen.getByTestId('COL-01.collection.k1'), 'accessibilityAction', { nativeEvent: { actionName: 'rename' } }));
    await waitFor(() => expect(screen.getByTestId('COL-01.nameSheet.name')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('COL-01.nameSheet.name'), 'Japan');
    await act(async () => fireEvent.press(screen.getByTestId('COL-01.nameSheet.submit')));
    await waitFor(() => expect(methodOf(calls, 'PATCH', '/me/collections/k1')).toHaveLength(1));
    expect(await methodOf(calls, 'PATCH', '/me/collections/k1')[0]?.clone().json()).toEqual({ name: 'Japan' });
  });

  it('deletes only after the undo toast, and Rückgängig keeps it', async () => {
    signIn();
    const { calls } = api();
    await renderScreen(<CollectionsScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-01.collection.k1')).toBeTruthy());
    jest.useFakeTimers();
    await act(async () => fireEvent(screen.getByTestId('COL-01.collection.k1'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } }));
    expect(screen.queryByTestId('COL-01.collection.k1')).toBeNull();
    expect(screen.getByTestId('COL-01.toast')).toHaveTextContent('„JDM“ gelöscht', { exact: false });
    await act(async () => fireEvent.press(screen.getByTestId('COL-01.toast.action')));
    expect(screen.getByTestId('COL-01.collection.k1')).toBeTruthy();
    await act(async () => jest.advanceTimersByTimeAsync(6000));
    expect(methodOf(calls, 'DELETE', '/me/collections/k1')).toHaveLength(0);
  });

  it('offers "Gespeichert" no delete', async () => {
    signIn();
    api();
    await renderScreen(<CollectionsScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-01.collection.k0')).toBeTruthy());
    const actions = (screen.getByTestId('COL-01.collection.k0').props.accessibilityActions as { name: string }[]).map((action) => action.name);
    expect(actions).toEqual(['rename']);
  });

  it('asks a guest to sign in', async () => {
    const { fetchMock } = api();
    await renderScreen(<CollectionsScreen />);
    expect(screen.getByTestId('COL-01.guest')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('COL-02 Sammlung', () => {
  beforeEach(() => {
    mockParams = { id: 'k0' };
  });

  it('shows the wall of builds and mods with the private count', async () => {
    signIn();
    api();
    await renderScreen(<CollectionScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-02.item.vehicle:v1')).toBeTruthy());
    expect(screen.getByTestId('COL-02.item.modification:m9')).toBeTruthy();
    expect(screen.getByTestId('COL-02.meta')).toHaveTextContent('Privat · 2 Einträge');
    // DQ-1125: the tile's link is under the control band that holds its menu.
    await fireEvent.press(screen.getByTestId('COL-02.item.modification:m9.open'));
    expect(mockRouter.push).toHaveBeenCalledWith('/v/nissan-skyline-gt-r-r34-5tf974vj/mods/m9');
  });

  it('moves an item to the start and sends the order it shows', async () => {
    signIn();
    const { calls } = api();
    await renderScreen(<CollectionScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-02.item.modification:m9.more')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('COL-02.item.modification:m9.more')));
    await act(async () => fireEvent.press(screen.getByTestId('COL-02.item.modification:m9.more.menu.first')));
    await waitFor(() => expect(methodOf(calls, 'PUT', '/me/collections/k0/items/order')).toHaveLength(1));
    expect(await methodOf(calls, 'PUT', '/me/collections/k0/items/order')[0]?.clone().json()).toEqual({ ids: ['modification:m9', 'vehicle:v1'] });
  });

  it('removes an item after the undo toast', async () => {
    signIn();
    const { calls } = api();
    await renderScreen(<CollectionScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-02.item.vehicle:v1.more')).toBeTruthy());
    jest.useFakeTimers();
    await act(async () => fireEvent.press(screen.getByTestId('COL-02.item.vehicle:v1.more')));
    await act(async () => fireEvent.press(screen.getByTestId('COL-02.item.vehicle:v1.more.menu.remove')));
    expect(screen.queryByTestId('COL-02.item.vehicle:v1')).toBeNull();
    expect(methodOf(calls, 'DELETE', '/me/collections/k0/items/vehicle/v1')).toHaveLength(0);
    await act(async () => jest.advanceTimersByTimeAsync(5000));
    expect(methodOf(calls, 'DELETE', '/me/collections/k0/items/vehicle/v1')).toHaveLength(1);
  });

  it('shows the empty wall with a sample preview', async () => {
    signIn();
    api({ '/me/collections/k0/items': { body: { data: [], links: {}, meta: { next_cursor: null, prev_cursor: null, per_page: 30, path: null } } } });
    await renderScreen(<CollectionScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-02.empty')).toBeTruthy());
    expect(screen.getByTestId('COL-02.empty.sample', { includeHiddenElements: true })).toBeTruthy();
  });

  it('says when the collection is gone', async () => {
    signIn();
    mockParams = { id: 'gone' };
    api({ '/me/collections/gone/items': { status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } } });
    await renderScreen(<CollectionScreen />);
    await waitFor(() => expect(screen.getByTestId('COL-02.missing')).toBeTruthy());
  });
});
