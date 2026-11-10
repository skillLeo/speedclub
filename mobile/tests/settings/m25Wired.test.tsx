import { StyleSheet } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/client';
import { memberSettingsKey } from '@/api/queries/settings';
import type { MemberSettings } from '@/api/queries/auth';
import { TwoFactorChallengeScreen } from '@/features/auth/screens/TwoFactorChallengeScreen';
import { forgetTwoFactorChallenge, holdTwoFactorChallenge } from '@/features/auth/twoFactorChallenge';
import { LanguageScreen } from '@/features/settings/screens/LanguageScreen';
import { NotificationSettingsScreen } from '@/features/settings/screens/NotificationSettingsScreen';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch } from './harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({}),
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
const mockQa: { state: 'default' | 'loading' | 'empty' | 'error' | 'offline' | 'restricted' } = { state: 'default' };
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));
const mockChallenge = jest.fn();
jest.mock('@/api/queries/auth', () => {
  const actual = jest.requireActual<typeof import('@/api/queries/auth')>('@/api/queries/auth');
  const { useMutation } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useTwoFactorChallenge: () => useMutation({ mutationFn: (input: unknown) => mockChallenge(input) }) };
});

const SETTINGS: MemberSettings = {
  theme: 'carbon',
  locale: 'de',
  power_display: 'ps_kw',
  show_owner_on_qr: true,
  who_can_message: 'everyone',
  discoverable: true,
  indexable: true,
  read_receipts: true,
  ai_suggestions: false,
  notification_prefs: {
    types: {
      new_follower: { push: true },
      followed_published: { push: false },
      build_saved: { push: false },
      new_message: { push: true, email_digest: false },
      message_request: { push: true },
      hu_au_reminder: { push: true, email: false },
      qr_milestone: { push: false },
    },
    quiet_hours: { enabled: true, from: '22:00', to: '07:00' },
    message_previews: false,
  },
};

async function bodies(calls: Request[], path: string): Promise<unknown[]> {
  const matching = calls.filter((request) => new URL(request.url).pathname.endsWith(path) && request.method === 'PATCH');
  return Promise.all(matching.map(async (request) => JSON.parse(await request.clone().text()) as unknown));
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  forgetTwoFactorChallenge();
});
afterEach(async () => {
  await act(async () => useSessionStore.setState({ status: 'guest', member: null }));
});

describe('AUTH-11 two-factor challenge', () => {
  it('without a challenge sends the member back to sign in', async () => {
    await renderScreen(<TwoFactorChallengeScreen />);
    expect(screen.getByTestId('AUTH-11.notice')).toHaveTextContent(/abgelaufen/);
    await fireEvent.press(screen.getByTestId('AUTH-11.cta.primary'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('a QA cell (qaState=empty) shows the code form without a live challenge, and sends nothing (M2.8 capture)', async () => {
    mockQa.state = 'empty';
    try {
      await renderScreen(<TwoFactorChallengeScreen />);
      expect(screen.getByTestId('AUTH-11.code')).toBeTruthy();
      expect(screen.queryByTestId('AUTH-11.notice')).toBeNull();
      await fireEvent.changeText(screen.getByTestId('AUTH-11.code'), '123456');
      await fireEvent.press(screen.getByTestId('AUTH-11.cta.primary'));
      expect(mockChallenge).not.toHaveBeenCalled();
    } finally {
      mockQa.state = 'default';
    }
  });

  it('restricted: the info hint that signing in still works, not the generic "not available" band (DQ-437)', async () => {
    mockQa.state = 'restricted';
    try {
      await renderScreen(<TwoFactorChallengeScreen />);
      expect(screen.getByTestId('AUTH-11.notice')).toHaveTextContent('Du kannst dich anmelden', { exact: false });
      expect(screen.getByTestId('AUTH-11.notice')).not.toHaveTextContent('nicht zur Verfügung', { exact: false });
      expect(screen.getByTestId('AUTH-11.code')).toBeTruthy();
    } finally {
      mockQa.state = 'default';
    }
  });

  it('loading: the skeleton CTA carries the form label "Anmelden", not the expired one (DQ-441)', async () => {
    mockQa.state = 'loading';
    try {
      await renderScreen(<TwoFactorChallengeScreen />);
      expect(screen.getByTestId('AUTH-11.cta.primary')).toHaveTextContent('Anmelden', { exact: false });
      expect(screen.getByTestId('AUTH-11.cta.primary')).not.toHaveTextContent('Zur Anmeldung', { exact: false });
    } finally {
      mockQa.state = 'default';
    }
  });

  it('the subtitle wraps without hyphenating "Authenticator-App" (DQ-440)', async () => {
    mockQa.state = 'empty';
    try {
      await renderScreen(<TwoFactorChallengeScreen />);
      const subtitle = screen.getByTestId('AUTH-11.subtitle');
      expect(subtitle).toHaveTextContent('Authenticator-App', { exact: false });
      expect((StyleSheet.flatten(subtitle.props.style) as { hyphens?: string }).hyphens).not.toBe('auto');
    } finally {
      mockQa.state = 'default';
    }
  });

  it('sends six digits with the challenge, and a recovery code instead on request', async () => {
    holdTwoFactorChallenge('challenge-1');
    mockChallenge.mockRejectedValueOnce(new ApiError({ kind: 'validation', status: 422, code: 'invalid_code', message: 'Falsch.' }));
    mockChallenge.mockResolvedValueOnce(undefined);
    await renderScreen(<TwoFactorChallengeScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-11.code'), '123456');
    await waitFor(() => expect(mockChallenge).toHaveBeenCalledWith({ challenge: 'challenge-1', code: '123456' }));
    await waitFor(() => expect(screen.getByText(/Dieser Code stimmt nicht/)).toBeTruthy());

    await fireEvent.press(screen.getByTestId('AUTH-11.toggle'));
    await fireEvent.changeText(screen.getByTestId('AUTH-11.recovery'), 'abcd-efgh');
    await fireEvent.press(screen.getByTestId('AUTH-11.cta.primary'));
    await waitFor(() => expect(mockChallenge).toHaveBeenLastCalledWith({ challenge: 'challenge-1', recoveryCode: 'abcd-efgh' }));
  });
});

describe('AUTH-11 locked second factor (ADR-203 f)', () => {
  it('says so calmly, holds the button until the code changes, and keeps the member where they are', async () => {
    holdTwoFactorChallenge('challenge-2');
    mockChallenge.mockRejectedValueOnce(new ApiError({ kind: 'forbidden', status: 403, code: 'second_factor_locked', message: 'Gesperrt.' }));
    await renderScreen(<TwoFactorChallengeScreen />);
    await fireEvent.changeText(screen.getByTestId('AUTH-11.code'), '123456');
    await waitFor(() => expect(screen.getByTestId('AUTH-11.notice')).toHaveTextContent(/Zwei-Faktor-Prüfung ist gesperrt/));
    expect(screen.getByTestId('AUTH-11.notice').props.role).toBe('status');
    expect(screen.getByTestId('AUTH-11.cta.primary')).toBeDisabled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('AUTH-11.code'), '12345');
    expect(screen.getByTestId('AUTH-11.cta.primary')).not.toBeDisabled();
  });
});

describe('wired settings', () => {
  beforeEach(async () => {
    await act(async () => setMember({ id: 'm1', username: 'lukas.sc', displayName: null, avatarUrl: null }));
  });

  it('SET-11 shows the live example and saves the power display to the account', async () => {
    const { calls } = stubFetch({ '/me/settings': () => ({ body: { data: { ...SETTINGS, power_display: 'kw_ps' } } }) });
    const client = newQueryClient();
    client.setQueryData(memberSettingsKey, SETTINGS);
    await renderScreen(<LanguageScreen />, client);
    expect(screen.getByTestId('SET-11.example')).toHaveTextContent('510 PS (375 kW)');
    await fireEvent.press(screen.getByTestId('SET-11.power.kw_ps'));
    await waitFor(() => expect(screen.getByTestId('SET-11.example')).toHaveTextContent('375 kW (510 PS)'));
    expect(await bodies(calls, '/me/settings')).toEqual([{ power_display: 'kw_ps' }]);
  });

  it('SET-09 switches one push type and keeps message previews off by default', async () => {
    const { calls } = stubFetch({ '/me/settings': () => ({ body: { data: SETTINGS } }) });
    const client = newQueryClient();
    client.setQueryData(memberSettingsKey, SETTINGS);
    await renderScreen(<NotificationSettingsScreen />, client);
    expect(screen.getByTestId('SET-09.previews.switch')).not.toBeChecked();
    await fireEvent.press(screen.getByTestId('SET-09.push.new_follower.switch'));
    await waitFor(async () => expect(await bodies(calls, '/me/settings')).toEqual([{ notification_prefs: { types: { new_follower: { push: false } } } }]));
    expect(screen.getByTestId('SET-09.mandatory')).toHaveTextContent(/immer per E-Mail/);
  });
});
