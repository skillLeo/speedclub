/**
 * R4B-003: on web the address AUTH-04 hands to AUTH-05 survives a reload of the tab (the phone browser reloads it while the member
 * reads the code mail), never in the URL, and only for HANDOFF_TTL_MS, for that route, and until who is signed in changes.
 */
import {
  __setHandoffStorageForTests,
  forgetHandedEmail,
  handEmailTo,
  handedEmailFor,
  HANDOFF_TTL_MS,
} from '@/features/auth/emailHandoff';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** A reload: the module's memory is gone, the tab's storage is not. */
function reload(storage: ReturnType<typeof memoryStorage>): void {
  __setHandoffStorageForTests(storage);
}

afterEach(() => {
  jest.useRealTimers();
  __setHandoffStorageForTests(undefined);
});

describe('email hand-off across a reload (web)', () => {
  it('finds the address again after a reload, for its route only', () => {
    const storage = memoryStorage();
    __setHandoffStorageForTests(storage);
    handEmailTo('/verify-email', ' mara@example.de ');
    reload(storage);
    expect(handedEmailFor('/verify-email')).toBe('mara@example.de');
    expect(handedEmailFor('/sign-in')).toBeUndefined();
  });

  it('forgets it when it is cleared (a change of member) and after the time limit', () => {
    jest.useFakeTimers({ now: new Date('2026-11-21T10:00:00Z') });
    const storage = memoryStorage();
    __setHandoffStorageForTests(storage);
    handEmailTo('/verify-email', 'mara@example.de');
    forgetHandedEmail();
    reload(storage);
    expect(handedEmailFor('/verify-email')).toBeUndefined();

    handEmailTo('/verify-email', 'mara@example.de');
    jest.setSystemTime(new Date(Date.now() + HANDOFF_TTL_MS + 1));
    reload(storage);
    expect(handedEmailFor('/verify-email')).toBeUndefined();
    expect(storage.items.size).toBe(0);
  });

  it('keeps working in memory where the tab has no storage', () => {
    __setHandoffStorageForTests(null);
    handEmailTo('/verify-email', 'mara@example.de');
    expect(handedEmailFor('/verify-email')).toBe('mara@example.de');
  });
});
