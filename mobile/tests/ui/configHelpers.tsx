import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';

import { renderUi } from './helpers';

/**
 * renderUi with the app root's query client, the bundled config already confirmed so nothing loads: brand surfaces read the
 * published logo through useAppConfig (features/auth/AppWordmark, client round 3). A test using it mocks netinfo, which the config
 * module imports.
 */
export function renderWithConfig(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  client.setQueryData(appConfigKey, { config: BUNDLED_APP_CONFIG, confirmed: true });
  return renderUi(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
