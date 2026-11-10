import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { Platform, Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { fonts, maxFontScale, resolveColor, typography, useTheme, type ColorToken, type TypeVariant } from '@/theme';

export type TextProps = Omit<ComponentProps<typeof RNText>, 'style'> & {
  variant?: TypeVariant;
  /** Token path, for example `text.secondary`. */
  color?: ColorToken;
  /**
   * False for what must stay whole: usernames, labels of controls, spec labels and values, text that mirrors an input.
   * Running copy keeps hyphenation, which only touches long compounds (see WEB_HYPHENATION).
   */
  hyphenate?: boolean;
  style?: StyleProp<TextStyle>;
};

function capFor(variant: TypeVariant): number | undefined {
  return (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
}

function withFallback(family: string): string {
  return `${family}, ${family.startsWith('Barlow') ? fonts.display.css : fonts.ui.css}`;
}

/**
 * §4: hyphenation exists for German compounds. A word needs 10 letters and leaves 4 on each side, so short words such
 * as "machen" never split. `hyphenate-limit-chars` is Chromium and Firefox; Safari reads the prefixed pair.
 */
const WEB_HYPHENATION = {
  hyphens: 'auto',
  hyphenateLimitChars: '10 4 4',
  WebkitHyphenateLimitBefore: '4',
  WebkitHyphenateLimitAfter: '4',
};

const cache = new Map<string, TextStyle>();

/**
 * The style of a variant. `webScale` is the QA font scale; native passes 1 because the OS scales the
 * text itself. The family stack keeps web readable if a font file fails to load.
 */
export function typeStyle(
  variant: TypeVariant,
  webScale: number = 1,
  platform: string = Platform.OS,
  hyphenate: boolean = true,
): TextStyle {
  const key = `${variant}|${webScale}|${platform}|${hyphenate}`;
  let style = cache.get(key);
  if (!style) {
    const base = typography[variant] as unknown as TextStyle & { fontFamily: string; fontSize: number; lineHeight: number };
    const scale = Math.min(webScale, capFor(variant) ?? webScale);
    style = {
      ...base,
      fontSize: base.fontSize * scale,
      lineHeight: base.lineHeight * scale,
      ...(base.letterSpacing === undefined ? {} : { letterSpacing: base.letterSpacing * scale }),
      ...(platform === 'android' ? { includeFontPadding: false } : {}),
      ...(platform === 'web'
        ? ({ fontFamily: withFallback(base.fontFamily), ...(hyphenate ? WEB_HYPHENATION : { hyphens: 'none' }) } as TextStyle)
        : {}),
    };
    cache.set(key, style);
  }
  return style;
}

/** The text of a node, including nested Text. Anything else renders nothing readable. */
function plainText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child) ? plainText(child.props.children) : '';
    })
    .join('');
}

/**
 * The only text component features use. It never truncates unless `numberOfLines` is passed; then
 * the full string stays available as `aria-label`, because the ellipsis hides it from everyone else.
 */
export function Text({ variant = 'body', color = 'text.primary', hyphenate = true, style, ...rest }: TextProps) {
  const theme = useTheme();
  const android = Platform.OS === 'android';
  const truncates = rest.numberOfLines !== undefined && rest.numberOfLines > 0;
  const label = rest['aria-label'] ?? (truncates ? plainText(rest.children) || undefined : undefined);
  return (
    <RNText
      textBreakStrategy={android ? 'balanced' : undefined}
      android_hyphenationFrequency={android ? (hyphenate ? 'normal' : 'none') : undefined}
      maxFontSizeMultiplier={capFor(variant)}
      {...rest}
      aria-label={label}
      style={[
        typeStyle(variant, Platform.OS === 'web' ? theme.fontScale : 1, Platform.OS, hyphenate),
        { color: resolveColor(theme, color) },
        style,
      ]}
    />
  );
}
