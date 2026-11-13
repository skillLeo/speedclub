// M4.6 review screenshots (opt-in: M46_SHOTS=1). The Auth 2.0 screens hold state a plain URL cannot set up (an attempt kept on
// the device, a member at the AGB step, a passkey-capable device), so they are walked to through the real flow, as in F9/F10,
// and captured at 390 and 1280 in Carbon and Hell, plus 390 at 200 % in Carbon, into docs/reports/phase-4/m4.6-shots-r2/
// (M46_SHOTS_DIR names another folder under docs/reports/phase-4/).
//
// Round 3 (design QA r2, DQ-1010): mocked answers carry the server's German message (`lang/de/errors.php`), the SET-19 cells wait
// until the "Passkey hinzugefügt." toast has gone, HOME-02 and SET-19 run on the real clock (no qaNow, so "Heute" matches the data),
// and the reauth sheet is also captured with that toast open over it (DQ-1006: the toast must clear the sheet's footer).
//
// Round 2 (design QA r1, DQ-1001): the mouse is parked at (0, 0) before every shot, so no bottom button is captured in hover, and the
// AUTH-13 countdown is captured at a fixed value ("0:20"), so the cells match. The states r1 missed are added: AUTH-02 offline, 1440,
// Schwarz and EN; AUTH-12 validation, server error, skeleton; AUTH-13 filled, expired, locked; the reauth sheet; WEB-12 verifying and
// expired; SET-19 menu, rename sheet, remove dialog, error, offline; the HOME-02 security row. AUTH-16 needs Apple or Google (flags
// off until OA-38) and stays covered by Jest.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { createMember, E2E_DOMAIN, resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { BASE_URL, qaUrl, waitForStablePage } from '../support/qa.mjs';

const FOLDER = (process.env.M46_SHOTS_DIR ?? 'm4.6-shots-r3').replace(/[^A-Za-z0-9._-]/g, '');
const OUT = fileURLToPath(new URL(`../../../../docs/reports/phase-4/${FOLDER}/`, import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Ladeluftkuehler-${RUN}-Neun`;
let sequence = 0;
const address = (label: string): string => `m46.${label}.${RUN}.${++sequence}@${E2E_DOMAIN}`;

type Theme = 'carbon' | 'light' | 'black';
type Cell = { width: number; height: number; theme: Theme; fontScale: 1 | 2; locale?: 'de' | 'en' };
const CELLS: Cell[] = [
  { width: 390, height: 844, theme: 'carbon', fontScale: 1 },
  { width: 390, height: 844, theme: 'light', fontScale: 1 },
  { width: 1280, height: 800, theme: 'carbon', fontScale: 1 },
  { width: 1280, height: 800, theme: 'light', fontScale: 1 },
  { width: 390, height: 844, theme: 'carbon', fontScale: 2 },
];
/** The cells r1 lacked: one EN cell, 1440 and Schwarz. Only the e-mail path runs in them. */
const EXTRA_CELLS: Cell[] = [
  { width: 390, height: 844, theme: 'carbon', fontScale: 1, locale: 'en' },
  { width: 1440, height: 900, theme: 'carbon', fontScale: 1 },
  { width: 390, height: 844, theme: 'black', fontScale: 1 },
];

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const themeName = (theme: Theme) => (theme === 'light' ? 'hell' : theme === 'black' ? 'schwarz' : 'carbon');
const cellName = (cell: Cell) => `${cell.width}-${themeName(cell.theme)}${cell.fontScale === 2 ? '-fs2' : ''}${cell.locale === 'en' ? '-en' : ''}`;
const qaOf = (cell: Cell, state?: string) => ({ theme: cell.theme, fontScale: cell.fontScale, locale: cell.locale ?? 'de', ...(state ? { state } : {}) });
/** DQ-1010 c: the real clock, for screens that show server dates (HOME-02 "Heute", SET-19 "Angelegt am"). */
const liveQaOf = (cell: Cell, state?: string) => ({ ...qaOf(cell, state), now: '' });

async function shot(page: Page, route: string, cell: Cell): Promise<void> {
  await waitForStablePage(page).catch(() => undefined);
  // DQ-1001: no hover state on whatever lies under the last click.
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}${route}--${cellName(cell)}.png`, fullPage: true, animations: 'disabled' });
}

/** DQ-1001: the countdown at one fixed value, so every cell shows the same text. */
async function atCountdown(page: Page, testId: string): Promise<void> {
  for (const value of ['0:20', '0:10']) {
    try {
      await expect(id(page, testId)).toContainText(value, { timeout: 12_000 });
      return;
    } catch {
      // The value passed while the page settled: the next one.
    }
  }
}

/** A JSON answer for a route, for the states the server gives only after minutes (expired, locked) or on a fault. */
async function answer(page: Page, path: RegExp, status: number, body: unknown, method = 'POST'): Promise<void> {
  await page.route(path, (route) =>
    route.request().method() === method ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }) : route.fallback(),
  );
}

test.describe('M4.6 review screenshots', () => {
  test.skip(!process.env.M46_SHOTS, 'Opt-in: M46_SHOTS=1.');
  test.skip(({ browserName }) => browserName !== 'chromium', 'The passkey screens need the CDP virtual authenticator.');
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  for (const cell of [...CELLS, ...EXTRA_CELLS]) {
    const main = CELLS.includes(cell);
    test(`e-mail code path ${cellName(cell)}`, async ({ page, browser, expectFailedResponses }) => {
      test.setTimeout(420_000);
      expectFailedResponses([
        { status: 422, url: /\/api\/v1\/auth\/email\/verify(\?.*)?$/ },
        { status: 500, url: /\/api\/v1\/auth\/email\/start(\?.*)?$/ },
      ]);
      await page.setViewportSize({ width: cell.width, height: cell.height });
      const qa = qaOf(cell);
      const email = address('code');
      await resetAuthLimits([email]);

      await page.goto(qaUrl('/app/welcome', qa));
      await expect(id(page, 'AUTH-02.root')).toBeVisible();
      await shot(page, 'AUTH-02', cell);
      if (main) {
        await page.goto(qaUrl('/app/welcome', qaOf(cell, 'offline')));
        await expect(id(page, 'AUTH-02.root')).toBeVisible();
        await shot(page, 'AUTH-02-offline', cell);
        await page.goto(qaUrl('/app/auth/email', qaOf(cell, 'loading')));
        await expect(id(page, 'AUTH-12.skeleton')).toBeVisible();
        await shot(page, 'AUTH-12-loading', cell);
        await page.goto(qaUrl('/app/welcome', qa));
      }

      await id(page, 'AUTH-02.provider.email').click();
      await expect(id(page, 'AUTH-12.root')).toBeVisible();
      await shot(page, 'AUTH-12', cell);
      if (main) {
        await id(page, 'AUTH-12.email').fill('jann.example.de');
        await id(page, 'AUTH-12.cta.primary').click();
        await expect(id(page, 'AUTH-12.email.error')).toBeVisible();
        await shot(page, 'AUTH-12-validation', cell);
        await answer(page, /\/api\/v1\/auth\/email\/start(\?.*)?$/, 500, { message: 'Auf unserer Seite ist etwas schiefgelaufen. Bitte versuch es noch einmal.', errors: {}, code: 'server_error' });
        await id(page, 'AUTH-12.email').fill(email);
        await id(page, 'AUTH-12.cta.primary').click();
        await expect(id(page, 'AUTH-12.notice')).toBeVisible();
        await shot(page, 'AUTH-12-error', cell);
        await page.unroute(/\/api\/v1\/auth\/email\/start(\?.*)?$/);
      }

      await id(page, 'AUTH-12.email').fill(email);
      const since = Date.now();
      await id(page, 'AUTH-12.cta.primary').click();
      await expect(id(page, 'AUTH-13.root')).toBeVisible();
      await waitForStablePage(page).catch(() => undefined);
      await atCountdown(page, 'AUTH-13.resend');
      await shot(page, 'AUTH-13', cell);

      const mail = await waitForMail(email, (m) => Date.parse(m.at) >= since - 1000);
      const code = mail.code ?? /\b(\d{6})\b/.exec(mail.text)?.[1] ?? '';
      const magic = /https?:\/\/[^\s"'<>]+\/auth\/magic#t=[A-Za-z0-9_-]+/.exec(mail.html)?.[0] ?? '';
      // A wrong code: the error state of AUTH-13.
      const refused = page.waitForResponse((r) => r.url().includes('/api/v1/auth/email/verify'));
      await id(page, 'AUTH-13.code').fill(String((Number(code) + 1) % 1_000_000).padStart(6, '0'));
      await refused;
      await expect(id(page, 'AUTH-13.code.error')).toBeVisible();
      await shot(page, 'AUTH-13-wrong', cell);

      if (main) {
        // Expired and locked come from the server after 10 and after 5 wrong codes; the answers are staged here.
        await answer(page, /\/api\/v1\/auth\/email\/verify(\?.*)?$/, 422, { message: 'Der Code ist abgelaufen. Fordere einen neuen an.', errors: { code: ['Der Code ist abgelaufen. Fordere einen neuen an.'] }, code: 'code_expired' });
        await id(page, 'AUTH-13.code').fill('111111');
        await expect(id(page, 'AUTH-13.code.error')).toBeVisible();
        await shot(page, 'AUTH-13-expired', cell);
        await page.unroute(/\/api\/v1\/auth\/email\/verify(\?.*)?$/);
        // Filled, before the answer: the digits in tabular figures.
        await page.route(/\/api\/v1\/auth\/email\/verify(\?.*)?$/, async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          await route.fallback();
        });
      }

      // WEB-12 on another browser: the link says to type the code in the app.
      const other = await browser.newContext({ viewport: { width: cell.width, height: cell.height } });
      try {
        const tab = await other.newPage();
        const link = new URL(magic);
        await tab.goto(`${BASE_URL}${qaUrl(`/app${link.pathname}`, qa)}${link.hash}`);
        await expect(tab.locator('[data-testid="WEB-12.root"]:visible')).toBeVisible();
        await shot(tab, 'WEB-12', cell);
        if (main) {
          await tab.goto(`${BASE_URL}${qaUrl('/app/auth/magic', qaOf(cell, 'loading'))}`);
          await expect(tab.locator('[data-testid="WEB-12.root"]:visible')).toBeVisible();
          await shot(tab, 'WEB-12-verifying', cell);
        }
      } finally {
        await other.close();
      }

      await id(page, 'AUTH-13.code').fill(code);
      if (main) await shot(page, 'AUTH-13-filled', cell);
      await expect(id(page, 'AUTH-09b.root')).toBeVisible();
      await page.unroute(/\/api\/v1\/auth\/email\/verify(\?.*)?$/).catch(() => undefined);
      await shot(page, 'AUTH-09b', cell);
      await id(page, 'AUTH-09b.cta.primary').click();
      await expect(id(page, 'AUTH-09b.ageConfirmed.error')).toBeVisible();
      await shot(page, 'AUTH-09b-validation', cell);

      if (main) {
        // The lock (5 wrong codes, 15 minutes) disables the cells for good, so it gets an attempt of its own in a fresh browser.
        const locked = await browser.newContext({ viewport: { width: cell.width, height: cell.height } });
        try {
          const tab = await locked.newPage();
          const other = address('locked');
          await resetAuthLimits([other]);
          await tab.goto(`${BASE_URL}${qaUrl('/app/auth/email', qa)}`);
          await tab.locator('[data-testid="AUTH-12.email"]:visible').fill(other);
          await tab.locator('[data-testid="AUTH-12.cta.primary"]:visible').click();
          await expect(tab.locator('[data-testid="AUTH-13.root"]:visible')).toBeVisible();
          await answer(tab, /\/api\/v1\/auth\/email\/verify(\?.*)?$/, 422, {
            message: 'Zu viele falsche Codes. Versuch es in 14 Minuten noch einmal.',
            errors: {},
            code: 'email_code_locked',
            retry_after: 840,
          });
          await tab.locator('[data-testid="AUTH-13.code"]:visible').fill('222222');
          await expect(tab.locator('[data-testid="AUTH-13.notice"]:visible')).toBeVisible();
          await shot(tab, 'AUTH-13-locked', cell);
        } finally {
          await locked.close();
        }
      }
    });
  }

  for (const cell of CELLS) {
    test(`passkey path ${cellName(cell)}`, async ({ page, expectFailedResponses }) => {
      test.setTimeout(420_000);
      expectFailedResponses([{ status: 403, url: /\/api\/v1\/me\/passkeys\/[^/]+$/ }]);
      await page.setViewportSize({ width: cell.width, height: cell.height });
      const qa = qaOf(cell);
      const email = address('passkey');
      await createMember(email, `m46${RUN}${++sequence}`.slice(0, 24), PASSWORD);
      await resetAuthLimits([email]);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      });

      await page.goto(qaUrl('/app/sign-in', qa));
      await id(page, 'AUTH-03.email').fill(email);
      await id(page, 'AUTH-03.password').fill(PASSWORD);
      await id(page, 'AUTH-03.cta.primary').click();
      await expect(id(page, 'AUTH-14.root')).toBeVisible();
      await shot(page, 'AUTH-14', cell);

      // DQ-1010 c: the fixtures freeze the browser's Date at QA_NOW; the passkey and its notice are created now.
      await page.clock.setFixedTime(new Date());
      await page.goto(qaUrl('/app/settings/security/sign-in', liveQaOf(cell)));
      await expect(id(page, 'SET-19.root')).toBeVisible();
      await expect(id(page, 'SET-19.passkeys.empty')).toBeVisible();
      await shot(page, 'SET-19-empty', cell);
      const reauthPath = /\/api\/v1\/me\/passkeys\/[^/]+$/;
      const reauthAnswer = {
        message: 'Bestätige kurz, dass du es bist, dann geht es weiter.',
        errors: {},
        code: 'reauthentication_required',
        methods: ['passkey', 'email_code', 'password'],
      };
      await id(page, 'SET-19.add').click();
      const more = page.locator('[data-testid^="SET-19.passkey."][data-testid$=".more"]:visible');
      await expect(more).toHaveCount(1);
      // DQ-1006: "Passkey hinzugefügt." is still up when the rename sheet opens: the toast must sit above the sheet's footer.
      await more.click();
      await page.locator('[data-testid$=".more.menu.rename"]:visible').click();
      await expect(id(page, 'SET-19.renameSheet')).toBeVisible();
      await expect(id(page, 'SET-19.renameSheet.footer')).toBeVisible();
      // The panel rises on its spring and the overlay's toast host takes the toast over: let both settle, inside the toast's 4 s.
      await page.waitForTimeout(800);
      await expect(page.getByText('Passkey hinzugefügt.')).toBeVisible();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}SET-19-rename-toast--${cellName(cell)}.png`, fullPage: true, animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(id(page, 'SET-19.renameSheet')).toHaveCount(0);
      // DQ-1010 b: the toast of the add step is gone before the clean cells.
      await expect(page.getByText('Passkey hinzugefügt.')).toHaveCount(0, { timeout: 10_000 });
      await shot(page, 'SET-19', cell);

      await more.click();
      const menu = page.locator('[data-testid^="SET-19.passkey."][data-testid$=".more.menu"]:visible');
      await expect(menu).toBeVisible();
      await shot(page, 'SET-19-menu', cell);
      await page.locator('[data-testid$=".more.menu.rename"]:visible').click();
      await expect(id(page, 'SET-19.renameSheet')).toBeVisible();
      await shot(page, 'SET-19-rename', cell);
      await page.keyboard.press('Escape');
      await expect(id(page, 'SET-19.renameSheet')).toHaveCount(0);

      await more.click();
      await page.locator('[data-testid$=".more.menu.remove"]:visible').click();
      await expect(id(page, 'SET-19.dialog')).toBeVisible();
      await shot(page, 'SET-19-remove', cell);
      // The reauth sheet: the server asks for recent authentication, as it does once the sign-in is older than 15 minutes.
      await answer(page, reauthPath, 403, reauthAnswer, 'DELETE');
      await id(page, 'SET-19.dialog.confirm').click();
      await expect(id(page, 'REAUTH.sheet')).toBeVisible();
      await shot(page, 'REAUTH', cell);
      await page.keyboard.press('Escape');
      await page.unroute(/\/api\/v1\/me\/passkeys\/[^/]+$/);

      for (const state of ['error', 'offline'] as const) {
        await page.goto(qaUrl('/app/settings/security/sign-in', liveQaOf(cell, state)));
        await expect(id(page, 'SET-19.root')).toBeVisible();
        await shot(page, `SET-19-${state}`, cell);
      }

      // HOME-02: the passkey added just now is a security row (M4.7 opens SET-21 from it).
      await page.goto(qaUrl('/app/notifications', liveQaOf(cell)));
      await expect(id(page, 'HOME-02.root')).toBeVisible();
      await shot(page, 'HOME-02-security', cell);
    });
  }
});
