/** DQ-803: on web a hidden mirror of the text sizes the textarea, so both must be set in one type role. */
import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { hydrateThemePreference, size, typography } from '@/theme';
import { Composer, COMPOSER_TEXT_ROLE } from '@/ui/Composer';

import { flat, measureOf, queryMeasureOf, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
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

describe('Composer on web', () => {
  it('sets the mirror in the textarea’s role (input 16/24), so the hit box is 44', async () => {
    await renderUi(<Composer value="" onChangeText={jest.fn()} onSend={jest.fn()} placeholder="Nachricht schreiben" sendLabel="Senden" testID="c" />);
    expect(COMPOSER_TEXT_ROLE).toBe('input');
    const mirror = StyleSheet.flatten(measureOf('c', 'mirror').props.style as TextStyle) ?? {};
    const input = StyleSheet.flatten(screen.getByTestId('c.input').props.style as TextStyle) ?? {};
    for (const key of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing'] as const) expect(mirror[key]).toEqual(input[key]);
    expect(mirror.lineHeight).toBe(typography.input.lineHeight);
    const box = flat(screen.getByTestId('c.box').props.style);
    const hit = (mirror.lineHeight as number) + 2 * (box.paddingVertical as number) + (box.borderTopWidth as number) + (box.borderBottomWidth as number);
    expect(hit).toBe(size.composerMin);
    expect(hit).toBeGreaterThanOrEqual(size.touchMin);
  });

  it('keeps the linear cap: the browser scales the role itself, so no measuring line (unchanged by the A7 fix)', async () => {
    await renderUi(<Composer value="" onChangeText={jest.fn()} onSend={jest.fn()} placeholder="Nachricht schreiben" sendLabel="Senden" testID="c" />);
    expect(queryMeasureOf('c', 'line')).toBeNull();
    expect(flat(screen.getByTestId('c.input').props.style).maxHeight).toBe(typography.input.lineHeight * size.composerMaxLines);
  });
});
