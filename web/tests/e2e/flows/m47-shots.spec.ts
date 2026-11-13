// M4.7 review screenshots (opt-in: M47_SHOTS=1) into docs/reports/phase-4/m4.7-shots/: SET-06 Geräte & Sitzungen, SET-21
// Sicherheitsaktivität (marked row, confirm dialog, empty, error), AUTH-17 /auth/secure before and after the tap, at 390 and 1280 in
// Carbon and Hell, plus 390 at 200 % in Carbon. SET-20 App-Sperre is native only (hidden on the web, 09 §7.15) and is captured on
// Android. Each cell takes a fresh member signed in from two browsers, so the second is a new device with an alert mail and link.
//
// Round 2 (design QA r1): into m4.7-shots-r2/ (M47_SHOTS_DIR names another folder). SET-06 and SET-21 run on the real clock (no qaNow:
// "Zuletzt vor 1 Min.", DQ-1022); SET-21 adds the "···" menu of a routine sign-in (DQ-1014); and the reach check of the ListRow
// change (DQ-987) captures SET-01/05/09/11/17 at 360 and 390 with 200 % font in Carbon and Hell.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { apiLogin, useSession } from '../support/auth.mjs';
import { createMember, E2E_DOMAIN, resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { signInFromNewBrowser } from '../support/newBrowser';
import { BASE_URL, qaUrl, waitForStablePage } from '../support/qa.mjs';

const FOLDER = (process.env.M47_SHOTS_DIR ?? 'm4.7-shots-r2').replace(/[^A-Za-z0-9._-]/g, '');
const OUT = fileURLToPath(new URL(`../../../../docs/reports/phase-4/${FOLDER}/`, import.meta.url));
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Ladedruck-${RUN}-Zwoelf`;
let sequence = 0;
const SECURE_LINK = /https?:\/\/[^\s"'<>]+\/auth\/secure#t=([0-9A-Za-z]{26}\.[A-Za-z0-9_-]+)/;

type Cell = { width: number; height: number; theme: 'carbon' | 'light'; fontScale: 1 | 2 };
const CELLS: Cell[] = [
  { width: 390, height: 844, theme: 'carbon', fontScale: 1 },
  { width: 390, height: 844, theme: 'light', fontScale: 1 },
  { width: 1280, height: 800, theme: 'carbon', fontScale: 1 },
  { width: 1280, height: 800, theme: 'light', fontScale: 1 },
  { width: 390, height: 844, theme: 'carbon', fontScale: 2 },
];

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const cellName = (cell: Cell) => `${cell.width}-${cell.theme === 'light' ? 'hell' : 'carbon'}${cell.fontScale === 2 ? '-fs2' : ''}`;

async function shot(page: Page, route: string, cell: Cell): Promise<void> {
  await waitForStablePage(page).catch(() => undefined);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}${route}--${cellName(cell)}.png`, fullPage: true, animations: 'disabled' });
}

test.describe('M4.7 review screenshots', () => {
  test.skip(!process.env.M47_SHOTS, 'Opt-in: M47_SHOTS=1.');
  test.skip(({ browserName }) => browserName !== 'chromium', 'One browser is enough for the review set.');
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  for (const cell of CELLS) {
    test(`account security ${cellName(cell)}`, async ({ page, context, browser, expectFailedResponses }) => {
      test.setTimeout(180_000);
      expectFailedResponses([{ status: 401, url: /\/api\/v1\// }]);
      const email = `m47.shots.${RUN}.${++sequence}@${E2E_DOMAIN}`;
      await createMember(email, `m47s${RUN}${sequence}`.slice(0, 24), PASSWORD);
      await resetAuthLimits([email]);
      const first = await apiLogin(email, PASSWORD);
      const since = Date.now();
      await signInFromNewBrowser(email, PASSWORD);
      const mail = await waitForMail(email, (m) => Date.parse(m.at) >= since - 1000 && SECURE_LINK.test(m.html), { timeoutMs: 30_000 });
      const token = SECURE_LINK.exec(mail.html)?.[1] ?? '';
      const eventId = (token.split('.')[0] ?? '').toLowerCase();
      const qa = { theme: cell.theme, fontScale: cell.fontScale, locale: 'de' as const, now: '' };

      await useSession(context, first);
      await page.setViewportSize({ width: cell.width, height: cell.height });
      // DQ-1022: the fixtures freeze the browser's Date at QA_NOW; sessions and events are created now ("Zuletzt vor 1 Min.").
      await page.clock.setFixedTime(new Date());

      await page.goto(qaUrl('/app/settings/security/sessions', qa));
      await expect(id(page, 'SET-06.list')).toBeVisible();
      await shot(page, 'SET-06', cell);
      await page.goto(qaUrl('/app/settings/security/sessions', { ...qa, state: 'loading' }));
      await expect(id(page, 'SET-06.skeleton')).toBeVisible();
      await shot(page, 'SET-06-loading', cell);

      await page.goto(qaUrl(`/app/settings/security/activity?event=${eventId}`, qa));
      await expect(id(page, `SET-21.row.${eventId}.marked`)).toBeVisible();
      await shot(page, 'SET-21', cell);
      // "Das war ich nicht": the confirm dialog, cancelled (the link below secures the account).
      await id(page, `SET-21.row.${eventId}.notMe`).click();
      await expect(id(page, 'SET-21.dialog')).toBeVisible();
      await shot(page, 'SET-21-confirm', cell);
      await id(page, 'SET-21.dialog.cancel').click();
      await expect(id(page, 'SET-21.dialog')).toHaveCount(0);
      // DQ-1014: a routine sign-in (the first browser's) keeps "Das war ich nicht" in its "···" menu.
      await page.goto(qaUrl('/app/settings/security/activity', qa));
      const routine = page.locator('[data-testid^="SET-21.row."][data-testid$=".more"]:visible').first();
      await expect(routine).toBeVisible();
      await shot(page, 'SET-21-unmarked', cell);
      await routine.click();
      await expect(page.locator('[data-testid$=".more.menu"]:visible')).toBeVisible();
      await shot(page, 'SET-21-menu', cell);
      await page.keyboard.press('Escape');
      for (const state of ['empty', 'error', 'loading'] as const) {
        await page.goto(qaUrl('/app/settings/security/activity', { ...qa, state }));
        await expect(id(page, 'SET-21.root')).toBeVisible();
        await shot(page, `SET-21-${state}`, cell);
      }

      // AUTH-17 from the alert link, in a browser without a session: before the tap, then the answer.
      const guest = await browser.newContext({ viewport: { width: cell.width, height: cell.height } });
      try {
        const tab = await guest.newPage();
        await tab.goto(`${BASE_URL}${qaUrl('/app/auth/secure', qa)}#t=${token}`);
        await expect(tab.locator('[data-testid="AUTH-17.ready"]:visible')).toBeVisible();
        await shot(tab, 'AUTH-17-before', cell);
        await tab.locator('[data-testid="AUTH-17.cta.primary"]:visible').click();
        await expect(tab.locator('[data-testid="AUTH-17.done"]:visible')).toBeVisible();
        await shot(tab, 'AUTH-17-after', cell);
        await tab.goto(`${BASE_URL}${qaUrl('/app/auth/secure', qa)}`);
        await expect(tab.locator('[data-testid="AUTH-17.invalid"]:visible')).toBeVisible();
        await shot(tab, 'AUTH-17-invalid', cell);
      } finally {
        await guest.close();
      }

    });
  }

  // DQ-987 reach check: every settings list after the ListRow change, at 200 %.
  const REACH: Cell[] = [
    { width: 360, height: 800, theme: 'carbon', fontScale: 2 },
    { width: 360, height: 800, theme: 'light', fontScale: 2 },
    { width: 390, height: 844, theme: 'carbon', fontScale: 2 },
    { width: 390, height: 844, theme: 'light', fontScale: 2 },
  ];
  const LISTS = [
    ['SET-01', '/app/settings', 'SET-01.account'],
    ['SET-05', '/app/settings/security/two-factor', 'SET-05.root'],
    ['SET-09', '/app/settings/notifications', 'SET-09.root'],
    ['SET-11', '/app/settings/language', 'SET-11.root'],
    ['SET-17', '/app/settings/legal', 'SET-17.root'],
  ] as const;
  for (const cell of REACH) {
    test(`settings lists ${cellName(cell)}`, async ({ page, context }) => {
      test.setTimeout(180_000);
      const email = `m47.reach.${RUN}.${++sequence}@${E2E_DOMAIN}`;
      await createMember(email, `m47r${RUN}${sequence}`.slice(0, 24), PASSWORD);
      await resetAuthLimits([email]);
      await useSession(context, await apiLogin(email, PASSWORD));
      await page.clock.setFixedTime(new Date());
      await page.setViewportSize({ width: cell.width, height: cell.height });
      const qa = { theme: cell.theme, fontScale: cell.fontScale, locale: 'de' as const, now: '' };
      for (const [route, path, root] of LISTS) {
        await page.goto(qaUrl(path, qa));
        await expect(id(page, root)).toBeVisible();
        await shot(page, route, cell);
      }
    });
  }
});
