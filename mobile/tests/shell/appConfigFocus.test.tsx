import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';

import { api } from '@/api/client';
import { APP_CONFIG_POLL_MS, APP_CONFIG_STALE_MS, BUNDLED_APP_CONFIG, useAppConfig } from '@/api/queries/appConfig';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

/*
 * Client round 7 ("admin changes still don't work all the time"): an admin change reached the app only after the 5-minute poll,
 * because coming back to the app or tab refetched a query only once it was stale, and it stayed fresh for those 5 minutes. Now a
 * focus after 30 s asks again (an unchanged config answers 304 thanks to the ETag).
 */
function Probe() {
  useAppConfig();
  return null;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('asks for the config again when the app or tab comes back after 30 s, long before the 5-minute poll', async () => {
  expect(APP_CONFIG_STALE_MS).toBeLessThanOrEqual(30_000);
  expect(APP_CONFIG_STALE_MS).toBeLessThan(APP_CONFIG_POLL_MS);

  const get = jest.spyOn(api, 'GET').mockImplementation((() =>
    Promise.resolve({ data: { data: BUNDLED_APP_CONFIG }, response: new Response('{}', { status: 200, headers: { ETag: '"v1"' } }) })) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const now = jest.spyOn(Date, 'now');
  const start = Date.now();
  now.mockReturnValue(start);

  await render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

  // The member leaves the app for a minute (shorter than the poll) and comes back.
  now.mockReturnValue(start + 60_000);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });

  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  client.clear();
});
