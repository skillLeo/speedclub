import { waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { uploadProfileImage } from '@/api/queries/profile';
import { abortSessionRequests, useSessionStore } from '@/state/session';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('device-token')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

type ProgressEventLike = { lengthComputable: boolean; loaded: number; total: number };

class FakeXhr {
  static sent: FakeXhr[] = [];
  method = '';
  url = '';
  withCredentials = false;
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = '';
  responseHeaders: Record<string, string> = {};
  upload: { onprogress: ((event: ProgressEventLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.sent.push(this);
  }
  respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders = headers;
    this.onload?.();
  }
}

const ME = { id: '01m6f7ztzfs0gd39t08rs9zmmp', username: 'lukas.sc' };

beforeAll(() => {
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
});
beforeEach(() => {
  FakeXhr.sent = [];
  useSessionStore.setState({ status: 'member', member: { id: ME.id, username: ME.username, displayName: null, avatarUrl: null } });
});

async function sent(): Promise<FakeXhr> {
  await waitFor(() => expect(FakeXhr.sent).toHaveLength(1));
  return FakeXhr.sent[0]!;
}

describe('uploadProfileImage', () => {
  it('posts the form with the device token, the idempotency key and progress', async () => {
    const form = new FormData();
    const progress = jest.fn();
    const result = uploadProfileImage('cover', form, 'pick-1', progress);
    const request = await sent();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://speedclub.test/api/v1/me/cover');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer device-token', 'Idempotency-Key': 'pick-1', Accept: 'application/json' });
    expect(request.body).toBe(form);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    expect(progress.mock.calls).toEqual([[0.25]]);
    request.respond(200, { data: ME });
    await expect(result).resolves.toEqual(ME);
  });

  it('passes the server message on, as for a photo that is too large', async () => {
    const result = uploadProfileImage('avatar', new FormData(), 'pick-2', jest.fn());
    (await sent()).respond(413, { message: 'Das Foto ist größer als 15 MB. Wähle ein kleineres Foto.', code: 'payload_too_large' });
    await expect(result).rejects.toMatchObject({ status: 413, message: 'Das Foto ist größer als 15 MB. Wähle ein kleineres Foto.' });
  });

  it('reads Retry-After on a rate limit', async () => {
    const result = uploadProfileImage('avatar', new FormData(), 'pick-3', jest.fn());
    (await sent()).respond(429, { message: 'Zu viele Uploads.', code: 'rate_limited' }, { 'Retry-After': '120' });
    await expect(result).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 120 });
  });

  it('reports a lost connection as a network error', async () => {
    const result = uploadProfileImage('avatar', new FormData(), 'pick-4', jest.fn());
    (await sent()).onerror?.();
    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('network');
  });

  it('does not take a 200 without a member for a success', async () => {
    const result = uploadProfileImage('avatar', new FormData(), 'pick-5', jest.fn());
    (await sent()).respond(200, { data: null });
    await expect(result).rejects.toBeInstanceOf(ApiError);
  });
});

describe('an upload and its session (SEC-S-01, SEC-S-02)', () => {
  it('is aborted when the session ends, so its answer never speaks for the session after it', async () => {
    const result = uploadProfileImage('cover', new FormData(), 'pick-6', jest.fn());
    const request = await sent();
    abortSessionRequests();
    expect(request.aborted).toBe(true);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('leaves an upload of the next session alone', async () => {
    abortSessionRequests();
    const result = uploadProfileImage('cover', new FormData(), 'pick-7', jest.fn());
    const request = await sent();
    expect(request.aborted).toBe(false);
    request.respond(200, { data: ME });
    await expect(result).resolves.toEqual(ME);
  });

  it('sends no token left in the keychain for a guest (ADR-152(h))', async () => {
    useSessionStore.setState({ status: 'guest', member: null });
    const result = uploadProfileImage('avatar', new FormData(), 'pick-8', jest.fn());
    const request = await sent();
    expect(request.headers.Authorization).toBeUndefined();
    request.respond(401, { message: 'Bitte melde dich an.', code: 'unauthenticated' });
    await expect(result).rejects.toMatchObject({ status: 401 });
  });
});
