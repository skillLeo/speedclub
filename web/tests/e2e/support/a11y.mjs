// Accessibility helpers: axe (serious + critical fail), keyboard focus order, visible focus.
import { AxeBuilder } from '@axe-core/playwright';

const FAILING_IMPACTS = ['serious', 'critical'];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{include?:string[],exclude?:string[]}} [opts]
 * @returns {Promise<{failing:import('axe-core').Result[],minor:import('axe-core').Result[]}>}
 */
export async function runAxe(page, { include = [], exclude = [] } = {}) {
  let builder = new AxeBuilder({ page });
  for (const selector of include) builder = builder.include(selector);
  for (const selector of exclude) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  return {
    failing: violations.filter((v) => FAILING_IMPACTS.includes(v.impact ?? '')),
    minor: violations.filter((v) => !FAILING_IMPACTS.includes(v.impact ?? '')),
  };
}

/** @param {import('axe-core').Result[]} results */
export function formatAxe(results) {
  return results
    .map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
    .join('\n');
}

/**
 * Throws when axe finds serious or critical issues.
 * @param {import('@playwright/test').Page} page
 * @param {{include?:string[],exclude?:string[]}} [opts]
 */
export async function assertNoSeriousAxeViolations(page, opts) {
  const { failing } = await runAxe(page, opts);
  if (failing.length) throw new Error(`axe: ${failing.length} serious/critical violation(s)\n${formatAxe(failing)}`);
}

/**
 * Presses Tab repeatedly and records which element got focus. WebKit only tabs through links when
 * Alt is held, so use the "Tab" key on Chromium and pass `key: 'Alt+Tab'` on WebKit.
 * @param {import('@playwright/test').Page} page
 * @param {number} presses
 * @param {{key?:string}} [opts]
 * @returns {Promise<string[]>} data-testid, else "tag: name", of each focused element
 */
export async function recordFocusOrder(page, presses, { key = 'Tab' } = {}) {
  const order = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'body';
        const id = el.getAttribute('data-testid');
        if (id) return id;
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
        return `${el.tagName.toLowerCase()}: ${name}`;
      }),
    );
  }
  return order;
}

/**
 * Measures the focus indicator of the currently focused element: an outline, or a box-shadow or
 * border that was not there before focus. Design system 5: ring 2 px + 2 px offset in focus.ring.
 * The app's pressables keep focus on the target and draw the ring on the shaped visual inside it
 * (mobile/src/ui/PressableScale.tsx), so an outline that appears on a descendant counts too;
 * `ringOn` says where it was found.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {{key?:string,maxTabs?:number}} [opts]
 * @returns {Promise<{focused:boolean,visible:boolean,outlineWidth:number,outlineOffset:number,outlineColor:string,changedProps:string[],ringOn:'self'|'descendant'|null}>}
 */
export async function measureKeyboardFocus(page, selector, { key = 'Tab', maxTabs = 30 } = {}) {
  const props = /** @type {const} */ (['boxShadow', 'borderTopColor', 'borderTopWidth', 'backgroundColor']);
  const target = page.locator(selector).first();
  const before = await target.evaluate(
    (el, keys) => keys.map((k) => getComputedStyle(el)[/** @type {any} */ (k)]),
    /** @type {readonly string[]} */ (props),
  );
  const outlinedBefore = await target.evaluate((el) =>
    [...el.querySelectorAll('*')].map((d) => {
      const cs = getComputedStyle(d);
      return cs.outlineStyle !== 'none' && (parseFloat(cs.outlineWidth) || 0) > 0;
    }),
  );
  await page.evaluate(() => {
    /** @type {HTMLElement|null} */ (document.activeElement)?.blur();
  });
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement)) {
      // The ring follows a state update of the app, a frame after the focus event.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
      const now = await target.evaluate(
        (el, { keys, outlined }) => {
          const outline = (/** @type {Element} */ node) => {
            const cs = getComputedStyle(node);
            return {
              style: cs.outlineStyle,
              width: parseFloat(cs.outlineWidth) || 0,
              offset: parseFloat(cs.outlineOffset) || 0,
              color: cs.outlineColor,
            };
          };
          const self = outline(el);
          const descendant = [...el.querySelectorAll('*')]
            .map((d, n) => ({ ring: outline(d), had: outlined[n] ?? false }))
            .find(({ ring, had }) => !had && ring.style !== 'none' && ring.width > 0);
          return {
            values: keys.map((k) => getComputedStyle(el)[/** @type {any} */ (k)]),
            self,
            descendant: descendant?.ring ?? null,
          };
        },
        { keys: /** @type {readonly string[]} */ (props), outlined: outlinedBefore },
      );
      const changedProps = props.filter((_, n) => now.values[n] !== before[n]);
      const selfRing = now.self.style !== 'none' && now.self.width > 0;
      const ring = selfRing ? now.self : now.descendant;
      return {
        focused: true,
        visible: ring !== null || changedProps.length > 0,
        outlineWidth: ring ? ring.width : 0,
        outlineOffset: ring ? ring.offset : now.self.offset,
        outlineColor: ring ? ring.color : now.self.color,
        changedProps: [...changedProps],
        ringOn: selfRing ? 'self' : ring ? 'descendant' : null,
      };
    }
  }
  return { focused: false, visible: false, outlineWidth: 0, outlineOffset: 0, outlineColor: '', changedProps: [], ringOn: null };
}
