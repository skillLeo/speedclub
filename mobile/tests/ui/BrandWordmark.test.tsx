import { fireEvent, screen } from '@testing-library/react-native';

import { hydrateThemePreference } from '@/theme';
import { BrandWordmark } from '@/ui/BrandWordmark';

import { flat, renderUi } from './helpers';

beforeAll(hydrateThemePreference);

describe('BrandWordmark', () => {
  it('keeps the ratio of the file at any width', async () => {
    await renderUi(<BrandWordmark width={240} testID="w" />);
    const box = flat(screen.getByTestId('w').props.style);
    expect(box.width).toBe(240);
    expect(box.aspectRatio).toBeCloseTo(1200 / 359);
    expect(screen.getByTestId('w.image').props.contentFit).toBe('contain');
  });

  it('fits inside a given height, where the rows below need a whole-pixel edge', async () => {
    await renderUi(<BrandWordmark width={120} height={36} testID="w" />);
    const box = flat(screen.getByTestId('w').props.style);
    expect(box.width).toBe(120);
    expect(box.height).toBe(36);
    expect(box.aspectRatio).toBeUndefined();
    expect(flat(screen.getByTestId('w.image').props.style).height).toBe(36);
    expect(screen.getByTestId('w.image').props.contentFit).toBe('contain');
  });

  it('has its own ratio when stacked', async () => {
    await renderUi(<BrandWordmark width={200} shape="square" testID="w" />);
    expect(flat(screen.getByTestId('w').props.style).aspectRatio).toBeCloseTo(900 / 591);
  });

  describe('a wordmark published in the admin (ADM-28)', () => {
    const custom = { white: { uri: 'https://speedclub.test/storage/brand/wide-white.webp', ratio: 4 }, black: null };
    /** expo-image hands its source on as a list; the published file is the one with its address. */
    const drawsCustom = (id: string) => JSON.stringify(screen.getByTestId(`${id}.image`).props.source).includes(custom.white.uri);

    it('is drawn at its own ratio, never stretched: a wider one takes the width and is lower', async () => {
      await renderUi(<BrandWordmark width={240} tone="white" custom={custom} testID="w" />);
      const box = flat(screen.getByTestId('w').props.style);
      expect(box.width).toBe(240);
      expect(box.aspectRatio).toBe(4);
      expect(drawsCustom('w')).toBe(true);
    });

    it('a narrower one keeps the bundled height and gets narrower', async () => {
      await renderUi(<BrandWordmark width={240} tone="white" custom={{ white: { uri: custom.white.uri, ratio: 2 }, black: null }} testID="w" />);
      const box = flat(screen.getByTestId('w').props.style);
      expect(box.aspectRatio).toBe(2);
      expect((box.width as number) / 2).toBeCloseTo(240 / (1200 / 359));
    });

    it('fits inside a fixed box at its own ratio', async () => {
      await renderUi(<BrandWordmark width={120} height={36} tone="white" custom={{ white: { uri: custom.white.uri, ratio: 2 }, black: null }} testID="w" />);
      expect(flat(screen.getByTestId('w').props.style)).toMatchObject({ width: 120, height: 36 });
      expect(flat(screen.getByTestId('w.image').props.style)).toMatchObject({ width: 72, height: 36 });
    });

    it('keeps the bundled file for a tone without one, for the stacked logo, and after a failed load', async () => {
      await renderUi(<BrandWordmark width={240} tone="black" custom={custom} testID="b" />);
      expect(drawsCustom('b')).toBe(false);
      await renderUi(<BrandWordmark width={240} tone="white" shape="square" custom={custom} testID="s" />);
      expect(drawsCustom('s')).toBe(false);
      await renderUi(<BrandWordmark width={240} tone="white" custom={custom} testID="f" />);
      expect(drawsCustom('f')).toBe(true);
      await fireEvent(screen.getByTestId('f.image'), 'error', { nativeEvent: { error: 'gone' } });
      expect(drawsCustom('f')).toBe(false);
      expect(flat(screen.getByTestId('f').props.style).aspectRatio).toBeCloseTo(1200 / 359);
    });
  });

  it('is named SPEED CLUB, unless decorative', async () => {
    await renderUi(<BrandWordmark width={200} testID="a" />);
    expect(screen.getByTestId('a').props['aria-label']).toBe('SPEED CLUB');
    await renderUi(<BrandWordmark width={200} decorative testID="d" />);
    expect(screen.getByTestId('d', { includeHiddenElements: true }).props['aria-label']).toBeUndefined();
  });
});
