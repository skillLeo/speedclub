// Visual registry entries of DQ-1213 (M4.18 gate, docs/reports/phase-4/design-qa-m4.18-gate.md): the member and admin screens the p4
// matrix had no cells for. Same fields as the entries in routes.mjs, which merges this list.
//
// Most of these screens hold state that no URL can set, so their cells reach it the way flows/m46-shots.spec.ts does, through the
// route steps of run.mjs (route-steps.mjs): `prepare` stages API answers before the page loads, `walk` taps and types after it loaded.
// Every staged answer is fictional QA data and ends with its cell; nothing here writes to the database except AUTH-09b's fixture member
// (support/auth.mjs member-finish) and ADM-61-open's audit row (opening a mail is audited by design).
// - AUTH-13 keeps its e-mail attempt in the app's memory only (features/auth/emailAttempt.ts): the cell starts on AUTH-12 and sends the
//   address; POST auth/email/start is staged (no mail goes out, no limiter fills). Wrong, expired and locked are the server's answers to
//   POST auth/email/verify, staged as m46 does (expired comes after 10 minutes, the lock after 10 wrong codes).
// - AUTH-16 needs an Apple or Google sign-in (both off until OA-38, and their SDKs are third parties the runner blocks). Its link step
//   (features/auth/linkStep.ts) is the `link_required` answer of a sign-in, so the cell stages that answer on the e-mail code step:
//   the same answer routing (useAnswerRouting) holds it and opens /auth/link.
// - AUTH-17 is /auth/secure: with the token of a login alert (`#t=`), without one (invalid) and after "Konto jetzt sichern" (staged
//   POST auth/secure-account: the real one ends every session of the account).
// - SET-19, REAUTH: lukas.sc with two passkeys (GET me/passkeys staged); the menu, the rename sheet and the remove dialog are taps, and
//   the reauth sheet is the server's 403 `reauthentication_required` to DELETE me/passkeys/{id} (staged; nothing is removed).
// - SET-21: lukas.sc's real activity is a wall of the harness's own sign-ins, so GET me/security-events is staged with a fixed week.
// - SYS-01/02 open only from app-config (a direct load is sent home once app-config answers): SYS-02 with app-config's maintenance on
//   (the server's answer, patched), SYS-01 on the member web only while app-config does not answer (the web never needs an update),
//   as flows/f-signature.spec.ts photographs them.
// Countdowns ("Neuen Code in 0:28", "Wieder möglich in 13:58") tick on real intervals; a cell waits for one fixed value and stops the
// page's intervals at that frame (recordIntervals, freezeAt), so every cell shows the same text. The page is reloaded for the next cell.

const API = (/** @type {string} */ path) => new RegExp(`/api/v1/${path}(?:\\?.*)?$`);
const tid = (/** @type {string} */ id) => `[data-testid="${id}"]`;
/** @param {import('@playwright/test').Page} page @param {string} id */
const visible = (page, id) => page.locator(`${tid(id)}:visible`).first();

/** No hover on whatever lies under the last tap (DQ-1001). */
const parkMouse = (/** @type {import('@playwright/test').Page} */ page) => page.mouse.move(0, 0);

/**
 * From now on the page's intervals are recorded (window.__qaIntervals), so freezeAt can stop the countdowns and nothing else. Call it
 * before the tap that starts a countdown. Only the main world's setInterval is wrapped: Playwright's own timers are never touched (a
 * first version cleared every timer id of the page and hung the cell in its own wait).
 * @param {import('@playwright/test').Page} page
 */
async function recordIntervals(page) {
  await page.evaluate(() => {
    const w = /** @type {Window & {__qaIntervals?: number[]}} */ (window);
    if (w.__qaIntervals) return;
    const ids = /** @type {number[]} */ ([]);
    w.__qaIntervals = ids;
    const original = window.setInterval.bind(window);
    window.setInterval = /** @type {typeof window.setInterval} */ (
      (/** @type {TimerHandler} */ handler, /** @type {number|undefined} */ ms, /** @type {any[]} */ ...rest) => {
        const id = original(handler, ms, ...rest);
        ids.push(id);
        return id;
      }
    );
  });
}

/**
 * Waits until the visible element `testId` shows `text`, and in that same frame stops the intervals recorded since recordIntervals, so
 * a countdown stays at `text` for the audit and the picture. The next cell loads the page anew.
 * @param {import('@playwright/test').Page} page
 * @param {string} testId
 * @param {string} text
 */
async function freezeAt(page, testId, text) {
  await page.waitForFunction(
    ({ selector, wanted }) => {
      const element = [...document.querySelectorAll(selector)].find((e) => e.checkVisibility());
      if (!element || !(element.textContent ?? '').includes(wanted)) return false;
      const ids = /** @type {Window & {__qaIntervals?: number[]}} */ (window).__qaIntervals ?? [];
      for (const id of ids) clearInterval(id);
      return true;
    },
    { selector: tid(testId), wanted: text },
    { polling: 'raf', timeout: 20_000 },
  );
}

// -- Fictional QA data (never sent anywhere: every request that carries it is staged)

const EMAIL = 'lena.hoffmann@gmail.com';
const ATTEMPT = '7d1e4c0a-3b52-4f7e-9a61-2c8d5e0f4b19';
const CODE = '482913';
/** The shape of a login alert's "Das war ich nicht" token (api/queries/accountSecurity.ts SECURE_TOKEN_SHAPE). */
const SECURE_TOKEN = '01M7QAVISUAL0000000SECURE1.qa-visual-matrix-proof-0001';
const START = { method: 'POST', status: 202, body: { data: { attempt_id: ATTEMPT, resend_after: 30 } } };
const WRONG_CODE = {
  message: 'Dieser Code ist ungültig oder abgelaufen. Prüf ihn oder fordere einen neuen an.',
  errors: { code: ['Dieser Code ist ungültig oder abgelaufen. Prüf ihn oder fordere einen neuen an.'] },
  code: 'invalid_code',
  attempts_left: 4,
};

/**
 * From AUTH-12 to AUTH-13 with the attempt held, the resend countdown at "0:25".
 * @param {import('./route-steps.mjs').RouteStepContext} ctx
 * @param {{freeze?: boolean}} [o]
 */
async function toCode({ page, stage }, { freeze = true } = {}) {
  await stage(API('auth/email/start'), START);
  await recordIntervals(page);
  await visible(page, 'AUTH-12.email').fill(EMAIL);
  await visible(page, 'AUTH-12.cta.primary').click();
  await visible(page, 'AUTH-13.code').waitFor();
  if (freeze) await freezeAt(page, 'AUTH-13.resend', '0:25');
}

/**
 * AUTH-13 with a code typed and the server's answer to it.
 * @param {import('./route-steps.mjs').StagedAnswer} answer
 * @param {string} shows the test ID that proves the answer arrived
 * @param {{testId: string, text: string}|null} frozen the countdown to stop and its text, or null when none is left
 */
const codeAnswered =
  (answer, shows, frozen) => /** @param {import('./route-steps.mjs').RouteStepContext} ctx */ async (ctx) => {
    await toCode(ctx, { freeze: false });
    await ctx.stage(API('auth/email/verify'), { method: 'POST', ...answer });
    await visible(ctx.page, 'AUTH-13.code').fill(CODE);
    await visible(ctx.page, shows).waitFor();
    if (frozen) await freezeAt(ctx.page, frozen.testId, frozen.text);
    await parkMouse(ctx.page);
  };

/** @param {import('./route-steps.mjs').RouteStepContext} ctx */
async function toLink(ctx) {
  await toCode(ctx, { freeze: false });
  await ctx.stage(API('auth/email/verify'), {
    method: 'POST',
    status: 202,
    body: { data: { link_required: true, provider: 'google', attempt_id: '01m7qavisual0000000link001', email_hint: 'l•••@gmail.com', resend_after: 60 } },
  });
  await visible(ctx.page, 'AUTH-13.code').fill(CODE);
  await visible(ctx.page, 'AUTH-16.code').waitFor();
}

// SET-19: two passkeys of lukas.sc, created and last used before the fixed clock (QA_NOW 2026-11-02).
const PASSKEY_IPHONE = '01m7qavisual00000passkey01';
const PASSKEYS = {
  data: [
    {
      id: PASSKEY_IPHONE,
      name: 'iPhone 15 Pro',
      provider: 'iCloud-Schlüsselbund',
      provider_icon: 'apple',
      synced: true,
      last_used_at: '2026-11-01T18:42:00Z',
      created_at: '2026-10-14T09:15:00Z',
    },
    {
      id: '01m7qavisual00000passkey02',
      name: 'Pixel 8',
      provider: 'Google Passwortmanager',
      provider_icon: 'google',
      synced: true,
      last_used_at: null,
      created_at: '2026-10-27T20:03:00Z',
    },
  ],
};
const REAUTH_REQUIRED = {
  message: 'Bestätige kurz, dass du es bist, dann geht es weiter.',
  errors: {},
  code: 'reauthentication_required',
  methods: ['passkey', 'email_code', 'password'],
};

/** @param {import('./route-steps.mjs').RouteStepContext} ctx */
async function withPasskeys({ stage }) {
  await stage(API('me/passkeys'), { method: 'GET', body: PASSKEYS });
  // Nothing a tap could change reaches the server.
  await stage(API('me/passkeys/[^/?]+'), { method: 'DELETE', status: 403, body: REAUTH_REQUIRED });
  await stage(API('me/passkeys/[^/?]+'), { method: 'PATCH', status: 403, body: REAUTH_REQUIRED });
  await stage(API('me/reauth/email'), { method: 'POST', status: 202, body: { data: { attempt_id: ATTEMPT, resend_after: 30 } } });
}

/** @param {import('@playwright/test').Page} page */
async function openPasskeyMenu(page) {
  await visible(page, `SET-19.passkey.${PASSKEY_IPHONE}.more`).click();
  await visible(page, `SET-19.passkey.${PASSKEY_IPHONE}.more.menu`).waitFor();
}

/** @param {import('./route-steps.mjs').RouteStepContext} ctx */
async function toReauth({ page }) {
  await recordIntervals(page);
  await openPasskeyMenu(page);
  await visible(page, `SET-19.passkey.${PASSKEY_IPHONE}.more.menu.remove`).click();
  await visible(page, 'SET-19.dialog.confirm').click();
  await visible(page, 'REAUTH.sheet').waitFor();
}

// SET-21: one week of lukas.sc's account, newest first, before the fixed clock. The 21:40 sign-in from Berlin is the one he did not do.
const EVENTS = {
  data: [
    {
      id: '01m7qavisual0000000event01',
      type: 'signed_in',
      occurred_at: '2026-11-02T08:12:00Z',
      device: { name: 'Browser', platform: 'web' },
      this_device: true,
      approx_city: null,
      method: 'password',
      by_staff: false,
      details: {},
      can_secure: false,
    },
    {
      id: '01m7qavisual0000000event02',
      type: 'new_device',
      occurred_at: '2026-11-01T20:40:00Z',
      device: { name: 'Chrome auf Windows', platform: 'web' },
      this_device: false,
      approx_city: 'Berlin',
      method: 'password',
      by_staff: false,
      details: {},
      can_secure: true,
    },
    {
      id: '01m7qavisual0000000event03',
      type: 'sign_in_failed',
      occurred_at: '2026-11-01T20:31:00Z',
      device: { name: 'Chrome auf Windows', platform: 'web' },
      this_device: false,
      approx_city: 'Berlin',
      method: null,
      by_staff: false,
      details: { count: 3, steps: { password: 3 }, last_at: '2026-11-01T20:38:00Z' },
      can_secure: true,
    },
    {
      id: '01m7qavisual0000000event04',
      type: 'signed_in',
      occurred_at: '2026-11-01T18:42:00Z',
      device: { name: 'iPhone 15 Pro', platform: 'ios' },
      this_device: false,
      approx_city: 'Hamburg',
      method: 'passkey',
      by_staff: false,
      details: { passkey_provider: 'iCloud-Schlüsselbund' },
      can_secure: true,
    },
    {
      id: '01m7qavisual0000000event05',
      type: 'passkey_added',
      occurred_at: '2026-10-27T20:03:00Z',
      device: { name: 'Pixel 8', platform: 'android' },
      this_device: false,
      approx_city: 'Hamburg',
      method: null,
      by_staff: false,
      details: { passkey_provider: 'Google Passwortmanager' },
      can_secure: true,
    },
    {
      id: '01m7qavisual0000000event06',
      type: 'password_changed',
      occurred_at: '2026-10-26T17:44:00Z',
      device: { name: 'iPhone 15 Pro', platform: 'ios' },
      this_device: false,
      approx_city: 'Hamburg',
      method: null,
      by_staff: false,
      details: {},
      can_secure: true,
    },
  ],
  links: { first: null, last: null, prev: null, next: null },
  meta: { path: '/api/v1/me/security-events', per_page: 25, next_cursor: null, prev_cursor: null },
};
const SECURED = {
  data: {
    signed_out: true,
    ticket_reference: 'SC-7H2KQXMB',
    devices_signed_out: 2,
    sessions_signed_out: 1,
    password_reset_required: true,
    removed: { passkeys: 1, providers: 0, email_change: false, two_factor: false },
  },
};

/** @param {import('./route-steps.mjs').RouteStepContext} ctx */
async function withEvents({ stage }) {
  await stage(API('me/security-events'), { method: 'GET', body: EVENTS });
  await stage(API('me/security/secure'), { method: 'POST', body: SECURED });
}

/** @param {{enabled: boolean, message: string|null}} maintenance */
const maintenanceOn = (maintenance) => /** @param {import('./route-steps.mjs').RouteStepContext} ctx */ async ({ stage }) =>
  stage(API('app-config'), { patch: (body) => void (body.data.maintenance = maintenance) });

const STAGED = 'Staged answers (routes-m418-gaps.mjs header): fictional QA data, never sent.';

/** @type {import('./matrix.mjs').RouteDef[]} */
export const routesM418Gaps = [
  // -- Auth 2.0 (09 §7.2, §8.1)
  {
    id: 'AUTH-12',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default', 'loading', 'error', 'offline'],
    ready: '[data-testid="AUTH-12.root"]',
    fs2: true,
    notes: 'Mit E-Mail fortfahren: one field (passkey autofill on the web), the caption, "Mit Passwort anmelden"; error = the server error notice.',
  },
  {
    id: 'AUTH-12-validation',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-12.email.error"]',
    fs2: true,
    walk: async ({ page }) => {
      await visible(page, 'AUTH-12.email').fill('lena.hoffmann.gmail.com');
      await visible(page, 'AUTH-12.cta.primary').click();
      await parkMouse(page);
    },
    notes: 'An address without "@" sent: the field error under the field, nothing sent.',
  },
  {
    id: 'AUTH-13',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-13.code"]',
    fs2: true,
    walk: async (ctx) => {
      await toCode(ctx);
      await parkMouse(ctx.page);
    },
    notes: `${STAGED} Code eingeben after AUTH-12 sent l…@gmail.com: the six cells (focused), "Code an l•••@gmail.com", the hint, "Neuen Code in 0:25" (stopped there) and "E-Mail ändern".`,
  },
  {
    id: 'AUTH-13-wrong',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-13.code.error"]',
    fs2: true,
    walk: codeAnswered({ status: 422, body: WRONG_CODE }, 'AUTH-13.code.error', { testId: 'AUTH-13.resend', text: '0:22' }),
    notes: `${STAGED} A wrong code: the cells cleared, "Noch 4 Versuche" under them (422 invalid_code, attempts_left 4), "Neuen Code in 0:22" (stopped there).`,
  },
  {
    id: 'AUTH-13-expired',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-13.code.error"]',
    fs2: true,
    walk: codeAnswered(
      { status: 422, body: { message: 'Der Code ist abgelaufen. Fordere einen neuen an.', errors: { code: ['Der Code ist abgelaufen. Fordere einen neuen an.'] }, code: 'code_expired' } },
      'AUTH-13.code.error',
      null,
    ),
    notes: `${STAGED} An expired code (422 code_expired, after 10 minutes): the message under the cells and "Neuen Code senden" at once.`,
  },
  {
    id: 'AUTH-13-locked',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-13.notice"]',
    fs2: true,
    walk: codeAnswered(
      {
        status: 429,
        headers: { 'Retry-After': '840' },
        body: { message: 'Zu viele falsche Codes. Versuch es in 14 Minuten noch einmal.', errors: {}, code: 'email_code_locked', retry_after: 840 },
      },
      'AUTH-13.notice',
      { testId: 'AUTH-13.notice', text: '13:58' },
    ),
    notes: `${STAGED} Locked after too many wrong codes (429 email_code_locked, 14 minutes): the info notice "Wieder möglich in 13:58" (stopped there), the cells inert, no "Neuen Code".`,
  },
  {
    id: 'AUTH-09b',
    path: '/app/auth/finish',
    phase: 3,
    auth: 'member-finish',
    states: ['default', 'loading', 'error', 'offline'],
    ready: '[data-testid="AUTH-09b.root"]',
    fs2: true,
    notes: 'Fast geschafft of a new passwordless account (finish.fixture, next_step accept_terms): age and AGB + Datenschutz, both unticked, "Weiter", "Abmelden".',
  },
  {
    id: 'AUTH-09b-validation',
    path: '/app/auth/finish',
    phase: 3,
    auth: 'member-finish',
    states: ['default'],
    ready: '[data-testid="AUTH-09b.ageConfirmed.error"]',
    fs2: true,
    walk: async ({ page }) => {
      await visible(page, 'AUTH-09b.cta.primary').click();
      await parkMouse(page);
    },
    notes: '"Weiter" with nothing ticked: the errors under both boxes, nothing sent.',
  },
  {
    id: 'AUTH-14',
    path: '/app/auth/passkey-offer',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'error', 'offline'],
    ready: '[data-testid="AUTH-14.root"]',
    fs2: true,
    notes: 'Schneller rein mit Passkey (lukas.sc, offered once per device): the AUTH-02 stack on its dark stage with Passkey marked, "Passkey hinzufügen", "Später".',
  },
  {
    id: 'AUTH-16',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-16.code"]',
    fs2: true,
    walk: async (ctx) => {
      await toLink(ctx);
      await parkMouse(ctx.page);
    },
    notes: `${STAGED} Konto verknüpfen: a Google sign-in whose address belongs to an existing account; the code went to l•••@gmail.com. Reached by staging the link_required answer on the e-mail step (Apple/Google are off until OA-38).`,
  },
  {
    id: 'AUTH-16-wrong',
    path: '/app/auth/email',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-16.code.error"]',
    fs2: true,
    walk: async (ctx) => {
      await toLink(ctx);
      await ctx.stage(API('auth/link/confirm'), { method: 'POST', status: 422, body: WRONG_CODE });
      await visible(ctx.page, 'AUTH-16.code').fill(CODE);
      await visible(ctx.page, 'AUTH-16.code.error').waitFor();
      await parkMouse(ctx.page);
    },
    notes: `${STAGED} AUTH-16 with a wrong code: "Noch 4 Versuche".`,
  },
  {
    id: 'AUTH-17',
    path: `/app/auth/secure#t=${SECURE_TOKEN}`,
    phase: 3,
    auth: 'guest',
    states: ['default', 'offline'],
    ready: '[data-testid="AUTH-17.ready"]',
    fs2: true,
    notes: 'Konto sichern from a login alert\'s "Das war ich nicht" (a token of the right shape; nothing is sent until the tap): what happens, "Konto jetzt sichern", "Das war ich". offline = the button disabled under the banner.',
  },
  {
    id: 'AUTH-17-done',
    path: `/app/auth/secure#t=${SECURE_TOKEN}`,
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-17.done"]',
    fs2: true,
    walk: async ({ page, stage }) => {
      await stage(API('auth/secure-account'), { method: 'POST', body: SECURED });
      await visible(page, 'AUTH-17.cta.primary').click();
      await visible(page, 'AUTH-17.done').waitFor();
      await parkMouse(page);
    },
    notes: `${STAGED} After "Konto jetzt sichern": every device signed out (3), the support reference SC-7H2KQXMB, the passkey added since removed, the new password by e-mail code, "Neu anmelden".`,
  },
  {
    id: 'AUTH-17-invalid',
    path: '/app/auth/secure',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="AUTH-17.invalid"]',
    fs2: true,
    notes: 'The link without a usable token (used, expired or cut): "Zur Anmeldung" and "Support kontaktieren".',
  },
  {
    id: 'AUTH-17-invalid-member',
    path: '/app/auth/secure',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="AUTH-17.invalid"]',
    fs2: true,
    notes: 'The same, signed in (lukas.sc): "Sicherheitsaktivität ansehen" instead of the sign-in.',
  },
  // -- Settings › Sicherheit (09 §7.9, §8.1–§8.4)
  {
    id: 'SET-19',
    path: '/app/settings/security/sign-in',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline'],
    ready: `[data-qa-state="default"] [data-testid="SET-19.passkey.${PASSKEY_IPHONE}"], [data-qa-state]:not([data-qa-state="default"]) [data-testid="SET-19.root"]`,
    capture: 'expanded',
    fs2: true,
    prepare: withPasskeys,
    notes: `${STAGED} Anmeldung & Passkeys of lukas.sc with two passkeys (iPhone 15 Pro, iCloud-Schlüsselbund; Pixel 8, Google Passwortmanager), the e-mail code and password rows, "Passkey hinzufügen". empty = the badged sample passkey.`,
  },
  {
    id: 'SET-19-menu',
    path: '/app/settings/security/sign-in',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: `[data-testid="SET-19.passkey.${PASSKEY_IPHONE}.more.menu"]`,
    fs2: true,
    prepare: withPasskeys,
    walk: async ({ page }) => {
      await openPasskeyMenu(page);
      await parkMouse(page);
    },
    notes: `${STAGED} The "···" menu of the iPhone passkey: Umbenennen, Entfernen (destructive).`,
  },
  {
    id: 'SET-19-rename',
    path: '/app/settings/security/sign-in',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-19.renameSheet.name"]',
    fs2: true,
    prepare: withPasskeys,
    walk: async ({ page }) => {
      await openPasskeyMenu(page);
      await visible(page, `SET-19.passkey.${PASSKEY_IPHONE}.more.menu.rename`).click();
      await visible(page, 'SET-19.renameSheet').waitFor();
      await parkMouse(page);
    },
    notes: `${STAGED} The rename sheet with the name field ("iPhone 15 Pro") and "Sichern".`,
  },
  {
    id: 'SET-19-remove',
    path: '/app/settings/security/sign-in',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-19.dialog.confirm"]',
    fs2: true,
    prepare: withPasskeys,
    walk: async ({ page }) => {
      await openPasskeyMenu(page);
      await visible(page, `SET-19.passkey.${PASSKEY_IPHONE}.more.menu.remove`).click();
      await visible(page, 'SET-19.dialog').waitFor();
      await parkMouse(page);
    },
    notes: `${STAGED} "Passkey entfernen?" for iPhone 15 Pro: Abbrechen, Entfernen.`,
  },
  {
    id: 'REAUTH',
    path: '/app/settings/security/sign-in',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="REAUTH.sheet"]',
    fs2: true,
    prepare: withPasskeys,
    walk: async (ctx) => {
      await toReauth(ctx);
      await parkMouse(ctx.page);
    },
    notes: `${STAGED} The reauth sheet over SET-19 after "Entfernen" (403 reauthentication_required, methods passkey · e-mail code · password): "Bestätige kurz, dass du es bist", the first method the device offers, the others as links.`,
  },
  {
    id: 'REAUTH-code',
    path: '/app/settings/security/sign-in',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="REAUTH.code"]',
    fs2: true,
    prepare: withPasskeys,
    walk: async (ctx) => {
      await toReauth(ctx);
      const code = ctx.page.locator(`${tid('REAUTH.code')}:visible`);
      if ((await code.count()) === 0) await visible(ctx.page, 'REAUTH.switch.email_code').click();
      await visible(ctx.page, 'REAUTH.code').waitFor();
      await freezeAt(ctx.page, 'REAUTH.resend', '0:25');
      await parkMouse(ctx.page);
    },
    notes: `${STAGED} The reauth sheet on the e-mail code (POST me/reauth/email staged): "Code an l•••", the six cells, "Neuen Code in 0:25" (stopped there).`,
  },
  {
    id: 'SET-21',
    path: '/app/settings/security/activity',
    phase: 3,
    auth: 'member',
    states: ['default', 'loading', 'empty', 'error', 'offline'],
    ready: '[data-qa-state="default"] [data-testid="SET-21.row.01m7qavisual0000000event02"], [data-qa-state]:not([data-qa-state="default"]) [data-testid="SET-21.root"]',
    capture: 'expanded',
    fs2: true,
    prepare: withEvents,
    notes: `${STAGED} Sicherheitsaktivität of lukas.sc, one week: this browser, a new device in Berlin with "Das war ich nicht" inline, three failed sign-ins, a passkey sign-in and a passkey added, the password changed. empty = the badged sample row.`,
  },
  {
    id: 'SET-21-notme',
    path: '/app/settings/security/activity',
    phase: 3,
    auth: 'member',
    states: ['default'],
    ready: '[data-testid="SET-21.dialog"]',
    fs2: true,
    prepare: withEvents,
    walk: async ({ page }) => {
      await visible(page, 'SET-21.row.01m7qavisual0000000event02.notMe').click();
      await visible(page, 'SET-21.dialog').waitFor();
      await parkMouse(page);
    },
    notes: `${STAGED} "Das war ich nicht" on the Berlin sign-in: the dialog that says what securing the account does, Abbrechen, Konto sichern.`,
  },
  // -- System gates (09 §7.14), only app-config opens them
  {
    id: 'SYS-01',
    path: '/app/update-required',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="SYS-01.state.title"]',
    fs2: true,
    prepare: ({ stage }) => stage(API('app-config'), { abort: 'internetdisconnected' }),
    notes: 'Update nötig, the photo-backed brand state with the bundled text, the store button (the get-the-app page on the web) and "Erneut prüfen". App-config does not answer: the member web never needs an update, so this is how the web shows the native gate.',
  },
  {
    id: 'SYS-02',
    path: '/app/maintenance',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="SYS-02.state.title"]',
    fs2: true,
    prepare: maintenanceOn({ enabled: true, message: null }),
    notes: 'Wartung with the bundled text (app-config maintenance on, no message): the night photo, the wordmark, one line, "Erneut prüfen".',
  },
  {
    id: 'SYS-02-message',
    path: '/app/maintenance',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="SYS-02.state.title"]',
    fs2: true,
    prepare: maintenanceOn({ enabled: true, message: 'Wir spielen gerade ein Update ein. In etwa 20 Minuten sind wir zurück.' }),
    notes: 'Wartung with the team\'s message from app-config (ADM-37).',
  },
  // -- Public member page without a cover of the member's own (DQ-1234)
  {
    id: 'WEB-02-stage',
    path: '/u/jann.ptrs',
    phase: 3,
    auth: 'guest',
    states: ['default'],
    ready: '[data-testid="WEB-02.cover"]',
    notes: 'WEB-02 for jann.ptrs: no cover of his own and two builds with one photo each, so no build photo can be the cover without repeating a garage card: the brand stage (`stage-empty`, a lit shelter on wet tarmac, no car) above the M4 G82 and M2 F87 cards, as PROF-02 in the app.',
  },
  // -- Admin (09 §10.3)
  {
    id: 'ADM-61',
    volatile: true,
    path: '/admin/system/mail-preview',
    phase: 3,
    auth: 'staff-owner',
    states: ['default', 'loading', 'empty', 'error'],
    ready: '[data-testid="ADM-61"]',
    notes: 'Mail-Vorschau (non-production, Owner only): the last 50 outgoing mails of this host (time, recipient, subject with any code masked), nothing chosen. Volatile (ADR-223): the list is whatever the host sent last.',
  },
  {
    id: 'ADM-61-open',
    volatile: true,
    path: '/admin/system/mail-preview?mail=0',
    phase: 3,
    auth: 'staff-owner',
    states: ['default'],
    // DQ-1226: the iframe element comes before its document. The frame loads the mail from its own signed URL; the cell waits for the
    // frame's load (data-loaded) and for drawn content in its body, so the picture never shows an empty frame.
    // DQ-1233: below 1280 (the 200 % zoom cell, 640 CSS) an opened mail heads the list, in the first screen under the page header.
    // Chromium paints no sandboxed frame outside the viewport (r3's zoom cell showed it blank): the walk makes sure the frame is
    // in view, as a member of staff sees it after opening, and waits for the mail drawn there. Only the viewport counts, so a full-page
    // picture of a scrolled page (the sticky top bar drawn at the scroll offset) or a frame scrolled out again can never come back.
    walk: async ({ page }) => {
      const frame = page.locator(tid('ADM-61.html'));
      const content = page.frameLocator(tid('ADM-61.html')).locator('body *').first();
      await content.waitFor({ state: 'visible', timeout: 20_000 });
      const inView = await frame.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top < window.innerHeight && box.bottom > 0;
      });
      if (!inView) throw new Error('ADM-61-open: the opened mail is not in the first screen (DQ-1233)');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
    capture: 'viewport',
    ready: '[data-testid="ADM-61.detail"] [data-testid="ADM-61.html"][data-loaded]',
    notes: 'The newest mail opened beside the list (sticky from 1280, the row marked): subject, HTML · Text, the mail as sent in its sandboxed frame (its own CSP, DQ-1226). At 200 % zoom (640 CSS) the opened mail heads the list under the page header (DQ-1233). The viewport. Each opening is audited (system.mail_preview_opened). Volatile.',
  },
];
