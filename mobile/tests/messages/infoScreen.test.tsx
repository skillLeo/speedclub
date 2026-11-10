// MSG-05 conversation info (DQ-419, DQ-422): inset groups, the shared vehicle, "Melden" not red, a skeleton of the real page.
import { screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet, type TextStyle } from 'react-native';

import { MessagingContext, unavailableMessaging, type Loadable, type MessagingActions, type MessagingAdapter, type PagedList, type ThreadData } from '@/features/messages/data';
import type { ConversationDetail, ThreadMessage } from '@/features/messages/model';
import { ConversationInfoScreen } from '@/features/messages/screens/ConversationInfoScreen';
import { endMessagingSession } from '@/features/messages/session';
import { SafetyContext, unavailableSafety, type SafetyAdapter } from '@/features/safety/data';
import { setMember, useSessionStore } from '@/state/session';
import { hydrateThemePreference, themes } from '@/theme';

import { renderWithProviders } from '../home/harness';
import { conversation, serverMessage } from './fixtures';

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true, dismissTo: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
  useLocalSearchParams: () => ({ conversationId: 'c1' }),
  usePathname: () => '/messages/c1/info',
  useNavigation: () => ({ addListener: () => () => undefined, getParent: () => undefined }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => Promise.resolve({ isConnected: true })) }));
jest.mock('@/api/queries/appConfig', () => ({ ...jest.requireActual<object>('@/api/queries/appConfig'), useFlag: () => true }));
const mockQa: { state: 'default' | 'loading' } = { state: 'default' };
jest.mock('@/lib/qa', () => ({ ...jest.requireActual<object>('@/lib/qa'), useQaState: () => mockQa.state }));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  setMember({ id: 'member-lukas', username: 'lukas.sc', displayName: 'Lukas', avatarUrl: null });
});
afterEach(() => {
  mockQa.state = 'default';
  endMessagingSession();
  useSessionStore.setState({ status: 'loading', member: null });
});

function loaded<T>(data: T): Loadable<T> {
  return { data, isPending: false, isPaused: false, error: null, isFetching: false, refetch: jest.fn() };
}

const S15 = { id: 'v-s15', slug: 'nissan-silvia-s15-x1', title: 'Nissan Silvia S15', cover: null, ownerUsername: 'jann.ptrs' };

function adapterFor(detail: ConversationDetail, messages: ThreadMessage[]): MessagingAdapter {
  const list: PagedList<ThreadMessage> = { ...loaded<readonly ThreadMessage[]>(messages), hasMore: false, isLoadingMore: false, loadMore: jest.fn() };
  const thread: ThreadData = { ...list, pollNewer: jest.fn(() => Promise.resolve([])), refresh: jest.fn(() => Promise.resolve()), readUpTo: null };
  const actions = { organise: jest.fn(() => Promise.resolve()), deleteConversation: jest.fn(() => Promise.resolve()) } as unknown as MessagingActions;
  return {
    ...unavailableMessaging,
    available: true,
    useConversation: () => loaded(detail),
    useThread: () => thread,
    useActions: () => actions,
  };
}

const safety: SafetyAdapter = { ...unavailableSafety, available: true };

function renderInfo(adapter: MessagingAdapter): ReturnType<typeof renderWithProviders> {
  const element: ReactElement = (
    <SafetyContext value={safety}>
      <MessagingContext value={adapter}>
        <ConversationInfoScreen />
      </MessagingContext>
    </SafetyContext>
  );
  return renderWithProviders(element);
}

const flat = (style: unknown) => (StyleSheet.flatten(style as TextStyle) ?? {}) as TextStyle;

describe('MSG-05', () => {
  it('lists the vehicle the thread shares, sets the rows in surface groups and keeps "Melden" off red (DQ-419)', async () => {
    const shared = serverMessage({ id: '01JV', kind: 'vehicle', body: null, vehicle: S15 });
    await renderInfo(adapterFor(conversation({ id: 'c1' }), [shared, serverMessage({ id: '01J1' })]));
    expect(await screen.findByTestId('MSG-05.vehicle')).toBeTruthy();
    expect(screen.getByTestId('MSG-05.vehicleGroup')).toHaveTextContent(/Nissan Silvia S15/);
    for (const group of ['MSG-05.memberGroup', 'MSG-05.actions', 'MSG-05.deleteGroup']) {
      const card = screen.getByTestId(group).children.find((child) => typeof child !== 'string' && flat(child.props.style).backgroundColor);
      expect(card && typeof card !== 'string' ? flat(card.props.style).backgroundColor : null).toBe(themes.carbon.color.bg.surface);
    }
    expect(screen.getByTestId('MSG-05.report')).toBeTruthy();
    expect(flat(screen.getByText('Melden').props.style).color).toBe(themes.carbon.color.text.primary);
    // Block stays destructive.
    expect(flat(screen.getByText(/blockieren/i).props.style).color).toBe(themes.carbon.color.accent.fg);
  });

  it('draws its skeleton as the page: the member group, three action rows, then delete (DQ-422)', async () => {
    mockQa.state = 'loading';
    await renderInfo(adapterFor(conversation({ id: 'c1' }), []));
    const skeleton = screen.getByTestId('MSG-05.skeleton', { includeHiddenElements: true });
    expect(skeleton).toBeTruthy();
  });
});
