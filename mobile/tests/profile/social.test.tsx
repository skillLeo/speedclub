/**
 * M2.1 social graph: PROF-02, PROF-04, PROF-05, SET-08, the block dialog and VEH-01's save action, against a fetch stub that
 * answers by method and path.
 */
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { memberKeys, type MemberProfile } from '@/api/queries/social';
import { ConnectionsScreen } from '@/features/profile/screens/ConnectionsScreen';
import { MemberProfileScreen } from '@/features/profile/screens/MemberProfileScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { SavedScreen, savedTarget } from '@/features/profile/screens/SavedScreen';
import { BlockedAccountsScreen } from '@/features/settings/screens/BlockedAccountsScreen';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { VehicleProfile } from '@/features/vehicle/components/VehicleProfile';
import { completeAuthIntent, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import * as toastModule from '@/ui/toast';

import { newQueryClient, renderScreen } from '../settings/harness';
import { flat } from '../ui/helpers';
import { R34 } from '../vehicle/fixtures';

const mockParams: Record<string, string | undefined> = {};
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/u/jann.ptrs',
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({ data, renderItem, ListEmptyComponent, ListHeaderComponent, ListFooterComponent }: {
    data: readonly unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
    ListEmptyComponent?: ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
  }) => (
    <>
      {ListHeaderComponent}
      {data.length === 0 ? ListEmptyComponent : data.map((item, index) => renderItem({ item, index }))}
      {ListFooterComponent}
    </>
  ),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const JANN: MemberProfile = {
  username: 'jann.ptrs',
  display_name: 'Jann Petersen',
  city: 'Hamburg',
  bio: 'Hamburg, M-Autos, viel zu viele Felgenkataloge.',
  avatar: null,
  cover: null,
  member_since: '2024-02-18T10:00:00+00:00',
  stats: { vehicles: 2, followers: 4, following: 5 },
  is_sample: false,
  is_editorial: false,
  is_self: false,
  is_following: false,
  follows_you: true,
  can_message: true,
};

const ROW = (username: string, extra: Partial<{ is_following: boolean; is_self: boolean }> = {}) => ({
  username,
  display_name: null,
  city: 'Berlin',
  avatar: null,
  is_self: false,
  is_following: false,
  ...extra,
});

const PAGE = <T,>(data: T[]) => ({ data, links: { first: null, last: null, prev: null, next: null }, meta: { path: null, per_page: 30, next_cursor: null, prev_cursor: null } });

type Answer = { status?: number; body: unknown };
type Route = Answer | ((request: Request) => Answer);

/** Answers by "METHOD /path-suffix"; anything else is a 404. */
function stub(routes: Record<string, Route>) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = typeof input === 'string' ? new Request(input) : input;
    calls.push(request);
    const path = new URL(request.url).pathname;
    const key = Object.keys(routes).find((candidate) => {
      const [method, suffix] = candidate.split(' ');
      return method === request.method && path.endsWith(suffix ?? '');
    });
    const entry = key ? routes[key] : undefined;
    const answer = typeof entry === 'function' ? entry(request) : (entry ?? { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}

const sent = (calls: Request[], method: string, suffix: string) =>
  calls.filter((call) => call.method === method && new URL(call.url).pathname.endsWith(suffix));

function signIn() {
  useSessionStore.setState({ status: 'member', member: { id: 'me-1', username: 'lukas.sc', displayName: 'Lukas Scholz', avatarUrl: null } });
}

let client: QueryClient;
let toastSpy: jest.SpyInstance;
const render = (element: Parameters<typeof renderScreen>[0]) => renderScreen(element, client);
const text = (testID: string) => screen.getByTestId(testID);

function flags(on: boolean) {
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags: { 'sig.saved_builds': on, collections: on } }, confirmed: true });
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  client = newQueryClient();
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  toastSpy = jest.spyOn(toastModule, 'toast');
  useSessionStore.setState({ status: 'guest', member: null, intent: null, promptOpen: false });
});
afterEach(() => {
  toastSpy.mockRestore();
  client.clear();
});

describe('PROF-02 member profile', () => {
  it('shows the member with "Folgt dir", stats that open PROF-04 and the public garage', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({ 'GET /public/users/jann.ptrs': { body: { data: JANN } }, 'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) } });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.name')).toHaveTextContent('Jann Petersen'));
    expect(text('PROF-02.username')).toHaveTextContent('@jann.ptrs');
    expect(text('PROF-02.followsYou')).toHaveTextContent('Folgt dir');
    expect(text('PROF-02.follow')).toHaveTextContent('Folgen');
    await waitFor(() => expect(text('PROF-02.garage.empty')).toHaveTextContent('Noch keine öffentlichen Fahrzeuge.'));
    // WCAG 2.5.3: each name starts with exactly what is drawn, no-break spaces included.
    expect(screen.getByLabelText('4\u00A0Follower – Liste anzeigen')).toBeTruthy();
    expect(screen.getByLabelText('5\u00A0Gefolgt – Konten anzeigen, denen @jann.ptrs folgt')).toBeTruthy();
    expect(screen.getByLabelText('Folgen – Jann Petersen')).toBeTruthy();
    await fireEvent.press(text('PROF-02.stats.following'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[username]/connections', params: { username: 'jann.ptrs', tab: 'following' } });
  });

  it('follows at once, takes the server count, and turns back with a toast when the server refuses', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    let refuse = false;
    const calls = stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
      'POST /users/jann.ptrs/follow': () =>
        refuse
          ? { status: 429, body: { message: 'Du folgst heute schon sehr vielen Mitgliedern.', code: 'rate_limited', errors: {} } }
          : { body: { data: { username: 'jann.ptrs', is_following: true, followers: 9 } } },
      'DELETE /users/jann.ptrs/follow': { body: { data: { username: 'jann.ptrs', is_following: false, followers: 8 } } },
    });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.follow')).toBeTruthy());
    await act(async () => fireEvent.press(text('PROF-02.follow')));
    expect(text('PROF-02.follow')).toHaveTextContent('Folge ich');
    expect(screen.getByLabelText('Folge ich – Jann Petersen nicht mehr folgen')).toBeTruthy();
    await waitFor(() => expect(text('PROF-02.stats')).toHaveTextContent(/9\sFollower/));
    expect(sent(calls, 'POST', '/users/jann.ptrs/follow')).toHaveLength(1);

    await act(async () => fireEvent.press(text('PROF-02.follow')));
    await waitFor(() => expect(sent(calls, 'DELETE', '/users/jann.ptrs/follow')).toHaveLength(1));
    await waitFor(() => expect(text('PROF-02.follow')).toHaveTextContent('Folgen'));

    refuse = true;
    await act(async () => fireEvent.press(text('PROF-02.follow')));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Du folgst heute schon sehr vielen Mitgliedern.', expect.objectContaining({ haptic: 'warning' })));
    expect(text('PROF-02.follow')).toHaveTextContent('Folgen');
    expect(text('PROF-02.stats')).toHaveTextContent(/8\sFollower/);
  });

  it('asks a guest to sign in for Folgen and Nachricht, and follows once after sign-in', async () => {
    mockParams.username = 'jann.ptrs';
    const calls = stub({
      'GET /public/users/jann.ptrs': () => ({ body: { data: { ...JANN, follows_you: false, can_message: useSessionStore.getState().status === 'member' } } }),
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
      'POST /users/jann.ptrs/follow': { body: { data: { username: 'jann.ptrs', is_following: true, followers: 5 } } },
    });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.follow')).toBeTruthy());
    expect(screen.queryByTestId('PROF-02.messageHelper')).toBeNull();
    await fireEvent.press(text('PROF-02.message'));
    expect(useSessionStore.getState()).toMatchObject({ promptOpen: true, intent: { returnTo: '/u/jann.ptrs' } });
    await act(() => useSessionStore.setState({ promptOpen: false, intent: null }));
    await fireEvent.press(text('PROF-02.follow'));
    expect(sent(calls, 'POST', '/follow')).toHaveLength(0);
    // Sign-in, then what SessionHost does: run the stored action and go back to the page.
    await act(async () => signIn());
    let returnTo: string | undefined;
    await act(async () => {
      returnTo = completeAuthIntent();
    });
    expect(returnTo).toBe('/u/jann.ptrs');
    await waitFor(() => expect(text('PROF-02.follow')).toHaveTextContent('Folge ich'));
    await waitFor(() => expect(sent(calls, 'POST', '/users/jann.ptrs/follow')).toHaveLength(1));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('sends no follow when the guest who asked signs in as this very member, and opens PROF-01', async () => {
    mockParams.username = 'jann.ptrs';
    const calls = stub({
      'GET /public/users/jann.ptrs': () => ({ body: { data: { ...JANN, is_self: useSessionStore.getState().status === 'member' } } }),
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
    });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.follow')).toBeTruthy());
    await fireEvent.press(text('PROF-02.follow'));
    await act(async () =>
      useSessionStore.setState({ status: 'member', member: { id: 'jann-1', username: 'jann.ptrs', displayName: 'Jann Petersen', avatarUrl: null } }),
    );
    await act(async () => {
      completeAuthIntent();
    });
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith('/profile'));
    expect(sent(calls, 'POST', '/follow')).toHaveLength(0);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('offers a member Nachricht off with the reason when the other member does not take messages (M2.4)', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({ 'GET /public/users/jann.ptrs': { body: { data: { ...JANN, can_message: false } } }, 'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) } });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.follow')).toBeTruthy());
    expect(text('PROF-02.message')).toBeDisabled();
    expect(text('PROF-02.messageHelper')).toHaveTextContent('@jann.ptrs nimmt gerade keine Nachrichten von dir an.');
    expect(text('PROF-02.more')).toBeTruthy();
  });

  it('opens MSG-03 for the member from Nachricht, which goes straight to an existing thread (M2.4)', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({ 'GET /public/users/jann.ptrs': { body: { data: { ...JANN, can_message: true } } }, 'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) } });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.message')).toBeTruthy());
    expect(screen.queryByTestId('PROF-02.messageHelper')).toBeNull();
    await fireEvent.press(text('PROF-02.message'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/new-message', params: { to: 'jann.ptrs' } });
  });

  it('leaves your own name for PROF-01 from any stack, with a real state meanwhile, and follows an old name to the current one', async () => {
    signIn();
    mockParams.username = 'lukas.sc';
    stub({ 'GET /public/users/lukas.sc': { body: { data: { ...JANN, username: 'lukas.sc', display_name: 'Lukas Scholz', is_self: true } } } });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith('/profile'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(text('PROF-02.name')).toHaveTextContent('Lukas Scholz');
    expect(text('PROF-02.self')).toHaveTextContent('Zu deinem Profil');
    expect(screen.queryByTestId('PROF-02.skeleton')).toBeNull();
    expect(screen.queryByTestId('PROF-02.follow')).toBeNull();

    client.clear();
    mockParams.username = 'jann.old';
    stub({ 'GET /public/users/jann.old': { body: { data: JANN } }, 'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) } });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledWith({ username: 'jann.ptrs' }));
  });

  it('replaces a cold link to your own name that has nothing below it', async () => {
    signIn();
    mockParams.username = 'lukas.sc';
    mockRouter.canGoBack.mockReturnValue(false);
    try {
      stub({ 'GET /public/users/lukas.sc': { body: { data: { ...JANN, username: 'lukas.sc', is_self: true } } } });
      await render(<MemberProfileScreen />);
      await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/profile'));
      expect(mockRouter.back).not.toHaveBeenCalled();
      expect(text('PROF-02.self')).toBeTruthy();
    } finally {
      mockRouter.canGoBack.mockReturnValue(true);
    }
  });

  it('shows one calm state for a hidden member, whatever the reason', async () => {
    mockParams.username = 'nina.neu';
    stub({ 'GET /public/users/nina.neu': { status: 404, body: { message: 'Nicht gefunden', code: 'member_unavailable', errors: {} } } });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.unavailable')).toHaveTextContent(/Profil nicht verfügbar/));
    await fireEvent.press(text('PROF-02.unavailable.action'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/discover');
  });

  it('blocks from the more sheet: confirm, back, toast, and every list asked again', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    const calls = stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
      'POST /users/jann.ptrs/block': { body: { data: { username: 'jann.ptrs', is_blocked: true } } },
    });
    client.setQueryData(['home', 'me-1|de', 'featured'], []);
    const jannsBuild = ['public-vehicle', 'f3pqxpjb', 'me-1|de', 'page'];
    const jannsMod = ['public-vehicle', 'f3pqxpjb', 'me-1|de', 'mod', 'm1'];
    const otherBuild = ['public-vehicle', '5tf974vj', 'me-1|de', 'page'];
    client.setQueryData(jannsBuild, { ...R34, owner: { ...R34.owner, username: 'jann.ptrs' } });
    client.setQueryData(jannsMod, {});
    client.setQueryData(otherBuild, R34);
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.more')).toBeTruthy());
    await fireEvent.press(text('PROF-02.more'));
    await fireEvent.press(text('PROF-02.moreSheet.block'));
    await waitFor(() => expect(text('PROF-02.blockDialog')).toBeTruthy());
    expect(screen.getByText('@jann.ptrs blockieren?')).toBeTruthy();
    await act(async () => fireEvent.press(text('PROF-02.blockDialog.confirm')));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(sent(calls, 'POST', '/users/jann.ptrs/block')).toHaveLength(1);
    expect(toastSpy).toHaveBeenCalledWith('@jann.ptrs ist blockiert', expect.anything());
    expect(client.getQueryState(['home', 'me-1|de', 'featured'])?.isInvalidated).toBe(true);
    // The page on screen is not asked again on its way out, and keeps what it showed.
    expect(sent(calls, 'GET', '/public/users/jann.ptrs')).toHaveLength(1);
    expect(text('PROF-02.name')).toHaveTextContent('Jann Petersen');
    // No copy of the member or their builds is left for a later visit or an offline start; other builds stay.
    expect(client.getQueryData(memberKeys.profile('jann.ptrs', 'me-1|de'))).toBeUndefined();
    expect(client.getQueryData(jannsBuild)).toBeUndefined();
    expect(client.getQueryData(jannsMod)).toBeUndefined();
    expect(client.getQueryData(otherBuild)).toBeDefined();
  });

  it('keeps the dialog open and says so when the block fails', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/vehicles': { body: PAGE([]) },
      'POST /users/jann.ptrs/block': { status: 500, body: { message: 'Serverfehler', code: 'server_error', errors: {} } },
    });
    await render(<MemberProfileScreen />);
    await waitFor(() => expect(text('PROF-02.more')).toBeTruthy());
    await fireEvent.press(text('PROF-02.more'));
    await fireEvent.press(text('PROF-02.moreSheet.block'));
    await act(async () => fireEvent.press(text('PROF-02.blockDialog.confirm')));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Serverfehler', expect.objectContaining({ haptic: 'warning' })));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(text('PROF-02.blockDialog')).toBeTruthy();
  });
});

describe('PROF-04 connections', () => {
  it('lists the followers of a member with Folgen per row, and your own row without', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    const calls = stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/followers': { body: PAGE([ROW('max.e46'), ROW('lukas.sc', { is_self: true }), ROW('sara.gti', { is_following: true })]) },
      'POST /users/max.e46/follow': { body: { data: { username: 'max.e46', is_following: true, followers: 3 } } },
    });
    const maxFollowers = memberKeys.connections('max.e46', 'me-1|de', 'followers', '');
    client.setQueryData(maxFollowers, { pages: [PAGE([])], pageParams: [null] });
    await render(<ConnectionsScreen />);
    await waitFor(() => expect(text('PROF-04.row.max.e46')).toBeTruthy());
    expect(text('PROF-04.tabs')).toHaveTextContent(/Follower \(4\)/);
    // Another member's second list is "Gefolgt", never "Folge ich" (DQ-266).
    expect(text('PROF-04.tabs')).toHaveTextContent(/Gefolgt \(5\)/);
    expect(text('PROF-04.tabs')).not.toHaveTextContent(/Folge ich/);
    expect(text('PROF-04.row.sara.gti.follow')).toHaveTextContent('Folge ich');
    expect(screen.queryByTestId('PROF-04.row.lukas.sc.follow')).toBeNull();
    expect(text('PROF-04.row.lukas.sc')).toHaveTextContent(/@lukas\.\u200B?sc · Du/);
    await act(async () => fireEvent.press(text('PROF-04.row.max.e46.follow')));
    await waitFor(() => expect(text('PROF-04.row.max.e46.follow')).toHaveTextContent('Folge ich'));
    await waitFor(() => expect(sent(calls, 'POST', '/users/max.e46/follow')).toHaveLength(1));
    // The followed member's own Follower list is read again.
    await waitFor(() => expect(client.getQueryState(maxFollowers)?.isInvalidated).toBe(true));
    await fireEvent.press(text('PROF-04.row.max.e46.body'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[username]', params: { username: 'max.e46' } });
  });

  it('draws the scroll line under the fixed tabs and search, not between them and the header (DQ-263)', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({ 'GET /public/users/jann.ptrs': { body: { data: JANN } }, 'GET /public/users/jann.ptrs/followers': { body: PAGE([ROW('max.e46')]) } });
    await render(<ConnectionsScreen />);
    await waitFor(() => expect(text('PROF-04.row.max.e46')).toBeTruthy());
    expect(screen.getByTestId('PROF-04.top.hairline', { includeHiddenElements: true })).toBeTruthy();
    // The header keeps its line off: with the band under it, both are fixed chrome.
    expect(screen.getByTestId('PROF-04.header.hairline', { includeHiddenElements: true })).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('shows the handle once for a member without a display name: the meta keeps the city alone (DQ-277)', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({
      'GET /public/users/jann.ptrs': { body: { data: JANN } },
      'GET /public/users/jann.ptrs/followers': { body: PAGE([ROW('smw74cfewsfbf810'), { ...ROW('marco.amg'), display_name: 'Marco Bianchi' }]) },
    });
    await render(<ConnectionsScreen />);
    await waitFor(() => expect(text('PROF-04.row.smw74cfewsfbf810')).toBeTruthy());
    expect(text('PROF-04.row.smw74cfewsfbf810.body')).toHaveTextContent(/^S@smw74cfewsfbf810Berlin$/);
    expect(text('PROF-04.row.marco.amg.body')).toHaveTextContent(/^MBMarco Bianchi@marco\.\u200B?amg\s·\sBerlin$/);
  });

  it('puts the loading rows exactly where the rows will be, without the gap of the other states (DQ-276)', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await render(<ConnectionsScreen />);
    await waitFor(() => expect(text('PROF-04.skeleton')).toBeTruthy());
    const wrapper = text('PROF-04.skeleton').parent;
    expect(flat(wrapper?.props.style).paddingTop).toBeUndefined();
  });

  it('keeps the gap above an empty list, as before', async () => {
    signIn();
    mockParams.username = 'jann.ptrs';
    stub({ 'GET /public/users/jann.ptrs': { body: { data: JANN } }, 'GET /public/users/jann.ptrs/followers': { body: PAGE([]) } });
    await render(<ConnectionsScreen />);
    await waitFor(() => expect(text('PROF-04.empty')).toBeTruthy());
    expect(flat(text('PROF-04.empty').parent?.props.style).paddingTop).toBe(32);
  });

  it('removes one of your own followers behind a confirm, and the row goes at once', async () => {
    signIn();
    mockParams.tab = 'followers';
    const calls = stub({
      'GET /auth/me': { body: { data: null } },
      'GET /public/users/lukas.sc/followers': { body: PAGE([ROW('max.e46'), ROW('sara.gti')]) },
      'DELETE /me/followers/max.e46': { body: { data: { username: 'max.e46', follows_you: false } } },
    });
    await render(<ConnectionsScreen own />);
    await waitFor(() => expect(text('PROF-04.row.max.e46.remove')).toHaveTextContent('Entfernen'));
    await fireEvent.press(text('PROF-04.row.max.e46.remove'));
    expect(screen.getByText('@max.e46 als Follower entfernen?')).toBeTruthy();
    await act(async () => fireEvent.press(text('PROF-04.removeDialog.confirm')));
    await waitFor(() => expect(screen.queryByTestId('PROF-04.row.max.e46')).toBeNull());
    expect(text('PROF-04.row.sara.gti')).toBeTruthy();
    await waitFor(() => expect(sent(calls, 'DELETE', '/me/followers/max.e46')).toHaveLength(1));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('@max.e46 folgt dir nicht mehr', expect.anything()));
  });

  it('searches after typing settles and says when nothing matches', async () => {
    jest.useFakeTimers();
    try {
      signIn();
      mockParams.username = 'jann.ptrs';
      mockParams.tab = 'following';
      const calls = stub({
        'GET /public/users/jann.ptrs': { body: { data: JANN } },
        'GET /public/users/jann.ptrs/following': (request) =>
          ({ body: PAGE(new URL(request.url).searchParams.get('q') ? [] : [ROW('max.e46')]) }),
      });
      await render(<ConnectionsScreen />);
      await waitFor(() => expect(text('PROF-04.row.max.e46')).toBeTruthy());
      await fireEvent.changeText(text('PROF-04.search'), '  zz  top ');
      await act(async () => jest.advanceTimersByTime(300));
      await waitFor(() => expect(text('PROF-04.noResults')).toHaveTextContent(/Keine Treffer für „zz top“/));
      const last = sent(calls, 'GET', '/following').at(-1);
      expect(new URL(last!.url).searchParams.get('q')).toBe('zz top');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the empty state of your own Folge ich tab with a way to Discover', async () => {
    signIn();
    mockParams.tab = 'following';
    stub({ 'GET /auth/me': { body: { data: null } }, 'GET /public/users/lukas.sc/following': { body: PAGE([]) } });
    await render(<ConnectionsScreen own />);
    await waitFor(() => expect(text('PROF-04.empty')).toHaveTextContent(/Du folgst noch niemandem/));
    await fireEvent.press(text('PROF-04.empty.action'));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/discover');
  });

  it('shows "Profil nicht verfügbar" when the member is hidden', async () => {
    mockParams.username = 'nina.neu';
    stub({});
    await render(<ConnectionsScreen />);
    await waitFor(() => expect(text('PROF-04.unavailable')).toBeTruthy());
    expect(screen.queryByTestId('PROF-04.search')).toBeNull();
  });
});

describe('SET-08 blocked accounts', () => {
  it('lists blocks and unblocks one behind a confirm', async () => {
    signIn();
    const calls = stub({
      // Contract after review: the name as sent when blocking, and the date. Nothing live of the member.
      'GET /me/blocks': { body: PAGE([{ username: 'nina.neu', blocked_at: '2026-11-08T10:00:00+01:00' }]) },
      'DELETE /users/nina.neu/block': { body: { data: { username: 'nina.neu', is_blocked: false } } },
    });
    await render(<BlockedAccountsScreen />);
    await waitFor(() => expect(text('SET-08.row.nina.neu')).toHaveTextContent(/^NN@nina\.\u200B?neuBlockiert am 08\.11\.2026Freigeben$/));
    await fireEvent.press(text('SET-08.row.nina.neu.unblock'));
    expect(screen.getByText('@nina.neu freigeben?')).toBeTruthy();
    await act(async () => fireEvent.press(text('SET-08.dialog.confirm')));
    await waitFor(() => expect(sent(calls, 'DELETE', '/users/nina.neu/block')).toHaveLength(1));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('@nina.neu ist freigegeben', expect.anything()));
  });

  it('says when nobody is blocked', async () => {
    signIn();
    stub({ 'GET /me/blocks': { body: PAGE([]) } });
    await render(<BlockedAccountsScreen />);
    await waitFor(() => expect(text('SET-08.empty')).toHaveTextContent(/Du hast niemanden blockiert/));
  });
});

describe('PROF-05 saved builds [SIG]', () => {
  it('does not exist without the flag', async () => {
    signIn();
    stub({});
    flags(false);
    await render(<SavedScreen />);
    expect(text('SYS-03.screen')).toBeTruthy();
  });

  it('opens the "Gespeichert" collection instead of a list of its own (DQ-1087)', async () => {
    signIn();
    flags(true);
    const saved = { id: 'k0', name: 'Gespeichert', is_default: true, position: 1, items_count: 1, covers: [], contains: null, created_at: null, updated_at: null };
    const other = { ...saved, id: 'k1', name: 'JDM', is_default: false, position: 2 };
    stub({ 'GET /me/collections': { body: { data: [other, saved] } } });
    await render(<SavedScreen />);
    expect(text('PROF-05.skeleton')).toBeTruthy();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/profile/collections/k0'));
    expect(screen.queryByTestId(/^PROF-05\.card\./)).toBeNull();
  });

  it('leads to the collections without a default one, and a guest there too', async () => {
    expect(savedTarget('member', [])).toBe('/profile/collections');
    expect(savedTarget('guest', undefined)).toBe('/profile/collections');
    expect(savedTarget('loading', undefined)).toBeNull();
    expect(savedTarget('member', undefined)).toBeNull();
  });
});

describe('VEH-01 save action [SIG]', () => {
  it('saves at once for a member and turns back when the server refuses', async () => {
    signIn();
    flags(true);
    const calls = stub({ 'POST /save': { status: 404, body: { message: 'Dieses Fahrzeug ist nicht verfügbar.', code: 'vehicle_unavailable', errors: {} } } });
    const viewer = 'me-1|de';
    client.setQueryData(['public-vehicle', '5tf974vj', viewer, 'page'], { ...R34, is_saved: false });
    await render(<VehicleProfile vehicle={{ ...R34, is_saved: false }} onBack={jest.fn()} />);
    expect(text('VEH-01.save')).toBeTruthy();
    await act(async () => fireEvent.press(text('VEH-01.save')));
    await waitFor(() => expect(sent(calls, 'POST', `/vehicles/${R34.id}/save`)).toHaveLength(1));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Dieses Fahrzeug ist nicht verfügbar.', expect.objectContaining({ haptic: 'warning' })));
    expect(client.getQueryData<{ is_saved: boolean }>(['public-vehicle', '5tf974vj', viewer, 'page'])?.is_saved).toBe(false);
  });

  it('has no save action on your own build, nor without the flag', async () => {
    signIn();
    flags(true);
    stub({});
    await render(<VehicleProfile vehicle={{ ...R34, is_owner: true, is_saved: null }} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.save')).toBeNull();
    flags(false);
    await render(<VehicleProfile vehicle={{ ...R34, is_saved: false }} onBack={jest.fn()} />);
    expect(screen.queryByTestId('VEH-01.save')).toBeNull();
  });

  it('saves after sign-in what the guest asked for, once', async () => {
    flags(true);
    const calls = stub({
      [`GET /public/vehicles/${R34.slug}`]: { body: { data: { ...R34, is_saved: false } } },
      [`POST /vehicles/${R34.id}/save`]: { body: { data: { vehicle_id: R34.id, is_saved: true } } },
    });
    await render(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.save'));
    expect(sent(calls, 'POST', '/save')).toHaveLength(0);
    await act(async () => signIn());
    await act(async () => {
      completeAuthIntent();
    });
    await waitFor(() => expect(sent(calls, 'POST', `/vehicles/${R34.id}/save`)).toHaveLength(1));
  });

  it('sends no save after sign-in when the build turns out to be your own', async () => {
    flags(true);
    const calls = stub({ [`GET /public/vehicles/${R34.slug}`]: { body: { data: { ...R34, is_owner: true, is_saved: null } } } });
    await render(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.save'));
    await act(async () => signIn());
    await act(async () => {
      completeAuthIntent();
    });
    await waitFor(() => expect(sent(calls, 'GET', `/public/vehicles/${R34.slug}`)).toHaveLength(1));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(sent(calls, 'POST', '/save')).toHaveLength(0);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('asks a guest to sign in, and opens the owner profile from the owner row', async () => {
    flags(true);
    stub({});
    await render(<VehicleProfile vehicle={R34} onBack={jest.fn()} />);
    await fireEvent.press(text('VEH-01.save'));
    expect(useSessionStore.getState().promptOpen).toBe(true);
    await fireEvent.press(text('VEH-01.ownerRow.identity'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/u/[username]', params: { username: 'lukas.sc' } });
  });
});

describe('entry points', () => {
  it('PROF-01 links its stats to PROF-04 and lists Gespeichert with the flag', async () => {
    signIn();
    flags(true);
    const me = {
      id: 'me-1', email: 'lukas.sc@speedclub.test', email_verified: true, has_username: true, profile_complete: true, next_step: null,
      force_password_change: false, username: 'lukas.sc', username_change_available_at: null, display_name: 'Lukas Scholz', city: 'Stuttgart',
      bio: null, avatar: null, cover: null, locale: 'de', theme: 'carbon', power_display: 'ps_kw', member_since: '2023-03-12T10:00:00+00:00',
      stats: { vehicles: 0, followers: 5, following: 3 },
      restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } },
    };
    const saved = { id: 'k0', name: 'Gespeichert', is_default: true, position: 1, items_count: 1, covers: [], contains: null, created_at: null, updated_at: null };
    stub({ 'GET /auth/me': { body: { data: me } }, 'GET /me/vehicles': { body: { data: [] } }, 'GET /me/collections': { body: { data: [saved] } } });
    await render(<ProfileScreen />);
    await waitFor(() => expect(text('PROF-01.stats.followers')).toBeTruthy());
    expect(screen.getByLabelText('3\u00A0Folge\u00A0ich – Konten anzeigen, denen du folgst')).toBeTruthy();
    expect(screen.getByLabelText('5\u00A0Follower – Liste anzeigen')).toBeTruthy();
    await fireEvent.press(text('PROF-01.stats.followers'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/profile/connections', params: { tab: 'followers' } });
    // 09 §7.7: Gespeichert is the profile's fourth tab: the collections (COL-01), "Gespeichert" among them (DQ-1087/1094).
    await fireEvent.press(text('PROF-01.tabs.saved'));
    expect(screen.queryByTestId('PROF-01.saved')).toBeNull();
    await waitFor(() => expect(text('PROF-01.collection.k0')).toBeTruthy());
    await fireEvent.press(text('PROF-01.collection.k0'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/collections/k0');
  });

  it('SET-01 leads a member to the blocked accounts, and shows a guest no such row', async () => {
    stub({});
    await render(<SettingsScreen />);
    expect(screen.queryByTestId('SET-01.blocked')).toBeNull();
    signIn();
    await render(<SettingsScreen />);
    await fireEvent.press(text('SET-01.blocked.body'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/privacy/blocked');
  });
});

describe('cache keys', () => {
  it('keeps one key per member whatever the case of the name', () => {
    expect(memberKeys.profile('Jann.Ptrs', 'v')).toEqual(memberKeys.profile('jann.ptrs', 'v'));
  });
});
