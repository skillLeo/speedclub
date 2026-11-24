/** M5.9d invites (contract §5, §8): INV-01, the `/join/{code}` link, the sign-up notice and `invite_code` on account creation. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import { inviteUrl, parseInvites } from '@/api/queries/invites';
import { InviteNotice } from '@/features/auth/components/InviteNotice';
import { forgetInviteCode, heldInviteCode, inviteCodeInUrl, inviteFields, normalizeInviteCode, noteInviteCode } from '@/features/auth/inviteCode';
import { InvitesScreen } from '@/features/gift/screens/InvitesScreen';
import { JoinScreen } from '@/features/gift/screens/JoinScreen';
import { mapIncomingPath } from '@/features/shell/nativeIntent';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, signIn, signOut, stubApi } from './helpers';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => false) };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/settings/invites',
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
  Link: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  process.env.EXPO_PUBLIC_WEB_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ME = { body: { data: { id: '01lukas', username: 'lukas.sc', restrictions: { suspended: false, messaging: { restricted: false, until: null }, publishing: { restricted: false, until: null } } } } };
const INVITES = {
  data: [
    { code: '7KQ2M9XA', created_at: '2026-10-02T18:12:00Z', accepted_at: '2026-11-12T20:30:00Z', accepted_by: { username: 'tobi.e46', display_name: 'Tobi' } },
    { code: 'H4NC8RVE', created_at: '2026-10-02T18:12:00Z', accepted_at: '2026-11-13T09:02:00Z', accepted_by: null },
    { code: 'P3WZ6TDK', created_at: '2026-10-02T18:12:00Z', accepted_at: null, accepted_by: null },
    { code: 'B8MJ1QYS', created_at: '2026-10-02T18:12:00Z', accepted_at: null, accepted_by: null },
    { code: 'R2XF5GHN', created_at: '2026-10-02T18:12:00Z', accepted_at: null, accepted_by: null },
  ],
};

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  forgetInviteCode();
  signIn();
});

describe('invite codes', () => {
  it('reads Crockford codes, look-alikes as their digits, and nothing else', () => {
    expect(normalizeInviteCode(' p3wz6tdk ')).toBe('P3WZ6TDK');
    expect(normalizeInviteCode('P3WZ6TDO')).toBe('P3WZ6TD0');
    expect(normalizeInviteCode('P3WZ6TD')).toBeNull();
    expect(normalizeInviteCode('P3WZ6TDU')).toBeNull();
    expect(inviteCodeInUrl('/app/join/P3WZ6TDK')).toBe('P3WZ6TDK');
    expect(inviteCodeInUrl('/auth/email', '?invite=b8mj1qys')).toBe('B8MJ1QYS');
    expect(inviteCodeInUrl('/join/nope')).toBeNull();
    expect(inviteUrl('P3WZ6TDK', 'https://speedclub.de/')).toBe('https://speedclub.de/join/P3WZ6TDK');
    expect(parseInvites(INVITES).invites).toHaveLength(5);
  });

  it('opens /join/{code} from a universal link as the app route', () => {
    expect(mapIncomingPath('https://speedclub.test/join/P3WZ6TDK', ['speedclub.test'])).toBe('/join/P3WZ6TDK');
  });

  it('sends the held code with an account-creating call, once', () => {
    expect(inviteFields()).toEqual({});
    noteInviteCode('p3wz6tdk');
    expect(inviteFields()).toEqual({ invite_code: 'P3WZ6TDK' });
    noteInviteCode('kaputt');
    expect(heldInviteCode()).toBe('P3WZ6TDK');
    forgetInviteCode();
    expect(inviteFields()).toEqual({});
  });
});

describe('INV-01 Freunde einladen', () => {
  it('lists the five codes with their status, says what both get, and nothing more', async () => {
    stubApi({ 'GET /me/invites': { body: INVITES }, 'GET /me': ME });
    await renderScreen(<InvitesScreen />);
    expect(await screen.findByTestId('INV-01.summary')).toHaveTextContent('2 von 5 eingelöst');
    expect(screen.getByTestId('INV-01.reward')).toHaveTextContent('Ihr bekommt beide das Abzeichen „Crew Starter“.');
    expect(screen.getByText('Eingelöst von @tobi.e46')).toBeTruthy();
    expect(screen.getByText('Eingelöst')).toBeTruthy();
    expect(screen.getAllByText('Offen')).toHaveLength(3);
    // Redeemed codes have nothing to share.
    expect(screen.queryByTestId('INV-01.codes.7KQ2M9XA.share')).toBeNull();
    expect(screen.getByTestId('INV-01.codes.P3WZ6TDK.share')).toBeTruthy();
  });

  it('copies the join link of an open code', async () => {
    stubApi({ 'GET /me/invites': { body: INVITES }, 'GET /me': ME });
    await renderScreen(<InvitesScreen />);
    await fireEvent.press(await screen.findByTestId('INV-01.codes.P3WZ6TDK.copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://speedclub.test/join/P3WZ6TDK');
  });

  it('shows the error state with retry', async () => {
    stubApi({ 'GET /me/invites': { status: 403, body: { message: 'Nicht erlaubt', code: 'forbidden', errors: {} } }, 'GET /me': ME });
    await renderScreen(<InvitesScreen />);
    expect(await screen.findByTestId('INV-01.error')).toBeTruthy();
  });

  it('asks a guest to sign in', async () => {
    signOut();
    stubApi({});
    await renderScreen(<InvitesScreen />);
    expect(await screen.findByTestId('INV-01.guest')).toBeTruthy();
  });
});

describe('INV-02 /join/{code}', () => {
  it('holds a guest\'s code and opens the sign-up', async () => {
    signOut();
    mockParams = { code: 'p3wz6tdk' };
    stubApi({});
    await renderScreen(<JoinScreen />);
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/email'));
    expect(heldInviteCode()).toBe('P3WZ6TDK');
  });

  it('tells a signed-in member that codes are for new accounts', async () => {
    mockParams = { code: 'P3WZ6TDK' };
    stubApi({});
    await renderScreen(<JoinScreen />);
    expect(await screen.findByText('Du bist schon angemeldet. Einladungscodes gelten nur für neue Konten.')).toBeTruthy();
    expect(heldInviteCode()).toBeNull();
  });
});

describe('sign-up notice', () => {
  it('names the inviter only when the API hands out the handle', async () => {
    signOut();
    noteInviteCode('P3WZ6TDK');
    stubApi({ 'GET /invites/P3WZ6TDK': { body: { data: { code: 'P3WZ6TDK', inviter: { username: 'nina.r34', display_name: 'Nina' } } } } });
    await renderScreen(<InviteNotice routeId="AUTH-12" />);
    expect(await screen.findByText('Du wurdest von @nina.r34 eingeladen.')).toBeTruthy();
  });

  it('says the code comes along when the inviter is not named', async () => {
    signOut();
    noteInviteCode('P3WZ6TDK');
    stubApi({ 'GET /invites/P3WZ6TDK': { body: { data: { code: 'P3WZ6TDK', inviter: null } } } });
    await renderScreen(<InviteNotice routeId="AUTH-12" />, newQueryClient());
    expect(await screen.findByText('Dein Einladungscode P3WZ6TDK wird übernommen.')).toBeTruthy();
  });

  it('drops a code the API does not know, so it never blocks the sign-up', async () => {
    signOut();
    noteInviteCode('B8MJ1QYS');
    stubApi({ 'GET /invites/B8MJ1QYS': { status: 404, body: { message: 'Nicht gefunden', code: 'not_found', errors: {} } } });
    await renderScreen(<InviteNotice routeId="AUTH-12" />, newQueryClient());
    expect(await screen.findByText('Dieser Einladungscode gilt nicht mehr. Registrieren kannst du dich trotzdem.')).toBeTruthy();
    await waitFor(() => expect(heldInviteCode()).toBeNull());
  });

  it('shows nothing without a held code', async () => {
    stubApi({});
    await renderScreen(<InviteNotice routeId="AUTH-12" />);
    expect(screen.queryByTestId('AUTH-12.invite')).toBeNull();
  });
});
