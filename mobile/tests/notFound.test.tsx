/**
 * SYS-03. This file has its own module registry, so the first-screen gate is still closed here. The route
 * file itself is under test, because expo-router only picks up the name src/app/+not-found.tsx. expo-router
 * is stubbed because its entry point does not load in Jest (standard-navigation ships ESM only).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
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
  useRouter: () => ({ canGoBack: () => false, back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** The bundled config is enough: the wordmark reads it, nothing fetches. */
function client() {
  const next = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  next.setQueryData(appConfigKey, { config: BUNDLED_APP_CONFIG, confirmed: true });
  return next;
}

function renderRoute() {
  return render(
    <QueryClientProvider client={client()}>
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <NotFoundRoute />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
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

it('offers one filled way home and a back control over the photo (DQ-1088)', async () => {
  await renderRoute();
  expect(visualOf('SYS-03.home').backgroundColor).toBe(themes.carbon.color.bg.inverse);
  expect(visualOf('SYS-03.home').minHeight).toBe(size.button.l);
  expect(screen.getByTestId('SYS-03.header')).toBeTruthy();
  expect(screen.getByTestId('SYS-03.photo')).toBeTruthy();
});

it.each([
  [360, false],
  [390, false],
  [767, false],
  [768, true],
  [1280, true],
])('at %i the photo and the copy split the window: %s', async (width, split) => {
  mockDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
  await renderRoute();
  const column = StyleSheet.flatten(screen.getByTestId('SYS-03.state').props.style);
  expect(column.maxWidth).toBe(split ? 480 : undefined);
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
