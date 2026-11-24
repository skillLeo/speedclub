/**
 * R5-5 "like and comment directly in the Home feed": a car card (HomeFeedCard without `update`) likes the car
 * (`vehicles/{id}/reactions`) and opens the car's own thread in the feed's comments sheet; never a count. The `comment` notification
 * on a car opens VEH-01 with that sheet.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { FeedVehicle } from '@/api/queries/home';
import type { BuildComment } from '@/api/queries/social2';
import { HomeFeedCard } from '@/features/home/components/HomeFeedCard';
import { __resetFeedReactionsForTests } from '@/features/home/feedActions';
import { notificationTarget } from '@/features/home/notifications';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { notification, R34 } from './fixtures';
import { callsTo, newQueryClient, renderWithProviders, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
const mockUuid = { next: 0 };
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${(mockUuid.next += 1)}` }));
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

const FLAGS_ON = { build_reactions: true, build_comments: true };
const withFlags = (flags: Record<string, boolean>) => {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { ...BUNDLED_APP_CONFIG.flags, ...flags } }, confirmed: true });
  return client;
};
const signIn = (username = 'max.e46') =>
  useSessionStore.setState({ status: 'member', member: { id: 'viewer', username, displayName: 'Max', avatarUrl: null } });

/** The feed car with its R5-5 `comment_thread` (open, and this reader may write). */
const car = (extra: Partial<FeedVehicle> = {}): FeedVehicle => ({
  ...R34,
  viewer: { saved: false, reaction: null },
  comment_thread: { enabled: true, can_write: true },
  ...extra,
});
const ID = `HOME-01.card.${R34.id}`;
const SHEET = `HOME-01.comments.${R34.id}`;
const THREAD = `/vehicles/${R34.id}/comments`;

const author = (username: string) => ({ username, display_name: null, city: null, avatar: null, is_sample: false, is_editorial: false });
const comment = (id: string, body: string, extra: Partial<BuildComment> = {}): BuildComment => ({
  id,
  on: 'vehicle',
  vehicle_id: R34.id,
  build_update_id: null,
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

const render = (vehicle: FeedVehicle = car(), flags: Record<string, boolean> = FLAGS_ON) =>
  renderWithProviders(<HomeFeedCard vehicle={vehicle} width={390} onOpen={jest.fn()} testID={ID} />, withFlags(flags));
const activate = (testID: string) =>
  act(async () => fireEvent(screen.getByTestId(testID), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockUuid.next = 0;
  __resetFeedReactionsForTests();
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});

describe('a car card: Gefällt mir on the car', () => {
  it('likes the car with one tap and takes it back with the next, without a count', async () => {
    signIn();
    const { calls } = stubFetch({
      [`/vehicles/${R34.id}/reactions`]: (request) => ({
        body: { data: { target_type: 'vehicles', target_id: R34.id, my_reaction: request.method === 'PUT' ? 'like' : null } },
      }),
    });
    await render();
    const button = screen.getByTestId(`${ID}.reaction.button`);
    expect(button.props['aria-label']).toBe('Gefällt mir');
    expect(button.props['aria-pressed']).toBe(false);
    await activate(`${ID}.reaction.button`);
    await waitFor(() => expect(screen.getByTestId(`${ID}.reaction.button`).props['aria-pressed']).toBe(true));
    const put = callsTo(calls, `/vehicles/${R34.id}/reactions`).find((request) => request.method === 'PUT');
    expect(await put?.clone().json()).toEqual({ reaction: 'like' });
    // Never an update's reaction, never a count anywhere on the card.
    expect(callsTo(calls, '/reactions').every((request) => request.url.includes(`/vehicles/${R34.id}/`))).toBe(true);
    expect(screen.queryByText(/^\d+$/)).toBeNull();
    await activate(`${ID}.reaction.button`);
    await waitFor(() => expect(callsTo(calls, `/vehicles/${R34.id}/reactions`).some((request) => request.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.getByTestId(`${ID}.reaction.button`).props['aria-pressed']).toBe(false));
  });

  it('starts from the car’s viewer.reaction, and the long press offers the heart and the four car reactions', async () => {
    signIn();
    stubFetch({});
    await render(car({ viewer: { saved: false, reaction: 'loud' } }));
    const button = screen.getByTestId(`${ID}.reaction.button`);
    expect(button.props['aria-pressed']).toBe(true);
    expect(button.props['aria-label']).toBe('Reagieren: Laut');
    const actions = (button.props.accessibilityActions as { name: string }[]).map((entry) => entry.name);
    expect(actions).toEqual(['activate', 'like', 'strong', 'clean', 'low', 'loud']);
  });

  it('picks a car reaction from the picker', async () => {
    signIn();
    const { calls } = stubFetch({
      [`/vehicles/${R34.id}/reactions`]: () => ({ body: { data: { target_type: 'vehicles', target_id: R34.id, my_reaction: 'clean' } } }),
    });
    await render();
    await act(async () => fireEvent(screen.getByTestId(`${ID}.reaction.button`), 'accessibilityAction', { nativeEvent: { actionName: 'clean' } }));
    const put = await waitFor(() => {
      const found = callsTo(calls, `/vehicles/${R34.id}/reactions`).find((request) => request.method === 'PUT');
      expect(found).toBeTruthy();
      return found;
    });
    expect(await put?.clone().json()).toEqual({ reaction: 'clean' });
    await waitFor(() => expect(screen.getByTestId(`${ID}.reaction.button`).props['aria-label']).toBe('Reagieren: Sauber'));
  });

  it('asks a guest to sign in instead of reacting', async () => {
    const { calls } = stubFetch({});
    await render();
    await activate(`${ID}.reaction.button`);
    expect(useSessionStore.getState().promptOpen).toBe(true);
    expect(callsTo(calls, '/reactions')).toHaveLength(0);
  });

  it('shows the owner no heart on their own car, and a badged sample car the whole row without a count (ADR-538)', async () => {
    signIn('kenji.r34');
    stubFetch({});
    const own = await render();
    expect(screen.queryByTestId(`${ID}.reaction.button`)).toBeNull();
    await act(async () => own.unmount());
    signIn();
    await render(car({ is_sample: true }));
    expect(screen.getByTestId(`${ID}.reaction.button`)).toBeTruthy();
    expect(screen.getByTestId(`${ID}.comment`)).toBeTruthy();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });
});

describe('a car card: the car’s own comments', () => {
  it('offers Kommentare only while the flag is on and the owner allows comments', async () => {
    stubFetch({});
    const off = await render(car(), { build_reactions: true });
    expect(screen.queryByTestId(`${ID}.comment`)).toBeNull();
    await act(async () => off.unmount());
    const closed = await render(car({ comment_thread: { enabled: false, can_write: false } }));
    expect(screen.queryByTestId(`${ID}.comment`)).toBeNull();
    await act(async () => closed.unmount());
    await render();
    expect(screen.getByTestId(`${ID}.comment`)).toBeTruthy();
  });

  it('opens the car’s thread readable for a guest, with the sign-in line instead of the composer', async () => {
    const { calls } = stubFetch({ [THREAD]: { body: commentsBody([comment('c1', 'Welche Felgen sind das?')]) } });
    await render(car({ comment_thread: { enabled: true, can_write: false } }));
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    expect(await screen.findByTestId(`${SHEET}.comment.c1.body`)).toHaveTextContent('Welche Felgen sind das?');
    expect(callsTo(calls, THREAD)).toHaveLength(1);
    expect(callsTo(calls, '/build-updates/')).toHaveLength(0);
    expect(screen.getByTestId(`${SHEET}.guest`)).toHaveTextContent(/Melde dich an, um mitzureden\./);
  });

  it('shows the empty line, sends a comment at once with its key, and places the answer in the thread', async () => {
    signIn();
    const sent = comment('own-1', 'Sauberer Build!', { author: author('max.e46'), can_delete: true });
    const { calls } = stubFetch({
      [THREAD]: (request) => (request.method === 'POST' ? { status: 201, body: { data: sent } } : { body: commentsBody([]) }),
    });
    await render();
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    expect(await screen.findByTestId(`${SHEET}.empty`)).toHaveTextContent('Noch keine Kommentare. Schreib den ersten.');
    // R5DQ-06: "Kommentare" over the car's name in the car-name voice, neither hyphenated.
    expect(screen.getByTestId(`${SHEET}.title`)).toHaveTextContent('Kommentare');
    const name = String(screen.getByTestId(`${SHEET}.vehicle`).props.children).replace(/\u2060/g, '');
    expect(name.replace(/\u00A0/g, ' ')).toBe(R34.full_title);
    await act(async () => fireEvent.changeText(screen.getByTestId(`${SHEET}.composer.input`), 'Sauberer Build!'));
    await act(async () => fireEvent.press(screen.getByTestId(`${SHEET}.composer.send`)));
    const post = await waitFor(() => {
      const found = callsTo(calls, THREAD).find((request) => request.method === 'POST');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(post.headers.get('Idempotency-Key')).toMatch(/^uuid-/);
    expect(await post.clone().json()).toEqual({ body: 'Sauberer Build!', parent_id: null });
    expect(await screen.findByTestId(`${SHEET}.comment.own-1.body`)).toHaveTextContent('Sauberer Build!');
    expect(screen.getByTestId(`${SHEET}.composer.input`).props.value).toBe('');
  });

  it('puts the draft back with the field message on a 422', async () => {
    signIn();
    stubFetch({
      [THREAD]: (request) =>
        request.method === 'POST'
          ? { status: 422, body: { message: 'Bitte prüfe deine Eingaben.', code: 'validation_failed', errors: { body: ['Höchstens 500 Zeichen.'] } } }
          : { body: commentsBody([]) },
    });
    await render();
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    await screen.findByTestId(`${SHEET}.empty`);
    await act(async () => fireEvent.changeText(screen.getByTestId(`${SHEET}.composer.input`), 'Zu lang'));
    await act(async () => fireEvent.press(screen.getByTestId(`${SHEET}.composer.send`)));
    expect(await screen.findByTestId(`${SHEET}.fieldError`)).toHaveTextContent('Höchstens 500 Zeichen.');
    expect(screen.getByTestId(`${SHEET}.composer.input`).props.value).toBe('Zu lang');
  });

  it('says the member is restricted when the server refuses them, and keeps the thread readable', async () => {
    signIn();
    stubFetch({
      [THREAD]: (request) =>
        request.method === 'POST'
          ? { status: 403, body: { message: 'Dein Konto ist eingeschränkt.', code: 'account_restricted' } }
          : { body: commentsBody([comment('c1', 'Welche Felgen sind das?')]) },
    });
    await render();
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    await screen.findByTestId(`${SHEET}.comment.c1.body`);
    await act(async () => fireEvent.changeText(screen.getByTestId(`${SHEET}.composer.input`), 'Hallo'));
    await act(async () => fireEvent.press(screen.getByTestId(`${SHEET}.composer.send`)));
    expect(await screen.findByTestId(`${SHEET}.restricted`)).toHaveTextContent('Dein Konto ist gerade eingeschränkt. Lesen geht, kommentieren nicht.');
    expect(screen.getByTestId(`${SHEET}.comment.c1.body`)).toBeTruthy();
  });

  it('gives a member who may not write (can_write false) the restricted line instead of the composer', async () => {
    signIn();
    stubFetch({ [THREAD]: { body: commentsBody([comment('c1', 'Welche Felgen sind das?')]) } });
    await render(car({ comment_thread: { enabled: true, can_write: false } }));
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    await screen.findByTestId(`${SHEET}.comment.c1.body`);
    expect(screen.getByTestId(`${SHEET}.restricted`)).toHaveTextContent('Dein Konto ist gerade eingeschränkt. Lesen geht, kommentieren nicht.');
    expect(screen.queryByTestId(`${SHEET}.composer.input`)).toBeNull();
  });

  it('deletes a comment of its own after asking, through comments/{comment}', async () => {
    signIn();
    const own = comment('own-1', 'Sauberer Build!', { author: author('max.e46'), can_delete: true });
    let deleted = false;
    const { calls } = stubFetch({
      [THREAD]: () => ({ body: commentsBody(deleted ? [] : [own]) }),
      '/comments/own-1': () => {
        deleted = true;
        // The stub cannot send an empty 204; the client reads any 2xx the same.
        return { status: 200, body: {} };
      },
    });
    await render();
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    await act(async () => fireEvent.press(await screen.findByTestId(`${SHEET}.comment.own-1.delete`)));
    await act(async () => fireEvent.press(await screen.findByTestId(`${SHEET}.delete.confirm`)));
    await waitFor(() => expect(callsTo(calls, '/comments/own-1').some((request) => request.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId(`${SHEET}.comment.own-1.body`)).toBeNull());
  });

  it('shows the error with a retry when the thread cannot be read', async () => {
    stubFetch({ [THREAD]: { status: 500, body: { message: 'Serverfehler', code: 'server_error' } } });
    await render();
    await act(async () => fireEvent.press(screen.getByTestId(`${ID}.comment`)));
    expect(await screen.findByTestId(`${SHEET}.error`)).toHaveTextContent(/Die Kommentare konnten nicht geladen werden\./);
  });
});

describe('the comment notification', () => {
  const vehicle = { id: R34.id, slug: R34.slug, full_title: R34.full_title, cover: null, is_sample: false };

  it('opens VEH-01 with the car’s comments for a comment on the car', () => {
    const row = notification({ type: 'comment', vehicle, details: { update_id: null, comment_id: 'c1', reply: false, target: 'vehicle' } } as never);
    expect(notificationTarget(row, null)).toEqual({ pathname: '/v/[slug]', params: { slug: R34.slug, comments: '1' } });
  });

  it('opens the car’s comments for a mention there too, as the push path /v/{slug}?comments=1 does', () => {
    const row = notification({ type: 'mention', vehicle, details: { update_id: null, comment_id: 'c1', target: 'vehicle' } } as never);
    expect(notificationTarget(row, null)).toEqual({ pathname: '/v/[slug]', params: { slug: R34.slug, comments: '1' } });
    const onUpdate = notification({ type: 'mention', vehicle, details: { update_id: 'update-kw', comment_id: 'c1', target: 'build_update' } } as never);
    expect(notificationTarget(onUpdate, null)).toBe(`/v/${R34.slug}/updates/update-kw`);
  });

  it('opens VEH-05 for a comment on an update, and the build when neither is known', () => {
    const onUpdate = notification({ type: 'comment', vehicle, details: { update_id: 'update-kw', comment_id: 'c1', reply: false } } as never);
    expect(notificationTarget(onUpdate, null)).toBe(`/v/${R34.slug}/updates/update-kw`);
    const gone = notification({ type: 'comment', vehicle, details: { update_id: null, comment_id: 'c1', reply: false } } as never);
    expect(notificationTarget(gone, null)).toBe(`/v/${R34.slug}`);
    expect(notificationTarget(notification({ type: 'comment', vehicle: null } as never), null)).toBeNull();
  });
});
