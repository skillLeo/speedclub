/** DQ-902: on web a hidden mirror of the text sizes a multiline field, so both must be set in one type role. */
import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { hydrateThemePreference, typography } from '@/theme';
import { TEXT_INPUT_ROLE, TextInput } from '@/ui/TextInput';

import { measureOf, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false, isIOS: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const originalOS = Platform.OS;
const BIO =
  'Ich schraube seit 2009 an japanischen Autos. Aktuell am R34, davor ein S14 mit SR20DET. Alles, was am Auto gemacht wurde, habe ich selbst.';

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

const styleOf = (testID: string, hidden = false) =>
  (StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: hidden }).props.style as TextStyle) ?? {}) as TextStyle &
    Record<string, unknown>;

describe('TextInput (multiline) on web', () => {
  it('sets the sizing mirror in the field’s own role, hyphenation and tracking (input 16/24)', async () => {
    await renderUi(<TextInput label="Über dich" multiline value={BIO} onChangeText={jest.fn()} testID="bio" />);
    expect(TEXT_INPUT_ROLE).toBe('input');
    const mirror = (StyleSheet.flatten(measureOf('bio', 'mirror').props.style as TextStyle) ?? {}) as TextStyle & Record<string, unknown>;
    const field = styleOf('bio');
    for (const key of ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'hyphens'] as const) {
      expect(mirror[key]).toEqual(field[key]);
    }
    expect(mirror.fontSize).toBe(typography.input.fontSize);
    expect(mirror.lineHeight).toBe(typography.input.lineHeight);
    // The textarea never hyphenates, so the mirror may not either: a hyphen would change where its lines break.
    expect(field.hyphens).toBe('none');
  });
});
