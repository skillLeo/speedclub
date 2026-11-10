/**
 * The optimistic writes of the garage: each moves the cache at once, and a refused call puts back exactly what was there.
 * The request is held open, so the test sees the optimistic state before the answer.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { garageKeys, useHideUpdate, useReorderMedia, useReorderVehicles, type GarageVehicle, type OwnerUpdate } from '@/api/queries/garage';
import { modKeys, useDeleteModPhoto, useReorderMods } from '@/api/queries/mods';
import { myVehiclesKey } from '@/api/queries/profile';

import { card, media, vehicle, VEHICLE_ID, SLUG, wheelMod } from './fixtures';
import { newQueryClient, signIn } from './harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

type Held = { method: string; path: string; body: unknown; answer: (status: number, body?: unknown) => void };

/** Every request waits until the test answers it. */
function holdFetch() {
  const held: Held[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    const text = request.method === 'GET' ? '' : await request.text();
    return new Promise<Response>((resolve) => {
      held.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: text ? (JSON.parse(text) as unknown) : null,
        answer: (status, body) =>
          resolve(new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })),
      });
    });
  }) as unknown as typeof fetch;
  return held;
}

const REFUSED = { message: 'Die Reihenfolge passt nicht.', code: 'validation_failed', errors: { ids: ['Jedes Foto genau einmal.'] } };
const REF = { id: VEHICLE_ID, slug: SLUG };

function setup() {
  const client = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

async function nextRequest(held: Held[], index: number): Promise<Held> {
  await waitFor(() => expect(held.length).toBeGreaterThan(index));
  return held[index]!;
}

beforeEach(() => signIn());

describe('rollback of optimistic writes', () => {
  it('GAR-01 Sortieren: the garage moves at once and goes back to the server’s order when refused', async () => {
    const held = holdFetch();
    const { client, wrapper } = setup();
    const before = [card(), card({ id: '01second', is_main: false })];
    client.setQueryData(myVehiclesKey, before);
    const { result } = await renderHook(() => useReorderVehicles(), { wrapper });
    await act(async () => {
      result.current.mutate(['01second', VEHICLE_ID]);
    });
    const request = await nextRequest(held, 0);
    expect(request).toMatchObject({ method: 'PUT', path: '/api/v1/me/vehicles/order', body: { ids: ['01second', VEHICLE_ID] } });
    expect(client.getQueryData<typeof before>(myVehiclesKey)?.map((entry) => entry.id)).toEqual(['01second', VEHICLE_ID]);
    await act(async () => request.answer(422, REFUSED));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(myVehiclesKey)).toEqual(before);
  });

  it('GAR-07 Sortieren: the photos move at once and go back when refused', async () => {
    const held = holdFetch();
    const { client, wrapper } = setup();
    const before = vehicle({ photos: [media('01p1'), media('01p2'), media('01p3')] });
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), before);
    const { result } = await renderHook(() => useReorderMedia(REF), { wrapper });
    await act(async () => {
      result.current.mutate(['01p3', '01p1', '01p2']);
    });
    const request = await nextRequest(held, 0);
    expect(request).toMatchObject({ method: 'PUT', path: `/api/v1/vehicles/${VEHICLE_ID}/media/order` });
    expect(client.getQueryData<GarageVehicle>(garageKeys.vehicle(VEHICLE_ID))?.photos.map((photo) => photo.id)).toEqual(['01p3', '01p1', '01p2']);
    await act(async () => request.answer(422, REFUSED));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(garageKeys.vehicle(VEHICLE_ID))).toEqual(before);
  });

  it('GAR-09 Sortieren: the mods move at once and go back when the server fails', async () => {
    const held = holdFetch();
    const { client, wrapper } = setup();
    const before = [wheelMod(), wheelMod({ id: '01exhaust', title: 'HKS Hi-Power' })];
    client.setQueryData(modKeys.list(VEHICLE_ID), before);
    const { result } = await renderHook(() => useReorderMods(REF), { wrapper });
    await act(async () => {
      result.current.mutate(['01exhaust', '01wheels']);
    });
    const request = await nextRequest(held, 0);
    expect(request).toMatchObject({ method: 'PUT', path: `/api/v1/vehicles/${VEHICLE_ID}/mods/order` });
    expect(client.getQueryData<typeof before>(modKeys.list(VEHICLE_ID))?.map((mod) => mod.id)).toEqual(['01exhaust', '01wheels']);
    await act(async () => request.answer(500, { message: 'Fehler', code: 'server', errors: {} }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(modKeys.list(VEHICLE_ID))).toEqual(before);
  });

  it('GAR-11 ausblenden: the row changes at once and comes back when refused', async () => {
    const held = holdFetch();
    const { client, wrapper } = setup();
    const entry = { id: '01update', type: 'mod_added', hidden: false } as unknown as OwnerUpdate;
    const before = { pages: [{ data: [entry], links: {}, meta: { next_cursor: null } }], pageParams: [null] };
    client.setQueryData(garageKeys.updates(VEHICLE_ID), before);
    const { result } = await renderHook(() => useHideUpdate(REF), { wrapper });
    await act(async () => {
      result.current.mutate({ id: '01update', hidden: true });
    });
    const request = await nextRequest(held, 0);
    expect(request).toMatchObject({ method: 'PATCH', path: '/api/v1/updates/01update', body: { hidden: true } });
    expect(client.getQueryData<typeof before>(garageKeys.updates(VEHICLE_ID))?.pages[0]?.data[0]?.hidden).toBe(true);
    await act(async () => request.answer(403, { message: 'Dein Konto ist eingeschränkt.', code: 'account_restricted', errors: {} }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(garageKeys.updates(VEHICLE_ID))).toEqual(before);
  });
});

describe('GAR-10 deleting a mod photo', () => {
  it('drops the photo from the mod the grid reads, and reads the mod, its list and the vehicle again', async () => {
    const held = holdFetch();
    const { client, wrapper } = setup();
    client.setQueryData(modKeys.mod('01wheels'), wheelMod({ photos: [media('01p1'), media('01p2')] }));
    client.setQueryData(modKeys.list(VEHICLE_ID), [wheelMod()]);
    client.setQueryData(garageKeys.vehicle(VEHICLE_ID), vehicle());
    const { result } = await renderHook(() => useDeleteModPhoto(REF, '01wheels'), { wrapper });
    await act(async () => {
      result.current.mutate('01p1');
    });
    const request = await nextRequest(held, 0);
    expect(request).toMatchObject({ method: 'DELETE', path: '/api/v1/media/01p1' });
    await act(async () => request.answer(204));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData<ReturnType<typeof wheelMod>>(modKeys.mod('01wheels'))?.photos.map((photo) => photo.id)).toEqual(['01p2']);
    expect(client.getQueryState(modKeys.mod('01wheels'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(modKeys.list(VEHICLE_ID))?.isInvalidated).toBe(true);
    expect(client.getQueryState(garageKeys.vehicle(VEHICLE_ID))?.isInvalidated).toBe(true);
  });
});
