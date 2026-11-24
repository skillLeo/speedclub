// QA H1 garage: GAR-05 basics (umlauts and emoji persist, max length, double tap, offline, discard warning, delete the car),
// GAR-10 a new mod (double tap creates one), the vehicle page after an edit, with a new member and a built car per test.
import type { Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { id, isCall, open, pathOf } from '../support/flow';
import { buildVehicle, createGarageMember } from '../support/garage.mjs';

async function withCar(page: Page) {
  const member = await createGarageMember('hunt');
  const car = await buildVehicle(member.api, { photos: 1 });
  await useSession(page.context(), member.session);
  return { member, car };
}

const countCalls = (page: Page, method: string, path: RegExp): string[] => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === method && path.test(new URL(r.url()).pathname)) calls.push(r.url());
  });
  return calls;
};

test.describe('GAR-05 basics', () => {
  test('nickname, colour and description with umlauts and emoji persist; VEH-01 shows the description', async ({ page }) => {
    const { member, car } = await withCar(page);
    await open(page, `/app/garage/${car.id}/basics`);
    await expect(id(page, 'GAR-05.nickname')).toBeVisible();
    await id(page, 'GAR-05.nickname').fill('Größenwahn 🚗');
    await id(page, 'GAR-05.color').fill('Bayside Blue Perlmutt-Ölgrün');
    await id(page, 'GAR-05.description').fill('Straßenauto mit Überrollbügel, Öl alle 5.000 km – ß ä ö ü 🏁');
    const patched = page.waitForResponse(isCall('PATCH', `vehicles/${car.id}`));
    await id(page, 'GAR-05.cta.primary').click();
    expect((await patched).status()).toBe(200);
    await expect(id(page, 'GAR-05.saved')).toBeVisible();
    await open(page, `/app/garage/${car.id}/basics`);
    await expect(id(page, 'GAR-05.nickname')).toHaveValue('Größenwahn 🚗');
    await expect(id(page, 'GAR-05.color')).toHaveValue('Bayside Blue Perlmutt-Ölgrün');
    await expect(id(page, 'GAR-05.description')).toHaveValue('Straßenauto mit Überrollbügel, Öl alle 5.000 km – ß ä ö ü 🏁');
    // The nickname is a search aid ("So findet man dein Auto in der Suche"), not shown on the page; the description is.
    await open(page, `/app/v/${car.slug}`);
    await expect(page.getByText('Straßenauto mit Überrollbügel', { exact: false }).locator('visible=true').first()).toBeVisible();
    await member.api.dispose();
  });

  test('the text fields stop at their maximum and the maximum saves', async ({ page }) => {
    const { member, car } = await withCar(page);
    await open(page, `/app/garage/${car.id}/basics`);
    await expect(id(page, 'GAR-05.nickname')).toBeVisible();
    for (const field of ['nickname', 'color', 'description']) {
      await id(page, `GAR-05.${field}`).fill('Ö'.repeat(3000));
      const max = Number(await id(page, `GAR-05.${field}`).getAttribute('maxlength'));
      expect(max, `${field} has a maxlength`).toBeGreaterThan(0);
      expect((await id(page, `GAR-05.${field}`).inputValue()).length).toBe(max);
    }
    const patched = page.waitForResponse(isCall('PATCH', `vehicles/${car.id}`));
    await id(page, 'GAR-05.cta.primary').click();
    expect((await patched).status(), 'the longest value the field takes is one the server takes').toBe(200);
    await member.api.dispose();
  });

  test('a double tap on Speichern saves once', async ({ page }) => {
    const { member, car } = await withCar(page);
    const calls = countCalls(page, 'PATCH', new RegExp(`/api/v1/vehicles/${car.id}$`));
    await open(page, `/app/garage/${car.id}/basics`);
    await id(page, 'GAR-05.nickname').fill('Doppelt');
    await id(page, 'GAR-05.cta.primary').dblclick();
    await expect(id(page, 'GAR-05.saved')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(calls).toHaveLength(1);
    await member.api.dispose();
  });

  test('offline, Speichern is off with the offline banner; online again it saves', async ({ page, context, expectFailedResponses }) => {
    expectFailedResponses([{ status: 'network', url: /\/api\/v1\// }]);
    const { member, car } = await withCar(page);
    await open(page, `/app/garage/${car.id}/basics`);
    await id(page, 'GAR-05.nickname').fill('Offline');
    await context.setOffline(true);
    await expect(id(page, 'GAR-05.offlineBanner').first()).toBeVisible();
    await expect(id(page, 'GAR-05.cta.primary')).toBeDisabled();
    await context.setOffline(false);
    await expect(id(page, 'GAR-05.cta.primary')).toBeEnabled();
    await id(page, 'GAR-05.cta.primary').click();
    await expect(id(page, 'GAR-05.saved')).toBeVisible();
    await member.api.dispose();
  });

  test('leaving dirty with the browser back asks first', async ({ page }) => {
    const { member, car } = await withCar(page);
    await open(page, `/app/garage/${car.id}`);
    await expect(id(page, 'GAR-02.root').first()).toBeVisible();
    // In the app, not a new document: the browser back must reach the app's own history.
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).locator('visible=true').first().click();
    await id(page, 'GAR-02.editSheet.basics.body').click();
    await expect(id(page, 'GAR-05.nickname')).toBeVisible();
    await id(page, 'GAR-05.nickname').fill('Ungespeichert');
    await page.goBack();
    await expect(id(page, 'GAR-05.discard.keep')).toBeVisible();
    await id(page, 'GAR-05.discard.keep').click();
    await expect(id(page, 'GAR-05.nickname')).toHaveValue('Ungespeichert');
    await page.goBack();
    await id(page, 'GAR-05.discard.discard').click();
    await expect.poll(() => pathOf(page)).toBe(`/app/garage/${car.id}`);
    await member.api.dispose();
  });

  test('Fahrzeug löschen removes the car, also after a reload, and its page is gone', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 404, url: /\/api\/v1\// }]);
    const { member, car } = await withCar(page);
    await open(page, `/app/garage/${car.id}/basics`);
    await id(page, 'GAR-05.delete').click();
    await id(page, 'GAR-05.deleteDialog.confirm').dblclick();
    await expect(id(page, 'GAR-05.deleted')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/garage');
    await page.reload();
    await expect(page.locator(`[data-testid*="${car.id}"]:visible`)).toHaveCount(0);
    const list = await member.api.get('me/vehicles');
    expect((list.body?.data ?? []).map((v: { id: string }) => v.id)).not.toContain(car.id);
    await member.api.dispose();
  });
});

test.describe('GAR-10 a new mod', () => {
  test('a double tap on Speichern creates one mod', async ({ page }) => {
    const { member, car } = await withCar(page);
    const calls = countCalls(page, 'POST', new RegExp(`/api/v1/vehicles/${car.id}/mods$`));
    await open(page, `/app/garage/${car.id}/mods/new?category=wheels_tires`);
    await page.getByTestId('GAR-10.field.wheel_model').fill('LM Ölgrün');
    await page.getByTestId('GAR-10.field.diameter').fill('19');
    await id(page, 'GAR-10.cta.primary').dblclick();
    await expect(id(page, 'GAR-10.saved')).toBeVisible();
    await page.waitForTimeout(1500);
    const mods = await member.api.get(`vehicles/${car.id}/mods`);
    expect(mods.body?.data ?? [], `POSTs sent: ${calls.length}`).toHaveLength(1);
    await member.api.dispose();
  });
});
