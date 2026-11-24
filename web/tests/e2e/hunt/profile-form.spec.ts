// QA H1 form matrix on PROF-03 Profil bearbeiten (settings: profile), a new member per test: umlauts and emoji persist after a
// reload, max length, a double tap saves once, an offline save is refused with a notice, the discard warning on leaving dirty,
// and a session that ended under the form.
import type { Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { apiPath, de, id, isCall, open, pathOf } from '../support/flow';
import { createGarageMember } from '../support/garage.mjs';

const EDIT = '/app/profile/edit';

async function signedIn(page: Page) {
  const member = await createGarageMember('hunt');
  await useSession(page.context(), member.session);
  await open(page, EDIT);
  await expect(id(page, 'PROF-03.displayName')).toBeVisible();
  return member;
}

const save = (page: Page) => id(page, 'PROF-03.cta.primary');

test.describe('PROF-03 form matrix', () => {
  test('umlauts, ß and emoji are saved and still there after a reload', async ({ page }) => {
    const member = await signedIn(page);
    await id(page, 'PROF-03.displayName').fill('Jörg Müßiggang');
    await id(page, 'PROF-03.city').fill('Düsseldorf-Öhringen');
    await id(page, 'PROF-03.bio').fill('Straße, Öl & Größe – Ölwechsel alle 10.000 km 🏁🚗');
    const patched = page.waitForResponse(isCall('PATCH', 'me/profile'));
    await save(page).click();
    expect((await patched).status()).toBe(200);
    await expect(id(page, 'PROF-03.saved')).toBeVisible();
    await open(page, EDIT);
    await expect(id(page, 'PROF-03.displayName')).toHaveValue('Jörg Müßiggang');
    await expect(id(page, 'PROF-03.city')).toHaveValue('Düsseldorf-Öhringen');
    await expect(id(page, 'PROF-03.bio')).toHaveValue('Straße, Öl & Größe – Ölwechsel alle 10.000 km 🏁🚗');
    const me = await member.api.get('auth/me');
    expect(me.body.data.display_name).toBe('Jörg Müßiggang');
    await member.api.dispose();
  });

  test('the fields stop at their maximum length and the maximum saves', async ({ page }) => {
    await signedIn(page);
    await id(page, 'PROF-03.displayName').fill('');
    await id(page, 'PROF-03.displayName').pressSequentially('Ä'.repeat(70), { delay: 0 });
    await expect(id(page, 'PROF-03.displayName')).toHaveValue('Ä'.repeat(60));
    await id(page, 'PROF-03.bio').fill('ü'.repeat(520));
    expect(((await id(page, 'PROF-03.bio').inputValue()) ?? '').length).toBeLessThanOrEqual(500);
    const patched = page.waitForResponse(isCall('PATCH', 'me/profile'));
    await save(page).click();
    expect((await patched).status()).toBe(200);
    await expect(id(page, 'PROF-03.saved')).toBeVisible();
  });

  test('an empty name is allowed or refused with a message, never a silent failure', async ({ page }) => {
    await signedIn(page);
    await id(page, 'PROF-03.city').fill('Köln');
    await id(page, 'PROF-03.displayName').fill('   ');
    await save(page).click();
    // Either it saves (an empty name falls back to the username) or the field says why not.
    await expect(id(page, 'PROF-03.saved').or(page.locator('[data-testid^="PROF-03.displayName"][data-testid$="error"]:visible, [role="alert"]:visible')).first()).toBeVisible();
  });

  test('a double tap on Speichern saves once', async ({ page }) => {
    await signedIn(page);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname === '/api/v1/me/profile') calls.push(r.url());
    });
    await id(page, 'PROF-03.city').fill('Hamburg');
    await save(page).dblclick();
    await expect(id(page, 'PROF-03.saved')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(calls).toHaveLength(1);
  });

  test('offline, Speichern sends nothing and says why; online again it saves', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: /\/api\/v1\// }]);
    await signedIn(page);
    await id(page, 'PROF-03.city').fill('Bremen');
    await context.setOffline(true);
    await expect(id(page, 'PROF-03.offline').first()).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await context.setOffline(false);
    await expect(save(page)).toBeEnabled();
    const patched = page.waitForResponse(isCall('PATCH', 'me/profile'));
    await save(page).click();
    expect((await patched).status()).toBe(200);
  });

  test('leaving dirty with the browser back asks first; Weiter bearbeiten keeps the text', async ({ page }) => {
    const member = await createGarageMember('hunt');
    await useSession(page.context(), member.session);
    await open(page, '/app/profile');
    // In the app, not a new document: the browser back must reach the app's own history.
    await id(page, 'PROF-01.edit').click();
    await expect(id(page, 'PROF-03.displayName')).toBeVisible();
    await id(page, 'PROF-03.city').fill('München');
    await page.goBack();
    await expect(id(page, 'PROF-03.discard.keep')).toBeVisible();
    await id(page, 'PROF-03.discard.keep').click();
    await expect(id(page, 'PROF-03.city')).toHaveValue('München');
    expect(pathOf(page)).toBe(EDIT);
    await id(page, 'PROF-03.header.back').click();
    await expect(id(page, 'PROF-03.discard.discard')).toBeVisible();
    await id(page, 'PROF-03.discard.discard').click();
    await expect.poll(() => pathOf(page)).toBe('/app/profile');
  });

  test('a session that ended under the form keeps the text and saves nothing', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 401, url: apiPath('me/profile') }, { status: 401, url: /\/api\/v1\// }]);
    await signedIn(page);
    await id(page, 'PROF-03.city').fill('Leipzig');
    await context.clearCookies();
    await save(page).click();
    // BH-30: the form stays with its text, and the app asks to sign in again.
    await expect(id(page, 'PROF-03.city')).toHaveValue('Leipzig');
    await expect(page.getByText(de('auth', 'session.expiredTitle'), { exact: false }).or(page.locator('[data-testid*="held"]:visible, [data-testid*="signIn"]:visible')).first()).toBeVisible();
  });
});
