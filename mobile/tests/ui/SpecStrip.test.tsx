import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { hydrateThemePreference, radius, space, themes, typography } from '@/theme';
import { SpecStrip } from '@/ui/SpecStrip';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

const items = [
  { value: '500', label: 'PS' },
  { value: '540', label: 'Nm' },
  { value: '2002', label: 'Baujahr' },
  { value: 'AWD', label: 'Antrieb' },
];

const rowsOf = (testID: string) => screen.getByTestId(testID).children;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

describe('SpecStrip', () => {
  it('is bg.surface radius 12, four equal columns in one row with 16 vertical padding', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    const strip = flat(screen.getByTestId('s').props.style);
    expect(strip.backgroundColor).toBe(themes.carbon.color.bg.surface);
    expect(strip.borderRadius).toBe(radius.md);
    expect(rowsOf('s')).toHaveLength(1);
    const cell = flat(screen.getByTestId('s.3').props.style);
    expect(cell.flex).toBe(1);
    expect(cell.paddingVertical).toBe(space[16]);
  });

  it('uses spec.strip values, caption tertiary labels and hairlines only between columns', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    expect(flat(screen.getByText('2002').props.style).fontSize).toBe(typography.specStrip.fontSize);
    const label = flat(screen.getByText('Baujahr').props.style);
    expect(label.fontSize).toBe(typography.caption.fontSize);
    expect(label.color).toBe(themes.carbon.color.text.tertiary);
    expect(flat(screen.getByTestId('s.0').props.style).borderLeftWidth).toBeUndefined();
    expect(flat(screen.getByTestId('s.1').props.style).borderLeftColor).toBe(themes.carbon.color.border.subtle);
  });

  it('becomes two rows of two at a large font, so no number breaks or clips', async () => {
    dimensions.mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    await renderUi(<SpecStrip items={items} testID="s" />);
    expect(rowsOf('s')).toHaveLength(2);
    expect(flat(screen.getByTestId('s.0').props.style).borderLeftWidth).toBeUndefined();
    expect(flat(screen.getByTestId('s.2').props.style).borderLeftWidth).toBeUndefined();
    expect(flat(screen.getByTestId('s.3').props.style).borderLeftColor).toBe(themes.carbon.color.border.subtle);
    expect(screen.getByText('AWD')).toBeTruthy();
  });

  it('has no fixed height on a text container', async () => {
    await renderUi(<SpecStrip items={items} testID="s" />);
    expect(flat(screen.getByTestId('s').props.style).height).toBeUndefined();
    expect(flat(screen.getByTestId('s.0').props.style).height).toBeUndefined();
  });
});
