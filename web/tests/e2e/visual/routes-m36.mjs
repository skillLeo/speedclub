// Visual registry entries of module M36 (Phase 3). Same fields as the entries in routes.mjs, which merges this list. One file
// per module, so parallel workstreams never edit the same registry file.
//
// Data: the staff list shows the StaffSeeder demo accounts and the e2e staff fixtures; ADM-40 is "Demo Support" (id 4 on a fresh install,
// "Demo Admin" is 2). ADM-41, ADM-45/46 and ADM-49 show their rows once DemoSeeder calls TeamPrivacyDemoSeeder (GDPR requests with fixed
// ids, the role "Community-Team", one failed job); without it they show their real zero states and ADM-46 answers 404.
// ADM-39 shows the seeded team only (`filter[q]=@speedclub.test`): the e2e staff fixtures are new rows with new sign-in times on every
// run, so with them in the list no picture would match the one before; the Owner count above the filters stays global ("Owner: 3 · höchstens 3":
// the seeded Owner plus the two Owner fixtures, ADR-237). ADM-40 is a seeded account the flows never touch (A4 changes fixtures only).
// ADM-F1/F2 are behind premium.enabled (off by default, 404 by design, proved in Pest): their cells name the stage fixture `premium`,
// which switches the flag on for their capture only (support/stage-fixtures.mjs). No plan or entitlement is seeded, so their default
// is the first-use empty state; the drawers are photographed as overlays. The invite page (no register number of its own) is ADM-39-accept.

const ACCESS_REQUEST = '01m6c0r3q0a5k0000000000001';
/** ADM-39's filter to the seeded team (StaffSeeder's `…@speedclub.test`); the fixtures live under `@staff.e2e.speedclub.test`. */
const SEEDED_TEAM = 'filter[q]=@speedclub.test';

/** @param {string} id @param {string} path @param {string} auth @param {string} dialog @param {string} notes */
const overlay = (id, path, auth, dialog, notes) => ({
  id,
  path,
  phase: 3,
  auth,
  states: ['default', 'error'],
  ready: `[data-testid="${dialog}"]`,
  // Expanded: a drawer's lower half (four-eyes notice, reason) is on the picture too (DQ-556 class).
  capture: /** @type {const} */ ('expanded'),
  notes,
});

export const routesM36 = [
  {
    id: 'ADM-39',
    path: `/admin/team?${SEEDED_TEAM}`,
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-39"] [data-testid="ADM-39.table"]',
    notes: 'Team, filtered to the seeded accounts (Name oder E-Mail "@speedclub.test", 6 Einträge): name with address, roles, status, two-factor, last sign-in ("Noch nie"); Owner count "Owner: 3 · höchstens 3" (global); Einladen.',
  },
  overlay('ADM-39-invite', `/admin/team?${SEEDED_TEAM}&dialog=invite`, 'staff-owner', 'ADM-39.invite-drawer', 'Einladen: name, address, roles with descriptions and the four-eyes mark, Admin chosen → ApprovalNotice and the required reason.'),
  {
    id: 'ADM-40',
    path: '/admin/team/4',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-40-page"]',
    notes: 'Demo Support: roles, the permissions they carry grouped by area; actions Rollen ändern, Deaktivieren (red text, secondary); activity timeline.',
  },
  overlay('ADM-40-roles', '/admin/team/4?dialog=roles', 'staff-owner', 'ADM-40.roles-drawer', 'Rollen ändern: roles with one-line descriptions, Admin added → the atom diff one permission per line by area ("+" in the success tone; "Keine Rechte entfallen"), DQ-633/634.'),
  // DQ-623: the same drawer scrolled to its end (the four-eyes reasons, the ApprovalNotice and the reason field).
  // DQ-676: at the real viewport, scrolled by the kit Drawer (qaScroll=end); expanded it never scrolls and equals ADM-40-roles.
  { ...overlay('ADM-40-roles-end', '/admin/team/4?dialog=roles&qaScroll=end', 'staff-owner', 'ADM-40.roles-drawer', 'Rollen ändern scrolled to its end: four-eyes reasons, ApprovalNotice, reason, "Freigabe anfragen".'), states: ['default'], capture: /** @type {const} */ ('viewport') },
  overlay('ADM-40-deactivate', '/admin/team/2?dialog=deactivate', 'staff-owner', 'ADM-40.deactivate-dialog', 'Deactivating an Admin: four-eyes notice, reason.'),
  overlay('ADM-40-reset-2fa', '/admin/team/4?dialog=reset-2fa', 'staff-owner', 'ADM-40.reset-2fa-dialog', 'Zwei-Faktor zurücksetzen (Owner only): four-eyes, reason.'),
  {
    id: 'ADM-41',
    path: '/admin/team/roles',
    phase: 3,
    auth: 'staff-owner',
    // No "empty": the six base roles are always there; the zero of custom roles is part of the default picture.
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-41"] [data-testid="ADM-41.table"], [data-testid="ADM-41"] [data-testid="ADM-41.error"], [data-testid="ADM-41"] [data-testid="ADM-41.loading"]',
    notes: 'Roles: base roles (Owner/Admin "hat alle Rechte"), custom role with description, counts of permissions and people; edit/delete icon buttons.',
  },
  overlay('ADM-41-create', '/admin/team/roles?dialog=create', 'staff-owner', 'ADM-41.drawer', 'Rolle anlegen: name, description, permissions grouped by area with the four-eyes mark.'),
  {
    id: 'ADM-42',
    path: '/admin/team/permissions',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-42"] [data-testid="ADM-42.matrix"], [data-testid="ADM-42"] [data-testid="ADM-42.error"], [data-testid="ADM-42"] [data-testid="ADM-42.loading"]',
    notes: 'Role × permission grid: grouped rows, the header sticks under the top bar on page scroll (DQ-615; the 7 roles fit at 1280, no sideways scroll), Owner/Admin always checked (disabled), sensitive permissions marked; "Keine Änderung".',
  },
  overlay('ADM-42-diff', '/admin/team/permissions?dialog=diff', 'staff-owner', 'ADM-42.diff-dialog', 'Diff before saving: Support + Vier-Augen-Anfragen freigeben, Analyse − Meldungen ansehen, people affected, four-eyes notice, reason.'),
  {
    id: 'ADM-45',
    // ADR-256 (DQ-688): "In der App selbst erledigt" lists the members' own exports and deletions from the audit log, and the e2e run
    // adds its own with its own times. The log is append-only, so they cannot be taken out again.
    volatile: true,
    path: '/admin/privacy/requests',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-45"] [data-testid="ADM-45.table"]',
    notes: 'GDPR requests, the open ones first by due date, completed below (DQ-636): type + DS number + article, requester (masked address), received, due (≤ 7 days amber, overdue red, extension on its own line; the server reads the deadlines and counts with ?qaNow, DQ-617), status, assignee, all six columns at 1280 (DQ-616); self-service rows below.',
  },
  { ...overlay('ADM-45-create', '/admin/privacy/requests?dialog=create', 'staff-owner', 'ADM-45.create-drawer', 'Anfrage erfassen: Auskunft for @lukas.sc, source, language, received date, request text.'), volatile: true, liveChrome: true },
  {
    id: 'ADM-46',
    path: `/admin/privacy/requests/${ACCESS_REQUEST}`,
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-46-page"]',
    // DQ-639: opening the request writes `privacy.request_viewed`, so the activity column grows with every capture ("· 2×", "· 3×").
    volatile: true,
    notes: 'Auskunft of lukas.sc (TeamPrivacyDemoSeeder): requester, request text, deadline 04.11.2026 "noch 2 Tage" in amber (the server reads it with ?qaNow, DQ-617), assignee and status; Export senden, Frist verlängern.',
  },
  // A tab switch has no request of its own to fail, so these two have no error cell (DQ-657).
  { ...overlay('ADM-46-reply', `/admin/privacy/requests/${ACCESS_REQUEST}?dialog=reply`, 'staff-owner', 'ADM-46.reply', 'Antworten tab: "Geht an l•••@…" (the account address, masked), template, language, what the template says, own paragraph.'), states: ['default'], volatile: true },
  { ...overlay('ADM-46-complete', `/admin/privacy/requests/${ACCESS_REQUEST}?dialog=complete`, 'staff-owner', 'ADM-46.complete', 'Abschluss tab: outcome, note, evidence file.'), states: ['default'], volatile: true },
  { ...overlay('ADM-46-extend', `/admin/privacy/requests/${ACCESS_REQUEST}?dialog=extend`, 'staff-owner', 'ADM-46.extend-dialog', 'Frist verlängern: the new date 04.01.2027 (server-computed), reason.'), volatile: true, liveChrome: true },
  {
    id: 'ADM-47',
    path: '/admin/privacy/retention',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-47"] [data-testid="ADM-47.editable"], [data-testid="ADM-47"] [data-testid="ADM-47.error"]',
    notes: 'Adjustable periods with the legal note per row, bounds and default; fixed periods read-only with a lock.',
  },
  overlay('ADM-47-save', '/admin/privacy/retention?dialog=save', 'staff-owner', 'ADM-47.confirm', 'Fristen speichern: the change (Support-Tickets 24 → 6 Monate), reason.'),
  {
    id: 'ADM-48',
    volatile: true,
    // ADR-257: loading and error keep the header with the last run's time.
    liveChrome: true,
    // A fresh seed has no health run (no cron locally): its cells get one run of the checks (stage fixture, visual run 3).
    fixture: 'health-run',
    path: '/admin/system/health',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-48"] [data-testid="ADM-48.checks"], [data-testid="ADM-48"] [data-testid="ADM-48.empty"], [data-testid="ADM-48"] [data-testid="ADM-48.error"], [data-testid="ADM-48"] [data-testid="ADM-48.loading"]',
    notes: 'Health: the last run with its time, problems first; or "Noch keine Prüfung gelaufen" with Jetzt prüfen.',
  },
  {
    id: 'ADM-49',
    volatile: true,
    // ADR-257: the forced states keep the header with the queue's live counts ("Wartend …").
    liveChrome: true,
    path: '/admin/system/jobs',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-49"][data-qa-state]',
    notes: 'Jobs: failed (class, queue, error class, time; select, Erneut versuchen, Verwerfen) and waiting; scheduler heartbeat. Never a payload.',
  },
  {
    id: 'ADM-50',
    path: '/admin/system/integrations',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-50"] [data-testid="ADM-50.list"], [data-testid="ADM-50"] [data-testid^="ADM-50.error"]',
    notes: 'Integrations: set up or not, driver/provider; test buttons; push disabled with its reason. No values.',
  },
  {
    id: 'ADM-51',
    volatile: true,
    path: '/admin/account',
    phase: 3,
    auth: 'staff-support',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-51"][data-qa-state]',
    notes: 'My account: profile, password change, two-factor with Authenticator wechseln, recovery codes behind a code, sessions (volatile: last-active times).',
  },
  {
    id: 'ADM-51-rotation',
    volatile: true,
    path: '/admin/account?qaStep=rotation',
    phase: 3,
    auth: 'staff-support',
    states: ['default'],
    ready: '[data-testid="ADM-51.rotation.qr"]',
    notes: 'Rotation step 2 with a made-up sample key: QR, key in two lines, expiry, code of the new app.',
  },
  {
    id: 'ADM-51-recovery',
    volatile: true,
    path: '/admin/account?qaStep=recovery',
    phase: 3,
    auth: 'staff-support',
    states: ['default'],
    ready: '[data-testid="ADM-51.recovery.codes"]',
    notes: 'Recovery codes shown after a code (made-up sample codes): two columns, save as file, hide.',
  },
  {
    id: 'ADM-52',
    path: '/admin/settings',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-52"] [data-testid="ADM-52.group.company"], [data-testid="ADM-52"] [data-testid="ADM-52.error"], [data-testid="ADM-52"] [data-testid="ADM-52.loading"]',
    notes: 'Org settings: four groups, each field with the [[…]] placeholder it fills; missing count; Owner edits.',
  },
  {
    id: 'ADM-52-admin',
    path: '/admin/settings',
    phase: 3,
    auth: 'staff-admin',
    states: ['default'],
    ready: '[data-testid="ADM-52"] [data-testid="ADM-52.view-only"]',
    notes: 'As an Admin: read-only with "Nur ein Owner ändert die Angaben".',
  },
  overlay('ADM-52-save', '/admin/settings?dialog=save', 'staff-owner', 'ADM-52.confirm', 'Angaben speichern: reason.'),
  {
    id: 'ADM-F1',
    fixture: 'premium',
    path: '/admin/memberships/plans',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-F1"][data-qa-state]',
    notes: 'Mitgliedschaften · Pläne behind premium.enabled: no plan yet → the first-use state with Plan anlegen; the nav shows the Mitgliedschaften group.',
  },
  { ...overlay('ADM-F1-create', '/admin/memberships/plans?dialog=create', 'staff-owner', 'ADM-F1.drawer', 'Plan anlegen: key, name DE/EN, features DE/EN (one per line), active.'), fixture: 'premium' },
  {
    id: 'ADM-F2',
    fixture: 'premium',
    path: '/admin/memberships/entitlements',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'error'],
    ready: '[data-testid="ADM-F2"][data-qa-state]',
    notes: 'Freischaltungen behind premium.enabled: none yet → the first-use state; Freischalten disabled while there is no active plan.',
  },
  // No plan is seeded, so the drawer is the designed first step without a submit: there is no request that could fail (no error cell).
  { ...overlay('ADM-F2-grant', '/admin/memberships/entitlements?dialog=grant', 'staff-owner', 'ADM-F2.drawer', 'Freischalten with no active plan: the designed first step "Noch kein aktiver Plan" with Zu den Plänen, no submit (A3/A4 follow-up).'), states: ['default'], fixture: 'premium' },
  {
    id: 'ADM-39-accept',
    path: '/admin/invite',
    phase: 3,
    auth: 'staff-guest',
    states: ['default', 'loading'],
    ready: '[data-testid="ADM-INVITE"]',
    notes: 'Invite page opened without the link fragment: "Dieser Link ist unvollständig". The form itself needs a real token (Pest).',
  },
];
