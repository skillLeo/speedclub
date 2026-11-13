// M4.15 follow-up (ADR-452): after every sign-in on the web, a browser that already has notifications on posts its subscription again,
// so the new session owns it and "Alle anderen Geräte abmelden" from a later session does not silently drop this browser.
import { isSignIn, relinkWebPushAfterSignIn } from '@/features/pwa/webPush';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const mockSave = jest.fn();
jest.mock('@/api/queries/webPush', () => ({
  ...jest.requireActual<object>('@/api/queries/webPush'),
  savePushSubscription: (...args: unknown[]) => mockSave(...args),
}));
let mockSubscription: { toJSON: () => unknown } | null = null;
jest.mock('@/features/pwa/serviceWorker', () => ({
  ...jest.requireActual<object>('@/features/pwa/serviceWorker'),
  serviceWorkerRegistration: () => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(mockSubscription) } }),
}));

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const subscription = { toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } }) };
const member = (id: string) => ({ id });

function permission(value: 'granted' | 'default' | 'denied') {
  (globalThis as unknown as { window: { Notification?: { permission: string } } }).window.Notification = { permission: value };
}

beforeEach(() => {
  mockSave.mockReset();
  mockSubscription = null;
});

describe('Web Push after a sign-in', () => {
  it('counts a sign-in, and another member, but not a restored session or a sign-out', () => {
    expect(isSignIn({ status: 'guest', member: null }, { status: 'member', member: member('a') })).toBe(true);
    expect(isSignIn({ status: 'member', member: member('a') }, { status: 'member', member: member('b') })).toBe(true);
    expect(isSignIn({ status: 'loading', member: null }, { status: 'member', member: member('a') })).toBe(false);
    expect(isSignIn({ status: 'member', member: member('a') }, { status: 'member', member: member('a') })).toBe(false);
    expect(isSignIn({ status: 'member', member: member('a') }, { status: 'guest', member: null })).toBe(false);
  });

  it('posts the existing subscription again for the new session', async () => {
    permission('granted');
    mockSubscription = subscription;
    mockSave.mockResolvedValue('saved');
    await expect(relinkWebPushAfterSignIn()).resolves.toBe('relinked');
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ endpoint: ENDPOINT, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } }));
  });

  it('asks nothing and creates nothing when notifications are not on in this browser', async () => {
    permission('default');
    mockSubscription = subscription;
    await expect(relinkWebPushAfterSignIn()).resolves.toBe('none');
    permission('granted');
    mockSubscription = null;
    await expect(relinkWebPushAfterSignIn()).resolves.toBe('none');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a server without Web Push or a failed call changes nothing', async () => {
    permission('granted');
    mockSubscription = subscription;
    mockSave.mockResolvedValueOnce('unavailable');
    await expect(relinkWebPushAfterSignIn()).resolves.toBe('unavailable');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockSave.mockRejectedValueOnce(new Error('network'));
    await expect(relinkWebPushAfterSignIn()).resolves.toBe('failed');
    warn.mockRestore();
  });
});
