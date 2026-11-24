jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('Wrapped export path', () => {
  beforeEach(() => jest.resetModules());

  it('the phone draws the card at 1080 × 1920 (pixels on Android, points on iOS) and shares it', async () => {
    const captureRef = jest.fn(async () => 'file:///tmp/card.png');
    const releaseCapture = jest.fn();
    const shareAsync = jest.fn(async () => undefined);
    jest.doMock('react-native-view-shot', () => ({ captureRef, releaseCapture }));
    jest.doMock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync }));
    const native = jest.requireActual<typeof import('@/features/wrapped/share.native')>('@/features/wrapped/share.native');
    expect(native.wrappedExportMode).toBe('capture');
    expect(native.captureSize('android', 2.625)).toEqual({ width: 1080, height: 1920 });
    expect(native.captureSize('ios', 3)).toEqual({ width: 360, height: 640 });
    const ref = { current: {} as never };
    await expect(native.exportWrappedCard({ card: ref, seasonKey: '2027-saison', n: 3, title: 'Mein Speedclub Wrapped' })).resolves.toBe('shared');
    expect(captureRef).toHaveBeenCalledWith(ref, expect.objectContaining({ format: 'png', result: 'tmpfile' }));
    expect(shareAsync).toHaveBeenCalledWith('file:///tmp/card.png', expect.objectContaining({ mimeType: 'image/png', UTI: 'public.png' }));
    expect(releaseCapture).toHaveBeenCalledWith('file:///tmp/card.png');
    await expect(native.exportWrappedCard({ card: { current: null }, seasonKey: '2027-saison', n: 1, title: 'x' })).resolves.toBe('failed');
  });

  it('the web downloads the server card n and never draws one', async () => {
    const saveBlob = jest.fn();
    jest.doMock('@/features/qr/download', () => ({ saveBlob }));
    const GET = jest.fn(async () => ({ response: { ok: true, status: 200 }, data: new Blob(['png']) }));
    jest.doMock('@/api/client', () => ({ ...jest.requireActual('@/api/client'), api: { GET } }));
    const web = jest.requireActual<typeof import('@/features/wrapped/share')>('../../src/features/wrapped/share.ts');
    expect(web.wrappedExportMode).toBe('server');
    await expect(web.exportWrappedCard({ card: { current: null }, seasonKey: '2027-saison', n: 9, title: 'x' })).resolves.toBe('saved');
    expect(GET).toHaveBeenCalledWith(
      '/me/wrapped/{season_key}/cards/{n}.png',
      expect.objectContaining({ params: { path: { season_key: '2027-saison', n: '9' } }, parseAs: 'blob' }),
    );
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'speedclub-wrapped-2027-saison-9.png');
    GET.mockImplementationOnce(async () => ({ response: { ok: false, status: 404 }, data: undefined as unknown as Blob }));
    await expect(web.exportWrappedCard({ card: { current: null }, seasonKey: '2027-saison', n: 2, title: 'x' })).resolves.toBe('failed');
  });
});
