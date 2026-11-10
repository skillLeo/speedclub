/**
 * BH-00, the root cause of "Fortsetzen ends on Start without a message". A screen in the modal group threw, and the nearest boundary
 * was the root layout's, around the root Stack. Catching there unmounts the root Stack; React Navigation then clears its state, so the
 * pathname falls to the first root route, /sign-in; SessionHost sends a signed-in member away from an auth route with
 * router.replace('/'), and that remounts the root layout with a fresh boundary. Start, at /app/, with no message. The real layouts run
 * here, with SessionHost, and a screen that throws.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import ModalsLayout from '@/app/(modals)/_layout';
import WizardLayout, { unstable_settings as wizardSettings } from '@/app/(modals)/add-vehicle/[draftId]/_layout';
import '@/i18n';
import { SessionHost } from '@/features/auth/SessionHost';
import { RouteErrorBoundary, RouteErrorFallback } from '@/features/shell/RouteErrorBoundary';
import { useCanvasStackOptions } from '@/features/shell/useCanvasStackOptions';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference, ThemeProvider } from '@/theme';

import { stubFetch } from './harness';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)), setItemAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

configure({ asyncUtilTimeout: 30_000 });
jest.setTimeout(120_000);

const MODAL_OPTIONS = { presentation: 'modal' } as const;

/** As RootStack in src/app/_layout.tsx: the boundary around the root Stack, and SessionHost beside it. */
function RootStack() {
  const screenOptions = useCanvasStackOptions();
  return (
    <>
      <RouteErrorBoundary>
        <Stack screenOptions={screenOptions}>
          <Stack.Screen name="(modals)" options={MODAL_OPTIONS} />
        </Stack>
      </RouteErrorBoundary>
      <SessionHost />
    </>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}


const screenOf = (testID: string) =>
  function StubScreen() {
    return <View testID={testID} />;
  };

/** As WizardReviewScreen with a draft without a model: the screen is on show, then its answer arrives and rendering it throws. */
function ThrowsWhenAnswered() {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const answer = setTimeout(() => setAnswered(true), 0);
    return () => clearTimeout(answer);
  }, []);
  if (answered) throw new TypeError("Cannot read properties of null (reading 'trim')");
  return <View testID="review" />;
}

const routes = (root: object) =>
  ({
    _layout: root,
    '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
    '(auth)/sign-in': screenOf('sign-in'),
    '(tabs)/index': screenOf('home'),
    '(tabs)/broken': ThrowsWhenAnswered,
    '(modals)/_layout': ModalsLayout,
    '(modals)/viewer': screenOf('viewer'),
    '(modals)/add-vehicle/[draftId]/_layout': { default: WizardLayout, unstable_settings: wizardSettings },
    '(modals)/add-vehicle/[draftId]/vehicle': screenOf('step-1'),
    '(modals)/add-vehicle/[draftId]/review': ThrowsWhenAnswered,
  }) as never;

beforeAll(hydrateThemePreference);

let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  useSessionStore.setState({ status: 'member', member: { id: 'm', username: 'lukas.sc', displayName: null, avatarUrl: null, nextStep: null } });
  stubFetch({ '/auth/me': { body: { data: { id: 'm', username: 'lukas.sc', display_name: null, avatar: null, cover: null, next_step: null, theme: 'system', locale: 'de' } } } });
});
afterEach(() => consoleError.mockRestore());

describe('a screen of the modal group that throws', () => {
  it('without a boundary per screen ends on Start with no message, as the member web did (the control)', async () => {
    const view = await renderRouter(routes({ default: RootStack }), { initialUrl: '/add-vehicle/d1/review', wrapper: Providers });
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(screen.queryByTestId('shell.routeError')).toBeNull();
  });

  it('the app\'s root layout sets the boundary per screen', () => {
    expect(jest.requireActual<{ unstable_settings?: { screenErrorBoundary?: unknown } }>('@/app/_layout').unstable_settings?.screenErrorBoundary).toBe(RouteErrorFallback);
  });

  it('with screenErrorBoundary on the root layout: the error at the same address, and × closes the modal', async () => {
    const view = await renderRouter(routes({ default: RootStack, unstable_settings: { screenErrorBoundary: RouteErrorFallback } }), {
      initialUrl: '/add-vehicle/d1/review',
      wrapper: Providers,
    });
    expect(await screen.findByTestId('shell.routeError')).toBeTruthy();
    expect(view.getPathname()).toBe('/add-vehicle/d1/review');
    expect(screen.queryByTestId('home')).toBeNull();

    // A tick for what SessionHost would have done.
    await act(async () => jest.advanceTimersByTime(300));
    expect(view.getPathname()).toBe('/add-vehicle/d1/review');
    expect(screen.getByTestId('shell.routeError')).toBeTruthy();

    // RESULT 11: the modal's own control, × with the close label, not a back chevron; and it closes the group as the wizard's × does.
    const close = screen.getByTestId('shell.routeError.header.back');
    expect(close.props['aria-label'] ?? close.props.accessibilityLabel).toBe('Schließen');
    expect(screen.queryByLabelText('Zurück')).toBeNull();
    // A render error, not the connection.
    expect(screen.getByTestId('shell.routeError.title')).toHaveTextContent('Diese Ansicht konnte nicht geladen werden');
    expect(screen.getByTestId('shell.routeError.body')).toHaveTextContent('Versuch es noch einmal oder schließ die Ansicht.');
    await fireEvent.press(close);
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(view.getPathname()).toBe('/');
    expect(screen.queryByTestId('step-1')).toBeNull();
  });

  it('a screen pushed in a tab keeps the back chevron, and back leaves it', async () => {
    const view = await renderRouter(routes({ default: RootStack, unstable_settings: { screenErrorBoundary: RouteErrorFallback } }), {
      initialUrl: '/',
      wrapper: Providers,
    });
    expect(await screen.findByTestId('home')).toBeTruthy();
    await act(async () => router.push('/broken'));
    expect(await screen.findByTestId('shell.routeError')).toBeTruthy();
    const back = screen.getByTestId('shell.routeError.header.back');
    expect(back.props['aria-label'] ?? back.props.accessibilityLabel).toBe('Zurück');
    expect(screen.getByTestId('shell.routeError.body')).toHaveTextContent('Versuch es noch einmal oder geh einen Schritt zurück.');
    await fireEvent.press(back);
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(view.getPathname()).toBe('/');
  });

  it('with nothing below it offers the retry alone, and retries on native', async () => {
    const view = await renderRouter(routes({ default: RootStack, unstable_settings: { screenErrorBoundary: RouteErrorFallback } }), {
      initialUrl: '/broken',
      wrapper: Providers,
    });
    expect(await screen.findByTestId('shell.routeError')).toBeTruthy();
    expect(view.getPathname()).toBe('/broken');
    expect(screen.queryByTestId('shell.routeError.header.back')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    // The screen is mounted again; this one throws again when answered, and the boundary takes it again.
    expect(await screen.findByTestId('shell.routeError')).toBeTruthy();
  });
});
