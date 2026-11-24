// Visual registry entries of M5.2 Navigation 3.0 (docs/10_CLIENT_ROUND_1.md §1, ADR-501). Same fields as the entries in routes.mjs,
// which merges this list. The other routes M5.2 changes (HOME-01, DISC-01, EVT-01, MSG-01: header Nachrichten, Entdecken segments, the
// pushed inbox) keep their entries and carry an "M5.2" note.
//
// Fix round (design QA 2026-11-15-m5.2, DQ-M52-09): SHOP-01 takes EN, the 820 tablet, Schwarz and 200 %; HOME-01-member-unread shows
// the "9+" pill; the guest inbox is routes.mjs MSG-01-guest (add it to the recapture). The 360 cells and SHOP-01/DISC-01 at 375
// need a p4 planner opt-in for the iphonese device and a 360 device (p4.mjs), which this registry cannot express.

/** The unread-count answer with more than nine unread messages, so the header pill says "9+" (10 §1). */
const MANY_UNREAD_MESSAGES = 12;

/** @param {import('./route-steps.mjs').RouteStepContext} ctx */
async function withManyUnreadMessages({ stage }) {
  await stage('**/api/v1/notifications/unread-count', {
    patch: (/** @type {{ data: Record<string, number> }} */ body) => ({ ...body, data: { ...body.data, messages: MANY_UNREAD_MESSAGES } }),
  });
}

/**
 * M5.5: with the flag `shop` on (local, staging) SHOP-01 shows the catalogue (routes-m55.mjs SHOP-01-*). These cells keep the M5.2 shell,
 * which is what the tab shows while the flag is off (ADR-519): app-config answers with `shop: false`.
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 */
async function withShopOff({ stage }) {
  await stage('**/api/v1/app-config', {
    patch: (/** @type {{ data?: { flags?: Record<string, boolean> } }} */ body) => {
      if (body.data) body.data.flags = { ...body.data.flags, shop: false };
      return body;
    },
  });
}

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM52 = [
  {
    id: 'SHOP-01',
    path: '/app/shop',
    phase: 3,
    auth: 'guest',
    // Nothing loads yet (the catalogue is M5.5's): no empty or error state of its own; offline is the tab root's banner.
    states: ['default', 'loading', 'offline'],
    ready: '[data-testid="SHOP-01.closed"], [data-qa-state]:not([data-qa-state="default"]) [data-testid="SHOP-01.root"]',
    capture: 'viewport',
    fs2: true,
    p4: { en: true, tablet: true },
    prepare: withShopOff,
    notes:
      'Flag `shop` off (staged, M5.5; ADR-519). Shop tab (10 §1, §3; ADR-502), the shell the tab keeps while the catalogue is off: large title Shop, an orange GT86 with a windscreen sticker at night 16:9 edge to edge on phones (radius 12 in the column from 768; a seed frame no demo member owns, DQ-M52-13), "Der Speedclub Shop zieht hier ein" (title.2), "Sticker, Kleidung und Accessoires. Bezahlt wird im Online-Shop, nie in der App." and one secondary M link "Zu deinen Stickern" (asks a guest to sign in). No sample product, no price, no count. The tab bar shows the bag icon selected. loading = the same geometry as the page (DQ-M52-07): two title lines and two body lines on a phone, one each from 768, then the 44 button block. offline = "Du bist offline. Produkte lädt der Shop, sobald du wieder online bist."',
  },
  {
    id: 'HOME-01-member-unread',
    path: '/app/',
    phase: 3,
    auth: 'member',
    states: ['default'],
    // The pill is in the header only below 768 (the rail and the sidebar list Nachrichten from there).
    viewports: [390],
    ready: '[data-testid="HOME-01.messages.badge"]',
    capture: 'viewport',
    prepare: withManyUnreadMessages,
    notes:
      'HOME-01 as lukas.sc with 12 unread messages (the unread count staged by the harness): the paper plane\'s pill says "9+" (tnum, label.badge), sits on the glyph\'s top-right corner with a ring in the header ground and grows rightwards, so the plane stays readable; the name is "Nachrichten, 9+ ungelesen" (DQ-M52-01). The bell next to it shows the 8 dot (DQ-M52-15). At 375 (iphonese) the three trailing actions SCAN, bell, Nachrichten still fit beside the wordmark.',
  },
];
