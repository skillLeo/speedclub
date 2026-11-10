import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/api/client';
import { isFeedStale } from '@/api/queries/home';
import { useSeamedList, type CursorPage } from '@/api/queries/seamedList';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

type Item = { key: string };
type Page = CursorPage<Item>;

function stale(): ApiError {
  return new ApiError({ status: 409, code: 'feed_stale', message: 'stale', kind: 'conflict' });
}

describe('ADR-195: a stale Für dich cursor starts the stream over', () => {
  it('knows the 409 feed_stale answer and nothing else', () => {
    expect(isFeedStale(stale())).toBe(true);
    expect(isFeedStale(new ApiError({ status: 409, code: 'conflict', message: 'x', kind: 'conflict' }))).toBe(false);
    expect(isFeedStale(new Error('feed_stale'))).toBe(false);
  });

  it('reads the first page again and drops the tail when a continuation answers feed_stale', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const reads: (string | null)[] = [];
    let epoch = 1;
    const fetchPage = jest.fn(async (cursor: string | null): Promise<Page> => {
      reads.push(cursor);
      if (cursor === 'e1-p2' && epoch === 2) throw stale();
      return { data: [{ key: `${cursor ?? 'head'}-${epoch}` }], meta: { next_cursor: cursor === null ? `e${epoch}-p2` : null } };
    });

    const { result } = await renderHook(
      () => useSeamedList<Item, Page>({ headKey: ['t', 'head'], tailKey: ['t', 'tail'], fetchPage, idOf: (item) => item.key, isStaleCursor: isFeedStale }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));

    // The hourly re-rank lands while the member scrolls: the cursor of the first page is now stale.
    epoch = 2;
    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(reads).toEqual([null, 'e1-p2', null]));
    await waitFor(() => expect(result.current.data?.pages[0]?.meta.next_cursor).toBe('e2-p2'));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.isFetchNextPageError).toBe(false);
  });
});
