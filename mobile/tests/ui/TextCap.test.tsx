/**
 * N4 (APK Build 9): a capped role grows its glyphs and its line box together only up to its cap on Android and iOS. React
 * Native 0.88 caps `fontSize` with `maxFontSizeMultiplier`, but Android's TextAttributeProps scales `lineHeight` with the
 * uncapped SP scale, so Text sets every capped text at min(font scale, cap) itself with OS scaling off.
 */
import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useWindowDimensions, type TextStyle } from 'react-native';

import { hydrateThemePreference, maxFontScale, ThemeProvider, typography, type TypeVariant } from '@/theme';
import { nativeFixedScale, Text } from '@/ui/Text';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 360, height: 640, scale: 2, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;
const originalOS = Platform.OS;

type Role = { fontSize: number; lineHeight: number; letterSpacing?: number };
const roleOf = (variant: TypeVariant) => typography[variant] as unknown as Role;
const CAPPED = Object.keys(maxFontScale) as (keyof typeof maxFontScale)[];
const UNCAPPED: TypeVariant[] = ['body', 'caption', 'callout', 'headline', 'labelCaps', 'displayTitle'];

async function textAt(fontScale: number, element: React.ReactElement) {
  dimensions.mockReturnValue({ width: 360, height: 640, scale: 2, fontScale });
  await render(<ThemeProvider>{element}</ThemeProvider>);
  const node = screen.getByTestId('t');
  return { props: node.props, style: StyleSheet.flatten(node.props.style as TextStyle) as TextStyle };
}

beforeAll(hydrateThemePreference);
afterEach(() => {
  Platform.OS = originalOS;
});

describe.each(['android', 'ios'] as const)('capped roles on %s', (os) => {
  beforeEach(() => {
    Platform.OS = os;
  });

  it('covers every role with a cap in the generated typography', () => {
    // DQ-1121: the make wordmark is capped at 1.3 like the other display roles.
    expect(CAPPED.sort()).toEqual(['displayWordmark', 'heroNumeral', 'heroNumeralS', 'labelBadge', 'webTab']);
  });

  it.each(CAPPED)('%s: the full role at font scale 1.0', async (variant) => {
    const { props, style } = await textAt(1, <Text testID="t" variant={variant}>510</Text>);
    expect(props.allowFontScaling).toBe(false);
    expect(style.fontSize).toBe(roleOf(variant).fontSize);
    expect(style.lineHeight).toBe(roleOf(variant).lineHeight);
  });

  it.each(CAPPED)('%s: size, line box and tracking at the 1.3 cap at font scale 2.0, the OS scaling off', async (variant) => {
    const cap = maxFontScale[variant];
    const { props, style } = await textAt(2, <Text testID="t" variant={variant}>510</Text>);
    expect(props.allowFontScaling).toBe(false);
    expect(style.fontSize).toBeCloseTo(roleOf(variant).fontSize * cap);
    expect(style.lineHeight).toBeCloseTo(roleOf(variant).lineHeight * cap);
    if (roleOf(variant).letterSpacing) expect(style.letterSpacing).toBeCloseTo((roleOf(variant).letterSpacing ?? 0) * cap);
  });

  it('follows the font scale below the cap, as other text does', async () => {
    const { style } = await textAt(1.15, <Text testID="t" variant="labelBadge">Hauptfahrzeug</Text>);
    expect(style.lineHeight).toBeCloseTo(roleOf('labelBadge').lineHeight * 1.15);
  });

  it.each(UNCAPPED)('%s: unchanged, the OS scales it', async (variant) => {
    const { props, style } = await textAt(2, <Text testID="t" variant={variant}>Fahrwerk</Text>);
    expect(props.allowFontScaling).toBeUndefined();
    expect(props.maxFontSizeMultiplier).toBeUndefined();
    expect(style.fontSize).toBe(roleOf(variant).fontSize);
    expect(style.lineHeight).toBe(roleOf(variant).lineHeight);
  });

  it('applies a lower cap from fontScaleCap or maxFontSizeMultiplier the same way', async () => {
    const viaProp = await textAt(2, <Text testID="t" variant="body" maxFontSizeMultiplier={1.5}>Anmelden</Text>);
    expect(viaProp.props.allowFontScaling).toBe(false);
    expect(viaProp.style.lineHeight).toBeCloseTo(roleOf('body').lineHeight * 1.5);
    const tab = await textAt(2, <Text testID="t" variant="webTab" maxFontSizeMultiplier={1.15}>Nachrichten</Text>);
    expect(tab.style.fontSize).toBeCloseTo(roleOf('webTab').fontSize * 1.15);
    const pill = await textAt(2, <Text testID="t" variant="caption" fontScaleCap={1.3}>Verbaut</Text>);
    expect(pill.style.lineHeight).toBeCloseTo(roleOf('caption').lineHeight * 1.3);
  });

  it('keeps a caller’s allowFontScaling={false}: no scaling at all', async () => {
    const { props, style } = await textAt(2, <Text testID="t" variant="labelBadge" allowFontScaling={false}>AB</Text>);
    expect(props.allowFontScaling).toBe(false);
    expect(style.lineHeight).toBe(roleOf('labelBadge').lineHeight);
  });
});

describe('nativeFixedScale', () => {
  it('is never used on web, which caps through the QA font scale itself', () => {
    expect(nativeFixedScale('labelBadge', 2, {}, 'web')).toBeUndefined();
  });

  it('reads a multiplier below 1 as no cap, as React Native does', () => {
    expect(nativeFixedScale('body', 2, { maxFontSizeMultiplier: 0 }, 'android')).toBeUndefined();
    expect(nativeFixedScale('labelBadge', 2, { maxFontSizeMultiplier: 0 }, 'android')).toBe(1.3);
  });

  it('takes the lowest of the role cap, fontScaleCap and maxFontSizeMultiplier', () => {
    expect(nativeFixedScale('webTab', 2, { maxFontSizeMultiplier: 1 }, 'ios')).toBe(1);
    expect(nativeFixedScale('webTab', 0.85, {}, 'android')).toBe(0.85);
  });
});
