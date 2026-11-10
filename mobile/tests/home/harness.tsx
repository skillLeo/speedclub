/**
 * Providers as in the root layout, a fetch stub that answers by path, and the network switch. Each test file mocks
 * expo-router, FlashList and NetInfo itself, because jest.mock is hoisted per file.
 */
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { ThemeProvider } from '@/theme';

/**
 * No retries by default, and none waited for: a query that retries by its own rule (`retryUnlessAnswered`) does so at
 * once instead of after TanStack's 1 s and 2 s backoff.
 */
export function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
}

/** The tree `renderWithProviders` renders, for a `rerender` with new route params. */
export function withProviders(element: ReactElement, client: QueryClient): ReactElement {
  return (
    <GestureHandlerRootView>
      <QueryClientProvider client={client}>
        <ThemeProvider>{element}</ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export function renderWithProviders(element: ReactElement, client: QueryClient = newQueryClient()) {
  return render(withProviders(element, client));
}

export type Answer = { status?: number; body: unknown };

/** Answers each request by the first key its path ends with; anything else is a 404 `not_found`. */
export function stubFetch(answers: Record<string, Answer | ((request: Request) => Answer)>) {
  const calls: Request[] = [];
  const fetchMock = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const path = new URL(request.url).pathname;
    const key = Object.keys(answers).find((candidate) => path.endsWith(candidate));
    const entry = key ? answers[key] : undefined;
    const answer =
      typeof entry === 'function' ? entry(request) : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

/** The requests to a path (exact end), e.g. `/search/users`. */
export function callsTo(calls: readonly Request[], path: string): Request[] {
  return calls.filter((request) => new URL(request.url).pathname.endsWith(path));
}

export type NetInfoListener = (state: { isConnected: boolean | null }) => void;

/**
 * Goes off or back online the way the app hears it: NetInfo for `useOnline` (the file's NetInfo mock collects its
 * listeners in `listeners`), and TanStack's online manager, which pauses queries.
 */
export async function setNetwork(online: boolean, listeners: ReadonlySet<NetInfoListener>): Promise<void> {
  await act(async () => {
    for (const listener of listeners) listener({ isConnected: online });
    onlineManager.setOnline(online);
  });
}
