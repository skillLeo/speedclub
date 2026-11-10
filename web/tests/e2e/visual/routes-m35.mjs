// Visual registry entries of module M35 (Phase 3): ADM-28…38, brand, content and configuration. Same fields as the entries in
// routes.mjs, which merges this list. One file per module, so parallel workstreams never edit the same registry file.

/** `ready` of a page whose root carries data-testid and data-qa-state: the loaded part by default, the root in a forced state. */
const loadedOr = (/** @type {string} */ root, /** @type {string} */ loaded) =>
  `[data-qa-state="ready"][data-testid="${root}"] [data-testid="${loaded}"], [data-qa-state]:not([data-qa-state="ready"])[data-testid="${root}"]`;

const PAGE_STATES = ['default', 'loading', 'empty', 'error'];

// ADM-28: the Welcome hero of the seeded draft gets its contrast verdict 250 ms after the page (HeroSlot): until its text is in, the
// slot shows a skeleton line, and a capture could take either (visual run after b756c29: 3 cells verdict, the rest skeleton).
const brandReady = `[data-qa-state="ready"][data-testid="ADM-28"]:has([data-testid="ADM-28.hero.welcome.contrast"] p) [data-testid="ADM-28.logos"], [data-qa-state]:not([data-qa-state="ready"])[data-testid="ADM-28"]`;

export const routesM35 = [
  {
    id: 'ADM-28',
    path: '/admin/brand',
    phase: 3,
    auth: 'staff-content',
    // DQ-674: as the owner of the seeded draft (stage fixture draft-owner); ADM-28-foreign keeps the read-only view of another's draft.
    fixture: 'draft-owner',
    // BrandContentDemoSeeder uploads two heroes and an OG image (DQ-612), so `empty` (nothing uploaded, the bundled files apply) differs.
    states: PAGE_STATES,
    ready: brandReady,
    notes: 'Marke & Theme: draft bar (live version or the bundled settings), logo set on white/black grounds, the three hero slots with focal point and contrast verdict, OG default, the four checked accent sets, default theme. Empty = nothing uploaded yet.',
  },
  {
    id: 'ADM-28-foreign',
    path: '/admin/brand',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: brandReady,
    notes: 'DQ-674: the seeded draft of another content editor, read-only ("Entwurf v3 von …, du kannst ihn ansehen, aber nicht bearbeiten"): no upload, no focal point, no publish.',
  },
  {
    id: 'ADM-29',
    path: '/admin/content/home',
    phase: 3,
    auth: 'staff-content',
    states: PAGE_STATES,
    ready: loadedOr('ADM-29', 'ADM-29.featured'),
    notes: 'Startseite: featured builds in order with date range and live state, "x von höchstens 8 gleichzeitig live", the Discover collections with filter text, mode and active switch.',
  },
  {
    id: 'ADM-30',
    path: '/admin/content/announcements',
    phase: 3,
    auth: 'staff-content',
    // DQ-674: as the owner of the seeded draft (stage fixture draft-owner); ADM-30-foreign keeps the read-only view of another's draft.
    fixture: 'draft-owner',
    states: PAGE_STATES,
    ready: loadedOr('ADM-30', 'ADM-30.draft-bar'),
    notes: 'Ankündigungen: each banner as members see it with status, schedule, audience, closing and target.',
  },
  {
    id: 'ADM-30-foreign',
    path: '/admin/content/announcements',
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: loadedOr('ADM-30', 'ADM-30.draft-bar'),
    notes: 'DQ-674: the seeded draft of another content editor, read-only: the banners without editing or publishing.',
  },
  {
    id: 'ADM-31',
    path: '/admin/content/legal?document=terms&locale=de',
    phase: 3,
    auth: 'staff-content',
    states: PAGE_STATES,
    ready: loadedOr('ADM-31', 'ADM-31.versions'),
    notes: 'Rechtstexte: documents × language on the left, AGB · Deutsch with its versions; "Neuen Entwurf beginnen" (content editors draft, Owner/Admin publish).',
  },
  {
    id: 'ADM-32',
    path: '/admin/content/help',
    phase: 3,
    auth: 'staff-content',
    states: PAGE_STATES,
    ready: loadedOr('ADM-32', 'ADM-32.table'),
    notes: 'Hilfe: the help articles per language with category, order, state and actions.',
  },
  {
    id: 'ADM-33',
    path: '/admin/content/templates?template=mail.report_outcome&locale=de',
    phase: 3,
    auth: 'staff-content',
    states: PAGE_STATES,
    ready: loadedOr('ADM-33', 'ADM-33.editor'),
    notes: 'Vorlagen: mails and push texts on the left (fixed ones with a lock), "Ergebnis einer Meldung" with its editable fields, variables, the fixed redress lines and the preview with sample data.',
  },
  {
    id: 'ADM-34',
    volatile: true,
    path: '/admin/content/preview',
    phase: 3,
    auth: 'staff-content',
    states: ['default', 'loading', 'error'],
    // DQ-613: ready once the app inside both frames has rendered (Preview.vue sets data-frame-ready).
    ready: '[data-qa-state="ready"][data-testid="ADM-34"] [data-testid="ADM-34.frame.mobile"][data-frame-ready] ~ [data-testid="ADM-34.frame.desktop"][data-frame-ready], [data-qa-state]:not([data-qa-state="ready"])[data-testid="ADM-34"]',
    notes: 'Entwurfsvorschau: token line (whose drafts, valid until), page and theme switches, the phone frame at 1:1 and the 1280 frame at 75 %, theme passed as previewTheme with the token. Volatile: the frames load the live app.',
  },
  {
    id: 'ADM-35',
    path: '/admin/content/versions?key=branding',
    phase: 3,
    auth: 'staff-content',
    states: PAGE_STATES,
    ready: loadedOr('ADM-35', 'ADM-35.table'),
    notes: 'Versionsverlauf: key tabs, versions with status, time, person and reason; the chosen version against the one before it (DiffViewer); "Auf vN zurückrollen" on a superseded version.',
  },
  {
    id: 'ADM-36',
    path: '/admin/config/flags',
    phase: 3,
    auth: 'staff-admin',
    states: PAGE_STATES,
    ready: loadedOr('ADM-36', 'ADM-36.table'),
    notes: 'Feature-Flags: the AI note (no provider), every flag with state here, L/S/P per environment, rollout and change date.',
  },
  {
    id: 'ADM-37',
    path: '/admin/config/remote',
    phase: 3,
    auth: 'staff-admin',
    states: ['default', 'loading', 'error'],
    ready: loadedOr('ADM-37', 'ADM-37.versions'),
    notes: 'Remote-Konfiguration: min/latest version per platform with the latest production build, the force-update text DE/EN, maintenance with its text and the team bypass.',
  },
  {
    id: 'ADM-38',
    path: '/admin/config/releases',
    phase: 3,
    auth: 'staff-admin',
    states: PAGE_STATES,
    ready: '[data-testid="ADM-38"] [data-testid="ADM-38.table"]',
    notes: 'Release-Register: builds with version, build, platform, channel, short SHA-256, the note in one line (DQ-614), date; "Aus RELEASES.md übernehmen" and "Build eintragen".',
  },
  {
    id: 'ADM-28-hero',
    path: '/admin/brand',
    phase: 3,
    auth: 'staff-content',
    fixture: 'draft-owner',
    states: ['default'],
    ready: '[data-testid="ADM-28.hero.welcome.contrast"] p',
    notes: 'DQ-612: the content editor\'s draft with the dark demo photo in "Willkommen (App)": focal point, 9:16 crop and a passing contrast verdict with its ratios; the other slots show the bundled photos greyed.',
  },
  {
    id: 'ADM-28-hero-fails',
    path: '/admin/brand?dialog=hero-fails',
    phase: 3,
    auth: 'staff-content',
    fixture: 'draft-owner',
    states: ['default'],
    ready: '[data-testid="ADM-28.hero.welcome.contrast"] p',
    notes: 'DQ-612: the bright demo photo in "Willkommen (App)" (unsaved): the refusal verdict with its ratios before the draft is saved.',
  },
  ...[
    ['ADM-34-black', 'black', 'Schwarz'],
    ['ADM-34-light', 'light', 'Hell'],
  ].map(([id, theme, name]) => ({
    id,
    volatile: true,
    path: `/admin/content/preview?theme=${theme}`,
    phase: 3,
    auth: 'staff-content',
    states: ['default'],
    ready: '[data-testid="ADM-34.frame.mobile"][data-frame-ready] ~ [data-testid="ADM-34.frame.desktop"][data-frame-ready]',
    notes: `DQ-613: the preview in ${name}: both frames get previewTheme=${theme} with the preview token (the app honours it only with a valid token).`,
  })),
  {
    id: 'ADM-37-maintenance',
    path: '/admin/config/remote?dialog=maintenance',
    phase: 3,
    auth: 'staff-admin',
    states: ['default'],
    ready: '[data-testid="ADM-37.four-eyes"]',
    notes: 'DQ-628: maintenance switched on in the form (unsaved): "Wartungsmodus: An", the ApprovalNotice (switching on needs a second person).',
  },
  {
    id: 'ADM-38-notes',
    path: '/admin/config/releases?dialog=notes',
    phase: 3,
    auth: 'staff-admin',
    states: ['default'],
    ready: '[data-testid="ADM-38.notes-drawer"]',
    capture: /** @type {const} */ ('expanded'),
    notes: 'DQ-614: Notizen of the newest build, the full RELEASES.md entry rendered (code spans, no raw Markdown).',
  },
  .../** @type {Array<[string, string, string, string, string]>} */ ([
    ['ADM-28-picker', '/admin/brand?dialog=picker', 'staff-content', 'ADM-28.picker', 'Bild für „Willkommen (App)“: the uploaded heroes to choose from and the upload with its rules (type, minimum size, limit, metadata removed).'],
    ['ADM-28-publish', '/admin/brand?dialog=publish', 'staff-content', 'ADM-28.publish-dialog', 'Entwurf veröffentlichen? with the reason field.'],
    ['ADM-29-picker', '/admin/content/home?dialog=picker', 'staff-content', 'ADM-29.picker', 'Build hinzufügen: search over published builds with thumbnail and owner.'],
    ['ADM-29-collection', '/admin/content/home?dialog=collection', 'staff-content', 'ADM-29.collection-drawer', 'Sammlung bearbeiten: key, titles DE/EN, filter like Discover\'s address or hand-picked builds, sort, cover, active.'],
    ['ADM-30-edit', '/admin/content/announcements?dialog=edit', 'staff-content', 'ADM-30.drawer', 'The first banner of the seeded draft as its owner edits it (DQ-674, stage draft-owner): title/text DE/EN, button with target, audience, date range, closing, tone, disabled.'],
    ['ADM-30-edit-end', '/admin/content/announcements?dialog=edit&qaScroll=end', 'staff-content', 'ADM-30.drawer', 'DQ-623: the same drawer scrolled to its end (closing, tone).'],
    ['ADM-31-write', '/admin/content/legal?document=privacy&locale=de&dialog=write', 'staff-content', 'ADM-31.editor', 'Datenschutz draft: version, "Erfordert erneute Zustimmung" with its summary, Markdown with preview switch.'],
    ['ADM-31-publish', '/admin/content/legal?document=privacy&locale=de&dialog=publish', 'staff-admin', 'ADM-31.publish-dialog', 'Text veröffentlichen? with the reason (four-eyes wording when the draft asks for renewed consent).'],
    ['ADM-32-edit', '/admin/content/help?dialog=edit', 'staff-content', 'ADM-32.drawer', 'Artikel bearbeiten: key, language, title, category, order, Markdown with preview; the live note for a published article.'],
    ['ADM-32-edit-end', '/admin/content/help?dialog=edit&qaScroll=end', 'staff-content', 'ADM-32.drawer', 'DQ-623: the article drawer scrolled to its end.'],
    ['ADM-32-delete', '/admin/content/help?dialog=delete', 'staff-content', 'ADM-32.delete-dialog', 'Artikel löschen? with the reason.'],
    ['ADM-33-test', '/admin/content/templates?template=mail.report_outcome&locale=de&dialog=test', 'staff-content', 'ADM-33.test-dialog', 'Test an dich senden? to the signed-in staff member\'s own address.'],
    ['ADM-35-rollback', '/admin/content/versions?key=branding&version=1&dialog=rollback', 'staff-content', 'ADM-35.rollback-dialog', 'Auf v1 zurückrollen? on the superseded v1 (branding v2 from BrandContentDemoSeeder), with the reason.'],
    ['ADM-36-edit', '/admin/config/flags?dialog=edit', 'staff-admin', 'ADM-36.drawer', 'Flag bearbeiten (an AI flag): environments with this one marked, "Kein KI-Anbieter konfiguriert", team only, percentage, critical, reason.'],
    ['ADM-36-edit-end', '/admin/config/flags?dialog=edit&qaScroll=end', 'staff-admin', 'ADM-36.drawer', 'DQ-623: the flag drawer scrolled to its end (critical, reason).'],
    ['ADM-37-publish', '/admin/config/remote?dialog=publish', 'staff-admin', 'ADM-37.publish-dialog', 'Remote-Konfiguration veröffentlichen? with the reason.'],
    ['ADM-38-new', '/admin/config/releases?dialog=new', 'staff-admin', 'ADM-38.drawer', 'Build eintragen: version, build number, platform, channel, SHA-256, date, notes.'],
    ['ADM-38-new-end', '/admin/config/releases?dialog=new&qaScroll=end', 'staff-admin', 'ADM-38.drawer', 'DQ-623: the build drawer scrolled to its end (notes).'],
  ]).map(([id, path, auth, dialog, notes]) => ({
    id,
    path,
    phase: 3,
    auth,
    // DQ-674: upload, publish and the banner drawer are what the owner of the seeded draft does (stage fixture draft-owner).
    ...(/^ADM-(28|30)-/.test(id) ? { fixture: 'draft-owner' } : {}),
    // The collection and announcement drawers only change the draft form in the page (no request): nothing to fail.
    // DQ-623: the end-scrolled cells only show the lower half of a drawer already captured with its error.
    states: id === 'ADM-29-collection' || id.startsWith('ADM-30-edit') || id.endsWith('-end') ? ['default'] : ['default', 'error'],
    ready: `[data-testid="${dialog}"]`,
    // DQ-623: the whole overlay, its lower half included (DQ-556). A long drawer keeps its first screen (where its error shows) and
    // has an `-end` cell for the rest.
    capture: /** @type {'viewport' | 'expanded'} */ (['ADM-30-edit', 'ADM-32-edit', 'ADM-36-edit', 'ADM-38-new'].includes(id) || id.endsWith('-end') ? 'viewport' : 'expanded'),
    notes,
  })),
];
