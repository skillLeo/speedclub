// Visual registry entries of M5.9d Supporting system, app part (10 §16.4, contract docs/reports/phase-5/m5.9d-contract.md §8), lane A.
// Same fields as the entries in routes.mjs, which merges this list. Lane B serves the reads after this module, so the cells answer them
// from the bundled, "Beispiel"-badged QA set through the non-production override `qaGift` (mobile/src/lib/qa.ts,
// mobile/src/features/gift/qaGift.ts): `sample` = level 4 "Parts Hunter", 4 of 9 badges from the seeded catalogue (2 hidden), Founding Member #0042 (another member #0117), today's
// Car of the Day (an R34 on a seed photo), five invite codes (2 redeemed); `unlock` / `stack` = one / three unseen badges (the toast);
// `owner` = the Car of the Day is the signed-in member's (story editor); `error` = every gift read fails. Nothing is sent from them.

/**
 * `ready` for a screen with data: in the default state the element that only loaded data renders, in a forced state the screen root.
 * @param {string} loaded selector
 * @param {string} root test ID
 */
const loadedOr = (loaded, root) =>
  `[data-qa-state="default"] ${loaded}, [data-qa-state]:not([data-qa-state="default"]) [data-testid="${root}"]`;

export const routesM59d = [
  {
    id: 'PROF-01-gift',
    path: '/app/profile?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="PROF-01.badges"]',
    capture: 'expanded',
    p4: { en: true, black: true },
    fs2: true,
    notes:
      'M5.9d PROF-01 for lukas.sc: "Lvl 4 · Parts Hunter" quiet beside @lukas.sc (a 44 target, opens the level sheet), "Founding Member #0042" (tnum, tertiary) under the meta line, then the badge row "Abzeichen 4 von 9" with the earned badges only (DQ-P5G-26): Crew Starter, Schrauberliste, Erster Build, Founding Member (medal), and "Alle" into BDG-01 for the locked and hidden ones. No modal, no counts of others.',
  },
  {
    id: 'PROF-01-level',
    path: '/app/profile?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('PROF-01.level').click();
    },
    ready: '[data-testid="PROF-01.levelSheet.never"]',
    capture: 'viewport',
    p4: { en: true },
    notes:
      'M5.9d level sheet (XP values in the trailing column even where a rule wraps, DQ-P5G-27): the ring (60 %) around "4" in hero.numeral.s, "Lvl 4 · Parts Hunter", "1.240 / 1.600 XP", "Noch 360 XP bis Lvl 5", "Heute: 40 von 200 XP" + the cap line, "Wie du XP sammelst" with the fixed rules (+50/+20/+15/+10/+100; forum and check-in rules hidden while their features are off) and "Für Likes, Reaktionen, viele Beiträge oder das Anmelden gibt es keine XP."',
  },
  {
    id: 'PROF-01-badge',
    path: '/app/profile?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('PROF-01.badge.founding-member').click();
    },
    ready: '[data-testid="PROF-01.badgeSheet.earned"]',
    capture: 'viewport',
    notes: 'M5.9d badge detail sheet: "Founding Member", tags Gold · Gründung, the seeded description, "Erhalten am 2. Oktober 2026".',
  },
  {
    id: 'PROF-02-gift',
    path: '/app/u/jann.ptrs?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="PROF-02.badges"]',
    capture: 'expanded',
    notes: 'M5.9d another member: "Lvl 6 · Familiar Face" as plain text, "Founding Member #0117" (never the signed-in profile\'s number), the badge row with earned badges only (no "???", no locked ones, no count).',
  },
  {
    id: 'BDG-01',
    path: '/app/profile/badges?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="BDG-01.rules"]', 'BDG-01.root'),
    capture: 'expanded',
    p4: { en: true },
    fs2: true,
    notes:
      'M5.9d Abzeichen (own): "4 von 9", the fixed-rules line, grouped lists by category (Garage, Mods, Spots, Sets, Sticker, Gründung, Community) with the seeded badges (Erster Build, Schrauberliste, Street Famous, Erstes Set, Sticker drauf, Founding Member, Crew Starter; two hidden with their hints) and medal / lock / "???" glyphs, descriptions or hints, earned dates (tnum). empty = three sample badges badged "Beispiel", "Noch keine Abzeichen", "Auto hinzufügen".',
  },
  {
    id: 'HOME-01-cotd',
    path: '/app/?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="HOME-01.cotd.card"]',
    capture: 'viewport',
    p4: { en: true, black: true },
    fs2: true,
    notes:
      'M5.9d Start lead "Car of the Day · 14. Nov." (tnum) over the 4:5 full-bleed R34 (seed photo, "Beispiel" badge, owner chip @nina.r34), the story line in quotes under it. One lead only: the curated lead gives way for the day; Build der Woche keeps its module slot.',
  },
  {
    id: 'HOME-01-cotd-owner',
    path: '/app/?qaGift=owner',
    phase: 3,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.getByTestId('HOME-01.cotd.edit').click();
    },
    ready: '[data-testid="HOME-01.cotd.editor.story"]',
    capture: 'viewport',
    notes: 'M5.9d the owner\'s story editor sheet: intro line, the field with the counter "84 / 140" (it grows with the line, at 200 % too, so the last word stays visible: DQ-P5G-28), "Speichern" in the sticky footer (off until the line changes).',
  },
  {
    id: 'HOME-01-badgeToast',
    path: '/app/?qaGift=stack',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="HOME-01.badgeToast"]',
    capture: 'viewport',
    notes: 'M5.9d the one unlock toast of an app start: "3 neue Abzeichen" with "Ansehen" (never a modal; no haptic on the web).',
  },
  {
    id: 'INV-01',
    path: '/app/settings/invites?qaGift=sample',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline', 'restricted'],
    ready: loadedOr('[data-testid="INV-01.summary"]', 'INV-01.root'),
    capture: 'expanded',
    p4: { en: true },
    notes:
      'M5.9d Freunde einladen: "Beispiel", intro, "Ihr bekommt beide das Abzeichen ‚Crew Starter‘.", "2 von 5 eingelöst" (tnum), five codes (check for redeemed with "Eingelöst von @tobi.e46" / "Eingelöst"; link glyph with share + copy for open ones). On desktop beside the settings pane with "Freunde einladen" selected.',
  },
  {
    id: 'SET-09-gift',
    path: '/app/settings/notifications?qaGift=sample&qaDex=sample',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-09.socialLimit"]',
    capture: 'expanded',
    notes: 'M5.9d SET-09 with the four gift categories Spots · Abzeichen · Car of the Day (two rows: others\' pick off, your own on) · Einladungen, each its own switch, all under one parent "Spots, Abzeichen, Car of the Day und Einladungen" (the name bound with no-break spaces, DQ-P5G-65) whose footer is the shared limit (one of these pushes a day, never 22–08, own Ruhezeiten on top; the owner\'s own Car of the Day push outside the daily limit but also never 22–08; DQ-P5G-32).',
  },
  {
    id: 'AUTH-12-invite',
    path: '/app/join/P3WZ6TDK?qaGift=sample',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-12.invite"]',
    capture: 'viewport',
    notes: 'M5.9d /join/{code} for a guest: AUTH-12 with the info notice "Du wurdest von @nina.r34 eingeladen." above the e-mail field.',
  },
  {
    id: 'VEH-07-gift',
    // CF-6 (40aef7b6) replaced M5.9d's line "Auf der Karte: Build Score …, Stufe … · QR-Code" with the customiser's "Auf der Karte"
    // chips, read from the build's page in the cache (ShareCardScreen useCachedVehicle): a cold /app/share-card/{id} link has no page
    // there and shows no chips, so the cell opens the card from VEH-01 as a member does (as routes-m59-ai.mjs openShareCard). The
    // score now comes from the public vehicle resource (`build_score`), not from useBuildScore, so qaScore no longer reaches this screen.
    path: '/app/v/nissan-skyline-gt-r-r34-5tf974vj?qaFlags=sig.share_cards',
    phase: 3,
    hostDependent: true,
    auth: 'member',
    states: ['default'],
    walk: async ({ page }) => {
      await page.locator('[data-testid="VEH-01.moreActions"]:visible').first().click();
      await page.locator('[data-testid="VEH-01.moreSheet.shareCard"]:visible').first().click();
      await page.locator('[data-testid="VEH-07.customise"]:visible').first().waitFor({ state: 'visible' });
      await page.mouse.move(0, 0);
    },
    // The stored card drawn, with the Build Score among the elements on it (selected, as on the stored card) and the QR code.
    ready:
      '[data-testid="VEH-07.root"]:has([data-testid="VEH-07.element.score"][aria-checked="true"]):has([data-testid="VEH-07.element.qr"][aria-checked="true"]) [data-testid="VEH-07.preview.image"]',
    capture: 'expanded',
    notes: 'M5.9d VEH-07 (since CF-6): the server card of lukas.sc\'s R34 with its Build Score and QR code, and under "Auf der Karte" the element chips Build Score · Dex-Nr. · Technik · @lukas.sc · QR-Code, all selected (what the M5.9d line "Auf der Karte: Build Score …, Stufe … · QR-Code" said before).',
  },
];
