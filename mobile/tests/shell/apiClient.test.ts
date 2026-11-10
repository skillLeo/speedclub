import { ApiError, apiData, createApiClient, onApiGateEvent, parseRetryAfter, readCookie, withIdempotency } from '@/api/client';
import i18n from '@/i18n';
import { setGuest, setMember } from '@/state/session';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const ORIGIN = 'https://speedclub.test';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function nativeClient(fetchMock: jest.Mock, token: string | null = 'secret') {
  return createApiClient({ origin: ORIGIN, cookieAuth: false, fetch: fetchMock, getToken: () => Promise.resolve(token) });
}

function sent(fetchMock: jest.Mock, index: number = 0): Request {
  return fetchMock.mock.calls[index]?.[0] as Request;
}

describe('requests', () => {
  it('native: Bearer token, language and JSON', async () => {
    const fetchMock = jest.fn(() => Promise.resolve(json(200, { data: [] })));
    await i18n.changeLanguage('en');
    await nativeClient(fetchMock).GET('/catalog/makes');
    await i18n.changeLanguage('de');

    const request = sent(fetchMock);
    expect(request.url).toBe(`${ORIGIN}/api/v1/catalog/makes`);
    expect(request.headers.get('Authorization')).toBe('Bearer secret');
    expect(request.headers.get('Accept')).toBe('application/json');
    expect(request.headers.get('Accept-Language')).toBe('en');
  });

  it('native: a guest sends no Authorization header', async () => {
    const fetchMock = jest.fn(() => Promise.resolve(json(200, { data: [] })));
    await nativeClient(fetchMock, null).GET('/catalog/makes');
    expect(sent(fetchMock).headers.has('Authorization')).toBe(false);
  });

  it('native: a failing keychain read still sends the request, without Authorization, and logs no detail', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = jest.fn(() => Promise.resolve(json(200, { data: [] })));
    const client = createApiClient({
      origin: ORIGIN,
      cookieAuth: false,
      fetch: fetchMock,
      getToken: () => Promise.reject(new Error('keychain says secret-detail')),
    });
    const { response } = await client.GET('/catalog/makes');

    expect(response.status).toBe(200);
    expect(sent(fetchMock).headers.has('Authorization')).toBe(false);
    expect(warn.mock.calls).toEqual([['Could not read the auth token']]);
    warn.mockRestore();
  });

  it('adds an Idempotency-Key to a creating POST, and keeps a key that is passed in', () => {
    expect(withIdempotency().headers['Idempotency-Key']).toBe('uuid-1');
    expect(withIdempotency('kept').headers['Idempotency-Key']).toBe('kept');
  });
});

describe('web XSRF flow', () => {
  function webClient(fetchMock: jest.Mock, cookies: { value: string }) {
    return createApiClient({ origin: ORIGIN, cookieAuth: true, fetch: fetchMock, getCookies: () => cookies.value });
  }
  const post = (client: ReturnType<typeof webClient>) =>
    client.POST('/catalog/requests' as never, { body: {} } as never);

  it('fetches the cookie before the first mutating call and sends it decoded', async () => {
    const cookies = { value: '' };
    const fetchMock = jest.fn((request: Request) => {
      if (request.url.endsWith('/sanctum/csrf-cookie')) cookies.value = 'other=1; XSRF-TOKEN=a%3Db';
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    await post(webClient(fetchMock, cookies));

    expect(sent(fetchMock, 0).url).toBe(`${ORIGIN}/sanctum/csrf-cookie`);
    expect(sent(fetchMock, 0).credentials).toBe('include');
    expect(sent(fetchMock, 1).headers.get('X-XSRF-TOKEN')).toBe('a=b');
    expect(sent(fetchMock, 1).credentials).toBe('include');
    expect(sent(fetchMock, 1).headers.has('Authorization')).toBe(false);
  });

  it('skips the cookie request for GET and when the cookie exists', async () => {
    const cookies = { value: 'XSRF-TOKEN=abc' };
    const fetchMock = jest.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = webClient(fetchMock, cookies);
    await client.GET('/catalog/makes');
    await post(client);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(fetchMock, 0).headers.has('X-XSRF-TOKEN')).toBe(false);
    expect(sent(fetchMock, 1).headers.get('X-XSRF-TOKEN')).toBe('abc');
  });

  it('parallel mutating calls share one cookie request', async () => {
    const cookies = { value: '' };
    const fetchMock = jest.fn((request: Request) => {
      if (request.url.endsWith('/sanctum/csrf-cookie')) cookies.value = 'XSRF-TOKEN=t';
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const client = webClient(fetchMock, cookies);
    await Promise.all([post(client), post(client)]);
    const cookieCalls = fetchMock.mock.calls.filter(([request]) => request.url.endsWith('/sanctum/csrf-cookie'));
    expect(cookieCalls).toHaveLength(1);
  });

  it('a 419 refreshes the cookie before the next mutating call', async () => {
    const cookies = { value: 'XSRF-TOKEN=old' };
    const fetchMock = jest.fn((request: Request) => {
      if (request.url.endsWith('/sanctum/csrf-cookie')) {
        cookies.value = 'XSRF-TOKEN=new';
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const stale = request.headers.get('X-XSRF-TOKEN') === 'old';
      return Promise.resolve(stale ? json(419, { message: 'x', code: 'session_expired', errors: {} }) : new Response(null, { status: 204 }));
    });
    const client = webClient(fetchMock, cookies);
    await post(client);
    await post(client);
    expect(fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      '/api/v1/catalog/requests',
      '/sanctum/csrf-cookie',
      '/api/v1/catalog/requests',
    ]);
    expect(sent(fetchMock, 2).headers.get('X-XSRF-TOKEN')).toBe('new');
  });
});

describe('errors', () => {
  async function failure(response: Response): Promise<ApiError> {
    const client = nativeClient(jest.fn(() => Promise.resolve(response)));
    return apiData(client.GET('/catalog/makes')).then(
      () => {
        throw new Error('expected a failure');
      },
      (error: ApiError) => error,
    );
  }

  it.each([
    [401, 'unauthenticated', 'unauthenticated'],
    [403, 'forbidden', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [423, 'maintenance', 'maintenance'],
    [426, 'upgrade_required', 'upgrade'],
    [500, 'server_error', 'server'],
  ])('%i is normalised', async (status, code, kind) => {
    const error = await failure(json(status, { message: 'Übersetzt', code, errors: {} }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code, kind, message: 'Übersetzt' });
  });

  it('403 account_restricted carries the end of the restriction', async () => {
    const error = await failure(
      json(403, { message: 'Eingeschränkt', code: 'account_restricted', errors: {}, until: '2027-01-01T00:00:00Z' }),
    );
    expect(error.kind).toBe('restricted');
    expect(error.restrictedUntil).toBe('2027-01-01T00:00:00Z');
  });

  it('422 keeps the field errors', async () => {
    const error = await failure(
      json(422, { message: 'Prüfe deine Eingaben', code: 'validation_failed', errors: { email: ['Ungültig'] } }),
    );
    expect(error.kind).toBe('validation');
    expect(error.fieldErrors).toEqual({ email: ['Ungültig'] });
  });

  it('429 reads Retry-After in seconds and as a date', async () => {
    const error = await failure(json(429, { message: 'x', code: 'rate_limited', errors: {} }, { 'Retry-After': '30' }));
    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfter).toBe(30);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(30);
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('a body that is not the API format still gets translated copy', async () => {
    const error = await failure(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(error.kind).toBe('server');
    expect(error.message).toBe(i18n.t('errors:server'));
  });

  it('a network failure is an ApiError with status 0 and German copy', async () => {
    const client = nativeClient(jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(apiData(client.GET('/catalog/makes'))).rejects.toMatchObject({
      kind: 'network',
      status: 0,
      message: 'Keine Verbindung. Prüfe dein Netz und versuch es noch einmal.',
    });
  });

  it('a cancelled query stays an AbortError', async () => {
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const client = nativeClient(jest.fn(() => Promise.reject(abort)));
    await expect(apiData(client.GET('/catalog/makes'))).rejects.toBe(abort);
  });

  it('423, 426 and 401 notify the listeners', async () => {
    const events: string[] = [];
    const unsubscribe = onApiGateEvent((event) => events.push(event));
    await failure(json(423, { message: 'x', code: 'maintenance', errors: {} }));
    await failure(json(426, { message: 'x', code: 'upgrade_required', errors: {} }));
    await failure(json(401, { message: 'x', code: 'unauthenticated', errors: {} }));
    unsubscribe();
    await failure(json(423, { message: 'x', code: 'maintenance', errors: {} }));
    expect(events).toEqual(['maintenance', 'upgrade', 'unauthenticated']);
  });

  it.each([423, 426, 401])('a %i on /app-config notifies nobody, because the listeners poll that route', async (status) => {
    const listener = jest.fn();
    const unsubscribe = onApiGateEvent(listener);
    await nativeClient(jest.fn(() => Promise.resolve(json(status, { message: 'x', code: 'x', errors: {} })))).GET('/app-config');
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the session-expired event', () => {
  const login = (client: ReturnType<typeof createApiClient>) =>
    client.POST('/auth/login' as never, { body: { email: 'a@b.de', password: 'falsch' } } as never);

  function heard(run: () => Promise<unknown>): Promise<string[]> {
    const events: string[] = [];
    const unsubscribe = onApiGateEvent((event) => events.push(event));
    return run().then(() => {
      unsubscribe();
      return events;
    });
  }

  function respondingWith(status: number, code: unknown) {
    return jest.fn(() => Promise.resolve(json(status, { message: 'Übersetzt', code, errors: {} })));
  }

  afterEach(setGuest);

  it('a wrong password raises nothing, even with an old token in the keychain', async () => {
    const client = nativeClient(respondingWith(401, 'invalid_credentials'));
    await expect(heard(() => login(client))).resolves.toEqual([]);
  });

  it('a login that fails validation raises nothing', async () => {
    const client = nativeClient(respondingWith(422, 'validation_failed'));
    await expect(heard(() => login(client))).resolves.toEqual([]);
  });

  it('a guest without a session raises nothing, even on code unauthenticated', async () => {
    const native = nativeClient(respondingWith(401, 'unauthenticated'), null);
    await expect(heard(() => native.GET('/catalog/makes'))).resolves.toEqual([]);
    const web = createApiClient({ origin: ORIGIN, cookieAuth: true, fetch: respondingWith(401, 'unauthenticated') });
    await expect(heard(() => web.GET('/catalog/makes'))).resolves.toEqual([]);
  });

  it('a held token that stops working raises it', async () => {
    // A held token is a member's: a guest's app sends none (tests/auth/tokenRotation.test.ts).
    setMember({ id: '1', username: 'lukas.sc', displayName: null, avatarUrl: null });
    const client = nativeClient(respondingWith(401, 'unauthenticated'));
    await expect(heard(() => client.GET('/catalog/makes'))).resolves.toEqual(['unauthenticated']);
  });

  it('a web member whose cookie expired raises it', async () => {
    setMember({ id: '1', username: 'lukas.sc', displayName: null, avatarUrl: null });
    const client = createApiClient({ origin: ORIGIN, cookieAuth: true, fetch: respondingWith(401, 'unauthenticated') });
    await expect(heard(() => client.GET('/catalog/makes'))).resolves.toEqual(['unauthenticated']);
  });

  it('a 401 with a body that is not the API format raises nothing', async () => {
    setMember({ id: '1', username: 'lukas.sc', displayName: null, avatarUrl: null });
    const client = nativeClient(jest.fn(() => Promise.resolve(new Response('<html>nope</html>', { status: 401 }))));
    await expect(heard(() => client.GET('/catalog/makes'))).resolves.toEqual([]);
  });

  it('the caller still gets the body of the 401', async () => {
    const client = nativeClient(respondingWith(401, 'unauthenticated'));
    await expect(apiData(client.GET('/catalog/makes'))).rejects.toMatchObject({ code: 'unauthenticated', message: 'Übersetzt' });
  });
});

describe('readCookie', () => {
  it('finds a cookie among others and returns null otherwise', () => {
    expect(readCookie('a=1; XSRF-TOKEN=x%20y; b=2', 'XSRF-TOKEN')).toBe('x y');
    expect(readCookie('a=1', 'XSRF-TOKEN')).toBeNull();
    expect(readCookie('', 'XSRF-TOKEN')).toBeNull();
  });
});
