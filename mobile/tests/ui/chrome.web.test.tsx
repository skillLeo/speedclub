/** DQ-901: on react-native-web the floating control's glyph must paint above its own chrome surface. */
import { screen, within } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import { hydrateThemePreference } from '@/theme';
import { FloatingControl } from '@/ui/chrome';

import { assertNoPositionedSiblingBefore, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-glass-effect', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { GlassView: View, isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false };
});

const originalOS = Platform.OS;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe('FloatingControl on web', () => {
  it('nests the glyph in its surface, so no positioned layer paints over it', async () => {
    await renderUi(<FloatingControl icon="caret-left" label="Zurück" onPress={jest.fn()} testID="f" />);
    const surface = screen.getByTestId('f.surface');
    expect(StyleSheet.flatten(surface.props.style).position).toBeUndefined();
    const glyph = within(surface).getByTestId('f.glyph');
    assertNoPositionedSiblingBefore(glyph);
    // The 44 target and its name stay.
    const target = screen.getByRole('button', { name: 'Zurück' });
    expect(StyleSheet.flatten(target.props.style).width).toBe(44);
  });
});
