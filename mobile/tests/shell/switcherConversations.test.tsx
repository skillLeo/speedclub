import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { messagingKeys } from '@/api/queries/messaging';
import { blocksKey } from '@/api/queries/social';
import {
  blockedNames,
  forgetConversationsWith,
  recentConversations,
  useCachedRecentConversations,
} from '@/features/messages/cachedInbox';
import { conversationItems, filterSwitcher } from '@/features/shell/shortcuts/switcher';
import { useSessionStore } from '@/state/session';

import { R34, summary } from '../messages/fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const MEMBER = '01JMEMBER0000000000000000A';

const inbox = (rows: ReturnType<typeof summary>[]) => ({ pages: [{ rows, next: null }], pageParams: [null] });
const blocks = (names: string[]) => ({
  pages: [
    {
      data: names.map((username) => ({ username, blocked_at: '2026-11-01T10:00:00Z' })),
      links: { first: null, last: null, prev: null, next: null },
      meta: { path: null, per_page: 30, next_cursor: null, prev_cursor: null },
    },
  ],
  pageParams: [null],
});

const jann = summary({ id: 'c1', updatedAt: '2026-11-08T09:58:00Z', vehicle: R34 });
const max = summary({ id: 'c2', other: { username: 'max.e46', displayName: null, avatar: null }, updatedAt: '2026-11-08T11:00:00Z' });
const archived = summary({ id: 'c3', folder: 'archived', archivedAt: '2026-10-11T10:00:00Z', other: { username: 'finn.jdm', displayName: 'Finn', avatar: null } });
const request = summary({ id: 'c4', folder: 'requests', other: { username: 'nico.sti', displayName: 'Nico', avatar: null } });
const gone = summary({ id: 'c5', other: null, otherDeleted: true });
const blocked = summary({ id: 'c6', other: { username: 'Paul.Roadster', displayName: 'Paul', avatar: null } });

describe('quick switcher: recent conversations (sig.web_shortcuts, M2.8)', () => {
  afterEach(async () => {
    await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
  });

  it('lists open chats newest first, without requests, archived chats, deleted members or blocked members', () => {
    const rows = recentConversations(inbox([jann, max, archived, request, gone, blocked, jann]), blockedNames(blocks(['paul.roadster'])));
    expect(rows.map((row) => row.id)).toEqual(['c2', 'c1']);
  });

  it('also drops a chat the optimistic archive has moved out of Chats', () => {
    const moved = { ...jann, folder: 'archived' as const, archivedAt: '2026-11-08T12:00:00Z' };
    expect(recentConversations(inbox([moved]), new Set())).toEqual([]);
  });

  it('names an entry by display name, else by handle, with the handle and the car as its detail, and opens MSG-02', () => {
    const items = conversationItems(recentConversations(inbox([jann, max]), new Set()), 'Gelöschtes Mitglied');
    expect(items).toEqual([
      { id: 'conversation.c2', group: 'conversations', label: '@max.e46', href: '/messages/c2' },
      { id: 'conversation.c1', group: 'conversations', label: 'Jann Peters', detail: '@jann.ptrs · Nissan Skyline GT-R R34', href: '/messages/c1' },
    ]);
    // Typing the car finds the chat about it.
    expect(filterSwitcher(items, 'skyline').map((item) => item.id)).toEqual(['conversation.c1']);
  });

  it('reads the cached Chats list and sends no request of its own', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    useSessionStore.setState({ status: 'member', memberChanged: false, member: { id: MEMBER } as never });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    function Probe() {
      const rows = useCachedRecentConversations();
      return <Text testID="probe">{rows.map((row) => row.id).join(',')}</Text>;
    }
    await render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('');
    await act(async () => {
      client.setQueryData(messagingKeys.inbox(MEMBER, 'chats', ''), inbox([jann, max]));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('c2,c1');
    // A block known to the cached block list hides the chat at once.
    await act(async () => {
      client.setQueryData(blocksKey, blocks(['max.e46']));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('c1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the blocked member’s chats and requests from every cached inbox after a block', () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(messagingKeys.inbox(MEMBER, 'chats', ''), inbox([jann, max]));
    client.setQueryData(messagingKeys.inbox(MEMBER, 'requests', ''), inbox([{ ...request, other: { username: 'jann.ptrs', displayName: null, avatar: null } }]));
    client.setQueryData(messagingKeys.thread(MEMBER, 'c1'), { pages: [], pageParams: [] });
    forgetConversationsWith(client, MEMBER, 'Jann.Ptrs');
    const ids = (folder: 'chats' | 'requests') =>
      client.getQueryData<ReturnType<typeof inbox>>(messagingKeys.inbox(MEMBER, folder, ''))?.pages.flatMap((page) => page.rows.map((row) => row.id));
    expect(ids('chats')).toEqual(['c2']);
    expect(ids('requests')).toEqual([]);
    expect(client.getQueryData(messagingKeys.thread(MEMBER, 'c1'))).toBeUndefined();
  });
});
