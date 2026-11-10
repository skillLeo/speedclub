import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { hydrateThemePreference, motion, radius, ThemeProvider, themes } from '@/theme';
import { focalToPosition, Photo, ratioOf } from '@/ui/Photo';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('Photo', () => {
  it.each([
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['1:1', 1],
    ['3:1', 3],
    ['9:16', 9 / 16],
  ] as const)('reserves the box of %s', async (aspect, ratio) => {
    expect(ratioOf(aspect)).toBeCloseTo(ratio);
    await renderUi(<Photo aspect={aspect} source="https://x/a.webp" testID="p" />);
    expect(flat(screen.getByTestId('p').props.style).aspectRatio).toBeCloseTo(ratio);
  });

  it('crops with cover around the focal point, with blurhash and the 200 ms fade', async () => {
    await renderUi(<Photo aspect="4:3" source="https://x/a.webp" blurhash="LKO2?U%2Tw=w" focal={{ x: 0.25, y: 0.6 }} testID="p" />);
    const image = screen.getByTestId('p.image');
    expect(image.props.contentFit).toBe('cover');
    expect(image.props.contentPosition).toEqual({ left: '25%', top: '60%' });
    expect(image.props.placeholderContentFit).toBe('cover');
    expect(JSON.stringify(image.props.placeholder)).toContain('blurhash:/LKO2');
    expect(image.props.transition).toEqual(expect.objectContaining({ duration: motion.duration.small }));
  });

  it('clamps a focal point outside the photo', () => {
    expect(focalToPosition({ x: -1, y: 2 })).toEqual({ left: '0%', top: '100%' });
  });

  it('marks the surface as a photo for the DOM audit and applies the corner', async () => {
    await renderUi(<Photo aspect="4:3" source="https://x/a.webp" corner="md" testID="p" />);
    const root = screen.getByTestId('p');
    expect(root.props.dataSet).toEqual({ qaExempt: 'photo' });
    const style = flat(root.props.style);
    expect(style.borderRadius).toBe(radius.md);
    expect(style.overflow).toBe('hidden');
    expect(style.backgroundColor).toBe(themes.carbon.color.bg.raised);
  });

  it('shows the fallback surface without a source', async () => {
    await renderUi(<Photo aspect="4:3" source={null} testID="p" />);
    expect(screen.getByTestId('p.fallback', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('p.image')).toBeNull();
  });

  it('shows the fallback after a load error, and tries again for the next source', async () => {
    const providers = (element: ReactElement) => (
      <GestureHandlerRootView>
        <ThemeProvider>{element}</ThemeProvider>
      </GestureHandlerRootView>
    );
    const { rerender } = await renderUi(<Photo aspect="4:3" source="https://x/broken.webp" testID="p" />);
    await fireEvent(screen.getByTestId('p.image'), 'error', { nativeEvent: { error: 'x' } });
    expect(screen.getByTestId('p.fallback', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('p.image')).toBeNull();
    await rerender(providers(<Photo aspect="4:3" source="https://x/next.webp" testID="p" />));
    expect(screen.getByTestId('p.image')).toBeTruthy();
  });

  it('names the photo only when a label is given', async () => {
    await renderUi(<Photo aspect="4:3" source="https://x/a.webp" label="Skyline von vorn" testID="a" />);
    expect(screen.getByTestId('a.image').props.accessible).toBe(true);
    await renderUi(<Photo aspect="4:3" source="https://x/a.webp" testID="b" />);
    expect(screen.getByTestId('b.image', { includeHiddenElements: true }).props.accessible).toBe(false);
  });

  it('draws children over the photo', async () => {
    await renderUi(<Photo aspect="16:9" source="https://x/a.webp"><Text>Overlay</Text></Photo>);
    expect(screen.getByText('Overlay')).toBeTruthy();
  });
});
