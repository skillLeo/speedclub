// Devices of the Phase 4 visual tier (docs/09_PREMIUM_2_0.md §14.1). Plain data, so the cell-name parsers (matrix.mjs,
// promote-baselines.mjs) can know them without loading Playwright. The engine settings (user agent, touch) come from the installed
// Playwright's device descriptor named here (p4.mjs p4ContextOptions); the viewport is always the one given here.
//
// - iphone15pro  WebKit, 393×852: the client's iPhone running the member web as a home-screen app. The descriptor's viewport
//                (393×659) is Safari with its toolbars; standalone, the page has the whole screen.
// - iphonese     WebKit, 375×667 (descriptor "iPhone SE (3rd gen)"; plain "iPhone SE" is the 320×568 first generation).
// - pixel8       Chromium, 412×915: the Pixel 8 descriptor's Android Chrome UA, isMobile, hasTouch, its screen as the viewport.
// - tablet       WebKit, 820×1180: iPad Air / iPad 10th gen CSS size. Every browser on iPadOS is WebKit, and the client's devices
//                are Apple, so the tablet is a WebKit iPad: the newest iPad descriptor ("iPad (gen 11)", iPadOS 18 UA), viewport
//                overridden, as no installed descriptor has 820×1180.
// - desktop1280  Chromium, 1280×800, and desktop1440 Chromium, 1440×900: the same browser context as the module and phase tiers
//                (no descriptor), so a p4 desktop cell is the picture those tiers take at that width.

/**
 * @typedef {object} P4Device
 * @property {string} id the cell-name part
 * @property {string} label
 * @property {'webkit'|'chromium'} engine
 * @property {string|null} descriptor Playwright device descriptor for user agent, isMobile and hasTouch; null = the desktop context
 * @property {{width:number,height:number}} viewport
 * @property {'phone'|'tablet'|'desktop'} kind
 */

/** @type {P4Device[]} in display and run order */
export const P4_DEVICES = [
  { id: 'iphone15pro', label: 'iPhone 15 Pro', engine: 'webkit', descriptor: 'iPhone 15 Pro', viewport: { width: 393, height: 852 }, kind: 'phone' },
  { id: 'iphonese', label: 'iPhone SE', engine: 'webkit', descriptor: 'iPhone SE (3rd gen)', viewport: { width: 375, height: 667 }, kind: 'phone' },
  { id: 'pixel8', label: 'Pixel 8', engine: 'chromium', descriptor: 'Pixel 8', viewport: { width: 412, height: 915 }, kind: 'phone' },
  { id: 'tablet', label: 'iPad 820', engine: 'webkit', descriptor: 'iPad (gen 11)', viewport: { width: 820, height: 1180 }, kind: 'tablet' },
  { id: 'desktop1280', label: 'Desktop 1280', engine: 'chromium', descriptor: null, viewport: { width: 1280, height: 800 }, kind: 'desktop' },
  { id: 'desktop1440', label: 'Desktop 1440', engine: 'chromium', descriptor: null, viewport: { width: 1440, height: 900 }, kind: 'desktop' },
];

export const P4_DEVICE_IDS = P4_DEVICES.map((d) => d.id);

/** @param {string} id */
export function p4Device(id) {
  const device = P4_DEVICES.find((d) => d.id === id);
  if (!device) throw new Error(`Unknown p4 device "${id}". Known: ${P4_DEVICE_IDS.join(', ')}`);
  return device;
}
