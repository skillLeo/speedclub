// M4.7 account security on the member web (09 §7.9, §8.4): SET-21 Sicherheitsaktivität lists the sign-ins and marks the row a link
// names; "Das war ich nicht" asks first, secures the account (every session ends, a support request opens) and shows the result on
// /auth/secure. The login alert's link (/auth/secure#t=…) opens the same screen without a session and posts nothing before the tap:
// mail scanners open links and run their scripts.
//
// Two sign-ins of a fresh member from two API contexts: the second is a new browser, so the server writes a `new_device` row and
// mails the alert with the link. Every account ends in E2E_DOMAIN and goes with the global teardown.
import type { Locator, Page } from '@playwright/test';
import { apiLogin, useSession } from '../support/auth.mjs';
import { createMember, E2E_DOMAIN, resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { signInFromNewBrowser } from '../support/newBrowser';
import { BASE_URL, qaUrl } from '../support/qa.mjs';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Drosselklappe-${RUN}-Acht`;
let sequence = 0;

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const SECURE_LINK = /https?:\/\/[^\s"'<>]+\/auth\/secure#t=([0-9A-Za-z]{26}\.[A-Za-z0-9_-]+)/;

/** A fresh member signed in twice: the first browser is known, the second is new and triggers the alert mail. */
async function memberWithAlert(label: string) {
  const email = `m47.${label}.${RUN}.${++sequence}@${E2E_DOMAIN}`;
  await createMember(email, `m47${RUN}${sequence}`.slice(0, 24), PASSWORD);
  await resetAuthLimits([email]);
  const first = await apiLogin(email, PASSWORD);
  const since = Date.now();
  await signInFromNewBrowser(email, PASSWORD);
  const mail = await waitForMail(email, (m) => Date.parse(m.at) >= since - 1000 && SECURE_LINK.test(m.html), { timeoutMs: 30_000 });
  const token = SECURE_LINK.exec(mail.html)?.[1] ?? '';
  return { email, first, token };
}

test.describe('M4.7 security activity and "Das war ich nicht"', () => {
  test('SET-21 lists the new sign-in, marks the linked row, and "Das war ich nicht" secures the account', async ({ page, context, expectFailedResponses }) => {
    test.setTimeout(120_000);
    // A request already on its way when the account was secured hears that the session is over.
    expectFailedResponses([{ status: 401, url: /\/api\/v1\// }]);
    const { first, token } = await memberWithAlert('activity');
    const eventId = token.split('.')[0] ?? '';
    await useSession(context, first);
    await page.setViewportSize({ width: 390, height: 844 });

    // The alert's row, as HOME-02 and the mail link it: marked, with "Das war ich nicht".
    await page.goto(qaUrl(`/app/settings/security/activity?event=${eventId}`, { locale: 'de' }));
    await expect(id(page, 'SET-21.root')).toBeVisible();
    const marked = page.locator(`[data-testid="SET-21.row.${eventId.toLowerCase()}.marked"]:visible`);
    await expect(marked).toBeVisible();
    await expect(page.locator(`[data-testid="SET-21.row.${eventId.toLowerCase()}.title"]:visible`)).toHaveText('Anmeldung auf einem neuen Gerät');
    // No IP address anywhere on the page (ADR-433).
    await expect(id(page, 'SET-21.list')).not.toContainText(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);

    // Asks first; nothing is sent until the confirm.
    let posted = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().split('?')[0] === `${BASE_URL}/api/v1/me/security/secure`) posted += 1;
    });
    await page.locator(`[data-testid="SET-21.row.${eventId.toLowerCase()}.notMe"]:visible`).click();
    await expect(id(page, 'SET-21.dialog')).toBeVisible();
    expect(posted).toBe(0);
    const secured = page.waitForResponse((r) => r.url().split('?')[0] === `${BASE_URL}/api/v1/me/security/secure` && r.request().method() === 'POST');
    await id(page, 'SET-21.dialog.confirm').click();
    const response = await secured;
    expect(response.status()).toBe(200);
    expect(response.request().headers()['idempotency-key']).toBeTruthy();
    const body = (await response.json()) as { data: { ticket_reference: string; signed_out: boolean } };
    expect(body.data.signed_out).toBe(true);

    // The result, with the support reference, and the session is over on this browser too.
    await expect(id(page, 'AUTH-17.done')).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/app/auth/secure');
    await expect(id(page, 'AUTH-17.ticket')).toHaveText(body.data.ticket_reference);
    const me = await page.request.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Accept: 'application/json' } });
    expect(me.status()).toBe(401);
    await id(page, 'AUTH-17.cta.primary').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/app/auth/email');
  });

  test('the alert link opens /auth/secure without a session and posts nothing before the tap', async ({ browser }) => {
    test.setTimeout(120_000);
    const { first, token } = await memberWithAlert('link');
    // A browser without any session: the owner may be locked out.
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await guest.newPage();
      let posted = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().split('?')[0] === `${BASE_URL}/api/v1/auth/secure-account`) posted += 1;
      });
      // The mail links the site root; the web redirects /auth/secure to /app/auth/secure and keeps the fragment.
      await page.goto(`${BASE_URL}${qaUrl('/auth/secure', { locale: 'de' })}#t=${token}`);
      await expect(id(page, 'AUTH-17.ready')).toBeVisible();
      // The token leaves the address bar.
      await expect.poll(() => new URL(page.url()).hash).toBe('');
      await page.waitForTimeout(1500);
      expect(posted).toBe(0);

      const secured = page.waitForResponse((r) => r.url().split('?')[0] === `${BASE_URL}/api/v1/auth/secure-account`);
      await id(page, 'AUTH-17.cta.primary').click();
      expect((await secured).status()).toBe(200);
      expect(posted).toBe(1);
      await expect(id(page, 'AUTH-17.done')).toBeVisible();
      await expect(id(page, 'AUTH-17.ticket')).toHaveText(/^SC-[0-9A-Z]+$/);

      // The member's other session is over.
      const api = await page.context().request;
      const cookieHeader = first.cookies.map((cookie: { name: string; value: string }) => `${cookie.name}=${cookie.value}`).join('; ');
      const me = await api.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Accept: 'application/json', Cookie: cookieHeader, Referer: `${BASE_URL}/app/` } });
      expect(me.status()).toBe(401);

      // Used once: the same link again says it no longer works.
      await page.goto(`${BASE_URL}${qaUrl('/app/auth/secure', { locale: 'de' })}#t=${token}`);
      await expect(id(page, 'AUTH-17.ready')).toBeVisible();
      await id(page, 'AUTH-17.cta.primary').click();
      await expect(id(page, 'AUTH-17.invalid')).toBeVisible();
    } finally {
      await guest.close();
    }
  });
});
