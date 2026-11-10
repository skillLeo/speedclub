/**
 * The garage screen tests: providers as in the root layout, a fetch stub that answers by method and path, and a signed-in
 * member. Each test file mocks expo-router itself, because jest.mock is hoisted per file.
 */
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { setGuest, setMember } from '@/state/session';
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

/**
 * Lets the screen catch up with the query cache. TanStack Query hands a cache change (an optimistic write, a rollback,
 * a server answer) to the screen through its notify scheduler, a real `setTimeout(0)` (query-core notifyManager
 * `defaultScheduler` = `systemSetTimeoutZero`), while the mutation's fetch runs on promise jobs. So the stub can record a
 * request, or a toast can show, before the screen has re-rendered with the value the cache already holds. This queues one
 * more notification behind every one scheduled so far (they run in order) and waits for it inside act(), so React renders
 * what they delivered before the test reads the screen.
 */
export async function flushQueryNotifications() {
  await act(() => new Promise<void>((resolve) => notifyManager.schedule(resolve)));
}

export function signIn() {
  setMember({ id: '01nina', username: 'nina.neu', displayName: 'Nina', avatarUrl: null, nextStep: null });
}

export function signOut() {
  setGuest();
}

export type Answer = { status?: number; body: unknown };
export type Call = { method: string; path: string; body: unknown; headers: Headers };

/**
 * Answers "METHOD /path" (or just "/path" for any method) by the longest key the request ends with; anything else is a 404.
 * Records every call with its parsed JSON body.
 */
export function stubFetch(answers: Record<string, Answer | ((call: Call) => Answer)>) {
  const calls: Call[] = [];
  const keys = Object.keys(answers).sort((a, b) => b.length - a.length);
  const fetchMock = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    const path = new URL(request.url).pathname;
    const text = request.method === 'GET' ? '' : await request.text();
    const call: Call = { method: request.method, path, body: text ? (JSON.parse(text) as unknown) : null, headers: request.headers };
    calls.push(call);
    const key = keys.find((candidate) => {
      const [method, route] = candidate.includes(' ') ? candidate.split(' ') : [null, candidate];
      return (!method || method === request.method) && path.endsWith(route ?? '');
    });
    const entry = key ? answers[key] : undefined;
    const answer = typeof entry === 'function' ? entry(call) : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } });
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

export const ME = {
  body: {
    data: {
      id: '01nina',
      username: 'nina.neu',
      email_verified: true,
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
    },
  },
};

export function list(data: unknown[]) {
  return { body: { data, links: {}, meta: { next_cursor: null } } };
}
