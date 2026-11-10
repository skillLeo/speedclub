import { renderHook } from '@testing-library/react-native';

import {
  abandonAuthIntent,
  clearAuthIntent,
  closeAuthPromptKeepingIntent,
  completeAuthIntent,
  dismissAuthPrompt,
  isInternalPath,
  openAuthPrompt,
  registerSessionRestore,
  restoreSession,
  setGuest,
  setMember,
  useRequireAuth,
  useSessionStore,
} from '@/state/session';

const member = { id: '1', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null };

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', member: null, promptOpen: false, intent: null });
});

describe('useRequireAuth', () => {
  it('runs the action at once for a member', async () => {
    setMember(member);
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();
    expect(result.current(action)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().promptOpen).toBe(false);
  });

  it('opens the sheet for a guest and holds the action back', async () => {
    setGuest();
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();
    expect(result.current(action, { returnTo: '/v/skyline' })).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({ promptOpen: true, intent: { returnTo: '/v/skyline' } });
  });

  it('after sign-in the remembered action runs once and returns the path', async () => {
    setGuest();
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();
    result.current(action, { returnTo: '/garage' });
    closeAuthPromptKeepingIntent();
    expect(useSessionStore.getState().promptOpen).toBe(false);
    expect(useSessionStore.getState().intent).not.toBeNull();

    setMember(member);
    expect(completeAuthIntent()).toBe('/garage');
    expect(action).toHaveBeenCalledTimes(1);
    expect(completeAuthIntent()).toBeUndefined();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('cancelling forgets the action', async () => {
    setGuest();
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();
    result.current(action);
    dismissAuthPrompt();
    expect(useSessionStore.getState()).toMatchObject({ promptOpen: false, intent: null });
    completeAuthIntent();
    expect(action).not.toHaveBeenCalled();
  });
});

describe('useRequireAuth while the session is restored', () => {
  it('ignores the tap: no action, no sheet', async () => {
    const { result } = await renderHook(() => useRequireAuth());
    const action = jest.fn();
    expect(useSessionStore.getState().status).toBe('loading');
    expect(result.current(action, { returnTo: '/garage' })).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({ promptOpen: false, intent: null });
  });
});

describe('an abandoned intent', () => {
  it('leaving the auth screens as a guest forgets it, so a later sign-in runs nothing', () => {
    setGuest();
    const action = jest.fn();
    openAuthPrompt({ action, returnTo: '/garage' });
    closeAuthPromptKeepingIntent();

    abandonAuthIntent();
    expect(useSessionStore.getState().intent).toBeNull();

    setMember(member);
    expect(completeAuthIntent()).toBeUndefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('a member keeps it until completeAuthIntent runs it', () => {
    const action = jest.fn();
    openAuthPrompt({ action, returnTo: '/garage' });
    closeAuthPromptKeepingIntent();
    setMember(member);

    abandonAuthIntent();
    expect(completeAuthIntent()).toBe('/garage');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('a new sheet opened while the stack animates out keeps its own intent', () => {
    setGuest();
    openAuthPrompt({ returnTo: '/discover' });
    abandonAuthIntent();
    expect(useSessionStore.getState().intent).toEqual({ returnTo: '/discover' });
  });

  it('a direct way into sign-in starts clean', () => {
    setGuest();
    openAuthPrompt({ returnTo: '/garage' });
    closeAuthPromptKeepingIntent();
    clearAuthIntent();
    expect(useSessionStore.getState().intent).toBeNull();
  });
});

describe('isInternalPath', () => {
  it.each(['/', '/garage', '/v/skyline-r34', '/v/skyline-r34?tab=mods', '/add-vehicle/new/vehicle', '/v/gr%C3%BCn'])(
    'accepts %s',
    (path) => {
      expect(isInternalPath(path)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['relative', 'garage'],
    ['bare host', 'evil.example'],
    ['protocol-relative', '//evil.example'],
    ['three slashes', '///evil.example'],
    ['double slash later on', '/garage//evil.example'],
    ['absolute URL', 'https://evil.example'],
    ['scheme after the slash', '/https://evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['app scheme', 'speedclub://garage'],
    ['backslash host', '\\\\evil.example'],
    ['slash and backslash', '/\\evil.example'],
    ['tab that browsers drop', '/\t/evil.example'],
    ['newline that browsers drop', '/\n/evil.example'],
    ['encoded slash', '/%2Fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['encoded tab', '/%09/evil.example'],
    ['broken encoding', '/%E0%A4%A'],
  ])('rejects %s', (_name, path) => {
    expect(isInternalPath(path)).toBe(false);
  });

  it.each([[undefined], [null], [42], [['/garage']], [{}]])('rejects the non-string %j', (value) => {
    expect(isInternalPath(value)).toBe(false);
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example'])(
    'completeAuthIntent runs the action but never returns %s',
    (returnTo) => {
      const action = jest.fn();
      openAuthPrompt({ action, returnTo });
      expect(completeAuthIntent()).toBeUndefined();
      expect(action).toHaveBeenCalledTimes(1);
    },
  );
});

describe('restoreSession', () => {
  afterEach(() => registerSessionRestore(() => Promise.resolve(null)));

  it('is a guest when nothing is restored', async () => {
    registerSessionRestore(() => Promise.resolve(null));
    await restoreSession();
    expect(useSessionStore.getState().status).toBe('guest');
  });

  it('is a member when the restore finds one', async () => {
    registerSessionRestore(() => Promise.resolve(member));
    await restoreSession();
    expect(useSessionStore.getState()).toMatchObject({ status: 'member', member });
  });

  it('a failing restore means a guest, not a rejection', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerSessionRestore(() => Promise.reject(new Error('keychain')));
    await expect(restoreSession()).resolves.toBeUndefined();
    expect(useSessionStore.getState().status).toBe('guest');
    warn.mockRestore();
  });
});
