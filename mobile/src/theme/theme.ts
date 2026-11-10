import { useSyncExternalStore } from 'react';

import {
  accentPalette,
  defaultTheme,
  layout,
  motion,
  opacity,
  radius,
  size,
  space,
  systemMapping,
  themes,
  typography,
  zIndex,
  type AccentSet,
  type ThemeColors,
  type ThemeName,
  type ThemePreference,
} from './tokens.generated';

export type AppTheme = {
  readonly name: ThemeName;
  readonly colorScheme: 'dark' | 'light';
  readonly color: ThemeColors;
  readonly shadow: (typeof themes)[ThemeName]['shadow'];
  readonly typography: typeof typography;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly size: typeof size;
  readonly layout: typeof layout;
  readonly motion: typeof motion;
  readonly zIndex: typeof zIndex;
  readonly opacity: typeof opacity;
  /** OS font scale on native; `qaFontScale` (or 1) on web, which has no OS scaling. */
  readonly fontScale: number;
};

type TokenPaths<T> = {
  [Group in keyof T & string]: { [Key in keyof T[Group] & string]: `${Group}.${Key}` }[keyof T[Group] &
    string];
}[keyof T & string];

/** A colour by token path, for example `text.secondary`. */
export type ColorToken = TokenPaths<ThemeColors>;

const cache = new Map<string, AppTheme>();

/**
 * M3.5 ADM-28: the accent set from app-config's `branding.accent_set`, one of the pre-validated sets of tokens.json (contrast-checked
 * on all three themes by build-tokens.mjs). Anything else keeps the default set. Only `accent.fg/fill/fillPressed` change.
 */
let accent: AccentSet = accentPalette.default as AccentSet;
const accentListeners = new Set<() => void>();

export function isAccentSet(value: unknown): value is AccentSet {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(accentPalette.sets, value);
}

export function setAccentSet(next: string): void {
  const resolved = isAccentSet(next) ? next : (accentPalette.default as AccentSet);
  if (resolved === accent) return;
  accent = resolved;
  accentListeners.forEach((listener) => listener());
}

export const getAccentSet = (): AccentSet => accent;

export function useAccentSet(): AccentSet {
  return useSyncExternalStore(
    (listener) => {
      accentListeners.add(listener);
      return () => accentListeners.delete(listener);
    },
    getAccentSet,
    getAccentSet,
  );
}

/** The theme object for a name, font scale and accent set. The same input always returns the same object. */
export function getTheme(name: ThemeName, fontScale: number = 1, accentSet: AccentSet = accent): AppTheme {
  const key = `${name}|${fontScale}|${accentSet}`;
  let theme = cache.get(key);
  if (!theme) {
    const { color: base, colorScheme, shadow } = themes[name];
    const set = accentPalette.sets[accentSet];
    const color =
      accentSet === accentPalette.default
        ? base
        : ({ ...base, accent: { ...base.accent, ...set[colorScheme] } } as ThemeColors);
    theme = {
      name,
      colorScheme,
      color,
      shadow,
      typography,
      space,
      radius,
      size,
      layout,
      motion,
      zIndex,
      opacity,
      fontScale,
    };
    cache.set(key, theme);
  }
  return theme;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'carbon' || value === 'black' || value === 'light';
}

/** An unknown system scheme counts as dark, the product default. */
export function resolveThemeName(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): ThemeName {
  if (preference !== 'system') return preference;
  return systemScheme === 'light' ? systemMapping.light : systemMapping.dark;
}

export function resolveColor(theme: Pick<AppTheme, 'color'>, token: ColorToken): string {
  const [group, key] = token.split('.') as [string, string];
  return (theme.color as unknown as Record<string, Record<string, string>>)[group]![key]!;
}

export const DEFAULT_PREFERENCE: ThemePreference = defaultTheme;
