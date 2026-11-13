// F9 Auth 2.0, passwordless first (09 §7.2, §8.1) on the member web at /app, against the real API: Welcome → "Mit E-Mail
// fortfahren" (AUTH-12) → the 6-digit code from the local mailbox (AUTH-13, a wrong one first) → "Fast geschafft" (AUTH-09b)
// → username (AUTH-08) → profile (AUTH-09) → garage. Then the same-device magic link (WEB-12) and the link on another browser.
//
// Every account is new and ends in E2E_DOMAIN; the global teardown deletes them all (support/backend.mjs).
import type { Locator, Page } from '@playwright/test';
import { E2E_DOMAIN, resetAuthLimits, waitForMail } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { BASE_URL, qaUrl } from '../support/qa.mjs';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let sequence = 0;
const address = (label: string): string => `f9.${label}.${RUN}.${++sequence}@${E2E_DOMAIN}`;
const freshUsername = (): string => `f9${RUN}${++sequence}`.slice(0, 24);

const api = (path: string): RegExp => new RegExp(`/api/v1/${path.replace(/[/.]/g, '\\$&')}(\\?.*)?$`);
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const isPost = (path: string) => (r: { url: () => string; request: () => { method: () => string } }) =>
  r.url().startsWith(`${BASE_URL}/api/v1/${path}`) && r.request().method() === 'POST';
const wrongCode = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
/** The mail's "Anmelden" button: /auth/magic with the token in the fragment only (ADR-429 b). */
const MAGIC_LINK = /https?:\/\/[^\s"'<>]+\/auth\/magic#t=[A-Za-z0-9_-]+/;

/** The code mail sent to `email` after `since`. */
async function codeMail(email: string, since: number) {
  const mail = await waitForMail(email, (m) => Date.parse(m.at) >= since - 1000 && /\d{6}/.test(m.code ?? m.text));
  const code = mail.code ?? /\b(\d{6})\b/.exec(mail.text)?.[1];
  if (!code) throw new Error(`No code in the mail to ${email}`);
  return { code, magic: MAGIC_LINK.exec(mail.html)?.[0] ?? MAGIC_LINK.exec(mail.text)?.[0] ?? null };
}

/** AUTH-02 → AUTH-12 → AUTH-13 for `email`; answers the moment the code was asked for. */
async function askForCode(page: Page, email: string): Promise<number> {
  await resetAuthLimits([email]);
  await page.goto(qaUrl('/app/welcome'));
  await expect(id(page, 'AUTH-02.root')).toBeVisible();
  await id(page, 'AUTH-02.provider.email').click();
  await expect(id(page, 'AUTH-12.root')).toBeVisible();
  expect(pathOf(page)).toBe('/app/auth/email');
  await id(page, 'AUTH-12.email').fill(email);
  const since = Date.now();
  const started = page.waitForResponse(isPost('auth/email/start'));
  await id(page, 'AUTH-12.cta.primary').click();
  expect((await started).status()).toBe(202);
  await expect(id(page, 'AUTH-13.root')).toBeVisible();
  expect(pathOf(page)).toBe('/app/auth/code');
  return since;
}

test.describe('F9 e-mail code sign-up', () => {
  // POST auth/email/start of three new addresses at once deadlocks in login_attempts (reported to lane B); one at a time here.
  test.describe.configure({ mode: 'serial' });
  test('a new address: code, AGB, username, profile, garage', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: api('auth/email/verify') }]);
    const email = address('signup');
    const since = await askForCode(page, email);
    await expect(id(page, 'AUTH-13.subtitle')).toContainText('•••@');
    await expect(id(page, 'AUTH-13.resend')).toContainText(/Neuen Code in 0:\d\d/);

    const { code } = await codeMail(email, since);
    // A wrong code first: shake, cleared cells and the attempts left.
    const refused = page.waitForResponse(isPost('auth/email/verify'));
    await id(page, 'AUTH-13.code').fill(wrongCode(code));
    expect((await refused).status()).toBe(422);
    await expect(id(page, 'AUTH-13.code.error')).toContainText(/Noch \d Versuche?\./);
    await expect(id(page, 'AUTH-13.code')).toHaveValue('');

    const verified = page.waitForResponse(isPost('auth/email/verify'));
    await id(page, 'AUTH-13.code').fill(code);
    const answer = await verified;
    expect(answer.status()).toBe(200);
    const body = (await answer.json()).data;
    expect(body.is_new).toBe(true);
    expect(body.next).toBe('terms');

    // AUTH-09b: nothing goes before both boxes are ticked.
    await expect(id(page, 'AUTH-09b.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/auth/finish');
    await id(page, 'AUTH-09b.cta.primary').click();
    await expect(id(page, 'AUTH-09b.ageConfirmed.error')).toBeVisible();
    await id(page, 'AUTH-09b.ageConfirmed').click();
    await id(page, 'AUTH-09b.termsAccepted').click();
    const accepted = page.waitForResponse(isPost('me/onboarding/accept'));
    await id(page, 'AUTH-09b.cta.primary').click();
    expect((await accepted).status()).toBe(200);

    await expect(id(page, 'AUTH-08.root')).toBeVisible();
    await id(page, 'AUTH-08.username').fill(freshUsername());
    await expect(id(page, 'AUTH-08.available')).toBeVisible();
    await id(page, 'AUTH-08.cta.primary').click();
    await expect(id(page, 'AUTH-09.root')).toBeVisible();
    await id(page, 'AUTH-09.skip').click();
    await expect(id(page, 'GAR-01.root')).toBeVisible();
  });

  test('the magic link signs in on the device that asked for the code', async ({ page }) => {
    const email = address('magic');
    const since = await askForCode(page, email);
    const { magic } = await codeMail(email, since);
    expect(magic, 'the mail carries the Anmelden link').not.toBeNull();
    const link = new URL(magic ?? '');
    expect(link.search).toBe('');
    // The server's /auth/magic sends the browser on to the app, fragment and all.
    const verified = page.waitForResponse(isPost('auth/email/verify'));
    await page.goto(`${BASE_URL}${link.pathname}${link.hash}`);
    expect((await verified).status()).toBe(200);
    await expect(id(page, 'AUTH-09b.root')).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash, { message: 'WEB-12 clears the token from the address bar' }).toBe('');
  });

  test('on another browser the link says to type the code', async ({ page, browser }) => {
    const email = address('elsewhere');
    const since = await askForCode(page, email);
    const { magic } = await codeMail(email, since);
    const other = await browser.newContext();
    try {
      const tab = await other.newPage();
      const link = new URL(magic ?? '');
      await tab.goto(`${BASE_URL}${link.pathname}${link.hash}`);
      await expect(tab.locator('[data-testid="WEB-12.root"]:visible')).toBeVisible();
      await expect(tab.getByText('Gib den Code in der App ein')).toBeVisible();
    } finally {
      await other.close();
    }
  });
});
