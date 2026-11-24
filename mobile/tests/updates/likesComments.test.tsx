/**
 * R4-2.2 likes and comments: the one-tap heart "Gefällt mir" before the car reactions (feed card and VEH-05), the owner's private
 * summary with it, and the comment thread (send, reply, delete, closed, guest) inline and in the feed card's sheet. Never a count for
 * anybody but the owner.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { BuildComment } from '@/api/queries/social2';
import { HomeFeedCard } from '@/features/home/components/HomeFeedCard';
import { __resetFeedReactionsForTests } from '@/features/home/feedActions';
import { sendRefusal, withoutComment, withSentComment, type CommentPage } from '@/features/updates/comments';
import { placeholderKey } from '@/features/updates/components/Comments';
import { summaryEntries } from '@/features/updates/components/Reactions';
import { reactionTriggerLabel } from '@/features/updates/reactions';
import { UpdateDetailScreen } from '@/features/vehicle/screens/UpdateDetailScreen';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { buildUpdate, M4 } from '../home/fixtures';
import { callsTo, newQueryClient, renderWithProviders, stubFetch } from '../home/harness';
import { R34 } from '../vehicle/fixtures';

const mockParams: Record<string, string | undefined> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/v/test',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  useNavigation: () => ({ getParent: () => undefined, canGoBack: () => true, goBack: jest.fn(), dispatch: jest.fn() }),
  usePreventRemove: jest.fn(() => jest.fn()),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const withFlags = (flags: Record<string, boolean>) => {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, ...flags } }, confirmed: true });
  return client;
};
const signIn = (username = 'max.e46') =>
  useSessionStore.setState({ status: 'member', member: { id: 'viewer', username, displayName: 'Max', avatarUrl: null } });
const setParams = (next: Record<string, string>) => {
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  Object.assign(mockParams, next);
};
const author = (username: string) => ({ username, display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false });
const comment = (id: string, body: string, extra: Partial<BuildComment> = {}): BuildComment => ({
  id,
  on: 'build_update',
  vehicle_id: null,
  build_update_id: 'update-kw',
  parent_id: null,
  body,
  author: author('kenji.r34'),
  mentions: [],
  can_delete: false,
  created_at: '2026-11-20T18:00:00+00:00',
  replies: [],
  ...extra,
});
const commentsBody = (data: BuildComment[]) => ({ data, meta: { next_cursor: null, per_page: 30 } });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  __resetFeedReactionsForTests();
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('pure parts', () => {
  it('shows only the reaction kinds with a count, in the picker order (R4DQ-15)', () => {
    expect(summaryEntries({ like: 4, strong: 1, clean: 0, low: 0, loud: 2, total: 7 })).toEqual([
      { key: 'like', count: 4 },
      { key: 'strong', count: 1 },
      { key: 'loud', count: 2 },
    ]);
    expect(summaryEntries({ strong: 0, clean: 0, low: 0, loud: 0, total: 0 } as never)).toEqual([]);
  });

  it('takes the short composer placeholder above 130 % (R4DQ-38)', () => {
    expect(placeholderKey(1)).toBe('comments.placeholder');
    expect(placeholderKey(1.3)).toBe('comments.placeholder');
    expect(placeholderKey(2)).toBe('comments.placeholderShort');
  });

  it('names the trigger "Gefällt mir" until a car reaction is chosen', () => {
    const labels = { like: 'Gefällt mir', react: 'Reagieren' };
    expect(reactionTriggerLabel(null, labels)).toBe('Gefällt mir');
    expect(reactionTriggerLabel('like', labels)).toBe('Gefällt mir');
    expect(reactionTriggerLabel('low', labels)).toBe('Reagieren');
  });

  it('places a sent comment and a reply, and takes a deleted one out', () => {
    const top = comment('c1', 'Saubere Arbeit');
    const data = { pages: [commentsBody([top]) as CommentPage], pageParams: [null] };
    const added = withSentComment(data, comment('c2', 'Welche Federn?'));
    expect(added?.pages[0]?.data.map((entry) => entry.id)).toEqual(['c1', 'c2']);
    const replied = withSentComment(added, comment('r1', 'KW V3', { parent_id: 'c1' }));
    expect(replied?.pages[0]?.data[0]?.replies.map((entry) => entry.id)).toEqual(['r1']);
    expect(withSentComment(replied, comment('c2', 'Welche Federn?'))).toBe(replied);
    expect(withoutComment(replied, 'r1')?.pages[0]?.data[0]?.replies).toEqual([]);
    expect(withoutComment(replied, 'c1')?.pages[0]?.data.map((entry) => entry.id)).toEqual(['c2']);
    // With more pages to come the read after the send places a new comment.
    const more = { pages: [{ data: [top], meta: { next_cursor: 'next' } }], pageParams: [null] };
    expect(withSentComment(more, comment('c3', 'Neu'))).toBe(more);
  });

  it('reads a refused send', () => {
    const err = (status: number, code: string, fieldErrors: Record<string, string[]> = {}) =>
      new ApiError({ kind: status === 422 ? 'validation' : 'forbidden', status, code, message: `msg ${code}`, fieldErrors });
    expect(sendRefusal(err(403, 'comments_disabled'))).toEqual({ kind: 'closed' });
    expect(sendRefusal(err(403, 'account_restricted'))).toEqual({ kind: 'restricted' });
    expect(sendRefusal(err(422, 'content_blocked', { body: ['Dieses Wort geht hier nicht.'] }))).toEqual({ kind: 'field', message: 'Dieses Wort geht hier nicht.' });
    expect(sendRefusal(err(403, 'email_not_verified'))).toEqual({ kind: 'toast', message: 'msg email_not_verified' });
    expect(sendRefusal(new Error('x'))).toEqual({ kind: 'toast', message: null });
  });
});

describe('feed card: Gefällt mir and Kommentare', () => {
  const update = buildUpdate({ id: 'update-kw', viewer: { saved: false, reaction: null } });
  const card = (flags: Record<string, boolean>, row = update) =>
    renderWithProviders(<HomeFeedCard vehicle={M4} update={row} width={390} onOpen={jest.fn()} testID="HOME-01.stream.update.update-kw" />, withFlags(flags));
  const ID = 'HOME-01.stream.update.update-kw';

  it('likes with one tap and takes it back with the next, without a count', async () => {
    signIn();
    const { calls } = stubFetch({
      '/build-updates/update-kw/reactions': (request) => ({
        body: { data: { target_type: 'build-updates', target_id: 'update-kw', my_reaction: request.method === 'PUT' ? 'like' : null } },
      }),
    });
    await card({ build_reactions: true });
    const button = screen.getByTestId(`${ID}.reaction.button`);
    expect(button.props['aria-label']).toBe('Gefällt mir');
    expect(button.props['aria-pressed']).toBe(false);
    await act(async () => fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }));
    await waitFor(() => expect(screen.getByTestId(`${ID}.reaction.button`).props['aria-pressed']).toBe(true));
    const put = callsTo(calls, '/build-updates/update-kw/reactions').find((request) => request.method === 'PUT');
    expect(await put?.clone().json()).toEqual({ reaction: 'like' });
    expect(screen.getByTestId(`${ID}.reaction.button`).props['aria-label']).toBe('Gefällt mir');
    await act(async () => fireEvent(screen.getByTestId(`${ID}.reaction.button`), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }));
    await waitFor(() => expect(callsTo(calls, '/build-updates/update-kw/reactions').some((request) => request.method === 'DELETE')).toBe(true));
    // The picker holds the heart first, then the four car reactions.
    const actions = (screen.getByTestId(`${ID}.reaction.button`).props.accessibilityActions as { name: string }[]).map((entry) => entry.name);
    expect(actions).toEqual(['activate', 'like', 'strong', 'clean', 'low', 'loud']);
  });

  it('starts from the reaction the feed says is the member’s', async () => {
    signIn();
    stubFetch({});
    await card({ build_reactions: true }, buildUpdate({ id: 'update-kw', viewer: { saved: false, reaction: 'low' } }));
    const button = screen.getByTestId(`${ID}.reaction.button`);
    expect(button.props['aria-pressed']).toBe(true);
    expect(button.props['aria-label']).toBe('Reagieren: Tief');
  });

  it('opens the comments in a sheet only while build_comments is on', async () => {
    stubFetch({ '/build-updates/update-kw/comments': { body: commentsBody([comment('c1', 'Wie tief ist er jetzt?')]) } });
    const off = await card({ build_reactions: true });
    expect(screen.queryByTestId(`${ID}.comment`)).toBeNull();
    await act(async () => off.unmount());

    await card({ build_reactions: true, build_comments: true });
    const button = screen.getByTestId(`${ID}.comment`);
    expect(button.props['aria-label'] ?? button.props.accessibilityLabel).toBe('Kommentare');
    await act(async () => fireEvent.press(button));
    expect(await screen.findByTestId('HOME-01.comments.update-kw.comment.c1.body')).toHaveTextContent('Wie tief ist er jetzt?');
    // R4DQ-14, R5DQ-06: the head is "Kommentare" over the update's car, its name kept whole on its own line.
    expect(screen.getByTestId('HOME-01.comments.update-kw.title')).toHaveTextContent('Kommentare');
    const name = String(screen.getByTestId('HOME-01.comments.update-kw.vehicle').props.children).replace(/[\u2060]/g, '');
    expect(name.replace(/\u00A0/g, ' ')).toBe(M4.full_title);
    // A guest reads, and is asked to sign in to write.
    expect(screen.getByTestId('HOME-01.comments.update-kw.guest')).toHaveTextContent(/Melde dich an, um mitzureden\./);
  });
});

describe('VEH-05: Gefällt mir and the comments', () => {
  const update = { ...R34.updates[0]!, id: 'update-kw', my_reaction: null };

  it('shows the labelled heart with the hold hint to a visitor', async () => {
    signIn();
    setParams({ slug: R34.slug, updateId: update.id });
    stubFetch({
      [`/updates/${update.id}`]: { body: { data: update } },
      [`/public/vehicles/${R34.slug}`]: { body: { data: R34 } },
      [`/build-updates/${update.id}/comments`]: { body: commentsBody([]) },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_reactions: true, build_comments: true }));
    expect(await screen.findByTestId('VEH-05.react.label', { includeHiddenElements: true })).toHaveTextContent('Gefällt mir');
    expect(screen.getByTestId('VEH-05.react.button').props['aria-label']).toBe('Gefällt mir');
    expect(screen.getByTestId('VEH-05.react.hint')).toHaveTextContent('Gedrückt halten für Stark, Sauber, Tief oder Laut.');
    expect(await screen.findByTestId('VEH-05.comments.empty')).toHaveTextContent('Noch keine Kommentare. Schreib den ersten.');
  });

  it('lists Gefällt mir first in the owner’s private summary', async () => {
    signIn('kenji.r34');
    setParams({ slug: R34.slug, updateId: update.id });
    stubFetch({
      [`/updates/${update.id}`]: { body: { data: { ...update, reaction_summary: { like: 4, strong: 1, clean: 0, low: 0, loud: 0, total: 5 } } } },
      [`/public/vehicles/${R34.slug}`]: { body: { data: { ...R34, is_owner: true, owner: { ...R34.owner!, is_self: true } } } },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_reactions: true }));
    expect(await screen.findByTestId('VEH-05.reactions.like')).toHaveTextContent('4');
    expect(screen.getByTestId('VEH-05.reactions.like').props['aria-label']).toBe('Gefällt mir 4');
    // R4DQ-15: no zero counts; "Alle ansehen" after the row it opens.
    expect(screen.queryByTestId('VEH-05.reactions.clean')).toBeNull();
    expect(screen.queryByTestId('VEH-05.reactions.loud')).toBeNull();
    const order = screen.getAllByTestId(/^VEH-05\.reactions\.(summary|showAll)$/);
    expect(order.map((node) => node.props.testID)).toEqual(['VEH-05.reactions.summary', 'VEH-05.reactions.showAll']);
  });

  it('shows the owner a designed zero state instead of a row of zeros', async () => {
    signIn('kenji.r34');
    setParams({ slug: R34.slug, updateId: update.id });
    stubFetch({
      [`/updates/${update.id}`]: { body: { data: { ...update, reaction_summary: { like: 0, strong: 0, clean: 0, low: 0, loud: 0, total: 0 } } } },
      [`/public/vehicles/${R34.slug}`]: { body: { data: { ...R34, is_owner: true, owner: { ...R34.owner!, is_self: true } } } },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_reactions: true }));
    expect(await screen.findByTestId('VEH-05.reactions.noneText')).toHaveTextContent('Noch keine Reaktionen.');
    expect(screen.queryByTestId('VEH-05.reactions.summary')).toBeNull();
    expect(screen.queryByTestId('VEH-05.reactions.showAll')).toBeNull();
  });

  it('sends a comment at once, replies, and deletes one of its own after asking', async () => {
    signIn();
    setParams({ slug: R34.slug, updateId: update.id });
    const sent: unknown[] = [];
    const { calls } = stubFetch({
      [`/updates/${update.id}`]: { body: { data: update } },
      [`/public/vehicles/${R34.slug}`]: { body: { data: R34 } },
      // A 204 cannot carry a body in a fetch Response: the stub answers 200, which apiData reads the same way.
      '/comments/own-1': { status: 200, body: {} },
      [`/build-updates/${update.id}/comments`]: (request) => {
        if (request.method === 'POST') {
          sent.push(request.headers.get('Idempotency-Key'));
          return { status: 201, body: { data: comment('own-1', 'Top Build', { author: author('max.e46'), can_delete: true }) } };
        }
        return { body: commentsBody([comment('c1', 'Wie tief ist er jetzt?')]) };
      },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_reactions: true, build_comments: true }));
    await screen.findByTestId('VEH-05.comments.comment.c1');
    await act(async () => fireEvent.changeText(screen.getByTestId('VEH-05.comments.composer.input'), 'Top Build'));
    await act(async () => fireEvent.press(screen.getByTestId('VEH-05.comments.composer.send')));
    expect(await screen.findByTestId('VEH-05.comments.comment.own-1')).toBeTruthy();
    expect(sent[0]).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId('VEH-05.comments.comment.c1.reply')));
    expect(screen.getByTestId('VEH-05.comments.replyTo')).toHaveTextContent('Antwort an @kenji.r34');

    await act(async () => fireEvent.press(screen.getByTestId('VEH-05.comments.comment.own-1.delete')));
    await act(async () => fireEvent.press(await screen.findByTestId('VEH-05.comments.delete.confirm')));
    await waitFor(() => expect(callsTo(calls, '/comments/own-1').some((request) => request.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('VEH-05.comments.comment.own-1')).toBeNull());
  });

  it('keeps what was written readable and closes the composer when the owner turned comments off', async () => {
    signIn();
    setParams({ slug: R34.slug, updateId: update.id });
    stubFetch({
      [`/updates/${update.id}`]: { body: { data: update } },
      [`/public/vehicles/${R34.slug}`]: { body: { data: { ...R34, social: { ...R34.social!, comments_enabled: false } } } },
      [`/build-updates/${update.id}/comments`]: { body: commentsBody([comment('c1', 'Alt, aber sichtbar')]) },
    });
    await renderWithProviders(<UpdateDetailScreen />, withFlags({ build_comments: true }));
    expect(await screen.findByTestId('VEH-05.comments.comment.c1.body')).toHaveTextContent('Alt, aber sichtbar');
    expect(screen.getByTestId('VEH-05.comments.closed')).toHaveTextContent('Für dieses Auto hat der Besitzer Kommentare ausgeschaltet.');
    expect(screen.queryByTestId('VEH-05.comments.composer')).toBeNull();
    expect(screen.queryByTestId('VEH-05.comments.comment.c1.reply')).toBeNull();
  });
});
