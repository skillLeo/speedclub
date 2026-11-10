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

/**
 * The type scale as expected on screen: `scale x token`, capped at the token's maxFontScale.
 * @param {number} fontScale
 */
export function typePairs(fontScale = 1) {
  return Object.entries(tokens.typography).map(([name, raw]) => {
    const t = /** @type {{size:number,lineHeight:number,maxFontScale?:number}} */ (raw);
    const effective = Math.min(fontScale, t.maxFontScale ?? fontScale);
    return { name, size: t.size * effective, lineHeight: t.lineHeight * effective };
  });
}

/** First-choice font families: the CSS family names plus the per-weight native family names. */
export function fontFamilies() {
  /** @type {Set<string>} */
  const families = new Set();
  for (const group of Object.values(tokens.font)) {
    const g = /** @type {{css:string,native:Record<string,string>}} */ (group);
    const first = g.css.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
    if (first) families.add(first);
    for (const n of Object.values(g.native)) families.add(n);
  }
  return [...families];
}

/**
 * Serialisable configuration for the in-browser DOM audit.
 * @param {{theme?:string,fontScale?:number}} [opts]
 */
export function auditConfig({ theme = DEFAULT_THEME, fontScale = 1 } = {}) {
  const colors = themeColors(theme);
  return {
    theme,
    fontScale,
    colors: colors.general,
    qrColors: colors.qr,
    spacing: spacingScale(),
    typePairs: typePairs(fontScale),
    // Scaled values get rounded by the layout engine; 1x values must match exactly.
    typeTolerance: fontScale === 1 ? 0.01 : 0.5,
    fontFamilies: fontFamilies(),
    touchMin: Number(tokens.size.touchMin),
  };
}
