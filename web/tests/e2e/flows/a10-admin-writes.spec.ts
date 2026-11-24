// A10 Admin writes (client round 7, item 5: "admin changes still dont work all the time"), Chromium desktop. The Owner, through the real
// pages, in the situations that only come up now and then:
//
// 1. ADM-52 company data, the password confirmation stale on the server only (the page still believes it recent: a clock behind the
//    server's, or the 5 minutes running out while the request travels): the save asks for the password, then saves; the toast, the field
//    and the published org version agree.
// 2. ADM-63R badge, stale on the server only: after the password the badge is saved and the form is clean again (before: the shell
//    repeated a bare copy of the request, the page's own callback never ran, so "Speichern" stayed enabled and leaving asked to discard
//    changes that were already saved).
// 3. ADM-37 remote config, a value the server refuses: the field error stands next to what was typed (coverage).
// 4. ADM-66R shop product, a save the host drops and one the host answers with its own error page (both stubbed in the browser, nothing
//    reaches the server): an error toast says so (before: nothing at all, or Inertia's modal with the host's raw HTML).
//
// Not here: a stale form token (419). Laravel 13's PreventRequestForgery accepts a browser's same-origin request by its
// Sec-Fetch-Site header before it compares tokens, so an admin page in a browser never meets it (checked on staging: only a client
// without that header gets the 419 answer, `errors.419_write`).
//
// Cleanup: the org versions and the badge row this test wrote are put back as they were.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { admin, ageStaffSession, confirmPassword, confirmPasswordDirectly, DESKTOP, pageProps, realClock, staffContext, toast, withFlowLock } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { id, open } from '../support/flow';
import { BASE_URL } from '../support/qa.mjs';

const run = promisify(execFile);
const ARTISAN = fileURLToPath(new URL('../../../artisan', import.meta.url));
const BADGE = 'allrounder';

async function tinker(code: string): Promise<string> {
  if (!['localhost', '127.0.0.1'].includes(new URL(BASE_URL).hostname)) throw new Error('A10 writes rows back only on a local server');
  const { stdout } = await run(process.env.SPEEDCLUB_PHP ?? 'php', [ARTISAN, 'tinker', `--execute=${code}`], { timeout: 60_000 });
  return stdout.trim().split('\n').pop() ?? '';
}
const errorToast = (page: import('@playwright/test').Page, text: string) => page.locator('[data-testid="toast.error"]:visible').filter({ hasText: text });

test.describe('A10 admin writes', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One Owner session at a time; the admin is a desktop Chromium tool (ADR-212).');

  // One test and one fresh Owner session: the Owner fixture's sign-ins are limited per minute (two-factor challenge throttle).
  test('ADM-52, ADM-63R, ADM-37: stale password on the server only, a refused value', async ({ page, context }) => {
    test.setTimeout(420_000);
    await page.setViewportSize(DESKTOP);
    await withFlowLock('a8-org', 360_000, async () => {
      await staffContext(context, 'owner', { fresh: true });
      const orgBefore = Number(await tinker(`echo (int) DB::table('config_versions')->where('key', 'org')->max('id');`));
      const badgeRow = await tinker(`echo json_encode(DB::table('badges')->where('key', '${BADGE}')->first());`);
      try {
        await test.step('ADM-52: stale on the server only — the password, then the save', async () => {
          await confirmPasswordDirectly(context);
          await open(page, '/admin/settings', { now: await realClock(page) });
          await id(page, 'ADM-52.field.phone').fill('+49 30 555 0101');
          await page.waitForLoadState('networkidle');
          expect(ageStaffSession('owner', 'password'), 'the Owner fixture has a staff session to age').toBeGreaterThan(0);
          await id(page, 'ADM-52.save').click();
          await id(page, 'ADM-52.confirm.confirm').click();
          await confirmPassword(page);
          await expect(toast(page, admin('settings', 'flash.saved'))).toBeVisible();
          await expect(id(page, 'ADM-52.confirm')).toBeHidden();
          await expect(id(page, 'ADM-52.field.phone')).toHaveValue('+49 30 555 0101');
          const { values } = await pageProps<{ values: Record<string, string | null> }>(context, '/admin/settings');
          expect(values.phone).toBe('+49 30 555 0101');
        });

        await test.step('ADM-63R: stale on the server only — after the password the badge is saved and the form clean', async () => {
          await confirmPasswordDirectly(context);
          await open(page, `/admin/content/badges/${BADGE}`, { now: await realClock(page) });
          const sort = page.locator('[data-testid="ADM-63R.sort"]');
          const next = String(Number(await sort.inputValue()) + 1);
          await sort.fill(next);
          await expect(id(page, 'ADM-63R.save')).toBeEnabled();
          // The page's own requests (the member preview) write the session back when they end: age it only after them.
          await page.waitForLoadState('networkidle');
          expect(ageStaffSession('owner', 'password')).toBeGreaterThan(0);
          await id(page, 'ADM-63R.save').click();
          await confirmPassword(page);
          await expect(page.locator('[data-testid="toast.success"]:visible').first()).toBeVisible();
          await expect(sort).toHaveValue(next);
          await expect.poll(() => tinker(`echo DB::table('badges')->where('key', '${BADGE}')->value('sort');`)).toBe(next);
          await expect(id(page, 'ADM-63R.save'), 'saved: nothing left to save').toBeDisabled();
        });

        await test.step('ADM-37: a refused value stays next to its error', async () => {
          await confirmPasswordDirectly(context);
          await open(page, '/admin/config/remote', { now: await realClock(page) });
          const field = page.locator('[data-testid="ADM-37.min.ios"]');
          await expect(field).toBeEditable();
          const stored = await field.inputValue();
          await field.fill('abc');
          await id(page, 'ADM-37.save').click();
          await expect(page.locator('[role="alert"]:visible').first()).toBeVisible();
          await expect(field).toHaveValue('abc');
          const { editor } = await pageProps<{ editor: { payload: { min_version: { ios: string } } } }>(context, '/admin/config/remote');
          expect(editor.payload.min_version.ios).toBe(stored);
          await id(page, 'ADM-37.revert').click();
        });

      } finally {
        await tinker(
          `DB::table('config_versions')->where('key', 'org')->where('id', '>', ${orgBefore})->delete(); App\\Services\\Privacy\\OrgIdentity::forget(); app(App\\Services\\AppConfig\\AppConfig::class)->flush(); echo 0;`,
        );
        await tinker(`$r = json_decode(base64_decode('${Buffer.from(badgeRow).toString('base64')}'), true); DB::table('badges')->where('key', '${BADGE}')->update($r); echo 'ok';`);
      }
    });
  });

  test('ADM-66R: a save the host drops, and one it answers with its own error page, say so', async ({ page, context, expectFailedResponses }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(DESKTOP);
    expectFailedResponses([
      { status: 'network', url: /\/admin\/shop\/products$/ },
      { status: 503, url: /\/admin\/shop\/products$/ },
    ]);
    await staffContext(context, 'content-editor');
    await open(page, '/admin/shop/products/new', { now: await realClock(page) });
    await id(page, 'ADM-66R.title').fill('E2E A10 Clubshirt');
    await id(page, 'ADM-66R.price').fill('24,90');

    await page.route('**/admin/shop/products', (route) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.fallback()));
    await id(page, 'ADM-66R.save').click();
    await expect(errorToast(page, admin('ui', 'state.write_connection_lost'))).toBeVisible();
    await page.unroute('**/admin/shop/products');

    await page.route('**/admin/shop/products', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 503, contentType: 'text/html', body: '<html><body><h1>503 Service Unavailable</h1></body></html>' })
        : route.fallback(),
    );
    await id(page, 'ADM-66R.save').click();
    await expect(errorToast(page, admin('ui', 'state.server_error'))).toBeVisible();
    // Not Inertia's modal with the host's page in a frame; the form is still there.
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(id(page, 'ADM-66R.title')).toHaveValue('E2E A10 Clubshirt');
    await page.unroute('**/admin/shop/products');
  });
});
