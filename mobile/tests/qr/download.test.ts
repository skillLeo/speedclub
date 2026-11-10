import { ApiError } from '@/api/client';
import {
  downloadQr,
  nativeDownloadError,
  OBJECT_URL_LIFETIME_MS,
  qrDownloadPath,
  qrDownloadUrl,
  qrFileName,
  QR_FORMATS,
  readWithProgress,
  saveBlob,
  statusFromNativeError,
} from '@/features/qr/download';

type DownloadOptions = { headers?: Record<string, string>; onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void };

const mockDownload = jest.fn<Promise<{ uri: string }>, [string, { uri: string }, DownloadOptions]>();
const mockShare = jest.fn<Promise<void>, [string, Record<string, string>]>(() => Promise.resolve());
const mockShareAvailable = jest.fn(() => Promise.resolve(true));

jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    static downloadFileAsync(url: string, target: { uri: string }, options: DownloadOptions): Promise<{ uri: string }> {
      return mockDownload(url, target, options);
    }
  },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockShareAvailable(),
  shareAsync: (uri: string, options: Record<string, string>) => mockShare(uri, options),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

beforeEach(() => {
  jest.clearAllMocks();
  mockShareAvailable.mockImplementation(() => Promise.resolve(true));
});

describe('formats and names', () => {
  it('offers PNG, the large PNG, SVG and the PDF sticker, in that order', () => {
    expect(QR_FORMATS).toEqual(['png', 'png2048', 'svg', 'pdf']);
  });

  it('names files as the server does in Content-Disposition', () => {
    expect(qrFileName('8TR0Q3MC', 'png')).toBe('speedclub-qr-8TR0Q3MC.png');
    expect(qrFileName('8TR0Q3MC', 'png2048')).toBe('speedclub-qr-8TR0Q3MC-2048.png');
    expect(qrFileName('8TR0Q3MC', 'svg')).toBe('speedclub-qr-8TR0Q3MC.svg');
    expect(qrFileName('8TR0Q3MC', 'pdf')).toBe('speedclub-qr-8TR0Q3MC.pdf');
  });

  it('builds the authenticated endpoints, with the PNG size the server knows', () => {
    expect(qrDownloadPath('01abc', 'png')).toBe('/vehicles/01abc/qr.png?size=1024');
    expect(qrDownloadPath('01abc', 'png2048')).toBe('/vehicles/01abc/qr.png?size=2048');
    expect(qrDownloadPath('01abc', 'svg')).toBe('/vehicles/01abc/qr.svg');
    expect(qrDownloadPath('01abc', 'pdf')).toBe('/vehicles/01abc/qr.pdf');
    expect(qrDownloadUrl('01abc', 'pdf', 'http://localhost:8080')).toBe('http://localhost:8080/api/v1/vehicles/01abc/qr.pdf');
    expect(qrDownloadPath('a/b', 'svg')).toBe('/vehicles/a%2Fb/qr.svg');
  });
});

describe('native errors', () => {
  it('reads the HTTP status from the messages of Android and iOS', () => {
    expect(statusFromNativeError(new Error('UnableToDownloadException: response has status: 404'))).toBe(404);
    expect(statusFromNativeError(new Error('Unable to download file: response has status 429'))).toBe(429);
    expect(statusFromNativeError(new Error('HTTP 401'))).toBe(401);
    expect(statusFromNativeError(new Error('The Internet connection appears to be offline.'))).toBeNull();
  });

  it('turns them into ApiErrors with plain words, never the raw message', () => {
    const gone = nativeDownloadError(new Error('response has status: 404'));
    expect(gone).toBeInstanceOf(ApiError);
    expect(gone.kind).toBe('not_found');
    expect(gone.message).toBe('Das haben wir nicht gefunden.');
    const offline = nativeDownloadError(new Error('The Internet connection appears to be offline.'));
    expect(offline.kind).toBe('network');
    expect(offline.message).not.toContain('Internet connection');
  });
});

describe('downloadQr on native', () => {
  it('downloads into the cache with the Bearer token, reports progress and hands the file to the share sheet', async () => {
    mockDownload.mockImplementation(async (_url, target, options) => {
      options.onProgress?.({ bytesWritten: 512, totalBytes: 1024 });
      options.onProgress?.({ bytesWritten: 700, totalBytes: -1 });
      return { uri: target.uri };
    });
    const progress: (number | null)[] = [];
    const outcome = await downloadQr({
      vehicleId: '01abc',
      code: '8TR0Q3MC',
      format: 'pdf',
      onProgress: (value) => progress.push(value),
      dialogTitle: 'QR-\u2060Code für Nissan Skyline GT-R R34',
    });
    expect(outcome).toEqual({ kind: 'shared', fileName: 'speedclub-qr-8TR0Q3MC.pdf' });
    const [url, target, options] = mockDownload.mock.calls[0]!;
    expect(url).toBe('https://speedclub.test/api/v1/vehicles/01abc/qr.pdf');
    expect(target.uri).toBe('file:///cache/speedclub-qr-8TR0Q3MC.pdf');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer token-1', Accept: 'application/json', 'Accept-Language': 'de' });
    expect(progress).toEqual([0.5, null, 1]);
    expect(mockShare).toHaveBeenCalledWith('file:///cache/speedclub-qr-8TR0Q3MC.pdf', {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'QR-\u2060Code für Nissan Skyline GT-R R34',
    });
  });

  it('fails with the reason when the server refuses, and shares nothing', async () => {
    mockDownload.mockRejectedValue(new Error('UnableToDownloadException: response has status: 404'));
    await expect(downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'png' })).rejects.toMatchObject({
      kind: 'not_found',
      status: 404,
    });
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('says so in words when the device cannot share', async () => {
    mockDownload.mockImplementation(async (_url, target) => ({ uri: target.uri }));
    mockShareAvailable.mockImplementation(() => Promise.resolve(false));
    await expect(downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'svg' })).rejects.toMatchObject({
      code: 'sharing_unavailable',
      message: 'Teilen ist auf diesem Gerät gerade nicht möglich.',
    });
  });

  it('keeps a cancel an AbortError', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockDownload.mockRejectedValue(abort);
    await expect(downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'png' })).rejects.toBe(abort);
  });
});

describe('web helpers', () => {
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
  }

  it('reads a body with progress against Content-Length', async () => {
    const progress: (number | null)[] = [];
    const blob = await readWithProgress(streamOf([new Uint8Array(3), new Uint8Array(1)]), 4, 'image/png', (value) => progress.push(value));
    expect(blob.size).toBe(4);
    expect(blob.type).toBe('image/png');
    expect(progress).toEqual([0, 0.75, 1]);
  });

  it('reports no fraction when the size is unknown', async () => {
    const progress: (number | null)[] = [];
    await readWithProgress(streamOf([new Uint8Array(2)]), 0, 'image/svg+xml', (value) => progress.push(value));
    expect(progress).toEqual([null, null]);
  });

  it('saves through a hidden link with the file name and frees the object URL later', () => {
    jest.useFakeTimers();
    const clicked: { href: string; download: string }[] = [];
    const link = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click() {
        clicked.push({ href: this.href, download: this.download });
      },
      remove: jest.fn(),
    };
    const doc = { createElement: jest.fn(() => link), body: { appendChild: jest.fn() } } as unknown as Document;
    const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr-1');
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    saveBlob(new Blob(['x'], { type: 'image/png' }), 'speedclub-qr-8TR0Q3MC.png', doc);

    expect(clicked).toEqual([{ href: 'blob:qr-1', download: 'speedclub-qr-8TR0Q3MC.png' }]);
    expect(link.style.display).toBe('none');
    expect(link.remove).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    jest.advanceTimersByTime(OBJECT_URL_LIFETIME_MS);
    expect(revoke).toHaveBeenCalledWith('blob:qr-1');
    create.mockRestore();
    revoke.mockRestore();
    jest.useRealTimers();
  });
});
