/**
 * The QR screen tests: providers as in the root layout, a fetch stub that answers by path, and a signed-in session. Each test
 * file mocks expo-router itself, because jest.mock is hoisted per file.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
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

export function signIn() {
  setMember({ id: '01lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null, nextStep: null });
}

export function signOut() {
  setGuest();
}

export type Answer = { status?: number; body: unknown; contentType?: string; headers?: Record<string, string> };

/** Answers each request by the first key its path ends with (longest first); anything else is a 404. */
export function stubFetch(answers: Record<string, Answer | (() => Answer)>) {
  const calls: Request[] = [];
  const keys = Object.keys(answers).sort((a, b) => b.length - a.length);
  const fetchMock = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const path = new URL(request.url).pathname;
    const key = keys.find((candidate) => path.endsWith(candidate));
    const entry = key ? answers[key] : undefined;
    const answer =
      typeof entry === 'function' ? entry() : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } });
    const contentType = answer.contentType ?? 'application/json';
    const text = contentType === 'application/json' ? JSON.stringify(answer.body) : String(answer.body);
    return new Response(text, { status: answer.status ?? 200, headers: { 'Content-Type': contentType, ...answer.headers } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

/** One row of GET me/qr-codes, as the server sends it for the flagship R34. */
export function qrRow(overrides: Record<string, unknown> = {}, vehicle: Record<string, unknown> = {}) {
  return {
    vehicle: {
      id: '01m6f7zv1vs5e2xw9a96cbqzyp',
      slug: 'nissan-skyline-gt-r-r34-5tf974vj',
      title: 'Skyline GT-R R34',
      full_title: 'Nissan Skyline GT-R R34',
      visibility: 'public',
      cover: null,
      public_url: 'https://speedclub.de/v/nissan-skyline-gt-r-r34-5tf974vj',
      ...vehicle,
    },
    status: 'active',
    scan_state: 'active',
    code: '8TR0Q3MC',
    display_code: '8TR0 Q3MC',
    url: 'https://speedclub.de/C/8TR0Q3MC',
    created_at: '2026-03-14T18:30:00+00:00',
    revoked_at: null,
    revoked_reason: null,
    downloads: {
      svg: 'https://speedclub.de/api/v1/vehicles/01m6f7zv1vs5e2xw9a96cbqzyp/qr.svg',
      png_1024: 'https://speedclub.de/api/v1/vehicles/01m6f7zv1vs5e2xw9a96cbqzyp/qr.png?size=1024',
      png_2048: 'https://speedclub.de/api/v1/vehicles/01m6f7zv1vs5e2xw9a96cbqzyp/qr.png?size=2048',
      pdf: 'https://speedclub.de/api/v1/vehicles/01m6f7zv1vs5e2xw9a96cbqzyp/qr.pdf',
    },
    ...overrides,
  };
}

export const QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path fill="#000" d="M4 4h7v7h-7z"/></svg>';
