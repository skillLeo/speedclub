/**
 * M5.8 Forum screens against a stubbed API (m5.8-contract §4): FOR-01 list, sort and filters, search and flag off; FOR-03 votes,
 * best answer, subscription, reply, locked and restricted; FOR-04 validation, "Ähnliche Themen" and pre-moderation; FOR-05 tabs;
 * HOME-01 "Gerade im Forum"; VEH-01's discussions; SET-09's forum switches.
 */
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { meKey } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { BuildDiscussions, ForumActiveModule } from '@/features/forum/components/ForumModules';
import { PostItem } from '@/features/forum/components/PostItem';
import { ForumComposerScreen } from '@/features/forum/screens/ForumComposerScreen';
import { ForumListScreen } from '@/features/forum/screens/ForumListScreen';
import { ForumThreadScreen } from '@/features/forum/screens/ForumThreadScreen';
import { MyForumScreen } from '@/features/forum/screens/MyForumScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { dismissToast, ToastHost } from '@/ui';

import { newQueryClient, renderScreen as renderWith, stubFetch, type Answer } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), dismiss: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/forum',
  useRoute: () => ({ key: 'forum-1', name: 'forum/index' }),
  useNavigation: () => ({
    getState: () => ({ routeNames: ['index', 'forum/index'], routes: [{ key: 'home-1', name: 'index' }, { key: 'forum-1', name: 'forum/index' }] }),
    getParent: () => undefined,
    canGoBack: () => true,
    goBack: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
  }),
  usePreventRemove: jest.fn(),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: ReactNode }) => children,
}));
type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
};
jest.mock('@shopify/flash-list', () => {
  const { forwardRef, Fragment, createElement, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const FlashList = forwardRef<unknown, MockListProps>(function FlashList(props, ref) {
    useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn(), scrollToIndex: jest.fn(), getScrollableNode: () => null }));
    const { data, renderItem, keyExtractor, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = props;
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : items, ListFooterComponent);
  });
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const THREAD = '01JFORUMTHREAD000000000001';
const LUKAS = { username: 'lukas.sc', display_name: 'Lukas Scholz', city: 'Hamburg', avatar: null, is_sample: false, is_editorial: false };
const NINA = { ...LUKAS, username: 'nina.r34', display_name: 'Nina' };

function row(extra: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    title: 'Welche Federn für den E46 Touring?',
    slug: 'welche-federn-fuer-den-e46-touring',
    status: 'published',
    category: { id: 2, slug: 'fahrwerk', name: 'Fahrwerk', kind: 'standard' },
    author: LUKAS,
    vehicle: null,
    tags: ['fahrwerk'],
    is_pinned: false,
    is_locked: false,
    is_solved: true,
    replies_count: 12,
    last_activity_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    last_poster: NINA,
    has_photos: false,
    is_sample: false,
    path: `/forum/${THREAD}`,
    ...extra,
  };
}

function thread(extra: Record<string, unknown> = {}, viewer: Record<string, boolean> = {}) {
  return {
    ...row({ is_solved: false, replies_count: 2 }),
    opening_post_id: '01JFORUMOPENING00000000001',
    body: null,
    content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Ich suche Federn mit Gutachten.', bold: false, italic: false }] }],
    opening_deleted: false,
    photos: [],
    modification: null,
    product: null,
    solution: null,
    merged_into: null,
    review_reason: null,
    published_at: '2026-11-15T10:00:00Z',
    edited_at: null,
    created_at: '2026-11-15T10:00:00Z',
    share_url: `https://speedclub.test/app/forum/${THREAD}`,
    viewer: { is_author: false, subscribed: false, can_reply: true, can_edit: false, can_delete: false, can_mark_solution: false, can_report: true, ...viewer },
    ...extra,
  };
}

function reply(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    thread_id: THREAD,
    parent_id: null,
    status: 'published',
    author: NINA,
    body: null,
    content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Nimm die H&R mit 30 mm.', bold: false, italic: false }] }],
    helpful_count: 3,
    viewer_voted: false,
    is_solution: false,
    deleted: false,
    mentions: [],
    edited_at: null,
    created_at: '2026-11-15T11:00:00Z',
    replies: [],
    review_reason: null,
    viewer: { is_author: false, can_edit: false, can_delete: false, can_vote: true, can_report: true },
    ...extra,
  };
}

const page = (data: unknown[]) => ({ data, links: {}, meta: { next_cursor: null, prev_cursor: null, per_page: 20, path: null } });
const CATEGORIES = [
  { id: 1, slug: 'technik-tuning', kind: 'standard', name: 'Technik & Tuning', description: null, icon: null, parent_id: null, children: [{ id: 2, slug: 'fahrwerk', kind: 'standard', name: 'Fahrwerk', description: null, icon: null, parent_id: 1, children: [] }] },
  { id: 3, slug: 'kaufberatung', kind: 'standard', name: 'Kaufberatung', description: null, icon: null, parent_id: null, children: [] },
];

function me(extra: Record<string, unknown> = {}) {
  return {
    id: 'me',
    username: 'max.e46',
    display_name: 'Max',
    city: null,
    avatar: null,
    is_sample: false,
    is_editorial: false,
    email_verified: true,
    member_since: '2025-03-01T00:00:00Z',
    restrictions: {
      suspended: false,
      messaging: { restricted: false, until: null, decision_id: null },
      publishing: { restricted: false, until: null, decision_id: null },
      forum: { restricted: false, until: null, decision_id: null },
    },
    ...extra,
  };
}

let client: QueryClient;
const renderScreen = (element: Parameters<typeof renderWith>[0]) =>
  renderWith(
    <>
      {element}
      <ToastHost />
    </>,
    client,
  );

function flags(on: Record<string, boolean> = { forum: true }) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: on }, confirmed: true });
}

function signIn(profile: Record<string, unknown> = me()) {
  useSessionStore.setState({ status: 'member', member: { id: 'me', username: 'max.e46', displayName: 'Max', avatarUrl: null } });
  client.setQueryData(meKey, profile);
}

const callsTo = (calls: Request[], method: string, path: string) => calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(path));

beforeAll(async () => {
  await hydrateThemePreference();
});
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  mockParams = {};
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  dismissToast();
  client.clear();
  queryClient.clear();
});

describe('FOR-01 Forum', () => {
  const answers = (extra: Record<string, Answer> = {}) => ({
    '/forum/categories': { body: { data: CATEGORIES } },
    '/forum/threads': { body: page([row(), row({ id: '01JFORUMTHREAD000000000002', title: 'Bremsen quietschen nach Belagwechsel', is_solved: false, replies_count: 0, is_sample: true, last_poster: null })]) },
    ...extra,
  });

  it('lists the threads with category, reply count, "Gelöst" and "Beispiel"', async () => {
    flags();
    stubFetch(answers());
    await renderScreen(<ForumListScreen routeId="FOR-01" />);
    expect(await screen.findByTestId(`FOR-01.thread.${THREAD}`)).toBeTruthy();
    expect(screen.getByTestId(`FOR-01.thread.${THREAD}.category`)).toHaveTextContent('Fahrwerk');
    expect(screen.getByTestId(`FOR-01.thread.${THREAD}.replies`)).toHaveTextContent('12 Antworten');
    expect(screen.getByTestId(`FOR-01.thread.${THREAD}.solved`)).toHaveTextContent('Gelöst');
    expect(screen.getByTestId(`FOR-01.thread.${THREAD}.last`)).toHaveTextContent('@nina.r34', { exact: false });
    expect(screen.getByTestId('FOR-01.thread.01JFORUMTHREAD000000000002.replies')).toHaveTextContent('Noch keine Antwort');
    expect(screen.getByTestId('FOR-01.thread.01JFORUMTHREAD000000000002.badges.sample')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId(`FOR-01.thread.${THREAD}`)));
    expect(mockRouter.push).toHaveBeenCalledWith(`/forum/${THREAD}`);
  });

  it('sorts (Aktiv · Neu · Unbeantwortet · Gelöst) and filters by category, keeping both in the address', async () => {
    flags();
    const { calls } = stubFetch(answers());
    await renderScreen(<ForumListScreen routeId="FOR-01" />);
    await screen.findByTestId(`FOR-01.thread.${THREAD}`);
    expect(calls.some((call) => call.url.includes('/forum/threads') && call.url.includes('sort=active'))).toBe(true);
    await act(async () => fireEvent.press(screen.getByTestId('FOR-01.sort')));
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-01.sortSheet.unanswered')));
    await waitFor(() => expect(calls.some((call) => call.url.includes('sort=unanswered'))).toBe(true));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sort: 'unanswered' });
    expect(screen.getByTestId('FOR-01.sort')).toHaveTextContent('Unbeantwortet', { exact: false });
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-01.category.kaufberatung')));
    await waitFor(() => expect(calls.some((call) => call.url.includes('category=kaufberatung') && call.url.includes('sort=unanswered'))).toBe(true));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ category: 'kaufberatung' });
  });

  it('searches through search/threads once typing pauses', async () => {
    flags();
    const { calls } = stubFetch(answers({ '/search/threads': { body: page([row()]) } }));
    await renderScreen(<ForumListScreen routeId="FOR-01" />);
    await screen.findByTestId(`FOR-01.thread.${THREAD}`);
    await act(async () => fireEvent.changeText(screen.getByTestId('FOR-01.search'), '  E46   Federn '));
    await waitFor(() => expect(calls.some((call) => new URL(call.url).pathname.endsWith('/search/threads') && /q=E46(\+|%20)Federn/.test(call.url))).toBe(true));
  });

  it('invites with the badged sample and "Thema starten" when the forum is empty', async () => {
    flags();
    stubFetch(answers({ '/forum/threads': { body: page([]) } }));
    await renderScreen(<ForumListScreen routeId="FOR-01" />);
    expect(await screen.findByTestId('FOR-01.empty')).toBeTruthy();
    expect(screen.getByTestId('FOR-01.empty.thread.sample.badges.sample')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('Thema starten')));
    // A guest signs in first.
    expect(useSessionStore.getState().promptOpen).toBe(true);
  });

  it('says the forum is off when the flag is, and asks nothing', async () => {
    flags({});
    const { calls } = stubFetch(answers());
    await renderScreen(<ForumListScreen routeId="FOR-01" />);
    expect(await screen.findByTestId('FOR-01.unavailable')).toBeTruthy();
    expect(calls.filter((call) => call.url.includes('/forum/'))).toHaveLength(0);
  });
});

describe('FOR-03 Thema', () => {
  const answers = (theThread = thread(), replies: unknown[] = [reply('01JREPLY000000000000000001'), reply('01JREPLY000000000000000002', { author: LUKAS, helpful_count: 0 })], extra: Record<string, Answer | (() => Answer)> = {}) => ({
    [`/forum/threads/${THREAD}/posts`]: { body: page(replies) },
    [`/forum/threads/${THREAD}`]: { body: { data: theThread } },
    ...extra,
  });

  it('shows the opening post, the replies with their visible "Hilfreich" count and votes at once', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    const { calls } = stubFetch(
      answers(undefined, undefined, { '/forum/posts/01JREPLY000000000000000001/vote': { body: { data: { post_id: '01JREPLY000000000000000001', helpful_count: 4, voted: true } } } }),
    );
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.title')).toHaveTextContent('Welche Federn für den E46 Touring?');
    expect(screen.getByTestId('FOR-03.body')).toHaveTextContent('Ich suche Federn mit Gutachten.');
    expect(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001.helpful.count')).toHaveTextContent('3');
    // No count for none: the button stays a word.
    expect(screen.queryByTestId('FOR-03.post.01JREPLY000000000000000002.helpful.count')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('FOR-03.post.01JREPLY000000000000000001.helpful')));
    // Optimistic: the count follows the press (after the mutation's cancelled refetches), before the server's answer is needed.
    await waitFor(() => expect(screen.getByTestId('FOR-03.post.01JREPLY000000000000000001.helpful.count')).toHaveTextContent('4'));
    await waitFor(() => expect(callsTo(calls, 'PUT', '/forum/posts/01JREPLY000000000000000001/vote')).toHaveLength(1));
    expect(screen.getByTestId('FOR-03.post.01JREPLY000000000000000001.helpful')).toBeChecked();
  });

  it('takes a vote back when the server refuses it', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    stubFetch(answers(undefined, undefined, { '/vote': { status: 429, body: { message: 'Zu viele Anfragen', code: 'rate_limited', errors: {} } } }));
    await renderScreen(<ForumThreadScreen />);
    await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001.helpful');
    await act(async () => fireEvent.press(screen.getByTestId('FOR-03.post.01JREPLY000000000000000001.helpful')));
    await waitFor(() => expect(screen.getByTestId('FOR-03.post.01JREPLY000000000000000001.helpful.count')).toHaveTextContent('3'));
    expect(await screen.findByText('Deine Stimme konnte nicht gespeichert werden.')).toBeTruthy();
  });

  it('lets the thread author mark the best answer "Gelöst"', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    const solved = thread({ is_solved: true, solution: reply('01JREPLY000000000000000001', { is_solution: true }) }, { is_author: true, can_mark_solution: true, can_edit: true });
    const { calls } = stubFetch(answers(thread({}, { is_author: true, can_mark_solution: true, can_edit: true }), undefined, { '/solution': { body: { data: solved } } }));
    await renderScreen(<ForumThreadScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001.markSolution')));
    expect(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001.solution')).toHaveTextContent('Gelöst');
    const put = callsTo(calls, 'PUT', `/forum/threads/${THREAD}/solution`);
    expect(put).toHaveLength(1);
    expect(await put[0]!.clone().json()).toEqual({ post_id: '01JREPLY000000000000000001' });
    expect(await screen.findByTestId('FOR-03.solutionBlock')).toBeTruthy();
    expect(screen.getByTestId('FOR-03.post.01JREPLY000000000000000001.markSolution')).toHaveTextContent('Lösung entfernen');
  });

  it('subscribes with the bell', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    const { calls } = stubFetch(answers(undefined, undefined, { '/subscription': { body: { data: { thread_id: THREAD, subscribed: true } } } }));
    await renderScreen(<ForumThreadScreen />);
    await act(async () => fireEvent.press(await screen.findByLabelText('Abonnieren')));
    await waitFor(() => expect(callsTo(calls, 'PUT', `/forum/threads/${THREAD}/subscription`)).toHaveLength(1));
    expect(await screen.findByText('Abonniert: Neue Antworten bekommst du als Mitteilung.')).toBeTruthy();
    expect(screen.getByLabelText('Abo beenden')).toBeTruthy();
  });

  it('sends a reply to an answer under its top-level reply, shown at once', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    const created = reply('01JREPLY000000000000000009', { parent_id: '01JREPLY000000000000000001', author: { ...LUKAS, username: 'max.e46' }, content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Danke, bestellt.', bold: false, italic: false }] }] });
    const { calls } = stubFetch(answers(undefined, undefined, { [`/forum/threads/${THREAD}/posts`]: () => ({ status: 200, body: page([reply('01JREPLY000000000000000001'), reply('01JREPLY000000000000000002', { author: LUKAS })]) }) }));
    await renderScreen(<ForumThreadScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001.reply')));
    expect(screen.getByTestId('FOR-03.replyTo')).toHaveTextContent('Antwort an @nina.r34', { exact: false });
    stubFetch(answers(undefined, undefined, { [`/forum/threads/${THREAD}/posts`]: () => ({ status: 201, body: { data: created } }) }));
    await act(async () => fireEvent.changeText(screen.getByTestId('FOR-03.composer.input'), 'Danke, bestellt.'));
    await act(async () => fireEvent.press(screen.getByTestId('FOR-03.composer.send')));
    expect(await screen.findByText('Danke, bestellt.')).toBeTruthy();
    expect(calls.length).toBeGreaterThan(0);
    // Two renders of the thread and an optimistic swap: slower than the default 5 s on a loaded machine.
  }, 20_000);

  it('closes replying on a locked thread but keeps the votes', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    stubFetch(answers(thread({ is_locked: true }, { can_reply: false })));
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.closed')).toHaveTextContent('Geschlossen: Neue Antworten sind hier nicht mehr möglich.');
    // Said once (DQ-P5-037 b): the head does not repeat it.
    expect(screen.queryByTestId('FOR-03.locked')).toBeNull();
    expect(screen.queryByTestId('FOR-03.composer')).toBeNull();
    expect(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001.helpful')).toBeTruthy();
    expect(screen.queryByTestId('FOR-03.post.01JREPLY000000000000000001.reply')).toBeNull();
  });

  it('tells a forum-banned member why they cannot reply, reading stays open', async () => {
    flags();
    signIn(me({ restrictions: { ...me().restrictions, forum: { restricted: true, until: '2026-12-01T10:00:00+01:00', decision_id: '01JDEC' } } }));
    mockParams = { id: THREAD };
    stubFetch(answers());
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.restricted')).toHaveTextContent('Im Forum kannst du bis zum', { exact: false });
    expect(screen.getByTestId('FOR-03.restricted.decision')).toBeTruthy();
    expect(screen.queryByTestId('FOR-03.composer')).toBeNull();
    expect(screen.getByTestId('FOR-03.body')).toBeTruthy();
  });

  it('tells a new account that its posts are checked first', async () => {
    flags();
    signIn(me({ email_verified: false }));
    mockParams = { id: THREAD };
    stubFetch(answers());
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.premoderation')).toBeTruthy();
  });

  it('shows the author their pending thread with its notice', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    stubFetch(answers(thread({ status: 'pending' }, { is_author: true }), []));
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.pending')).toHaveTextContent('In Prüfung', { exact: false });
  });

  it('says when a thread is gone', async () => {
    flags();
    mockParams = { id: THREAD };
    stubFetch({});
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.notFound')).toBeTruthy();
  });
});

describe('FOR-04 Neues Thema', () => {
  const answers = (extra: Record<string, Answer | (() => Answer)> = {}) => ({
    '/forum/categories': { body: { data: CATEGORIES } },
    '/me/vehicles': { body: { data: [] } },
    '/forum/similar': { body: { data: [row({ id: '01JFORUMTHREAD000000000003', title: 'Federn E46 Touring mit AHK' })] } },
    ...extra,
  });

  it('names what is missing before it sends anything', async () => {
    flags();
    signIn();
    const { calls } = stubFetch(answers());
    await renderScreen(<ForumComposerScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-04.cta.primary')));
    expect(await screen.findByText('Mindestens 5 Zeichen.')).toBeTruthy();
    expect(screen.getByText('Wähl eine Kategorie.')).toBeTruthy();
    expect(screen.getByText('Mindestens 10 Zeichen.')).toBeTruthy();
    expect(callsTo(calls, 'POST', '/forum/threads')).toHaveLength(0);
  });

  it('suggests "Ähnliche Themen" while the title is typed', async () => {
    flags();
    signIn();
    const { calls } = stubFetch(answers());
    await renderScreen(<ForumComposerScreen />);
    await act(async () => fireEvent.changeText(await screen.findByTestId('FOR-04.title'), 'Federn E46'));
    expect(await screen.findByTestId('FOR-04.similar', {}, { timeout: 3000 })).toHaveTextContent('Federn E46 Touring mit AHK', { exact: false });
    expect(calls.some((call) => new URL(call.url).pathname.endsWith('/forum/similar') && call.url.includes('title=Federn'))).toBe(true);
  });

  it('posts the thread with its category and tags, and opens it', async () => {
    flags();
    signIn();
    mockParams = { category: 'fahrwerk' };
    const created = thread({ status: 'pending' }, { is_author: true });
    const { calls } = stubFetch(answers({ '/forum/threads': { status: 201, body: { data: created } } }));
    await renderScreen(<ForumComposerScreen />);
    await act(async () => fireEvent.changeText(await screen.findByTestId('FOR-04.title'), 'Welche Federn für den E46 Touring?'));
    await act(async () => fireEvent.changeText(screen.getByTestId('FOR-04.body'), 'Ich suche Federn mit Gutachten.'));
    await act(async () => fireEvent.changeText(screen.getByTestId('FOR-04.tags'), 'Fahrwerk, #E46'));
    await act(async () => fireEvent.press(screen.getByTestId('FOR-04.cta.primary')));
    await waitFor(() => expect(callsTo(calls, 'POST', '/forum/threads')).toHaveLength(1));
    const post = callsTo(calls, 'POST', '/forum/threads')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBe('uuid-1');
    expect(await post.clone().json()).toEqual({ title: 'Welche Federn für den E46 Touring?', category: 'fahrwerk', body: 'Ich suche Federn mit Gutachten.', tags: ['fahrwerk', 'e46'], vehicle_id: null });
    // Pre-moderated: it says so.
    expect(await screen.findByText('Gesendet. Dein Thema erscheint, sobald das Team es freigegeben hat.')).toBeTruthy();
  });

  it('maps the server’s 422 to its field', async () => {
    flags();
    signIn();
    mockParams = { category: 'fahrwerk' };
    stubFetch(answers({ '/forum/threads': { status: 422, body: { message: 'Bitte prüf deine Eingaben.', code: 'validation_failed', errors: { title: ['Dieser Titel enthält ein gesperrtes Wort.'] } } } }));
    await renderScreen(<ForumComposerScreen />);
    await act(async () => fireEvent.changeText(await screen.findByTestId('FOR-04.title'), 'Welche Federn für den E46 Touring?'));
    await act(async () => fireEvent.changeText(screen.getByTestId('FOR-04.body'), 'Ich suche Federn mit Gutachten.'));
    await act(async () => fireEvent.press(screen.getByTestId('FOR-04.cta.primary')));
    expect(await screen.findByText('Dieser Titel enthält ein gesperrtes Wort.')).toBeTruthy();
  });

  it('asks a guest to sign in', async () => {
    flags();
    stubFetch(answers());
    await renderScreen(<ForumComposerScreen />);
    expect(await screen.findByTestId('FOR-04.guest')).toBeTruthy();
  });
});

describe('FOR-05, Home and VEH-01', () => {
  it('shows the member their own states and switches to subscriptions', async () => {
    flags();
    signIn();
    const { calls } = stubFetch({
      '/me/forum/threads': { body: page([row({ status: 'pending' })]) },
      '/me/forum/subscriptions': { body: page([]) },
    });
    await renderScreen(<MyForumScreen />);
    expect(await screen.findByTestId(`FOR-05.thread.${THREAD}.status`)).toHaveTextContent('In Prüfung');
    await act(async () => fireEvent.press(screen.getByTestId('FOR-05.tab.subscriptions')));
    expect(await screen.findByTestId('FOR-05.emptySubscriptions')).toBeTruthy();
    expect(calls.some((call) => new URL(call.url).pathname.endsWith('/me/forum/subscriptions'))).toBe(true);
  });

  it('HOME-01 "Gerade im Forum": up to three threads and "Zum Forum"', async () => {
    flags();
    await renderScreen(<ForumActiveModule threads={[row()] as never} routeId="HOME-01" />);
    expect(screen.getByTestId('HOME-01.forum.header')).toHaveTextContent('Gerade im Forum', { exact: false });
    await act(async () => fireEvent.press(screen.getByText('Zum Forum')));
    expect(mockRouter.push).toHaveBeenCalledWith('/forum');
  });

  it('HOME-01 leaves the module out when the forum is quiet', async () => {
    flags();
    await renderScreen(<ForumActiveModule threads={[]} routeId="HOME-01" />);
    expect(screen.queryByTestId('HOME-01.forum')).toBeNull();
  });

  const vehicle = { id: '01JVEHICLE0000000000000001', full_title: 'BMW 3er Touring (E46)', is_owner: false, is_sample: false } as never;

  it('VEH-01 lists the threads about the car', async () => {
    flags();
    const { calls } = stubFetch({ '/forum-threads': { body: page([row()]) } });
    await renderScreen(<BuildDiscussions vehicle={vehicle} routeId="VEH-01" />);
    expect(await screen.findByTestId(`VEH-01.discussions.thread.${THREAD}`)).toBeTruthy();
    expect(calls.some((call) => new URL(call.url).pathname.endsWith('/vehicles/01JVEHICLE0000000000000001/forum-threads'))).toBe(true);
  });

  it('VEH-01 stays empty for a visitor when no thread has the car attached', async () => {
    flags();
    const { calls } = stubFetch({ '/forum-threads': { body: page([]) } });
    await renderScreen(<BuildDiscussions vehicle={vehicle} routeId="VEH-01" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('VEH-01.discussions')).toBeNull();
  });

  it('VEH-01 draws nothing while the forum flag is off', async () => {
    flags({});
    const { calls } = stubFetch({ '/forum-threads': { body: page([row()]) } });
    await renderScreen(<BuildDiscussions vehicle={vehicle} routeId="VEH-01" />);
    expect(screen.queryByTestId('VEH-01.discussions')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('review m5.8', () => {
  const posts = (data: unknown[], next: string | null) => ({ data, links: {}, meta: { next_cursor: next, prev_cursor: null, per_page: 20, path: null } });

  it('SF-6: `?post=` reads the next pages until the reply is there, then marks it', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD, post: '01JREPLY000000000000000040' };
    let call = 0;
    const { calls } = stubFetch({
      [`/forum/threads/${THREAD}/posts`]: () => {
        call += 1;
        return call === 1
          ? { body: posts([reply('01JREPLY000000000000000001')], 'cursor-2') }
          : call === 2
            ? { body: posts([reply('01JREPLY000000000000000020')], 'cursor-3') }
            : { body: posts([reply('01JREPLY000000000000000040', { author: LUKAS })], null) };
      },
      [`/forum/threads/${THREAD}`]: { body: { data: thread() } },
    });
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000040', {}, { timeout: 4000 })).toBeTruthy();
    const pages = calls.filter((request) => new URL(request.url).pathname.endsWith(`/forum/threads/${THREAD}/posts`));
    expect(pages.map((request) => new URL(request.url).searchParams.get('cursor'))).toEqual([null, 'cursor-2', 'cursor-3']);
  }, 20_000);

  it('SF-6: stops reading when the reply is not there (no endless paging)', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD, post: '01JREPLY000000000000000099' };
    const { calls } = stubFetch({
      [`/forum/threads/${THREAD}/posts`]: { body: posts([reply('01JREPLY000000000000000001')], null) },
      [`/forum/threads/${THREAD}`]: { body: { data: thread() } },
    });
    await renderScreen(<ForumThreadScreen />);
    await screen.findByTestId('FOR-03.post.01JREPLY000000000000000001');
    await waitFor(() => expect(calls.filter((request) => new URL(request.url).pathname.endsWith('/posts'))).toHaveLength(1));
  });

  it('keeps `?post=` when a merged thread sends the reader on to its target', async () => {
    flags();
    mockParams = { id: THREAD, post: '01JREPLY000000000000000040' };
    stubFetch({
      [`/forum/threads/${THREAD}/posts`]: { body: posts([], null) },
      [`/forum/threads/${THREAD}`]: { body: { data: thread({ status: 'merged', merged_into: { id: '01JTHREAD00000000000000002', title: 'Federn E46', path: '/forum/01JTHREAD00000000000000002', is_sample: false } }) } },
    });
    await renderScreen(<ForumThreadScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-03.merged.link')));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/forum/[id]', params: { id: '01JTHREAD00000000000000002', post: '01JREPLY000000000000000040' } });
  });

  it('shows the author why their reply was not published', async () => {
    flags();
    signIn();
    mockParams = { id: THREAD };
    stubFetch({
      [`/forum/threads/${THREAD}/posts`]: { body: posts([reply('01JREPLY000000000000000005', { status: 'rejected', review_reason: 'Bitte ohne Kennzeichen.', viewer: { is_author: true, can_edit: true, can_delete: true, can_vote: false, can_report: false } })], null) },
      [`/forum/threads/${THREAD}`]: { body: { data: thread() } },
    });
    await renderScreen(<ForumThreadScreen />);
    expect(await screen.findByTestId('FOR-03.post.01JREPLY000000000000000005.hint')).toHaveTextContent('Begründung: Bitte ohne Kennzeichen.', { exact: false });
  });

  it('offers no "Antworten" or vote on a reply that is still on its way', async () => {
    const local = { ...reply('local-uuid-9'), viewer: { is_author: true, can_edit: false, can_delete: false, can_vote: false, can_report: false } };
    const handlers = { onVote: jest.fn(), onReply: jest.fn(), onMarkSolution: jest.fn(), onMore: jest.fn(), onOpenMember: jest.fn() };
    await renderScreen(<PostItem post={local as never} routeId="FOR-03" canMarkSolution canReply highlightId={null} guest={false} {...handlers} />);
    expect(screen.getByTestId('FOR-03.post.local-uuid-9')).toHaveTextContent('Wird gesendet', { exact: false });
    expect(screen.queryByTestId('FOR-03.post.local-uuid-9.reply')).toBeNull();
    expect(screen.queryByTestId('FOR-03.post.local-uuid-9.helpful')).toBeNull();
  });

  const MEDIA = {
    id: '01JMEDIA000000000000000001',
    status: 'ready',
    category: 'other',
    width: 1200,
    height: 900,
    blurhash: null,
    thumbhash: null,
    focal_x: null,
    focal_y: null,
    alt: null,
    sort: 0,
    variants: [{ width: 640, height: 480, url: 'https://speedclub.test/storage/media/a-640.webp' }],
    created_at: '2026-11-15T10:00:00Z',
  };
  const editable = () => thread({ photos: [MEDIA], body: 'Ich suche Federn mit Gutachten.' }, { is_author: true, can_edit: true, can_delete: true });
  const composerAnswers = (extra: Record<string, Answer | (() => Answer)> = {}) => ({
    '/forum/categories': { body: { data: CATEGORIES } },
    '/me/vehicles': { body: { data: [] } },
    [`/forum/threads/${THREAD}/photos/${MEDIA.id}`]: { status: 204, body: null },
    [`/forum/threads/${THREAD}`]: { body: { data: editable() } },
    ...extra,
  });

  it('SF-7: removing a kept photo deletes it only after the edit is saved', async () => {
    flags();
    signIn();
    mockParams = { thread: THREAD };
    const { calls } = stubFetch(composerAnswers());
    await renderScreen(<ForumComposerScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-04.photo.kept.0.remove')));
    expect(screen.queryByTestId('FOR-04.photo.kept.0')).toBeNull();
    // Nothing deleted yet: "Verwerfen" would still keep it.
    expect(callsTo(calls, 'DELETE', `/photos/${MEDIA.id}`)).toHaveLength(0);
    await act(async () => fireEvent.press(screen.getByTestId('FOR-04.cta.primary')));
    await waitFor(() => expect(callsTo(calls, 'PATCH', `/forum/threads/${THREAD}`)).toHaveLength(1));
    await waitFor(() => expect(callsTo(calls, 'DELETE', `/forum/threads/${THREAD}/photos/${MEDIA.id}`)).toHaveLength(1));
    expect(await screen.findByText('Thema gespeichert.')).toBeTruthy();
  });

  it('SF-7: a refused save deletes nothing', async () => {
    flags();
    signIn();
    mockParams = { thread: THREAD };
    stubFetch(composerAnswers());
    await renderScreen(<ForumComposerScreen />);
    await act(async () => fireEvent.press(await screen.findByTestId('FOR-04.photo.kept.0.remove')));
    const { calls } = stubFetch(composerAnswers({ [`/forum/threads/${THREAD}`]: { status: 422, body: { message: 'Bitte prüf deine Eingaben.', code: 'validation_failed', errors: { title: ['Zu kurz.'] } } } }));
    await act(async () => fireEvent.press(screen.getByTestId('FOR-04.cta.primary')));
    expect(await screen.findByText('Zu kurz.')).toBeTruthy();
    expect(callsTo(calls, 'DELETE', `/photos/${MEDIA.id}`)).toHaveLength(0);
  });
});
