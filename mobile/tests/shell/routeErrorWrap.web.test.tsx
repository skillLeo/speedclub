/**
 * DQ-255: the message of an empty or error state is centred, and on web its lines are balanced, so no short word ("sie.",
 * "zurück.") stands alone on the second line. The route error's copy itself: routeErrorInModal.test.tsx.
 */
import { screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { ErrorState } from '@/ui';

import { flat, renderUi } from '../ui/helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));
jest.mock('expo-haptics', () => ({}));

beforeAll(hydrateThemePreference);

it('balances the lines of the message on web', async () => {
  await renderUi(<ErrorState title="Diese Ansicht konnte nicht geladen werden" message="Versuch es noch einmal oder schließ die Ansicht." testID="shell.routeError" />);
  const body = screen.getByTestId('shell.routeError.body');
  expect(body).toHaveTextContent('Versuch es noch einmal oder schließ die Ansicht.');
  const style = flat(body.props.style) as { textAlign?: string; textWrapStyle?: string };
  expect(style.textWrapStyle).toBe('balance');
  expect(style.textAlign).toBe('center');
});

it('balances the title too, so no single word ends it on web (DQ-258)', async () => {
  await renderUi(<ErrorState title="Diese Ansicht konnte nicht geladen werden" message="Versuch es gleich noch einmal." testID="shell.routeError" />);
  const style = flat(screen.getByTestId('shell.routeError.title').props.style) as { textAlign?: string; textWrapStyle?: string };
  expect(style.textWrapStyle).toBe('balance');
  expect(style.textAlign).toBe('center');
});
