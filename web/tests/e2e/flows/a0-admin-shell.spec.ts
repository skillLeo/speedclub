// A0: the admin shell of M3.1 (06_ADMIN_SPEC §1–§3, ADR-212…218), on Chromium and WebKit. Staff sessions come from support/staff.mjs:
// the global setup signed in one fixture per role over HTTP; the sign-in test signs in through the UI with an admin of its own per
// browser project (`signin-<browser>`), whose fresh session also has no recent password, so the ADR-215 dialog must appear.
import type { BrowserContext, Page } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { QA_NOW, waitForStablePage } from '../support/qa.mjs';
import { staffRun } from '../support/staff.mjs';
import { totpCode } from '../support/totp.mjs';

const DESKTOP = { width: 1280, height: 800 };
const id = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:visible`);
const xsrfOf = async (context: BrowserContext): Promise<string> =>
  decodeURIComponent((await context.cookies()).find((c) => c.name === 'XSRF-TOKEN' && c.path === '/admin')?.value ?? '');

test.describe('A0 admin shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('sign-in with TOTP, dashboard queues and KPIs, then a four-eyes export behind the password dialog (ADR-215)', async ({ page, browser, browserName, qaGoto }) => {
    const run = await staffRun();
    const label = `signin-${browserName}`;
    const account = run.accounts[label];
    const secret = run.secrets[label];
    if (!account || !secret) throw new Error(`No staff fixture ${label}`);

    // ADM-01 → ADM-02 → ADM-06, the real flow.
    await qaGoto('/admin/login');
    await id(page, 'ADM-01.email').fill(account.email);
    await id(page, 'ADM-01.password').fill(run.password);
    await id(page, 'ADM-01.submit').click();
    await expect(id(page, 'ADM-02.form')).toBeVisible();
    await id(page, 'ADM-02.code').fill(totpCode(secret));
    await id(page, 'ADM-02.submit').click();
    await expect(id(page, 'ADM-06')).toBeVisible();
    await expect(page).toHaveURL(/\/admin(\?|$)/);

    // Queues first, every tile with a number or its zero state; then the nine KPI tiles (deferred props).
    await expect(id(page, 'ADM-06.queues')).toBeVisible();
    expect(await page.locator('[data-testid^="ADM-06.queue."]:visible').count()).toBeGreaterThan(0);
    await expect(id(page, 'ADM-06.kpis')).toBeVisible();
    await expect(page.locator('[data-testid^="ADM-06.kpi."]:visible')).toHaveCount(9);
    await expect(id(page, 'ADM-06.kpis.error')).toHaveCount(0);

    // ADM-44 export: four-eyes (ADR-214) and a sensitive action without a recent password (ADR-215): the dialog asks first.
    await qaGoto('/admin/audit');
    await id(page, 'ADM-44.table.export').click();
    await expect(id(page, 'ADM-44.export-dialog')).toBeVisible();
    await id(page, 'ADM-44.export-dialog.reason').fill('Quartalsprüfung der Staff-Anmeldungen für den Datenschutzbericht');
    await id(page, 'ADM-44.export-dialog.confirm').click();
    // Soft, so that the four-eyes half below is still checked when the dialog is missing; the test fails either way.
    await expect.soft(id(page, 'shell.password'), 'the export must ask for the password first (staff.recent-password, ADR-215)').toBeVisible();
    if (await id(page, 'shell.password').isVisible()) {
      await id(page, 'shell.password.input').fill(run.password);
      await id(page, 'shell.password.submit').click();
      await expect(id(page, 'shell.password')).toBeHidden();
    }
    await expect(id(page, 'shell.approval')).toBeVisible();

    // A second staff member (the admin fixture, approvals.decide + audit.export) sees it waiting on ADM-08.
    const other = await browser.newContext({ viewport: DESKTOP, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    try {
      await applyAuth(other, 'staff-admin');
      const alerts = await other.newPage();
      await alerts.goto('/admin/alerts?qaMotion=off');
      const approvals = alerts.locator('[data-testid="ADM-08.approvals"]:visible');
      await expect(approvals).toBeVisible();
      await expect(approvals).toContainText(account.name);
    } finally {
      await other.close();
    }
  });

  test('⌘K / Ctrl K opens the palette and navigates to a page', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    await qaGoto('/admin');
    await expect(id(page, 'ADM-06')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(id(page, 'ADM-07.palette')).toBeVisible();
    await expect(id(page, 'ADM-07.palette.input')).toBeFocused();
    await id(page, 'ADM-07.palette.input').fill('Audit');
    await expect(page.locator('[data-testid="ADM-07.palette.option.page"]:visible').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/audit/);
    await expect(id(page, 'ADM-44')).toBeVisible();
    await expect(id(page, 'ADM-07.palette')).toHaveCount(0);
  });

  test('a tall page opens at its top: keeping the active nav item in view scrolls only the sidebar (DQ-586)', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ['/admin/audit', '/admin/team/approvals', '/admin/moderation/rules']) {
      await qaGoto(path);
      await waitForStablePage(page);
      expect(await page.evaluate(() => window.scrollY), path).toBe(0);
    }
  });

  test('theme and DE/EN toggles persist across a reload', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    await qaGoto('/admin');
    await expect(id(page, 'ADM-06')).toBeVisible();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'carbon');
    await id(page, 'shell.theme').click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await waitForStablePage(page);
    await page.reload();
    await expect(id(page, 'ADM-06')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'light');

    await expect(html).toHaveAttribute('lang', 'de');
    await id(page, 'shell.locale.en').click();
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(id(page, 'shell.locale.en')).toHaveAttribute('aria-pressed', 'true');
    // The visit of the toggle loads the dashboard's deferred props after it; a reload in the middle would abort them.
    await waitForStablePage(page);
    await page.reload();
    await expect(id(page, 'ADM-06')).toBeVisible();
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(id(page, 'shell.locale.en')).toHaveAttribute('aria-pressed', 'true');
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('analyst: ADM-44 answers the 403 page, no export anywhere, a direct export POST is refused', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 403, url: /\/admin\/audit/ }]);
    await applyAuth(context, 'staff-analyst');
    const response = await page.goto('/admin/audit?qaMotion=off');
    expect(response?.status()).toBe(403);
    await expect(page.locator('[data-testid="ADM-05"][data-status="403"]:visible')).toBeVisible();
    await expect(id(page, 'ADM-05.view-only')).toBeVisible();
    await expect(page.locator('[data-testid="ADM-44.table.export"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="shell.nav.audit"]')).toHaveCount(0);

    const post = await context.request.post('/admin/audit/export', {
      headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(context) },
      data: { format: 'csv', reason: 'Direkter Versuch ohne Berechtigung', filter: {} },
      maxRedirects: 0,
    });
    expect(post.status()).toBe(403);
  });

  test('the idle warning appears after 25 minutes without a request (ADR-217)', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'staff-owner');
    // The shell's idle timer reads Date.now() and a 1 s interval: fake timers instead of a 25-minute wait.
    await page.clock.install({ time: new Date(QA_NOW) });
    await qaGoto('/admin');
    await expect(id(page, 'ADM-06')).toBeVisible();
    await expect(id(page, 'shell.idle')).toHaveCount(0);
    await page.clock.fastForward('24:00');
    await expect(id(page, 'shell.idle')).toHaveCount(0);
    await page.clock.fastForward('01:05');
    await expect(id(page, 'shell.idle')).toBeVisible();
    await expect(id(page, 'shell.idle.extend')).toBeVisible();
    await expect(id(page, 'shell.idle.sign-out')).toBeVisible();
  });
});

