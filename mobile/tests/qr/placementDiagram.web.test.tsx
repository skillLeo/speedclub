/** Code review should-fix: the marker figures in QR-03's drawing are set in the web face of `callout`, not in an embedded face name. */
import { screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PlacementDiagram } from '@/features/qr/components/PlacementDiagram';
import { fonts, hydrateThemePreference } from '@/theme';

import { renderUi } from '../ui/helpers';

jest.mock('@/lib/platform', () => ({ ...jest.requireActual('@/lib/platform'), isWeb: true, isNative: false }));
// There is no document in this test environment.
jest.mock('@/theme/webDocument', () => ({ ...jest.requireActual('@/theme/webDocument'), applyThemeToDocument: jest.fn() }));

// Records the props of every SVG text the drawing sets; the rest of react-native-svg stays real.
const svgTextProps: Record<string, unknown>[] = [];
jest.mock('react-native-svg', () => {
  const actual = jest.requireActual<typeof import('react-native-svg')>('react-native-svg');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  function RecordedText(props: Record<string, unknown>) {
    svgTextProps.push(props);
    return createElement(actual.Text, props);
  }
  return { ...actual, __esModule: true, default: actual.default, Text: RecordedText };
});

const originalOS = Platform.OS;

beforeAll(hydrateThemePreference);
beforeEach(() => {
  Platform.OS = 'web';
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe('PlacementDiagram on web', () => {
  it('sets the marker figures in the Inter family stack at 500, the web face of callout', async () => {
    await renderUi(<PlacementDiagram testID="d" />);
    expect(screen.getByTestId('d')).toBeTruthy();
    const markers = new Map(svgTextProps.map((props) => [String(props.children), props]));
    expect([...markers.keys()].sort()).toEqual(['1', '2', '3', '4']);
    for (const marker of markers.values()) {
      expect(marker.fontFamily).toBe(fonts.ui.css);
      expect(String(marker.fontWeight)).toBe('500');
    }
  });
});
