import { fireEvent, screen } from '@testing-library/react-native';
import { Platform, useWindowDimensions } from 'react-native';

import { hydrateThemePreference, radius, typography } from '@/theme';
import { GridTile } from '@/ui/GridTile';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 }));

describe('GridTile', () => {
  it('does not hyphenate a clamped title, so the ellipsis follows a whole word (DQ-027)', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      await renderUi(<GridTile title="Porsche 911 Clubsport S mit Sportfahrwerk" photo={{ source: 'https://x/a.webp' }} />);
      expect(screen.getByText('Porsche 911 Clubsport S mit Sportfahrwerk').props.android_hyphenationFrequency).toBe('none');
    } finally {
      os.restore();
    }
  });

  it('has a 4:3 photo radius 8, a two-line callout title and a caption spec line', async () => {
    await renderUi(<GridTile title="BMW M4 G82" spec="510 PS · RWD" photo={{ source: 'https://x/a.webp' }} testID="t" />);
    const photo = flat(screen.getByTestId('t.photo').props.style);
    expect(photo.aspectRatio).toBeCloseTo(4 / 3);
    expect(photo.borderRadius).toBe(radius.sm);
    const title = screen.getByText('BMW M4 G82');
    expect(title.props.numberOfLines).toBe(2);
    expect(flat(title.props.style).fontSize).toBe(typography.callout.fontSize);
    expect(flat(screen.getByText('510 PS · RWD').props.style).fontSize).toBe(typography.caption.fontSize);
  });

  it.each([
    [360, 2],
    [390, 2],
    [430, 2],
    [390, 1.5],
  ])('never cuts make and model at %s wide, font scale %s (§4 over §8)', async (width, fontScale) => {
    dimensions.mockReturnValue({ width, height: 844, scale: 1, fontScale });
    await renderUi(<GridTile title="Nissan Skyline GT-R R34" spec="500 PS · AWD" photo={{}} testID="t" />);
    expect(screen.getByText('Nissan Skyline GT-R R34').props.numberOfLines).toBeUndefined();
  });

  it('is a link when pressable and static otherwise', async () => {
    const onPress = jest.fn();
    await renderUi(<GridTile title="BMW M4 G82" spec="510 PS" photo={{}} onPress={onPress} testID="t" />);
    await fireEvent.press(screen.getByRole('link', { name: 'BMW M4 G82, 510 PS' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await renderUi(<GridTile title="Static" photo={{}} testID="s" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
