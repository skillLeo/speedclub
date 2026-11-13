import { screen } from '@testing-library/react-native';

import { api } from '@/api/client';
import { resetClientErrorReports } from '@/api/clientErrors';
import { RouteErrorBoundary } from '@/features/shell/RouteErrorBoundary';
import { hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

let failure: Error = new Error('Maximum update depth exceeded.');

function Route(): React.JSX.Element {
  throw failure;
}

/** The error screens tell the server what broke (POST /client-errors), once per error, never for a lost connection. */
describe('client error reports', () => {
  beforeAll(async () => {
    await hydrateThemePreference();
  });

  let post: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    resetClientErrorReports();
    failure = new Error('Maximum update depth exceeded.');
    post = jest.spyOn(api, 'POST').mockResolvedValue({ data: undefined, error: undefined, response: new Response(null, { status: 204 }) } as never);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    post.mockRestore();
    consoleError.mockRestore();
  });

  it('reports a render error with its message, component stack and device shape', async () => {
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('shell.routeError')).toBeTruthy();
    const calls = post.mock.calls.filter(([path]) => path === '/client-errors');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const body = (calls[0]![1] as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({ name: 'Error', message: 'Maximum update depth exceeded.' });
    expect(['web', 'ios', 'android']).toContain(body.platform);
    expect(body.viewport).toMatch(/^\d{2,5}x\d{2,5}@[\d.]+$/);
    expect(calls.some(([, init]) => typeof (init as { body: { component_stack?: string } }).body.component_stack === 'string')).toBe(true);
  });

  it('sends the same error once only', async () => {
    const view = await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    const first = post.mock.calls.length;
    view.unmount();
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(post.mock.calls.length).toBe(first);
  });

  it('reports nothing for a route chunk that did not arrive', async () => {
    failure = new Error('Loading module https://speedclub.test/app/_expo/static/js/web/discover-1a2b.js failed.');
    await renderUi(
      <RouteErrorBoundary>
        <Route />
      </RouteErrorBoundary>,
    );
    expect(post.mock.calls.filter(([path]) => path === '/client-errors')).toHaveLength(0);
  });
});
