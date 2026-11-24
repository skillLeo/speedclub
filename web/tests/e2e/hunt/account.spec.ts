// QA H1 account: AUTH-12 e-mail entry (empty, invalid, umlauts, max length, double tap, offline), the code sign-in of an existing
// member, sign-out, and a session that ended while the app was open.
import type { Page } from '@playwright/test';
import { resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { apiPath, id, open, pathOf } from '../support/flow';
import { createGarageMember } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';

/** auth/me as the web app asks it: Sanctum treats a request as the SPA's only with the app's Referer. */
const meStatus = async (page: Page): Promise<number> =>
  (await page.request.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Accept: 'application/json', Referer: `${BASE_URL}/app/` } })).status();

const startCalls = (page: Page): string[] => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/auth/email/start') calls.push(r.postData() ?? '');
  });
  return calls;
};

async function emailStep(page: Page): Promise<void> {
  await open(page, '/app/auth/email');
  await expect(id(page, 'AUTH-12.email')).toBeVisible();
}

test.describe('AUTH-12 e-mail entry', () => {
  test('empty and invalid addresses are refused at the field, nothing is sent', async ({ page }) => {
    const calls = startCalls(page);
    await emailStep(page);
    await id(page, 'AUTH-12.cta.primary').click();
    await expect(id(page, 'AUTH-12.email.error')).toBeVisible();
    for (const bad of ['max@', 'max mustermann@web.de', '@web.de', 'max..m@web']) {
      await id(page, 'AUTH-12.email').fill(bad);
      await id(page, 'AUTH-12.cta.primary').click();
      await expect(id(page, 'AUTH-12.email.error'), bad).toBeVisible();
    }
    expect(calls).toEqual([]);
  });

  test('an address with umlauts gets an answer, never a crash or a silent stop', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: apiPath('auth/email/start') }]);
    await resetAuthLimits(['jörg.müller@e2e.speedclub.test']);
    await emailStep(page);
    await id(page, 'AUTH-12.email').fill('jörg.müller@e2e.speedclub.test');
    await id(page, 'AUTH-12.cta.primary').click();
    await expect(id(page, 'AUTH-12.email.error').or(id(page, 'AUTH-12.notice')).or(id(page, 'AUTH-13.root')).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('the address field stops at a sane maximum', async ({ page }) => {
    await emailStep(page);
    const long = `${'a'.repeat(300)}@e2e.speedclub.test`;
    await id(page, 'AUTH-12.email').fill(long);
    const value = await id(page, 'AUTH-12.email').inputValue();
    expect(value.length, "maxLength on the field: the server's max:255").toBeLessThanOrEqual(255);
  });

  test('a double tap asks for one code', async ({ page }) => {
    const member = await createGarageMember('hunt');
    await member.api.dispose();
    await resetAuthLimits([member.email]);
    const calls = startCalls(page);
    await emailStep(page);
    await id(page, 'AUTH-12.email').fill(member.email);
    await id(page, 'AUTH-12.cta.primary').dblclick();
    await expect(id(page, 'AUTH-13.root')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(calls).toHaveLength(1);
  });

  test('offline, Weiter says so and sends nothing', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: /\/api\/v1\// }, { status: 'network', url: /\/sanctum\/csrf-cookie$/ }]);
    const calls = startCalls(page);
    await emailStep(page);
    await id(page, 'AUTH-12.email').fill('offline.test@e2e.speedclub.test');
    await context.setOffline(true);
    await id(page, 'AUTH-12.cta.primary').click();
    await expect(page.locator('[data-testid$=".offline"]:visible, [data-testid="AUTH-12.notice"]:visible').first()).toBeVisible();
    expect(pathOf(page)).toBe('/app/auth/email');
    await context.setOffline(false);
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});

test.describe('code sign-in, sign-out, ended session', () => {
  test('an existing member signs in with the code and lands signed in; a reload keeps the session', async ({ page }) => {
    const member = await createGarageMember('hunt');
    await member.api.dispose();
    await resetAuthLimits([member.email]);
    await emailStep(page);
    await id(page, 'AUTH-12.email').fill(member.email);
    const since = Date.now();
    await id(page, 'AUTH-12.cta.primary').click();
    await expect(id(page, 'AUTH-13.root')).toBeVisible();
    const mail = await waitForMail(member.email, (m: { at: string; code: string | null }) => Date.parse(m.at) >= since - 1000 && !!m.code);
    await id(page, "AUTH-13.code").fill(mail.code ?? "");
    await expect.poll(() => pathOf(page), { timeout: 20_000 }).not.toMatch(/\/auth\//);
    await page.reload();
    expect(await meStatus(page)).toBe(200);
  });

  test('sign-out ends the session, and a reload stays signed out', async ({ page, expectFailedResponses }) => {
    // Signed out, the app's own auth/me answers 401.
    expectFailedResponses([{ status: 401, url: apiPath('auth/me') }]);
    const member = await createGarageMember('hunt');
    await useSession(page.context(), member.session);
    await open(page, '/app/settings');
    await id(page, 'SET-01.signOut').click();
    await id(page, 'SET-01.signOutDialog.confirm').click();
    await expect.poll(() => meStatus(page)).toBe(401);
    await page.reload();
    await open(page, '/app/garage');
    await expect(id(page, 'GAR-01.root').first()).toBeVisible();
    await expect(id(page, 'GAR-01.guest')).toBeVisible();
    // The old session is gone on the server too.
    const old = await member.api.get('auth/me');
    expect(old.status).toBe(401);
    await member.api.dispose();
  });

  test('a session that ended while the app is open asks to sign in again, no error page', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: /\/api\/v1\// }]);
    const member = await createGarageMember('hunt');
    await useSession(context, member.session);
    await open(page, '/app/garage');
    await expect(id(page, 'GAR-01.root').first()).toBeVisible();
    // The session ends on the server (as after a password change on another device).
    expect((await member.api.post('auth/logout', {}, { idempotent: false })).status).toBe(204);
    await member.api.dispose();
    await open(page, '/app/profile/edit');
    await expect(id(page, 'AUTH.sessionNotice').or(page.locator('[data-testid^="PROF-03.guest"], [data-testid^="AUTH-02.root"], [data-testid="PROF-01.guest"]').locator('visible=true')).first()).toBeVisible();
    await expect(page.locator('[data-testid$=".error"]:visible')).toHaveCount(0);
  });
});
