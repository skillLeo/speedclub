/** M5.9d unlock (contract §2, §8): one toast with the success haptic per app start, then `POST me/badges/seen`; more stack. */
import { act, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { resetBadgeUnlockForTests, useBadgeUnlockToast } from '@/features/gift/components/BadgeUnlock';
import { hydrateThemePreference } from '@/theme';
import { dismissToast } from '@/ui';
import { ToastHost } from '@/ui/ToastHost';

import { BADGES, newQueryClient, renderScreen, signIn, signOut, stubApi } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  AndroidHaptics: { Confirm: 'confirm', Reject: 'reject', Segment_Tick: 'tick', Virtual_Key: 'key', Long_Press: 'long' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

function Host({ routeId }: { routeId: string }) {
  useBadgeUnlockToast(routeId);
  return <ToastHost />;
}

const earned = BADGES.filter((badge) => badge.earned_at !== null);

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  resetBadgeUnlockForTests();
  signIn();
});
afterEach(async () => {
  await act(async () => {
    dismissToast();
  });
});

describe('badge unlock toast', () => {
  it('names one new badge, plays the success haptic and marks it seen', async () => {
    const { calls } = stubApi({ 'GET /me/badges?unseen=1': { body: { data: earned.slice(1, 2) } }, 'POST /me/badges/seen': { status: 204 } });
    await renderScreen(<Host routeId="HOME-01" />);
    expect(await screen.findByText('Neues Abzeichen: Crew Starter')).toBeTruthy();
    expect(screen.getByText('Ansehen')).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/me/badges/seen'))).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ keys: ['crew_starter'] });
    // Native only (ToastHost): the success notification haptic, once.
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('stacks several into one toast: "2 neue Abzeichen"', async () => {
    const { calls } = stubApi({ 'GET /me/badges?unseen=1': { body: { data: earned } }, 'POST /me/badges/seen': { status: 204 } });
    await renderScreen(<Host routeId="HOME-01" />);
    expect(await screen.findByText('2 neue Abzeichen')).toBeTruthy();
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ keys: ['founding_member', 'crew_starter'] });
  });

  it('never shows a second toast in the same app run, from any screen', async () => {
    const { calls } = stubApi({ 'GET /me/badges?unseen=1': { body: { data: earned.slice(0, 1) } }, 'POST /me/badges/seen': { status: 204 } });
    await renderScreen(<Host routeId="HOME-01" />);
    expect(await screen.findByText('Neues Abzeichen: Founding Member')).toBeTruthy();
    await act(async () => {
      dismissToast();
    });
    // Profil mounts the same hook later in the run, with its own cache.
    await renderScreen(<Host routeId="PROF-01" />, newQueryClient());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByText('Neues Abzeichen: Founding Member')).toBeNull();
    expect(calls.filter((call) => call.search === '?unseen=1')).toHaveLength(1);
  });

  it('asks nothing and shows nothing without new badges, or for a guest', async () => {
    const { calls } = stubApi({ 'GET /me/badges?unseen=1': { body: { data: [] } } });
    await renderScreen(<Host routeId="HOME-01" />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByText(/Abzeichen/)).toBeNull();
    signOut();
    resetBadgeUnlockForTests();
    const guest = stubApi({});
    await renderScreen(<Host routeId="HOME-01" />, newQueryClient());
    expect(guest.calls).toHaveLength(0);
  });
});
