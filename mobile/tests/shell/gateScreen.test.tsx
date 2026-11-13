// SYS-02 with a message the team wrote (DQ-093, 09 §7.14 M4.10): a photo-backed brand state, always left-aligned (no centred hero).
import { screen } from '@testing-library/react-native';
import type { TextStyle } from 'react-native';

import { MAINTENANCE_PHOTO } from '@/features/system/photos';
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
  return renderUi(<GateScreen routeId="SYS-02" title="Kurze Wartung" body={body} photo={MAINTENANCE_PHOTO} />);
};

describe('the gate screen', () => {
  it('sets a short message on the left too, under the photo, with the one action', async () => {
    await gate(SHORT);
    expect(alignOf('SYS-02.state.body')).toBeUndefined();
    expect(screen.getByTestId('SYS-02.photo')).toBeTruthy();
    expect(screen.getByTestId('SYS-02.state.action')).toHaveTextContent('Erneut prüfen');
    expect(screen.queryByTestId('SYS-02.store')).toBeNull();
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

  it('puts the photo beside the copy from 768', async () => {
    await gate(SHORT, 1, 1280);
    expect(screen.getByTestId('SYS-02.photo')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Kurze Wartung' })).toBeTruthy();
  });

  it('measures the column EmptyState lays out', () => {
    expect(gateBodyWidth(360)).toBe(360 - 2 * space[24] - 2 * space[16]);
    expect(gateBodyWidth(1440)).toBe(size.dialogMaxWidth - 2 * space[16]);
  });
});
