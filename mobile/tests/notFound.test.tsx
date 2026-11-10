/**
 * SYS-03. This file has its own module registry, so the first-screen gate is still closed here. The route
 * file itself is under test, because expo-router only picks up the name src/app/+not-found.tsx. expo-router
 * is stubbed because its entry point does not load in Jest (standard-navigation ships ESM only).
 */
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import NotFoundRoute from '@/app/+not-found';
import i18n from '@/i18n';
import { isFirstScreenMounted, registerFirstScreenGate } from '@/lib/ready';
import { hydrateThemePreference, size, ThemeProvider, themes } from '@/theme';

import { visualOf } from './ui/helpers';

const mockDimensions = jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockDimensions(),
}));

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ canGoBack: () => false }),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function renderRoute() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <NotFoundRoute />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

beforeAll(hydrateThemePreference);
afterAll(() => i18n.changeLanguage('de'));

it('renders through Screen, so the first-screen gate opens', async () => {
  registerFirstScreenGate();
  expect(isFirstScreenMounted()).toBe(false);
  await renderRoute();
  expect(screen.getByTestId('SYS-03.screen')).toBeTruthy();
  expect(isFirstScreenMounted()).toBe(true);
});

it('offers one primary button, medium, hugging its label, not red text', async () => {
  await renderRoute();
  const home = screen.getByTestId('SYS-03.home');
  const pressable = StyleSheet.flatten(home.props.style);
  expect(pressable.alignSelf).toBe('flex-start');
  const content = visualOf('SYS-03.home');
  expect(content.minHeight).toBe(size.button.m);
  expect(content.backgroundColor).toBe(themes.carbon.color.bg.inverse);
});

it.each([
  [360, undefined],
  [390, undefined],
  [767, undefined],
  [768, 480],
  [1280, 480],
])('at %i the text block has the column limit %s, and stays on the left inside it', async (width, maxWidth) => {
  mockDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
  await renderRoute();
  const block = StyleSheet.flatten(screen.getByTestId('SYS-03.block').props.style);
  expect(block.maxWidth).toBe(maxWidth);
  expect(block.alignSelf).toBe(maxWidth ? 'center' : undefined);
  mockDimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
});

it('speaks German first and English on request', async () => {
  await i18n.changeLanguage('de');
  await renderRoute();
  expect(screen.getByRole('heading', { name: 'Diese Seite gibt es nicht.' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Zur Startseite' })).toBeTruthy();

  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to home' })).toBeTruthy();
});
