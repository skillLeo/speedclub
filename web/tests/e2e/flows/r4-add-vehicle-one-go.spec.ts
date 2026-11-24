// R4B-005 (client round 4 hunt, High): adding a first car in one go, as a member does — every step reached by "Weiter", so
// the earlier steps stay in the stack under the review. Before the fix "Veröffentlichen" published the car (200) but GAR-04
// never came: an earlier step's discard guard blocked the replace with "Änderungen verwerfen?", and "Weiter bearbeiten" left an
// endless skeleton. F2 deep-links every step and so never had that stack. R4B-L01: browser back from GAR-04 then went back into the
// finished wizard. Fresh member per test (support/garage.mjs).
import type { Locator, Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { catalogueIds, createGarageMember, expectStatus, photoFile, SKYLINE } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';

const ULID = '[0-9a-z]{26}';
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const photoTiles = (page: Page): Locator => page.locator('[data-testid^="GAR-03.photos.photo."][role="button"]:visible');

async function pick(page: Page, field: string, option: string | number, search?: string): Promise<void> {
  await id(page, `GAR-03.${field}`).click();
  if (search) await page.getByTestId(`GAR-03.${field}Sheet.search`).fill(search);
  await id(page, `GAR-03.${field}Sheet.option.${option}`).click();
  await expect(page.locator(`[data-testid="GAR-03.${field}Sheet"]:visible`)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false)).toBe(false);
}

test.describe('R4B-005 add a first car in one go', () => {
  test('Fahrzeug → Technik → Fotos → Veröffentlichen lands on GAR-04 without "Änderungen verwerfen?", and back leaves the wizard', async ({ page }) => {
    test.setTimeout(240_000);
    const member = await createGarageMember('r4-one-go');
    await useSession(page.context(), member.session);
    const ids = await catalogueIds(member.api, SKYLINE);

    await page.goto(qaUrl('/app/garage'));
    await id(page, 'GAR-01.add').click();
    await expect(id(page, 'GAR-03.root')).toBeVisible();

    // Step 1, then "Weiter" (a push: this screen stays under the next one).
    await pick(page, 'make', ids.make_id, 'Nissan');
    await pick(page, 'model', ids.model_id, 'Skyline');
    await pick(page, 'generation', String(ids.generation_id));
    await page.getByTestId('GAR-03.year').fill('2002');
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${ULID}/specs$`));
    const vehicleId = new URL(page.url()).pathname.split('/')[3] as string;

    // Step 2: a power value (the step whose form came back dirty after its save), "Weiter".
    await page.getByTestId('GAR-03.powerValue').fill('343');
    await page.getByTestId('GAR-03.powerValue').blur();
    await id(page, 'GAR-03.specs.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/photos$`));

    // Step 3: one photo, "Weiter".
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), id(page, 'GAR-03.photos.add').click()]);
    await chooser.setFiles(photoFile('generic-exterior-01.jpg'));
    await id(page, 'GAR-03.plateBlur.confirm').click();
    await expect(photoTiles(page)).toHaveCount(1, { timeout: 60_000 });
    await id(page, 'GAR-03.photos.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/review$`));

    // Step 4: publish → GAR-04, and no discard dialog on the way.
    await id(page, 'GAR-03.review.cta.primary').click();
    await expect(id(page, 'GAR-04.root')).toBeVisible({ timeout: 30_000 });
    await expect(id(page, 'GAR-04.title')).toHaveText('Dein Build ist live.');
    await expect(page.locator('[data-testid^="GAR-03.discard"]:visible')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/app/published/${vehicleId}`);
    const published = expectStatus(await member.api.get(`vehicles/${vehicleId}`), 200, 'GET vehicle').data;
    expect(published.status).toBe('published');

    // R4B-L01: browser back from GAR-04 leaves the wizard. The browser still holds an entry per step pushed before the review
    // (photos, specs, the new draft's step 1); the step it lands on sees the published car and closes the wizard, so the member is
    // back where the wizard was opened (the garage) and never sees a finished step again.
    await page.goBack();
    await expect(id(page, 'GAR-01.root')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => new URL(page.url()).pathname).toBe('/app/garage');
    await expect(page.locator('[data-testid="GAR-03.root"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid^="GAR-03.discard"]:visible')).toHaveCount(0);
    // A step of the published car opened directly (an old link, a reload) leaves the same way: to what lies below the modal, or the
    // garage when nothing does.
    await page.goto(qaUrl(`/app/add-vehicle/${vehicleId}/specs`));
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).not.toContain('/add-vehicle/');
    await expect(page.locator('[data-testid="GAR-03.root"]:visible')).toHaveCount(0);
  });
});
