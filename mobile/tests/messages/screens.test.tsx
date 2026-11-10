// MSG-01, MSG-02 (FS-7) and MSG-04 against a fake adapter: the placeholder until the API exists, the inbox, the thread with day
// separators and "Gelesen", optimistic sends with "Erneut senden", and a request that is never marked read.
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import { MessagingContext, unavailableMessaging, type Loadable, type MessagingActions, type MessagingAdapter, type PagedList, type ThreadData } from '@/features/messages/data';
import type { ConversationDetail, ConversationSummary, ThreadMessage } from '@/features/messages/model';
import { endMessagingSession } from '@/features/messages/session';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';
import { ThreadPane } from '@/features/messages/screens/ThreadPane';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference, size, space, typography } from '@/theme';

import { renderWithProviders } from '../home/harness';
import { conversation, serverMessage, summary } from './fixtures';

type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactElement;
  keyExtractor?: (item: unknown) => string;
  ListEmptyComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
};

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true, dismissTo: jest.fn() };
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
    const { data, renderItem, keyExtractor, ListEmptyComponent, ListHeaderComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent ?? null, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent ?? null);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${String((n += 1)).padStart(3, '0')}` };
});
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('@/api/queries/appConfig', () => ({ ...jest.requireActual<object>('@/api/queries/appConfig'), useFlag: () => true }));
jest.mock('@/ui/toast', () => ({ ...jest.requireActual<object>('@/ui/toast'), toast: jest.fn() }));
const mockQa: { state: 'default' | 'loading' | 'empty' | 'error' | 'offline' | 'restricted' } = { state: 'default' };
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));
const mockClock = { now: new Date('2026-11-08T11:00:00+01:00') };
jest.mock('@/lib/clock', () => ({ now: () => mockClock.now }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
});
afterEach(() => {
  mockQa.state = 'default';
  endMessagingSession();
  useSessionStore.setState({ status: 'loading', member: null });
  jest.clearAllMocks();
});

function loaded<T>(data: T): Loadable<T> {
  return { data, isPending: false, isPaused: false, error: null, isFetching: false, refetch: jest.fn() };
}

function list<T>(data: readonly T[]): PagedList<T> {
  return { ...loaded<readonly T[]>(data), hasMore: false, isLoadingMore: false, loadMore: jest.fn() };
}

function fakeActions(): MessagingActions {
  return {
    markRead: jest.fn(() => Promise.resolve()),
    accept: jest.fn(() => Promise.resolve()),
    decline: jest.fn(() => Promise.resolve()),
    organise: jest.fn(() => Promise.resolve()),
    deleteConversation: jest.fn(() => Promise.resolve()),
    hideMessage: jest.fn(() => Promise.resolve()),
    react: jest.fn(() => Promise.resolve()),
    typing: jest.fn(() => Promise.resolve()),
    start: jest.fn(() => Promise.resolve({ conversationId: 'c-new' })),
    refreshInbox: jest.fn(() => Promise.resolve()),
  };
}

function adapterWith(options: {
  detail?: ConversationDetail;
  messages?: ThreadMessage[];
  inbox?: ConversationSummary[];
  send?: MessagingAdapter['transport']['send'];
  actions?: MessagingActions;
}): { adapter: MessagingAdapter; actions: MessagingActions } {
  const actions = options.actions ?? fakeActions();
  const thread: ThreadData = {
    ...list(options.messages ?? []),
    pollNewer: jest.fn(() => Promise.resolve([])),
    refresh: jest.fn(() => Promise.resolve()),
    readUpTo: options.messages?.find((message) => message.id)?.id ?? null,
  };
  const adapter: MessagingAdapter = {
    ...unavailableMessaging,
    available: true,
    useInbox: (folder) => list((options.inbox ?? []).filter((row) => row.folder === folder)),
    useCounts: () => ({ messages: 2, requests: (options.inbox ?? []).filter((row) => row.folder === 'requests').length }),
    useConversation: () => loaded(options.detail ?? conversation()),
    useThread: () => thread,
    useActions: () => actions,
    transport: { uploadPhoto: () => Promise.resolve('m'), send: options.send ?? (() => new Promise(() => undefined)) },
    classify: (error) => ({ reason: 'network', message: error instanceof Error ? error.message : '' }),
  };
  return { adapter, actions };
}

function renderWith(adapter: MessagingAdapter, element: ReactElement) {
  return renderWithProviders(<MessagingContext value={adapter}>{element}</MessagingContext>);
}

const flush = () => act(async () => new Promise<void>((resolve) => setImmediate(resolve)));

describe('MSG-01', () => {
  it('keeps the P1 placeholder until the messaging API is wired', async () => {
    await renderWith(unavailableMessaging, <MessagesScreen />);
    expect(await screen.findByTestId('MSG-01.soon')).toBeTruthy();
  });

  it('lists conversations with the request count on its tab and the unread count on the row', async () => {
    const { adapter } = adapterWith({
      inbox: [summary({ id: 'c1' }), summary({ id: 'c2', folder: 'requests', other: { username: 'max.e46', displayName: null, avatar: null } })],
    });
    await renderWith(adapter, <MessagesScreen />);
    expect(await screen.findByTestId('MSG-01.row.c1')).toBeTruthy();
    expect(screen.queryByTestId('MSG-01.row.c2')).toBeNull();
    expect(screen.getByText('Anfragen (1)')).toBeTruthy();
    // The row reads as one label on native; the parts inside are hidden from the accessibility tree there.
    expect(screen.getByTestId('MSG-01.row.c1.preview', { includeHiddenElements: true })).toHaveTextContent('Bis Samstag am Treffpunkt');
    expect(screen.getByTestId('MSG-01.row.c1.unread', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('MSG-01.row.c1.open'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/messages/[conversationId]', params: { conversationId: 'c1' } });
  });

  it('shows the designed empty state for no conversations', async () => {
    const { adapter } = adapterWith({ inbox: [] });
    await renderWith(adapter, <MessagesScreen />);
    expect(await screen.findByTestId('MSG-01.emptyChats')).toBeTruthy();
  });

  it('keeps "Archiviert" under the empty state when every chat is archived (M2.8)', async () => {
    const { adapter } = adapterWith({ inbox: [summary({ id: 'c1', folder: 'archived', archivedAt: '2026-11-07T10:00:00Z' })] });
    await renderWith(adapter, <MessagesScreen />);
    expect(await screen.findByTestId('MSG-01.emptyChats')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('MSG-01.archived'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/messages', params: { folder: 'archived' } });
  });
});

describe('MSG-02 (FS-7)', () => {
  const messages = [
    serverMessage({ id: '01J3', mine: true, senderUsername: null, body: 'Passt, ich bring die Felgen mit.', createdAt: '2026-11-08T09:20:00Z' }),
    serverMessage({ id: '01J2', body: 'Samstag um 10 am Treffpunkt?', createdAt: '2026-11-08T09:16:00Z' }),
    serverMessage({ id: '01J1', body: 'Hast du die BBS noch?', createdAt: '2026-11-07T18:00:00Z' }),
  ];

  it('draws day separators, the bubbles and "Gelesen" under the last own message', async () => {
    const { adapter } = adapterWith({ detail: conversation({ otherReadMessageId: '01J3' }), messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(await screen.findByText('Heute')).toBeTruthy();
    expect(screen.getByText('Gestern')).toBeTruthy();
    expect(screen.getByTestId('MSG-02.message.01J3.read')).toHaveTextContent('Gelesen');
    expect(screen.getByTestId('MSG-02.header.name')).toHaveTextContent('Jann Peters');
  });

  it('marks the newest message read while the thread is on screen', async () => {
    const { adapter, actions } = adapterWith({ messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    await flush();
    expect(jest.mocked(actions.markRead)).toHaveBeenCalledWith('01JCONV000000000000000000A', '01J3');
  });

  it('shows a sent message at once, and "Erneut senden" when it did not go out', async () => {
    let fail: (error: Error) => void = () => undefined;
    const send = jest.fn(() => new Promise<ThreadMessage>((_resolve, reject) => (fail = reject)));
    const { adapter } = adapterWith({ messages, send });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    await fireEvent.changeText(await screen.findByTestId('MSG-02.composer.input'), 'Bin in 10 Minuten da');
    await fireEvent.press(screen.getByTestId('MSG-02.composer.send'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('MSG-02.message.uuid-001')).toBeTruthy();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'uuid-001', idempotencyKey: 'uuid-002', draft: { kind: 'text', body: 'Bin in 10 Minuten da' } }));

    await act(async () => fail(new Error('Keine Verbindung')));
    expect(await screen.findByTestId('MSG-02.message.uuid-001.failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('MSG-02.message.uuid-001.retry'));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'uuid-001', idempotencyKey: 'uuid-002' }));
  });

  it('reads the newest page once when a signed photo URL has expired (ADR-208)', async () => {
    const photo = serverMessage({
      id: '01J5',
      kind: 'photo',
      body: null,
      media: { id: 'm1', status: 'ready', category: 'other', width: 1600, height: 1200, blurhash: null, variants: [{ width: 640, height: 480, url: 'https://speedclub.test/api/v1/chat-media/m1/640?viewer=x&signature=old' }], created_at: null },
    });
    const { adapter } = adapterWith({ messages: [photo, ...messages] });
    const thread = adapter.useThread('c1');
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    const image = await screen.findByTestId('MSG-02.message.01J5.photo.image', { includeHiddenElements: true });
    const refreshes = jest.mocked(thread.refresh).mock.calls.length;
    await fireEvent(image, 'error', { nativeEvent: { error: 'expired' } });
    expect(jest.mocked(thread.refresh).mock.calls.length).toBe(refreshes + 1);
    expect(screen.getByTestId('MSG-02.message.01J5.photo.fallback', { includeHiddenElements: true })).toBeTruthy();
  });

  it('gives a photo a width of its own: the bubble fills its 75 % group, the photo the bubble (M2.8, 0×0 on web)', async () => {
    const photo = serverMessage({
      id: '01J6',
      kind: 'photo',
      body: null,
      media: { id: 'm2', status: 'ready', category: 'other', width: 1600, height: 1200, blurhash: null, variants: [{ width: 640, height: 480, url: 'https://speedclub.test/api/v1/chat-media/m2/640?viewer=x&signature=s' }], created_at: null },
    });
    const { adapter } = adapterWith({ messages: [photo, ...messages] });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    const root = await screen.findByTestId('MSG-02.message.01J6.photo', { includeHiddenElements: true });
    const rootStyle = StyleSheet.flatten(root.props.style);
    expect(rootStyle.width).toBe('100%');
    expect(rootStyle.aspectRatio).toBeGreaterThan(0);
    expect(StyleSheet.flatten(screen.getByTestId('MSG-02.message.01J6.chat.bubble', { includeHiddenElements: true }).props.style).alignSelf).toBe('stretch');
    expect(StyleSheet.flatten(screen.getByTestId('MSG-02.message.01J6.chat', { includeHiddenElements: true }).props.style).alignSelf).toBe('stretch');
  });

  it('a pressable one-line bubble reaches 44 without growing: its hit area adds the rest (M2.8)', async () => {
    const { adapter } = adapterWith({ messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    const id = messages[0]?.id ?? '';
    const press = await screen.findByTestId(`MSG-02.message.${id}.press`, { includeHiddenElements: true });
    const slop = (size.touchMin - (typography.bodyDense.lineHeight + 2 * space[8])) / 2;
    expect(slop).toBeGreaterThan(0);
    expect(press.props.hitSlop).toEqual(expect.objectContaining({ top: slop, bottom: slop }));
    expect(StyleSheet.flatten(screen.getByTestId(`MSG-02.message.${id}.chat.bubble`, { includeHiddenElements: true }).props.style).minHeight).toBeUndefined();
  });

  it('while the messages load, the skeleton fills the list height, so the composer is at the bottom from the first frame (F5, M2.8)', async () => {
    const { adapter } = adapterWith({ messages });
    const pending: ThreadData = { ...adapter.useThread('c1'), data: undefined, isPending: true } as ThreadData;
    await renderWith({ ...adapter, useThread: () => pending }, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    const skeleton = await screen.findByTestId('MSG-02.skeleton', { includeHiddenElements: true });
    const box = StyleSheet.flatten(skeleton.parent?.props.style) as { flex?: number; justifyContent?: string };
    expect(box.flex).toBe(1);
    expect(box.justifyContent).toBe('flex-end');
    expect(screen.getByTestId('MSG-02.composer')).toBeTruthy();
  });

  it('qaState=restricted is the real thread, read-only, with the restriction note (DQ-416)', async () => {
    mockQa.state = 'restricted';
    const { adapter } = adapterWith({ messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(await screen.findByTestId('MSG-02.message.01J3')).toBeTruthy();
    expect(screen.getByTestId('MSG-02.closed')).toHaveTextContent(/eingeschränkt/);
    expect(screen.queryByTestId('MSG-02.gone')).toBeNull();
  });

  it('qaState=empty is the conversation without messages: the empty line and the composer, not "gone" (DQ-439)', async () => {
    mockQa.state = 'empty';
    const { adapter } = adapterWith({ messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(await screen.findByTestId('MSG-02.empty')).toHaveTextContent('Schreib die erste Nachricht.');
    expect(screen.getByTestId('MSG-02.composer')).toBeTruthy();
    expect(screen.queryByTestId('MSG-02.message.01J3')).toBeNull();
    expect(screen.queryByTestId('MSG-02.gone')).toBeNull();
  });

  it('no anonymous avatar in the header: back only when gone, the header skeleton while loading (DQ-415)', async () => {
    await renderWith({ ...unavailableMessaging, available: true }, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(await screen.findByTestId('MSG-02.gone')).toBeTruthy();
    expect(screen.queryByTestId('MSG-02.header.member')).toBeNull();
    expect(screen.queryByTestId('MSG-02.header.name')).toBeNull();
    const { adapter } = adapterWith({ messages });
    mockQa.state = 'loading';
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(screen.getByTestId('MSG-02.header.skeleton', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows the pinned context card for a conversation started from a vehicle', async () => {
    const { adapter } = adapterWith({
      detail: conversation({ contextVehicle: { id: 'v1', slug: 'nissan-skyline-gt-r-r34-5tf974vj', title: 'Nissan Skyline GT-R R34', cover: null, ownerUsername: 'lukas.sc' } }),
      messages,
    });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(await screen.findByText('Fahrzeug von @lukas.sc')).toBeTruthy();
  });

  it('says the conversation is gone for a 404, which also covers a block', async () => {
    await renderWith({ ...unavailableMessaging, available: true }, <ThreadPane conversationId="c1" routeId="MSG-02" onLeave={jest.fn()} />);
    expect(await screen.findByTestId('MSG-02.gone')).toBeTruthy();
  });
});

describe('MSG-04 request mode', () => {
  const request = conversation({
    folder: 'requests',
    other: { username: 'max.e46', displayName: 'Max', avatar: null },
    // Even if an answer carried a read mark, a request must never show or send read state.
    otherReadMessageId: '01J9',
    canSend: false,
  });
  const messages = [serverMessage({ id: '01J9', senderUsername: 'max.e46', body: 'Servus, ist dein E46 noch zu haben?' })];

  it('shows the banner with Annehmen, Löschen, Blockieren, and no composer', async () => {
    const { adapter } = adapterWith({ detail: request, messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-04" onLeave={jest.fn()} />);
    expect(await screen.findByText('@max.e46 möchte dir schreiben')).toBeTruthy();
    expect(screen.getByTestId('MSG-04.request.accept')).toBeTruthy();
    expect(screen.getByTestId('MSG-04.request.decline')).toBeTruthy();
    expect(screen.getByTestId('MSG-04.request.block')).toBeTruthy();
    // DQ-417: on its own line, its label on the banner's edge: the box starts left and reaches out by its padding.
    const block = StyleSheet.flatten(screen.getByTestId('MSG-04.request.block').props.style);
    expect(block.alignSelf).toBe('flex-start');
    expect(block.marginHorizontal).toBeLessThan(0);
    expect(screen.queryByTestId('MSG-04.composer')).toBeNull();
  });

  it('an empty request says so, and invites no first message without a composer (DQ-450)', async () => {
    mockQa.state = 'empty';
    try {
      const { adapter } = adapterWith({ detail: request, messages });
      await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-04" onLeave={jest.fn()} />);
      expect(await screen.findByTestId('MSG-04.empty')).toHaveTextContent('Diese Anfrage enthält keine Nachrichten mehr.');
      expect(screen.queryByTestId('MSG-04.composer')).toBeNull();
    } finally {
      mockQa.state = 'default';
    }
  });

  it('never marks a request read', async () => {
    const { adapter, actions } = adapterWith({ detail: request, messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-04" onLeave={jest.fn()} />);
    await flush();
    expect(jest.mocked(actions.markRead)).not.toHaveBeenCalled();
    expect(screen.queryByText('Gelesen')).toBeNull();
  });

  it('offers a request from a deleted account only Löschen (review 13)', async () => {
    const { adapter } = adapterWith({ detail: { ...request, other: null, otherDeleted: true }, messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-04" onLeave={jest.fn()} />);
    expect(await screen.findByText('Anfrage eines gelöschten Mitglieds')).toBeTruthy();
    expect(screen.getByTestId('MSG-04.request.decline')).toBeTruthy();
    expect(screen.queryByTestId('MSG-04.request.accept')).toBeNull();
    expect(screen.queryByTestId('MSG-04.request.block')).toBeNull();
  });

  it('accepts', async () => {
    const { adapter, actions } = adapterWith({ detail: request, messages });
    await renderWith(adapter, <ThreadPane conversationId="c1" routeId="MSG-04" onLeave={jest.fn()} />);
    await fireEvent.press(await screen.findByTestId('MSG-04.request.accept'));
    await flush();
    expect(jest.mocked(actions.accept)).toHaveBeenCalledWith('01JCONV000000000000000000A');
  });
});

describe('MSG-01 organise [SIG]', () => {
  it('archives from the more button, with Rückgängig', async () => {
    const { adapter, actions } = adapterWith({ inbox: [summary({ id: 'c1' })] });
    await renderWith(adapter, <MessagesScreen />);
    await fireEvent.press(await screen.findByTestId('MSG-01.row.c1.more'));
    await fireEvent.press(await screen.findByTestId('MSG-01.organise.archive'));
    await flush();
    expect(jest.mocked(actions.organise)).toHaveBeenCalledWith('c1', { archived: true });
    const { toast } = jest.requireMock<{ toast: jest.Mock }>('@/ui/toast');
    expect(toast).toHaveBeenCalledWith('Archiviert', expect.objectContaining({ undo: expect.any(Function) }));
  });

  it('asks before deleting a conversation for you', async () => {
    const { adapter, actions } = adapterWith({ inbox: [summary({ id: 'c1' })] });
    await renderWith(adapter, <MessagesScreen />);
    await fireEvent.press(await screen.findByTestId('MSG-01.row.c1.more'));
    await fireEvent.press(await screen.findByTestId('MSG-01.organise.delete'));
    expect(jest.mocked(actions.deleteConversation)).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId('MSG-01.deleteDialog.confirm'));
    await flush();
    expect(jest.mocked(actions.deleteConversation)).toHaveBeenCalledWith('c1');
  });
});
