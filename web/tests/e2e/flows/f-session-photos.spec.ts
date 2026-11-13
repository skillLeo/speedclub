// Round 11 of the security review (docs/reports/security/phase-1.md), on the member web at /app against the real API:
// - OBS-R11-1: the avatar of AUTH-09 and the avatar and cover of PROF-03 go up from a real file chooser. The prepared JPEG used
//   to be read back with fetch(blob:), which the export's CSP (connect-src 'self') refuses, so nothing left the browser.
// - SEC-S-06: the e-mail field is type="text" with inputmode="email", so a browser sends the domain as typed: Chromium's
//   type="email" turned straße.de into strasse.de, another domain and another account.
// - SEC-S-04: a save still under way at sign-out is aborted in both engines, so its late answer cannot replace the cookie of the
//   member who signs in next. WebKit lost that abort once the signals were garbage-collected.
//
// Every account is new and ends in E2E_DOMAIN; the global teardown deletes them (support/backend.mjs).
import type { Locator, Page, Response } from '@playwright/test';
import { apiLogin, useSession } from '../support/auth.mjs';
import { createMember, E2E_DOMAIN, resetAuthLimits } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { createGarageMember, expectStatus, GARAGE_PASSWORD, photoFile } from '../support/garage.mjs';
import { BASE_URL, qaUrl } from '../support/qa.mjs';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let sequence = 0;

/** The rendered element with this testID; screens under the top of a stack stay in the DOM, hidden. */
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const isPost = (path: string) => (r: Response) => r.url().startsWith(`${BASE_URL}/api/v1/${path}`) && r.request().method() === 'POST';

/** The account as the server sees it, with the cookies of this browser. */
async function meOf(page: Page): Promise<{ status: number; data?: Record<string, unknown> }> {
  const response = await page.request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Accept: 'application/json', Referer: `${BASE_URL}/app/` },
  });
  return { status: response.status(), data: response.ok() ? (await response.json()).data : undefined };
}

/** Picks a real photo through the browser's file chooser, and returns the upload's answer. */
async function uploadThrough(page: Page, button: string, path: string): Promise<Response> {
  const answer = page.waitForResponse(isPost(path), { timeout: 60_000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), id(page, button).click()]);
  await chooser.setFiles(photoFile('generic-exterior-01.jpg'));
  return answer;
}

test.describe('profile photos on the member web (OBS-R11-1)', () => {
  test('AUTH-09: the avatar goes up from the file chooser and shows', async ({ page }) => {
    const n = ++sequence;
    const email = `photos.setup.${RUN}.${n}@${E2E_DOMAIN}`;
    await createMember(email, `ph${RUN}${n}`.slice(0, 24), GARAGE_PASSWORD, 'profile');
    await resetAuthLimits([email]);
    await useSession(page.context(), await apiLogin(email, GARAGE_PASSWORD));
    await page.goto(qaUrl('/app/profile-setup'));
    await expect(id(page, 'AUTH-09.root')).toBeVisible();
    await expect(id(page, 'AUTH-09.avatar.image')).toHaveCount(0);

    const response = await uploadThrough(page, 'AUTH-09.pickAvatar', 'me/avatar');
    expect(response.status(), 'POST me/avatar').toBeGreaterThanOrEqual(200);
    expect(response.status(), 'POST me/avatar').toBeLessThan(300);
    // The server re-encodes: what it got was the JPEG the app prepared, not an empty part.
    expect(response.request().headers()['content-type']).toMatch(/^multipart\/form-data/);
    expect((await response.json()).data.avatar).toBeTruthy();
    await expect(id(page, 'AUTH-09.avatar.image')).toBeVisible();
    await expect(id(page, 'AUTH-09.avatarError')).toHaveCount(0);
    expect((await meOf(page)).data?.avatar).toBeTruthy();
  });

  test('PROF-03: the avatar and the cover go up from the file chooser and show', async ({ page }) => {
    const member = await createGarageMember('photos');
    await useSession(page.context(), member.session);
    await page.goto(qaUrl('/app/profile/edit'));
    await expect(id(page, 'PROF-03.images')).toBeVisible();
    await expect(id(page, 'PROF-03.avatar.image')).toHaveCount(0);

    const avatar = await uploadThrough(page, 'PROF-03.avatar.pick', 'me/avatar');
    expect(avatar.status(), 'POST me/avatar').toBeGreaterThanOrEqual(200);
    expect(avatar.status(), 'POST me/avatar').toBeLessThan(300);
    await expect(id(page, 'PROF-03.avatar.image')).toBeVisible();

    const cover = await uploadThrough(page, 'PROF-03.cover.pick', 'me/cover');
    expect(cover.status(), 'POST me/cover').toBeGreaterThanOrEqual(200);
    expect(cover.status(), 'POST me/cover').toBeLessThan(300);
    await expect(id(page, 'PROF-03.images.error')).toHaveCount(0);

    const me = expectStatus(await member.api.get('auth/me'), 200, 'GET auth/me').data;
    expect(me.avatar).toBeTruthy();
    expect(me.cover).toBeTruthy();
  });
});

test.describe('the e-mail field sends what was typed (SEC-S-06)', () => {
  test('AUTH-03: type="text" with the e-mail keyboard and autofill, and straße.de stays straße.de', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: /\/api\/v1\/auth\/login$/ }]);
    await page.goto(qaUrl('/app/sign-in'));
    const field = id(page, 'AUTH-03.email');
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('type', 'text');
    await expect(field).toHaveAttribute('inputmode', 'email');
    await expect(field).toHaveAttribute('autocomplete', 'email');
    await expect(field).toHaveAttribute('autocapitalize', 'none');
    await expect(field).toHaveAttribute('spellcheck', 'false');

    const typed = `max.${RUN}@straße.de`;
    await resetAuthLimits([typed]);
    await field.fill(typed);
    await id(page, 'AUTH-03.password').fill(`Kein-Konto-${RUN}`);
    const answer = page.waitForResponse(isPost('auth/login'));
    await id(page, 'AUTH-03.cta.primary').click();
    const sent = (await answer).request().postDataJSON() as { email: string };
    expect(sent.email).toBe(typed);
    expect(sent.email).not.toContain('strasse.de');
    await resetAuthLimits([typed]);
  });
});

test.describe('a save under way at sign-out (SEC-S-04)', () => {
  test('its late answer leaves the next member signed in, with no toast', async ({ page }) => {
    const a = await createGarageMember('late-a');
    const b = await createGarageMember('late-b');
    const bId = expectStatus(await b.api.get('auth/me'), 200, 'GET auth/me of B').data.id as string;
    await resetAuthLimits([b.email]);
    await useSession(page.context(), a.session);
    await page.goto(qaUrl('/app/profile/edit'));
    await expect(id(page, 'PROF-03.city')).toBeVisible();
    await id(page, 'PROF-03.city').fill(`Spaet-${RUN}`);

    // The server answers at once; the answer reaches the page only once released, as over a slow uplink.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let answered: () => void = () => undefined;
    const serverAnswered = new Promise<void>((resolve) => {
      answered = resolve;
    });
    await page.route('**/api/v1/me/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch();
      answered();
      await held;
      // An aborted request has no one left to answer.
      await route.fulfill({ response }).catch(() => undefined);
    });
    await id(page, 'PROF-03.cta.primary').click();
    await serverAnswered;

    // Sign-out through the app, heard by the server, without a page load that would end the save by itself; then B signs in on
    // the same tab before A's answer lands.
    await id(page, 'PROF-03.header.back').click();
    await id(page, 'PROF-01.settings').click();
    await id(page, 'SET-01.signOut').click();
    await id(page, 'SET-01.signOutDialog.confirm').click();
    // M4.6: the password sign-in is one step behind "Mit E-Mail fortfahren" (AUTH-12).
    await id(page, 'AUTH-02.provider.email').click();
    await id(page, 'AUTH-12.withPassword').click();
    await id(page, 'AUTH-03.email').fill(b.email);
    await id(page, 'AUTH-03.password').fill(GARAGE_PASSWORD);
    const login = page.waitForResponse(isPost('auth/login'));
    await id(page, 'AUTH-03.cta.primary').click();
    expect((await login).status(), 'B signs in').toBe(200);
    await expect.poll(async () => (await meOf(page)).data?.id).toBe(bId);

    release();
    // Long enough for a late Set-Cookie and a toast to land, were the request still under way.
    await page.waitForTimeout(3000);
    const after = await meOf(page);
    expect(after.status, 'auth/me with the browser’s cookie').toBe(200);
    expect(after.data?.id).toBe(bId);
    await expect(page.getByText('Profil gespeichert')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
