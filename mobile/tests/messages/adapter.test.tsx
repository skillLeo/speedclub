// The real MessagingAdapter on the M2.4 API (m2.4-api-handover.md): mapping, ETag polls, optimistic writes with rollback,
// idempotent sends, the inbox replacing the P1 placeholder, and the ways in (push paths, MSG-03 links).
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import {
  createActions,
  createMessagingAdapter,
  forgetEtags,
  messagingKeys,
  muteBody,
  searchCandidate,
  toDetail,
  toMessage,
  toSummary,
  withReaction,
  type ConversationData,
  type MessageData,
} from '@/api/queries/messaging';
import { pushTarget } from '@/features/auth/push';
import { chatPhotoUrl } from '@/features/messages/components/ChatPhoto';
import { muteChange } from '@/features/messages/components/Sheets';
import { isMuted, type ConversationSummary } from '@/features/messages/model';
import { newMessageHref } from '@/features/messages/entry';
import { endMessagingSession } from '@/features/messages/session';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderWithProviders } from '../home/harness';
import { serverMessage } from './fixtures';

type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactElement;
  keyExtractor?: (item: unknown) => string;
  ListEmptyComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
};

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/messages',
  useNavigation: () => ({ addListener: () => () => undefined, getParent: () => undefined }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@/features/shell/useRetainedListScroll', () => ({ useRetainedListScroll: () => ({ forget: jest.fn() }) }));
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListEmptyComponent, ListHeaderComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent ?? null, data.length === 0 ? ListEmptyComponent : items);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const MEMBER = 'member-lukas';
const CONVERSATION = '01m5wpk0c0e8jjewpe4ycappww';

function conversationData(overrides: Partial<ConversationData> = {}): ConversationData {
  return {
    id: CONVERSATION,
    folder: 'chats',
    other: { username: 'jann.ptrs', display_name: 'Jann Peters', city: 'Hamburg', avatar: null },
    other_deleted: false,
    vehicle: null,
    last_message: { id: '01J3', type: 'text', body: 'Samstag um 10?', is_mine: false, created_at: '2026-10-29T18:00:00Z' },
    unread_count: 1,
    muted: false,
    muted_until: null,
    pinned_at: null,
    archived_at: null,
    can_send: true,
    cannot_send_reason: null,
    request_pending: false,
    updated_at: '2026-10-29T18:00:00.000Z',
    ...overrides,
  };
}

function messageData(overrides: Partial<MessageData> & { id: string }): MessageData {
  return {
    client_id: null,
    type: 'text',
    body: 'Passt, ich bring die Felgen mit.',
    media: null,
    vehicle: null,
    sender: { username: 'jann.ptrs', display_name: 'Jann Peters', city: null, avatar: null },
    sender_deleted: false,
    is_mine: false,
    reactions: [],
    created_at: '2026-10-29T18:00:00Z',
    ...overrides,
  };
}

type Route = (request: Request) => Response | undefined;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function stub(route: Route) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    return route(request) ?? json({ message: 'Nicht gefunden', code: 'not_found', errors: {} }, 404);
  }) as unknown as typeof fetch;
  return calls;
}

const path = (request: Request) => new URL(request.url).pathname.replace('/api/v1', '');

beforeAll(hydrateThemePreference);
beforeEach(() => {
  forgetEtags();
  setMember({ id: MEMBER, username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
});
afterEach(() => {
  endMessagingSession();
  useSessionStore.setState({ status: 'loading', member: null });
  jest.clearAllMocks();
});

describe('mapping', () => {
  it('maps a conversation, its preview and the Addendum fields', () => {
    const summary = toSummary(conversationData({ request_pending: true, can_send: false, cannot_send_reason: 'recipient_closed' }));
    expect(summary).toMatchObject({
      id: CONVERSATION,
      other: { username: 'jann.ptrs', displayName: 'Jann Peters' },
      lastMessage: { kind: 'text', body: 'Samstag um 10?', mine: false },
      requestPending: true,
      canSend: false,
      cannotSendReason: 'recipient_closed',
    });
    const detail = toDetail({
      ...conversationData(),
      context_vehicle: { id: 'v1', slug: 'nissan-skyline-gt-r-r34-5tf974vj', full_title: 'Nissan Skyline GT-R R34', cover: null, owner_username: 'lukas.sc' },
      other_typing: true,
      other_read_message_id: '01J3',
    });
    expect(detail.contextVehicle).toEqual({ id: 'v1', slug: 'nissan-skyline-gt-r-r34-5tf974vj', title: 'Nissan Skyline GT-R R34', cover: null, ownerUsername: 'lukas.sc' });
    expect(detail).toMatchObject({ otherTyping: true, otherReadMessageId: '01J3' });
  });

  it('keys your own message by client_id, so the server copy takes the optimistic bubble\'s place', () => {
    expect(toMessage(messageData({ id: '01J4', client_id: 'c-abc', is_mine: true, sender: null }))).toMatchObject({ key: 'c-abc', id: '01J4', mine: true, senderUsername: null, delivery: 'sent' });
    expect(toMessage(messageData({ id: '01J5' }))).toMatchObject({ key: '01J5', senderUsername: 'jann.ptrs' });
    expect(toMessage(messageData({ id: '01J6', sender: null, sender_deleted: true }))).toMatchObject({ senderDeleted: true });
  });

  it('takes a chat photo with its signed variants, and picks the one that fills the bubble (ADR-208)', async () => {
    const media = {
      id: 'm1',
      status: 'ready' as const,
      category: 'other' as const,
      width: 1600,
      height: 1200,
      blurhash: 'LEHV6nWB2yk8',
      variants: [
        { width: 320, height: 240, url: 'https://x/320?s=1' },
        { width: 640, height: 480, url: 'https://x/640?s=1' },
        { width: 1600, height: 1200, url: 'https://x/1600?s=1' },
      ],
      created_at: null,
    };
    const message = toMessage(messageData({ id: '01J7', type: 'photo', body: null, media }));
    expect(message.media?.variants).toHaveLength(3);
    expect(chatPhotoUrl(message.media, 288, 2)).toBe('https://x/640?s=1');
    expect(chatPhotoUrl(message.media, 1200, 2)).toBe('https://x/1600?s=1');
  });

  it('says why a member cannot be written to in MSG-03', () => {
    const row = { username: 'lena.911', display_name: 'Lena', city: null, avatar: null, garage: { vehicles: 1, makes: ['Porsche'], line: '1 Fahrzeug · Porsche' }, is_self: false, is_following: false };
    expect(searchCandidate({ ...row, can_message: false, cannot_message_reason: 'recipient_closed' }, null)).toMatchObject({
      canMessage: false,
      reason: 'Nimmt gerade keine Nachrichten von dir an',
      line: '1 Fahrzeug · Porsche',
    });
    expect(searchCandidate({ ...row, can_message: true, cannot_message_reason: null }, 'c1')).toMatchObject({ canMessage: true, reason: null, conversationId: 'c1' });
  });

  it('keeps one reaction per member and message', () => {
    const message = serverMessage({ id: '01', reactions: [{ key: 'fire', count: 2, mine: true }, { key: 'heart', count: 1, mine: false }] });
    expect(withReaction(message, 'heart').reactions).toEqual([
      { key: 'fire', count: 1, mine: false },
      { key: 'heart', count: 2, mine: true },
    ]);
    expect(withReaction(message, null).reactions).toEqual([
      { key: 'fire', count: 1, mine: false },
      { key: 'heart', count: 1, mine: false },
    ]);
  });
});

describe('thread polling', () => {
  it('asks after the newest message with If-None-Match, and an idle 304 changes nothing', async () => {
    let afterCalls = 0;
    const calls = stub((request) => {
      const url = new URL(request.url);
      if (path(request) === `/conversations/${CONVERSATION}/messages` && !url.searchParams.has('after')) {
        return json({ data: [messageData({ id: '01J3' })], meta: { has_more: false } });
      }
      if (path(request) === `/conversations/${CONVERSATION}/messages`) {
        afterCalls += 1;
        if (afterCalls === 1) return json({ data: [messageData({ id: '01J4', client_id: 'c-1', is_mine: true })], meta: { has_more: false } }, 200, { ETag: '"a1"' });
        if (request.headers.get('If-None-Match') === '"a2"') return new Response(null, { status: 304 });
        return json({ data: [], meta: { has_more: false } }, 200, { ETag: '"a2"' });
      }
      if (path(request) === `/conversations/${CONVERSATION}`) {
        if (request.headers.get('If-None-Match') === '"d1"') return new Response(null, { status: 304 });
        return json({ data: { ...conversationData(), context_vehicle: null, other_typing: false, other_read_message_id: null } }, 200, { ETag: '"d1"' });
      }
      return undefined;
    });
    const client = newQueryClient();
    const adapter = createMessagingAdapter(client);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = await renderHook(() => adapter.useThread(CONVERSATION), { wrapper });
    await waitFor(() => expect(result.current.data?.map((message) => message.id)).toEqual(['01J3']));

    let ids: readonly string[] = [];
    await act(async () => {
      ids = await result.current.pollNewer(new AbortController().signal);
    });
    expect(ids).toEqual(['c-1']);
    await waitFor(() => expect(result.current.data?.map((message) => message.id)).toEqual(['01J4', '01J3']));
    const firstAfter = calls.filter((request) => new URL(request.url).searchParams.get('after') === '01J3');
    expect(firstAfter[0]?.headers.get('If-None-Match')).toBeNull();

    await act(async () => {
      await result.current.pollNewer(new AbortController().signal);
    });
    await act(async () => {
      ids = await result.current.pollNewer(new AbortController().signal);
    });
    expect(ids).toEqual([]);
    const lastAfter = calls.filter((request) => new URL(request.url).searchParams.get('after') === '01J4').at(-1);
    expect(lastAfter?.headers.get('If-None-Match')).toBe('"a2"');
    const lastDetail = calls.filter((request) => path(request) === `/conversations/${CONVERSATION}`).at(-1);
    expect(lastDetail?.headers.get('If-None-Match')).toBe('"d1"');
    expect(result.current.data?.map((message) => message.id)).toEqual(['01J4', '01J3']);
  });
});

describe('the poll cursor (review 2)', () => {
  // The reviewer's proof: the other member's 01j5 committed just before my 01j6, whose send answer reached the cache first.
  it('never skips a message the other side sent just before my send answered', async () => {
    const afters: string[] = [];
    stub((request) => {
      const url = new URL(request.url);
      if (path(request) === `/conversations/${CONVERSATION}/messages` && !url.searchParams.has('after')) {
        return json({ data: [messageData({ id: '01j3' })], meta: { has_more: false } });
      }
      if (path(request) === `/conversations/${CONVERSATION}/messages`) {
        const after = url.searchParams.get('after') ?? '';
        afters.push(after);
        const all = [messageData({ id: '01j5', body: 'Jann schrieb gleichzeitig' }), messageData({ id: '01j6', client_id: 'c-6', is_mine: true, sender: null })];
        return json({ data: all.filter((message) => message.id > after), meta: { has_more: false } });
      }
      if (path(request) === `/conversations/${CONVERSATION}`) {
        return json({ data: { ...conversationData(), context_vehicle: null, other_typing: false, other_read_message_id: null } });
      }
      return undefined;
    });
    const client = newQueryClient();
    const adapter = createMessagingAdapter(client);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = await renderHook(() => adapter.useThread(CONVERSATION), { wrapper });
    await waitFor(() => expect(result.current.data?.map((message) => message.id)).toEqual(['01j3']));
    expect(result.current.readUpTo).toBe('01j3');

    // The outbox's send answer arrives before the next poll.
    await act(async () => {
      adapter.insertDelivered(MEMBER, CONVERSATION, toMessage(messageData({ id: '01j6', client_id: 'c-6', is_mine: true, sender: null })));
    });
    // It does not move what may be marked read.
    await waitFor(() => expect(result.current.data?.map((message) => message.id)).toEqual(['01j6', '01j3']));
    expect(result.current.readUpTo).toBe('01j3');

    await act(async () => {
      await result.current.pollNewer(new AbortController().signal);
    });
    expect(afters).toEqual(['01j3']);
    await waitFor(() => expect(result.current.data?.map((message) => message.id)).toEqual(['01j6', '01j5', '01j3']));
    expect(result.current.readUpTo).toBe('01j6');
  });

  it('reads the newest page again every fifth poll, so a hidden message and new reactions show (review 7)', async () => {
    let newest = [messageData({ id: '01j2' }), messageData({ id: '01j1' })];
    stub((request) => {
      const url = new URL(request.url);
      if (path(request) === `/conversations/${CONVERSATION}/messages` && !url.searchParams.has('after')) {
        return json({ data: newest, meta: { has_more: false } });
      }
      if (path(request) === `/conversations/${CONVERSATION}/messages`) return json({ data: [], meta: { has_more: false } });
      if (path(request) === `/conversations/${CONVERSATION}`) {
        return json({ data: { ...conversationData(), context_vehicle: null, other_typing: false, other_read_message_id: null } });
      }
      return undefined;
    });
    const client = newQueryClient();
    const adapter = createMessagingAdapter(client);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = await renderHook(() => adapter.useThread(CONVERSATION), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    newest = [messageData({ id: '01j2', reactions: [{ key: 'fire', count: 1, mine: false }] })];
    for (let poll = 1; poll <= 4; poll += 1) {
      await act(async () => {
        await result.current.pollNewer(new AbortController().signal);
      });
    }
    expect(result.current.data).toHaveLength(2);
    await act(async () => {
      await result.current.pollNewer(new AbortController().signal);
    });
    await waitFor(() => expect(result.current.data?.map((message) => message.id)).toEqual(['01j2']));
    expect(result.current.data?.[0]?.reactions).toEqual([{ key: 'fire', count: 1, mine: false }]);
  });
});

describe('writes', () => {
  it('declines a pending request on "Löschen", never DELETEs it (review 1)', async () => {
    const calls = stub((request) => (path(request) === `/conversations/${CONVERSATION}/decline` ? new Response(null, { status: 204 }) : undefined));
    const client = newQueryClient();
    client.setQueryData(messagingKeys.inbox(MEMBER, 'requests', ''), { pages: [{ rows: [toSummary(conversationData({ folder: 'requests' }))], next: null }], pageParams: [null] });
    await createActions(client, MEMBER).deleteConversation(CONVERSATION);
    expect(calls.map((request) => `${request.method} ${path(request)}`)).toEqual([`POST /conversations/${CONVERSATION}/decline`]);
  });

  it('puts back only the reaction that failed (review 20)', async () => {
    stub((request) => (path(request).endsWith('/reactions') ? json({ message: 'Nein', code: 'forbidden', errors: {} }, 403) : undefined));
    const client = newQueryClient();
    const key = messagingKeys.thread(MEMBER, CONVERSATION);
    client.setQueryData(key, { pages: [{ messages: [serverMessage({ id: '01a' }), serverMessage({ id: '01b' })], hasMore: false, cursor: '01b' }], pageParams: [null] });
    const reacting = createActions(client, MEMBER).react(CONVERSATION, '01a', 'fire');
    // Something else changes the thread meanwhile.
    client.setQueryData<{ pages: { messages: ReturnType<typeof serverMessage>[] }[] }>(key, (data) =>
      data ? { ...data, pages: data.pages.map((page) => ({ ...page, messages: page.messages.map((message) => (message.id === '01b' ? { ...message, body: 'neu' } : message)) })) } : data,
    );
    await expect(reacting).rejects.toMatchObject({ kind: 'forbidden' });
    const messages = client.getQueryData<{ pages: { messages: ReturnType<typeof serverMessage>[] }[] }>(key)?.pages[0]?.messages ?? [];
    expect(messages.find((message) => message.id === '01a')?.reactions).toEqual([]);
    expect(messages.find((message) => message.id === '01b')?.body).toBe('neu');
  });

  it('sends a message with client_id and the Idempotency-Key, and maps the replayed answer', async () => {
    const calls = stub((request) =>
      path(request) === `/conversations/${CONVERSATION}/messages` && request.method === 'POST'
        ? json({ data: messageData({ id: '01J9', client_id: 'c-7', is_mine: true, sender: null, body: 'Bin unterwegs' }) }, 200, { 'Idempotency-Replayed': 'true' })
        : undefined,
    );
    const adapter = createMessagingAdapter(newQueryClient());
    const message = await adapter.transport.send({
      conversationId: CONVERSATION,
      clientId: 'c-7',
      idempotencyKey: 'key-7',
      draft: { kind: 'text', body: 'Bin unterwegs' },
      mediaId: null,
      signal: new AbortController().signal,
    });
    expect(message).toMatchObject({ key: 'c-7', id: '01J9' });
    expect(calls[0]?.headers.get('Idempotency-Key')).toBe('key-7');
    expect(await calls[0]?.json()).toEqual({ type: 'text', body: 'Bin unterwegs', client_id: 'c-7' });
  });

  it('starts a conversation once per intent and puts the first message in the thread', async () => {
    const calls = stub((request) =>
      path(request) === '/conversations' && request.method === 'POST'
        ? json(
            {
              data: {
                conversation: { ...conversationData({ id: 'c-new' }), context_vehicle: null, other_typing: false, other_read_message_id: null },
                message: messageData({ id: '01JA', client_id: 'c-start', is_mine: true, sender: null }),
              },
            },
            201,
          )
        : undefined,
    );
    const client = newQueryClient();
    const result = await createActions(client, MEMBER).start({
      recipient: 'kenji.r34',
      vehicleId: 'v1',
      message: { kind: 'text', body: 'Servus Kenji' },
      clientId: 'c-start',
      idempotencyKey: 'key-start',
    });
    expect(result).toEqual({ conversationId: 'c-new' });
    expect(calls[0]?.headers.get('Idempotency-Key')).toBe('key-start');
    expect(await calls[0]?.json()).toEqual({ recipient: 'kenji.r34', vehicle_id: 'v1', message: { type: 'text', body: 'Servus Kenji' }, client_id: 'c-start' });
    expect(client.getQueryData(messagingKeys.conversation(MEMBER, 'c-new'))).toMatchObject({ id: 'c-new' });
  });

  it('archives at once and puts the row back when the server refuses', async () => {
    stub((request) => (request.method === 'PATCH' ? json({ message: 'Nein', code: 'validation_failed', errors: {} }, 422) : undefined));
    const client = newQueryClient();
    const key = messagingKeys.inbox(MEMBER, 'chats', '');
    client.setQueryData(key, { pages: [{ rows: [toSummary(conversationData())], next: null }], pageParams: [null] });
    const actions = createActions(client, MEMBER);
    const archiving = actions.organise(CONVERSATION, { archived: true });
    expect(client.getQueryData<{ pages: { rows: unknown[] }[] }>(key)?.pages[0]?.rows).toHaveLength(0);
    await expect(archiving).rejects.toMatchObject({ kind: 'validation' });
    expect(client.getQueryData<{ pages: { rows: unknown[] }[] }>(key)?.pages[0]?.rows).toHaveLength(1);
  });

  it('mutes with no end as {muted: true}, never a date past the server’s year (M2.8)', async () => {
    const detail = { ...conversationData(), muted: true, context_vehicle: null, other_typing: false, other_read_message_id: null };
    const calls = stub((request) => (request.method === 'PATCH' ? json({ data: detail }) : undefined));
    const client = newQueryClient();
    const key = messagingKeys.inbox(MEMBER, 'chats', '');
    client.setQueryData(key, { pages: [{ rows: [toSummary(conversationData())], next: null }], pageParams: [null] });
    const actions = createActions(client, MEMBER);
    const muting = actions.organise(CONVERSATION, { mute: muteChange('always', new Date('2026-11-08T10:00:00Z')) });
    const row = client.getQueryData<{ pages: { rows: ConversationSummary[] }[] }>(key)?.pages[0]?.rows[0];
    expect(row && isMuted(row, new Date('2126-01-01T00:00:00Z'))).toBe(true);
    await muting;
    expect(await calls[0]?.json()).toEqual({ muted: true });
    const stored = client.getQueryData<ConversationSummary>(messagingKeys.conversation(MEMBER, CONVERSATION));
    expect(stored).toMatchObject({ mutedUntil: null, muted: true });
  });

  it('sends a week as a moment and unmutes with muted: false', () => {
    const from = new Date('2026-11-08T10:00:00Z');
    expect(muteBody(muteChange('week', from))).toEqual({ muted_until: '2026-11-15T10:00:00.000Z' });
    expect(muteBody(muteChange('hours', from))).toEqual({ muted_until: '2026-11-08T18:00:00.000Z' });
    expect(muteBody('off')).toEqual({ muted: false });
    // The state follows the server's `muted`, not muted_until: with no end, muted_until is null.
    expect(toSummary(conversationData({ muted: true, muted_until: null })).muted).toBe(true);
    expect(isMuted(toSummary(conversationData({ muted: true, muted_until: null })), new Date('2126-01-01T00:00:00Z'))).toBe(true);
    expect(toSummary(conversationData({ muted: false, muted_until: null })).muted).toBe(false);
  });

  it('authorises a realtime channel with the unwrapped {auth}', async () => {
    const calls = stub((request) => (path(request) === '/broadcasting/auth' ? json({ auth: 'key:sig' }) : undefined));
    const adapter = createMessagingAdapter(newQueryClient());
    expect(await adapter.authorizeChannel('private-conversation.c1', '123.456', new AbortController().signal)).toEqual({ auth: 'key:sig' });
    expect(await calls[0]?.json()).toEqual({ channel_name: 'private-conversation.c1', socket_id: '123.456' });
  });
});

describe('MSG-01 on the API', () => {
  it('replaces the P1 placeholder with the real inbox', async () => {
    stub((request) =>
      path(request) === '/conversations'
        ? json({ data: [conversationData()], links: { first: null, last: null, prev: null, next: null }, meta: { path: null, per_page: 30, next_cursor: null, prev_cursor: null } })
        : path(request) === '/notifications/unread-count'
          ? json({ data: { notifications: 0, messages: 1, requests: 1 } })
          : undefined,
    );
    await renderWithProviders(<MessagesScreen />);
    expect(await screen.findByTestId(`MSG-01.row.${CONVERSATION}`)).toBeTruthy();
    expect(screen.queryByTestId('MSG-01.soon')).toBeNull();
    await waitFor(() => expect(screen.getByText('Anfragen (1)')).toBeTruthy());
  });
});

describe('ways in', () => {
  it('opens message pushes on their thread or request', () => {
    expect(pushTarget({ type: 'new_message', notification_id: null, path: `/messages/${CONVERSATION}` })).toBe(`/messages/${CONVERSATION}`);
    expect(pushTarget({ type: 'message_request', notification_id: null, path: '/messages/requests/01m63k07g0m4m0p4wwggarp6tm' })).toBe(
      '/messages/requests/01m63k07g0m4m0p4wwggarp6tm',
    );
    expect(pushTarget({ type: 'new_message', path: 'https://evil.example/messages/1' })).toBe('/notifications');
  });

  it('links MSG-03 with only the parameters given', () => {
    expect(newMessageHref({ to: 'lukas.sc', about: 'nissan-skyline-gt-r-r34-5tf974vj' })).toEqual({
      pathname: '/new-message',
      params: { to: 'lukas.sc', about: 'nissan-skyline-gt-r-r34-5tf974vj' },
    });
    expect(newMessageHref({ vehicle: 'r34', to: undefined })).toEqual({ pathname: '/new-message', params: { vehicle: 'r34' } });
  });
});
