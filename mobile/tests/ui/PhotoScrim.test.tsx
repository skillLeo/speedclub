import { screen } from '@testing-library/react-native';

import { hydrateThemePreference, themes } from '@/theme';
import { PhotoScrim } from '@/ui/PhotoScrim';

import { flat, renderUi } from './helpers';

jest.mock('expo-linear-gradient', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { LinearGradient: View };
});

beforeAll(hydrateThemePreference);

describe('PhotoScrim', () => {
  it('covers the bottom 45 %, and takes no touches', async () => {
    await renderUi(<PhotoScrim testID="s" />);
    const style = flat(screen.getByTestId('s', { includeHiddenElements: true }).props.style);
    expect(style.height).toBe('45%');
    expect(style.bottom).toBe(0);
    expect(style.pointerEvents).toBe('none');
  });

  it('ends in overlay.photoScrimEnd', async () => {
    await renderUi(<PhotoScrim testID="s" />);
    const scrim = screen.getByTestId('s', { includeHiddenElements: true });
    expect(scrim.props.colors).toEqual(['transparent', themes.carbon.color.overlay.photoScrimEnd]);
  });

  it('takes the 55 % of FS-1', async () => {
    await renderUi(<PhotoScrim coverage={0.55} testID="s" />);
    expect(flat(screen.getByTestId('s', { includeHiddenElements: true }).props.style).height).toBe('55%');
  });
});
