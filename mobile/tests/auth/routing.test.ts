import { renderHook } from '@testing-library/react-native';

import { useReturnToParam } from '@/features/auth/forms';
import { consumeAfterOnboarding, isGuestPath, openAfterOnboarding, routeForSession } from '@/features/auth/routing';
import { completeAuthIntent, openAuthPrompt, useSessionStore } from '@/state/session';

beforeEach(() => {
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null });
});

describe('routeForSession', () => {
  it('waits while the session is being restored', () => {
    expect(routeForSession({ status: 'loading', pathname: '/username' })).toEqual({ type: 'stay' });
  });

  // BH-29: 02_PRODUCT_SPEC §3.1 and ADR-139 win over ADR-152(d). An unverified member browses; only the two steps after the
  // code are forced from anywhere.
  it('forces the username and profile steps from anywhere (F1), and keeps a real deep link for after them', () => {
    expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname: '/sign-in' })).toEqual({ type: 'go', path: '/username' });
    expect(routeForSession({ status: 'member', nextStep: 'profile_setup', pathname: '/v/skyline' })).toEqual({ type: 'go', path: '/profile-setup', resume: '/v/skyline' });
    expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname: '/c/8TR0Q3MC' })).toEqual({ type: 'go', path: '/username', resume: '/c/8TR0Q3MC' });
    expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname: '/username' })).toEqual({ type: 'stay' });
    expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname: '/' })).toEqual({ type: 'go', path: '/username' });
  });

  it('lets an unverified member browse', () => {
    for (const pathname of ['/', '/discover', '/discover/search', '/v/skyline', '/v/skyline/gallery', '/u/lukas.sc', '/c/8TR0Q3MC', '/settings/legal/terms', '/settings/legal']) {
      expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname })).toEqual({ type: 'stay' });
    }
    expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname: '/verify-email' })).toEqual({ type: 'stay' });
    expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname: '/reset-password' })).toEqual({ type: 'stay' });
  });

  it('sends an unverified member to AUTH-05 from the auth routes, without keeping them', () => {
    for (const pathname of ['/welcome', '/sign-in', '/sign-up', '/forgot-password', '/username', '/profile-setup']) {
      expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname })).toEqual({ type: 'go', path: '/verify-email' });
    }
  });

  it('sends an unverified member to AUTH-05 from the member-only screens, and keeps the way back', () => {
    for (const pathname of ['/garage', '/garage/01H/basics', '/profile', '/profile/edit', '/messages', '/settings', '/settings/appearance', '/add-vehicle/new/vehicle', '/qr/01H']) {
      expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname })).toEqual({ type: 'go', path: '/verify-email', resume: pathname });
    }
  });

  it('does not take a member-only path for a browse path because it starts the same', () => {
    expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname: '/discovery' })).toMatchObject({ type: 'go' });
    expect(routeForSession({ status: 'member', nextStep: 'verify_email', pathname: '/vehicles' })).toMatchObject({ type: 'go' });
  });

  it('never keeps a crafted path as the way back', () => {
    expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname: '/v//evil.example' })).toEqual({ type: 'go', path: '/username' });
  });

  it('leaves the gates, the legal texts and a reset link alone', () => {
    for (const pathname of ['/maintenance', '/update-required', '/settings/legal/terms', '/reset-password']) {
      expect(routeForSession({ status: 'member', nextStep: 'choose_username', pathname })).toEqual({ type: 'stay' });
    }
  });

  it('finishes the auth stack once nothing is open: the garage after F1, home after a sign-in', () => {
    expect(routeForSession({ status: 'member', nextStep: null, pathname: '/profile-setup' })).toEqual({ type: 'finish', fallback: '/garage' });
    expect(routeForSession({ status: 'member', nextStep: null, pathname: '/sign-in' })).toEqual({ type: 'finish', fallback: '/' });
    expect(routeForSession({ status: 'member', nextStep: null, pathname: '/welcome' })).toEqual({ type: 'finish', fallback: '/' });
    expect(routeForSession({ status: 'member', nextStep: null, pathname: '/garage' })).toEqual({ type: 'stay' });
  });

  it('sends a guest from the member steps to sign-in and leaves the rest alone', () => {
    expect(routeForSession({ status: 'guest', pathname: '/username' })).toEqual({ type: 'go', path: '/sign-in' });
    expect(routeForSession({ status: 'guest', pathname: '/profile-setup' })).toEqual({ type: 'go', path: '/sign-in' });
    expect(routeForSession({ status: 'guest', pathname: '/verify-email' })).toEqual({ type: 'stay' });
    expect(routeForSession({ status: 'guest', pathname: '/garage' })).toEqual({ type: 'stay' });
  });
});

describe('after a session ended', () => {
  it('keeps a guest on what guests may see, and nothing else', () => {
    for (const path of ['/', '/discover', '/v/skyline', '/u/lukas.sc', '/c/8TR0Q3MC', '/garage', '/settings/legal/terms', '/sign-in']) {
      expect(isGuestPath(path)).toBe(true);
    }
    for (const path of ['/profile/edit', '/garage/01H/basics', '/add-vehicle/new/vehicle', '/messages/01H', '/settings/appearance']) {
      expect(isGuestPath(path)).toBe(false);
    }
  });

  it('remembers the wizard after onboarding once', () => {
    openAfterOnboarding('/add-vehicle/new/vehicle');
    expect(consumeAfterOnboarding()).toBe('/add-vehicle/new/vehicle');
    expect(consumeAfterOnboarding()).toBeNull();
  });
});

describe('returnTo from the URL', () => {
  it.each([
    ['https://evil.example/phish'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/%2F%2Fevil.example'],
    ['javascript:alert(1)'],
  ])('ignores %s', async (returnTo) => {
    await renderHook(() => useReturnToParam({ returnTo }));
    expect(useSessionStore.getState().intent).toBeNull();
    expect(completeAuthIntent()).toBeUndefined();
  });

  it('takes an internal path from returnTo or from next (public pages)', async () => {
    await renderHook(() => useReturnToParam({ next: '/v/nissan-skyline-gt-r-r34-5tf974vj' }));
    expect(completeAuthIntent()).toBe('/v/nissan-skyline-gt-r-r34-5tf974vj');
  });

  it('keeps an intent from the auth sheet, which carries an action as well', async () => {
    const action = jest.fn();
    openAuthPrompt({ action, returnTo: '/v/skyline' });
    await renderHook(() => useReturnToParam({ returnTo: '/discover' }));
    expect(completeAuthIntent()).toBe('/v/skyline');
    expect(action).toHaveBeenCalledTimes(1);
  });
});
