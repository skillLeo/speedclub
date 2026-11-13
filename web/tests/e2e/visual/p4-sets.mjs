// Route sets of the Phase 4 visual tier (`--tier=p4`, docs/09_PREMIUM_2_0.md §14.1). The one place these lists live: later
// modules extend them here, the planner (p4.mjs) reads them, and every p4 run prints what is in them and what is not built yet.
import { isSpaRoute } from './matrix.mjs';

/**
 * 09 §7 and §9, the screens marked ★ (§9: WEB-03 Landing and WEB-01 the public vehicle page, the pages a scanned sticker opens).
 * A registry route belongs to the set when its id is one of these or a variant of one
 * (`<ID>-<variant>`: HOME-01-member, GAR-03-specs, VEH-01-report are the same screen in another situation). An id with no route in
 * the registry yet (or only a planned one) is printed as "not built yet" by every p4 run, never dropped silently.
 */
export const FLAGSHIP = [
  'AUTH-01',
  'ONB-01',
  'ONB-02',
  'ONB-03',
  'AUTH-02',
  'HOME-01',
  'VEH-01',
  'GAR-01',
  'GAR-03',
  'GAR-04',
  'QR-02',
  'PROF-01',
  'MSG-02',
  'EVT-02',
  'BIZ-01',
  // 09 §9
  'WEB-03',
  'WEB-01',
];

/**
 * Forms by rule: a member route (`/app…`) on an auth page, the add-vehicle wizard, a garage editor (`/app/garage/<id>/<section>`),
 * the profile editor or a settings subpage, whose states are the editor set: it lists `loading` and has nothing to be `empty`
 * (routes.mjs EDITOR_STATES). That keeps the settings menu (SET-01) and the lists among them (SET-06 sessions, SET-08 blocked,
 * SET-14 help, SET-16 reports) out, and the variants that list `default` only (SET-03-2fa).
 */
export const FORM_PATH =
  /^\/app\/(?:sign-in|sign-up|verify-email|forgot-password|reset-password|username|profile-setup|add-vehicle\/|garage\/[^/?]+\/|profile\/edit|settings\/)/;

/**
 * Forms the rule cannot see: AUTH-11 (the two-factor code form, whose forced states include `empty`) and the public Blade forms
 * WEB-05 (Konto löschen), WEB-09 (Melden) and WEB-10 (Kontakt).
 */
export const FORMS_EXPLICIT = ['AUTH-11', 'WEB-05', 'WEB-09', 'WEB-10'];

/**
 * 12 representative existing routes in English (09 §14.1), at iphone15pro and desktop1440, Carbon: auth, home, discover (2),
 * vehicle, garage (2: the list and the wizard), QR, messages, profile, settings and one public page. Exact ids, no variants.
 */
export const EN12 = ['AUTH-03', 'HOME-01', 'DISC-01', 'DISC-02', 'VEH-01', 'GAR-01', 'GAR-03', 'QR-02', 'MSG-02', 'PROF-01', 'SET-01', 'WEB-01'];

/** Key routes at the tablet (820×1180, the rail layout): the tab roots, the flagship detail screens and the wizard. Exact ids. */
export const TABLET = ['HOME-01', 'DISC-01', 'VEH-01', 'GAR-01', 'GAR-03', 'QR-02', 'MSG-01', 'MSG-02', 'PROF-01', 'SET-01'];

/**
 * Gallery specimens that prove the 2.0 foundation where product routes cannot show it (DQ-909): the capped type roles at 200 % and the
 * Schwarz colours. Each gets two cells beyond its own: iphone15pro Carbon DE at font scale 2 and iphone15pro Schwarz DE. Exact ids.
 */
export const SPECIMEN = ['DEV-01-typography', 'DEV-01-badges', 'DEV-01-selection', 'DEV-01-foundation'];

/** @typedef {import('./matrix.mjs').RouteDef} RouteDef */

/** @param {{id: string}} route */
export const isFlagship = (route) => FLAGSHIP.some((id) => route.id === id || route.id.startsWith(`${id}-`));

/** @param {RouteDef} route */
export const isForm = (route) =>
  FORMS_EXPLICIT.includes(route.id) ||
  (isSpaRoute(route) && FORM_PATH.test(route.path) && route.states.includes('loading') && !route.states.includes('empty'));

/** @param {{id: string}} route */
export const isEn12 = (route) => EN12.includes(route.id);

/** @param {{id: string}} route */
export const isTablet = (route) => TABLET.includes(route.id);

/** @param {{id: string}} route */
export const isSpecimen = (route) => SPECIMEN.includes(route.id);

/**
 * What a p4 run prints about its sets: the registry routes in each, and the ids of the explicit lists that have no built route.
 * @param {RouteDef[]} registry every route of the registry, planned ones included
 */
export function describeSets(registry) {
  const built = registry.filter((r) => r.status !== 'planned');
  const has = (/** @type {string} */ id) => built.some((r) => r.id === id);
  const flagshipNotBuilt = FLAGSHIP.filter((id) => !built.some((r) => isFlagship(r) && (r.id === id || r.id.startsWith(`${id}-`))));
  return {
    flagship: built.filter(isFlagship).map((r) => r.id),
    forms: built.filter(isForm).map((r) => r.id),
    en12: EN12.filter(has),
    tablet: TABLET.filter(has),
    specimen: SPECIMEN.filter(has),
    notBuiltYet: [...new Set([...flagshipNotBuilt, ...[...FORMS_EXPLICIT, ...EN12, ...TABLET, ...SPECIMEN].filter((id) => !has(id) && !FLAGSHIP.includes(id))])],
  };
}
