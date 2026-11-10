import { act, fireEvent, screen } from '@testing-library/react-native';

import { FollowButton } from '@/features/profile/components/FollowButton';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import { useViewAsStore } from '@/features/viewAs/viewAsSession';
import { ViewAsModalUnavailable } from '@/features/viewAs/ViewAsModalUnavailable';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';
import { Text } from '@/ui';

import { renderScreen, stubFetch } from '../settings/harness';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/u/lukas.sc' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

function Reason({ kind }: { kind?: 'write' | 'messages' }) {
  return <Text variant="body">{useViewAsLock(kind) ?? 'frei'}</Text>;
}

beforeAll(hydrateThemePreference);
afterEach(() => act(() => useViewAsStore.setState({ status: 'off', staff: null, username: null, reason: null })));

describe('write controls in a view-as tab (M3.5)', () => {
  it('gives the reason only while the view is live', async () => {
    await renderScreen(<Reason />);
    expect(screen.getByText('frei')).toBeTruthy();
    await act(async () => useViewAsStore.setState({ status: 'active', username: 'marco.amg' }));
    expect(screen.getByText('In der Ansicht als Mitglied kannst du nichts ändern.')).toBeTruthy();
  });

  it('Folgen looks disabled and sends nothing', async () => {
    const { fetchMock } = stubFetch({});
    useSessionStore.setState({ status: 'member' });
    useViewAsStore.setState({ status: 'active', username: 'marco.amg' });
    await renderScreen(<FollowButton username="lukas.sc" following={false} name="Lukas" testID="PROF-02.follow" />);
    expect(screen.getByTestId('PROF-02.follow').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('PROF-02.follow'));
    expect(fetchMock.mock.calls.filter(([request]) => (request as Request).method !== 'GET')).toHaveLength(0);
  });

  it('a modal messaging route shows the designed state', async () => {
    await renderScreen(<ViewAsModalUnavailable title="Neue Nachricht" onClose={jest.fn()} routeId="MSG-03" />);
    expect(screen.getByTestId('VIEWAS.messages')).toBeTruthy();
    expect(screen.getByText('In der Ansicht als Mitglied nicht verfügbar')).toBeTruthy();
  });
});
