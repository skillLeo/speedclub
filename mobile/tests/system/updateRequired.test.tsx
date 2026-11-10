import { act, screen } from '@testing-library/react-native';

import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import { UpdateRequiredScreen } from '@/features/system/screens/UpdateRequiredScreen';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen } from '../settings/harness';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn() }), usePathname: () => '/update-required' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

beforeAll(hydrateThemePreference);

async function show(message: string | null) {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, force_update_message: message }, confirmed: true });
  await renderScreen(<UpdateRequiredScreen />, client);
  await act(async () => undefined);
}

describe('SYS-01 force update (ADM-37)', () => {
  it('shows the published message', async () => {
    await show('Bitte aktualisiere auf 1.0.0, die alte Version kann keine QR-Sticker mehr lesen.');
    expect(screen.getByText('Bitte aktualisiere auf 1.0.0, die alte Version kann keine QR-Sticker mehr lesen.')).toBeTruthy();
  });

  it('keeps the bundled text without one', async () => {
    await show(null);
    expect(screen.queryByText(/QR-Sticker/)).toBeNull();
  });
});
