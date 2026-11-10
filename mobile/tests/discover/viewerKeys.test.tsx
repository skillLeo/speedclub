import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useModelPage, useSimilarBuilds } from '@/api/queries/discover';
import { useSearchFacets } from '@/api/queries/search';
import { EMPTY_FILTERS } from '@/features/discover/filters';
import '@/i18n';
import { useSessionStore, type SessionMember } from '@/state/session';

import { newQueryClient } from '../home/harness';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => {}) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

/** ADR-175/185: an answer belongs to the viewer who asked, so a block or `is_self` never shows to the next one. */
describe('Discover query keys follow the viewer', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  });

  it('keeps facets, the model page and similar builds apart for a guest and a member', async () => {
    const client = newQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const keysFor = async () => {
      const { result } = await renderHook(
        () => {
          useSearchFacets('turbo', EMPTY_FILTERS, true);
          useModelPage('bmw--m4');
          useSimilarBuilds('01vehicle', true);
          return null;
        },
        { wrapper },
      );
      void result;
    };
    await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
    await keysFor();
    await act(async () => useSessionStore.setState({ status: 'member', member: { id: 'member-1' } as SessionMember }));
    await keysFor();
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey));
    for (const part of ['"facets"', '"model"', '"similar"']) {
      const matching = keys.filter((key) => key.includes(part));
      expect(matching.some((key) => key.includes('guest|'))).toBe(true);
      expect(matching.some((key) => key.includes('member-1|'))).toBe(true);
    }
  });
});
