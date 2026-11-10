import { downloadQr, isPlacard, PLACARD_FORMATS, qrDownloadPath, qrFileName, QR_FORMATS, sheetFormats } from '@/features/qr/download';

const mockDownload = jest.fn((_url: string, target: { uri: string }, _options: unknown) => Promise.resolve({ uri: target.uri }));
const mockShare = jest.fn((_uri: string, _options: unknown) => Promise.resolve());

jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`;
    }
    static downloadFileAsync(url: string, target: { uri: string }, options: unknown) {
      return mockDownload(url, target, options);
    }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: () => Promise.resolve(true), shareAsync: (uri: string, options: unknown) => mockShare(uri, options) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve('token-1')) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

describe('QR-02 placard (sig.placard_pdf)', () => {
  it('joins the sheet after the sticker formats only with the flag', () => {
    expect(sheetFormats(false)).toEqual(QR_FORMATS);
    expect(sheetFormats(true)).toEqual([...QR_FORMATS, 'placardA5', 'placardA4']);
    expect(PLACARD_FORMATS.every(isPlacard)).toBe(true);
    expect(QR_FORMATS.some(isPlacard)).toBe(false);
  });

  it('names and addresses the build sheet as the server does', () => {
    expect(qrFileName('8TR0Q3MC', 'placardA5')).toBe('speedclub-placard-a5-8TR0Q3MC.pdf');
    expect(qrDownloadPath('01abc', 'placardA4')).toBe('/vehicles/01abc/placard.pdf?size=a4');
  });

  it('downloads the PDF with the token and hands it to the share sheet', async () => {
    const outcome = await downloadQr({ vehicleId: '01abc', code: '8TR0Q3MC', format: 'placardA4' });
    expect(outcome).toEqual({ kind: 'shared', fileName: 'speedclub-placard-a4-8TR0Q3MC.pdf' });
    const [url, , options] = mockDownload.mock.calls[0]!;
    expect(url).toBe('https://speedclub.test/api/v1/vehicles/01abc/placard.pdf?size=a4');
    expect(options).toMatchObject({ headers: { Authorization: 'Bearer token-1' } });
    expect(mockShare).toHaveBeenCalledWith('file:///cache/speedclub-placard-a4-8TR0Q3MC.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
  });
});
