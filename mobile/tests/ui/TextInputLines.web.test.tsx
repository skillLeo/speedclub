/**
 * N12 (Build 12): the web is unchanged by the native drawn-line measurement. A browser scales the role linearly (QA font scale
 * through the theme), so a line is 24 × scale, the mirror sizes the field, and no measuring line is rendered.
 */
import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { hydrateThemePreference, typography } from '@/theme';
import { TextInput } from '@/ui/TextInput';

import { measureOf, queryMeasureOf, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false, isIOS: false }));
jest.mock('@/lib/qa', () => {
  const actual = jest.requireActual<{ qa: object }>('@/lib/qa');
  return { ...actual, qa: { ...actual.qa, fontScale: 2 } };
});
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

const originalOS = Platform.OS;

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

describe('TextInput (multiline) on web at QA font scale 2.0', () => {
  it('caps the mirror and the textarea at 24 × 2 per row, with no native measuring line', async () => {
    await renderUi(<TextInput label="Über dich" multiline maxRows={5} value="Schrauber aus Stuttgart." onChangeText={jest.fn()} testID="bio" />);
    expect(styleOf('bio').lineHeight).toBe(typography.input.lineHeight * 2);
    expect(styleOf('bio').maxHeight).toBe(typography.input.lineHeight * 2 * 5);
    // The hidden box around the mirror text carries the same cap.
    let box = measureOf('bio', 'mirror').parent;
    while (box && (StyleSheet.flatten(box.props.style as TextStyle) ?? {}).maxHeight === undefined) box = box.parent;
    expect((StyleSheet.flatten(box?.props.style as TextStyle) ?? {}).maxHeight).toBe(typography.input.lineHeight * 2 * 5);
    expect(queryMeasureOf('bio', 'line')).toBeNull();
  });

  it('hands the linear line to a maxRows function', async () => {
    const rows = jest.fn(() => 3);
    await renderUi(<TextInput label="Über dich" multiline maxRows={rows} onChangeText={jest.fn()} testID="bio" />);
    expect(rows).toHaveBeenCalledWith(typography.input.lineHeight * 2);
  });
});
