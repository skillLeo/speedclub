// DQ-127: on web the keyboard ring of a theme card lies on the selection frame, one outline and not two.
import { fireEvent, screen } from '@testing-library/react-native';

import { AppearanceScreen } from '@/features/settings/screens/AppearanceScreen';
import { hydrateThemePreference, size } from '@/theme';

import { visualOf } from '../ui/helpers';
import { renderScreen } from './harness';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
// Nor a window with its online events.
jest.mock('@/state/online', () => ({ useOnline: () => true }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  },
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

beforeAll(hydrateThemePreference);

it('draws the ring inside the card on keyboard focus, and none before it', async () => {
  await renderScreen(<AppearanceScreen />);
  expect(visualOf('SET-10.option.carbon').outlineWidth).toBeUndefined();
  await fireEvent(screen.getByTestId('SET-10.option.carbon'), 'focus', { target: { matches: () => true } });
  const visual = visualOf('SET-10.option.carbon');
  expect(visual.outlineWidth).toBe(size.border.focusRing);
  expect(visual.outlineOffset).toBe(-size.border.focusRing);
});
