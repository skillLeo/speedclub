/**
 * Shared by the screen tests of profile and settings: providers as in the root layout, and a fetch stub that answers by
 * path. Each test file still mocks expo-router itself, because jest.mock is hoisted per file.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { ThemeProvider } from '@/theme';

/**
 * No garbage collection: a mutation is otherwise collected after its default 5 minutes, and that timer keeps Jest from
 * exiting once the file has run.
 */
export function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
}

export function renderScreen(element: ReactElement, client: QueryClient = newQueryClient()) {
  return render(
    <GestureHandlerRootView>
      <QueryClientProvider client={client}>
        <ThemeProvider>{element}</ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>,
  );
}

export type Answer = { status?: number; body: unknown };

/** Answers each request by the first entry whose key the path ends with; anything else is a 404. */
export function stubFetch(answers: Record<string, Answer | (() => Answer)>) {
  const calls: Request[] = [];
  const fetchMock = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const path = new URL(request.url).pathname;
    const key = Object.keys(answers).find((candidate) => path.endsWith(candidate));
    const entry = key ? answers[key] : undefined;
    const answer = typeof entry === 'function' ? entry() : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found' } });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}
