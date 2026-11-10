// F3 Modifications (02_PRODUCT_SPEC §4, §3.3, FS-6) on the member web at /app, against the real API: vehicle → Mods →
// Hinzufügen → category → the category form with its live preview line → Speichern → the build update in Verlauf, which
// the owner can hide; edit and remove keep the history. Edges: inline validation, a 422 of the server on its field, a
// server error that keeps the form, and the discard guard.
//
// Every test has a member of its own under E2E_DOMAIN with one published R34 built through the API
// (support/garage.mjs); the global teardown deletes them with everything they own.
import type { Locator, Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { closeBuildUpdates } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { BBS_WHEELS, buildVehicle, createGarageMember, expectStatus, type MemberApi } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';
import { expectText } from '../support/text.mjs';

const FS6_LINE = 'BBS LM · 19″ × 9,5J ET35 · 255/35 R19';
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const api = (path: string): RegExp => new RegExp(`/api/v1/${path}(\\?.*)?$`);
const modRows = (page: Page): Locator => page.locator('[data-testid^="GAR-09.mod."][role="link"]:visible, [data-testid^="GAR-09.mod."][role="button"]:visible');

/** A fresh member with one published vehicle, signed in in this browser. */
async function ownerWithVehicle(page: Page, label: string, mods: object[] = []) {
  const member = await createGarageMember(label);
  const vehicle = await buildVehicle(member.api, { photos: 1, mods });
  await useSession(page.context(), member.session);
  return { member, vehicle };
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(qaUrl(path));
}

async function updatesOf(memberApi: MemberApi, vehicleId: string) {
  return expectStatus(await memberApi.get(`vehicles/${vehicleId}/updates`), 200, 'GET updates').data as {
    id: string;
    summary: string;
    hidden: boolean;
  }[];
}

/** FS-6's example, typed the way a member does: autocomplete for the brand, "9,5" with a comma, the tyre size as digits. */
async function fillWheels(page: Page): Promise<void> {
  await page.getByTestId('GAR-10.field.wheel_brand').fill('BB');
  await id(page, 'GAR-10.field.wheel_brand.suggestions').getByText('BBS', { exact: true }).click();
  await page.getByTestId('GAR-10.field.wheel_model').fill('LM');
  await page.getByTestId('GAR-10.field.diameter').fill('19');
  await page.getByTestId('GAR-10.field.width_front').fill('9,5');
  await page.getByTestId('GAR-10.field.et_front').fill('35');
  await page.getByTestId('GAR-10.field.tyre_size_front').fill('2553519');
}

test.describe('F3 modifications', () => {
  test('vehicle → Mods → Räder & Reifen → Speichern, with the build update in Verlauf and the mod on VEH-02', async ({ page, browser }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'add');
    await open(page, `/app/garage/${vehicle.id}`);
    await expect(id(page, 'GAR-02.root')).toBeVisible();
    await id(page, 'GAR-02.tool.mods').click();
    await expect(id(page, 'GAR-09.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods`);
    await expect(id(page, 'GAR-09.empty')).toBeVisible();

    await id(page, 'GAR-09.empty.action').click();
    await expect(id(page, 'GAR-09.categories')).toBeVisible();
    await id(page, 'GAR-09.categories.wheels_tires').click();
    await expect(id(page, 'GAR-10.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods/new`);
    expect(new URL(page.url()).searchParams.get('category')).toBe('wheels_tires');

    await fillWheels(page);
    await expect(page.getByTestId('GAR-10.field.tyre_size_front')).toHaveValue('255/35 R19');
    await expectText(id(page, 'GAR-10.preview.text'), FS6_LINE);
    await expect(id(page, 'GAR-10.preview')).toHaveAttribute('aria-label', `Vorschau: ${FS6_LINE}`);
    await page.getByTestId('GAR-10.installedOn').fill('032023');
    await page.getByTestId('GAR-10.cost').fill('2.400');
    await id(page, 'GAR-10.cta.primary').click();

    await expect(id(page, 'GAR-10.saved')).toHaveText('Modifikation gespeichert. Im Verlauf erscheint ein Eintrag.');
    await expect(id(page, 'GAR-09.list')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods`);
    await expect(modRows(page)).toHaveCount(1);
    const mods = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data;
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({
      title: 'BBS LM',
      status: 'installed',
      installed_on: '2023-03',
      summary_line: FS6_LINE,
      fields: { wheel_brand: 'BBS', wheel_model: 'LM', diameter: 19, width_front: 9.5, et_front: 35, tyre_size_front: '255/35 R19' },
    });
    expect(mods[0].cost).toMatchObject({ cents: 240000 });
    await expect(modRows(page)).toContainText('BBS LM');

    // The build update, written by the server; cost makes no entry of its own.
    const updates = await updatesOf(member.api, vehicle.id);
    expect(updates).toHaveLength(1);
    const update = updates[0] as (typeof updates)[number];
    expect(update.summary).toContain(`Räder & Reifen: Serie → ${FS6_LINE}`);

    // A stranger sees it in Verlauf, and the mod on VEH-02.
    const guest = await browser.newContext();
    try {
      const stranger = await guest.newPage();
      await stranger.goto(qaUrl(`/app/v/${vehicle.slug}?tab=history`));
      await expect(stranger.locator(`[data-testid="VEH-01.update.${update.id}"]:visible`)).toContainText('BBS LM');
      await stranger.goto(qaUrl(`/app/v/${vehicle.slug}/mods/${mods[0].id}`));
      await expect(stranger.locator('[data-testid="VEH-02.title"]:visible')).toHaveText('BBS LM');
      await expect(stranger.locator('[data-testid="VEH-02.legalDisclaimer"]:visible')).toBeVisible();
    } finally {
      await guest.close();
    }
  });

  // The second half of the add flow, on a mod saved through the API: the server writes the same build update for it.
  test('the owner hides the build update in GAR-11: gone for a stranger, still listed for the owner, and back again', async ({ page, browser }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'hide', [BBS_WHEELS]);
    const updates = await updatesOf(member.api, vehicle.id);
    expect(updates).toHaveLength(1);
    const update = updates[0] as (typeof updates)[number];
    expect(update.summary).toContain(`Räder & Reifen: Serie → ${FS6_LINE}`);

    const guest = await browser.newContext();
    try {
      const stranger = await guest.newPage();
      await stranger.goto(qaUrl(`/app/v/${vehicle.slug}?tab=history`));
      await expect(stranger.locator(`[data-testid="VEH-01.update.${update.id}"]:visible`)).toContainText('BBS LM');

      // The owner hides the entry in GAR-11: gone for the stranger, still listed for the owner.
      await open(page, `/app/garage/${vehicle.id}/history`);
      await expect(id(page, `GAR-11.entry.${update.id}`)).toBeVisible();
      await id(page, `GAR-11.entry.${update.id}.toggle`).click();
      await expect(id(page, 'GAR-11.toast')).toHaveText('Eintrag ausgeblendet');
      await expect(id(page, `GAR-11.entry.${update.id}.hidden`)).toHaveText('Ausgeblendet');
      expect((await updatesOf(member.api, vehicle.id))[0]?.hidden).toBe(true);
      // The public API leaves it out at once; a stranger who opens the page now does not see it. (The device that showed
      // it a moment ago may keep its cached page for the 60 s staleTime, which is the cache doing its job.)
      const publicUpdates = await stranger.request.get(`/api/v1/public/vehicles/${vehicle.slug}/updates`, { headers: { Accept: 'application/json' } });
      expect(publicUpdates.status()).toBe(200);
      expect((await publicUpdates.json()).data).toEqual([]);
      const another = await browser.newContext();
      try {
        const next = await another.newPage();
        await next.goto(qaUrl(`/app/v/${vehicle.slug}?tab=history`));
        await expect(next.locator('[data-testid="VEH-01.historyEmpty"]:visible')).toBeVisible();
        await expect(next.locator(`[data-testid="VEH-01.update.${update.id}"]`)).toHaveCount(0);
      } finally {
        await another.close();
      }

      await id(page, `GAR-11.entry.${update.id}.toggle`).click();
      await expect(id(page, 'GAR-11.toast')).toHaveText('Eintrag wieder sichtbar');
      await expect(id(page, `GAR-11.entry.${update.id}.hidden`)).toHaveCount(0);
      expect((await updatesOf(member.api, vehicle.id))[0]?.hidden).toBe(false);
    } finally {
      await guest.close();
    }
  });

  // Changes merge into one entry for 10 minutes (§3.2), and an add and remove inside one window never happened
  // (BuildUpdates::merged). So each step here closes the window first, as the passing time would.
  test('editing and removing a mod keep the history', async ({ page }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'edit', [BBS_WHEELS]);
    const [mod] = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data;
    const added = await updatesOf(member.api, vehicle.id);
    expect(added).toHaveLength(1);
    await closeBuildUpdates(vehicle.id);

    await open(page, `/app/garage/${vehicle.id}/mods`);
    await id(page, `GAR-09.mod.${mod.id}`).click();
    await expect(id(page, 'GAR-10.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods/${mod.id}`);
    await expect(page.getByTestId('GAR-10.field.wheel_model')).toHaveValue('LM');
    await expectText(id(page, 'GAR-10.preview.text'), FS6_LINE);

    await page.getByTestId('GAR-10.field.wheel_model').fill('RS');
    await expectText(id(page, 'GAR-10.preview.text'), 'BBS RS · 19″ × 9,5J ET35 · 255/35 R19');
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-09.list')).toBeVisible();
    await expect(id(page, `GAR-09.mod.${mod.id}`)).toContainText('BBS RS');
    const edited = await updatesOf(member.api, vehicle.id);
    expect(edited, 'the edit is an entry of its own, newest first').toHaveLength(2);
    expect(edited[0]?.summary).toContain('BBS LM');
    expect(edited[0]?.summary).toContain('BBS RS');
    expect(edited[1]?.id).toBe(added[0]?.id);
    await closeBuildUpdates(vehicle.id);

    await id(page, `GAR-09.mod.${mod.id}`).click();
    await id(page, 'GAR-10.delete').click();
    await expect(id(page, 'GAR-10.deleteDialog')).toBeVisible();
    await id(page, 'GAR-10.deleteDialog.confirm').click();
    await expect(id(page, 'GAR-10.deleted')).toHaveText('Modifikation gelöscht');
    await expect(id(page, 'GAR-09.empty')).toBeVisible();
    expect(expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data).toEqual([]);
    // Soft: the removal is a new entry, and the two before it stay as they were.
    const removed = await updatesOf(member.api, vehicle.id);
    expect(removed).toHaveLength(3);
    expect(removed.slice(1).map((u) => u.id)).toEqual(edited.map((u) => u.id));
    expect(removed[0]?.summary).toContain('BBS RS');
  });

  test('the form refuses what does not fit, and a 422 of the server lands on its field', async ({ page, expectFailedResponses }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'invalid');
    await open(page, `/app/garage/${vehicle.id}/mods/new?category=wheels_tires`);
    await expect(id(page, 'GAR-10.root')).toBeVisible();

    // Inline, before anything is sent: a diameter outside 13–24.
    let posted = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/v1\/vehicles\/[^/]+\/mods$/.test(new URL(r.url()).pathname)) posted += 1;
    });
    await fillWheels(page);
    await page.getByTestId('GAR-10.field.diameter').fill('30');
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-10.field.diameter.error')).toBeVisible();
    expect(posted).toBe(0);
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods/new`);

    // The server's 422 under `fields.et_front` goes to that field, and nothing else is lost.
    const mods = api(`vehicles/${vehicle.id}/mods`);
    expectFailedResponses([{ status: 422, url: mods }]);
    await page.route(mods, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: JSON.stringify({
              message: 'Die Angaben sind ungültig.',
              code: 'validation_failed',
              errors: { 'fields.et_front': ['Die Einpresstiefe muss zwischen −50 und 70 liegen.'] },
            }),
          })
        : route.fallback(),
    );
    await page.getByTestId('GAR-10.field.diameter').fill('19');
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-10.field.et_front.error')).toHaveText('Die Einpresstiefe muss zwischen −50 und 70 liegen.');
    expect(posted).toBe(1);
    await expect(page.getByTestId('GAR-10.field.wheel_model')).toHaveValue('LM');
    expect(expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data).toEqual([]);
  });

  test('a server error keeps the form and says so, and the next try saves', async ({ page, expectFailedResponses }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'server');
    const mods = api(`vehicles/${vehicle.id}/mods`);
    expectFailedResponses([{ status: 500, url: mods }]);
    await page.route(mods, (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Server Error"}' }) : route.fallback(),
    );
    await open(page, `/app/garage/${vehicle.id}/mods`);
    await id(page, 'GAR-09.empty.action').click();
    await id(page, 'GAR-09.categories.wheels_tires').click();
    await fillWheels(page);
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-10.notice')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods/new`);
    await expectText(id(page, 'GAR-10.preview.text'), FS6_LINE);

    await page.unroute(mods);
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-09.list')).toBeVisible();
    expect(expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data).toHaveLength(1);
  });

  test('a changed mod asks before it is left', async ({ page }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'guard');
    await open(page, `/app/garage/${vehicle.id}/mods`);
    await id(page, 'GAR-09.empty.action').click();
    await id(page, 'GAR-09.categories.wheels_tires').click();
    await page.getByTestId('GAR-10.field.wheel_model').fill('LM');
    await id(page, 'GAR-10.header.back').click();
    await expect(id(page, 'GAR-10.discard')).toBeVisible();
    await id(page, 'GAR-10.discard.keep').click();
    await expect(page.getByTestId('GAR-10.field.wheel_model')).toHaveValue('LM');

    await id(page, 'GAR-10.header.back').click();
    await id(page, 'GAR-10.discard.discard').click();
    await expect(id(page, 'GAR-09.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicle.id}/mods`);
    expect(expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data).toEqual([]);
  });

  // BH-16: notes are private and make no entry in Verlauf, so the toast does not promise one.
  test('a notes-only edit gets the plain toast, a real change the one about Verlauf', async ({ page }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'toast', [BBS_WHEELS]);
    const [mod] = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data;
    const before = await updatesOf(member.api, vehicle.id);
    await closeBuildUpdates(vehicle.id);

    await open(page, `/app/garage/${vehicle.id}/mods/${mod.id}`);
    await page.getByTestId('GAR-10.notes').fill('Nur für mich');
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-10.saved')).toHaveText('Modifikation gespeichert');
    expect(await updatesOf(member.api, vehicle.id)).toEqual(before);

    await open(page, `/app/garage/${vehicle.id}/mods/${mod.id}`);
    await page.getByTestId('GAR-10.field.wheel_model').fill('RS');
    await id(page, 'GAR-10.cta.primary').click();
    await expect(id(page, 'GAR-10.saved')).toHaveText('Modifikation gespeichert. Im Verlauf erscheint ein Eintrag.');
  });

  // BH-11: the rear diameter exists only with Mischbereifung, and a hidden value never holds the save back.
  test('Mischbereifung switched off drops an invalid rear diameter instead of blocking Speichern', async ({ page }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'rear');
    // Through the list, as a member comes here: after a cold link to the editor, back leads to the root of Garage.
    await open(page, `/app/garage/${vehicle.id}/mods`);
    await id(page, 'GAR-09.empty.action').click();
    await id(page, 'GAR-09.categories.wheels_tires').click();
    await fillWheels(page);
    await id(page, 'GAR-10.field.staggered').click();
    await page.getByTestId('GAR-10.field.diameter_rear').fill('19,3');
    await page.getByTestId('GAR-10.field.diameter_rear').blur();
    await expect(id(page, 'GAR-10.field.diameter_rear.error')).toBeVisible();
    await id(page, 'GAR-10.field.staggered').click();
    await expect(id(page, 'GAR-10.field.diameter_rear')).toHaveCount(0);
    await id(page, 'GAR-10.headerSave').click();
    await expect(id(page, 'GAR-09.list')).toBeVisible();
    const [saved] = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data;
    expect(saved.fields).not.toHaveProperty('diameter_rear');
  });

  // BH-13.
  test('a sort abandoned with back asks first, then keeps or drops it', async ({ page }) => {
    const { member, vehicle } = await ownerWithVehicle(page, 'sort-guard', [BBS_WHEELS, { ...BBS_WHEELS, fields: { ...BBS_WHEELS.fields, wheel_model: 'RS' } }]);
    const [lm, rs] = vehicle.mods.map((m: { id: string }) => m.id) as [string, string];
    await open(page, `/app/garage/${vehicle.id}/mods`);
    await expect(id(page, `GAR-09.mod.${rs}`)).toBeVisible();

    await id(page, 'GAR-09.sort').click();
    await page.locator(`[data-testid="GAR-09.sortable.wheels_tires.${lm}.handle"]`).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-testid="GAR-09.sortable.wheels_tires.announcement"]')).toHaveText(/^BBS LM: Platz 2 von 2$/);

    await id(page, 'GAR-09.header.back').click();
    await expect(id(page, 'GAR-09.discard')).toBeVisible();
    await id(page, 'GAR-09.discard.keep').click();
    await expect(id(page, 'GAR-09.discard')).toHaveCount(0);
    await expect(id(page, 'GAR-09.sortDone')).toBeVisible();

    await id(page, 'GAR-09.header.back').click();
    await id(page, 'GAR-09.discard.discard').click();
    await expect(id(page, 'GAR-09.root')).toHaveCount(0);
    const stored = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data.map((m: { id: string }) => m.id);
    expect(stored, 'nothing was written').toEqual([lm, rs]);
  });

  test.describe('a lost answer (BH-03)', () => {
    /** The first POST reaches the server, and the member never hears of it. */
    async function dropFirstAnswer(page: Page, url: RegExp): Promise<void> {
      let dropped = false;
      await page.route(url, async (route) => {
        if (route.request().method() !== 'POST' || dropped) {
          await route.fallback();
          return;
        }
        dropped = true;
        await route.fetch();
        await route.abort('connectionreset');
      });
    }

    test('on a new mod: a change adopts the mod that exists and applies itself', async ({ page, expectFailedResponses }) => {
      const { member, vehicle } = await ownerWithVehicle(page, 'lost-mod');
      const mods = api(`vehicles/${vehicle.id}/mods`);
      expectFailedResponses([{ status: 'network', url: mods }]);
      await dropFirstAnswer(page, mods);
      await open(page, `/app/garage/${vehicle.id}/mods`);
      await id(page, 'GAR-09.empty.action').click();
      await id(page, 'GAR-09.categories.wheels_tires').click();
      await fillWheels(page);
      await id(page, 'GAR-10.cta.primary').click();
      await expect(id(page, 'GAR-10.notice')).toContainText('Vielleicht kam es trotzdem an');

      await page.getByTestId('GAR-10.field.wheel_model').fill('RS');
      await id(page, 'GAR-10.cta.primary').click();
      await expect(id(page, 'GAR-09.list')).toBeVisible();
      const saved = expectStatus(await member.api.get(`vehicles/${vehicle.id}/mods`), 200, 'GET mods').data;
      expect(saved, 'no second mod').toHaveLength(1);
      expect(saved[0].fields.wheel_model).toBe('RS');
    });

    test('on a note: the saved entry shows, in plain words, and no raw error appears', async ({ page, expectFailedResponses }) => {
      const { member, vehicle } = await ownerWithVehicle(page, 'lost-note');
      const notes = api(`vehicles/${vehicle.id}/updates`);
      expectFailedResponses([{ status: 'network', url: notes }, { status: 409, url: notes }]);
      await dropFirstAnswer(page, notes);
      await open(page, `/app/garage/${vehicle.id}/history`);
      await id(page, 'GAR-11.add').click();
      await page.getByTestId('GAR-11.noteSheet.input').fill('Oelwechsl gemacht');
      await id(page, 'GAR-11.noteSheet.submit').click();
      await expect(id(page, 'GAR-11.noteSheet.notice')).toContainText('Vielleicht kam es trotzdem an');
      const [stored] = await updatesOf(member.api, vehicle.id);
      expect(stored).toBeTruthy();
      await expect(page.locator(`[data-testid="GAR-11.entry.${stored?.id}"]`)).toHaveCount(1);

      await page.getByTestId('GAR-11.noteSheet.input').fill('Ölwechsel gemacht');
      await id(page, 'GAR-11.noteSheet.submit').click();
      await expect(id(page, 'GAR-11.noteSheet.notice')).toHaveText('Deine erste Fassung ist schon angekommen und steht im Verlauf. Noch einmal senden legt eine zweite Notiz an.');
      expect(await updatesOf(member.api, vehicle.id), 'no duplicate on the way there').toHaveLength(1);
    });
  });
});
