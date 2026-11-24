/**
 * M5.7 SET-09 rows (m5.7-contract §8.2): "Build-Erinnerungen" (plan_due) and "Wochenrückblick" (weekly_recap, push and e-mail), each
 * its own switch, shown only once the server lists the type; and the milestone toast for the new badges (10 §6.4, M5.9d flow).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import type { NotificationPrefs } from '@/api/queries/settings';
import { resetBadgeUnlockForTests, useBadgeUnlockToast } from '@/features/gift/components/BadgeUnlock';
import { EngagementSwitches, engagementGroups, engagementPatch, engagementValue } from '@/features/insights/components/EngagementSwitches';
import { hydrateThemePreference } from '@/theme';
import { dismissToast } from '@/ui';
import { ToastHost } from '@/ui/ToastHost';

import { renderScreen, signIn, stubApi } from '../gift/helpers';

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

const prefs = (types: Record<string, unknown>): NotificationPrefs =>
  ({ types, quiet_hours: { enabled: false, from: '22:00', to: '08:00' }, message_previews: false, digest_frequency: 'weekly' }) as unknown as NotificationPrefs;

const LISTED = prefs({ plan_due: { push: true, web_push: false }, weekly_recap: { push: false, web_push: true, email: true } });

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  signIn();
});

describe('SET-09 engagement rows', () => {
  it('offers nothing while the server does not list the types', () => {
    expect(engagementGroups(prefs({ new_follower: { push: true, web_push: false } }), 'push')).toEqual([]);
    expect(engagementValue(prefs({}), 'weekly_recap', 'email')).toBeNull();
  });

  it('offers each listed type with its own value per channel, the recap with its e-mail switch', () => {
    expect(engagementGroups(LISTED, 'push')).toEqual([
      { type: 'plan_due', push: true, email: null },
      { type: 'weekly_recap', push: false, email: true },
    ]);
    expect(engagementGroups(LISTED, 'web_push')).toEqual([
      { type: 'plan_due', push: false, email: null },
      { type: 'weekly_recap', push: true, email: true },
    ]);
    // A listed type without a value takes the contract's default (on).
    expect(engagementValue(prefs({ weekly_recap: {} }), 'weekly_recap', 'email')).toBe(true);
    expect(engagementPatch('weekly_recap', 'email', false)).toEqual({ notification_prefs: { types: { weekly_recap: { email: false } } } });
  });

  it('renders the rows and sends one switch at a time', async () => {
    const send = jest.fn();
    await renderScreen(<EngagementSwitches prefs={LISTED} channel="push" send={send} disabled={false} routeId="SET-09" />);
    expect(screen.getByText('Build-Erinnerungen')).toBeTruthy();
    expect(screen.getByText('Wochenrückblick per E-Mail')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('SET-09.push.weekly_recap.switch'));
    await fireEvent.press(screen.getByTestId('SET-09.email.weekly_recap.switch'));
    expect(send.mock.calls).toEqual([
      [{ notification_prefs: { types: { weekly_recap: { push: true } } } }],
      [{ notification_prefs: { types: { weekly_recap: { email: false } } } }],
    ]);
  });

  it('draws nothing for an older server', async () => {
    await renderScreen(<EngagementSwitches prefs={prefs({})} channel="push" send={jest.fn()} disabled={false} routeId="SET-09" />);
    expect(screen.queryByTestId('SET-09.plan_due')).toBeNull();
    expect(screen.queryByTestId('SET-09.weekly_recap')).toBeNull();
  });
});

function Host() {
  useBadgeUnlockToast('PROF-01');
  return <ToastHost />;
}

describe('milestones (10 §6.4)', () => {
  beforeEach(resetBadgeUnlockForTests);
  afterEach(async () => {
    await act(async () => {
      dismissToast();
    });
  });

  it('"100 Aufrufe" unlocks once: one toast, one success haptic, then marked seen', async () => {
    const badge = { key: '100-aufrufe', name: '100 Aufrufe', description: 'Deine Builds und dein Profil wurden 100-mal angesehen.', hint: null, hidden: false, tier: 'bronze', category: 'garage', earned_at: '2026-11-16T03:10:00Z', sort: 12 };
    const { calls } = stubApi({ 'GET /me/badges?unseen=1': { body: { data: [badge] } }, 'POST /me/badges/seen': { status: 204 } });
    await renderScreen(<Host />);
    expect(await screen.findByText('Neues Abzeichen: 100 Aufrufe')).toBeTruthy();
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ keys: ['100-aufrufe'] }));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('"Hilfreich" from the forum stacks with another into one toast', async () => {
    const helpful = { key: 'hilfreich-10', name: 'Hilfreich', description: 'Deine Forum-Antworten wurden zehnmal als hilfreich markiert.', hint: null, hidden: false, tier: 'silver', category: 'forum', earned_at: '2026-11-16T03:10:00Z', sort: 30 };
    const views = { ...helpful, key: '100-aufrufe', name: '100 Aufrufe', category: 'garage', tier: 'bronze' };
    stubApi({ 'GET /me/badges?unseen=1': { body: { data: [helpful, views] } }, 'POST /me/badges/seen': { status: 204 } });
    await renderScreen(<Host />);
    expect(await screen.findByText('2 neue Abzeichen')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });
});
