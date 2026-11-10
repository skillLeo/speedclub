import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import { hydrateThemePreference, maxFontScale, ThemeProvider, themes, typography } from '@/theme';
import { Text, typeStyle } from '@/ui/Text';

async function renderText(element: React.ReactElement) {
  await render(<ThemeProvider>{element}</ThemeProvider>);
  return screen.getByTestId('t');
}

function flat(style: unknown): TextStyle {
  return StyleSheet.flatten(style as TextStyle) as TextStyle;
}

describe('typeStyle', () => {
  it('maps each variant to its token', () => {
    for (const variant of Object.keys(typography) as (keyof typeof typography)[]) {
      const style = typeStyle(variant, 1, 'ios');
      expect(style.fontFamily).toBe(typography[variant].fontFamily);
      expect(style.fontSize).toBe(typography[variant].fontSize);
      expect(style.lineHeight).toBe(typography[variant].lineHeight);
    }
  });

  it('scales size and line height together', () => {
    const style = typeStyle('body', 2, 'web');
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toBe(48);
  });

  it('hyphenates only long compounds on web: at least 10 letters, 4 on each side', () => {
    const style = typeStyle('body', 1, 'web') as TextStyle & { hyphens: string; hyphenateLimitChars: string };
    expect(style.hyphens).toBe('auto');
    expect(style.hyphenateLimitChars).toBe('10 4 4');
  });

  it('can switch hyphenation off, for labels, values, usernames and inputs', () => {
    const style = typeStyle('supporting', 1, 'web', false) as TextStyle & { hyphens: string; hyphenateLimitChars?: string };
    expect(style.hyphens).toBe('none');
    expect(style.hyphenateLimitChars).toBeUndefined();
  });

  it('caps tab and badge at 1.3', () => {
    for (const variant of ['tab', 'badge'] as const) {
      const style = typeStyle(variant, 2, 'web');
      expect(style.fontSize).toBeCloseTo(11 * 1.3);
      expect(style.lineHeight).toBeCloseTo(13 * 1.3);
    }
    expect(typeStyle('tab', 1.2, 'web').fontSize).toBeCloseTo(11 * 1.2);
  });

  it('scales letter spacing with the size, under the same cap', () => {
    expect(typography.titleL.letterSpacing).toBeLessThan(0);
    expect(typeStyle('titleL', 2, 'web').letterSpacing).toBeCloseTo(typography.titleL.letterSpacing * 2);
    expect(typeStyle('titleL', 1, 'web').letterSpacing).toBe(typography.titleL.letterSpacing);
    const tracked = (Object.keys(maxFontScale) as (keyof typeof maxFontScale)[]).filter(
      (variant) => typography[variant].letterSpacing,
    );
    for (const variant of tracked) {
      expect(typeStyle(variant, 2, 'web').letterSpacing).toBeCloseTo(typography[variant].letterSpacing! * 1.3);
    }
  });

  it('removes Android font padding only on Android', () => {
    expect(typeStyle('body', 1, 'android').includeFontPadding).toBe(false);
    expect(typeStyle('body', 1, 'ios').includeFontPadding).toBeUndefined();
    expect(typeStyle('body', 1, 'web').includeFontPadding).toBeUndefined();
  });

  it('hyphenates on web with a font fallback stack', () => {
    const inter = typeStyle('body', 1, 'web') as TextStyle & { hyphens: string };
    expect(inter.hyphens).toBe('auto');
    expect(inter.fontFamily?.startsWith('Inter_400Regular, ')).toBe(true);
    expect(typeStyle('displayXl', 1, 'web').fontFamily).toContain('Barlow Semi Condensed');
    expect(typeStyle('body', 1, 'ios').fontFamily).toBe('Inter_400Regular');
  });

  it('carries uppercase and tabular numerals from tokens', () => {
    expect(typeStyle('eyebrow', 1, 'ios').textTransform).toBe('uppercase');
    expect(typeStyle('specValue', 1, 'ios').fontVariant).toEqual(['tabular-nums']);
  });
});

describe('Text', () => {
  const originalOS = Platform.OS;

  beforeAll(hydrateThemePreference);

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('defaults to body in the primary colour', async () => {
    const node = await renderText(<Text testID="t">Hallo</Text>);
    const style = flat(node.props.style);
    expect(style.fontFamily).toBe('Inter_400Regular');
    expect(style.color).toBe(themes.carbon.color.text.primary);
  });

  it('resolves the colour by token path', async () => {
    const node = await renderText(
      <Text testID="t" color="text.secondary">
        Hallo
      </Text>,
    );
    expect(flat(node.props.style).color).toBe(themes.carbon.color.text.secondary);
  });

  it('does not truncate unless asked', async () => {
    const node = await renderText(<Text testID="t">Hallo</Text>);
    expect(node.props.numberOfLines).toBeUndefined();
  });

  it('passes numberOfLines through', async () => {
    const node = await renderText(
      <Text testID="t" numberOfLines={2}>
        Hallo
      </Text>,
    );
    expect(node.props.numberOfLines).toBe(2);
  });

  it('exposes the full string as aria-label when it can truncate', async () => {
    const node = await renderText(
      <Text testID="t" numberOfLines={1}>
        BMW M3 <Text>Competition</Text> {2023}
      </Text>,
    );
    expect(node.props['aria-label']).toBe('BMW M3 Competition 2023');
  });

  it('adds no label when nothing can truncate', async () => {
    const plain = await renderText(<Text testID="t">Hallo</Text>);
    expect(plain.props['aria-label']).toBeUndefined();
    const unlimited = await renderText(
      <Text testID="t" numberOfLines={0}>
        Hallo
      </Text>,
    );
    expect(unlimited.props['aria-label']).toBeUndefined();
  });

  it('keeps a label the caller set', async () => {
    const node = await renderText(
      <Text testID="t" numberOfLines={1} aria-label="Eigenes Label">
        Hallo
      </Text>,
    );
    expect(node.props['aria-label']).toBe('Eigenes Label');
  });

  it('leaves body fully scalable and caps tab and badge on native', async () => {
    const body = await renderText(<Text testID="t">Hallo</Text>);
    expect(body.props.maxFontSizeMultiplier).toBeUndefined();
    const tab = await renderText(
      <Text testID="t" variant="tab">
        Start
      </Text>,
    );
    expect(tab.props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('sets the Android text props on Android', async () => {
    Platform.OS = 'android';
    const node = await renderText(<Text testID="t">Fahrwerksüberarbeitung</Text>);
    expect(node.props.textBreakStrategy).toBe('balanced');
    expect(node.props.android_hyphenationFrequency).toBe('normal');
    expect(flat(node.props.style).includeFontPadding).toBe(false);
    expect(flat(node.props.style).lineHeight).toBe(24);
  });

  it('lets a caller style override', async () => {
    const node = await renderText(
      <Text testID="t" style={{ textAlign: 'right' }}>
        Hallo
      </Text>,
    );
    expect(flat(node.props.style).textAlign).toBe('right');
  });
});
