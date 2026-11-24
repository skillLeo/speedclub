// A8 company data (ADM-52), on Chromium and WebKit: the client's report of 2026-11-19 ("we can't edit company data in the admin panel
// and save, it is buggy"; staging had no org version at all, so not one save had gone through). The Owner, through the real page:
//
// 1. types the company data the way people type it: a VAT ID with spaces and in lower case, a phone number with dots. Save is enabled
//    (before: the VAT check refused the spaces and kept Save disabled without saying why the button did nothing);
// 2. a save whose connection drops (stubbed in the browser, nothing reaches the server) says so inside the dialog, which stays open
//    (before: no callback, nothing happened);
// 3. the next "Speichern" (after the password dialog when asked) saves and publishes: toast, the page shows the values, the VAT ID
//    normalised to DE123456789, and the published org version carries them;
// 4. client report 2026-11-23: /impressum shows the saved company name and VAT ID at once, although it was rendered (and the org cached
//    on the server) before the save. The reader's side (an Admin) is flows/a8b-company-data-reader.spec.ts.
//
// Cleanup: the org versions this test wrote are removed and the org cache is forgotten, so the legal placeholders stay as they were.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { admin, confirmPassword, DESKTOP, pageProps, realClock, staffContext, toast, withFlowLock } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { id, open } from '../support/flow';
import { BASE_URL } from '../support/qa.mjs';

const run = promisify(execFile);
const ARTISAN = fileURLToPath(new URL('../../../artisan', import.meta.url));

type SettingsProps = { values: Record<string, string | null> };

/** The newest org version id before the test, and removing every org version after it. Local server only. */
async function orgVersions(action: 'read' | 'restore', after = 0): Promise<number> {
  if (!['localhost', '127.0.0.1'].includes(new URL(BASE_URL).hostname)) throw new Error('A8 removes org versions only on a local server');
  const code =
    action === 'read'
      ? `echo (int) DB::table('config_versions')->where('key', 'org')->max('id');`
      : `DB::table('config_versions')->where('key', 'org')->where('id', '>', ${after})->delete(); App\\Services\\Privacy\\OrgIdentity::forget(); app(App\\Services\\AppConfig\\AppConfig::class)->flush(); echo 0;`;
  const { stdout } = await run(process.env.SPEEDCLUB_PHP ?? 'php', [ARTISAN, 'tinker', `--execute=${code}`], { timeout: 60_000 });
  return Number(stdout.trim().split('\n').pop() ?? '0');
}

async function fill(page: Page, field: string, value: string): Promise<void> {
  await id(page, `ADM-52.field.${field}`).fill(value);
}

test.describe('A8 company data', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('ADM-52: the Owner saves the company data as typed; a dropped save says so; the VAT ID is stored normalised', async ({ page, context, browserName, expectFailedResponses }) => {
    test.setTimeout(300_000);
    // Step 2's dropped save, stubbed in the browser for that one request.
    expectFailedResponses([{ status: 'network', url: /\/admin\/settings$/ }]);
    await withFlowLock('a8-org', 240_000, async () => {
      // Inside the lock: the two browser projects otherwise sign the one `owner` fixture in within the same TOTP step, and Fortify
      // refuses the second use of a code (both retried on the next step together and failed again).
      await staffContext(context, 'owner');
      const before = await orgVersions('read');
      try {
        // The Impressum before the save: the org is cached on the server from here on.
        const imprintBefore = await context.request.get('/impressum', { headers: { Accept: 'text/html', 'Accept-Language': 'de' } });
        expect(imprintBefore.status()).toBe(200);
        expect(await imprintBefore.text()).not.toContain(`Speedclub A8 ${browserName}`);

        await open(page, '/admin/settings', { now: await realClock(page) });
        await expect(id(page, 'ADM-52.group.company')).toBeVisible();
        await expect(id(page, 'ADM-52.view-only')).toHaveCount(0);

        await test.step('typed as people type it: Save is enabled', async () => {
          await fill(page, 'company_name', `Speedclub A8 ${browserName}`);
          await fill(page, 'vat_id', 'de 123 456 789');
          await fill(page, 'phone', '+49 30.1234.5678');
          await expect(page.locator('[role="alert"]')).toHaveCount(0);
          await expect(id(page, 'ADM-52.save')).toBeEnabled();
        });

        await test.step('a save whose connection drops says so in the dialog', async () => {
          await page.route('**/admin/settings', (route) => (route.request().method() === 'PATCH' ? route.abort('connectionreset') : route.fallback()));
          await id(page, 'ADM-52.save').click();
          await expect(id(page, 'ADM-52.confirm')).toBeVisible();
          await id(page, 'ADM-52.confirm.confirm').click();
          const dropped = id(page, 'ADM-52.confirm').getByRole('alert');
          await expect(id(page, 'shell.password').or(dropped).first()).toBeVisible();
          if (await id(page, 'shell.password').isVisible()) await confirmPassword(page);
          await expect(dropped).toHaveText(admin('config', 'draft.connection_lost'));
          await page.unroute('**/admin/settings');
        });

        await test.step('the next save goes through and publishes', async () => {
          const saved = toast(page, admin('settings', 'flash.saved'));
          await id(page, 'ADM-52.confirm.confirm').click();
          await expect(id(page, 'shell.password').or(saved).first()).toBeVisible();
          if (await id(page, 'shell.password').isVisible()) await confirmPassword(page);
          await expect(saved).toBeVisible();
          await expect(id(page, 'ADM-52.confirm')).toBeHidden();
          await expect(id(page, 'ADM-52.field.vat_id')).toHaveValue('DE123456789');

          const { values } = await pageProps<SettingsProps>(context, '/admin/settings');
          expect(values.company_name).toBe(`Speedclub A8 ${browserName}`);
          expect(values.vat_id).toBe('DE123456789');
          expect(values.phone).toBe('+49 30.1234.5678');
        });

        await test.step('the Impressum shows the saved company data at once', async () => {
          const imprint = await page.context().newPage();
          await imprint.goto('/impressum');
          const body = id(imprint, 'WEB-08.root');
          await expect(body).toContainText(`Speedclub A8 ${browserName}`);
          await expect(body).toContainText('DE123456789');
          await expect(body).not.toContainText('[[Firmenname]]');
          await imprint.close();
        });
      } finally {
        await orgVersions('restore', before);
      }
    });
  });
});
