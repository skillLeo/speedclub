// DQ-1080: ONB-02/03 on phones showed page 1 under page 2's indicator. The pager was placed against the window's width before it was
// mounted (a scrollTo into nothing), and as its measured width equals the window's, never again. It is placed once it is mounted.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import { OnboardingScreen, pagerMountedWidth } from '@/features/onboarding/OnboardingScreen';
import { LiveComponent } from '@/features/onboarding/pages';
import { hydrateThemePreference } from '@/theme';
import { __setAccessibilityForTests } from '@/ui/motion/preference';

import { renderScreen } from '../settings/harness';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

// The window is the phone the pager measures: the old placement ran once against this width before the pager existed.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 1, fontScale: 1 })),
}));

beforeAll(hydrateThemePreference);
beforeEach(() => __setAccessibilityForTests({ reduceMotion: true }));
afterAll(() => __setAccessibilityForTests({ reduceMotion: false }));

describe('ONB pager placement (DQ-1080)', () => {
  it('has no width before the pager is mounted', () => {
    expect(pagerMountedWidth(false, null, 0)).toBe(0);
    expect(pagerMountedWidth(false, { width: 393 }, 0)).toBe(393);
    expect(pagerMountedWidth(true, { width: 1280 }, 0)).toBe(0);
    expect(pagerMountedWidth(true, { width: 1280 }, 747)).toBe(747);
  });

  it.each([
    ['2', 'ONB-02'],
    ['3', 'ONB-03'],
  ])('?page=%s scrolls the mounted phone pager to that page', async (page, id) => {
    mockParams = { page };
    const scrollTo = jest.fn();
    const spy = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: (o: object) => void }, 'scrollTo').mockImplementation(scrollTo);
    await renderScreen(<OnboardingScreen />);
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => fireEvent(screen.getByTestId('ONB.pager'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } }));
    expect(scrollTo).toHaveBeenCalledWith({ x: (Number(page) - 1) * 393, animated: false });
    expect(screen.getByTestId(`${id}.page`).props['aria-hidden']).toBe(false);
    expect(screen.getByTestId(`${id}.title`)).toBeTruthy();
    spy.mockRestore();
  });
});

describe('compact live components on a short window (DQ-1023, 375×667)', () => {
  it('the QR card drops its URL line, the full one keeps it', async () => {
    await renderScreen(<LiveComponent page="qr" width={311} compact />);
    expect(screen.queryByText('speedclub.de/C/7H2KQXMB', { includeHiddenElements: true })).toBeNull();
    await renderScreen(<LiveComponent page="qr" width={311} />);
    expect(screen.getByText('speedclub.de/C/7H2KQXMB', { includeHiddenElements: true })).toBeTruthy();
  });
});
