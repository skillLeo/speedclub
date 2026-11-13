// 09 §7.1: who sees ONB-01…03 and Welcome on the first launch, and where a deep link goes instead.
import { firstLaunchRoute, isAuthRoute, ONBOARDING_PATH } from '@/features/auth/routing';
import { initialPage } from '@/features/onboarding/pages';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const base = { native: true, status: 'guest' as const, pathname: '/', onboardingSeen: false, welcomeSeen: false };

describe('firstLaunchRoute', () => {
  it('native: the onboarding first, then Welcome once, then Start', () => {
    expect(firstLaunchRoute(base)).toBe('/onboarding');
    expect(firstLaunchRoute({ ...base, onboardingSeen: true })).toBe('/welcome');
    expect(firstLaunchRoute({ ...base, onboardingSeen: true, welcomeSeen: true })).toBeNull();
  });

  it('never for a member, while the session loads, or on a cold deep link', () => {
    expect(firstLaunchRoute({ ...base, status: 'member' })).toBeNull();
    expect(firstLaunchRoute({ ...base, status: 'loading' })).toBeNull();
    for (const pathname of ['/v/bmw-m3-e46', '/u/lukas', '/c/7H2KQXMB', '/discover']) {
      expect(firstLaunchRoute({ ...base, pathname })).toBeNull();
    }
  });

  it('web: the pages on the first visit of /app only, never Welcome, never for automation or a visitor from the public pages', () => {
    const web = { ...base, native: false };
    expect(firstLaunchRoute(web)).toBe('/onboarding');
    expect(firstLaunchRoute({ ...web, onboardingSeen: true })).toBeNull();
    expect(firstLaunchRoute({ ...web, skipOnWeb: true })).toBeNull();
    // The native "skip" flag never applies to the app.
    expect(firstLaunchRoute({ ...base, skipOnWeb: true })).toBe('/onboarding');
  });

  it('counts the onboarding as an auth route, so a member who opens it is sent on', () => {
    expect(isAuthRoute(ONBOARDING_PATH)).toBe(true);
  });
});

describe('initialPage', () => {
  it('opens the page the link names (1-based) and the first page for anything else', () => {
    expect(initialPage('2')).toBe(1);
    expect(initialPage('3')).toBe(2);
    expect(initialPage(['3'])).toBe(2);
    for (const value of [undefined, '0', '4', 'x', '1.5']) expect(initialPage(value)).toBe(0);
  });
});
