import { Children, isValidElement, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { Platform, Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import {
  fonts,
  layout,
  maxFontScale,
  resolveColor,
  space,
  typography,
  typographyDesktop,
  useTheme,
  type ColorToken,
  type TypeVariant,
} from '@/theme';
import { faceOf } from '@/theme/fontFaces';

export type TextProps = Omit<ComponentProps<typeof RNText>, 'style'> & {
  variant?: TypeVariant;
  /** Token path, for example `text.secondary`. */
  color?: ColorToken;
  /**
   * False for what must stay whole: usernames, labels of controls, spec labels and values, text that mirrors an input.
   * Running copy keeps hyphenation, which only touches long compounds (see WEB_HYPHENATION).
   */
  hyphenate?: boolean;
  /**
   * `numeric.inline` on top of the role (09 §4.2): tabular figures for a count, date, price or code that sits in a headline or
   * body line, so the width never jumps when the number changes.
   */
  numeric?: boolean;
  /**
   * A lower font-scale cap than the role's, from `fontScaleCap` (for example `pill`: a label inside a fixed pill or frame).
   * Native sets the text at the capped scale itself (`nativeFixedScale`); web caps the QA font scale with it.
   */
  fontScaleCap?: number;
  /**
   * False keeps the mobile size on the web desktop: a title inside a card (09 §4.2 sizes are per page width, and a card in a
   * 640 column is no desktop page). Native never uses the desktop sizes.
   */
  desktopSize?: boolean;
  style?: StyleProp<TextStyle>;
};

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/** The lower of two optional caps. */
function lowerCap(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  return b === undefined ? a : Math.min(a, b);
}

function capFor(variant: TypeVariant): number | undefined {
  return (maxFontScale as Partial<Record<TypeVariant, number>>)[variant];
}

/** A role as tokens.json writes it. `numeric.inline` has no size: it takes the size of the text it sits in. */
type RoleStyle = {
  fontFamily: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontVariant?: readonly string[];
  textTransform?: TextStyle['textTransform'];
};

const desktopRoles = typographyDesktop as Partial<Record<TypeVariant, Partial<RoleStyle>>>;

/**
 * Web names the face by its family stack and weight (`'Archivo Condensed', 'Arial Narrow', …` at 600), so the browser picks
 * the loaded face and falls back inside the stack if a file fails. Native names the embedded face itself and never sets a
 * weight: Android would look for a `_bold` file at 700 and fall back to the system font (rules/mobile.md).
 */
function webFace(face: string): TextStyle {
  const entry = faceOf(face);
  if (!entry) return { fontFamily: fonts.ui.css };
  return { fontFamily: fonts[entry.group].css, fontWeight: String(entry.weight) as TextStyle['fontWeight'] };
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

/**
 * DQ-908, DQ-922, DQ-925: running text on web wraps "pretty": a word moves down instead of leaving a short last line or a run
 * of hyphens. Only the longhand `text-wrap-style`: the `text-wrap` shorthand also resets `text-wrap-mode` and so overrode
 * react-native-web's `white-space: nowrap` of `numberOfLines={1}` (DQ-922). No `hyphenate-limit-lines`: WebKit then breaks a
 * long compound without a hyphen once its one hyphenated line is used up ("Unbedenklichkeitsbescheinig / ung", DQ-925); pretty
 * wrapping alone keeps hyphens from stacking. The DQ-181 rule above (10 letters, 4 on each side) still decides where a word may
 * break. react-native-web passes the property through as inline CSS.
 */
const WEB_RUNNING_TEXT = { textWrapStyle: 'pretty' };

/** The roles that set running copy: paragraphs, notes, helper text, captions. Titles and labels keep their own wrapping. */
export const RUNNING_TEXT_ROLES: ReadonlySet<TypeVariant> = new Set<TypeVariant>(['body', 'bodyStrong', 'callout', 'caption']);

/**
 * DQ-932: the title roles on web break balanced lines, and hyphenate only a word that may not fit a line on its own ("Wir
 * haben dein Konto / eingeschränkt", never "einge- / schränkt" where the whole word fits the next line). CSS cannot ask "only
 * when the word is wider than its line", so the threshold is the longest word that surely fits the narrowest column the role
 * is set in, at the size it is drawn: shorter words never split (and never need to), a longer one keeps the DQ-181 hyphenation.
 */
export const TITLE_ROLES: ReadonlySet<TypeVariant> = new Set<TypeVariant>(['title1', 'title2', 'headline']);
const WEB_TITLE_WRAP = { textWrapStyle: 'balance' };
/** The narrowest screen the app supports (360–1440, 09 §14.1) and its text column between the phone gutters. */
const NARROWEST_SCREEN = 360;
const NARROWEST_COLUMN = NARROWEST_SCREEN - 2 * layout.gutter.phone;
/**
 * The narrowest column each title role is set in at 360: a page title the full column; a sheet or dialog title inside its
 * space.24 padding; a row or card title in a half-width card of a two-column grid (space.12 apart) inside its padding.
 */
export const TITLE_COLUMNS = {
  title1: NARROWEST_COLUMN,
  title2: NARROWEST_COLUMN - 2 * space[24],
  headline: (NARROWEST_COLUMN - space[12]) / 2 - 2 * layout.cardPadding,
} as const satisfies Partial<Record<TypeVariant, number>>;
/**
 * An upper bound of the average advance of a German word in Inter and Inter Display SemiBold, in em (measured from the shipped
 * faces: 0.50–0.56; "m" and "w" runs pull a word up, so 0.6 keeps a word counted as fitting from ever overflowing).
 */
const TITLE_WORD_ADVANCE = 0.6;
/** DQ-181's floor: no title word below 10 letters splits, and at least 4 letters stay on each side. */
const MIN_HYPHENATED_WORD = 10;

/**
 * The hyphenation of a title drawn at `size` in a `column` this wide: a word must be longer than what surely fits it. WebKit
 * has no word-length limit, only letters before and after the break, so the two halves together ask the same length there.
 */
export function titleHyphenation(size: number, column: number): Record<string, string> {
  const word = Math.floor(column / (size * TITLE_WORD_ADVANCE)) + 1;
  // A large font in a narrow column: the running-text rule, never less hyphenation than DQ-181 allows.
  if (word <= MIN_HYPHENATED_WORD) return WEB_HYPHENATION;
  const before = Math.ceil(word / 2);
  const after = word - before;
  return {
    hyphens: 'auto',
    hyphenateLimitChars: `${word} ${before} ${after}`,
    WebkitHyphenateLimitBefore: String(before),
    WebkitHyphenateLimitAfter: String(after),
  };
}

/** Hyphenation on web: none for whole text, the title threshold for a title role, else DQ-181. */
function webHyphenation(variant: TypeVariant, hyphenate: boolean, size: number | undefined): Record<string, string> {
  if (!hyphenate) return { hyphens: 'none' };
  const column = (TITLE_COLUMNS as Partial<Record<TypeVariant, number>>)[variant];
  return column !== undefined && size !== undefined ? titleHyphenation(size, column) : WEB_HYPHENATION;
}

/** Line breaking on web: balanced titles, pretty running text (when it may hyphenate), the browser's default elsewhere. */
function webWrap(variant: TypeVariant, hyphenate: boolean): Record<string, string> | undefined {
  if (TITLE_ROLES.has(variant)) return WEB_TITLE_WRAP;
  return hyphenate && RUNNING_TEXT_ROLES.has(variant) ? WEB_RUNNING_TEXT : undefined;
}

const cache = new Map<string, TextStyle>();

/**
 * The style of a variant at a font scale. `webScale` is the QA font scale on web; native passes 1 because the OS scales the
 * text itself, except for a capped role, which Text sets at its capped scale itself (see `nativeFixedScale`). `desktop`
 * applies the web desktop sizes (09 §4.2, from layout.breakpoints.desktop); native never uses them. `truncated` is a single-line
 * truncation (`numberOfLines={1}`): it keeps react-native-web's own nowrap and gets no wrap styles of its own (DQ-922). A clamp of
 * two or more lines keeps the running wrap, so it breaks exactly like an unclamped copy of the same text (DQ-943: Description's probe).
 */
export function typeStyle(
  variant: TypeVariant,
  webScale: number = 1,
  platform: string = Platform.OS,
  hyphenate: boolean = true,
  desktop: boolean = false,
  truncated: boolean = false,
): TextStyle {
  const web = platform === 'web';
  const key = `${variant}|${webScale}|${platform}|${hyphenate}|${web && desktop}|${web && truncated}`;
  let style = cache.get(key);
  if (!style) {
    const role: RoleStyle = { ...(typography[variant] as RoleStyle), ...(web && desktop ? desktopRoles[variant] : undefined) };
    const scale = Math.min(webScale, capFor(variant) ?? webScale);
    const { fontFamily, fontSize, lineHeight, letterSpacing, fontVariant, textTransform } = role;
    style = {
      ...(web ? webFace(fontFamily) : { fontFamily }),
      ...(fontSize === undefined ? {} : { fontSize: fontSize * scale }),
      ...(lineHeight === undefined ? {} : { lineHeight: lineHeight * scale }),
      ...(letterSpacing === undefined ? {} : { letterSpacing: letterSpacing * scale }),
      ...(fontVariant === undefined ? {} : { fontVariant: [...fontVariant] as TextStyle['fontVariant'] }),
      ...(textTransform === undefined ? {} : { textTransform }),
      ...(platform === 'android' ? { includeFontPadding: false } : {}),
      ...(web ? (webHyphenation(variant, hyphenate, fontSize === undefined ? undefined : fontSize * scale) as TextStyle) : {}),
      ...(web && !truncated ? (webWrap(variant, hyphenate) as TextStyle) : {}),
    };
    cache.set(key, style);
  }
  return style;
}

/**
 * N4 (Build 9): the scale a capped text is set at on native, or undefined when the OS may scale it. React Native 0.88 caps
 * `fontSize` with `maxFontSizeMultiplier` on both platforms, but Android's TextAttributeProps converts `lineHeight` (and
 * `letterSpacing`) with the uncapped SP scale, so a capped badge kept its glyphs at 1.3× while its line box grew to 2×
 * (iOS caps the line height through RCTEffectiveFontSizeMultiplier). A capped text therefore turns OS scaling off and sets
 * size, line height and tracking at min(font scale, cap) itself: the same box on Android and iOS, the box the web and the
 * geometry helpers (EmptyState's frame, specStripType) compute. The theme's font scale is the OS one and follows live
 * changes. `allowFontScaling={false}` from the caller keeps its meaning (no scaling at all).
 */
export function nativeFixedScale(
  variant: TypeVariant,
  fontScale: number,
  caps: { fontScaleCap?: number; maxFontSizeMultiplier?: number | null; allowFontScaling?: boolean },
  platform: string = Platform.OS,
): number | undefined {
  if (platform === 'web' || caps.allowFontScaling === false) return undefined;
  // RN reads a multiplier below 1 (0 included) as "no cap".
  const prop = caps.maxFontSizeMultiplier != null && caps.maxFontSizeMultiplier >= 1 ? caps.maxFontSizeMultiplier : undefined;
  const cap = lowerCap(lowerCap(capFor(variant), caps.fontScaleCap), prop);
  return cap === undefined ? undefined : Math.min(fontScale, cap);
}

/**
 * MF-3: whether the web window is at least `layout.breakpoints.desktop` wide, as one module-level store on a media query. A
 * Text re-renders only when the window crosses that width, not on every viewport resize (the keyboard and Safari's toolbar
 * resize it on iPhone). The document never scrolls itself (public/index.html), so the query's width is the one
 * useBreakpoint reads. Native has no desktop sizes: a constant, no listener.
 */
const DESKTOP_QUERY = `(min-width: ${layout.breakpoints.desktop}px)`;
let desktopQuery: MediaQueryList | null | undefined;
const desktopListeners = new Set<() => void>();

function desktopMedia(): MediaQueryList | null {
  if (desktopQuery === undefined) {
    desktopQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;
    desktopQuery?.addEventListener?.('change', () => {
      for (const listener of desktopListeners) listener();
    });
  }
  return desktopQuery;
}

function subscribeDesktop(listener: () => void): () => void {
  desktopMedia();
  desktopListeners.add(listener);
  return () => desktopListeners.delete(listener);
}

const desktopSnapshot = (): boolean => desktopMedia()?.matches ?? false;

export const useDesktopType: () => boolean = isWeb
  ? () => useSyncExternalStore(subscribeDesktop, desktopSnapshot, desktopSnapshot)
  : () => false;

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
export function Text({
  variant = 'body',
  color = 'text.primary',
  hyphenate = true,
  numeric = false,
  fontScaleCap,
  desktopSize = true,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const desktop = useDesktopType() && desktopSize;
  const android = Platform.OS === 'android';
  const truncates = rest.numberOfLines !== undefined && rest.numberOfLines > 0;
  const label = rest['aria-label'] ?? (truncates ? plainText(rest.children) || undefined : undefined);
  const fixedScale = nativeFixedScale(variant, theme.fontScale, { fontScaleCap, maxFontSizeMultiplier: rest.maxFontSizeMultiplier, allowFontScaling: rest.allowFontScaling });
  const web = Platform.OS === 'web';
  return (
    <RNText
      textBreakStrategy={android ? 'balanced' : undefined}
      android_hyphenationFrequency={android ? (hyphenate ? 'normal' : 'none') : undefined}
      maxFontSizeMultiplier={lowerCap(capFor(variant), fontScaleCap)}
      {...rest}
      {...(fixedScale === undefined ? {} : { allowFontScaling: false })}
      aria-label={label}
      style={[
        typeStyle(
          variant,
          web ? Math.min(theme.fontScale, fontScaleCap ?? theme.fontScale) : (fixedScale ?? 1),
          Platform.OS,
          hyphenate,
          desktop,
          rest.numberOfLines === 1,
        ),
        { color: resolveColor(theme, color) },
        numeric ? TABULAR : null,
        style,
      ]}
    />
  );
}
