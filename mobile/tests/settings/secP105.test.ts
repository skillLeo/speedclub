/**
 * SEC-P1-05: no e-mail address in any URL the member web writes. The auth screens hand the address over in memory
 * (features/auth/emailHandoff.ts); this guards the source against a navigation that puts it back into route parameters.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { act, renderHook } from '@testing-library/react-native';

import { emailFromFragment, forgetHandedEmail, handEmailTo, handedEmailFor, useHandedEmail } from '@/features/auth/emailHandoff';
import { setGuest, setMember } from '@/state/session';

const mockRouter = { setParams: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
// The web build: the account-exists mail's fragment is read there.
jest.mock('@/lib/platform', () => ({ ...jest.requireActual<object>('@/lib/platform'), isWeb: true }));

const SRC = resolve(__dirname, '../../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** A router call or href object whose params name an address: `params: { email` or `params: { …, email: …`. */
const EMAIL_PARAM = /params:\s*\{[^}]*\bemail\b/;
/** A path string with an address in its query. */
const EMAIL_QUERY = /['`][^'`]*\?[^'`]*\bemail=/;

describe('SEC-P1-05', () => {
  it('no navigation in the app puts an address into route parameters or a query', () => {
    const offenders = sources(SRC)
      .filter((file) => !file.includes(`${join('api', 'schema')}`))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return text
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => EMAIL_PARAM.test(line) || EMAIL_QUERY.test(line))
          .map(({ index }) => `${file.slice(SRC.length + 1)}:${index + 1}`);
      });
    expect(offenders).toEqual([]);
  });

  it('hands an address to exactly one screen', () => {
    handEmailTo('/forgot-password', ' lukas.sc@speedclub.test ');
    expect(handedEmailFor('/forgot-password')).toBe('lukas.sc@speedclub.test');
    expect(handedEmailFor('/sign-in')).toBeUndefined();
    handEmailTo('/sign-in', 'jann@speedclub.test');
    expect(handedEmailFor('/forgot-password')).toBeUndefined();
    handEmailTo('/sign-in', '');
    expect(handedEmailFor('/sign-in')).toBeUndefined();
  });

  it('forgets the address when somebody signs in or out', async () => {
    await act(async () => setGuest());
    handEmailTo('/sign-in', 'lukas.sc@speedclub.test');
    await act(async () => setMember({ id: 'm1', username: 'lukas.sc', displayName: null, avatarUrl: null }));
    expect(handedEmailFor('/sign-in')).toBeUndefined();
    handEmailTo('/reset-password', 'lukas.sc@speedclub.test');
    await act(async () => setGuest());
    expect(handedEmailFor('/reset-password')).toBeUndefined();
    forgetHandedEmail();
  });

  it('reads the account-exists fragment on sign-in and forgot-password only, one address of a sane shape', () => {
    expect(emailFromFragment('/sign-in', '#email=jann.peters%2Bgarage%40example.de')).toBe('jann.peters+garage@example.de');
    expect(emailFromFragment('/forgot-password', '#email=jann%40example.de')).toBe('jann@example.de');
    // Reset reads its own fragment (links.ts); the other auth screens get none.
    expect(emailFromFragment('/reset-password', '#email=jann%40example.de')).toBeUndefined();
    expect(emailFromFragment('/sign-up', '#email=jann%40example.de')).toBeUndefined();
    expect(emailFromFragment('/sign-in', '#email=a%40b.de&email=c%40d.de')).toBeUndefined();
    expect(emailFromFragment('/sign-in', '#email=jann%E2%80%8B%40example.de')).toBeUndefined();
    expect(emailFromFragment('/sign-in', '#email=nobody')).toBeUndefined();
    expect(emailFromFragment('/sign-in', '')).toBeUndefined();
  });

  it('on web prefills from the fragment, hands the address on and replaces the route so the fragment leaves the address bar', async () => {
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { hash: '#email=jann%40example.de', search: '' } };
    try {
      const { result } = await renderHook(() => useHandedEmail('/sign-in', undefined));
      expect(result.current).toBe('jann@example.de');
      expect(handedEmailFor('/sign-in')).toBe('jann@example.de');
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
    } finally {
      (globalThis as { window?: unknown }).window = previous;
      forgetHandedEmail();
    }
  });

  it('takes the fragment out of the address bar before it replaces the screen, so a remount cannot loop (M2.8 run 3, React #185)', async () => {
    const previous = (globalThis as { window?: unknown }).window;
    const location = { hash: '#email=jann%40example.de', pathname: '/app/sign-in', search: '?qaLocale=de' };
    const replaceState = jest.fn((_state: unknown, _title: string, url: string) => {
      location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    });
    (globalThis as { window?: unknown }).window = { location, history: { state: { key: 'k' }, replaceState } };
    const hashAtReplace: string[] = [];
    mockRouter.replace.mockReset();
    mockRouter.replace.mockImplementation(() => {
      hashAtReplace.push(location.hash);
    });
    try {
      // The router's replace mounts the screen again; until the URL loses the fragment, every mount would replace again.
      const first = await renderHook(() => useHandedEmail('/sign-in', undefined));
      const second = await renderHook(() => useHandedEmail('/sign-in', undefined));
      expect(replaceState).toHaveBeenCalledWith({ key: 'k' }, '', '/app/sign-in?qaLocale=de');
      expect(hashAtReplace).toEqual(['']);
      expect(mockRouter.replace).toHaveBeenCalledTimes(1);
      // The screen that replaces it still has the address, from the hand-off.
      expect(first.result.current).toBe('jann@example.de');
      expect(second.result.current).toBe('jann@example.de');
    } finally {
      (globalThis as { window?: unknown }).window = previous;
      mockRouter.replace.mockReset();
      forgetHandedEmail();
    }
  });
});
