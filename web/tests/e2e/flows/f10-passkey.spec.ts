// F10 Passkeys (09 §8.2, ADR-409) on the member web at /app with a Chromium CDP virtual authenticator (platform, resident keys,
// user verification): password sign-in → AUTH-14 "Passkey hinzufügen" → sign-out → AUTH-02 "Mit Passkey anmelden" (usernameless)
// → Start; then SET-19 lists the passkey, renames it and removes it (recent authentication from the passkey sign-in).
//
// Chromium only: WebKit has no virtual authenticator. Every account ends in E2E_DOMAIN and is deleted by the global teardown.
import type { CDPSession, Locator, Page } from '@playwright/test';
import { createMember, E2E_DOMAIN, resetAuthLimits } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { BASE_URL, qaUrl } from '../support/qa.mjs';

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Ansaugbruecke-${RUN}-Sieben`;

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
/** The POST to exactly this API path (me/passkeys, not me/passkeys/options). */
const isPost = (path: string) => (r: { url: () => string; request: () => { method: () => string } }) =>
  r.url().split('?')[0] === `${BASE_URL}/api/v1/${path}` && r.request().method() === 'POST';

/** A platform authenticator that holds discoverable credentials and verifies the user without a prompt. */
async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

test.describe('F10 passkey sign-in', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The CDP virtual authenticator exists in Chromium only.');

  test('add on AUTH-14, sign in usernameless, manage in SET-19', async ({ page }) => {
    const email = `f10.passkey.${RUN}@${E2E_DOMAIN}`;
    await createMember(email, `f10${RUN}`.slice(0, 24), PASSWORD);
    await resetAuthLimits([email]);
    const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

    // Password sign-in through AUTH-12; the device can hold a passkey, so AUTH-14 comes before Start.
    await page.goto(qaUrl('/app/welcome'));
    await id(page, 'AUTH-02.provider.email').click();
    await id(page, 'AUTH-12.withPassword').click();
    await id(page, 'AUTH-03.email').fill(email);
    await id(page, 'AUTH-03.password').fill(PASSWORD);
    await id(page, 'AUTH-03.cta.primary').click();
    await expect(id(page, 'AUTH-14.root')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/app/auth/passkey-offer');

    const stored = page.waitForResponse(isPost('me/passkeys'));
    await id(page, 'AUTH-14.cta.primary').click();
    const added = await stored;
    expect(added.status()).toBe(201);
    expect((await added.json()).data.name).toBeTruthy();
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.isResidentCredential).toBe(true);

    // Sign out in the app, then the passkey button of Welcome: no address, no code.
    await id(page, 'tab.profile').click();
    await id(page, 'PROF-01.settings').click();
    await id(page, 'SET-01.signOut').click();
    await id(page, 'SET-01.signOutDialog.confirm').click();
    await expect(id(page, 'AUTH-02.root')).toBeVisible();
    await expect(id(page, 'AUTH-02.provider.passkey')).toBeVisible();
    const verified = page.waitForResponse(isPost('auth/passkeys/verify'));
    await id(page, 'AUTH-02.provider.passkey').click();
    const answer = await verified;
    expect(answer.status()).toBe(200);
    expect((await answer.json()).data.member.email).toBe(email);
    await expect(id(page, 'HOME-01.root')).toBeVisible();

    // SET-19: the passkey with its provider line; rename, then remove (the passkey sign-in counts as recent authentication).
    await page.goto(qaUrl('/app/settings/security/sign-in'));
    await expect(id(page, 'SET-19.root')).toBeVisible();
    const row = page.locator('[data-testid^="SET-19.passkey."][data-testid$=".rename"]:visible');
    await expect(row).toHaveCount(1);
    await row.click();
    await id(page, 'SET-19.renameSheet.name').fill('Testrechner Chromium');
    await id(page, 'SET-19.renameSheet.save').click();
    await expect(page.getByText('Testrechner Chromium')).toBeVisible();
    await page.locator('[data-testid^="SET-19.passkey."][data-testid$=".remove"]:visible').click();
    await id(page, 'SET-19.dialog.confirm').click();
    await expect(id(page, 'SET-19.passkeys.empty')).toBeVisible();
  });
});
