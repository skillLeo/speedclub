/**
 * OBS-R11-2: the app compares an address the way the server stores it (ADR-183, App\Support\EmailAddress::normalize). The
 * expected values are what the server answers for the same input (php -r … EmailAddress::normalize, round 11).
 */
import { setMember, setGuest, useSessionStore } from '@/state/session';
import { endLocalSessionAfterReset, meKey } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { asciiDomain, normalizeEmail, punycode } from '@/lib/emailAddress';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

describe('normalizeEmail (as the server stores it)', () => {
  it.each([
    ['max@müller.de', 'max@xn--mller-kva.de'],
    ['Max@MÜLLER.DE', 'max@xn--mller-kva.de'],
    ['Max@ＭÜＬＬＥＲ.de', 'max@xn--mller-kva.de'],
    ['max@müller。de', 'max@xn--mller-kva.de'],
    ['max@müller.de', 'max@xn--mller-kva.de'],
    ['max@straße.de', 'max@xn--strae-oqa.de'],
    ['max@STRAẞE.de', 'max@xn--strae-oqa.de'],
    ['max@strasse.de', 'max@strasse.de'],
    ['max@ﬁsch.de', 'max@fisch.de'],
    ['max@münchen.de', 'max@xn--mnchen-3ya.de'],
    ['max@日本語.jp', 'max@xn--wgv71a119e.jp'],
    ['  Max@xn--MLLER-kva.de ', 'max@xn--mller-kva.de'],
    ['not-an-address', 'not-an-address'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it('encodes labels by RFC 3492', () => {
    expect(punycode('bücher')).toBe('bcher-kva');
    expect(punycode('faß')).toBe('fa-hia');
    expect(asciiDomain('sub.bücher.example')).toBe('sub.xn--bcher-kva.example');
  });
});

describe('a reset on a device signed in (OBS-R11-2)', () => {
  const LUKAS = { id: '01LUKAS', username: 'lukas.sc', displayName: null, avatarUrl: null };

  beforeEach(() => {
    queryClient.clear();
    setGuest();
  });

  it('ends the session when the typed address is the stored one in another form', async () => {
    setMember(LUKAS);
    queryClient.setQueryData(meKey, { id: LUKAS.id, email: 'lukas@xn--mller-kva.de' });
    await expect(endLocalSessionAfterReset('Lukas@Müller.de')).resolves.toBe('ended');
    expect(useSessionStore.getState().status).toBe('guest');
  });

  it('keeps the session of another account: strasse.de is not straße.de', async () => {
    setMember(LUKAS);
    queryClient.setQueryData(meKey, { id: LUKAS.id, email: 'lukas@xn--strae-oqa.de' });
    await expect(endLocalSessionAfterReset('lukas@strasse.de')).resolves.toBe('kept');
    expect(useSessionStore.getState().status).toBe('member');
  });
});
