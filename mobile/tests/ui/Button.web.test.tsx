/** DQ-063: a single word wider than the button stays inside it on web, as a last resort after the spaces. */
import { screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { Button } from '@/ui/Button';

import { flat, renderUi } from './helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

beforeAll(hydrateThemePreference);

describe('Button on web', () => {
  it.each(['l', 'm', 's'] as const)('size %s: the label may break inside a word, and that counts for its minimum width', async (size) => {
    await renderUi(<Button label="Unbedenklichkeitsbescheinigung" size={size} />);
    expect(flat(screen.getByText('Unbedenklichkeitsbescheinigung').props.style)).toMatchObject({ overflowWrap: 'anywhere' });
  });
});
