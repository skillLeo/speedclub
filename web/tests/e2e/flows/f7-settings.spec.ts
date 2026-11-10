// F7 Profile & settings (02_PRODUCT_SPEC §4 F7, 04_SCREEN_REGISTER §6 "F7 PROF-01 → SET-01 → 07/10/11/05"; m2.5-api-handover.md):
// Profil › Einstellungen › Privatsphäre "Wer darf mir schreiben" (and what it does to messaging), Darstellung without a flash of the
// wrong theme, Sprache & Einheiten (a vehicle page follows the power unit), Ruhezeiten, two-factor set-up → sign out → sign in with a
// TOTP code and with a recovery code (AUTH-11), ending sessions, the e-mail change with the code from the dev mailbox, the data
// export with its status and download, Hilfe, Support kontaktieren and WEB-10 /kontakt.
//
// Every account is a member of this spec (createGarageMember); demo members are never changed. TOTP codes are computed here from
// the secret the server returned (support/flow.ts totp), on the real clock the server checks. The queue worker does not run
// locally, so the export's jobs of the test account run through support/backend.mjs runTestJobs, and no other job.
import type { Page } from '@playwright/test';
import { apiLogin, useSession } from '../support/auth.mjs';
import { resetAuthLimits, runTestJobs, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { apiPath, browserOf, clientId, de, flowShot, id, isCall, members, named, open, pathOf, rgbOf, row, totp, webPath, type Member } from '../support/flow';
import { buildVehicle, expectStatus, GARAGE_PASSWORD, memberApi } from '../support/garage.mjs';
import { BASE_URL, qaUrl } from '../support/qa.mjs';
import { tokens } from '../support/tokens.mjs';

async function settingsOf(member: Member): Promise<Record<string, any>> {
  return expectStatus(await member.api.get('me/settings'), 200, 'GET me/settings').data;
}

/** Signs in through AUTH-03 the way a member does; answers the auth/login response. */
async function signInWithForm(page: Page, email: string, password: string) {
  await resetAuthLimits([email]);
  await page.goto(qaUrl('/app/sign-in', { theme: 'carbon', locale: 'de' }));
  await id(page, 'AUTH-03.email').fill(email);
  await id(page, 'AUTH-03.password').fill(password);
  const login = page.waitForResponse(isCall('POST', 'auth/login'));
  await id(page, 'AUTH-03.cta.primary').click();
  return login;
}

async function signOutFromSettings(page: Page): Promise<void> {
  await open(page, '/app/settings');
  await id(page, 'SET-01.signOut').click();
  const out = page.waitForResponse(isCall('POST', 'auth/logout'));
  await id(page, 'SET-01.signOutDialog.confirm').click();
  expect((await out).status()).toBe(204);
  await expect.poll(() => pathOf(page)).toBe('/app/welcome');
}

test.describe('F7 privacy and appearance', () => {
  test('Profil › Einstellungen › Privatsphäre: "Niemand" closes PROF-02 Nachricht and new conversations for others', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(120_000);
    const [me, other] = await members('f7privacy', 'f7privacyother');
    await named(me, 'Nele Krüger');
    await useSession(context, me.session);
    await open(page, '/app/profile');
    await row(page, 'PROF-01.settings').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings');
    await row(page, 'SET-01.privacyRow').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/privacy');
    await expect(id(page, 'SET-07.whoCanMessage.everyone')).toHaveAttribute('aria-checked', 'true');

    const saved = page.waitForResponse(isCall('PATCH', 'me/settings'));
    await id(page, 'SET-07.whoCanMessage.nobody').click();
    const answer = await saved;
    expect(answer.status()).toBe(200);
    expect(answer.request().postDataJSON()).toEqual({ who_can_message: 'nobody' });
    await expect(id(page, 'SET-07.saved')).toHaveText(de('settings', 'privacy.saved'));
    await page.reload();
    await expect(id(page, 'SET-07.whoCanMessage.nobody')).toHaveAttribute('aria-checked', 'true');
    expect((await settingsOf(me)).who_can_message).toBe('nobody');

    // The other member: can_message false, the button disabled with the reason, and a start refused.
    expect(expectStatus(await other.api.get(`public/users/${me.username}`), 200, 'GET profile').data.can_message).toBe(false);
    const start = await other.api.post('conversations', { recipient: me.username, message: { type: 'text', body: 'Hallo' }, client_id: clientId() });
    expect(start.status).toBe(403);
    expect(start.body.code).toBe('cannot_message');
    const theirs = await browserOf(browser, other, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(theirs.page, `/app/u/${me.username}`);
      await expect(id(theirs.page, 'PROF-02.message')).toBeDisabled();
      await expect(id(theirs.page, 'PROF-02.messageHelper')).toBeVisible();
    } finally {
      await theirs.context.close();
    }

    // Back to "Alle": open again.
    const reopened = page.waitForResponse(isCall('PATCH', 'me/settings'));
    await id(page, 'SET-07.whoCanMessage.everyone').click();
    expect((await reopened).status()).toBe(200);
    expect(expectStatus(await other.api.get(`public/users/${me.username}`), 200, 'GET profile').data.can_message).toBe(true);
  });

  test('Darstellung: Schwarz applies at once and the next load never shows another theme first', async ({ page }) => {
    // A guest: the choice lives on the device. No qaTheme, which would override the choice.
    const black = rgbOf(tokens.themes.black.color['bg.canvas']);
    await page.goto(qaUrl('/app/settings/appearance', { locale: 'de' }));
    await expect(id(page, 'SET-10.option.carbon')).toBeVisible();
    await id(page, 'SET-10.option.black').click();
    await expect(id(page, 'SET-10.option.black')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(black);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'black');

    // Every frame of the next load, from the first one the browser paints, already paints Schwarz. A frame is sampled in
    // requestAnimationFrame, which runs right before each paint; the static HTML's carbon before the head script never paints.
    await page.addInitScript(() => {
      const samples: { theme: string | null; background: string }[] = [];
      Object.assign(window, { __themeSamples: samples });
      const sample = () => {
        const root = document.documentElement;
        if (root) samples.push({ theme: root.getAttribute('data-theme'), background: getComputedStyle(root).backgroundColor });
      };
      const frame = () => {
        sample();
        if (samples.length < 400) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.reload();
    await expect(id(page, 'SET-10.option.black')).toHaveAttribute('aria-checked', 'true');
    const samples = await page.evaluate(() => (window as unknown as { __themeSamples: { theme: string | null; background: string }[] }).__themeSamples);
    const painted = samples.filter((s) => s.background !== 'rgba(0, 0, 0, 0)');
    expect(painted.length, 'the document was sampled while it loaded').toBeGreaterThan(0);
    expect(painted.filter((s) => s.background !== black).slice(0, 5), `no frame in another theme (of ${painted.length})`).toEqual([]);
    expect(samples.filter((s) => s.theme !== null && s.theme !== 'black')).toEqual([]);
  });

  test('Sprache & Einheiten: English and kW (PS) apply at once, and the vehicle page follows', async ({ page, context }) => {
    test.setTimeout(120_000);
    const [me] = await members('f7language');
    const vehicle = await buildVehicle(me.api);
    await useSession(context, me.session);
    // No qaLocale: it would hold the language.
    await page.goto(qaUrl(`/app/v/${vehicle.slug}`, { theme: 'carbon' }));
    // The strip sets value and unit in elements of their own, so its text reads "280PS".
    await expect(id(page, 'VEH-01.specStrip')).toContainText(/280\s*PS/);

    await page.goto(qaUrl('/app/settings/language', { theme: 'carbon' }));
    await expect(id(page, 'SET-11.language.de')).toHaveAttribute('aria-checked', 'true');
    const language = page.waitForResponse(isCall('PATCH', 'me/settings'));
    await id(page, 'SET-11.language.en').click();
    expect((await language).request().postDataJSON()).toEqual({ locale: 'en' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(id(page, 'SET-11.language.en')).toHaveAttribute('aria-checked', 'true');

    const unit = page.waitForResponse(isCall('PATCH', 'me/settings'));
    await id(page, 'SET-11.power.kw_ps').click();
    expect((await unit).request().postDataJSON()).toEqual({ power_display: 'kw_ps' });
    await expect(id(page, 'SET-11.example')).toContainText(/\d+\s*kW\s*\(\d+\s*PS\)/);
    expect(await settingsOf(me)).toMatchObject({ locale: 'en', power_display: 'kw_ps' });

    await page.goto(qaUrl(`/app/v/${vehicle.slug}`, { theme: 'carbon' }));
    await expect(id(page, 'VEH-01.specStrip')).toContainText(/206\s*kW/);
    await expect(id(page, 'VEH-01.specStrip')).not.toContainText(/280\s*PS/);
  });

  test('Mitteilungen: Ruhezeiten on, the start one hour later, saved once after the steps', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [me] = await members('f7quiet');
    await useSession(context, me.session);
    const initial = (await settingsOf(me)).notification_prefs.quiet_hours as { enabled: boolean };
    await open(page, '/app/settings/notifications');
    const quiet = id(page, 'SET-09.quietEnabled.switch');
    await expect(quiet).toHaveAttribute('aria-checked', String(initial.enabled));
    // Off: the times cannot be changed. Switch it off first where the default has it on.
    if (initial.enabled) {
      const off = page.waitForResponse(isCall('PATCH', 'me/settings'));
      await quiet.click();
      expect((await off).request().postDataJSON()).toEqual({ notification_prefs: { quiet_hours: { enabled: false } } });
    }
    await expect(id(page, 'SET-09.from.stepper.increase')).toBeDisabled();
    const enabled = page.waitForResponse(isCall('PATCH', 'me/settings'));
    await quiet.click();
    expect((await enabled).request().postDataJSON()).toEqual({ notification_prefs: { quiet_hours: { enabled: true } } });
    await expect(id(page, 'SET-09.from.stepper.increase')).toBeEnabled();

    const before = (await settingsOf(me)).notification_prefs.quiet_hours as { from: string; to: string };
    const [h, m] = before.from.split(':').map(Number) as [number, number];
    const later = (h * 60 + m + 60) % (24 * 60);
    const expected = `${String(Math.floor(later / 60)).padStart(2, '0')}:${String(later % 60).padStart(2, '0')}`;
    const patches: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname === '/api/v1/me/settings') patches.push(r.postDataJSON());
    });
    const saved = page.waitForResponse(isCall('PATCH', 'me/settings'));
    await id(page, 'SET-09.from.stepper.increase').click();
    await id(page, 'SET-09.from.stepper.increase').click();
    await expect(id(page, 'SET-09.from.stepper.value')).toHaveText(expected);
    expect((await saved).status()).toBe(200);
    // Debounced: the two steps make one save.
    expect(patches).toEqual([{ notification_prefs: { quiet_hours: { from: expected, to: before.to } } }]);
    expect((await settingsOf(me)).notification_prefs.quiet_hours).toEqual({ enabled: true, from: expected, to: before.to });
  });
});

test.describe('F7 security', () => {
  test('SET-05 two-factor set-up → sign out → AUTH-11 with a TOTP code, then with a recovery code', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const [me] = await members('f7twofactor');
    // Signed in through the form, not with a harness session: that one puts the cached member back on every load (useSession),
    // which a member who signed out would not have.
    expect((await signInWithForm(page, me.email, GARAGE_PASSWORD)).status()).toBe(200);
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    await open(page, '/app/settings/security/two-factor');
    await expect(id(page, 'SET-05.status')).toContainText(de('settings', 'twoFactor.statusOff'));
    await id(page, 'SET-05.cta.primary').click();
    await expect(id(page, 'SET-05.startSheet')).toBeVisible();
    await id(page, 'SET-05.startSheet.password').fill(GARAGE_PASSWORD);
    const started = page.waitForResponse(isCall('POST', 'me/two-factor'));
    await id(page, 'SET-05.startSheet.confirm').click();
    const setup = await started;
    expect(setup.status()).toBe(200);
    expect(setup.headers()['cache-control']).toContain('no-store');
    const { secret } = (await setup.json()).data as { secret: string };
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // The manual key on screen is the same secret, in groups of four.
    await expect(id(page, 'SET-05.qr.shortCode')).toBeVisible();
    expect((await id(page, 'SET-05.qr.shortCode').innerText()).replace(/\s+/g, '')).toBe(secret);
    await flowShot(page, testInfo, 'SET-05-setup');

    const confirmed = page.waitForResponse(isCall('POST', 'me/two-factor/confirm'));
    await id(page, 'SET-05.code').fill(totp(secret));
    const answer = await confirmed;
    expect(answer.status()).toBe(200);
    const codes = (await answer.json()).data.recovery_codes as string[];
    expect(codes).toHaveLength(10);
    await expect(id(page, 'SET-05.codes')).toBeVisible();
    await expect(id(page, 'SET-05.codes.list')).toContainText(codes[0] as string);
    await flowShot(page, testInfo, 'SET-05-recoveryCodes');
    await expect(id(page, 'SET-05.codes.done')).toBeDisabled();
    await id(page, 'SET-05.codes.saved').click();
    await id(page, 'SET-05.codes.done').click();
    await expect(id(page, 'SET-05.status')).toContainText(de('settings', 'twoFactor.statusOn'));

    // Sign out, sign in: the password alone is not enough.
    await signOutFromSettings(page);
    const login = await signInWithForm(page, me.email, GARAGE_PASSWORD);
    expect((await login.json()).data).toMatchObject({ two_factor_required: true, expires_in: 300 });
    await expect.poll(() => pathOf(page)).toBe('/app/two-factor');
    await expect(id(page, 'AUTH-11.code')).toBeVisible();
    await flowShot(page, testInfo, 'AUTH-11-challenge');
    // The step after the one SET-05 used: each step counts once, ±1 is accepted (handover §3).
    const challenge = page.waitForResponse(isCall('POST', 'auth/two-factor/challenge'));
    await id(page, 'AUTH-11.code').fill(totp(secret, 1));
    expect((await challenge).status()).toBe(200);
    await expect.poll(() => pathOf(page)).toMatch(/^\/app\/?$/);
    await expect(id(page, 'HOME-01.root')).toBeVisible();

    // Again with a recovery code, typed in lower case; it is spent afterwards.
    await signOutFromSettings(page);
    await signInWithForm(page, me.email, GARAGE_PASSWORD);
    await expect.poll(() => pathOf(page)).toBe('/app/two-factor');
    await id(page, 'AUTH-11.toggle').click();
    await expect(id(page, 'AUTH-11.recovery')).toBeVisible();
    await flowShot(page, testInfo, 'AUTH-11-recovery');
    const recovery = codes[0] as string;
    await id(page, 'AUTH-11.recovery').fill(recovery.toLowerCase());
    const withRecovery = page.waitForResponse(isCall('POST', 'auth/two-factor/challenge'));
    await id(page, 'AUTH-11.cta.primary').click();
    const recovered = await withRecovery;
    expect(recovered.status()).toBe(200);
    expect(recovered.request().postDataJSON().recovery_code.toLowerCase()).toBe(recovery.toLowerCase());
    await expect(id(page, 'HOME-01.root')).toBeVisible();

    // The same recovery code a second time: refused.
    await signOutFromSettings(page);
    const again = await signInWithForm(page, me.email, GARAGE_PASSWORD);
    const { challenge: token } = (await again.json()).data as { challenge: string };
    const spent = await page.request.post(`${BASE_URL}/api/v1/auth/two-factor/challenge`, {
      data: { challenge: token, recovery_code: recovery, device_name: 'QA', platform: 'android', app_version: '0.2.0' },
      headers: { Accept: 'application/json' },
    });
    expect(spent.status()).toBe(422);
  });

  test('SET-06: end one other session, then all others; this one stays', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const [me] = await members('f7sessions');
    await resetAuthLimits([me.email]);
    const second = await memberApi(await apiLogin(me.email, GARAGE_PASSWORD));
    const third = await memberApi(await apiLogin(me.email, GARAGE_PASSWORD));
    try {
      await useSession(context, me.session);
      await open(page, '/app/settings/security/sessions');
      const rows = page.locator('[data-testid^="SET-06.row."][data-testid$=".revoke"]:visible');
      await expect(rows).toHaveCount(2);
      await expect(page.locator('[data-testid^="SET-06.row."][data-testid$=".current"]:visible')).toHaveCount(1);
      await flowShot(page, testInfo, 'SET-06-sessions');

      await rows.first().click();
      await expect(id(page, 'SET-06.dialog')).toBeVisible();
      const one = page.waitForResponse(isCall('DELETE', 'me/sessions/[id]'));
      await id(page, 'SET-06.dialog.confirm').click();
      expect((await one).status()).toBe(204);
      await expect(id(page, 'SET-06.toast')).toContainText(de('settings', 'sessions.signedOutOne', { name: '' }).trim());
      await expect(rows).toHaveCount(1);
      const alive = [(await second.get('auth/me')).status, (await third.get('auth/me')).status].sort();
      expect(alive, 'exactly one of the two other sessions ended').toEqual([200, 401]);

      await id(page, 'SET-06.signOutOthers').click();
      const others = page.waitForResponse(isCall('DELETE', 'me/sessions'));
      await id(page, 'SET-06.dialog.confirm').click();
      expect((await others).status()).toBe(204);
      await expect(id(page, 'SET-06.onlyThis')).toBeVisible();
      expect((await second.get('auth/me')).status).toBe(401);
      expect((await third.get('auth/me')).status).toBe(401);
      expect((await me.api.get('auth/me')).status).toBe(200);
    } finally {
      await second.dispose();
      await third.dispose();
    }
  });

  test('SET-03: a new address with the code from the mail; the account then answers with it', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const [me] = await members('f7email');
    const fresh = me.email.replace('@', '.new@');
    await useSession(context, me.session);
    await open(page, '/app/settings/account');
    await row(page, 'SET-02.email').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/account/email');
    await id(page, 'SET-03.email').fill(fresh);
    await id(page, 'SET-03.password').fill(GARAGE_PASSWORD);
    const requested = page.waitForResponse(isCall('POST', 'me/email'));
    await id(page, 'SET-03.cta.primary').click();
    expect((await requested).status()).toBe(202);
    await expect(id(page, 'SET-03.sentTo')).toContainText(fresh);
    await flowShot(page, testInfo, 'SET-03-code');

    const mail = await waitForMail(fresh, (m) => m.code !== null);
    expect(mail.subject).toContain(mail.code as string);
    const confirmed = page.waitForResponse(isCall('POST', 'me/email/confirm'));
    await id(page, 'SET-03.code').fill(mail.code as string);
    expect((await confirmed).status()).toBe(200);
    await expect(id(page, 'SET-03.changed')).toHaveText(de('settings', 'email.changed'));
    expect(expectStatus(await me.api.get('auth/me'), 200, 'GET auth/me').data.email).toBe(fresh);
  });

  test('SET-12: the export is requested after the password, shows its status and becomes downloadable; a second one waits', async ({ page, context, expectFailedResponses }, testInfo) => {
    test.setTimeout(180_000);
    const [me] = await members('f7export');
    await buildVehicle(me.api);
    await useSession(context, me.session);
    await open(page, '/app/settings/data/export');
    await expect(id(page, 'SET-12.empty')).toBeVisible();
    await id(page, 'SET-12.cta.primary').click();
    await expect(id(page, 'SET-12.reauth')).toBeVisible();
    await flowShot(page, testInfo, 'SET-12-reauth');
    await id(page, 'SET-12.reauth.password').fill(GARAGE_PASSWORD);
    const requested = page.waitForResponse(isCall('POST', 'me/export'));
    await id(page, 'SET-12.reauth.confirm').click();
    const answer = await requested;
    expect(answer.status()).toBe(202);
    expect(answer.request().headers()['idempotency-key']).toBeTruthy();
    const exportId = (await answer.json()).data.id as string;
    await expect(id(page, 'SET-12.requested')).toHaveText(de('settings', 'export.requested'));
    await expect(id(page, `SET-12.export.${exportId}`)).toBeVisible();
    await expect(id(page, 'SET-12.cta.primary')).toBeDisabled();

    // The worker's part, for this account only; then the row reads ready with a download.
    await runTestJobs(me.email);
    const exports = expectStatus(await me.api.get('me/exports'), 200, 'GET me/exports').data as { id: string; status: string; download_url: string | null }[];
    const ready = exports.find((e) => e.id === exportId);
    expect(ready?.status).toBe('ready');
    const mail = await waitForMail(me.email, (m) => m.text.includes('/me/exports/'));
    expect(mail.text).toContain(`/me/exports/${exportId}/download`);
    await page.reload();
    await expect(id(page, `SET-12.export.${exportId}.download`)).toBeVisible();
    const zip = await page.request.get(ready?.download_url as string);
    expect(zip.status()).toBe(200);
    expect(zip.headers()['content-type']).toContain('application/zip');
    expect(zip.headers()['cache-control']).toContain('no-store');

    // One per 24 h: the second request is refused with when it is possible again.
    expectFailedResponses([{ status: 429, url: apiPath('me/export') }]);
    await id(page, 'SET-12.cta.primary').click();
    await id(page, 'SET-12.reauth.password').fill(GARAGE_PASSWORD);
    const second = page.waitForResponse(isCall('POST', 'me/export'));
    await id(page, 'SET-12.reauth.confirm').click();
    expect((await second).status()).toBe(429);
    await expect(id(page, 'SET-12.notice')).toBeVisible();
  });
});

test.describe('F7 help and support', () => {
  test('SET-14 Hilfe: the list and an article', async ({ page }) => {
    await open(page, '/app/settings/help');
    await row(page, 'SET-14.row.two-factor').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/help/two-factor');
    await expect(id(page, 'SET-14.article.title')).toBeVisible();
    await expect(id(page, 'SET-14.article.body')).not.toBeEmpty();
  });

  test('SET-15 Support kontaktieren creates a ticket with a reference', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [me] = await members('f7support');
    await useSession(context, me.session);
    await open(page, '/app/settings/help');
    await row(page, 'SET-14.contact').click();
    await expect.poll(() => pathOf(page)).toBe('/app/settings/help/contact');
    await id(page, 'SET-15.category.qr').click();
    await id(page, 'SET-15.subject').fill('Sticker lässt sich nicht scannen');
    await id(page, 'SET-15.message').fill('Der QR-Sticker auf der Heckscheibe wird von keinem Handy erkannt.');
    const sent = page.waitForResponse(isCall('POST', 'support/tickets'));
    await id(page, 'SET-15.cta.primary').click();
    const answer = await sent;
    expect(answer.status()).toBe(201);
    expect(answer.request().postDataJSON()).toEqual({ category: 'qr', subject: 'Sticker lässt sich nicht scannen', message: 'Der QR-Sticker auf der Heckscheibe wird von keinem Handy erkannt.' });
    expect((await answer.json()).data.reference).toMatch(/^SC-[0-9A-Z]{8}$/);
    await expect(id(page, 'SET-15.sent')).toHaveText(de('settings', 'contact.sent'));
  });

  test('WEB-10 /kontakt as a guest: errors in place, then the reference', async ({ page, expectFailedResponses }, testInfo) => {
    expectFailedResponses([{ status: 422, url: webPath('/kontakt') }]);
    await page.goto('/kontakt');
    await expect(page.locator('[data-testid="WEB-10.root"][data-state="form"]')).toBeVisible();
    const empty = page.waitForResponse((r) => new URL(r.url()).pathname === '/kontakt' && r.request().method() === 'POST');
    await page.getByTestId('WEB-10.submit').click();
    expect((await empty).status()).toBe(422);
    await expect(page.getByTestId('WEB-10.errors')).toBeVisible();
    await flowShot(page, testInfo, 'WEB-10-errors');

    await page.getByTestId('WEB-10.name').fill('Sven Hoffmann');
    await page.getByTestId('WEB-10.email').fill(`f7.contact.${Date.now().toString(36)}@e2e.speedclub.test`);
    await page.getByTestId('WEB-10.category').selectOption('account');
    await page.getByTestId('WEB-10.message').fill('Ich komme nicht mehr in mein Konto, die Mail kommt nicht an.');
    const sent = page.waitForResponse((r) => new URL(r.url()).pathname === '/kontakt' && r.request().method() === 'POST');
    await page.getByTestId('WEB-10.submit').click();
    expect((await sent).status()).toBe(200);
    await expect(page.locator('[data-testid="WEB-10.root"][data-state="sent"]')).toBeVisible();
    await expect(page.getByTestId('WEB-10.sent.body')).toContainText(/SC-[0-9A-Z]{8}/);
    await flowShot(page, testInfo, 'WEB-10-sent');
  });
});
