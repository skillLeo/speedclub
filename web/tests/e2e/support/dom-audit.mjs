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
//      tab-label       the `tab` token's pair at font scale min(scale, 1.15) (ADR-145): only on a label inside the phone
//                      tab bar (data-testid shell.tabbar) whose role="tab" cell is exactly 72 wide (design-QA ruling, M2.8)
//  - A scroll region made focusable for keyboard scrolling (tabindex 0, no role, overflow auto/scroll) is no control
//    for overlap and touch target; counted as `focusable-scroller`.
//  - Overlap: an ancestor and its descendant (nested interactive is axe's job: nested-interactive);
//    content in a scroll container that passes under a fixed or sticky bar, as scrolling resolves it.
//  - Touch target: inline text links inside a sentence (WCAG 2.5.8 inline exception).
//  - Spacing: `auto` and percentage margins, because their computed px are layout results.
//  - Text clip: text entirely outside the clipping box (an off-canvas slide, not clipped text).
//  - Visually hidden (ADR-222): an element in the sr-only pattern (absolutely positioned, at most 1×1, clipped by clip, clip-path or
//    overflow) and everything inside it is free of the spacing and touch-target rules, counted as `visually-hidden`: its -1px margin
//    and 1×1 box are what hides it. A skip link (an a[href^="#"] in that pattern) is instead focused during the audit and measured
//    focused, where it must be visible and meet the target floor (counted as `skip-link-focused`); focus goes back afterwards.
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
  overlap: { id: 'overlap', severity: 'High' },
  touchTarget: { id: 'touch-target', severity: 'High' },
  missingLabel: { id: 'missing-label', severity: 'High' },
  offScaleSpacing: { id: 'off-scale-spacing', severity: 'Medium' },
  nonTokenColour: { id: 'non-token-colour', severity: 'Medium' },
  nonScaleFont: { id: 'non-scale-font', severity: 'Medium' },
  imageWithoutAspect: { id: 'image-without-aspect', severity: 'Medium' },
  unknownExemption: { id: 'unknown-exemption', severity: 'Medium' },
});

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
 * @property {{name:string,size:number,lineHeight:number}[]} unscaledTypePairs the type scale at font scale 1, for fixed-glyph
 * @property {number[]} avatarSizes
 * @property {string[]} brandPositionIds
 * @property {number} tabCellWidth width of the tab cell whose label may carry `tab-label`
 * @property {{name:string,size:number,lineHeight:number}[]} tabLabelTypePairs the `tab` pair at the capped font scale
 * @property {number} tabLabelTolerance
 * @property {{standalone:number,inRow:number,rowHeight:number}|null} adminTargets ADR-212 floors on /admin, else null (touchMin)
 * @property {Record<string,{general:{name:string,r:number,g:number,b:number,a:number}[],qr:{name:string,r:number,g:number,b:number,a:number}[]}>} frameColors
 *           the colour tokens of every theme, for an element inside a `data-theme` frame below <body>
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
  const parseCss = (/** @type {string} */ value) => {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
  };
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
    const frame = el.closest('body [data-theme]')?.getAttribute('data-theme') ?? null;
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
      // A capped tab label keeps the `tab` pair at the capped scale, and only that pair.
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
            ? `the tab label cap (tab-label, tab token at ${cfg.tabLabelTypePairs[0]?.size ?? '?'}/${cfg.tabLabelTypePairs[0]?.lineHeight ?? '?'})`
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
  const cfg = auditConfig(opts);
  const admin = opts.surface ? opts.surface === 'admin' : isAdminUrl(page.url());
  const cappedScale = Math.min(cfg.fontScale, TAB_LABEL_CAP);
  const result = await page.evaluate(auditInBrowser, {
    ...cfg,
    checks: CHECKS,
    maxPerCheck: MAX_PER_CHECK,
    unscaledTypePairs: auditConfig({ ...opts, fontScale: 1 }).typePairs,
    avatarSizes: Object.values(tokens.size.avatar).map(Number),
    brandPositionIds: BRAND_POSITION_IDS,
    tabCellWidth: TAB_CELL_WIDTH,
    tabLabelTypePairs: auditConfig({ ...opts, fontScale: cappedScale }).typePairs.filter((pair) => pair.name === 'tab'),
    tabLabelTolerance: cappedScale === 1 ? 0.01 : 0.5,
    adminTargets: admin ? { ...ADMIN_TARGETS } : null,
    frameColors: Object.fromEntries(THEMES.map((theme) => [theme, themeColors(theme)])),
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
