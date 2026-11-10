/** M3.2 view-as (m3.2-contract §3): token intake and cleanup, the client's refusals, the end. */
import { createApiClient, apiData, ApiError } from '@/api/client';
import { isViewAsTab, setViewAsTab, viewAsRefusalFor, viewAsToken, VIEW_AS_STORAGE_KEY } from '@/api/clientViewAs';
import { meKey, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import {
  adoptViewAsMember,
  endViewAs,
  intakeViewAs,
  readViewAsFragment,
  resetViewAsForTests,
  useViewAsStore,
  type ViewAsWindow,
} from '@/features/viewAs/viewAsSession';
import { useSessionStore } from '@/state/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const TOKEN = '41|Zb8kQ2rVt6YpLm3NcXw9HsAe1JdFgUo5RiTqKy7B';

function fakeWindow(hash: string, stored: string | null = null) {
  const session = new Map<string, string>(stored === null ? [] : [[VIEW_AS_STORAGE_KEY, stored]]);
  const replaceState = jest.fn();
  const win: ViewAsWindow = {
    location: { hash, pathname: '/app/garage', search: '?qaTheme=carbon' },
    history: { state: { key: 'k' }, replaceState },
    sessionStorage: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => void session.set(key, value),
      removeItem: (key) => void session.delete(key),
    },
  };
  return { win, session, replaceState };
}

const ME = { id: '01m6f7ztzfs0gd39t08rs9zmmp', username: 'lukas.sc', display_name: 'Lukas', avatar: null, cover: null, next_step: null } as unknown as Me;

afterEach(() => {
  resetViewAsForTests();
  useSessionStore.setState({ status: 'guest', member: null });
  queryClient.clear();
});

describe('readViewAsFragment', () => {
  it('takes one well-formed token and a printable staff name', () => {
    expect(readViewAsFragment(`#view_as=${encodeURIComponent(TOKEN)}&staff=Mara%20Klein`)).toEqual({ token: TOKEN, staff: 'Mara Klein' });
    expect(readViewAsFragment(`#view_as=${encodeURIComponent(TOKEN)}`)).toEqual({ token: TOKEN, staff: null });
  });

  it('refuses a malformed or doubled token, and drops a staff name with control characters', () => {
    expect(readViewAsFragment('#view_as=abc')).toBeNull();
    expect(readViewAsFragment(`#view_as=${TOKEN}&view_as=${TOKEN}`)).toBeNull();
    expect(readViewAsFragment(`#view_as=${TOKEN}&staff=Mara%0AKlein`)).toEqual({ token: TOKEN, staff: null });
  });
});

describe('intakeViewAs', () => {
  it('drops the fragment at once and keeps the token in sessionStorage only', () => {
    const { win, session, replaceState } = fakeWindow(`#view_as=${encodeURIComponent(TOKEN)}&staff=Mara`);
    const local = jest.spyOn(Storage.prototype, 'setItem');
    intakeViewAs(win);
    expect(replaceState).toHaveBeenCalledWith({ key: 'k' }, '', '/app/garage?qaTheme=carbon');
    expect(JSON.parse(session.get(VIEW_AS_STORAGE_KEY) ?? '{}')).toEqual({ token: TOKEN, staff: 'Mara' });
    expect(local).not.toHaveBeenCalled();
    expect(isViewAsTab()).toBe(true);
    expect(viewAsToken()).toBe(TOKEN);
    expect(useViewAsStore.getState()).toMatchObject({ status: 'starting', staff: 'Mara' });
    local.mockRestore();
  });

  it('a reload of the tab stays in the view; an ended view stays ended', () => {
    intakeViewAs(fakeWindow('', JSON.stringify({ token: TOKEN, staff: 'Mara' })).win);
    expect(viewAsToken()).toBe(TOKEN);
    resetViewAsForTests();
    intakeViewAs(fakeWindow('', JSON.stringify({ ended: 'expired' })).win);
    expect(isViewAsTab()).toBe(true);
    expect(viewAsToken()).toBeNull();
    expect(useViewAsStore.getState()).toMatchObject({ status: 'ended', reason: 'expired' });
  });

  it('a normal tab, or a fragment without a usable token, is no view-as (the fragment still goes)', () => {
    intakeViewAs(fakeWindow('#section=4').win);
    expect(isViewAsTab()).toBe(false);
    const { win, replaceState } = fakeWindow('#view_as=nope');
    intakeViewAs(win);
    expect(replaceState).toHaveBeenCalled();
    expect(isViewAsTab()).toBe(false);
  });
});

describe('the client in a view-as tab', () => {
  function client() {
    const fetchMock = jest.fn(async (_request: Request) => new Response(JSON.stringify({ data: ME }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = createApiClient({ origin: 'https://speedclub.test', cookieAuth: true, fetch: fetchMock, getCookies: () => 'XSRF-TOKEN=x' });
    return { api, fetchMock };
  }

  beforeEach(() => setViewAsTab('active', TOKEN));

  it('reads with the token as Bearer and without any cookie', async () => {
    const { api, fetchMock } = client();
    await apiData(api.GET('/auth/me'));
    const sent = fetchMock.mock.calls[0]?.[0] as Request;
    expect(sent.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(sent.credentials).toBe('omit');
    expect(sent.headers.get('X-XSRF-TOKEN')).toBeNull();
  });

  it('refuses every write but its own end, and every message route, before anything is sent', async () => {
    const { api, fetchMock } = client();
    await expect(apiData(api.POST('/users/{username}/follow', { params: { path: { username: 'paul.roadster' } } }))).rejects.toMatchObject({
      code: 'view_as_read_only',
      status: 403,
      message: 'In der Ansicht als Mitglied kannst du nichts ändern.',
    });
    await expect(apiData(api.GET('/conversations'))).rejects.toMatchObject({ code: 'view_as_no_messages' });
    await expect(apiData(api.GET('/notifications/unread-count'))).rejects.toMatchObject({ code: 'view_as_no_messages' });
    await expect(apiData(api.GET('/me/exports'))).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
    await apiData(api.DELETE('/view-as'));
    expect((fetchMock.mock.calls[0]?.[0] as Request).method).toBe('DELETE');
  });

  it('knows the refusals of RestrictViewAs', () => {
    expect(viewAsRefusalFor('GET', '/vehicles/{vehicle}')).toBeNull();
    expect(viewAsRefusalFor('HEAD', '/me')).toBeNull();
    expect(viewAsRefusalFor('PATCH', '/me/settings')).toBe('view_as_read_only');
    expect(viewAsRefusalFor('DELETE', '/me/sessions')).toBe('view_as_read_only');
    expect(viewAsRefusalFor('DELETE', '/view-as')).toBeNull();
    expect(viewAsRefusalFor('GET', '/messages/search')).toBe('view_as_no_messages');
    expect(viewAsRefusalFor('POST', '/broadcasting/auth')).toBe('view_as_no_messages');
    expect(viewAsRefusalFor('GET', '/chat-media/{media}/{width}')).toBe('view_as_no_messages');
    expect(viewAsRefusalFor('POST', '/me/export')).toBe('view_as_no_messages');
    expect(viewAsRefusalFor('GET', '/notifications')).toBeNull();
  });
});

describe('adopting and ending', () => {
  it('signs in as the member in memory only: no sc.sessionMember, no stored cache', async () => {
    intakeViewAs(fakeWindow(`#view_as=${encodeURIComponent(TOKEN)}`).win);
    const local = jest.spyOn(Storage.prototype, 'setItem');
    adoptViewAsMember(ME);
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member: { id: ME.id, username: 'lukas.sc' } });
    expect(useViewAsStore.getState()).toMatchObject({ status: 'active', username: 'lukas.sc' });
    expect(queryClient.getQueryData(meKey)).toBe(ME);
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it('"Beenden" revokes the token, forgets it, drops the data and leaves the tab ended; once', async () => {
    const { win, session } = fakeWindow(`#view_as=${encodeURIComponent(TOKEN)}`);
    intakeViewAs(win);
    adoptViewAsMember(ME);
    const fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await Promise.all([endViewAs('ended'), endViewAs('ended')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = (fetchMock.mock.calls[0] as unknown as [Request])[0];
    expect(sent.method).toBe('DELETE');
    expect(new URL(sent.url).pathname).toBe('/api/v1/view-as');
    expect(viewAsToken()).toBeNull();
    expect(JSON.parse(session.get(VIEW_AS_STORAGE_KEY) ?? '{}')).toEqual({ ended: 'ended' });
    expect(queryClient.getQueryData(meKey)).toBeUndefined();
    expect(useSessionStore.getState()).toMatchObject({ status: 'guest', member: null });
    expect(useViewAsStore.getState()).toMatchObject({ status: 'ended', reason: 'ended' });
    await endViewAs('expired');
    expect(useViewAsStore.getState().reason).toBe('ended');
  });

  it('at expiry nothing is sent: the server already refuses the token', async () => {
    intakeViewAs(fakeWindow(`#view_as=${encodeURIComponent(TOKEN)}`).win);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await endViewAs('expired');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useViewAsStore.getState()).toMatchObject({ status: 'ended', reason: 'expired' });
  });

  it('does nothing in a normal tab', async () => {
    await endViewAs('ended');
    expect(useViewAsStore.getState().status).toBe('off');
  });
});
