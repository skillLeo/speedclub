import { originOf, parseStickerCode } from '@/features/dex/code';

const PROD = ['https://speedclub.de'];
const LOCAL = ['http://192.168.1.20:8080'];

describe('DEX-02 sticker parser', () => {
  it.each([
    ['https://speedclub.de/C/7H2KQXMB', '7H2KQXMB'],
    ['https://speedclub.de/c/7H2KQXMB', '7H2KQXMB'],
    ['https://speedclub.de/c/7H2KQXMB/', '7H2KQXMB'],
    ['https://SPEEDCLUB.DE/C/7H2KQXMB', '7H2KQXMB'],
    // Case-insensitive Crockford, as the server resolves it.
    ['https://speedclub.de/c/7h2kqxmb', '7H2KQXMB'],
    ['  https://speedclub.de/C/7H2KQXMB  ', '7H2KQXMB'],
    ['speedclub://c/7H2KQXMB', '7H2KQXMB'],
    ['SPEEDCLUB://c/7h2kqxmb', '7H2KQXMB'],
    // O and I/L read as 0 and 1, exactly like normalizeQrCode.
    ['https://speedclub.de/C/7H2KQXMO', '7H2KQXM0'],
  ])('accepts %s', (data, code) => {
    expect(parseStickerCode(data, PROD)).toBe(code);
  });

  it.each([
    ['another site', 'https://example.com/C/7H2KQXMB'],
    ['a look-alike host', 'https://speedclub.de.example.com/C/7H2KQXMB'],
    ['a subdomain of ours that is not configured', 'https://evil.speedclub.de/C/7H2KQXMB'],
    ['user info before the host', 'https://speedclub.de@example.com/C/7H2KQXMB'],
    ['plain http to our https site', 'http://speedclub.de/C/7H2KQXMB'],
    ['another port', 'https://speedclub.de:8443/C/7H2KQXMB'],
    ['a query string', 'https://speedclub.de/C/7H2KQXMB?utm_source=x'],
    ['a fragment', 'https://speedclub.de/C/7H2KQXMB#x'],
    ['the web app path', 'https://speedclub.de/app/c/7H2KQXMB'],
    ['a vehicle page', 'https://speedclub.de/v/nissan-skyline'],
    ['a code too short', 'https://speedclub.de/C/7H2KQXM'],
    ['a code too long', 'https://speedclub.de/C/7H2KQXMBB'],
    ['a code with U', 'https://speedclub.de/C/7H2KQXMU'],
    ['separators in the code', 'https://speedclub.de/C/7H2K-QXMB'],
    ['a deeper path', 'https://speedclub.de/C/7H2KQXMB/x'],
    ['another scheme route', 'speedclub://v/7H2KQXMB'],
    ['a scheme link with a query', 'speedclub://c/7H2KQXMB?x=1'],
    ['another app scheme', 'otherapp://c/7H2KQXMB'],
    ['plain text', '7H2KQXMB'],
    ['a Wi-Fi code', 'WIFI:S:Garage;T:WPA;P:secret;;'],
    ['nothing', ''],
  ])('rejects %s', (_case, data) => {
    expect(parseStickerCode(data, PROD)).toBeNull();
  });

  it('accepts http only where the build itself talks http (local and lan builds)', () => {
    expect(parseStickerCode('http://192.168.1.20:8080/C/7H2KQXMB', LOCAL)).toBe('7H2KQXMB');
    expect(parseStickerCode('https://192.168.1.20:8080/C/7H2KQXMB', LOCAL)).toBeNull();
    expect(parseStickerCode('http://192.168.1.20/C/7H2KQXMB', LOCAL)).toBeNull();
  });

  it('knows no host when the build has none configured', () => {
    expect(parseStickerCode('https://speedclub.de/C/7H2KQXMB', [])).toBeNull();
    expect(parseStickerCode('speedclub://c/7H2KQXMB', [])).toBe('7H2KQXMB');
  });

  it('reads the origins of the configured URLs', () => {
    expect(originOf('https://Staging.SpeedClub.de/')).toBe('https://staging.speedclub.de');
    expect(originOf('http://192.168.1.20:8080/api')).toBe('http://192.168.1.20:8080');
    expect(originOf('ftp://speedclub.de')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
