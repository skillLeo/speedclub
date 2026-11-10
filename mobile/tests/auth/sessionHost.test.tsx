// What the session does to the route: SessionHost's routing effect, its dialog and the member's refresh.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { adoptMe, meKey, type Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { primerAnswered, usePrimerStore } from '@/features/auth/primer';
import { SessionHost } from '@/features/auth/SessionHost';
import { VerifyEmailNotice } from '@/features/auth/VerifyEmailNotice';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, stubFetch } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true) };
let mockPathname = '/';
const mockPathListeners = new Set<() => void>();
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // Imports run first, before the const above has its value.
  get router() {
    return mockRouter;
  },
  usePathname: () =>
    jest.requireActual<typeof import('react')>('react').useSyncExternalStore(
      (listener) => {
        mockPathListeners.add(listener);
        return () => mockPathListeners.delete(listener);
      },
      () => mockPathname,
    ),
  useRootNavigationState: () => ({ key: 'root' }),
  // The stack and what happens to it are in memberChangeRouter.test.tsx, with the real router.
  useNavigationContainerRef: () => ({ getRootState: () => undefined, dispatch: jest.fn() }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ME: Me = {
  id: '01lukas',
  email: 'lukas@speedclub.test',
  email_verified: true,
  has_username: true,
  profile_complete: true,
  next_step: null,
  force_password_change: false,
  two_factor_enabled: false,
  username: 'lukas.sc',
  username_change_available_at: null,
  display_name: 'Lukas',
  city: null,
  bio: null,
  avatar: null,
  cover: null,
  locale: 'de',
  theme: 'carbon',
  power_display: 'ps_kw',
  member_since: '2023-03-12T10:00:00+00:00',
  stats: { vehicles: 0, followers: 0, following: 0 },
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
};
const OTHER: Me = { ...ME, id: '01nina', username: 'nina.neu', display_name: 'Nina', email: 'nina@speedclub.test' };
const memberOf = (me: Me, nextStep: Me['next_step'] = null) => ({ id: me.id, username: me.username ?? '', displayName: me.display_name, avatarUrl: null, nextStep });
const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const mount = () => renderScreen(<SessionHost />, queryClient);
const goTo = (pathname: string) =>
  act(async () => {
    mockPathname = pathname;
    mockPathListeners.forEach((listener) => listener());
  });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = '/';
  queryClient.clear();
  useSessionStore.setState({ status: 'guest', member: null, promptOpen: false, intent: null, notice: null, passwordChangeEmail: null, expiredFrom: null, memberChanged: false });
  usePrimerStore.setState({ state: 'idle' });
  stubFetch({ '/auth/me': { body: { data: ME } } });
});
afterEach(() => queryClient.clear());

describe('a step that interrupts a deep link (BH-29)', () => {
  it('keeps the link for after the step, and resumes it once', async () => {
    mockPathname = '/c/8TR0Q3MC';
    setMember(memberOf(ME, 'choose_username'));
    queryClient.setQueryData(meKey, { ...ME, next_step: 'choose_username' });
    await mount();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/username'));
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/c/8TR0Q3MC' });

    // The replace brings the member to the step: nothing there overwrites the link.
    await goTo('/username');
    await tick();
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/c/8TR0Q3MC' });

    mockRouter.replace.mockClear();
    await goTo('/profile-setup');
    await act(async () => {
      setMember(memberOf(ME));
      queryClient.setQueryData(meKey, ME);
    });
    // AUTH-10 joins F1 on native, after the profile and before the link (M2.2).
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/notifications-primer'));
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/c/8TR0Q3MC' });
    await goTo('/notifications-primer');
    await tick();
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/c/8TR0Q3MC');
    await act(() => primerAnswered());
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/c/8TR0Q3MC'));
    expect(useSessionStore.getState().intent).toBeNull();
  });

  it('leaves an intent alone that is already there', async () => {
    mockPathname = '/garage';
    setMember(memberOf(ME, 'verify_email'));
    queryClient.setQueryData(meKey, { ...ME, next_step: 'verify_email' });
    useSessionStore.setState({ intent: { returnTo: '/v/skyline' } });
    await mount();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/verify-email'));
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/v/skyline' });
  });

  it('does not send an unverified member away from a browse path', async () => {
    mockPathname = '/v/skyline';
    setMember(memberOf(ME, 'verify_email'));
    queryClient.setQueryData(meKey, { ...ME, next_step: 'verify_email' });
    await mount();
    await tick();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('another member behind the session (BH-28)', () => {
  it('useMemberSync: a fetched Me of another member clears the cache and goes home', async () => {
    mockPathname = '/garage';
    setMember(memberOf(ME));
    queryClient.setQueryData(['me', 'vehicles'], ['Lukas']);
    stubFetch({ '/auth/me': { body: { data: OTHER } } });
    await mount();
    await waitFor(() => expect(useSessionStore.getState().member?.id).toBe(OTHER.id));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(queryClient.getQueryData(['me', 'vehicles'])).toBeUndefined();
    await waitFor(() => expect(useSessionStore.getState().memberChanged).toBe(false));
  });

  it('the same member just stays current', async () => {
    mockPathname = '/garage';
    setMember(memberOf(ME));
    queryClient.setQueryData(['me', 'vehicles'], ['Lukas']);
    stubFetch({ '/auth/me': { body: { data: { ...ME, display_name: 'Lukas S.' } } } });
    await mount();
    await waitFor(() => expect(useSessionStore.getState().member?.displayName).toBe('Lukas S.'));
    await tick();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['me', 'vehicles'])).toEqual(['Lukas']);
  });
});

describe('the expired dialog with a form held behind it (BH-30)', () => {
  const EDITOR = '/garage/01H/basics';
  function expiredOnEditor() {
    mockPathname = EDITOR;
    useSessionStore.setState({ status: 'guest', member: null, notice: { kind: 'expired' }, expiredFrom: ME.id });
  }

  it('Anmelden opens the sign-in over the editor, which stays', async () => {
    expiredOnEditor();
    await mount();
    await fireEvent.press(screen.getByTestId('AUTH.sessionNotice.signIn'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/sign-in', params: { returnTo: EDITOR } });
    expect(useSessionStore.getState()).toMatchObject({ notice: null, expiredFrom: ME.id });
    await tick();
    // Still on the editor for this tick: the dialog must not come back by itself.
    expect(useSessionStore.getState().notice).toBeNull();
  });

  it('the same member comes back to the editor that is there, not to a second one', async () => {
    expiredOnEditor();
    useSessionStore.setState({ notice: null, intent: { returnTo: EDITOR } });
    mockPathname = '/sign-in';
    await mount();
    await act(async () => adoptMe(ME));
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith(EDITOR));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({ expiredFrom: null, intent: null });
  });

  it('another member goes home, without what the first one wanted', async () => {
    expiredOnEditor();
    useSessionStore.setState({ notice: null, intent: { returnTo: EDITOR } });
    mockPathname = '/sign-in';
    await mount();
    await act(async () => adoptMe(OTHER));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalledWith(EDITOR);
  });

  it('without a held form a sign-in goes on as before', async () => {
    useSessionStore.setState({ intent: { returnTo: '/profile' } });
    mockPathname = '/sign-in';
    await mount();
    await act(async () => adoptMe(ME));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/profile'));
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });

  it('Als Gast weiter lets the form go first, and only then leaves for Welcome', async () => {
    expiredOnEditor();
    queryClient.setQueryData(meKey, ME);
    let holdAtReplace: string | null | undefined;
    mockRouter.replace.mockImplementationOnce(() => {
      holdAtReplace = useSessionStore.getState().expiredFrom;
    });
    await mount();
    await fireEvent.press(screen.getByTestId('AUTH.sessionNotice.guest'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/welcome'));
    expect(holdAtReplace).toBeNull();
    expect(queryClient.getQueryData(meKey)).toBeUndefined();
  });

  it('leaving the sign-in without signing in asks again: the member has not chosen yet', async () => {
    mockPathname = '/sign-in';
    useSessionStore.setState({ status: 'guest', member: null, notice: null, expiredFrom: ME.id });
    await mount();
    await goTo(EDITOR);
    await waitFor(() => expect(useSessionStore.getState().notice).toEqual({ kind: 'expired' }));
  });
});

describe('the prompt to verify on browse paths (BH-29)', () => {
  const unverified = () => setMember(memberOf(ME, 'verify_email'));

  it.each(['/', '/discover', '/discover/search', '/v/skyline', '/c/8TR0Q3MC', '/settings/legal/terms'])('shows on %s, with a way to AUTH-05', async (pathname) => {
    mockPathname = pathname;
    unverified();
    await renderScreen(<VerifyEmailNotice />);
    // U+2060 after "E-": the word never breaks after its one-letter prefix (DQ-145 family). The form by font size: verifyNotice.test.tsx.
    expect(screen.getByTestId('shell.verifyNotice')).toHaveTextContent('E-\u2060Mail', { exact: false });
    await fireEvent.press(screen.getByTestId('shell.verifyNotice.action'));
    expect(mockRouter.push).toHaveBeenCalledWith('/verify-email');
  });

  it('keeps a real page for after the steps, and Home is no such page', async () => {
    mockPathname = '/v/skyline';
    unverified();
    await renderScreen(<VerifyEmailNotice />);
    await fireEvent.press(screen.getByTestId('shell.verifyNotice.action'));
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/v/skyline' });

    useSessionStore.setState({ intent: null });
    mockPathname = '/';
    await renderScreen(<VerifyEmailNotice />);
    await fireEvent.press(screen.getAllByTestId('shell.verifyNotice.action')[0]!);
    expect(useSessionStore.getState().intent).toBeNull();
  });

  it.each([
    ['a guest', () => useSessionStore.setState({ status: 'guest', member: null })],
    ['a verified member', () => setMember(memberOf(ME))],
    ['a member at the username step', () => setMember(memberOf(ME, 'choose_username'))],
  ])('stays away from %s', async (_name, arrange) => {
    arrange();
    await renderScreen(<VerifyEmailNotice />);
    expect(screen.queryByTestId('shell.verifyNotice')).toBeNull();
  });

  it('stays out of screens that are not for browsing', async () => {
    mockPathname = '/verify-email';
    unverified();
    await renderScreen(<VerifyEmailNotice />);
    expect(screen.queryByTestId('shell.verifyNotice')).toBeNull();
  });
});
