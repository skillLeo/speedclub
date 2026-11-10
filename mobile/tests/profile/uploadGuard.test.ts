/**
 * SEC-S-02, web: the XHR uploads (profile images here, garage photos through the same uploadHeaders) follow the API client's rules.
 * A tab that missed another tab's sign-in refuses and reloads, a guest sends nothing, and only a member's upload carries the cookie.
 */
import { waitFor } from '@testing-library/react-native';

import { sendsSessionCookie } from '@/api/client';
import { uploadProfileImage } from '@/api/queries/profile';
import { setGuest, setMember } from '@/state/session';

jest.mock('@/lib/platform', () => ({ isWeb: true, isNative: false, isIOS: false, isAndroid: false }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

class FakeXhr {
  static sent: FakeXhr[] = [];
  withCredentials = false;
  headers: Record<string, string> = {};
  status = 0;
  responseText = '';
  upload = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  abort() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader() {
    return null;
  }
  send() {
    FakeXhr.sent.push(this);
  }
}

const LUKAS = { id: '01LUKAS', username: 'lukas.sc', displayName: null, avatarUrl: null };
const ME = { id: LUKAS.id, username: LUKAS.username };
let stored: string | null = null;
let reload: jest.Mock;

beforeAll(() => {
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  globalThis.fetch = jest.fn(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
});
beforeEach(() => {
  FakeXhr.sent = [];
  stored = null;
  reload = jest.fn();
  const host = globalThis.window as unknown as Record<string, unknown>;
  host.location = { reload };
  Object.defineProperty(host, 'localStorage', { configurable: true, value: { getItem: () => stored } });
  // The XSRF cookie is there, so no request for one goes out first.
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'XSRF-TOKEN=xsrf-1' } });
});
afterAll(() => {
  const host = globalThis.window as unknown as Record<string, unknown>;
  delete host.location;
  delete host.localStorage;
});

it('sends a member’s upload with the cookie and the XSRF header', async () => {
  setMember(LUKAS);
  stored = JSON.stringify(LUKAS);
  void uploadProfileImage('avatar', new FormData(), 'pick-1', jest.fn()).catch(() => undefined);
  await waitFor(() => expect(FakeXhr.sent).toHaveLength(1));
  expect(FakeXhr.sent[0]!.withCredentials).toBe(true);
  expect(FakeXhr.sent[0]!.headers['X-XSRF-TOKEN']).toBe('xsrf-1');
  expect(sendsSessionCookie()).toBe(true);
  FakeXhr.sent[0]!.status = 200;
  FakeXhr.sent[0]!.responseText = JSON.stringify({ data: ME });
  FakeXhr.sent[0]!.onload?.();
});

it('refuses and reloads when another tab signed in as somebody else, with its own error', async () => {
  setMember(LUKAS);
  stored = JSON.stringify({ ...LUKAS, id: '01NINA' });
  await expect(uploadProfileImage('cover', new FormData(), 'pick-2', jest.fn())).rejects.toMatchObject({ kind: 'session_moved' });
  expect(FakeXhr.sent).toEqual([]);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('refuses for a guest, and reloads only when another tab signed somebody in', async () => {
  setGuest();
  expect(sendsSessionCookie()).toBe(false);
  await expect(uploadProfileImage('avatar', new FormData(), 'pick-3', jest.fn())).rejects.toMatchObject({ kind: 'unauthenticated' });
  expect(reload).not.toHaveBeenCalled();

  stored = JSON.stringify(LUKAS);
  await expect(uploadProfileImage('avatar', new FormData(), 'pick-4', jest.fn())).rejects.toMatchObject({ kind: 'session_moved' });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(FakeXhr.sent).toEqual([]);
});
