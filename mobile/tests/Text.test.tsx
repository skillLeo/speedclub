import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle } from 'react-native';

import {
  fonts,
  hydrateThemePreference,
  maxFontScale,
  ThemeProvider,
  themes,
  typography,
  typographyDesktop,
  type TypeVariant,
} from '@/theme';
import { Text, typeStyle } from '@/ui/Text';

async function renderText(element: React.ReactElement) {
  await render(<ThemeProvider>{element}</ThemeProvider>);
  return screen.getByTestId('t');
}

function flat(style: unknown): TextStyle {
  return StyleSheet.flatten(style as TextStyle) as TextStyle;
}

type Role = { fontFamily: string; fontSize?: number; lineHeight?: number; letterSpacing?: number };
const roles = typography as unknown as Record<TypeVariant, Role>;
const desktopRoles = typographyDesktop as unknown as Partial<Record<TypeVariant, Role>>;

describe('typeStyle', () => {
  it('maps each variant to its token on native: the embedded face by name, never a weight', () => {
    for (const variant of Object.keys(typography) as TypeVariant[]) {
      const style = typeStyle(variant, 1, 'ios');
      expect(style.fontFamily).toBe(roles[variant].fontFamily);
      expect(style.fontSize).toBe(roles[variant].fontSize);
      expect(style.lineHeight).toBe(roles[variant].lineHeight);
      expect(style.fontWeight).toBeUndefined();
      expect(typeStyle(variant, 1, 'android').fontWeight).toBeUndefined();
    }
  });

  it('gives each role of 09 §4.2 its face: cars speak Archivo, people speak Inter', () => {
    const family = (variant: TypeVariant) => typeStyle(variant, 1, 'ios').fontFamily;
    expect(family('heroNumeral')).toBe('ArchivoCondensed-SemiBold');
    expect(family('heroNumeralS')).toBe('ArchivoCondensed-SemiBold');
    expect(family('displayTitle')).toBe('ArchivoSemiExpanded-SemiBold');
    expect(family('title1')).toBe('InterDisplay-SemiBold');
    expect(family('title2')).toBe('InterDisplay-SemiBold');
    expect(family('headline')).toBe('Inter-SemiBold');
    expect(family('body')).toBe('Inter-Regular');
    expect(family('bodyStrong')).toBe('Inter-SemiBold');
    expect(family('callout')).toBe('Inter-Medium');
    expect(family('caption')).toBe('Inter-Medium');
    expect(family('labelCaps')).toBe('Inter-SemiBold');
    expect(family('labelUnit')).toBe('Inter-SemiBold');
    expect(family('labelBadge')).toBe('Inter-SemiBold');
    expect(family('numericInline')).toBe('Inter-Medium');
    expect(family('input')).toBe('Inter-Regular');
  });

  it('names the family stack and the weight on web, so a failed file falls back inside the stack', () => {
    const web = (variant: TypeVariant) => typeStyle(variant, 1, 'web');
    expect(web('body')).toMatchObject({ fontFamily: fonts.ui.css, fontWeight: '400' });
    expect(web('headline')).toMatchObject({ fontFamily: fonts.ui.css, fontWeight: '600' });
    expect(web('callout')).toMatchObject({ fontFamily: fonts.ui.css, fontWeight: '500' });
    expect(web('title1')).toMatchObject({ fontFamily: fonts.uiDisplay.css, fontWeight: '600' });
    expect(web('heroNumeral')).toMatchObject({ fontFamily: fonts.numeral.css, fontWeight: '600' });
    expect(web('displayTitle')).toMatchObject({ fontFamily: fonts.marque.css, fontWeight: '600' });
    expect(fonts.numeral.css.startsWith("'Archivo Condensed'")).toBe(true);
  });

  it('uses the desktop sizes on web only, and only where 09 §4.2 gives one', () => {
    for (const variant of Object.keys(typography) as TypeVariant[]) {
      const desktop = desktopRoles[variant];
      const style = typeStyle(variant, 1, 'web', true, true);
      expect(style.fontSize).toBe(desktop?.fontSize ?? roles[variant].fontSize);
      expect(style.lineHeight).toBe(desktop?.lineHeight ?? roles[variant].lineHeight);
      // Native never reads them.
      expect(typeStyle(variant, 1, 'ios', true, true).fontSize).toBe(roles[variant].fontSize);
    }
    expect(typeStyle('heroNumeral', 1, 'web', true, true)).toMatchObject({ fontSize: 88, lineHeight: 88 });
    expect(typeStyle('displayTitle', 1, 'web', true, true)).toMatchObject({ fontSize: 44, lineHeight: 48 });
    expect(typeStyle('body', 1, 'web', true, true)).toMatchObject({ fontSize: 16, lineHeight: 24 });
    expect(typeStyle('headline', 1, 'web', true, true)).toMatchObject({ fontSize: 17, lineHeight: 22 });
  });

  it('scales size and line height together', () => {
    const style = typeStyle('body', 2, 'web');
    expect(style.fontSize).toBe(30);
    expect(style.lineHeight).toBe(44);
  });

  it('leaves numeric.inline without a size, so it takes the size of the text it sits in, with tabular figures', () => {
    for (const platform of ['ios', 'android', 'web']) {
      const style = typeStyle('numericInline', 2, platform);
      expect(style.fontSize).toBeUndefined();
      expect(style.lineHeight).toBeUndefined();
      expect(style.fontVariant).toEqual(['tabular-nums']);
    }
  });

  it('hyphenates only long compounds on web: at least 10 letters, 4 on each side', () => {
    const style = typeStyle('body', 1, 'web') as TextStyle & { hyphens: string; hyphenateLimitChars: string };
    expect(style.hyphens).toBe('auto');
    expect(style.hyphenateLimitChars).toBe('10 4 4');
  });

  it('can switch hyphenation off, for labels, values, usernames and inputs', () => {
    const style = typeStyle('callout', 1, 'web', false) as TextStyle & { hyphens: string; hyphenateLimitChars?: string };
    expect(style.hyphens).toBe('none');
    expect(style.hyphenateLimitChars).toBeUndefined();
  });

  it('caps the hero numerals and the web tab at 1.3 (09 §4.2)', () => {
    expect(maxFontScale).toMatchObject({ heroNumeral: 1.3, heroNumeralS: 1.3 });
    for (const variant of ['heroNumeral', 'heroNumeralS', 'webTab'] as const) {
      const style = typeStyle(variant, 2, 'web');
      expect(style.fontSize).toBeCloseTo(roles[variant].fontSize! * 1.3);
      expect(style.lineHeight).toBeCloseTo(roles[variant].lineHeight! * 1.3);
    }
    expect(typeStyle('heroNumeral', 1.2, 'web').fontSize).toBeCloseTo(64 * 1.2);
  });

  it('scales letter spacing with the size, under the same cap', () => {
    expect(typography.title1.letterSpacing).toBeLessThan(0);
    expect(typeStyle('title1', 2, 'web').letterSpacing).toBeCloseTo(typography.title1.letterSpacing * 2);
    expect(typeStyle('title1', 1, 'web').letterSpacing).toBe(typography.title1.letterSpacing);
    expect(typeStyle('webTab', 2, 'web').letterSpacing).toBeCloseTo(typography.webTab.letterSpacing * 1.3);
  });

  it('removes Android font padding only on Android', () => {
    expect(typeStyle('body', 1, 'android').includeFontPadding).toBe(false);
    expect(typeStyle('body', 1, 'ios').includeFontPadding).toBeUndefined();
    expect(typeStyle('body', 1, 'web').includeFontPadding).toBeUndefined();
  });

  it('carries uppercase and tabular numerals from tokens', () => {
    expect(typeStyle('labelCaps', 1, 'ios').textTransform).toBe('uppercase');
    expect(typeStyle('labelUnit', 1, 'ios').textTransform).toBeUndefined();
    for (const variant of ['heroNumeral', 'heroNumeralS', 'numericInline'] as const) {
      expect(typeStyle(variant, 1, 'ios').fontVariant).toEqual(['tabular-nums']);
    }
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
    expect(style.fontFamily).toBe('Inter-Regular');
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

  it('leaves body fully scalable and caps the hero numerals and label.badge at 1.3 on native', async () => {
    const body = await renderText(<Text testID="t">Hallo</Text>);
    expect(body.props.maxFontSizeMultiplier).toBeUndefined();
    for (const variant of ['heroNumeral', 'heroNumeralS', 'labelBadge'] as const) {
      const numeral = await renderText(
        <Text testID="t" variant={variant}>
          510
        </Text>,
      );
      expect(numeral.props.maxFontSizeMultiplier).toBe(1.3);
    }
  });

  it('sets the Android text props on Android', async () => {
    Platform.OS = 'android';
    const node = await renderText(<Text testID="t">Fahrwerksüberarbeitung</Text>);
    expect(node.props.textBreakStrategy).toBe('balanced');
    expect(node.props.android_hyphenationFrequency).toBe('normal');
    expect(flat(node.props.style).includeFontPadding).toBe(false);
    expect(flat(node.props.style).lineHeight).toBe(22);
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
