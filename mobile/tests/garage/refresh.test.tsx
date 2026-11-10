/**
 * What a change to a vehicle makes read again: the member's other pages when "Hauptfahrzeug" moves (BH-19), the code's own
 * state on QR-02 and QR-04 (BH-23), and Start, Entdecken, the search and the Profile count (BH-37).
 */
import { QueryClientProvider, useInfiniteQuery, useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { meKey } from '@/api/queries/auth';
import { discoverKeys } from '@/api/queries/discover';
import {
  garageKeys,
  refreshPublicLists,
  refreshVehicle,
  useAddNote,
  useChangeVisibility,
  useDeleteMedia,
  useDeleteVehicle,
  usePublishVehicle,
  useSaveSpecs,
  useSetMainVehicle,
  useUpdateVehicle,
  type GarageVehicle,
} from '@/api/queries/garage';
import { homeKeys } from '@/api/queries/home';
import { myVehiclesKey } from '@/api/queries/profile';
import { qrCodeKey, qrListKey } from '@/api/queries/qr';
import { searchKeys } from '@/api/queries/search';
import { vehicleKeys } from '@/api/queries/vehicles';

import { card, media, vehicle, VEHICLE_ID, SLUG } from './fixtures';
import { flushQueryNotifications, ME, newQueryClient, signIn, stubFetch } from './harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const VIEWER = 'guest|de';
const OTHER_VIEWER = '01nina|de';
const FIRST = homeKeys.newBuildsFirst(VIEWER);
const MORE = homeKeys.newBuildsMore(VIEWER);
const A = card({ id: '01aaa', slug: 'nissan-skyline-aaaaaaaa', is_main: true });
const B = card({ id: '01bbb', slug: 'bmw-m3-bbbbbbbb', is_main: false });
const PUBLIC_A = vehicleKeys.page(A.slug, VIEWER);
const PUBLIC_B = vehicleKeys.page(B.slug, VIEWER);
const feedCard = (id: string) => ({ id, public_id: id, slug: `x-${id}` });
const page = (ids: string[], next: string | null = null) => ({ data: ids.map(feedCard), links: {}, meta: { next_cursor: next } });

function setup() {
  const client = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

/** Every cached list a public change can touch, each with data, so "invalidated" means something. */
function fillPublicLists(client: QueryClient) {
  client.setQueryData(meKey, ME.body.data);
  client.setQueryData(homeKeys.featured(VIEWER), []);
  client.setQueryData(FIRST, page(['01aaa', '01bbb'], 'cursor-1'));
  client.setQueryData(MORE, { pages: [page(['01ccc', '01aaa'])], pageParams: ['cursor-1'] });
  client.setQueryData(discoverKeys.page(VIEWER), { makes: [] });
  client.setQueryData(searchKeys.overview(VIEWER, 'skyline'), { vehicles: [] });
}

const invalidated = (client: QueryClient, key: QueryKey) => client.getQueryState(key)?.isInvalidated;
const expectPublicListsRefreshed = (client: QueryClient) => {
  expect(invalidated(client, meKey)).toBe(true);
  expect(invalidated(client, homeKeys.featured(VIEWER))).toBe(true);
  expect(invalidated(client, FIRST)).toBe(true);
  expect(invalidated(client, discoverKeys.page(VIEWER))).toBe(true);
  expect(invalidated(client, searchKeys.overview(VIEWER, 'skyline'))).toBe(true);
};
const expectPublicListsUntouched = (client: QueryClient) => {
  expect(invalidated(client, meKey)).toBe(false);
  expect(invalidated(client, FIRST)).toBe(false);
  expect(invalidated(client, discoverKeys.page(VIEWER))).toBe(false);
  expect(invalidated(client, searchKeys.overview(VIEWER, 'skyline'))).toBe(false);
};

beforeEach(() => signIn());

describe('refreshPublicLists (BH-37)', () => {
  it('reads the public lists again and starts the continuation of Neue Builds over, for every viewer', () => {
    const { client } = setup();
    fillPublicLists(client);
    client.setQueryData(homeKeys.newBuildsMore(OTHER_VIEWER), { pages: [page(['01ccc'])], pageParams: ['cursor-1'] });
    refreshPublicLists(client);
    expectPublicListsRefreshed(client);
    expect(client.getQueryData(MORE)).toBeUndefined();
    expect(client.getQueryData(homeKeys.newBuildsMore(OTHER_VIEWER))).toBeUndefined();
    expect(client.getQueryData(FIRST)).toBeDefined();
  });

  it('never fetches the continuation by itself: it stays enabled: false', async () => {
    const { client, wrapper } = setup();
    const { fetchMock } = stubFetch({});
    const queryFn = jest.fn(async () => page([]));
    client.setQueryData(MORE, { pages: [page(['01ccc'])], pageParams: ['cursor-1'] });
    await renderHook(
      () => useInfiniteQuery({ queryKey: MORE, queryFn, initialPageParam: null as string | null, getNextPageParam: () => undefined, enabled: false }),
      { wrapper },
    );
    await act(async () => {
      refreshPublicLists(client);
    });
    expect(client.getQueryData(MORE)).toBeUndefined();
    expect(queryFn).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('who calls refreshPublicLists (BH-37)', () => {
  it('publishing does', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    stubFetch({ [`POST /api/v1/vehicles/${VEHICLE_ID}/publish`]: { body: { data: vehicle() } } });
    const { result } = await renderHook(() => usePublishVehicle(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ visibility: 'public', idempotencyKey: 'k' });
    });
    expectPublicListsRefreshed(client);
    expect(client.getQueryData(MORE)).toBeUndefined();
  });

  it('deleting does, and takes the card out of head and tail before the refetch answers', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    stubFetch({ 'DELETE /api/v1/vehicles/01aaa': { status: 204, body: null } });
    const { result } = await renderHook(() => useDeleteVehicle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: '01aaa', slug: A.slug });
    });
    expect((client.getQueryData(FIRST) as ReturnType<typeof page>).data.map((entry) => entry.id)).toEqual(['01bbb']);
    expect((client.getQueryData(FIRST) as ReturnType<typeof page>).meta.next_cursor).toBe('cursor-1');
    expectPublicListsRefreshed(client);
  });

  it('deleting does not ask the deleted build its similar builds again, while GAR-02 still shows the strip (F2 BH-37, round 3)', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    const gone = discoverKeys.similar(VIEWER, '01aaa');
    const other = discoverKeys.similar(VIEWER, '01bbb');
    const similarAnswer = { body: { data: [] } };
    const { calls } = stubFetch({
      'DELETE /api/v1/vehicles/01aaa': { status: 204, body: null },
      '/api/v1/vehicles/01aaa/similar': similarAnswer,
      '/api/v1/vehicles/01bbb/similar': similarAnswer,
    });
    // Both strips are on screen: the deleted build's (GAR-02 under GAR-05) and another build's.
    const useStrip = (key: QueryKey, id: string) =>
      useQuery({ queryKey: key, queryFn: async () => (await fetch(`https://speedclub.test/api/v1/vehicles/${id}/similar`)).json(), staleTime: Infinity });
    client.setQueryData(gone, []);
    client.setQueryData(other, []);
    await renderHook(() => [useStrip(gone, '01aaa'), useStrip(other, '01bbb')], { wrapper });
    const { result } = await renderHook(() => useDeleteVehicle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: '01aaa', slug: A.slug });
    });
    await flushQueryNotifications();
    expect(calls.filter((call) => call.path.endsWith('/vehicles/01aaa/similar'))).toHaveLength(0);
    // Stale for a later visit, which then shows the gone state; another build's strip reads again at once.
    expect(invalidated(client, gone)).toBe(true);
    await waitFor(() => expect(calls.filter((call) => call.path.endsWith('/vehicles/01bbb/similar'))).toHaveLength(1));
  });

  it('deleting leaves no page of the continuation behind, so the card cannot come back from memory', async () => {
    const { client } = setup();
    client.setQueryData(MORE, { pages: [page(['01ccc', '01aaa'])], pageParams: ['cursor-1'] });
    stubFetch({ 'DELETE /api/v1/vehicles/01aaa': { status: 204, body: null } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = await renderHook(() => useDeleteVehicle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: '01aaa', slug: A.slug });
    });
    expect(client.getQueryData(MORE)).toBeUndefined();
  });

  it('changing the visibility of a published vehicle does', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    stubFetch({ [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: vehicle({ visibility: 'private' }) } } });
    const { result } = await renderHook(() => useChangeVisibility(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('private');
    });
    expectPublicListsRefreshed(client);
  });

  it('saving the wizard’s visibility on a draft does not: nobody can see a draft', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    stubFetch({ [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: vehicle({ visibility: 'private', status: 'draft' }) } } });
    const { result } = await renderHook(() => useChangeVisibility(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('private');
    });
    expectPublicListsUntouched(client);
  });

  it('editing a published vehicle does, an autosave of a draft does not', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    let answer = vehicle({ status: 'draft' });
    stubFetch({
      [`PATCH /api/v1/vehicles/${VEHICLE_ID}`]: () => ({ body: { data: answer } }),
      [`PUT /api/v1/vehicles/${VEHICLE_ID}/specs`]: () => ({ body: { data: { ...answer, history_recorded: false } } }),
    });
    const { result } = await renderHook(() => ({ update: useUpdateVehicle(VEHICLE_ID), specs: useSaveSpecs(VEHICLE_ID) }), { wrapper });
    await act(async () => {
      await result.current.update.mutateAsync({ wizard_step: 2 });
      await result.current.specs.mutateAsync({ engine_code: 'RB26' });
    });
    expectPublicListsUntouched(client);

    answer = vehicle();
    await act(async () => {
      await result.current.update.mutateAsync({ color: 'Bayside Blue' });
    });
    expectPublicListsRefreshed(client);
  });

  it('saving specs of a published vehicle does', async () => {
    const { client, wrapper } = setup();
    fillPublicLists(client);
    stubFetch({ [`PUT /api/v1/vehicles/${VEHICLE_ID}/specs`]: { body: { data: { ...vehicle(), history_recorded: true } } } });
    const { result } = await renderHook(() => useSaveSpecs(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ engine_code: 'RB26' });
    });
    expectPublicListsRefreshed(client);
  });

  it('refreshVehicle on its own does not: every autosave and mod write calls it', () => {
    const { client } = setup();
    fillPublicLists(client);
    refreshVehicle(client, { id: VEHICLE_ID, slug: SLUG }, vehicle());
    expectPublicListsUntouched(client);
    expect(client.getQueryData(MORE)).toBeDefined();
  });
});

describe('the code’s own state on QR-02 and QR-04 (BH-23)', () => {
  it('useChangeVisibility invalidates [qr, code, id] as well as the list', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(qrCodeKey(VEHICLE_ID), { code: '8TR0Q3MC', scan_state: 'active' });
    client.setQueryData(qrListKey, []);
    stubFetch({ [`PATCH /api/v1/vehicles/${VEHICLE_ID}/visibility`]: { body: { data: vehicle({ visibility: 'private' }) } } });
    const { result } = await renderHook(() => useChangeVisibility(VEHICLE_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('private');
    });
    expect(invalidated(client, ['qr', 'code', VEHICLE_ID])).toBe(true);
    expect(invalidated(client, qrListKey)).toBe(true);
  });
});

describe('the main vehicle moves (BH-19)', () => {
  const garage = () => [A, B];

  it('after setMain on B, the cached page of A reads again', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(myVehiclesKey, garage());
    client.setQueryData(PUBLIC_A, { id: A.id, is_main: true });
    client.setQueryData(PUBLIC_B, { id: B.id, is_main: false });
    stubFetch({ 'POST /api/v1/vehicles/01bbb/main': { body: { data: vehicle({ id: B.id, slug: B.slug, is_main: true }) } } });
    const { result } = await renderHook(() => useSetMainVehicle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(B.id);
    });
    expect(invalidated(client, PUBLIC_A)).toBe(true);
    expect(invalidated(client, PUBLIC_B)).toBe(true);
  });

  it('an open page of A shows the row again without leaving it', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(myVehiclesKey, garage());
    let serverMain = A.id;
    stubFetch({
      [`GET /api/v1/public/vehicles/${A.slug}`]: () => ({ body: { data: { id: A.id, is_main: serverMain === A.id } } }),
      'POST /api/v1/vehicles/01bbb/main': () => {
        serverMain = B.id;
        return { body: { data: vehicle({ id: B.id, slug: B.slug, is_main: true }) } };
      },
    });
    // What GAR-02's sheet asks: the page of A says whether "Als Hauptfahrzeug" is on offer.
    const useOfferRow = () =>
      useQuery({
        queryKey: PUBLIC_A,
        queryFn: async () => {
          const answer = await globalThis.fetch(`https://speedclub.test/api/v1/public/vehicles/${A.slug}`);
          return ((await answer.json()) as { data: { is_main: boolean } }).data;
        },
      });
    const { result } = await renderHook(() => ({ page: useOfferRow(), setMain: useSetMainVehicle() }), { wrapper });
    await waitFor(() => expect(result.current.page.data?.is_main).toBe(true));
    await act(async () => {
      await result.current.setMain.mutateAsync(B.id);
    });
    await waitFor(() => expect(result.current.page.data?.is_main).toBe(false));
  });

  it('after deleting the main vehicle, the promoted one’s page reads again too', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(myVehiclesKey, garage());
    client.setQueryData(PUBLIC_B, { id: B.id, is_main: false });
    stubFetch({ 'DELETE /api/v1/vehicles/01aaa': { status: 204, body: null } });
    const { result } = await renderHook(() => useDeleteVehicle(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: A.id, slug: A.slug });
    });
    expect(invalidated(client, PUBLIC_B)).toBe(true);
    expect((client.getQueryData(myVehiclesKey) as (typeof A)[]).map((entry) => entry.id)).toEqual([B.id]);
    expect(client.getQueryData(garageKeys.vehicle(A.id))).toBeUndefined();
  });
});

describe('a deleted vehicle’s own pages do not read again (M1.9 r4: GAR-02 open under GAR-05 fetched a 404)', () => {
  const UPDATES_A = garageKeys.updates(A.id);
  const CODE_A = qrCodeKey(A.id);
  const useRead = (key: QueryKey, path: string) =>
    useQuery({
      queryKey: key,
      queryFn: async ({ signal }) => {
        const answer = await globalThis.fetch(`https://speedclub.test${path}`, { signal });
        return (await answer.json()) as unknown;
      },
    });
  // What GAR-02 keeps open: the public page, its Verlauf and the code of the vehicle being deleted, and the page of the other.
  const useOpenPages = () => ({
    pageA: useRead(PUBLIC_A, `/api/v1/public/vehicles/${A.slug}`),
    updatesA: useRead(UPDATES_A, `/api/v1/vehicles/${A.id}/updates`),
    codeA: useRead(CODE_A, `/api/v1/vehicles/${A.id}/qr`),
    pageB: useRead(PUBLIC_B, `/api/v1/public/vehicles/${B.slug}`),
    remove: useDeleteVehicle(),
  });
  const readsAfter = (calls: { method: string; path: string }[], index: number) =>
    calls.slice(index + 1).filter((call) => call.method === 'GET').map((call) => call.path);

  it.each([
    ['answers 204', { status: 204, body: null }],
    ['answers 404 (an earlier delete landed)', { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } }],
  ])('when the delete %s, nothing of it is fetched again; its copies are stale for a later visit; the other page reads again', async (_, answer) => {
    const { client, wrapper } = setup();
    client.setQueryData(myVehiclesKey, [A, B]);
    const { calls } = stubFetch({
      [`GET /api/v1/public/vehicles/${A.slug}`]: { body: { data: { id: A.id } } },
      [`GET /api/v1/vehicles/${A.id}/updates`]: { body: { data: [] } },
      [`GET /api/v1/vehicles/${A.id}/qr`]: { body: { data: { code: 'ABCDEFGH' } } },
      [`GET /api/v1/public/vehicles/${B.slug}`]: { body: { data: { id: B.id } } },
      'DELETE /api/v1/vehicles/01aaa': answer,
    });
    const { result } = await renderHook(useOpenPages, { wrapper });
    await waitFor(() => expect(result.current.pageA.isSuccess && result.current.updatesA.isSuccess && result.current.codeA.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.pageB.isSuccess).toBe(true));

    await act(async () => {
      await result.current.remove.mutateAsync({ id: A.id, slug: A.slug }).catch(() => undefined);
    });
    await flushQueryNotifications();
    const deleteAt = calls.findIndex((call) => call.method === 'DELETE');
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    await waitFor(() => expect(readsAfter(calls, deleteAt)).toContain(`/api/v1/public/vehicles/${B.slug}`));
    expect(readsAfter(calls, deleteAt)).not.toContain(`/api/v1/public/vehicles/${A.slug}`);
    expect(readsAfter(calls, deleteAt)).not.toContain(`/api/v1/vehicles/${A.id}/updates`);
    expect(readsAfter(calls, deleteAt)).not.toContain(`/api/v1/vehicles/${A.id}/qr`);
    expect(invalidated(client, PUBLIC_A)).toBe(true);
    expect(invalidated(client, UPDATES_A)).toBe(true);
    expect(invalidated(client, CODE_A)).toBe(true);
    expect((client.getQueryData(myVehiclesKey) as (typeof A)[]).map((entry) => entry.id)).toEqual([B.id]);
  });
});

describe('a note whose answer got lost (BH-03)', () => {
  const dropped = () => {
    throw new TypeError('Network request failed');
  };
  const reused = () => ({ status: 409, body: { message: 'x', code: 'idempotency_key_reused', errors: {} } });
  const refused = () => ({ status: 422, body: { message: 'x', code: 'validation_failed', errors: {} } });

  it.each([
    ['a lost answer', dropped, true],
    ['a reused key', reused, true],
    ['a refusal, which stored nothing', refused, false],
  ] as const)('%s reads the list again: %#', async (_name, answer, reads) => {
    const { client, wrapper } = setup();
    client.setQueryData(garageKeys.updates(VEHICLE_ID), { pages: [], pageParams: [] });
    stubFetch({ [`POST /api/v1/vehicles/${VEHICLE_ID}/updates`]: answer });
    const { result } = await renderHook(() => useAddNote({ id: VEHICLE_ID, slug: SLUG }), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ note: 'x', idempotencyKey: 'k' }).catch(() => undefined);
    });
    expect(invalidated(client, garageKeys.updates(VEHICLE_ID))).toBe(reads);
  });
});

describe('deleting a failed upload (BH-46)', () => {
  it('takes it out of failed_photos at once', async () => {
    const { client, wrapper } = setup();
    const failed = media('01bad', { status: 'failed', variants: [] });
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), vehicle({ failed_photos: [failed] }));
    stubFetch({ 'DELETE /api/v1/media/01bad': { status: 204, body: null } });
    const { result } = await renderHook(() => useDeleteMedia({ id: VEHICLE_ID, slug: SLUG }), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('01bad');
    });
    const cached = client.getQueryData<GarageVehicle>(garageKeys.vehicle(VEHICLE_ID));
    expect(cached?.failed_photos).toEqual([]);
    expect(cached?.photos).toHaveLength(2);
  });
});
