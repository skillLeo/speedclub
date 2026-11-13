// ONB-01…03 (09 §7.1): three pages, "Weiter" pages on, the last says "Los geht's", "Überspringen" always; shown once.
import { act, fireEvent, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenOnboarding } from '@/features/auth/sessionLifecycle';
import { OnboardingScreen } from '@/features/onboarding/OnboardingScreen';
import { hydrateThemePreference } from '@/theme';
import { __setAccessibilityForTests } from '@/ui/motion/preference';

import { renderScreen } from '../settings/harness';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

beforeAll(hydrateThemePreference);
beforeEach(() => {
  mockParams = {};
  jest.clearAllMocks();
  // Reduced motion: "Weiter" moves the page at once, so the test can follow it without a scroll event.
  __setAccessibilityForTests({ reduceMotion: true });
});
afterAll(() => __setAccessibilityForTests({ reduceMotion: false }));

async function mount() {
  await renderScreen(<OnboardingScreen />);
  await act(async () => fireEvent(screen.getByTestId('ONB.pager'), 'layout', layout));
}

describe('ONB-01…03', () => {
  it('draws all three pages with their live component, the first in view', async () => {
    await mount();
    expect(screen.getByTestId('ONB-01.root')).toBeTruthy();
    for (const id of ['ONB-01', 'ONB-02', 'ONB-03']) {
      expect(screen.getByTestId(`${id}.page`, { includeHiddenElements: true })).toBeTruthy();
      // The illustration is hidden from screen readers (the title and the body say it).
      expect(screen.getByTestId(`${id}.live`, { includeHiddenElements: true })).toBeTruthy();
    }
    expect(screen.getByTestId('ONB-01.title')).toHaveTextContent('Deine Garage. Jedes Detail.');
    expect(screen.getByTestId('ONB-01.next')).toHaveTextContent('Weiter');
    expect(screen.getByTestId('ONB-01.skip')).toHaveTextContent('Überspringen');
  });

  it('marks itself seen on the first frame, on the device too', async () => {
    await mount();
    expect(hasSeenOnboarding()).toBe(true);
    expect(await AsyncStorage.getItem('sc.onboardingSeen')).toBe('1');
  });

  it('pages on with Weiter and ends on the last page with Los geht’s', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('ONB-01.next'));
    expect(screen.getByTestId('ONB-02.root')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ONB-02.next'));
    expect(screen.getByTestId('ONB-03.next')).toHaveTextContent('Los geht’s');
    await fireEvent.press(screen.getByTestId('ONB-03.next'));
    // Jest renders the native app: the pages hand over to Welcome.
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });

  it('opens the page `?page=` names and skips from any page', async () => {
    mockParams = { page: '3' };
    await mount();
    expect(screen.getByTestId('ONB-03.root')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ONB-03.skip'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });

  it('badges its sample content and keeps it out of the reading order', async () => {
    await mount();
    expect(screen.getAllByText('Beispiel', { includeHiddenElements: true }).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryAllByText('Beispiel')).toHaveLength(0);
    expect(screen.getByTestId('ONB-02.page', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    expect(screen.getByTestId('ONB-01.page').props['aria-hidden']).toBe(false);
  });
});
