import { act, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { hydrateThemePreference, material, themes } from '@/theme';
import { ChromeSurface, FloatingControl } from '@/ui/chrome';
import { chromeMaterialFor, claimBlurSlot, holdsBlurSlot, type ChromeConditions } from '@/ui/chromeMaterial';
import { __setAccessibilityForTests } from '@/ui/motion';

import { flat, renderUi } from './helpers';

// Jest runs as iOS on a host without the Liquid Glass API: the cross-platform path, as on any device before iOS 26.
jest.mock('expo-glass-effect', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { GlassView: View, isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false };
});

beforeAll(hydrateThemePreference);
afterEach(() => __setAccessibilityForTests({ reduceTransparency: false }));

const base: ChromeConditions = {
  platform: 'ios',
  floating: false,
  reduceTransparency: false,
  glassAvailable: false,
  backdropSupported: false,
  androidApi: 0,
  hasBlurTarget: false,
  holdsBlurSlot: false,
};

describe('chromeMaterialFor (09 §4.4)', () => {
  it('gives glass only to a floating control on iOS with the Liquid Glass API', () => {
    expect(chromeMaterialFor({ ...base, floating: true, glassAvailable: true })).toBe('glass');
    expect(chromeMaterialFor({ ...base, floating: false, glassAvailable: true })).toBe('translucent');
    expect(chromeMaterialFor({ ...base, floating: true, glassAvailable: false })).toBe('translucent');
  });

  it('turns opaque under reduced transparency, everywhere', () => {
    for (const platform of ['ios', 'android', 'web']) {
      expect(
        chromeMaterialFor({
          ...base,
          platform,
          floating: true,
          glassAvailable: true,
          backdropSupported: true,
          androidApi: 34,
          hasBlurTarget: true,
          holdsBlurSlot: true,
          reduceTransparency: true,
        }),
      ).toBe('opaque');
    }
  });

  it('blurs on web only where backdrop-filter works', () => {
    expect(chromeMaterialFor({ ...base, platform: 'web', backdropSupported: true })).toBe('translucent');
    expect(chromeMaterialFor({ ...base, platform: 'web', backdropSupported: false })).toBe('opaque');
    expect(chromeMaterialFor({ ...base, platform: 'web', floating: true, glassAvailable: true, backdropSupported: true })).toBe('translucent');
  });

  it('keeps Android opaque unless API 31+, a blur target and the one blur slot all hold', () => {
    const android = { ...base, platform: 'android', androidApi: material.chrome.androidBlurMinApi, hasBlurTarget: true, holdsBlurSlot: true };
    expect(chromeMaterialFor(android)).toBe('translucent');
    expect(chromeMaterialFor({ ...android, androidApi: 30 })).toBe('opaque');
    expect(chromeMaterialFor({ ...android, hasBlurTarget: false })).toBe('opaque');
    expect(chromeMaterialFor({ ...android, holdsBlurSlot: false })).toBe('opaque');
    expect(chromeMaterialFor({ ...android, floating: true, glassAvailable: true })).toBe('translucent');
  });
});

describe('Android blur slot', () => {
  it('lets one surface blur at a time and hands the slot on in mount order', () => {
    expect(material.chrome.androidMaxBlurViews).toBe(1);
    const releaseA = claimBlurSlot('a');
    const releaseB = claimBlurSlot('b');
    expect(holdsBlurSlot('a')).toBe(true);
    expect(holdsBlurSlot('b')).toBe(false);
    releaseA();
    expect(holdsBlurSlot('b')).toBe(true);
    releaseB();
    expect(holdsBlurSlot('b')).toBe(false);
  });
});

describe('ChromeSurface', () => {
  it('renders chrome.translucent over a blur on iOS without Liquid Glass', async () => {
    await renderUi(<ChromeSurface testID="c" />);
    expect(StyleSheet.flatten(screen.getByTestId('c').props.style).backgroundColor).toBe(themes.carbon.color.chrome.translucent);
  });

  it('turns to chrome.opaque live when reduce transparency comes on', async () => {
    await renderUi(<ChromeSurface testID="c" />);
    await act(async () => __setAccessibilityForTests({ reduceTransparency: true }));
    expect(StyleSheet.flatten(screen.getByTestId('c').props.style).backgroundColor).toBe(themes.carbon.color.chrome.opaque);
  });
});

describe('FloatingControl', () => {
  it('is a named 44 round button with its own chrome surface', async () => {
    const onPress = jest.fn();
    await renderUi(<FloatingControl icon="caret-left" label="Zurück" onPress={onPress} testID="f" />);
    const target = screen.getByRole('button', { name: 'Zurück' });
    const style = StyleSheet.flatten(target.props.style);
    expect(style.width).toBe(44);
    expect(style.height).toBe(44);
    expect(screen.getByTestId('f.surface')).toBeTruthy();
  });

  it('draws its glyph inside its own surface, never under a positioned sibling (DQ-901)', async () => {
    await renderUi(<FloatingControl icon="caret-left" label="Zurück" onPress={jest.fn()} testID="f" />);
    const surface = screen.getByTestId('f.surface');
    // The surface is the glyph's ground: an in-flow box of 44, not an absolute layer laid over the visual.
    const style = StyleSheet.flatten(surface.props.style);
    expect(style.position).toBeUndefined();
    expect(style.width).toBe(44);
    expect(style.height).toBe(44);
    const glyph = within(surface).getByTestId('f.glyph');
    // Native paints siblings in order: the blur layer of the translucent material comes first, the glyph after it, last.
    const layers = surface.children.filter((child) => typeof child !== 'string');
    const glyphLayer = layers.findIndex((layer) => layer === glyph || within(layer).queryByTestId('f.glyph') !== null);
    expect(glyphLayer).toBe(layers.length - 1);
    layers.slice(0, glyphLayer).forEach((layer) => expect(flat(layer.props.style).position).toBe('absolute'));
  });
});

