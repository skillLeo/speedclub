// DOM audit, docs/07_QA_AND_RELEASE.md section 3. Reusable from specs and from the visual matrix.
//
// Documented exclusions (all narrow; every use is counted in report.exemptions):
//  - Elements that are not rendered (display:none, visibility:hidden, opacity:0 subtree, inert).
//    This is what removes hidden tab screens and framework wrappers from the audit.
//  - data-qa-exempt tokens, set by the app through RN Web's `dataSet`. Anything else is reported:
//      photo      background colour of a photo surface and of what is inside it (text is still checked)
//      qr         the QR card: qr.* tokens become valid inside it, and only inside it
//      safe-area  off-scale padding/margin on this element, because it includes a device inset
//      hairline   off-scale padding/margin on this element, because it compensates a hairline
//    Two more are accepted on one kind of element only, and are unknown-exemption anywhere else:
//      brand-position  off-scale margins of a blueprint's proportional position (ADR-149): only on AUTH-02's logo
//                      (data-testid AUTH-02.logoSlot or AUTH-02.logo); its paddings and gaps stay on the scale
//      fixed-glyph     the type pair of a scale-1 token at any font scale (ADR-150): only on an avatar's initials, one
//                      or two characters directly inside a circle of an avatar size
//      tab-label       the `web.tab` token's pair at font scale min(scale, 1.15) (ADR-145): only on a label inside the phone
//                      tab bar (data-testid shell.tabbar) whose role="tab" cell is exactly 72 wide (design-QA ruling, M2.8)
//  - A scroll region made focusable for keyboard scrolling (tabindex 0, no role, overflow auto/scroll) is no control
//    for overlap and touch target; counted as `focusable-scroller`.
//  - Overlap: an ancestor and its descendant (nested interactive is axe's job: nested-interactive);
//    content in a scroll container that passes under a fixed or sticky bar, as scrolling resolves it.
//  - Touch target: inline text links inside a sentence (WCAG 2.5.8 inline exception).
//  - Spacing: `auto` and percentage margins, because their computed px are layout results.
//  - Text clip: text entirely outside the clipping box (an off-canvas slide, not clipped text).
//  - Mid-word wrap (09 §4.2 "nothing truncates mid-word", DQ-801): checked only on a leaf element whose whole text is one short token
//    (at most MID_WORD_MAX characters, no whitespace: "2002", "AWD", "1.725", "3,9"). A leaf has no child elements, except that
//    <wbr> children still count as a leaf (N-4); an element with any other child element is not checked. Not checked: text inside
//    an aria-hidden measurement mirror (aria-hidden and absolutely positioned or without pointer events; an opacity:0 one is not
//    rendered at all), visually hidden text, and a token with an explicit break opportunity (soft hyphen, zero-width space, a <wbr>
//    child) or word-break: break-all / line-break: anywhere, which ask for breaks inside words. Counted as `mid-word-intent`.
//    A hyphen is no intent: a short token that wraps at its own hyphen ("GT-R", "E-Auto") is a finding (07 §3).
//    Automatic hyphenation under the house rule (DQ-181: hyphens auto, hyphenate-limit-chars 10 4 4, the -webkit- before/after 4
//    pair; web/resources/css/public.css, mobile/src/ui/Text.tsx) is intent too, counted as `hyphenation`, only when all of this holds:
//    computed hyphens (or -webkit-hyphens) is auto; the token is letters with only attached punctuation around them (opening before,
//    closing after, as listed for running text below; no digit, no hyphen inside); every break falls between two letters and the
//    limits hold as the engine applies them, the attached punctuation counted (MF-R4-3): an engine that reads hyphenate-limit-chars
//    (Chromium, WebKit 27) needs a token of at least max(HYPHENATION.minWord, the element's own word minimum), one that does not
//    (older WebKit, which reads only -webkit-hyphenate-limit-before/after) has no word minimum; every line break leaves at least
//    max(4, the element's before/after limit) characters before and after it, found with per-character Ranges grouped into the line
//    boxes the check counts; and every
//    line that ends inside the word ends in a visible hyphen (the line box reaches past the last letter's glyph, as measured on a
//    canvas in the element's font, by at least half a hyphen). So "Nach-richten" is intent; a break by overflow-wrap (no hyphen),
//    "2002" or "AWD" under hyphens auto, a split leaving 3, a 9-letter word where the word minimum applies, and any word under
//    hyphens none or manual stay findings.
//  - Mid-word wrap in running text (DQ-923, DQ-925): every other text node that renders on more than one line is read word by word
//    (a word is a run of letters; combining marks belong to their letter). A word whose letters land on two line boxes is a finding
//    ("Googl / e Play", "Unbedenklichkeitsbescheinig / ung") unless every break in it is the engine's own dictionary hyphenation
//    under the house limits, counted the way the engine counts them (MF-R4-3), with a visible hyphen at the line end (counted as
//    `hyphenation`). The engines apply the limits to the segment between two break opportunities, every character counted: it
//    ends at whitespace and at a zero-width space, and after a hard hyphen that no word joiner follows. So punctuation attached to
//    the word counts (closing punctuation and the hyphen of a compound part, "Community-", towards the after side and the length;
//    opening punctuation towards the before side and the length), and so does a part joined by a word joiner ("SS-\u2060Ladern"
//    is 10). An engine that reads hyphenate-limit-chars (Chromium, WebKit 27; probed) needs a segment of at least
//    10 and 4 before and 4 after the break ("Fahr-zeuge," is 10, 4 and 6; "aufneh-men," 10, 6 and 4; "Prüf-stand." 10, 4 and 6); one
//    that reads only -webkit-hyphenate-limit-before/after (older WebKit) has no word minimum and needs 4 before and 4 after. The
//    element may declare stricter limits, never looser ones. A break without a hyphen between two letters stays a
//    finding. A break at a soft hyphen, a zero-width space, a word joiner, a hard hyphen, a digit, '@', '.' or '/' is a break between
//    two words, so an e-mail or URL broken there is not this check; a break between two letters of one is. word-break: break-all
//    and line-break: anywhere are intent (`mid-word-intent`). Not read: measurement mirrors, visually hidden text, the short-token
//    leaves above (decided there), and rotated, skewed or vertical text (`turned-text`), whose glyphs step down without a line break.
//    A word (or short token) whose own width, measured on a canvas in its font, exceeds the content box of its line's block keeps its
//    finding; the message then adds "word wider than its line" with both widths, for design QA's triage (SF-R4-1).
//  - Name-hyphen-break (DQ-926): in the same text nodes, a line that ends at a hard hyphen ('-' or U+2010) between two letters or
//    digits while the next line continues the token, when the break leaves fewer than 3 letters or digits of that token on either
//    side. The token runs to whitespace; before = its letters and digits from its start to the hyphen, after = from the hyphen to its
//    end (MF-R4-2). So "GT- / R R34", "Slip- / On", "E- / Auto", "E- / Mail", "QR- / Sticker" are findings; "Rhein- / Main",
//    "Datenschutz- / E-Mail" and "GT-SS- / Ladern" are fine. The app joins such names (U+2011, keepNameTogether), so they never break.
//  - Lost truncation (DQ-922): an element asking for one line (computed text-overflow: ellipsis, as numberOfLines={1} sets it beside
//    white-space: nowrap) or for N lines (computed -webkit-line-clamp N) that renders more line boxes than that. Counted are the line
//    boxes of its own text and of its inline descendants, inside its box when it clips vertically (a clamp lays the hidden lines out
//    below it). The ask is read from text-overflow, not from white-space: a later `text-wrap: pretty` shorthand resets text-wrap-mode,
//    which is exactly how the truncation got lost. Not checked: measurement mirrors and visually hidden text.
//  - Visually hidden (ADR-222): an element in the sr-only pattern (absolutely positioned, at most 1×1, clipped by clip, clip-path or
//    overflow) and everything inside it is free of the spacing and touch-target rules, counted as `visually-hidden`: its -1px margin
//    and 1×1 box are what hides it. A skip link (an a[href^="#"] in that pattern) is instead focused during the audit and measured
//    focused, where it must be visible and meet the target floor (counted as `skip-link-focused`); focus goes back afterwards.
//
// Covered glyph (DQ-901): an icon (<svg>) inside a control that a later-painted, visually opaque layer of the same control covers.
// RN Web gives every View `position: relative; z-index: 0`, so an absoluteFill surface drawn before an in-flow icon paints above it
// (CSS 2.1 Appendix E: positioned descendants with z-index auto/0 paint after the in-flow content of their stacking context), while
// native keeps child order. The paint order is computed from the stacking contexts, not with elementFromPoint, which skips
// pointer-events:none layers. A layer counts when it is rendered, has an opacity above 0 and a background with alpha >= COVER.alpha
// or a backdrop-filter, is neither the icon's ancestor nor inside an svg, and covers >= COVER.area of the icon's visible box. A
// pressed-tone layer (alpha 0.06-0.08) is no cover.
// Clipped field (DQ-902): a multiline field (textarea, contenteditable, role=textbox aria-multiline) whose text scrolls
// (scrollHeight > clientHeight + 1) while its text box is lower than its maximum: the max-height content box (TextInput and
// Composer size the field from a hidden mirror and cap it with max-height = maxRows x line height), or `rows` lines for a textarea
// without a max-height. A field at its maximum scrolls by design; a field without either maximum is not checked.
// Display-title lines (DQ-904, ADR-426 a): an element set in a line-capped role's face at one of its full-size pairs (display.title:
// 30/34, and 44/48 from the desktop width, x the font scale; tokens.mjs lineCappedRoles) that renders on more than the role's
// maxLines; the outermost element in that face and pair is measured, by the line boxes of its text. At the shrink pair any line count
// is allowed (the title is never truncated). Not checked: measurement mirrors and visually hidden text.
//
// Touch target on the admin (ADR-212, /admin only): a desktop pointer tool with 40 px table rows (03 §14). A control inside a table row
// (`tr` or role="row") at most `layout.adminTableRow` high needs 24×24 (WCAG 2.5.8 AA), every other control 32×32. Member surfaces keep
// `size.touchMin` (44). Every other rule is the same on both.
//
// Hit areas that count as the touch target: the element, its descendants (including an invisible
// absolutely positioned hit-slop child), ::before/::after boxes, its <label>, and a wrapper
// declared with data-qa-hit-wrapper that contains exactly this one interactive element.
import { THEMES, auditConfig, themeColors, tokens } from './tokens.mjs';

export const CHECKS = /** @type {const} */ ({
  horizontalOverflow: { id: 'horizontal-overflow', severity: 'High' },
  clippedText: { id: 'clipped-text', severity: 'High' },
  midWordWrap: { id: 'mid-word-wrap', severity: 'High' },
  lostTruncation: { id: 'lost-truncation', severity: 'High' },
  nameHyphenBreak: { id: 'name-hyphen-break', severity: 'Medium' },
  overlap: { id: 'overlap', severity: 'High' },
  touchTarget: { id: 'touch-target', severity: 'High' },
  missingLabel: { id: 'missing-label', severity: 'High' },
  offScaleSpacing: { id: 'off-scale-spacing', severity: 'Medium' },
  nonTokenColour: { id: 'non-token-colour', severity: 'Medium' },
  nonScaleFont: { id: 'non-scale-font', severity: 'Medium' },
  coveredGlyph: { id: 'covered-glyph', severity: 'High' },
  clippedField: { id: 'clipped-field', severity: 'High' },
  imageWithoutAspect: { id: 'image-without-aspect', severity: 'Medium' },
  displayTitleLines: { id: 'display-title-lines', severity: 'Medium' },
  unknownExemption: { id: 'unknown-exemption', severity: 'Medium' },
});

/**
 * covered-glyph (DQ-901): a layer covers an icon when its background alpha is at least `alpha` (or it has a backdrop-filter) and it
 * covers at least `area` of the icon's visible box. A pressed tone (alpha 0.06-0.08) stays below `alpha`.
 */
const COVER = Object.freeze({ alpha: 0.5, area: 0.5 });

/**
 * @typedef {object} Violation
 * @property {string} check
 * @property {'High'|'Medium'} severity
 * @property {string} message
 * @property {string} element human-readable locator of the offending element
 * @property {{x:number,y:number,width:number,height:number}|null} rect
 */

/**
 * @typedef {object} AuditReport
 * @property {string} url
 * @property {string} theme
 * @property {number} fontScale
 * @property {{width:number,height:number}} viewport
 * @property {{High:number,Medium:number}} counts
 * @property {Violation[]} violations
 * @property {Record<string,number>} exemptions
 * @property {{elements:number,interactive:number,textNodes:number}} scanned
 * @property {number} droppedViolations violations beyond the per-check report cap (still counted)
 */

const MAX_PER_CHECK = 100;

/** The longest token the mid-word-wrap check looks at: spec values, units, years, short codes (09 §4.2). */
const MID_WORD_MAX = 12;

/**
 * The house hyphenation rule (DQ-181; web/resources/css/public.css, mobile/src/ui/Text.tsx WEB_HYPHENATION): a word needs 10 characters
 * and keeps 4 on each side of a break, counted as the engine counts them (attached punctuation included; no word minimum on an
 * engine without hyphenate-limit-chars, MF-R4-3). An element may declare stricter limits, never looser ones.
 */
const HYPHENATION = Object.freeze({ minWord: 10, minBefore: 4, minAfter: 4 });

/** ADR-212 target floors of the admin, in CSS px; the row height comes from the tokens. */
export const ADMIN_TARGETS = Object.freeze({ standalone: 32, inRow: 24, rowHeight: Number(tokens.layout.adminTableRow) });

/** @param {string} url */
export const isAdminUrl = (url) => {
  try {
    const { pathname } = new URL(url);
    return pathname === '/admin' || pathname.startsWith('/admin/');
  } catch {
    return false;
  }
};

/** Elements that may carry `brand-position` (ADR-149). */
const BRAND_POSITION_IDS = ['AUTH-02.logoSlot', 'AUTH-02.logo'];
/** ADR-145: a tab cell of exactly this width caps its label's font scale at TAB_LABEL_CAP (mobile TabBar.tsx tabLabelCap). */
const TAB_CELL_WIDTH = 72;
const TAB_LABEL_CAP = 1.15;

/**
 * @typedef {object} BrowserConfig
 * @property {typeof CHECKS} checks
 * @property {number} maxPerCheck
 * @property {number} midWordMax the longest one-token text the mid-word-wrap check looks at
 * @property {{minWord:number,minBefore:number,minAfter:number}} hyphenation the house hyphenation rule (DQ-181)
 * @property {{name:string,size:number,lineHeight:number}[]} unscaledTypePairs the type scale at font scale 1, for fixed-glyph
 * @property {number[]} avatarSizes
 * @property {string[]} brandPositionIds
 * @property {number} tabCellWidth width of the tab cell whose label may carry `tab-label`
 * @property {{name:string,variant:string,size:number,lineHeight:number}[]} tabLabelTypePairs the `web.tab` pair at the capped font scale
 * @property {number} tabLabelTolerance
 * @property {{standalone:number,inRow:number,rowHeight:number}|null} adminTargets ADR-212 floors on /admin, else null (touchMin)
 * @property {Record<string,{general:{name:string,r:number,g:number,b:number,a:number}[],qr:{name:string,r:number,g:number,b:number,a:number}[]}>} frameColors
 *           the colour tokens of every theme, for an element inside a `data-theme` frame below <body>
 * @property {{alpha:number,area:number}} cover what makes a layer cover an icon (covered-glyph)
 */

/**
 * Runs inside the page. Self-contained: no imports, no closures over Node.
 * @param {ReturnType<typeof auditConfig> & BrowserConfig} cfg
 * @returns {Omit<AuditReport,'url'|'theme'|'fontScale'>}
 */
function auditInBrowser(cfg) {
  const { checks } = cfg;
  const KNOWN_EXEMPTIONS = ['photo', 'qr', 'safe-area', 'hairline', 'brand-position', 'fixed-glyph', 'tab-label'];
  const INTERACTIVE_ROLES = [
    'button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'slider', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'treeitem',
  ];
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[tabindex]:not([tabindex="-1"])',
    ...INTERACTIVE_ROLES.map((r) => `[role="${r}"]`),
  ].join(',');
  const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'TITLE', 'BR', 'WBR']);

  /** @type {any[]} */
  const violations = [];
  /** @type {Record<string,number>} */
  const perCheck = {};
  /** @type {Record<string,number>} */
  const exemptions = {};
  const counts = { High: 0, Medium: 0 };
  let droppedViolations = 0;

  const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  const rectOf = (/** @type {DOMRect|null} */ r) =>
    r ? { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) } : null;

  const describe = (/** @type {Element|null} */ el) => {
    if (!el) return 'document';
    const parts = [];
    /** @type {Element|null} */
    let cur = el;
    for (let depth = 0; cur && cur !== document.body && depth < 12; depth++, cur = cur.parentElement) {
      const id = cur.getAttribute('data-testid');
      if (id) {
        parts.unshift(`[${id}]`);
        break;
      }
      if (depth === 0) {
        const role = cur.getAttribute('role');
        parts.unshift(cur.tagName.toLowerCase() + (role ? `[role=${role}]` : ''));
      }
    }
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
    return parts.join(' > ') + (label ? ` "${label}"` : '');
  };

  const report = (
    /** @type {{id:string,severity:'High'|'Medium'}} */ check,
    /** @type {Element|null} */ el,
    /** @type {string} */ message,
    /** @type {DOMRect|null} */ rect = el ? el.getBoundingClientRect() : null,
  ) => {
    counts[check.severity]++;
    perCheck[check.id] = (perCheck[check.id] ?? 0) + 1;
    if (/** @type {number} */ (perCheck[check.id]) > cfg.maxPerCheck) {
      droppedViolations++;
      return;
    }
    violations.push({ check: check.id, severity: check.severity, message, element: describe(el), rect: rectOf(rect) });
  };

  const exempt = (/** @type {string} */ kind) => {
    exemptions[kind] = (exemptions[kind] ?? 0) + 1;
  };
  const exemptTokens = (/** @type {Element} */ el) => (el.getAttribute('data-qa-exempt') ?? '').split(/\s+/).filter(Boolean);
  const hasOwnExempt = (/** @type {Element} */ el, /** @type {string} */ kind) => exemptTokens(el).includes(kind);
  const insideExempt = (/** @type {Element} */ el, /** @type {string} */ kind) => {
    for (let cur = /** @type {Element|null} */ (el); cur; cur = cur.parentElement) {
      if (hasOwnExempt(cur, kind)) return true;
    }
    return false;
  };

  /** rgb()/rgba() as computed, or null (a colour function the audit does not read). */
  function parseCssColour(/** @type {string} */ value) {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
  }

  // ---- Rendered elements
  const inertOrTransparent = (/** @type {Element} */ el) => {
    // A native control may be opacity:0 on top of its visual (RN Web Switch): it still is the
    // control, so only a transparent or inert ancestor removes an element from the page.
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      if (cur.hasAttribute('inert')) return true;
      if (parseFloat(getComputedStyle(cur).opacity) === 0) return true;
    }
    return el.hasAttribute('inert');
  };
  const isRendered = (/** @type {Element} */ el) => {
    if (!el.checkVisibility({ visibilityProperty: true })) return false;
    return !inertOrTransparent(el);
  };

  /** @type {Element[]} */
  const elements = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let n = /** @type {Element|null} */ (document.body); n; n = /** @type {Element|null} */ (walker.nextNode())) {
    if (IGNORED_TAGS.has(n.tagName)) continue;
    if (n.closest('svg') && n.tagName.toLowerCase() !== 'svg') continue;
    if (isRendered(n)) elements.push(n);
  }
  const isVisuallyHidden = (/** @type {Element} */ el, /** @type {CSSStyleDeclaration} */ cs) => {
    const r = el.getBoundingClientRect();
    return (r.width <= 1 || r.height <= 1) && cs.position === 'absolute';
  };
  // ADR-222: the sr-only pattern exactly: absolutely positioned, at most 1×1, and clipped.
  const isSrOnlyBox = (/** @type {Element} */ el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'absolute') return false;
    const r = el.getBoundingClientRect();
    if (r.width > 1.01 || r.height > 1.01) return false;
    const clip = cs.clip && cs.clip !== 'auto';
    const clipPath = cs.clipPath && cs.clipPath !== 'none';
    const overflow = /(hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`);
    return Boolean(clip || clipPath || overflow);
  };
  /** @type {Map<Element, boolean>} */
  const srOnlyMemo = new Map();
  /** @type {(el: Element) => boolean} */
  const insideSrOnly = (el) => {
    const known = srOnlyMemo.get(el);
    if (known !== undefined) return known;
    /** @type {boolean} */
    const result = isSrOnlyBox(el) || (el.parentElement !== null && el.parentElement !== document.body && insideSrOnly(el.parentElement));
    srOnlyMemo.set(el, result);
    return result;
  };

  // ---- 1. Horizontal overflow
  const se = document.scrollingElement;
  if (se && se.scrollWidth > window.innerWidth) {
    report(checks.horizontalOverflow, null, `scrollWidth ${se.scrollWidth} > innerWidth ${window.innerWidth}`, null);
  }

  const clipAxes = (/** @type {CSSStyleDeclaration} */ cs) => ({
    x: cs.overflowX === 'hidden' || cs.overflowX === 'clip',
    y: cs.overflowY === 'hidden' || cs.overflowY === 'clip',
  });
  const scrollsX = (/** @type {CSSStyleDeclaration} */ cs) => cs.overflowX === 'auto' || cs.overflowX === 'scroll';
  const scrollsY = (/** @type {CSSStyleDeclaration} */ cs) => cs.overflowY === 'auto' || cs.overflowY === 'scroll';

  // A scroll region made focusable for keyboard scrolling (tabindex="0", no role, overflow auto/scroll: axe's
  // scrollable-region-focusable) is not a control: a press scrolls it, so it is no touch target and overlaps nothing.
  const isFocusableScroller = (/** @type {Element} */ el) => {
    // No role, or a landmark one (`region`, with its aria-label, as SettingsPage gives it): not a control's role.
    const role = el.getAttribute('role');
    if (el.getAttribute('tabindex') !== '0' || (role !== null && role !== 'region') || el.matches('a[href], button, input, select, textarea, summary')) return false;
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(`${cs.overflowY} ${cs.overflowX}`);
  };
  const interactive = elements.filter((el) => {
    if (!el.matches(INTERACTIVE_SELECTOR)) return false;
    if (isFocusableScroller(el)) {
      exempt('focusable-scroller');
      return false;
    }
    if (getComputedStyle(el).pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  // Content cut off by an overflow:hidden ancestor never reaches scrollWidth, so controls that
  // poke out of the viewport are checked directly (text is covered by the clip check below).
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.right <= window.innerWidth + 1 || r.left >= window.innerWidth) continue;
    let inScroller = false;
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      if (scrollsX(getComputedStyle(cur))) inScroller = true;
    }
    if (!inScroller) report(checks.horizontalOverflow, el, `extends to x=${round(r.right)} beyond viewport ${window.innerWidth}`);
  }

  // ---- 2. Clipped text
  /** @type {Text[]} */
  const textNodes = [];
  /** @type {Set<Element>} */
  const textBearing = new Set();
  for (const el of elements) {
    if (el.tagName === 'svg') continue;
    let bearing = false;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent && child.textContent.trim()) {
        textNodes.push(/** @type {Text} */ (child));
        bearing = true;
      }
    }
    if (bearing || el.matches('input:not([type="checkbox"],[type="radio"],[type="file"],[type="range"]),textarea,select')) {
      textBearing.add(el);
    }
  }

  const normalise = (/** @type {string|null|undefined} */ s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const hasAccessibleFullText = (/** @type {Element} */ owner) => {
    const full = normalise(owner.textContent);
    if (!full) return true;
    let cur = /** @type {Element|null} */ (owner);
    for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
      if (normalise(cur.getAttribute('aria-label')).includes(full)) return true;
      if (normalise(cur.getAttribute('title')).includes(full)) return true;
    }
    return false;
  };

  /** @type {Set<Element>} */
  const reportedClipOwners = new Set();
  const range = document.createRange();
  for (const node of textNodes) {
    const parent = /** @type {Element} */ (node.parentElement);
    const parentStyle = getComputedStyle(parent);
    if (isVisuallyHidden(parent, parentStyle)) continue;
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) continue;
    const lineHeight = parseFloat(parentStyle.lineHeight);
    // Range rects use the font's content area, which is taller than a tight line-height.
    // Reduce them to the line box so that a 40/44 display line in a 44 box is not "clipped".
    const lineBox = (/** @type {DOMRect} */ r) => {
      const inset = Number.isFinite(lineHeight) ? Math.max(0, (r.height - lineHeight) / 2) : 0;
      return { left: r.left, right: r.right, top: r.top + inset, bottom: r.bottom - inset };
    };
    /** @typedef {{left:number,right:number,top:number,bottom:number}} LineBox */
    const innerBox = (/** @type {Element} */ el) => {
      const b = el.getBoundingClientRect();
      return {
        left: b.left + el.clientLeft,
        top: b.top + el.clientTop,
        right: b.left + el.clientLeft + el.clientWidth,
        bottom: b.top + el.clientTop + el.clientHeight,
      };
    };
    // What of the text a scroll container shows. Beyond its box the text is scrolled away, not cut, and an
    // ancestor further up can only cut what the scroller still shows (a carousel peeking past the edge).
    const throughScroller = (/** @type {Element} */ el, /** @type {LineBox[]} */ current) => {
      const cs = getComputedStyle(el);
      const x = scrollsX(cs);
      const y = scrollsY(cs);
      if (!x && !y) return current;
      const box = innerBox(el);
      return current
        .map((l) => ({
          left: x ? Math.max(l.left, box.left) : l.left,
          right: x ? Math.min(l.right, box.right) : l.right,
          top: y ? Math.max(l.top, box.top) : l.top,
          bottom: y ? Math.min(l.bottom, box.bottom) : l.bottom,
        }))
        .filter((l) => l.right > l.left && l.bottom > l.top);
    };
    let lines = rects.map(lineBox);

    for (
      let owner = /** @type {Element|null} */ (parent);
      owner && owner !== document.documentElement;
      lines = throughScroller(owner, lines), owner = owner.parentElement
    ) {
      if (lines.length === 0) break;
      const cs = getComputedStyle(owner);
      const axes = clipAxes(cs);
      if (!axes.x && !axes.y) continue;
      const overflowsX = axes.x && owner.scrollWidth > owner.clientWidth + 1;
      const overflowsY = axes.y && owner.scrollHeight > owner.clientHeight + 1;
      if (!overflowsX && !overflowsY) continue;

      const box = innerBox(owner);
      const isOutside = (/** @type {{left:number,right:number,top:number,bottom:number}} */ l) =>
        (axes.x && (l.right <= box.left || l.left >= box.right)) || (axes.y && (l.bottom <= box.top || l.top >= box.bottom));
      if (lines.every(isOutside)) {
        exempt('off-canvas-text');
        continue;
      }
      const cut = lines.some(
        (l) =>
          (overflowsX && (l.right > box.right + 1 || l.left < box.left - 1)) ||
          (overflowsY && (l.bottom > box.bottom + 1 || l.top < box.top - 1)),
      );
      if (!cut || reportedClipOwners.has(owner)) continue;
      reportedClipOwners.add(owner);

      const intentional = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
      if (!intentional) {
        report(checks.clippedText, owner, `text is cut off (scroll ${owner.scrollWidth}x${owner.scrollHeight}, client ${owner.clientWidth}x${owner.clientHeight})`);
      } else if (!hasAccessibleFullText(owner)) {
        report(checks.clippedText, owner, 'truncated with numberOfLines but the full text is not available as aria-label or title');
      }
    }
  }

  // ---- 2b. Mid-word wrap: a short one-token text that the layout broke over two or more lines ("20 / 02", "AW / D").
  // A measurement mirror: aria-hidden and taken out of the flow or the pointer (SpecStrip's measure row, TextInput's mirror).
  const insideMeasurementMirror = (/** @type {Element} */ el) => {
    for (let cur = /** @type {Element|null} */ (el); cur && cur !== document.body; cur = cur.parentElement) {
      if (cur.getAttribute('aria-hidden') !== 'true') continue;
      const cs = getComputedStyle(cur);
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.pointerEvents === 'none') return true;
    }
    return false;
  };
  /** A limit the element declares, or NaN (`auto`, unsupported, unreadable). */
  const declaredLimit = (/** @type {unknown} */ value) => (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
  /** @type {CanvasRenderingContext2D|null} */
  let glyphContext = null;
  /** The advance of `text` in the element's font, on a canvas: what a glyph takes without a generated hyphen after it. */
  const glyphWidth = (/** @type {CSSStyleDeclaration} */ cs, /** @type {string} */ text) => {
    glyphContext ??= document.createElement('canvas').getContext('2d');
    if (!glyphContext) return Number.NaN;
    glyphContext.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('letterSpacing' in glyphContext) /** @type {any} */ (glyphContext).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    const shown = cs.textTransform === 'uppercase' ? text.toUpperCase() : cs.textTransform === 'lowercase' ? text.toLowerCase() : text;
    return glyphContext.measureText(shown).width;
  };
  /**
   * The house rule's limits as they apply to an element (never looser than DQ-181, stricter where the element declares more), and
   * whether the element hyphenates automatically at all.
   * @param {CSSStyleDeclaration} cs
   */
  const houseLimits = (cs) => {
    const style = /** @type {any} */ (cs);
    const chars = String(style.hyphenateLimitChars ?? '').trim().split(/\s+/);
    return {
      auto: cs.hyphens === 'auto' || style.webkitHyphens === 'auto',
      minWord: Math.max(cfg.hyphenation.minWord, declaredLimit(chars[0]) || 0),
      minBefore: Math.max(cfg.hyphenation.minBefore, declaredLimit(chars[1]) || 0, declaredLimit(style.webkitHyphenateLimitBefore) || 0),
      minAfter: Math.max(cfg.hyphenation.minAfter, declaredLimit(chars[2] ?? chars[1]) || 0, declaredLimit(style.webkitHyphenateLimitAfter) || 0),
    };
  };
  /**
   * How this engine applies the hyphenation limits (MF-R4-3). An engine that reads hyphenate-limit-chars applies all three limits to
   * the segment between two break opportunities, every character counted, so punctuation attached to the word counts: closing
   * punctuation (and the hard hyphen a compound part ends in, "Community-") after it towards the after side and the length, opening
   * punctuation before it towards the before side and the length (the running-text pass reads the whole segment). Probed on Chromium 156 and WebKit 27.2 (Playwright 1.64): both read it and break
   * "Prüf-stand." and "aufneh-men," but never "Prüfstand" or "aufnehmen". An engine that does not parse hyphenate-limit-chars (WebKit
   * before it did) reads only -webkit-hyphenate-limit-before/after, counted the same way, and has no word minimum.
   */
  const ENGINE_WORD_MINIMUM = CSS.supports('hyphenate-limit-chars', '10 4 4');
  /** Punctuation that sticks to a word, for a short-token leaf: before it (opening), after it (closing, and a compound part's hyphen). */
  const OPENING_PUNCTUATION = /["'(\[{„‚“‘«»‹›¿¡]/u;
  const CLOSING_PUNCTUATION = /[.,;:!?)\]}"'“”‘’«»‹›…\-\u2010]/u;
  /**
   * A hyphenation the engine itself may make under the house limits, counted the way the engine counts.
   * @param {{length:number,before:number,after:number}} split characters of the segment, before and after the break
   * @param {ReturnType<typeof houseLimits>} house
   */
  const engineAllows = (split, house) =>
    house.auto && split.before >= house.minBefore && split.after >= house.minAfter && (!ENGINE_WORD_MINIMUM || split.length >= house.minWord);
  /** The house limits as this engine applies them, for a message. */
  const engineRule = (/** @type {ReturnType<typeof houseLimits>} */ house) =>
    ENGINE_WORD_MINIMUM
      ? `as the engine counts it (hyphenate-limit-chars): a word of ${house.minWord}, ${house.minBefore} before and ${house.minAfter} after the ` +
        'break, attached punctuation included'
      : `as the engine counts it (-webkit-hyphenate-limit-before/after only): ${house.minBefore} before and ${house.minAfter} after the ` +
        'break, attached punctuation included, no word minimum';
  /** The width the line boxes of `el`'s text get: the content box of its nearest block container. */
  const lineBoxWidth = (/** @type {Element} */ el) => {
    let cur = el;
    while (cur.parentElement && /^(inline|contents)$/.test(getComputedStyle(cur).display)) cur = cur.parentElement;
    const cs = getComputedStyle(cur);
    const px = (/** @type {string} */ v) => parseFloat(v) || 0;
    return cur.getBoundingClientRect().width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
  };
  /**
   * SF-R4-1: a word wider than its whole line cannot fit on any line, so the finding stays, with the reason for design QA's triage.
   * @param {Element} el
   * @param {CSSStyleDeclaration} cs
   * @param {string} word
   */
  const widerThanLine = (el, cs, word) => {
    const wordWidth = glyphWidth(cs, word);
    const line = lineBoxWidth(el);
    return wordWidth > line + 0.5 ? ` (word wider than its line: ${round(wordWidth)} px word, ${round(line)} px line)` : '';
  };
  /**
   * DQ-181: the token is a dictionary hyphenation under the house rule, with a visible hyphen at every break (see the header).
   * @param {Element} el
   * @param {CSSStyleDeclaration} cs
   * @param {string} token
   * @param {number[]} lineMiddles the line boxes of the element's text, top to bottom
   */
  const isHouseHyphenation = (el, cs, token, lineMiddles) => {
    const house = houseLimits(cs);
    if (!house.auto) return false;
    // Letters, with the punctuation attached to them: the engine counts "Fahrzeuge," and "(Verträge)" whole (MF-R4-3). A digit or any
    // other character is no hyphenation.
    const parts = /^(\P{L}*?)(\p{L}+)(\P{L}*)$/u.exec(token);
    if (!parts) return false;
    const [, opening = '', core = '', closing = ''] = parts;
    if (![...opening].every((c) => OPENING_PUNCTUATION.test(c)) || ![...closing].every((c) => CLOSING_PUNCTUATION.test(c))) return false;
    const lead = [...opening].length;
    const coreLength = [...core].length;
    const length = [...token].length;

    const lineOf = (/** @type {DOMRect} */ r) => {
      const middle = r.top + r.height / 2;
      let best = 0;
      lineMiddles.forEach((line, i) => {
        if (Math.abs(line - middle) < Math.abs(/** @type {number} */ (lineMiddles[best]) - middle)) best = i;
      });
      return best;
    };
    // Per character: its glyph's line and left edge. A character's range can also report a generated hyphen on the line above
    // (Chromium maps it to the next character), so the glyph is its lowest box. Every box still counts for its line's right edge.
    /** @type {{char:string,line:number,left:number}[]} */
    const letters = [];
    const lineRight = lineMiddles.map(() => Number.NEGATIVE_INFINITY);
    const charRange = document.createRange();
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const data = /** @type {Text} */ (node).data;
      for (let offset = 0; offset < data.length; ) {
        const char = String.fromCodePoint(/** @type {number} */ (data.codePointAt(offset)));
        charRange.setStart(node, offset);
        charRange.setEnd(node, offset + char.length);
        offset += char.length;
        if (/\s/.test(char)) continue;
        const boxes = [...charRange.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (boxes.length === 0) return false;
        for (const box of boxes) {
          const line = lineOf(box);
          lineRight[line] = Math.max(/** @type {number} */ (lineRight[line]), box.right);
        }
        const glyph = boxes.reduce((low, box) => (box.top > low.top ? box : low));
        letters.push({ char, line: lineOf(glyph), left: Math.min(...boxes.filter((b) => lineOf(b) === lineOf(glyph)).map((b) => b.left)) });
      }
    }
    if (letters.length !== length) return false;
    const hyphenWidth = glyphWidth(cs, '-');
    if (!(hyphenWidth > 0)) return false;
    for (let i = 1; i < letters.length; i++) {
      const before = /** @type {{char:string,line:number,left:number}} */ (letters[i - 1]);
      const after = /** @type {{char:string,line:number,left:number}} */ (letters[i]);
      if (after.line === before.line) continue;
      if (after.line !== before.line + 1) return false;
      // Only between two letters, and inside the limits as the engine counts them (an engine without hyphenate-limit-chars has no
      // word minimum).
      if (i <= lead || i >= lead + coreLength || !engineAllows({ length, before: i, after: length - i }, house)) return false;
      // The line box reaches past the last letter's own glyph by a hyphen: the break shows one.
      const pastGlyph = /** @type {number} */ (lineRight[before.line]) - (before.left + glyphWidth(cs, before.char));
      if (!(pastGlyph >= hyphenWidth / 2)) return false;
    }
    return true;
  };
  const midWordRange = document.createRange();
  /** @type {Set<Element>} leaves whose one short token the check above decided; the running-text pass leaves them alone */
  const shortTokenLeaves = new Set();
  for (const el of textBearing) {
    // A leaf, or a token whose only child elements are <wbr> break opportunities (intent, below).
    const wbr = el.children.length > 0 && [...el.children].every((child) => child.localName === 'wbr');
    if ((el.children.length > 0 && !wbr) || el.matches('input,textarea,select')) continue;
    const raw = el.textContent ?? '';
    const token = raw.trim();
    if (token === '' || [...token].length > cfg.midWordMax || /\s/.test(token)) continue;
    shortTokenLeaves.add(el);
    const cs = getComputedStyle(el);
    if (isVisuallyHidden(el, cs) || insideSrOnly(el) || insideMeasurementMirror(el)) continue;
    if (wbr || /[\u00AD\u200B]/.test(raw) || cs.wordBreak === 'break-all' || cs.lineBreak === 'anywhere') {
      exempt('mid-word-intent');
      continue;
    }
    midWordRange.selectNodeContents(el);
    const rects = [...midWordRange.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
    let lines = 0;
    let lastMiddle = Number.NEGATIVE_INFINITY;
    /** @type {number[]} the middle of each line box, top to bottom */
    const lineMiddles = [];
    for (const r of rects) {
      const middle = r.top + r.height / 2;
      // A new line starts below the middle of the previous one; fragments of one line (a bidi run) share it.
      if (middle - lastMiddle > r.height / 2) {
        lines++;
        lastMiddle = middle;
        lineMiddles.push(middle);
      }
    }
    if (lines <= 1) continue;
    if (isHouseHyphenation(el, cs, token, lineMiddles)) {
      exempt('hyphenation');
      continue;
    }
    report(checks.midWordWrap, el, `"${token}" breaks inside the word over ${lines} lines${widerThanLine(el, cs, token)}`);
  }

  const renderedSet = new Set(elements);

  // ---- 2c. Running text (DQ-923, DQ-925, DQ-926): every word of a text node that the layout split over two line boxes, and every
  // hard hyphen at a line end inside a short name part. Only text nodes that render on more than one line are looked at, and in
  // them only the words whose own range does; the per-character measurement runs for those words alone.
  /** How many line boxes client rects make: a new line starts below the middle of the previous one (bidi fragments share it). */
  const lineCount = (/** @type {DOMRect[]} */ rects) => {
    let lines = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (const r of [...rects].sort((a, b) => a.top - b.top)) {
      const middle = r.top + r.height / 2;
      if (middle - last > r.height / 2) {
        lines++;
        last = middle;
      }
    }
    return lines;
  };
  const positiveRects = (/** @type {Range} */ r) => [...r.getClientRects()].filter((b) => b.width > 0 && b.height > 0);
  /** Rotated, skewed or vertical text: its glyphs step down without a line break, so line boxes cannot be read from them. */
  const isTurned = (/** @type {Element} */ el) => {
    if (!/^horizontal/.test(getComputedStyle(el).writingMode || 'horizontal-tb')) return true;
    for (let cur = /** @type {Element|null} */ (el); cur && cur !== document.documentElement; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.rotate && cs.rotate !== 'none' && !/^0(deg|rad|turn)?$/.test(cs.rotate.trim())) return true;
      const m = /^matrix\(\s*[-\d.e]+,\s*([-\d.e]+),\s*([-\d.e]+),/.exec(cs.transform);
      if (m && (Math.abs(Number(m[1])) > 0.001 || Math.abs(Number(m[2])) > 0.001)) return true;
      if (/^matrix3d/.test(cs.transform)) return true;
    }
    return false;
  };
  const glyphRange = document.createRange();
  /**
   * The boxes of one character of a text node, and its glyph: the lowest box (Chromium also reports the generated hyphen of a break
   * on the line above with the character after it).
   * @param {Text} node
   * @param {number} offset
   * @param {number} length
   */
  const glyphOf = (node, offset, length) => {
    glyphRange.setStart(node, offset);
    glyphRange.setEnd(node, offset + length);
    const boxes = positiveRects(glyphRange);
    if (boxes.length === 0) return null;
    return { boxes, glyph: boxes.reduce((low, box) => (box.top > low.top ? box : low)) };
  };
  const middleOf = (/** @type {DOMRect} */ r) => r.top + r.height / 2;
  /** `b` sits on a later line than `a`. */
  const below = (/** @type {DOMRect} */ a, /** @type {DOMRect} */ b) => middleOf(b) - middleOf(a) > a.height / 2;
  const NAME_PART_MIN = 3;
  const wordRange = document.createRange();
  for (const node of textNodes) {
    const el = /** @type {Element} */ (node.parentElement);
    if (shortTokenLeaves.has(el) || el.matches('textarea,select,option')) continue;
    const data = node.data;
    if (!/\p{L}/u.test(data)) continue;
    wordRange.selectNodeContents(node);
    if (lineCount(positiveRects(wordRange)) <= 1) continue;
    const cs = getComputedStyle(el);
    if (isVisuallyHidden(el, cs) || insideSrOnly(el) || insideMeasurementMirror(el)) continue;
    if (cs.wordBreak === 'break-all' || cs.lineBreak === 'anywhere') {
      exempt('mid-word-intent');
      continue;
    }
    if (isTurned(el)) {
      exempt('turned-text');
      continue;
    }

    // Words: runs of letters (combining marks belong to their letter). A soft hyphen, a zero-width space or a word joiner is no
    // letter, so a break there is between two words; so is a break at '@', '.', '/' or '-' of an e-mail, a URL or a name.
    for (const match of data.matchAll(/\p{L}[\p{L}\p{M}]*/gu)) {
      const word = match[0];
      const start = /** @type {number} */ (match.index);
      if ([...word.replace(/\p{M}/gu, '')].length < 2) continue;
      wordRange.setStart(node, start);
      wordRange.setEnd(node, start + word.length);
      if (lineCount(positiveRects(wordRange)) <= 1) continue;
      /** @type {{char:string, offset:number, glyph:DOMRect, boxes:DOMRect[]}[]} */
      const letters = [];
      let unreadable = false;
      for (let offset = start; offset < start + word.length; ) {
        const char = String.fromCodePoint(/** @type {number} */ (data.codePointAt(offset)));
        if (/\p{M}/u.test(char)) {
          offset += char.length;
          continue;
        }
        const g = glyphOf(node, offset, char.length);
        if (!g) {
          unreadable = true;
          break;
        }
        letters.push({ char, offset, ...g });
        offset += char.length;
      }
      if (unreadable || letters.length < 2) continue;
      /** @type {{at:number, hyphen:boolean}[]} */
      const breaks = [];
      for (let i = 1; i < letters.length; i++) {
        const before = /** @type {(typeof letters)[number]} */ (letters[i - 1]);
        const after = /** @type {(typeof letters)[number]} */ (letters[i]);
        if (!below(before.glyph, after.glyph)) continue;
        // The right edge of the line the break leaves: every box of the word on that line, a generated hyphen included.
        const lineRight = Math.max(...letters.flatMap((l) => l.boxes).filter((b) => !below(before.glyph, b) && !below(b, before.glyph)).map((b) => b.right));
        const hyphenWidth = glyphWidth(cs, '-');
        const pastGlyph = lineRight - (before.glyph.left + glyphWidth(cs, before.char));
        breaks.push({ at: i, hyphen: hyphenWidth > 0 && pastGlyph >= hyphenWidth / 2 });
      }
      if (breaks.length === 0) continue;
      const house = houseLimits(cs);
      // The segment the engine hyphenates: the run between two break opportunities around the word, every character of it counted
      // (probe of 2026-11-11). It ends at whitespace and at a zero-width space, and after a hard hyphen that no word joiner follows;
      // so it carries the punctuation attached to the word ("Fahrzeuge," is 10, "(Prüfstand" too), the hyphen of a compound part
      // ("Community-"), and a part joined to it ("SS-\u2060Ladern" is 10: both engines break "SS-\u2060La-dern").
      const breaksAfter = (/** @type {number} */ k) => /[-\u2010]/.test(data.charAt(k)) && data.charAt(k + 1) !== '\u2060';
      const opensSegment = (/** @type {number} */ k) => k <= 0 || /[\s\u200B]/.test(data.charAt(k - 1)) || breaksAfter(k - 1);
      let segmentStart = start;
      while (!opensSegment(segmentStart)) segmentStart--;
      let segmentEnd = start + word.length;
      while (segmentEnd < data.length && !/[\s\u200B]/.test(data.charAt(segmentEnd)) && !breaksAfter(segmentEnd - 1)) segmentEnd++;
      const lead = [...data.slice(segmentStart, start)].length;
      const trail = [...data.slice(start + word.length, segmentEnd)].length;
      const length = lead + letters.length + trail;
      const splitOf = (/** @type {{at:number}} */ b) => ({ length, before: lead + b.at, after: letters.length - b.at + trail });
      const bad = breaks.find((b) => !(b.hyphen && engineAllows(splitOf(b), house)));
      if (!bad) {
        exempt('hyphenation');
        continue;
      }
      const shown = letters.map((l) => l.char).join('');
      const split = `${shown.slice(0, bad.at)}${bad.hyphen ? '-' : ''} / ${shown.slice(bad.at)}`;
      const counted = splitOf(bad);
      const segment = data.slice(segmentStart, segmentEnd);
      report(
        checks.midWordWrap,
        el,
        bad.hyphen
          ? `"${split}" hyphenates "${segment}" outside the house rule ${engineRule(house)} (counted here: ${counted.length} in the word, ` +
              `${counted.before} before, ${counted.after} after)${widerThanLine(el, cs, word)}`
          : `"${split}" breaks the word "${shown}" across two lines without a hyphen${widerThanLine(el, cs, word)}`,
        wordRange.getBoundingClientRect(),
      );
    }

    // Name-hyphen-break: a line that ends at a hard hyphen inside a token, when the break leaves fewer than 3 letters or digits of
    // that token on either side ("GT- / R", "Slip- / On", "E- / Auto"; "Rhein- / Main" is fine). Counted within the token (it runs to
    // whitespace): before = from its start to the hyphen, after = from the hyphen to its end, letters and digits only. So
    // "Datenschutz- / E-Mail" (11 and 5) and "GT-SS- / Ladern" (4 and 6) are fine, "E- / Mail" (1) and "QR- / Sticker" (2) are not.
    // U+2011 and a word joiner after the hyphen never break.
    const countNamePart = (/** @type {string} */ part) => [...part.matchAll(/[\p{L}\p{N}]/gu)].length;
    for (const match of data.matchAll(/[-\u2010]/g)) {
      const h = /** @type {number} */ (match.index);
      // A hyphen between two letters or digits; a dash between spaces or at a token edge is no name hyphen.
      if (!/[\p{L}\p{N}]$/u.test(data.slice(0, h)) || !/^[\p{L}\p{N}]/u.test(data.slice(h + 1))) continue;
      const hyphen = glyphOf(node, h, 1);
      const following = glyphOf(node, h + 1, String.fromCodePoint(/** @type {number} */ (data.codePointAt(h + 1))).length);
      if (!hyphen || !following || !below(hyphen.glyph, following.glyph)) continue;
      const tokenStart = data.slice(0, h).search(/\S*$/);
      const tokenEnd = h + 1 + (data.slice(h + 1).match(/^\S*/)?.[0].length ?? 0);
      const head = data.slice(tokenStart, h);
      const tail = data.slice(h + 1, tokenEnd);
      const before = countNamePart(head);
      const after = countNamePart(tail);
      if (before >= NAME_PART_MIN && after >= NAME_PART_MIN) continue;
      report(
        checks.nameHyphenBreak,
        el,
        `"${head}${match[0]} / ${tail}" breaks "${data.slice(tokenStart, tokenEnd)}" at a hyphen, leaving ${Math.min(before, after)} ` +
          `letter(s) or digit(s) of it on one side (at least ${NAME_PART_MIN}; join it with U+2011 or a word joiner)`,
        hyphen.glyph,
      );
    }
  }

  // ---- 2d. Lost truncation (DQ-922): an element that asks for one line (text-overflow: ellipsis, as numberOfLines={1} sets it with
  // white-space: nowrap) or for N lines (-webkit-line-clamp N) but renders more line boxes. A later shorthand (text-wrap: pretty
  // resets text-wrap-mode) or a lost display: -webkit-box drops the truncation without a trace in the element's own rules. Counted:
  // the line boxes of its own text and of inline descendants, inside its box when it clips vertically (a clamp lays out the hidden
  // lines below it).
  const truncRange = document.createRange();
  for (const el of elements) {
    if (el.tagName.toLowerCase() === 'svg' || el.matches('input,textarea,select')) continue;
    const cs = getComputedStyle(el);
    const clamp = declaredLimit(/** @type {any} */ (cs).webkitLineClamp);
    const ellipsis = cs.textOverflow === 'ellipsis';
    if (!ellipsis && !(clamp > 0)) continue;
    if (!normalise(el.textContent)) continue;
    if (isVisuallyHidden(el, cs) || insideSrOnly(el) || insideMeasurementMirror(el)) continue;
    const allowed = clamp > 0 ? clamp : 1;
    const inline = cs.display === 'inline';
    const outer = el.getBoundingClientRect();
    const clipsY = !inline && clipAxes(cs).y;
    const top = outer.top + el.clientTop;
    const bottom = top + el.clientHeight;
    /** @type {DOMRect[]} */
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue;
      let flows = renderedSet.has(/** @type {Element} */ (node.parentElement));
      for (let cur = node.parentElement; flows && cur && cur !== el; cur = cur.parentElement) {
        if (!/^(inline|contents)$/.test(getComputedStyle(cur).display)) flows = false;
      }
      if (!flows) continue;
      truncRange.selectNodeContents(node);
      for (const r of positiveRects(truncRange)) if (!clipsY || (middleOf(r) >= top && middleOf(r) <= bottom)) rects.push(r);
    }
    const lines = lineCount(rects);
    if (lines <= allowed) continue;
    const style = /** @type {any} */ (cs);
    report(
      checks.lostTruncation,
      el,
      `asks for ${clamp > 0 ? `${clamp} line(s) (-webkit-line-clamp ${clamp}, display ${cs.display})` : '1 line (text-overflow: ellipsis)'} ` +
        `but renders ${lines} line boxes (white-space ${cs.whiteSpace}, text-wrap-mode ${style.textWrapMode ?? 'n/a'}): the truncation is lost`,
    );
  }

  // ---- 3. Overlap
  const clipToAncestors = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    const v = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = cur.getBoundingClientRect();
      if (cs.overflowX !== 'visible') {
        v.left = Math.max(v.left, b.left);
        v.right = Math.min(v.right, b.right);
      }
      if (cs.overflowY !== 'visible') {
        v.top = Math.max(v.top, b.top);
        v.bottom = Math.min(v.bottom, b.bottom);
      }
    }
    return v;
  };
  const nearestScroller = (/** @type {Element} */ el) => {
    for (let cur = el.parentElement; cur; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      const canX = scrollsX(cs) && cur.scrollWidth > cur.clientWidth;
      const canY = scrollsY(cs) && cur.scrollHeight > cur.clientHeight;
      if (canX || canY) return cur;
    }
    return null;
  };
  const isPinned = (/** @type {Element} */ el) => {
    for (let cur = /** @type {Element|null} */ (el); cur && cur !== document.body; cur = cur.parentElement) {
      const p = getComputedStyle(cur).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  const clipped = interactive.map((el) => ({ el, v: clipToAncestors(el) }));
  for (let i = 0; i < clipped.length; i++) {
    const a = /** @type {{el:Element,v:{left:number,top:number,right:number,bottom:number}}} */ (clipped[i]);
    for (let j = i + 1; j < clipped.length; j++) {
      const b = /** @type {{el:Element,v:{left:number,top:number,right:number,bottom:number}}} */ (clipped[j]);
      const w = Math.min(a.v.right, b.v.right) - Math.max(a.v.left, b.v.left);
      const h = Math.min(a.v.bottom, b.v.bottom) - Math.max(a.v.top, b.v.top);
      if (w <= 1 || h <= 1) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const sa = nearestScroller(a.el);
      const sb = nearestScroller(b.el);
      if (sa !== sb || ((sa || sb) && (isPinned(a.el) || isPinned(b.el)))) {
        exempt('overlap-resolved-by-scrolling');
        continue;
      }
      report(checks.overlap, a.el, `intersects ${describe(b.el)} by ${round(w)}x${round(h)}`);
    }
  }

  // ---- 3b. Covered glyph (DQ-901): an icon of a control painted under an opaque layer of the same control.
  /** @type {Map<Element, boolean>} */
  const stackingMemo = new Map();
  const parentDisplay = (/** @type {Element} */ el) => (el.parentElement ? getComputedStyle(el.parentElement).display : 'block');
  /** The z-index that takes effect: on a positioned element or a flex/grid item; null for auto or where it does not apply. */
  const effectiveZ = (/** @type {Element} */ el, /** @type {CSSStyleDeclaration} */ cs) => {
    if (cs.zIndex === 'auto') return null;
    return cs.position !== 'static' || /flex|grid/.test(parentDisplay(el)) ? Number(cs.zIndex) : null;
  };
  /** CSS stacking context roots (the common triggers; the root element always is one). */
  const createsStackingContext = (/** @type {Element} */ el) => {
    const known = stackingMemo.get(el);
    if (known !== undefined) return known;
    const cs = getComputedStyle(el);
    const style = /** @type {any} */ (cs);
    const not = (/** @type {unknown} */ value, /** @type {string} */ none) => typeof value === 'string' && value !== '' && value !== none;
    const result =
      el === document.documentElement ||
      effectiveZ(el, cs) !== null ||
      cs.position === 'fixed' ||
      cs.position === 'sticky' ||
      parseFloat(cs.opacity) < 1 ||
      ['transform', 'translate', 'rotate', 'scale', 'filter', 'backdropFilter', 'webkitBackdropFilter', 'perspective', 'clipPath', 'maskImage', 'webkitMaskImage']
        .some((prop) => not(style[prop], 'none')) ||
      not(cs.mixBlendMode, 'normal') ||
      cs.isolation === 'isolate' ||
      /transform|opacity|filter|perspective|clip-path|mask|isolation|mix-blend-mode|translate|rotate|scale/.test(cs.willChange) ||
      /paint|layout|strict|content/.test(cs.contain) ||
      /size/.test(style.containerType ?? '');
    stackingMemo.set(el, result);
    return result;
  };
  /** Painted as its own layer of its stacking context: positioned, or a stacking context root. */
  const isLayered = (/** @type {Element} */ el) => getComputedStyle(el).position !== 'static' || createsStackingContext(el);
  /** Paint order inside one stacking context: negative z, in-flow content, z auto/0 layers, positive z (CSS 2.1 Appendix E). */
  const paintKey = (/** @type {Element} */ el) => {
    if (!isLayered(el)) return { layer: 1, z: 0 };
    const z = effectiveZ(el, getComputedStyle(el)) ?? 0;
    return { layer: z < 0 ? 0 : z > 0 ? 3 : 2, z };
  };
  const stackingAncestors = (/** @type {Element} */ el) => {
    const out = [];
    for (let cur = el.parentElement; cur; cur = cur.parentElement) if (createsStackingContext(cur)) out.push(cur);
    return out;
  };
  /** What paints `el` in the context `ctx`: its outermost stacking context below ctx, else its nearest layered ancestor, else itself. */
  const paintUnit = (/** @type {Element} */ el, /** @type {Element} */ ctx) => {
    /** @type {Element|null} */
    let outermostContext = null;
    /** @type {Element|null} */
    let nearestLayered = null;
    for (let cur = /** @type {Element|null} */ (el); cur && cur !== ctx; cur = cur.parentElement) {
      if (createsStackingContext(cur)) outermostContext = cur;
      if (nearestLayered === null && isLayered(cur)) nearestLayered = cur;
    }
    return outermostContext ?? nearestLayered ?? el;
  };
  const follows = (/** @type {Node} */ a, /** @type {Node} */ b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  /** Whether `b` paints after (above) `a`; neither contains the other. */
  const paintsAfter = (/** @type {Element} */ b, /** @type {Element} */ a) => {
    const ofA = new Set(stackingAncestors(a));
    const ctx = stackingAncestors(b).find((c) => ofA.has(c)) ?? document.documentElement;
    const ua = paintUnit(a, ctx);
    const ub = paintUnit(b, ctx);
    // One unit paints both in its own flow: document order.
    if (ua === ub) return follows(a, b);
    const ka = paintKey(ua);
    const kb = paintKey(ub);
    if (ka.layer !== kb.layer) return kb.layer > ka.layer;
    if (ka.z !== kb.z) return kb.z > ka.z;
    return follows(ua, ub);
  };
  const areaOf = (/** @type {{left:number,top:number,right:number,bottom:number}} */ r) =>
    Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  /** A layer that hides what is under it: rendered, opacity above 0, and an opaque background or a backdrop blur. */
  const isOpaqueLayer = (/** @type {Element} */ el) => {
    if (!renderedSet.has(el) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const cs = getComputedStyle(el);
    const style = /** @type {any} */ (cs);
    if (parseFloat(cs.opacity) === 0) return false;
    const backdrop = [style.backdropFilter, style.webkitBackdropFilter].some((v) => typeof v === 'string' && v !== '' && v !== 'none');
    const bg = parseCssColour(cs.backgroundColor);
    return backdrop || (bg !== null && bg.a >= cfg.cover.alpha);
  };
  for (const icon of elements) {
    if (icon.tagName.toLowerCase() !== 'svg') continue;
    const control = icon.parentElement?.closest(INTERACTIVE_SELECTOR);
    if (!control || insideMeasurementMirror(icon) || insideSrOnly(icon)) continue;
    const iconBox = clipToAncestors(icon);
    const iconArea = areaOf(iconBox);
    if (iconArea <= 0) continue;
    for (const layer of control.querySelectorAll('*')) {
      if (layer === icon || layer.contains(icon) || layer.closest('svg')) continue;
      if (!isOpaqueLayer(layer)) continue;
      const box = clipToAncestors(layer);
      const covered =
        areaOf({
          left: Math.max(box.left, iconBox.left),
          top: Math.max(box.top, iconBox.top),
          right: Math.min(box.right, iconBox.right),
          bottom: Math.min(box.bottom, iconBox.bottom),
        }) / iconArea;
      if (covered < cfg.cover.area || !paintsAfter(layer, icon)) continue;
      report(
        checks.coveredGlyph,
        icon,
        `icon of ${describe(control)} is painted under ${describe(layer)} (covers ${Math.round(covered * 100)} % of it, later in paint order)`,
      );
      break;
    }
  }

  // ---- 3c. Clipped field (DQ-902): a multiline field whose text scrolls before the field reached its maximum height.
  const px = (/** @type {string} */ v) => parseFloat(v) || 0;
  const lineHeightOf = (/** @type {CSSStyleDeclaration} */ cs) => {
    const line = parseFloat(cs.lineHeight);
    return Number.isFinite(line) ? line : parseFloat(cs.fontSize) * 1.2;
  };
  for (const field of elements) {
    if (!field.matches('textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"][aria-multiline="true"]')) continue;
    if (insideSrOnly(field) || insideMeasurementMirror(field)) continue;
    if (field.scrollHeight <= field.clientHeight + 1) continue;
    const cs = getComputedStyle(field);
    const line = lineHeightOf(cs);
    const paddingY = px(cs.paddingTop) + px(cs.paddingBottom);
    const textBox = field.clientHeight - paddingY;
    /** The highest the text box may get: the max-height content box, else `rows` lines of a textarea. */
    let maxBox = Number.NaN;
    let source = '';
    if (cs.maxHeight.endsWith('px')) {
      const borderY = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
      maxBox = px(cs.maxHeight) - (cs.boxSizing === 'border-box' ? paddingY + borderY : 0);
      source = `max-height ${cs.maxHeight}`;
    } else if (field.tagName === 'TEXTAREA' && field.hasAttribute('rows')) {
      maxBox = /** @type {HTMLTextAreaElement} */ (field).rows * line;
      source = `rows ${/** @type {HTMLTextAreaElement} */ (field).rows}`;
    }
    if (!Number.isFinite(maxBox) || textBox >= maxBox - 1) continue;
    const lines = (/** @type {number} */ h) => Math.round((h / line) * 10) / 10;
    report(
      checks.clippedField,
      field,
      `the text needs ${lines(field.scrollHeight - paddingY)} lines but the field shows ${lines(textBox)} of at most ${lines(maxBox)} (${source}): ` +
        `it scrolls instead of growing (scroll ${field.scrollHeight}, client ${field.clientHeight})`,
    );
  }

  // ---- 4. Touch target + 9. Missing label
  const isInlineTextLink = (/** @type {Element} */ el, /** @type {CSSStyleDeclaration} */ cs) => {
    if (cs.display !== 'inline' || !el.parentElement) return false;
    return [...el.parentElement.childNodes].some((n) => n !== el && n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
  };
  const hitArea = (/** @type {Element} */ el) => {
    const r = el.getBoundingClientRect();
    const u = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const grow = (/** @type {{left:number,top:number,right:number,bottom:number}} */ o) => {
      u.left = Math.min(u.left, o.left);
      u.top = Math.min(u.top, o.top);
      u.right = Math.max(u.right, o.right);
      u.bottom = Math.max(u.bottom, o.bottom);
    };
    for (const d of el.querySelectorAll('*')) {
      if (d.closest('svg') && d.tagName.toLowerCase() !== 'svg') continue;
      if (getComputedStyle(d).pointerEvents === 'none') continue;
      const dr = d.getBoundingClientRect();
      if (dr.width > 0 && dr.height > 0) grow(dr);
    }
    for (const pseudo of ['::before', '::after']) {
      const p = getComputedStyle(el, pseudo);
      if (p.content === 'none' || p.content === 'normal' || p.position !== 'absolute') continue;
      const left = parseFloat(p.left);
      const top = parseFloat(p.top);
      const width = parseFloat(p.width);
      const height = parseFloat(p.height);
      if ([left, top, width, height].every(Number.isFinite)) {
        grow({ left: r.left + left, top: r.top + top, right: r.left + left + width, bottom: r.top + top + height });
      }
    }
    const labels = /** @type {HTMLInputElement} */ (el).labels;
    if (labels) for (const l of labels) grow(l.getBoundingClientRect());
    const wrapper = el.parentElement?.closest('[data-qa-hit-wrapper]');
    if (wrapper) {
      const inside = [...wrapper.querySelectorAll(INTERACTIVE_SELECTOR)].filter((x) => interactive.includes(x));
      if (inside.length === 1 && inside[0] === el) grow(wrapper.getBoundingClientRect());
    }
    return { width: u.right - u.left, height: u.bottom - u.top };
  };
  const accessibleName = (/** @type {Element} */ el) => {
    const aria = normalise(el.getAttribute('aria-label'));
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = normalise(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
      if (t) return t;
    }
    const labels = /** @type {HTMLInputElement} */ (el).labels;
    if (labels?.length) {
      const t = normalise([...labels].map((l) => l.textContent).join(' '));
      if (t) return t;
    }
    if (normalise(el.getAttribute('title'))) return /** @type {string} */ (el.getAttribute('title'));
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const input = /** @type {HTMLInputElement} */ (el);
      if (['button', 'submit', 'reset'].includes(input.type) && input.value) return input.value;
      if (input.placeholder) return input.placeholder;
    }
    const t = normalise(el.textContent);
    if (t) return t;
    for (const child of el.querySelectorAll('img[alt],[aria-label],svg title')) {
      const n = normalise(child.getAttribute('alt') ?? child.getAttribute('aria-label') ?? child.textContent);
      if (n) return n;
    }
    return '';
  };
  const targetFloor = () => (cfg.adminTargets ? cfg.adminTargets.standalone : cfg.touchMin);
  /** ADR-222: a skip link measured while focused, then focus goes back where it was. */
  const checkSkipLinkFocused = (/** @type {HTMLElement} */ el) => {
    const before = /** @type {HTMLElement|null} */ (document.activeElement);
    el.focus({ preventScroll: true });
    const focused = document.activeElement === el;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const clipped = (cs.clip && cs.clip !== 'auto') || (cs.clipPath && cs.clipPath !== 'none');
    const visible = focused && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width > 1 && r.height > 1 && !clipped;
    const floor = targetFloor();
    if (!visible) {
      report(checks.touchTarget, el, 'skip link does not become visible when focused (ADR-222)', r);
    } else if (r.width < floor - 0.01 || r.height < floor - 0.01) {
      report(checks.touchTarget, el, `focused skip link ${round(r.width)}x${round(r.height)} is below ${floor}x${floor} (ADR-222)`, r);
    }
    exempt('skip-link-focused');
    el.blur();
    if (before && before !== document.body && before !== el) before.focus({ preventScroll: true });
  };
  for (const el of interactive) {
    const cs = getComputedStyle(el);
    if (insideSrOnly(el)) {
      if (el.matches('a[href^="#"]') && isSrOnlyBox(el)) checkSkipLinkFocused(/** @type {HTMLElement} */ (el));
      else exempt('visually-hidden');
    } else if (isInlineTextLink(el, cs)) {
      exempt('inline-text-link');
    } else {
      const area = hitArea(el);
      let floor = cfg.touchMin;
      let rule = '';
      if (cfg.adminTargets) {
        const row = el.closest('tr, [role="row"]');
        const inRow = row !== null && row.getBoundingClientRect().height <= cfg.adminTargets.rowHeight + 0.5;
        floor = inRow ? cfg.adminTargets.inRow : cfg.adminTargets.standalone;
        rule = inRow ? ` (admin control in a ${cfg.adminTargets.rowHeight} px table row, ADR-212)` : ' (admin standalone control, ADR-212)';
      }
      if (area.width < floor - 0.01 || area.height < floor - 0.01) {
        report(checks.touchTarget, el, `hit area ${round(area.width)}x${round(area.height)} is below ${floor}x${floor}${rule}`);
      }
    }
    if (!accessibleName(el)) report(checks.missingLabel, el, 'interactive element has no accessible name');
  }

  // ---- 5-8. Per-element style checks
  const parseCss = parseCssColour;
  /** @typedef {{name:string,r:number,g:number,b:number,a:number}} Token */
  const matchToken = (/** @type {{r:number,g:number,b:number,a:number}} */ c, /** @type {Token[]} */ set) =>
    set.some(
      // Exact RGB: neighbouring tokens of different themes differ by a single channel step.
      (t) => t.r === c.r && t.g === c.g && t.b === c.b && Math.abs(t.a - c.a) <= 0.005,
    );
  const checkColour = (/** @type {Element} */ el, /** @type {string} */ prop, /** @type {string} */ value, /** @type {boolean} */ inQr) => {
    if (value === 'transparent') return;
    const c = parseCss(value);
    if (!c) {
      report(checks.nonTokenColour, el, `${prop}: ${value} is not an sRGB token colour`);
      return;
    }
    if (c.a === 0) return;
    // A themed frame inside the page (the admin gallery's Carbon and Hell side by side, ThemeFrame) is checked against the tokens of
    // its own theme, and only of that one. <html>'s data-theme never counts: the page's theme is the cell's (the qa contract checks it).
    // DQ-1045: a ThemeScope brand stage of the app (ONB, AUTH-01: `data-theme-scope="carbon"` on web) is such a frame too, so its
    // Carbon values are checked against Carbon's tokens in every page theme, and a real off-palette value inside it still reports.
    const scoped = el.closest('body [data-theme], body [data-theme-scope]');
    const frame = scoped?.getAttribute('data-theme') ?? scoped?.getAttribute('data-theme-scope') ?? null;
    const own = frame !== null && cfg.frameColors[frame] ? frame : cfg.theme;
    const set = own === cfg.theme ? { general: cfg.colors, qr: cfg.qrColors } : /** @type {{general:Token[],qr:Token[]}} */ (cfg.frameColors[own]);
    if (matchToken(c, set.general) || (inQr && matchToken(c, set.qr))) return;
    report(checks.nonTokenColour, el, `${prop}: ${value} is not a token of theme "${own}"${own === cfg.theme ? '' : ' (its frame)'}`);
  };

  const SPACING_PROPS = [
    ['margin-top', 'marginTop'], ['margin-right', 'marginRight'], ['margin-bottom', 'marginBottom'], ['margin-left', 'marginLeft'],
    ['padding-top', 'paddingTop'], ['padding-right', 'paddingRight'], ['padding-bottom', 'paddingBottom'], ['padding-left', 'paddingLeft'],
    ['row-gap', 'rowGap'], ['column-gap', 'columnGap'],
  ];
  const onScale = (/** @type {number} */ px) => cfg.spacing.some((s) => Math.abs(Math.abs(px) - s) < 0.01);
  // Resolved px of an `auto` or `%` margin is a layout result, so the specified value is what counts.
  const specifiedValue = (/** @type {Element} */ el, /** @type {string} */ prop) => {
    const map = el.computedStyleMap ? el.computedStyleMap() : null;
    const v = map ? map.get(prop) : null;
    if (!v) return null;
    if (typeof CSSUnitValue !== 'undefined' && v instanceof CSSUnitValue) return v.unit === 'px' ? v.value : NaN;
    return NaN;
  };
  const isExplicit = (/** @type {Element} */ el) => {
    const map = el.computedStyleMap();
    const ar = map.get('aspect-ratio');
    if (ar && String(ar) !== 'auto') return true;
    return String(map.get('width')) !== 'auto' && String(map.get('height')) !== 'auto';
  };
  const hasExplicitBox = (/** @type {Element} */ el) => {
    const img = /** @type {HTMLImageElement} */ (el);
    if (el.tagName === 'IMG' && el.hasAttribute('width') && el.hasAttribute('height') && img.width && img.height) return true;
    let cur = /** @type {Element|null} */ (el);
    // RN Web and expo-image place the <img> absolutely inside a sized view, up to two levels up.
    for (let depth = 0; cur && depth < 3; depth++, cur = cur.parentElement) {
      if (isExplicit(cur)) {
        if (depth === 0) return true;
        const cs = getComputedStyle(el);
        if (cs.position === 'absolute' || String(el.computedStyleMap().get('height')).endsWith('%')) return true;
      }
    }
    return false;
  };

  // An avatar's initials: one or two letters or digits, directly inside a square circle of an avatar size.
  const isAvatarInitials = (/** @type {Element} */ el) => {
    if (!/^[\p{L}\p{N}]{1,2}$/u.test(normalise(el.textContent))) return false;
    const circle = el.parentElement;
    if (!circle) return false;
    const r = circle.getBoundingClientRect();
    const side = cfg.avatarSizes.find((s) => Math.abs(r.width - s) < 0.5 && Math.abs(r.height - s) < 0.5);
    if (side === undefined) return false;
    return parseFloat(getComputedStyle(circle).borderTopLeftRadius) >= side / 2 - 0.5;
  };
  // A label of the phone tab bar in a cell of exactly the capped width (ADR-145), not the rail, the sidebar or any other tab.
  const isCappedTabLabel = (/** @type {Element} */ el) => {
    // The shell's bar, and the same TabBar shown in the component gallery (DEV-01 badges).
    if (!el.closest('[data-testid="shell.tabbar"], [data-testid^="DEV-01.badges.bar."]')) return false;
    const cell = el.closest('[role="tab"]');
    if (!cell) return false;
    return Math.abs(cell.getBoundingClientRect().width - cfg.tabCellWidth) < 0.5;
  };
  /** @type {Record<string,{allowed:(el:Element)=>boolean,where:string}>} */
  const RESTRICTED_EXEMPTIONS = {
    'brand-position': {
      allowed: (el) => cfg.brandPositionIds.includes(el.getAttribute('data-testid') ?? ''),
      where: `elements with data-testid ${cfg.brandPositionIds.join(' or ')}`,
    },
    'fixed-glyph': { allowed: isAvatarInitials, where: "an avatar's initials" },
    'tab-label': { allowed: isCappedTabLabel, where: `a label in a ${cfg.tabCellWidth} px cell of the tab bar (shell.tabbar, or DEV-01's tab bars)` },
  };

  for (const el of elements) {
    /** @type {string[]} */
    const tokens = [];
    for (const t of exemptTokens(el)) {
      const restricted = RESTRICTED_EXEMPTIONS[t];
      if (!KNOWN_EXEMPTIONS.includes(t)) {
        report(checks.unknownExemption, el, `unknown data-qa-exempt value "${t}"; allowed: ${KNOWN_EXEMPTIONS.join(', ')}`);
      } else if (restricted && !restricted.allowed(el)) {
        report(checks.unknownExemption, el, `data-qa-exempt "${t}" is only allowed on ${restricted.where}`);
      } else {
        exempt(t);
        tokens.push(t);
      }
    }
    const cs = getComputedStyle(el);
    const isSvg = el.tagName === 'svg';

    // 5. Spacing
    if (!tokens.includes('safe-area') && !tokens.includes('hairline')) {
      const hidden = insideSrOnly(el);
      for (const [prop, jsProp] of /** @type {[string,string][]} */ (SPACING_PROPS)) {
        if (tokens.includes('brand-position') && prop.startsWith('margin-')) continue;
        const raw = /** @type {any} */ (cs)[jsProp];
        if (raw === 'normal' || raw === 'auto') continue;
        const resolved = parseFloat(raw);
        if (!Number.isFinite(resolved) || onScale(resolved)) continue;
        const specified = specifiedValue(el, prop);
        if (specified !== null && Number.isNaN(specified)) continue;
        // ADR-222: counted once per element whose off-scale value is the hiding technique.
        if (hidden) {
          exempt('visually-hidden');
          break;
        }
        report(checks.offScaleSpacing, el, `${prop}: ${raw} is not on the spacing scale`);
      }
    }
    if (isSvg) continue;

    // 6. Colour
    const inQr = insideExempt(el, 'qr');
    if (!insideExempt(el, 'photo') && !(el.tagName === 'IMG')) {
      checkColour(el, 'background-color', cs.backgroundColor, inQr);
    }
    const isText = textBearing.has(el);
    if (isText && !isVisuallyHidden(el, cs)) checkColour(el, 'color', cs.color, inQr);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(/** @type {any} */ (cs)[`border${side}Width`]);
      const style = /** @type {any} */ (cs)[`border${side}Style`];
      if (width > 0 && style !== 'none' && style !== 'hidden') {
        checkColour(el, `border-${side.toLowerCase()}-color`, /** @type {any} */ (cs)[`border${side}Color`], inQr);
      }
    }

    // 7. Type scale
    if (isText && !isVisuallyHidden(el, cs)) {
      const size = parseFloat(cs.fontSize);
      const line = parseFloat(cs.lineHeight);
      // A fixed glyph keeps its scale-1 pair, exactly, whatever the font scale.
      const fixed = tokens.includes('fixed-glyph');
      // A capped tab label keeps the `web.tab` pair at the capped scale, and only that pair.
      const capped = tokens.includes('tab-label');
      const pairs = fixed ? cfg.unscaledTypePairs : capped ? cfg.tabLabelTypePairs : cfg.typePairs;
      const tolerance = fixed ? 0.01 : capped ? cfg.tabLabelTolerance : cfg.typeTolerance;
      const ok =
        Number.isFinite(line) &&
        pairs.some((t) => Math.abs(t.size - size) <= tolerance && Math.abs(t.lineHeight - line) <= tolerance);
      if (!ok) {
        const scale = fixed
          ? 'font scale 1 (fixed-glyph)'
          : capped
            ? `the tab label cap (tab-label, web.tab token at ${cfg.tabLabelTypePairs[0]?.size ?? '?'}/${cfg.tabLabelTypePairs[0]?.lineHeight ?? '?'})`
            : `font scale ${cfg.fontScale}`;
        report(checks.nonScaleFont, el, `${cs.fontSize}/${cs.lineHeight} is not a type-scale pair at ${scale}`);
      }
      const family = (cs.fontFamily.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
      if (!cfg.fontFamilies.includes(family)) report(checks.nonScaleFont, el, `font-family "${family}" is not a token font`);
    }

    // 8. Images
    const isImg = el.tagName === 'IMG';
    const hasBgImage = /url\(/.test(cs.backgroundImage);
    if ((isImg || hasBgImage) && !hasExplicitBox(el)) {
      report(checks.imageWithoutAspect, el, 'image has no explicit dimensions or aspect ratio');
    }
  }

  // ---- 10. Display-title lines (DQ-904, ADR-426 a): a line-capped role at full size over its line cap.
  /** @type {(el: Element) => {role: (typeof cfg.lineCapped)[number], size: number, line: number}|null} */
  const cappedRoleOf = (el) => {
    const cs = getComputedStyle(el);
    const family = (cs.fontFamily.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '');
    const size = parseFloat(cs.fontSize);
    const line = parseFloat(cs.lineHeight);
    if (!Number.isFinite(line)) return null;
    const near = (/** @type {{size:number,lineHeight:number}} */ p) => Math.abs(p.size - size) <= cfg.typeTolerance && Math.abs(p.lineHeight - line) <= cfg.typeTolerance;
    const role = cfg.lineCapped.find((r) => r.families.includes(family) && r.full.some(near));
    return role ? { role, size, line } : null;
  };
  const sameFace = (/** @type {CSSStyleDeclaration} */ a, /** @type {CSSStyleDeclaration} */ b) =>
    a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.lineHeight === b.lineHeight;
  const titleRange = document.createRange();
  for (const el of elements) {
    if (el.tagName.toLowerCase() === 'svg' || !normalise(el.textContent)) continue;
    const capped = cappedRoleOf(el);
    if (!capped) continue;
    const cs = getComputedStyle(el);
    // The outermost element of the title: a nested span of the same face and pair is part of its text.
    if (el.parentElement && sameFace(cs, getComputedStyle(el.parentElement))) continue;
    if (isVisuallyHidden(el, cs) || insideSrOnly(el) || insideMeasurementMirror(el)) continue;
    /** @type {number[]} */
    const middles = [];
    const texts = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue;
      titleRange.selectNodeContents(node);
      for (const r of titleRange.getClientRects()) if (r.width > 0 && r.height > 0) middles.push(r.top + r.height / 2);
    }
    middles.sort((a, b) => a - b);
    let lines = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (const middle of middles) {
      if (middle - last > capped.line / 2) {
        lines++;
        last = middle;
      }
    }
    if (lines <= capped.role.maxLines) continue;
    const shrink = capped.role.shrink[0];
    report(
      checks.displayTitleLines,
      el,
      `${capped.role.name} at its full size ${round(capped.size)}/${round(capped.line)} renders on ${lines} lines (at most ${capped.role.maxLines}); ` +
        `past that it shrinks${shrink ? ` to ${round(shrink.size)}/${round(shrink.lineHeight)}` : ''} (ADR-426 a)`,
    );
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    counts,
    violations,
    exemptions,
    droppedViolations,
    scanned: { elements: elements.length, interactive: interactive.length, textNodes: textNodes.length },
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{theme?:string,fontScale?:number,surface?:'member'|'admin'}} [opts] `surface` defaults to the page's URL: /admin is the admin
 * @returns {Promise<AuditReport>}
 */
export async function runDomAudit(page, opts = {}) {
  // The desktop type pairs apply from layout.breakpoints.desktop on (min-width media query, so the CSS viewport width).
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const cfg = auditConfig({ ...opts, viewportWidth });
  const admin = opts.surface ? opts.surface === 'admin' : isAdminUrl(page.url());
  const cappedScale = Math.min(cfg.fontScale, TAB_LABEL_CAP);
  const tabLabelTypePairs = auditConfig({ ...opts, viewportWidth, fontScale: cappedScale }).typePairs.filter((pair) => pair.name === 'web.tab');
  // Without the token every capped tab label would fail as off-scale, which hides the real cause.
  if (tabLabelTypePairs.length === 0) throw new Error('DOM audit: tokens.json has no typography.web.tab pair for the tab-label exemption');
  const result = await page.evaluate(auditInBrowser, {
    ...cfg,
    checks: CHECKS,
    maxPerCheck: MAX_PER_CHECK,
    midWordMax: MID_WORD_MAX,
    hyphenation: { ...HYPHENATION },
    unscaledTypePairs: auditConfig({ ...opts, viewportWidth, fontScale: 1 }).typePairs,
    avatarSizes: Object.values(tokens.size.avatar).map(Number),
    brandPositionIds: BRAND_POSITION_IDS,
    tabCellWidth: TAB_CELL_WIDTH,
    tabLabelTypePairs,
    tabLabelTolerance: cappedScale === 1 ? 0.01 : 0.5,
    adminTargets: admin ? { ...ADMIN_TARGETS } : null,
    frameColors: Object.fromEntries(THEMES.map((theme) => [theme, themeColors(theme)])),
    cover: { ...COVER },
  });
  return { url: page.url(), theme: cfg.theme, fontScale: cfg.fontScale, ...result };
}

/**
 * Throws with a readable list when the page has High violations.
 * @param {AuditReport} report
 */
export function assertNoHighViolations(report) {
  if (report.counts.High === 0) return;
  const lines = report.violations
    .filter((v) => v.severity === 'High')
    .map((v) => `  ${v.check}: ${v.element}: ${v.message}`);
  throw new Error(`DOM audit: ${report.counts.High} High violation(s) on ${report.url}\n${lines.join('\n')}`);
}
