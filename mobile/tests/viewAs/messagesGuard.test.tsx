/**
 * DQ-P5-208 (Phase 5 gate, VIEWAS-MSG): since M5.5 Nachrichten is a page of the tab stacks, not a tab, so the tab slot never swaps it
 * out. The inbox, thread, request and info pages show the designed "nicht verfügbar" state themselves in a view-as tab (m3.2-contract
 * §3), and none of them asks the server for messaging.
 */
import { act, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { Me } from '@/api/queries/auth';
import { queryClient } from '@/api/queryClient';
import { MessagingContext, unavailableMessaging } from '@/features/messages/data';
import { ConversationInfoScreen } from '@/features/messages/screens/ConversationInfoScreen';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';
import { ConversationScreen, RequestScreen } from '@/features/messages/screens/MessagingScreens';
import { adoptViewAsMember, intakeViewAs, resetViewAsForTests, type ViewAsWindow } from '@/features/viewAs/viewAsSession';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, stubFetch } from '../settings/harness';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({ conversationId: '01m6f7ztzfs0gd39t08rs9zmmq' }),
  usePathname: () => '/messages',
  useSegments: () => ['(tabs)', '(home)', 'messages'],
  usePreventRemove: jest.fn(),
  useNavigation: () => ({ dispatch: jest.fn(), addListener: jest.fn(() => jest.fn()), getParent: () => undefined, canGoBack: () => true, goBack: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
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

const TOKEN = '41|Zb8kQ2rVt6YpLm3NcXw9HsAe1JdFgUo5RiTqKy7B';
const ME = {
  id: '01m6f7ztzfs0gd39t08rs9zmmp',
  email: 'lukas.sc@speedclub.test',
  username: 'lukas.sc',
  display_name: 'Lukas',
  avatar: null,
  cover: null,
  next_step: null,
  two_factor_enabled: false,
  restrictions: { suspended: false, messaging: { restricted: false, until: null, decision_id: null }, publishing: { restricted: false, until: null, decision_id: null } },
} as unknown as Me;

function startView() {
  const session = new Map<string, string>();
  const win: ViewAsWindow = {
    location: { hash: `#view_as=${encodeURIComponent(TOKEN)}&staff=Mara%20Klein`, pathname: '/app/messages', search: '' },
    history: { state: null, replaceState: jest.fn() },
    sessionStorage: { getItem: (key) => session.get(key) ?? null, setItem: (key, value) => void session.set(key, value), removeItem: (key) => void session.delete(key) },
  };
  intakeViewAs(win);
  adoptViewAsMember(ME);
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
});
afterAll(() => queryClient.clear());
afterEach(async () => {
  await act(async () => {
    resetViewAsForTests();
    useSessionStore.setState({ status: 'guest', member: null });
  });
});

const PAGES: readonly [string, () => ReactElement][] = [
  ['the inbox (MSG-01)', () => <MessagesScreen />],
  ['a conversation (MSG-02)', () => <ConversationScreen />],
  ['a request (MSG-04)', () => <RequestScreen />],
  ['a conversation’s info page (MSG-05)', () => <ConversationInfoScreen />],
];

describe('Nachrichten in a view-as tab (DQ-P5-208)', () => {
  it.each(PAGES)('%s shows the designed "nicht verfügbar" state and asks the server nothing about messaging', async (_name, page) => {
    const { fetchMock } = stubFetch({});
    await act(async () => startView());
    await renderScreen(page(), queryClient);
    expect(screen.getByTestId('VIEWAS.messages')).toBeTruthy();
    expect(screen.getByText('In der Ansicht als Mitglied nicht verfügbar')).toBeTruthy();
    const urls = fetchMock.mock.calls.map(([request]) => (request as Request).url);
    expect(urls.filter((url) => /\/(conversations|messages)\b/.test(url))).toEqual([]);
  });

  it('outside view-as the inbox is the inbox (here the placeholder of a build without messaging)', async () => {
    stubFetch({});
    await renderScreen(
      <MessagingContext value={unavailableMessaging}>
        <MessagesScreen />
      </MessagingContext>,
      queryClient,
    );
    expect(screen.queryByTestId('VIEWAS.messages')).toBeNull();
    expect(screen.getByTestId('MSG-01.soon')).toBeTruthy();
  });
});
