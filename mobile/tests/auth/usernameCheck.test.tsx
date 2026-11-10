import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useUsernameCheck } from '@/api/queries/auth';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
// The client is built at import time with the configured origin; native has none in Jest, and a relative URL is no Request.
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const fetchMock = jest.fn<Promise<Response>, [Request]>();

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const clients: QueryClient[] = [];

// The check keeps an answer for a minute after its screen is gone; that timer would keep Jest from exiting.
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useUsernameCheck', () => {
  it('asks nothing for a name that broke a local rule', async () => {
    fetchMock.mockReset();
    await renderHook(() => useUsernameCheck(null), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels the request for an older input, so a late answer cannot speak for the new one', async () => {
    fetchMock.mockReset();
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((request: Request) => {
      signals.push(request.signal);
      const username = new URL(request.url).searchParams.get('username');
      return new Promise((resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        if (username === 'lukas.sc') {
          resolve(new Response(JSON.stringify({ data: { username, available: false, reason: 'taken' } }), { status: 200 }));
        }
      });
    });

    const { result, rerender } = await renderHook(({ name }: { name: string }) => useUsernameCheck(name), {
      wrapper,
      initialProps: { name: 'lukas' },
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    await rerender({ name: 'lukas.sc' });

    await waitFor(() => expect(result.current.data).toEqual({ username: 'lukas.sc', available: false, reason: 'taken' }));
    expect(signals[0]!.aborted).toBe(true);
    expect(new URL(fetchMock.mock.calls[1]![0].url).searchParams.get('username')).toBe('lukas.sc');
  });
});
