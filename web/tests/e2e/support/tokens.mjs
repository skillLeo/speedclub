// Loads design/tokens/tokens.json and derives everything the QA harness checks against.
// Nothing about colours, spacing or type may be hard-coded elsewhere in the harness.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKENS_PATH = fileURLToPath(new URL('../../../../design/tokens/tokens.json', import.meta.url));

export const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
export const THEMES = /** @type {string[]} */ (tokens.themeOrder);
export const DEFAULT_THEME = /** @type {string} */ (tokens.defaultTheme);

/**
 * Parses #RGB, #RRGGBB, #RRGGBBAA and rgb()/rgba().
 * @param {string} value
 * @returns {{r:number,g:number,b:number,a:number}}
 */
export function parseColor(value) {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    let h = /** @type {string} */ (hex[1]);
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v);
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  throw new Error(`Unparseable colour token: ${value}`);
}

/**
 * Colour set of one theme. `qr.*` tokens carry pure black/white that must not whitelist those
 * values for the rest of the UI, so they are only valid inside a `data-qa-exempt="qr"` region.
 * @param {string} theme
 */
export function themeColors(theme) {
  const def = tokens.themes[theme];
  if (!def) throw new Error(`Unknown theme "${theme}". Known: ${THEMES.join(', ')}`);
  /** @type {{name:string,r:number,g:number,b:number,a:number}[]} */
  const general = [];
  /** @type {{name:string,r:number,g:number,b:number,a:number}[]} */
  const qr = [];
  for (const [name, value] of Object.entries(def.color)) {
    const entry = { name, ...parseColor(/** @type {string} */ (value)) };
    (name.startsWith('qr.') ? qr : general).push(entry);
  }
  return { general, qr };
}

/** @returns {number[]} the spacing scale, ascending */
export function spacingScale() {
  return Object.values(tokens.space)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The width from which the web applies the desktop type sizes (09 §4.2; the generated CSS and Text.tsx use the same min-width). */
export const DESKTOP_MIN_WIDTH = Number(tokens.layout.breakpoints.desktop);

/**
 * The type scale as expected on screen at one viewport width: `scale x token`, capped at the token's maxFontScale. A role with a
 * desktop size (09 §4.2, `web: {size, lineHeight}`) yields that pair as well (`variant: 'web'`), but only where the page applies it:
 * at a viewport at least `layout.breakpoints.desktop` wide. Below that the audit accepts the mobile pairs only, so hero.numeral 88/88
 * fails at 360. A role that inherits its size from the parent role (numeric.inline, `size: 'inherit'`) yields none, as the parent's pair
 * is the one on screen.
 * A role with a `minSize` (display.title, 09 §4.2 "max 2 lines, shrink to 24") also yields its shrink pair (`variant: 'shrink'`) at
 * every width: `minSize`/`minLineHeight` (ADR-426 g, 24/28), falling back to minSize + lineHeight − size when the token has no
 * `minLineHeight`, as DisplayTitle.tsx `shrunkStyle` sets it on phone and desktop alike, scaled like the role's other pairs.
 * @param {number} fontScale
 * @param {number} viewportWidth the CSS viewport width (window.innerWidth, what min-width media queries compare)
 * @returns {{name:string,variant:'base'|'web'|'shrink',size:number,lineHeight:number}[]}
 */
export function typePairs(fontScale, viewportWidth) {
  if (!Number.isFinite(fontScale) || !Number.isFinite(viewportWidth)) {
    throw new Error(`typePairs(fontScale, viewportWidth) needs two numbers, got ${fontScale}, ${viewportWidth}`);
  }
  const desktop = viewportWidth >= DESKTOP_MIN_WIDTH;
  /** @type {{name:string,variant:'base'|'web'|'shrink',size:number,lineHeight:number}[]} */
  const pairs = [];
  for (const [name, raw] of Object.entries(tokens.typography)) {
    const t = /** @type {{size:number|'inherit',lineHeight:number|'inherit',maxFontScale?:number,minSize?:number,minLineHeight?:number,web?:{size:number,lineHeight:number}}} */ (raw);
    if (t.size === 'inherit' || t.lineHeight === 'inherit') continue;
    if (typeof t.size !== 'number' || typeof t.lineHeight !== 'number') {
      throw new Error(`typography.${name}: size and lineHeight must be numbers or 'inherit'`);
    }
    const effective = Math.min(fontScale, t.maxFontScale ?? fontScale);
    pairs.push({ name, variant: 'base', size: t.size * effective, lineHeight: t.lineHeight * effective });
    if (t.web) {
      if (typeof t.web.size !== 'number' || typeof t.web.lineHeight !== 'number') {
        throw new Error(`typography.${name}.web: size and lineHeight must be numbers`);
      }
      if (desktop) pairs.push({ name, variant: 'web', size: t.web.size * effective, lineHeight: t.web.lineHeight * effective });
    }
    if (t.minSize !== undefined) {
      if (typeof t.minSize !== 'number' || !(t.minSize > 0 && t.minSize < t.size)) {
        throw new Error(`typography.${name}.minSize must be a number between 0 and the role's size`);
      }
      // ADR-426 g: the token states the shrink leading (`minLineHeight`); without it the role's mobile leading is kept.
      const shrunkLine = t.minLineHeight ?? t.minSize + t.lineHeight - t.size;
      if (typeof shrunkLine !== 'number' || !(shrunkLine >= t.minSize)) {
        throw new Error(`typography.${name}.minLineHeight must be a number of at least minSize`);
      }
      pairs.push({ name, variant: 'shrink', size: t.minSize * effective, lineHeight: shrunkLine * effective });
    }
  }
  return pairs;
}

/**
 * The first-choice names of one font group: its CSS family (the first of the stack) and its per-weight native family names.
 * @param {string} group a key of tokens.font
 * @returns {string[]}
 */
export function familiesOf(group) {
  const g = /** @type {{css:string,native:Record<string,string>}|undefined} */ (tokens.font[group]);
  if (!g) throw new Error(`Unknown font group "${group}". Known: ${Object.keys(tokens.font).join(', ')}`);
  const first = g.css.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return [...new Set([...(first ? [first] : []), ...Object.values(g.native)])];
}

/** First-choice font families: the CSS family names plus the per-weight native family names. */
export function fontFamilies() {
  return [...new Set(Object.keys(tokens.font).flatMap(familiesOf))];
}

/**
 * The roles with a line cap (`maxLines`, 09 §4.2: display.title "max 2 lines, shrink to 24"), as the DOM audit checks them at one
 * font scale and viewport width: the faces the role is set in, its full-size pairs (the mobile pair, + the desktop pair where the page
 * applies it, both scaled like typePairs) and its shrink pair. At a full-size pair the role may take at most `maxLines` lines
 * (ADR-426 a: past that it shrinks); at the shrink pair any line count is allowed, as the title is never truncated.
 * @param {number} fontScale
 * @param {number} viewportWidth
 * @returns {{name:string,maxLines:number,families:string[],full:{size:number,lineHeight:number}[],shrink:{size:number,lineHeight:number}[]}[]}
 */
export function lineCappedRoles(fontScale, viewportWidth) {
  const pairs = typePairs(fontScale, viewportWidth);
  /** @type {ReturnType<typeof lineCappedRoles>} */
  const roles = [];
  for (const [name, raw] of Object.entries(tokens.typography)) {
    const t = /** @type {{font:string,maxLines?:number}} */ (raw);
    if (t.maxLines === undefined) continue;
    if (!(Number.isInteger(t.maxLines) && t.maxLines > 0)) throw new Error(`typography.${name}.maxLines must be a whole number above 0`);
    const own = pairs.filter((p) => p.name === name);
    const pick = (/** @type {(p: (typeof own)[number]) => boolean} */ keep) =>
      own.filter(keep).map(({ size, lineHeight }) => ({ size, lineHeight }));
    roles.push({
      name,
      maxLines: t.maxLines,
      families: familiesOf(t.font),
      full: pick((p) => p.variant !== 'shrink'),
      shrink: pick((p) => p.variant === 'shrink'),
    });
  }
  return roles;
}

/**
 * Serialisable configuration for the in-browser DOM audit.
 * @param {{theme?:string,fontScale?:number,viewportWidth:number}} opts `viewportWidth` decides whether the desktop type pairs apply
 */
export function auditConfig({ theme = DEFAULT_THEME, fontScale = 1, viewportWidth }) {
  const colors = themeColors(theme);
  return {
    theme,
    fontScale,
    viewportWidth,
    colors: colors.general,
    qrColors: colors.qr,
    spacing: spacingScale(),
    typePairs: typePairs(fontScale, viewportWidth),
    // Scaled values get rounded by the layout engine; 1x values must match exactly.
    typeTolerance: fontScale === 1 ? 0.01 : 0.5,
    fontFamilies: fontFamilies(),
    lineCapped: lineCappedRoles(fontScale, viewportWidth),
    touchMin: Number(tokens.size.touchMin),
  };
}
