/**
 * The discard guard of every garage form stands down while the session changes hands (BH-28): the form belongs to the previous
 * member, so a member change drops it without "Änderungen verwerfen?".
 */
import { act, render } from '@testing-library/react-native';
import type { NavigationAction } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, ThemeProvider } from '@/theme';
import { DiscardGuardDialog } from '@/ui/DiscardGuardDialog';

type Blocked = (options: { data: { action: NavigationAction } }) => void;
const mockPreventRemove = jest.fn<void, [boolean, Blocked]>();

jest.mock('expo-router', () => ({
  usePreventRemove: (prevent: boolean, callback: Blocked) => {
    mockPreventRemove(prevent, callback);
    return jest.fn();
  },
  useNavigation: () => ({ dispatch: jest.fn(), getParent: () => undefined }),
}));
jest.mock('expo-haptics', () => ({ NotificationFeedbackType: { Warning: 'warning' }, notificationAsync: jest.fn(() => Promise.resolve()) }));

const blocking = () => mockPreventRemove.mock.calls[mockPreventRemove.mock.calls.length - 1]?.[0];

function renderGuard(dirty: boolean) {
  return render(
    <GestureHandlerRootView>
      <ThemeProvider>
        <DiscardGuardDialog dirty={dirty} testID="GAR-05.discard" />
      </ThemeProvider>
    </GestureHandlerRootView>,
  );
}

beforeAll(hydrateThemePreference);
beforeEach(() => {
  mockPreventRemove.mockClear();
  useSessionStore.setState({ memberChanged: false });
});
afterAll(() => useSessionStore.setState({ memberChanged: false }));

describe('DiscardGuardDialog while the member changes', () => {
  it('guards a dirty form as long as the session stays with its member', async () => {
    await renderGuard(true);
    expect(blocking()).toBe(true);
  });

  it('lets a dirty form go once another member took the session, and guards again afterwards', async () => {
    await renderGuard(true);
    await act(async () => useSessionStore.setState({ memberChanged: true }));
    expect(blocking()).toBe(false);
    await act(async () => useSessionStore.setState({ memberChanged: false }));
    expect(blocking()).toBe(true);
  });

  it('never guards a clean form', async () => {
    await renderGuard(false);
    await act(async () => useSessionStore.setState({ memberChanged: true }));
    expect(blocking()).toBe(false);
  });
});
