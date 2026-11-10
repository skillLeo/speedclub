import { screen } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { OnPhotoButtons } from '@/features/gallery/sections/ButtonsSection';
import { hydrateThemePreference, themes } from '@/theme';

import { flat, renderUi } from './helpers';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 390, height: 844, scale: 1, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);

describe('Gallery: buttons on a photo', () => {
  it.each([360, 390])('wraps at %i, font scale 2, so the second action stays on the photo', async (width) => {
    dimensions.mockReturnValue({ width, height: 844, scale: 1, fontScale: 2 });
    await renderUi(<OnPhotoButtons />);
    expect(flat(screen.getByTestId('DEV-01.buttons.onPhotoRow').props.style).flexWrap).toBe('wrap');
    expect(screen.getByTestId('DEV-01.buttons.onPhotoSkip')).toBeTruthy();
  });

  it.each([1, 1.3, 2])('at font scale %s the row sits on the band in the end colour of the scrim (ADR-129)', async (fontScale) => {
    dimensions.mockReturnValue({ width: 390, height: 844, scale: 1, fontScale });
    await renderUi(<OnPhotoButtons />);
    expect(flat(screen.getByTestId('DEV-01.buttons.onPhotoRow').props.style).backgroundColor).toBe(
      themes.carbon.color.overlay.photoScrimEnd,
    );
  });
});
