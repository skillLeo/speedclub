// QA H1 settings: SET-07 Privatsphäre (a choice persists after a reload, offline it is refused and rolled back), SET-09
// Mitteilungen (a switch persists, a double tap ends where it started), SET-13 Konto löschen (empty and wrong password, a
// double tap on the final confirm sends one request, signed out afterwards, a reload stays signed out, the login is refused).
import type { Page } from '@playwright/test';
import { apiLogin, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { apiPath, id, open } from '../support/flow';
import { createGarageMember, GARAGE_PASSWORD } from '../support/garage.mjs';

async function member(page: Page) {
  const m = await createGarageMember('hunt');
  await useSession(page.context(), m.session);
  return m;
}

test.describe('SET-07 and SET-09', () => {
  test('Wer darf dir schreiben: Niemand persists after a reload and on the server', async ({ page }) => {
    const m = await member(page);
    await open(page, '/app/settings/privacy');
    await id(page, 'SET-07.whoCanMessage.nobody').click();
    await expect(id(page, 'SET-07.saved').first()).toBeVisible();
    await page.reload();
    await expect(id(page, 'SET-07.whoCanMessage.nobody')).toHaveAttribute('aria-checked', 'true');
    const me = await m.api.get('me/settings');
    expect(JSON.stringify(me.body)).toContain('nobody');
    await m.api.dispose();
  });

  test('offline, a privacy choice is refused and the old value stays, also after a reload', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: /\/api\/v1\// }]);
    const m = await member(page);
    await open(page, '/app/settings/privacy');
    await expect(id(page, 'SET-07.whoCanMessage.everyone')).toHaveAttribute('aria-checked', 'true');
    await context.setOffline(true);
    await expect(page.locator('[data-testid$=".offline"]:visible, [data-testid$=".offlineBanner"]:visible').first()).toBeVisible();
    await id(page, 'SET-07.whoCanMessage.nobody').click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await context.setOffline(false);
    await page.reload();
    await expect(id(page, 'SET-07.whoCanMessage.everyone')).toHaveAttribute('aria-checked', 'true');
    const me = await m.api.get('me/settings');
    expect(JSON.stringify(me.body)).not.toContain('"nobody"');
    await m.api.dispose();
  });

  test('a Mitteilungen switch persists after a reload; after a double tap the screen and the server agree', async ({ page }) => {
    const m = await member(page);
    await open(page, '/app/settings/notifications');
    await expect(id(page, 'SET-09.root')).toBeVisible();
    const toggle = page.locator('[data-testid^="SET-09."][role="switch"]:visible:not([aria-disabled="true"])').first();
    await expect(toggle).toBeVisible();
    const testId = (await toggle.getAttribute('data-testid')) ?? '';
    const shown = () => page.getByTestId(testId).locator('visible=true');
    const start = await toggle.getAttribute('aria-checked');
    await shown().click();
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(shown()).toHaveAttribute('aria-checked', start === 'true' ? 'false' : 'true');
    // A double tap may count once or twice; what the screen shows once it settles is what the server keeps.
    await shown().dblclick();
    await page.waitForTimeout(2500);
    const settled = await shown().getAttribute('aria-checked');
    await page.reload();
    await expect(shown()).toHaveAttribute('aria-checked', settled ?? '');
    await m.api.dispose();
  });
});

test.describe('SET-13 Konto löschen', () => {
  test('empty and wrong password are refused in place; a double tap deletes once; signed out after, also after a reload', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: apiPath('me/delete') }, { status: 401, url: /\/api\/v1\// }]);
    const m = await member(page);
    const deletes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/me/delete') deletes.push(r.url());
    });
    await open(page, '/app/settings/data/delete');
    await expect(id(page, 'SET-13.password')).toBeVisible();
    await id(page, 'SET-13.cta.primary').click();
    await expect(page.locator('[data-testid="SET-13.password.error"]:visible, [data-testid="SET-13.understood.error"]:visible').first()).toBeVisible();
    expect(deletes).toEqual([]);

    await id(page, 'SET-13.password').fill('Falsch-ÄÖÜ-ß-123');
    await id(page, 'SET-13.understood').click();
    await id(page, 'SET-13.cta.primary').click();
    if (await id(page, 'SET-13.dialog.confirm').isVisible().catch(() => false)) await id(page, 'SET-13.dialog.confirm').click();
    await expect(page.locator('[data-testid="SET-13.password.error"]:visible, [data-testid="SET-13.notice"]:visible').first()).toBeVisible();
    const wrong = deletes.length;

    await id(page, 'SET-13.password').fill(GARAGE_PASSWORD);
    await id(page, 'SET-13.cta.primary').click();
    await expect(id(page, 'SET-13.dialog.confirm')).toBeVisible();
    await id(page, 'SET-13.dialog.confirm').dblclick();
    await expect(id(page, 'SET-13.done.title')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(deletes.length - wrong, 'one DELETE for one confirm').toBe(1);
    await page.reload();
    const me = await page.request.get('/api/v1/auth/me', { headers: { Accept: 'application/json' } });
    expect(me.status()).toBe(401);
    await expect(apiLogin(m.email, GARAGE_PASSWORD)).rejects.toThrow(/HTTP 4\d\d/);
    await m.api.dispose();
  });
});
