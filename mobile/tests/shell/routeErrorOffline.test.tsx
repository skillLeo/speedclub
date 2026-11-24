/**
 * R4B-001 (client round 4 hunt): a route chunk that could not load while the device is offline shows the offline state, not the
 * generic "Das hat nicht geklappt"; once the connection is back the web reloads by itself (covered in the browser flow).
 */
import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { RouteErrorBoundary } from '@/features/shell/RouteErrorBoundary';
import i18n from '@/i18n';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

// NetInfo reports the device offline to every listener at once.
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((listener: (state: { isConnected: boolean }) => void) => {
    listener({ isConnected: false });
    return jest.fn();
  }),
}));

let failure: Error = new Error('Loading module https://speedclub.test/app/_expo/static/js/web/discover-1a2b.js failed.');

function Route(): never {
  throw failure;
}

const common = (key: string) => i18n.t(key, { ns: 'common', lng: 'de' });

describe('RouteErrorBoundary offline', () => {
  beforeAll(async () => {
    await hydrateThemePreference();
  });

  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  it('says the member is offline and that the view loads once the connection is back', async () => {
    failure = new Error('Loading module https://speedclub.test/app/_expo/static/js/web/discover-1a2b.js failed.');
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('shell.routeError.title')).toHaveTextContent(common('shell.routeError.offlineTitle'));
    expect(screen.getByTestId('shell.routeError.body')).toHaveTextContent(common('shell.routeError.offlineBody'));
    expect(screen.queryByText('Inhalt')).toBeNull();
  });

  it('keeps the render error copy for a screen that broke, offline or not', async () => {
    failure = new TypeError("Cannot read properties of undefined (reading 'title')");
    await renderUi(
      <RouteErrorBoundary>
        <Route />
        <Text>Inhalt</Text>
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('shell.routeError.title')).toHaveTextContent(common('shell.routeError.title'));
  });
});
