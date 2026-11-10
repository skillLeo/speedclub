import { downloadQr } from '@/features/qr/download';

// The member web: the session cookie instead of the Bearer token, and the browser's download instead of the share sheet.
jest.mock('@/lib/platform', () => ({ isWeb: true, isNative: false, isIOS: false, isAndroid: false }));
jest.mock('expo-file-system', () => ({ Paths: {}, File: class {} }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

type FakeLink = { href?: string; download?: string; style: { display?: string }; click: () => void; remove: () => void };

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  jest.restoreAllMocks();
});

it('downloads with the session cookie, reports progress and saves the file under its name', async () => {
  // The object URL is freed by a timer a minute later. The body stream needs the real setImmediate.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const requests: Request[] = [];
  globalThis.fetch = jest.fn(async (request: Request) => {
    requests.push(request);
    return new Response(streamOf([new Uint8Array(6), new Uint8Array(4)]), {
      status: 200,
      headers: { 'Content-Length': '10', 'Content-Type': 'image/png' },
    });
  }) as unknown as typeof fetch;
  const saved: { href?: string; download?: string }[] = [];
  const link: FakeLink = {
    style: {},
    click() {
      saved.push({ href: link.href, download: link.download });
    },
    remove() {},
  };
  (globalThis as { document?: unknown }).document = { createElement: () => link, body: { appendChild() {} } };
  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr-2');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  const progress: (number | null)[] = [];
  const outcome = await downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'png2048', onProgress: (value) => progress.push(value) });

  expect(outcome).toEqual({ kind: 'saved', fileName: 'speedclub-qr-8TR0Q3MC-2048.png' });
  expect(saved).toEqual([{ href: 'blob:qr-2', download: 'speedclub-qr-8TR0Q3MC-2048.png' }]);
  expect(progress).toEqual([0, 0.6, 1, 1]);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://speedclub.test/api/v1/vehicles/01abc/qr.png?size=2048');
  expect(requests[0]!.credentials).toBe('include');
  expect(requests[0]!.headers.get('Authorization')).toBeNull();
  jest.runOnlyPendingTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr-2');
  jest.useRealTimers();
});

it('turns a refused download into the server message and saves nothing', async () => {
  globalThis.fetch = jest.fn(
    async () =>
      new Response(JSON.stringify({ message: 'Das war etwas schnell.', code: 'rate_limited', errors: {} }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
      }),
  ) as unknown as typeof fetch;
  const create = jest.spyOn(URL, 'createObjectURL');
  await expect(downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'svg' })).rejects.toMatchObject({
    kind: 'rate_limited',
    message: 'Das war etwas schnell.',
    retryAfter: 30,
  });
  expect(create).not.toHaveBeenCalled();
});

it('reports a dropped connection in words', async () => {
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
  await expect(downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'pdf' })).rejects.toMatchObject({
    kind: 'network',
    message: 'Keine Verbindung. Prüfe dein Netz und versuch es noch einmal.',
  });
});
