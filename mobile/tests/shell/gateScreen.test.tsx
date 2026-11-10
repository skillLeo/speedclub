// SYS-02 with a message the team wrote (DQ-093): short and centred is the brand moment, long needs a left edge to read.
import { screen } from '@testing-library/react-native';
import type { TextStyle } from 'react-native';

import { gateBodyWidth, GateScreen } from '@/features/system/screens/GateScreen';
import { hydrateThemePreference, size, space } from '@/theme';

import { flat, renderUi } from '../ui/helpers';

const mockWindow = { current: { width: 390, height: 844, scale: 2, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));
const mockRefetch = jest.fn();
// The logo reads the published branding (ADM-28); none here, so the bundled wordmark shows.
const mockBranding = { logo: null, splash_image: null, welcome_hero: null, accent_set: 'default', default_theme: 'system' };
jest.mock('@/api/queries/appConfig', () => ({
  useAppConfig: () => ({ config: { branding: mockBranding }, refetch: mockRefetch, isFetching: false }),
}));

const SHORT = 'Wir sind gleich wieder da.';
const LONG =
  'Wir ziehen heute Nacht auf neue Server um. Die App ist bis etwa sechs Uhr morgens nicht erreichbar. Deine Fahrzeuge, Fotos und Nachrichten bleiben dabei unverändert erhalten.';

beforeAll(hydrateThemePreference);

const alignOf = (testID: string) => (flat(screen.getByTestId(testID).props.style) as TextStyle).textAlign;

const gate = (body: string, fontScale: number = 1, width: number = 390) => {
  mockWindow.current = { width, height: 844, scale: 2, fontScale };
  return renderUi(<GateScreen routeId="SYS-02" title="Kurze Wartung" body={body} />);
};

describe('the gate screen', () => {
  it('centres a short message', async () => {
    await gate(SHORT);
    expect(alignOf('SYS-02.state.body')).toBe('center');
  });

  it('sets a long message left-aligned, with the same title, body and action', async () => {
    await gate(LONG);
    const body = screen.getByTestId('SYS-02.state.body');
    expect(body).toHaveTextContent(LONG);
    expect(alignOf('SYS-02.state.body')).toBeUndefined();
    expect(alignOf('SYS-02.state.title')).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Kurze Wartung' })).toBeTruthy();
    expect(screen.getByTestId('SYS-02.state.action')).toHaveTextContent('Erneut prüfen');
    expect(screen.getByTestId('SYS-02.logo')).toBeTruthy();
  });

  it('counts lines, not letters: a line that fits three lines at 100 % does not at 200 %', async () => {
    const middling = SHORT.repeat(3);
    const small = await gate(middling);
    expect(alignOf('SYS-02.state.body')).toBe('center');
    small.unmount();
    await gate(middling, 2);
    expect(alignOf('SYS-02.state.body')).toBeUndefined();
  });

  it('measures the column EmptyState lays out', () => {
    expect(gateBodyWidth(360)).toBe(360 - 2 * space[24] - 2 * space[16]);
    expect(gateBodyWidth(1440)).toBe(size.dialogMaxWidth - 2 * space[16]);
  });
});
