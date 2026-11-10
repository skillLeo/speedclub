/** DQ-043: on web a sheet starts on its title, or on a target without one, never on the grabber. */
import { screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { Sheet } from '@/ui/Sheet';
import { moveFocusIntoSheet } from '@/ui/sheetMath';

import { renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
// The refs of this renderer are no DOM nodes; what the function does with real ones is pinned in Sheet.test.tsx.
jest.mock('@/ui/sheetMath', () => ({ ...jest.requireActual('@/ui/sheetMath'), moveFocusIntoSheet: jest.fn() }));
jest.mock('expo-haptics', () => ({ ImpactFeedbackStyle: { Light: 'light' }, impactAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-keyboard-controller', () => jest.requireActual('react-native-keyboard-controller/jest'));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeAll(() => {
  Object.assign(globalThis, { document: { activeElement: null, getElementById: () => null } });
  return hydrateThemePreference();
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'document');
});

describe('Sheet on web', () => {
  beforeEach(() => (moveFocusIntoSheet as jest.Mock).mockClear());

  it('its title takes focus from code and is no tab stop, and the outline stays off', async () => {
    await renderUi(<Sheet visible onClose={jest.fn()} title="Foto bearbeiten" testID="s" />);
    const title = screen.getByTestId('s.title');
    expect(title.props.tabIndex).toBe(-1);
    expect(Object.assign({}, ...[title.props.style].flat(Infinity))).toMatchObject({ outlineStyle: 'none' });
    expect(screen.queryByTestId('s.focusStart', { includeHiddenElements: true })).toBeNull();
    expect(moveFocusIntoSheet).toHaveBeenCalledTimes(1);
  });

  it('without a title a target before the grabber takes that role', async () => {
    await renderUi(<Sheet visible onClose={jest.fn()} label="Foto bearbeiten" testID="s" />);
    expect(screen.getByTestId('s.focusStart', { includeHiddenElements: true }).props.tabIndex).toBe(-1);
  });
});
