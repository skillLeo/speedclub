// MSG-03 against a fake adapter: members you cannot write to are disabled with the reason, an existing conversation opens at once,
// and a new one starts with one idempotency key per intent, kept for a retry.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import { MessagingContext, unavailableMessaging, type Loadable, type MessagingActions, type MessagingAdapter, type PagedList } from '@/features/messages/data';
import type { ChatVehicle, MessageCandidate } from '@/features/messages/model';
import { endMessagingSession } from '@/features/messages/session';
import { NewMessageScreen } from '@/features/messages/screens/NewMessageScreen';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference, space } from '@/theme';

import { renderWithProviders } from '../home/harness';

type MockListProps = {
  data: readonly unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactElement;
  keyExtractor?: (item: unknown) => string;
  ListEmptyComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
};

const mockParams: { current: Record<string, string> } = { current: {} };
const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true };
const mockNavigation = {
  getParent: () => undefined,
  getState: () => ({ routes: [{ name: '(modals)' }] }),
  canGoBack: () => true,
  goBack: jest.fn(),
  addListener: () => () => undefined,
  dispatch: jest.fn(),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => mockNavigation,
  usePreventRemove: () => () => undefined,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('@shopify/flash-list', () => {
  const { Fragment, createElement } = jest.requireActual<typeof import('react')>('react');
  function FlashList({ data, renderItem, keyExtractor, ListEmptyComponent, ListHeaderComponent }: MockListProps) {
    const items = data.map((item, index) => createElement(Fragment, { key: keyExtractor ? keyExtractor(item) : index }, renderItem({ item, index })));
    return createElement(Fragment, null, ListHeaderComponent ?? null, data.length === 0 ? ListEmptyComponent : items);
  }
  return { FlashList };
});
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${String((n += 1)).padStart(3, '0')}` };
});
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});
jest.mock('@/ui/toast', () => ({ ...jest.requireActual<object>('@/ui/toast'), toast: jest.fn() }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  mockParams.current = {};
  setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
});
afterEach(() => {
  endMessagingSession();
  useSessionStore.setState({ status: 'loading', member: null });
  jest.clearAllMocks();
});

const candidate = (overrides: Partial<MessageCandidate> & { username: string }): MessageCandidate => ({
  displayName: null,
  avatar: null,
  line: null,
  canMessage: true,
  reason: null,
  conversationId: null,
  ...overrides,
});

const CANDIDATES = [
  candidate({ username: 'jann.ptrs', displayName: 'Jann Peters', conversationId: 'c-jann' }),
  candidate({ username: 'kenji.r34', displayName: 'Kenji', line: '1 Fahrzeug · Nissan' }),
  candidate({ username: 'lena.911', displayName: 'Lena', canMessage: false, reason: 'Nimmt keine Nachrichten an' }),
];

function setup(start: MessagingActions['start'], shared?: ChatVehicle) {
  const loaded = <T,>(data: T): Loadable<T> => ({ data, isPending: false, isPaused: false, error: null, isFetching: false, refetch: jest.fn() });
  const list = <T,>(data: readonly T[]): PagedList<T> => ({ ...loaded<readonly T[]>(data), hasMore: false, isLoadingMore: false, loadMore: jest.fn() });
  const actions = { ...unavailableMessaging.useActions(), start };
  const adapter: MessagingAdapter = {
    ...unavailableMessaging,
    available: true,
    useCandidates: () => list(CANDIDATES),
    useSharedVehicle: (slug) => (slug && shared ? loaded(shared) : unavailableMessaging.useSharedVehicle(slug)),
    useActions: () => actions,
    classify: () => ({ reason: 'network', message: 'Keine Verbindung' }),
  };
  return renderWithProviders(
    <MessagingContext value={adapter}>
      <NewMessageScreen />
    </MessagingContext>,
  );
}

describe('MSG-03', () => {
  it('opens an existing conversation straight away', async () => {
    await setup(jest.fn());
    await fireEvent.press(await screen.findByTestId('MSG-03.candidate.jann.ptrs.body'));
    expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/messages/[conversationId]', params: { conversationId: 'c-jann' } });
  });

  it('"Zuletzt" sits a section gap under the search field and 12 above the rows (DQ-431)', async () => {
    await setup(jest.fn());
    await screen.findByTestId('MSG-03.candidate.jann.ptrs.body');
    const header = StyleSheet.flatten(screen.getByTestId('MSG-03.listHeader').props.style);
    expect(header.paddingTop).toBe(space[16]);
    expect(header.paddingBottom).toBe(space[12]);
  });

  it('from PROF-02 (?to=) goes straight to an existing thread', async () => {
    mockParams.current = { to: 'jann.ptrs' };
    await setup(jest.fn());
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/messages/[conversationId]', params: { conversationId: 'c-jann' } }));
  });

  it('from VEH-01 (?to=&about=) writes here, with the vehicle as context', async () => {
    mockParams.current = { to: 'kenji.r34', about: 'nissan-skyline-gt-r-r34-5tf974vj' };
    const start = jest.fn<ReturnType<MessagingActions['start']>, Parameters<MessagingActions['start']>>().mockResolvedValue({ conversationId: 'c-kenji' });
    await setup(start, { id: 'v-r34', slug: 'nissan-skyline-gt-r-r34-5tf974vj', title: 'Nissan Skyline GT-R R34', cover: null, ownerUsername: 'kenji.r34' });
    expect(await screen.findByTestId('MSG-03.about')).toHaveTextContent(/Nissan Skyline GT/);
    await fireEvent.changeText(screen.getByTestId('MSG-03.composer.input'), 'Ist der R34 noch Serie?');
    await fireEvent.press(screen.getByTestId('MSG-03.composer.send'));
    await act(async () => undefined);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ recipient: 'kenji.r34', vehicleId: 'v-r34', message: { kind: 'text', body: 'Ist der R34 noch Serie?' } });
  });

  it('shows a member you cannot write to with the reason, and does not pick them', async () => {
    await setup(jest.fn());
    expect(await screen.findByText('Nimmt keine Nachrichten an')).toBeTruthy();
    expect(screen.queryByTestId('MSG-03.candidate.lena.911.body')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('MSG-03.candidate.lena.911.body'));
    expect(screen.queryByTestId('MSG-03.composer')).toBeNull();
  });

  it('starts a conversation, keeping the idempotency key for a retry of the same message', async () => {
    const start = jest
      .fn<ReturnType<MessagingActions['start']>, Parameters<MessagingActions['start']>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ conversationId: 'c-kenji' });
    await setup(start);
    await fireEvent.press(await screen.findByTestId('MSG-03.candidate.kenji.r34.body'));
    await fireEvent.changeText(await screen.findByTestId('MSG-03.composer.input'), 'Servus Kenji, welches Fahrwerk fährst du?');
    await fireEvent.press(screen.getByTestId('MSG-03.composer.send'));
    await act(async () => undefined);
    await fireEvent.press(screen.getByTestId('MSG-03.composer.send'));
    await act(async () => undefined);
    expect(start).toHaveBeenCalledTimes(2);
    const [first, second] = start.mock.calls.map(([input]) => input);
    expect(first).toMatchObject({ recipient: 'kenji.r34', vehicleId: null, message: { kind: 'text', body: 'Servus Kenji, welches Fahrwerk fährst du?' } });
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    expect(second?.clientId).toBe(first?.clientId);
    expect(mockRouter.navigate).toHaveBeenCalledWith({ pathname: '/messages/[conversationId]', params: { conversationId: 'c-kenji' } });
  });
});
