import { createApiClient } from '@/api/client';
import { PREVIEW_HEADER, readPreviewToken, setPreviewTokenForTests } from '@/api/preview';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

const ORIGIN = 'https://speedclub.test';
const TOKEN = 'eyJzIjoxLCJlIjoxfQ.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

function client(fetchMock: jest.Mock<Promise<Response>, [Request]>) {
  return createApiClient({ origin: ORIGIN, cookieAuth: false, fetch: fetchMock, getToken: () => Promise.resolve(null) });
}

const ok = (_request: Request) => Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

describe('draft preview (ADM-34)', () => {
  afterEach(() => setPreviewTokenForTests(null));

  it('reads one well-formed token from the query string, nothing else', () => {
    expect(readPreviewToken(`?preview=${TOKEN}`)).toBe(TOKEN);
    expect(readPreviewToken(`?qaTheme=light&preview=${TOKEN}`)).toBe(TOKEN);
    expect(readPreviewToken('?preview=nope')).toBeNull();
    expect(readPreviewToken(`?preview=${TOKEN}&preview=${TOKEN}`)).toBeNull();
    expect(readPreviewToken('')).toBeNull();
  });

  it('forwards the token on reads only', async () => {
    setPreviewTokenForTests(TOKEN);
    const fetchMock = jest.fn<Promise<Response>, [Request]>(ok);
    const api = client(fetchMock);
    await api.GET('/app-config');
    await api.POST('/me/consents', { body: { terms_version: '2' } });
    const [read, write] = fetchMock.mock.calls.map(([request]) => request);
    expect(read?.headers.get(PREVIEW_HEADER)).toBe(TOKEN);
    expect(write?.headers.has(PREVIEW_HEADER)).toBe(false);
  });

  it('sends nothing outside a preview', async () => {
    const fetchMock = jest.fn<Promise<Response>, [Request]>(ok);
    await client(fetchMock).GET('/app-config');
    expect(fetchMock.mock.calls[0]?.[0].headers.has(PREVIEW_HEADER)).toBe(false);
  });
});
