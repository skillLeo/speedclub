// F8 Account deletion (02_PRODUCT_SPEC §4 F8, 04_SCREEN_REGISTER §6 "F8 SET-13 + WEB-05"; m2.5-api-handover.md §3 SET-13 / WEB-05):
// in the app with re-auth (SET-13 → the final screen, signed out), and on the web without the app (WEB-05 /konto-loeschen, also with
// two-factor); afterwards the profile and the builds answer 404, the QR code is revoked (WEB-06 410) and a sign-in answers exactly
// like a wrong password. An export asked for before the deletion stays buildable and downloadable until it expires (lead ruling in
// m2.5-review.md, amends ADR-203 c).
//
// Every account is a member of this spec; the global teardown removes what is left of them.
import { request } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { resetAuthLimits, runTestJobs, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { noteDeletedMedia } from '../support/deleted-media.mjs';
import { apiPath, flowShot, id, isCall, members, named, open, pathOf, totp, webPath, type Member } from '../support/flow';
import { buildVehicle, expectStatus, GARAGE_PASSWORD } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';

/** auth/login as the web app sends it, without the harness's session cache: the raw answer. */
async function loginAnswer(email: string, password: string): Promise<{ status: number; code: string | undefined; message: string | undefined }> {
  await resetAuthLimits([email]);
  const api = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Accept: 'application/json', Origin: BASE_URL, Referer: `${BASE_URL}/app/` } });
  try {
    await api.get('/sanctum/csrf-cookie');
    const xsrf = (await api.storageState()).cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
    const answer = await api.post('/api/v1/auth/login', { data: { email, password }, headers: { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } });
    const body = await answer.json().catch(() => ({}));
    return { status: answer.status(), code: body.code, message: body.message };
  } finally {
    await api.dispose();
  }
}

/** What a stranger sees of a member and their build afterwards. */
async function expectGone(member: Member, vehicle: { slug: string; qr: { code: string } | null }): Promise<void> {
  const guest = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Accept: 'application/json' } });
  try {
    expect((await guest.get(`/api/v1/public/users/${member.username}`)).status(), 'profile API').toBe(404);
    expect((await guest.get(`/u/${member.username}`, { headers: { Accept: 'text/html' } })).status(), 'WEB-02').toBe(404);
    expect((await guest.get(`/v/${vehicle.slug}`, { headers: { Accept: 'text/html' } })).status(), 'WEB-01').toBe(404);
    const scan = await guest.get(`/C/${vehicle.qr?.code}`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    expect(scan.status(), 'the sticker is revoked').toBe(410);
    expect(await scan.text()).toContain('data-state="revoked"');
  } finally {
    await guest.dispose();
  }
  // Signing in reads exactly like a wrong password.
  const deleted = await loginAnswer(member.email, GARAGE_PASSWORD);
  const wrong = await loginAnswer(member.email, `${GARAGE_PASSWORD}-falsch`);
  expect(deleted).toEqual({ status: 401, code: 'invalid_credentials', message: wrong.message });
  expect(wrong.status).toBe(401);
}

test.describe('F8 in the app (SET-13)', () => {
  test('SET-13 with the password: signed out, the final screen; profile and build 404, QR revoked, login like a wrong password', async ({ page, context, expectFailedResponses }, testInfo) => {
    test.setTimeout(150_000);
    const [me, follower] = await members('f8app', 'f8appfollower');
    await named(me, 'Paula Schmitt');
    const vehicle = await buildVehicle(me.api);
    expect(vehicle.qr?.code).toBeTruthy();
    expectStatus(await follower.api.post(`users/${me.username}/follow`), 200, 'follow');
    await useSession(context, me.session);

    await open(page, '/app/settings');
    await id(page, 'SET-01.delete.body').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/data/delete');
    await expect(id(page, 'SET-13.consequences')).toBeVisible();

    // A wrong password first: refused at the server, nothing happens.
    expectFailedResponses([{ status: 422, url: apiPath('me/delete') }]);
    await id(page, 'SET-13.password').fill('nicht-mein-passwort');
    await id(page, 'SET-13.understood').click();
    await id(page, 'SET-13.cta.primary').click();
    await expect(id(page, 'SET-13.dialog')).toBeVisible();
    const refused = page.waitForResponse(isCall('POST', 'me/delete'));
    await id(page, 'SET-13.dialog.confirm').click();
    expect((await refused).status()).toBe(422);
    await expect(id(page, 'SET-13.password.error')).toBeVisible();
    expect((await me.api.get('auth/me')).status).toBe(200);

    await id(page, 'SET-13.password').fill(GARAGE_PASSWORD);
    await id(page, 'SET-13.cta.primary').click();
    await expect(id(page, 'SET-13.dialog')).toBeVisible();
    await flowShot(page, testInfo, 'SET-13-dialog');
    noteDeletedMedia(vehicle); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
    const deleted = page.waitForResponse(isCall('POST', 'me/delete'));
    await id(page, 'SET-13.dialog.confirm').click();
    expect((await deleted).status()).toBe(204);
    await expect.poll(() => pathOf(page)).toBe('/app/settings/data/deleted');
    await expect(id(page, 'SET-13.done.title')).toBeVisible();
    await flowShot(page, testInfo, 'SET-13-done');

    // This device is signed out, and so is every session of the account.
    expect((await me.api.get('auth/me')).status).toBe(401);
    // The follow went with the account.
    const following = expectStatus(await follower.api.get(`public/users/${follower.username}/following?per_page=50`), 200, 'GET following').data;
    expect(following.map((m: { username: string }) => m.username)).not.toContain(me.username);
    await expectGone(me, vehicle);
    // "Zur Startseite" leaves for Home as a guest.
    await id(page, 'SET-13.done.home').click();
    await expect.poll(() => pathOf(page)).toMatch(/^\/app\/?$/);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
  });
});

test.describe('F8 on the web (WEB-05)', () => {
  test('/konto-loeschen without the app: a wrong password reads like any wrong data, then the done state', async ({ page, expectFailedResponses }, testInfo) => {
    test.setTimeout(120_000);
    const [me] = await members('f8web');
    const vehicle = await buildVehicle(me.api);
    expectFailedResponses([{ status: 422, url: webPath('/konto-loeschen') }]);

    await page.goto('/konto-loeschen');
    await expect(page.locator('[data-testid="WEB-05.root"][data-state="form"]')).toBeVisible();
    await page.getByTestId('WEB-05.email').fill(me.email);
    await page.getByTestId('WEB-05.password').fill('falsches-passwort');
    await page.getByTestId('WEB-05.confirm').check();
    const wrong = page.waitForResponse((r) => new URL(r.url()).pathname === '/konto-loeschen' && r.request().method() === 'POST');
    await page.getByTestId('WEB-05.submit').click();
    expect((await wrong).status()).toBe(422);
    await expect(page.getByTestId('WEB-05.errors')).toBeVisible();
    await flowShot(page, testInfo, 'WEB-05-errors');
    expect((await me.api.get('auth/me')).status).toBe(200);

    await page.getByTestId('WEB-05.email').fill(me.email);
    await page.getByTestId('WEB-05.password').fill(GARAGE_PASSWORD);
    await page.getByTestId('WEB-05.confirm').check();
    noteDeletedMedia(vehicle); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
    const done = page.waitForResponse((r) => new URL(r.url()).pathname === '/konto-loeschen' && r.request().method() === 'POST');
    await page.getByTestId('WEB-05.submit').click();
    expect((await done).status()).toBe(200);
    await expect(page.locator('[data-testid="WEB-05.root"][data-state="done"]')).toBeVisible();
    await expect(page.getByTestId('WEB-05.done.title')).toBeVisible();
    await flowShot(page, testInfo, 'WEB-05-done');
    expect((await me.api.get('auth/me')).status).toBe(401);
    await expectGone(me, vehicle);
  });

  test('/konto-loeschen with two-factor on asks for the code and takes it', async ({ page, expectFailedResponses }) => {
    test.setTimeout(120_000);
    const [me] = await members('f8web2fa');
    const vehicle = await buildVehicle(me.api);
    const { secret } = expectStatus(await me.api.post('me/two-factor', { password: GARAGE_PASSWORD }, { idempotent: false }), 200, 'POST me/two-factor').data;
    expectStatus(await me.api.post('me/two-factor/confirm', { code: totp(secret) }, { idempotent: false }), 200, 'confirm two-factor');
    expectFailedResponses([{ status: 422, url: webPath('/konto-loeschen') }]);

    await page.goto('/konto-loeschen');
    await page.getByTestId('WEB-05.email').fill(me.email);
    await page.getByTestId('WEB-05.password').fill(GARAGE_PASSWORD);
    await page.getByTestId('WEB-05.confirm').check();
    const asked = page.waitForResponse((r) => new URL(r.url()).pathname === '/konto-loeschen' && r.request().method() === 'POST');
    await page.getByTestId('WEB-05.submit').click();
    expect((await asked).status()).toBe(422);
    await expect(page.getByTestId('WEB-05.code.error')).toBeVisible();
    await expect(page.getByTestId('WEB-05.code')).toBeFocused();

    await page.getByTestId('WEB-05.password').fill(GARAGE_PASSWORD);
    await page.getByTestId('WEB-05.code').fill(totp(secret, 1));
    if (!(await page.getByTestId('WEB-05.confirm').isChecked())) await page.getByTestId('WEB-05.confirm').check();
    noteDeletedMedia(vehicle); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
    const done = page.waitForResponse((r) => new URL(r.url()).pathname === '/konto-loeschen' && r.request().method() === 'POST');
    await page.getByTestId('WEB-05.submit').click();
    expect((await done).status()).toBe(200);
    await expect(page.locator('[data-testid="WEB-05.root"][data-state="done"]')).toBeVisible();
    await expectGone(me, vehicle);
  });
});

test.describe('F8 and the data export', () => {
  test('an export that was ready before the deletion stays downloadable', async () => {
    test.setTimeout(150_000);
    const [me] = await members('f8exportready');
    const vehicle = await buildVehicle(me.api);
    const asked = expectStatus(await me.api.post('me/export', { password: GARAGE_PASSWORD }), 202, 'POST me/export').data;
    await runTestJobs(me.email);
    const ready = (expectStatus(await me.api.get('me/exports'), 200, 'GET me/exports').data as { id: string; status: string; download_url: string }[]).find((e) => e.id === asked.id);
    expect(ready?.status).toBe('ready');
    noteDeletedMedia(vehicle); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
    expect((await me.api.post('me/delete', { password: GARAGE_PASSWORD }, { idempotent: false })).status).toBe(204);

    const guest = await request.newContext();
    try {
      const zip = await guest.get(ready?.download_url as string);
      expect(zip.status(), 'the signed link still downloads after the deletion').toBe(200);
      expect(zip.headers()['content-type']).toContain('application/zip');
    } finally {
      await guest.dispose();
    }
  });

  test('an export still queued at the deletion is built and mailed, and its link downloads', async () => {
    test.setTimeout(150_000);
    const [me] = await members('f8exportqueued');
    const vehicle = await buildVehicle(me.api);
    const asked = expectStatus(await me.api.post('me/export', { password: GARAGE_PASSWORD }), 202, 'POST me/export').data;
    expect(asked.status).toBe('queued');
    noteDeletedMedia(vehicle); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
    expect((await me.api.post('me/delete', { password: GARAGE_PASSWORD }, { idempotent: false })).status).toBe(204);

    const ran = await runTestJobs(me.email);
    expect(ran.ran, 'the export jobs survive the deletion').toContain('BuildDataExport');
    const mail = await waitForMail(me.email, (m) => m.text.includes(`/me/exports/${asked.id}/download`), { timeoutMs: 30_000 });
    const link = /https?:\/\/\S+\/api\/v1\/me\/exports\/\S+/.exec(mail.text)?.[0];
    expect(link, 'the mail carries the download link').toBeTruthy();
    const guest = await request.newContext();
    try {
      const zip = await guest.get(link as string);
      expect(zip.status()).toBe(200);
      expect(zip.headers()['content-type']).toContain('application/zip');
    } finally {
      await guest.dispose();
    }
  });
});
