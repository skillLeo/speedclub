#!/usr/bin/env node
/**
 * SPEED CLUB design-lint — Design System 2.0 (docs/03_DESIGN_SYSTEM.md)
 *
 * Catches the "template" tells and design-system bypasses that reviews keep missing:
 * raw colours, banned icons, emoji, gradients, default Tailwind looks, ad-hoc motion,
 * raw spacing/type values, template copy, fake numbers, glass outside chrome, literal
 * shadows, opacity-only presses, screen spinners and placeholder-image services.
 * Zero dependencies, Node >= 18, works on Windows and POSIX paths.
 *
 * Usage (run from the repo root):
 *   node scripts/design-lint.mjs                   ratchet mode: fails only on violations that are not in
 *                                                  design/lint-baseline.json (counts per file+rule may only go down)
 *   node scripts/design-lint.mjs --strict          phase gate: every violation fails, baseline ignored
 *   node scripts/design-lint.mjs --write-baseline  write the baseline; refused if any file+rule count grew
 *   node scripts/design-lint.mjs --json            machine-readable report on stdout
 *   node scripts/design-lint.mjs --root <dir>      lint another checkout
 *   node scripts/design-lint.mjs --rules           print the rule table
 *
 * Suppressions (one line, reason mandatory, design-qa reviews every one):
 *   // design-lint-disable-next-line DL01 -- Google sign-in button colours (Google branding guidelines)
 *   {{-- design-lint-disable-next-line DL04 -- photo scrim --}}      (any comment syntax works)
 *   const x = '#fff' // design-lint-disable-line DL01 -- reason
 * File exceptions: design/lint-allowlist.json  [{ "file": "repo/relative/path", "rules": ["DL01"], "reason": "…" }]
 *   A JSON file (a locale) can narrow the exception to members, as JSON has no comments for a suppression (DQ-814):
 *   { "file": "…/garage.json", "keys": ["/specs/aspirations/supercharged"], "rules": ["DL09"], "reason": "…" }
 *   `keys` are JSON pointers (RFC 6901); only a match inside that member (its key and its value) is exempt, the same word anywhere
 *   else in the file is reported. A pointer the file does not have is a configuration error, so an entry cannot outlive its key.
 *
 * Exit codes: 0 clean · 1 violations · 2 configuration error
 * NEVER weaken a rule to make the gate pass — fix the code, or add a reasoned suppression.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep, resolve } from 'node:path';

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const ROOT = resolve(opt('--root', process.cwd()));
const STRICT = has('--strict');
const WRITE = has('--write-baseline');
const JSON_OUT = has('--json');
const BASELINE_PATH = join(ROOT, 'design', 'lint-baseline.json');
const ALLOWLIST_PATH = join(ROOT, 'design', 'lint-allowlist.json');

// ---------------------------------------------------------------------------------------------
// What is scanned
// ---------------------------------------------------------------------------------------------
const SCAN = [
  { dir: 'mobile/src', exts: ['.ts', '.tsx', '.json'] },
  { dir: 'mobile/app', exts: ['.ts', '.tsx'] },
  { dir: 'web/resources/js', exts: ['.ts', '.tsx', '.js', '.vue'] },
  { dir: 'web/resources/css', exts: ['.css'] },
  { dir: 'web/resources/views', exts: ['.php'] },
  { dir: 'web/lang', exts: ['.json', '.php'] },
  { dir: 'design/style-tile', exts: ['.html', '.css'] }, // the M4.1 style tile is client-facing UI (DQ-814)
];
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', '.expo', 'android', 'ios', '__tests__', '__mocks__',
  '__snapshots__', 'tests', 'test', 'e2e', 'coverage', 'storybook-static', '.turbo', '.cache']);
const SKIP_FILES = [/\.(test|spec)\.[cm]?[jt]sx?$/, /\.d\.ts$/, /\.min\.(js|css)$/, /\.stories\.[jt]sx?$/];
const GENERATED_MARK = /AUTO-GENERATED|@generated|DO NOT EDIT BY HAND/;
const MAX_BYTES = 1_500_000;

function kindOf(rel) {
  if (rel.endsWith('.blade.php')) return 'blade';
  if (rel.startsWith('design/style-tile/') && rel.endsWith('.html')) return 'blade'; // static HTML gets the view rules
  if (rel.startsWith('web/lang/')) return 'locale';
  if (rel.endsWith('.json')) return /\/(i18n|locales?|lang)\//.test(rel) ? 'locale' : null;
  if (rel.endsWith('.php')) return null;
  if (rel.endsWith('.vue')) return 'vue';
  if (rel.endsWith('.css')) return 'css';
  if (rel.startsWith('mobile/')) return 'rn';
  if (/\.(ts|tsx|js)$/.test(rel)) return 'webts';
  return null;
}

// Built-in path exemptions (each with the reason a reviewer would accept)
const EXEMPT = [
  { re: /resources\/views\/(?:emails?|mail|vendor\/mail|pdfs?|notifications)\//, rules: ['DL01', 'DL04', 'DL05', 'DL06', 'DL08', 'DL11'],
    reason: 'e-mail clients and dompdf need inline literal styles' },
  { re: /^mobile\/src\/theme\//, rules: ['DL01', 'DL07', 'DL08', 'DL12'], reason: 'theme layer maps generated tokens' },
  { re: /\/motion(?:\/|\.[cm]?[jt]sx?$)/, rules: ['DL07'], reason: 'motion token layer' },
  { re: /^mobile\/src\/ui\//, rules: ['DL14'], reason: 'primitives may render spinners (Button loading etc.)' },
  { re: /[Ss]crim/, rules: ['DL04'], reason: 'the photo scrim is the only allowed gradient' },
];

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------
const L = (s) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${s})(?![\\p{L}\\p{N}_])`, 'giu'); // unicode word boundary
const CHROME_PATH = /(tabbar|tabs|header|navbar|topbar|sidebar|rail|chrome|sheet|dialog|modal|popover|menu|palette|toast|floating|herocontrols|privacycover|applock|glass|\/motion\/)/i;
const PHOSPHOR_BANNED = ['Sparkle', 'Sparkles', 'Lightning', 'LightningA', 'Brain', 'Rocket', 'RocketLaunch', 'MagicWand',
  'Robot', 'Confetti', 'Crown', 'CrownSimple', 'Fire', 'FireSimple', 'Atom', 'Lightbulb', 'LightbulbFilament', 'Diamond', 'DiamondsFour'];
const banIconRe = new RegExp(`\\b(${PHOSPHOR_BANNED.join('|')})(?:Icon)?\\b`);

const RULES = [
  { id: 'DL01', title: 'raw colour — use theme tokens', kinds: ['rn', 'webts', 'vue', 'css', 'blade'], line: [
    /(?<![\w&#\-/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
    /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\((?!\s*var\()/g,
    /\b(?:color|backgroundColor|borderColor|borderTopColor|borderBottomColor|tintColor|shadowColor|fill|stroke|placeholderTextColor)\s*[:=]\s*\{?\s*['"](?:white|black|red|blue|green|gr[ae]y|purple|orange|yellow|pink|silver)['"]/g,
  ] },
  { id: 'DL02', title: 'banned icon (sparkles, lightning, brain, rocket, wand, robot, confetti, crown, fire …)', kinds: ['rn', 'webts', 'vue', 'blade'], line: [
    /\bph-(?:sparkle|lightning|brain|rocket|rocket-launch|magic-wand|robot|confetti|crown|fire|atom|lightbulb|diamond)\b/g,
    /\bsf\s*[=:]\s*\{?\s*['"](?:sparkles?|wand\.and\.stars(?:\.inverse)?|bolt(?:\.fill|\.circle)?|brain(?:\.head\.profile)?|flame(?:\.fill)?|crown(?:\.fill)?|party\.popper)['"]/g,
    /\b(?:md|material|androidIcon)\s*[=:]\s*\{?\s*['"](?:auto_awesome|bolt|rocket|rocket_launch|psychology|local_fire_department|magic_button|celebration|workspace_premium|diamond)['"]/g,
    /<(?:Sparkle|Sparkles|Lightning|Brain|Rocket|RocketLaunch|MagicWand|Robot|Confetti|Crown|Fire)(?:Icon)?\b/g,
  ], file: [{ re: /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"][^'"]*phosphor[^'"]*['"]/g, check: (m) => {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const bad = names.filter((n) => banIconRe.test(n) && new RegExp(`^(${PHOSPHOR_BANNED.join('|')})(?:Icon)?$`).test(n));
    return bad.length ? bad.join(', ') : null;
  } }] },
  { id: 'DL03', title: 'emoji in product code or copy — use glyphs/words', kinds: ['rn', 'webts', 'vue', 'blade', 'locale'], line: [
    /(?![©®™])\p{Extended_Pictographic}/gu,
  ] },
  { id: 'DL04', title: 'gradient or gradient text — only the photo scrim may use a gradient', kinds: ['rn', 'webts', 'vue', 'css', 'blade'], line: [
    /background-clip\s*:\s*text|\bbg-clip-text\b|-webkit-text-fill-color\s*:\s*transparent|\btext-transparent\b/g,
    /\b(?:linear|radial|conic)-gradient\(|\bbg-(?:gradient|linear|radial|conic)-|<(?:Linear|Radial)Gradient\b|['"](?:expo-linear-gradient|react-native-linear-gradient)['"]/g,
  ] },
  { id: 'DL05', title: 'off-system Tailwind (default palette, white/black, arbitrary values) — use generated theme utilities', kinds: ['vue', 'blade', 'webts', 'css'], line: [
    /(?<![\w-])(?:bg|text|border|ring|ring-offset|from|via|to|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)\b/g,
    /(?<![\w-])(?:bg|text|border|fill|stroke|ring|outline|divide|from|via|to|decoration|caret|accent|placeholder)-(?:white|black)\b/g,
    /(?<![\w-])-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|top|right|bottom|left|rounded(?:-[trblse]{1,2})?|text|leading|tracking|font)-\[(?!var\()[^\]]*(?:\d|')/g,
  ] },
  { id: 'DL06', title: 'default Tailwind shadow / oversized radius — tonal surfaces and token radii only', kinds: ['vue', 'blade', 'webts'], line: [
    /(?<![\w-])(?:shadow-(?:sm|md|lg|xl|2xl|inner)|rounded-(?:2xl|3xl)|drop-shadow(?:-(?:sm|md|lg|xl|2xl))?)(?![\w-])/g,
  ] },
  { id: 'DL07', title: 'ad-hoc motion value — use motion tokens / springTo() helpers', kinds: ['rn', 'webts', 'vue', 'css', 'blade'], line: [
    /\.(?:duration|delay|damping|stiffness|mass|springify)\(\s*\d/g,
    /\bwithDelay\(\s*\d/g,
    /\bEasing\.(?:bezier|in|out|inOut|linear|ease|quad|cubic|poly|sin|circle|exp|elastic|back|bounce)\b/g,
    /\bcubic-bezier\(/g,
    /(?:transition|animation)(?:-duration|-delay)?\s*:[^;{}]*?\b\d+(?:\.\d+)?m?s\b/g,
    /\b(?:transition|animation)(?:Duration|Delay)\s*:\s*['"]?\d/g,
    /(?<![\w-])(?:duration|delay)-\d+(?![\w-])|(?<![\w-])ease-(?:in|out|in-out|linear|\[)/g,
  ], file: [{ re: /with(?:Timing|Spring)\(\s*[^;]{0,240}?\b(?:duration|stiffness|damping|mass)\s*:\s*\d/gs, check: () => 'literal timing/spring config' }] },
  { id: 'DL08', title: 'raw spacing / radius / type value or font name — use space/radius/typography tokens', kinds: ['rn', 'vue', 'blade', 'css'], line: [
    /\b(?:margin|padding)(?:Top|Bottom|Left|Right|Horizontal|Vertical|Start|End|Block|Inline)?\s*:\s*-?(?:[1-9]\d*(?:\.\d+)?|0\.\d+)\b/g,
    /\b(?:gap|rowGap|columnGap)\s*:\s*[1-9]\d*/g,
    /\bborder(?:Top|Bottom)?(?:Left|Right|Start|End)?(?:Start|End)?Radius\s*:\s*[1-9]\d*/g,
    /\b(?:fontSize|lineHeight|letterSpacing)\s*:\s*-?\d+(?:\.\d+)?/g,
    /\bfontFamily\s*:\s*['"`]/g,
    /\bfontWeight\s*:\s*['"]?\d{3}\b/g,
    /style\s*=\s*["'][^"']*(?:margin|padding|gap|border-radius|font-size|line-height|letter-spacing)\s*:\s*\d/g,
    /font-family\s*:(?!\s*(?:var\(|inherit))/g, // the lookahead takes the spaces, so `font-family: var(--x)` cannot backtrack into a match
  ] },
  { id: 'DL09', title: 'template copy or unsourced number — write specific, human German/English', kinds: ['locale', 'vue', 'blade'], line: [
    L('lorem ipsum|dolor sit amet|unlock (?:your|the|new)|elevate (?:your|the)|seamless(?:ly)?|supercharge[ds]?|revolutioni[sz](?:e|es|ed|ing)|next[- ]level|game[- ]?chang(?:er|ing)|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|unleash(?:es|ed)?|empower(?:s|ing|ed)?|effortless(?:ly)?|blazing(?:ly)? fast|take it to the next|nahtlos\\p{L}*|revolution(?:är|aer)\\p{L}*|auf das nächste level|nächste[ns]? level|entfesse?l\\p{L}*|mühelos\\p{L}*|im handumdrehen|grenzenlos\\p{L}*|bahnbrechend\\p{L}*'),
    L('\\d+(?:[.,]\\d+)?\\s?[kK]\\+?\\s+(?:mitglieder|members|nutzer|users|fahrer|builds|fans)|10x|99(?:[.,]9+)?\\s?%'),
  ] },
  { id: 'DL10', title: 'Phosphor weight not allowed (regular/fill only, bold at 16)', kinds: ['rn', 'webts', 'vue'], line: [
    /\bweight\s*=\s*\{?\s*['"](?:duotone|thin|light)['"]/g,
  ] },
  { id: 'DL11', title: 'blur/glass outside navigation chrome — glass belongs to tab bars, headers, sheets and floating controls only', kinds: ['rn', 'webts', 'vue', 'css', 'blade'], pathNot: CHROME_PATH, line: [
    /<(?:BlurView|GlassView|GlassContainer)\b|['"](?:expo-blur|expo-glass-effect)['"]/g,
    /(?<![\w-])backdrop-blur(?:-\w+)?(?![\w-])|backdrop-filter\s*:/g,
  ] },
  { id: 'DL12', title: 'literal shadow/elevation — dark UI uses tonal surfaces; light shadows come from tokens', kinds: ['rn'], line: [
    /\bshadow(?:Opacity|Radius)\s*:\s*\d|\bshadowOffset\s*:\s*\{\s*width\s*:\s*-?\d|\belevation\s*:\s*[1-9]|\bboxShadow\s*:\s*['"`]/g,
  ] },
  { id: 'DL13', title: 'opacity-only press (TouchableOpacity/activeOpacity) — use PressableScale', kinds: ['rn'], line: [
    /\bTouchableOpacity\b|\bactiveOpacity\s*=/g,
  ] },
  { id: 'DL14', title: 'screen-level spinner — loading states use geometry-matched skeletons', kinds: ['rn'], line: [
    /<ActivityIndicator\b/g,
  ] },
  { id: 'DL15', title: 'placeholder image/avatar service — use licensed photos or the monogram avatar', kinds: ['rn', 'webts', 'vue', 'blade', 'css', 'locale'], line: [
    /picsum\.photos|placehold\.co|placeholder\.com|placekitten|unsplash\.it|source\.unsplash\.com|randomuser\.me|pravatar\.cc|ui-avatars\.com|dicebear|thispersondoesnotexist|robohash/g,
  ] },
  { id: 'DL16', title: 'retired font (Barlow) — Design System 2.0 uses Inter + Archivo via typography tokens', kinds: ['rn', 'webts', 'vue', 'css', 'blade'], line: [
    /Barlow/g,
  ] },
];
const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
const toPosix = (p) => p.split(sep).join('/');
function walk(dirAbs, exts, out) {
  let entries;
  try { entries = readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const abs = join(dirAbs, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, exts, out); continue; }
    if (!e.isFile()) continue;
    if (!exts.some((x) => e.name.endsWith(x))) continue;
    if (SKIP_FILES.some((re) => re.test(e.name))) continue;
    out.push(abs);
  }
}
function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (err) { configError(`cannot parse ${toPosix(path)}: ${err.message}`); }
}
function configError(msg) { console.error(`design-lint: configuration error — ${msg}`); process.exit(2); }
/**
 * The members of a JSON text, each with its JSON pointer (RFC 6901) and its span in the text: from the key's opening quote (an array
 * element: its first character) to the end of its value. Throws on text that is not JSON.
 * @param {string} text
 * @returns {{pointer: string, start: number, end: number}[]}
 */
function jsonMembers(text) {
  const members = [];
  let i = 0;
  const fail = (what) => { throw new Error(`${what} at offset ${i}`); };
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const string = () => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const escape = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');
  const value = (path) => {
    ws();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (text[i] === close) { i++; return; }
      for (let n = 0; ; n++) {
        ws();
        const start = i;
        let pointer;
        if (c === '{') {
          if (text[i] !== '"') fail('expected a key');
          pointer = `${path}/${escape(string())}`;
          ws();
          if (text[i] !== ':') fail('expected ":"');
          i++;
        } else {
          pointer = `${path}/${n}`;
        }
        value(pointer);
        members.push({ pointer, start, end: i });
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === close) { i++; return; }
        fail(`expected "," or "${close}"`);
      }
    }
    if (c === '"') { string(); return; }
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!literal) fail('unexpected character');
    i += literal[0].length;
  };
  value('');
  ws();
  if (i !== text.length) fail('trailing text');
  return members;
}

const SUPPRESS_RE = /design-lint-disable-(next-line|line)\s+((?:DL\d{2}\s*,?\s*)+)(?:--\s*(.*?))?\s*(?:\*\/|-->|--}}|$)/;

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------
if (has('--rules')) {
  for (const r of RULES) console.log(`${r.id}  ${r.title}  [${r.kinds.join(', ')}]`);
  process.exit(0);
}

const allowRaw = loadJson(ALLOWLIST_PATH, []);
if (!Array.isArray(allowRaw)) configError('design/lint-allowlist.json must be an array');
/** file -> its entries: rules, and the JSON pointers they are limited to (null = the whole file) */
const allow = new Map();
for (const a of allowRaw) {
  if (!a || typeof a.file !== 'string' || !Array.isArray(a.rules) || typeof a.reason !== 'string' || a.reason.trim().length < 8) {
    configError(`allowlist entry needs file, rules[] and a reason (>= 8 chars): ${JSON.stringify(a)}`);
  }
  const unknownRules = a.rules.filter((id) => !RULE_BY_ID[id]);
  if (unknownRules.length) configError(`allowlist entry names unknown rule(s) ${unknownRules.join(', ')}: ${JSON.stringify(a)}`);
  let keys = null;
  if (a.keys !== undefined) {
    if (!a.file.endsWith('.json')) configError(`allowlist "keys" (JSON pointers) need a .json file: ${JSON.stringify(a)}`);
    if (!Array.isArray(a.keys) || a.keys.length === 0 || !a.keys.every((k) => typeof k === 'string' && k.startsWith('/'))) {
      configError(`allowlist "keys" must be a non-empty array of JSON pointers ("/a/b"): ${JSON.stringify(a)}`);
    }
    keys = a.keys;
  }
  const file = toPosix(a.file);
  if (!allow.has(file)) allow.set(file, []);
  allow.get(file).push({ rules: new Set(a.rules), keys });
}

const files = [];
for (const s of SCAN) walk(join(ROOT, ...s.dir.split('/')), s.exts, files);

const violations = [];
const suppressions = [];
let scanned = 0;

for (const abs of files) {
  const rel = toPosix(abs.slice(ROOT.length).replace(/^[\\/]+/, ''));
  const kind = kindOf(rel);
  if (!kind) continue;
  let st; try { st = statSync(abs); } catch { continue; }
  if (st.size > MAX_BYTES) continue;
  const text = readFileSync(abs, 'utf8');
  if (GENERATED_MARK.test(text.slice(0, 400))) continue;
  scanned++;
  const lines = text.split(/\r?\n/);
  const exemptRules = new Set();
  for (const ex of EXEMPT) if (ex.re.test(rel)) ex.rules.forEach((r) => exemptRules.add(r));
  // The allowlist entries of this file; a keyed one is resolved to the spans of its JSON members (offsets in the text).
  const lineStarts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') lineStarts.push(k + 1);
  const entries = (allow.get(rel) || []).map((entry) => {
    if (entry.keys === null) return { rules: entry.rules, spans: null };
    let members;
    try { members = jsonMembers(text); } catch (err) { configError(`allowlist keys for ${rel}: the file is not JSON (${err.message})`); }
    const spans = entry.keys.map((pointer) => {
      const member = members.find((m) => m.pointer === pointer);
      if (!member) configError(`allowlist: ${rel} has no member ${pointer} (remove or update the entry)`);
      return member;
    });
    return { rules: entry.rules, spans };
  });
  const allowedAt = (ruleId, offset) =>
    entries.some((e) => e.rules.has(ruleId) && (e.spans === null || e.spans.some((sp) => offset >= sp.start && offset < sp.end)));

  // suppression map: line index -> Set(rule)
  const sup = new Map();
  lines.forEach((ln, i) => {
    const m = ln.match(SUPPRESS_RE);
    if (!m) return;
    const ids = m[2].split(/[\s,]+/).filter(Boolean);
    const reason = (m[3] || '').trim();
    const target = m[1] === 'next-line' ? i + 1 : i;
    if (reason.length < 8) {
      violations.push({ file: rel, line: i + 1, rule: 'DL00', match: ids.join(','), snippet: 'suppression without a reason (use: -- why this is correct)' });
      return;
    }
    if (!sup.has(target)) sup.set(target, new Set());
    ids.forEach((id) => sup.get(target).add(id));
    suppressions.push({ file: rel, line: target + 1, rules: ids, reason });
  });

  // `offset`: where the match starts in the file's text (a keyed allowlist entry exempts only matches inside its members).
  const record = (rule, lineIdx, match, offset) => {
    if (exemptRules.has(rule.id) || allowedAt(rule.id, offset)) return false;
    if (sup.get(lineIdx)?.has(rule.id)) return false;
    const snippet = (lines[lineIdx] || '').trim().slice(0, 140);
    violations.push({ file: rel, line: lineIdx + 1, rule: rule.id, match: String(match).slice(0, 60), snippet });
    return true;
  };

  for (const rule of RULES) {
    if (!rule.kinds.includes(kind)) continue;
    if (rule.pathNot && rule.pathNot.test(rel)) continue;
    if (rule.line) {
      lines.forEach((ln, i) => {
        if (SUPPRESS_RE.test(ln) && !/[;{}<>]/.test(ln.replace(SUPPRESS_RE, ''))) return; // pure suppression comment line
        const seen = new Set();
        for (const re of rule.line) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(ln)) !== null) {
            const key = m[0];
            // One report per match text and line; an occurrence a keyed entry exempts does not hide a later one on the same line.
            if (!seen.has(key) && record(rule, i, m[0], lineStarts[i] + m.index)) seen.add(key);
            if (!re.global) break;
            if (m[0].length === 0) re.lastIndex++;
          }
        }
      });
    }
    if (rule.file) {
      for (const f of rule.file) {
        f.re.lastIndex = 0;
        let m;
        while ((m = f.re.exec(text)) !== null) {
          const res = f.check(m);
          if (res) {
            const lineIdx = text.slice(0, m.index).split(/\r?\n/).length - 1;
            const dup = violations.some((v) => v.file === rel && v.line === lineIdx + 1 && v.rule === rule.id);
            if (!dup) record(rule, lineIdx, res, m.index);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Baseline ratchet
// ---------------------------------------------------------------------------------------------
const counts = {};
for (const v of violations) { const k = `${v.file}::${v.rule}`; counts[k] = (counts[k] || 0) + 1; }
const baseline = loadJson(BASELINE_PATH, null);
const baseCounts = baseline?.counts || {};
const grown = Object.entries(counts).filter(([k, n]) => n > (baseCounts[k] || 0));
const newKeys = new Set(grown.map(([k]) => k));
const improved = Object.entries(baseCounts).filter(([k, n]) => (counts[k] || 0) < n);

if (WRITE) {
  if (baseline && grown.length) {
    console.error(`design-lint: refusing to write a baseline that grows (${grown.length} file/rule pairs got worse). Fix them first.`);
    for (const [k, n] of grown) console.error(`  ${k}: ${baseCounts[k] || 0} -> ${n}`);
    process.exit(2);
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({ version: 1, generated: new Date().toISOString(), total: violations.length, counts }, null, 2) + '\n');
  console.log(`design-lint: baseline written (${violations.length} known violations) -> design/lint-baseline.json`);
  process.exit(0);
}

const failing = STRICT ? violations : violations.filter((v) => newKeys.has(`${v.file}::${v.rule}`) || v.rule === 'DL00');
const mode = STRICT ? 'strict' : baseline ? 'ratchet' : 'ratchet (no baseline: all violations count)';

if (JSON_OUT) {
  console.log(JSON.stringify({ mode, scanned, total: violations.length, failing: failing.length,
    improvedPairs: improved.length, suppressions, violations: violations.map((v) => ({ ...v, new: newKeys.has(`${v.file}::${v.rule}`) })) }, null, 2));
} else {
  const byRule = new Map();
  for (const v of failing) { if (!byRule.has(v.rule)) byRule.set(v.rule, []); byRule.get(v.rule).push(v); }
  for (const [id, list] of [...byRule.entries()].sort()) {
    const title = id === 'DL00' ? 'suppression without reason' : RULE_BY_ID[id].title;
    console.log(`\n${id}  ${title}  (${list.length})`);
    for (const v of list.slice(0, 200)) console.log(`  ${v.file}:${v.line}  ${v.match}  |  ${v.snippet}`);
    if (list.length > 200) console.log(`  … ${list.length - 200} more`);
  }
  if (suppressions.length) console.log(`\nsuppressions with reasons (reviewed by design-qa): ${suppressions.length}`);
  if (!STRICT && baseline && improved.length) console.log(`improved vs baseline: ${improved.length} file/rule pairs — run --write-baseline to lock the gain`);
  console.log(`\ndesign-lint ${mode}: scanned ${scanned} files · ${violations.length} violations total · ${failing.length} failing · ${suppressions.length} suppressed`);
  console.log(failing.length === 0 ? `design-lint: ${STRICT ? '0 violations' : 'no new violations'} ✔` : 'design-lint: FAILED ✖');
}
process.exit(failing.length === 0 ? 0 : 1);
