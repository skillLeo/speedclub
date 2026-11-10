import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { isConnectionError, RouteErrorBoundary } from '@/features/shell/RouteErrorBoundary';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

let broken = true;
let failure: Error = new Error('Loading module https://speedclub.test/app/_expo/static/js/web/discover-1a2b.js failed.\n(error: …)');

function Route() {
  if (broken) throw failure;
  return <Text>Inhalt</Text>;
}

const common = (key: string) => i18n.t(key, { ns: 'common', lng: 'de' });

describe('RouteErrorBoundary', () => {
  beforeAll(async () => {
    await hydrateThemePreference();
  });

  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    broken = true;
    failure = new Error('Loading module https://speedclub.test/app/_expo/static/js/web/discover-1a2b.js failed.\n(error: …)');
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => consoleError.mockRestore());

  it('shows the error state instead of unmounting the app, and retries', async () => {
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('shell.routeError').props.role).toBe('alert');
    expect(screen.queryByText('Inhalt')).toBeNull();

    broken = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(screen.getByText('Inhalt')).toBeTruthy();
    expect(screen.queryByTestId('shell.routeError')).toBeNull();
  });

  it('names the connection only when a route chunk did not arrive', async () => {
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('shell.routeError.title')).toHaveTextContent(common('states.errorTitle'));
    expect(screen.getByTestId('shell.routeError.body')).toHaveTextContent(common('states.errorBody'));
  });

  // RESULT 11: a render error is not the member's connection (§8: the plain cause, and what to do next).
  it('says the view could not be shown for a render error, with no false cause', async () => {
    failure = new TypeError("Cannot read properties of null (reading 'trim')");
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('shell.routeError.title')).toHaveTextContent('Diese Ansicht konnte nicht geladen werden');
    expect(screen.getByTestId('shell.routeError.body')).toHaveTextContent(common('shell.routeError.bodyAlone'));
    expect(screen.queryByText(/Verbindung/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });

  it('tells a missing chunk or request from a render error', () => {
    const chunk = new Error('x');
    chunk.name = 'ChunkLoadError';
    expect(isConnectionError(chunk)).toBe(true);
    expect(isConnectionError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isConnectionError(new Error('Failed to fetch dynamically imported module: https://x/y.js'))).toBe(true);
    expect(isConnectionError(new TypeError("Cannot read properties of undefined (reading 'make')"))).toBe(false);
    expect(isConnectionError(new Error('Objects are not valid as a React child'))).toBe(false);
    expect(isConnectionError('Loading module failed')).toBe(false);
  });

  it('renders its children untouched when nothing fails', async () => {
    broken = false;
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('Inhalt')).toBeTruthy();
  });
});
