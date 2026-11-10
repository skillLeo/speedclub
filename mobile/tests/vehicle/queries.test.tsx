import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useCachedPublicVehicle, usePublicMod, usePublicVehicle, usePublicVehicleUpdates, vehicleKeys } from '@/api/queries/vehicles';
import { routeStateOf } from '@/features/vehicle/states';
import { useSessionStore } from '@/state/session';

import { R34, R34_WHEELS } from './fixtures';
import { newQueryClient, stubFetch } from './harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const SLUG = R34.slug;

function wrapperFor(client = newQueryClient()) {
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
}

beforeEach(() => {
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('public vehicle queries', () => {
  it('reads the page by slug, keyed by public id and viewer', async () => {
    const { calls } = stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    const { client, wrapper } = wrapperFor();
    const { result } = await renderHook(() => usePublicVehicle(SLUG), { wrapper });
    await waitFor(() => expect(result.current.data?.title).toBe('Skyline GT-R R34'));
    expect(new URL(calls[0]!.url).pathname).toBe(`/api/v1/public/vehicles/${SLUG}`);
    expect(calls[0]!.headers.get('Accept-Language')).toBe('de');
    expect(client.getQueryData(vehicleKeys.page('anything-5TF974VJ', 'guest|de'))).toEqual(R34);
  });

  it('asks again when a member signs in, because the API renders per viewer', async () => {
    const { calls } = stubFetch({ [`/public/vehicles/${SLUG}`]: { body: { data: R34 } } });
    const { wrapper } = wrapperFor();
    const { result } = await renderHook(() => usePublicVehicle(SLUG), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    await act(() => useSessionStore.setState({ status: 'member', member: { id: 'm1', username: 'max.e46', displayName: null, avatarUrl: null } }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('does not ask without a slug, and never retries a hidden vehicle', async () => {
    const { calls } = stubFetch({ '/public/vehicles/hidden-aaaaaaaa': { status: 404, body: { message: 'Fahrzeug nicht verfügbar.', code: 'vehicle_unavailable' } } });
    const { wrapper } = wrapperFor();
    await renderHook(() => usePublicVehicle(undefined), { wrapper });
    expect(calls).toHaveLength(0);
    const { result } = await renderHook(() => usePublicVehicle('hidden-aaaaaaaa'), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(calls).toHaveLength(1);
  });

  it('shows a vehicle that turned hidden as unavailable, though the refetch keeps its copy, and drops every other copy', async () => {
    let hidden = false;
    const { calls } = stubFetch({
      [`/public/vehicles/${SLUG}`]: () =>
        hidden ? { status: 404, body: { message: 'Fahrzeug nicht verfügbar.', code: 'vehicle_unavailable', errors: {} } } : { body: { data: R34 } },
    });
    const { client, wrapper } = wrapperFor();
    // Copies of the same vehicle for another viewer and a sub-route, as an earlier visit leaves them.
    client.setQueryData(vehicleKeys.page(SLUG, 'm1|de'), R34);
    client.setQueryData(vehicleKeys.mod(SLUG, 'guest|de', R34_WHEELS.id), R34_WHEELS);
    const { result } = await renderHook(() => ({ page: usePublicVehicle(SLUG), cached: useCachedPublicVehicle(SLUG) }), { wrapper });
    await waitFor(() => expect(result.current.page.data?.title).toBe('Skyline GT-R R34'));
    expect(routeStateOf(result.current.page, true, 'default')).toBe('ready');
    hidden = true;
    await act(async () => {
      await result.current.page.refetch();
    });
    expect(calls).toHaveLength(2);
    await waitFor(() => expect(result.current.page.error).toBeTruthy());
    // TanStack keeps the earlier data when a refetch fails: the 404 still decides.
    expect(result.current.page.data?.title).toBe('Skyline GT-R R34');
    expect(routeStateOf(result.current.page, true, 'default')).toBe('unavailable');
    expect(client.getQueryData(vehicleKeys.page(SLUG, 'm1|de'))).toBeUndefined();
    expect(client.getQueryData(vehicleKeys.mod(SLUG, 'guest|de', R34_WHEELS.id))).toBeUndefined();
    expect(client.getQueryState(vehicleKeys.page(SLUG, 'guest|de'))?.status).toBe('error');
    // No sub-route takes a head start from the hidden page.
    expect(result.current.cached).toBeUndefined();
  });

  it('reads one mod of the page', async () => {
    const { calls } = stubFetch({ [`/mods/${R34_WHEELS.id}`]: { body: { data: R34_WHEELS } } });
    const { wrapper } = wrapperFor();
    const { result } = await renderHook(() => usePublicMod(SLUG, R34_WHEELS.id), { wrapper });
    await waitFor(() => expect(result.current.data?.specs.length).toBeGreaterThan(0));
    expect(new URL(calls[0]!.url).pathname).toBe(`/api/v1/public/vehicles/${SLUG}/mods/${R34_WHEELS.id}`);
  });

  it('pages Verlauf with the cursor, only once asked', async () => {
    const page = (cursor: string | null) => ({
      body: { data: [R34.updates[0]], links: {}, meta: { next_cursor: cursor, per_page: 30, path: null, prev_cursor: null } },
    });
    let first = true;
    const { calls } = stubFetch({
      '/updates': () => {
        const answer = page(first ? 'next-page' : null);
        first = false;
        return answer;
      },
    });
    const { wrapper } = wrapperFor();
    const { result, rerender } = await renderHook(({ enabled }: { enabled: boolean }) => usePublicVehicleUpdates(SLUG, enabled), {
      wrapper,
      initialProps: { enabled: false },
    });
    expect(calls).toHaveLength(0);
    await rerender({ enabled: true });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(new URL(calls[1]!.url).searchParams.get('cursor')).toBe('next-page');
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
});
