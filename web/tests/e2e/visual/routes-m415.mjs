// Visual registry entries of M4.15 Platform (Phase 4, 09 §7.13, §8.13–§8.16). Same fields as the entries in routes.mjs, which
// merges this list. One file per lane part, so parallel workstreams never edit the same registry file.
//
// MEM-01 / SET-24 sit behind the flag `membership` (off everywhere, 09 §8.18): their cells force it with the non-production override
// `qaFlags=membership` (mobile/src/lib/qa.ts names it), and MEM-01-off shows what the address is while the flag is off (SYS-03).
// SET-01-install is the member web's install hint (over SET-01, a route outside the flagship set, so it stays a few cells) (09 §7.15), which an automated browser never gets on its own: `qaOpen=installHint`.

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

const FLAG_QA = 'Forced through qaFlags=membership: the flag is off on every environment until the client signs off perks and price (09 §16 #14).';

export const routesM415 = [
  {
    id: 'MEM-01',
    path: '/app/membership?qaFlags=membership',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'offline'],
    ready: loadedOr('[data-testid="MEM-01.content"]', 'MEM-01.root'),
    capture: 'expanded',
    notes: `${FLAG_QA} Mitgliedschaft (09 §7.13): a night photo fading into the Carbon stage (a brand stage in every theme), "Kommt bald", the plan in display.title, the candidate perks as list rows under a Beispiel badge, "Preis" without a figure, "Jederzeit kündbar", the purchase button disabled with "Bald verfügbar", AGB · Datenschutz. From 768 the photo takes 7 columns.`,
  },
  {
    id: 'MEM-01-off',
    path: '/app/membership',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SYS-03.root"]',
    notes: 'The flag off (as on every environment today): /membership is not there, the SYS-03 photo state.',
  },
  {
    id: 'SET-24',
    path: '/app/settings/membership?qaFlags=membership',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-24.content"]',
    capture: 'expanded',
    notes: `${FLAG_QA} The settings row "Mitgliedschaft" opens the same page as MEM-01.`,
  },
  {
    id: 'SET-01-install',
    path: '/app/settings?qaOpen=installHint',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="shell.installHint.dismiss"]',
    notes:
      'The install hint (09 §7.15) over SET-01, forced by qaOpen=installHint: "SPEED CLUB auf den Home-Bildschirm", one line, and on the iPhone cells Safari\'s three steps with the share glyph; a Chromium cell without the browser\'s install event shows the same steps. "Verstanden" closes it, once per browser.',
  },
];
