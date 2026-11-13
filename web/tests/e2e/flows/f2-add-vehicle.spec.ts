// F2 Add first vehicle → QR (02_PRODUCT_SPEC §4, FS-4, FS-5) on the member web at /app, against the real API: the empty
// garage, "+", the four wizard steps (Fahrzeug, Technik, Fotos & Beschreibung, Prüfen & veröffentlichen) with a real photo
// through the upload queue, GAR-04 with the QR reveal, "QR-Code ansehen", and the edges of F2 and §3.2: every step
// autosaves and a closed wizard resumes from Entwürfe, leaving a changed step asks first, the steps refuse what is
// missing, a failed upload stays in the queue with its reason and goes through on retry, a server error on publish keeps
// the draft, and the desktop layout with steps rail and live preview.
//
// Every test has a member of its own under E2E_DOMAIN with an empty garage (support/garage.mjs); the global teardown
// deletes them with their vehicles, photos and QR codes. Failures the tests provoke are staged by route interception and
// named through expectFailedResponses. Native counterpart: mobile/e2e/maestro/f2-add-vehicle.yaml.
import type { Locator, Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { noteDeletedMedia } from '../support/deleted-media.mjs';
import { buildVehicle, catalogueIds, createGarageMember, expectStatus, photoFile, SKYLINE, type MemberApi } from '../support/garage.mjs';
import { BASE_URL, qaUrl } from '../support/qa.mjs';
import { acquireStartLock, releaseStartLock, releaseStartLockFully } from '../support/start-lock.mjs';
import { expectTextContaining } from '../support/text.mjs';

const ULID = '[0-9a-z]{26}';
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
/** The finished photos of the wizard's grid: one button per photo (its cover badge has an id of its own). */
const photoTiles = (page: Page): Locator => page.locator('[data-testid^="GAR-03.photos.photo."][role="button"]:visible');
const api = (path: string): RegExp => new RegExp(`/api/v1/${path}(\\?.*)?$`);

type Member = Awaited<ReturnType<typeof createGarageMember>>;

/** A fresh member with an empty garage, signed in in this browser. */
async function signedInMember(page: Page, label: string): Promise<Member> {
  const member = await createGarageMember(label);
  await useSession(page.context(), member.session);
  return member;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(qaUrl(path));
}

async function vehicleOf(memberApi: MemberApi, vehicleId: string) {
  return expectStatus(await memberApi.get(`vehicles/${vehicleId}`), 200, 'GET vehicle').data;
}

/**
 * Picks an option in the sheet of a picker field and waits until the sheet has let go of the screen, as a member would:
 * while a sheet closes, the screen behind it is still inert and takes no typing (seen on WebKit).
 */
async function pick(page: Page, field: string, option: string | number, search?: string): Promise<void> {
  await id(page, `GAR-03.${field}`).click();
  if (search) await page.getByTestId(`GAR-03.${field}Sheet.search`).fill(search);
  await id(page, `GAR-03.${field}Sheet.option.${option}`).click();
  await expect(page.locator(`[data-testid="GAR-03.${field}Sheet"]:visible`)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.getElementById('root')?.hasAttribute('inert') ?? false)).toBe(false);
}

/** Step 1 through the catalogue sheets: make → model → generation → year. */
async function fillVehicleStep(page: Page, ids: { make_id: number; model_id: number; generation_id: number | null }): Promise<void> {
  await pick(page, 'make', ids.make_id, 'Nissan');
  await expect(id(page, 'GAR-03.make.value')).toHaveText('Nissan');
  await pick(page, 'model', ids.model_id, 'Skyline');
  await expect(id(page, 'GAR-03.model.value')).toHaveText('Skyline GT-R');
  await pick(page, 'generation', String(ids.generation_id));
  await expect(id(page, 'GAR-03.generation.value')).toContainText('R34');
  await page.getByTestId('GAR-03.year').fill('2002');
  await expect(page.getByTestId('GAR-03.year')).toHaveValue('2002');
}

test.describe('F2 add first vehicle', () => {
  // From the empty garage to the QR and on to the mods, one test per step of the wizard (as one test it reached its 60 s
  // ceiling on a loaded machine, M1.9). Each step starts from a draft the API left exactly where the step before ends.
  test('from the empty garage: "+" opens the wizard, and step 1 Fahrzeug saves the draft', async ({ page }) => {
    const member = await signedInMember(page, 'happy');
    const ids = await catalogueIds(member.api, SKYLINE);
    await open(page, '/app/garage');
    await expect(id(page, 'GAR-01.empty')).toBeVisible();
    await expect(id(page, 'GAR-01.empty.title')).toHaveText('Deine Garage wartet.');

    // Garage "+" → Step 1 Fahrzeug.
    await id(page, 'GAR-01.add').click();
    await expect(id(page, 'GAR-03.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/add-vehicle/new/vehicle');
    await fillVehicleStep(page, ids);
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${ULID}/specs$`));
    const vehicleId = pathOf(page).split('/')[3] as string;
    const draft = await vehicleOf(member.api, vehicleId);
    expect(draft).toMatchObject({ status: 'draft', ...ids, model_year: 2002, wizard: { step: 2 } });
  });

  test('step 2 Technik saves the PS/kW helper, provenance and drivetrain', async ({ page }) => {
    const member = await signedInMember(page, 'happy-specs');
    const { id: vehicleId } = await buildVehicle(member.api, { draft: true, photos: 0, specs: null });
    await open(page, `/app/add-vehicle/${vehicleId}/specs`);
    await expect(id(page, 'GAR-03.root')).toBeVisible();

    // Step 2 Technik: the PS/kW helper, provenance, drivetrain.
    await page.getByTestId('GAR-03.engineCode').fill('RB26DETT');
    await page.getByTestId('GAR-03.engineText').fill('2,6 l R6 Biturbo');
    await page.getByTestId('GAR-03.displacement').fill('2568');
    await pick(page, 'fuel', 'petrol');
    await pick(page, 'aspiration', 'biturbo');
    await page.getByTestId('GAR-03.powerValue').fill('280');
    await expect(page.getByTestId('GAR-03.powerValue')).toHaveValue('280');
    await page.getByTestId('GAR-03.powerValue').blur();
    await expect(id(page, 'GAR-03.powerValue.helper')).toContainText('206 kW');
    await id(page, 'GAR-03.powerSource.factory').click();
    await page.getByTestId('GAR-03.torque').fill('392');
    await id(page, 'GAR-03.torqueSource.factory').click();
    await id(page, 'GAR-03.drivetrain.all').click();
    await pick(page, 'gearbox', 'manual');
    await id(page, 'GAR-03.specs.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/photos$`));
    expect((await vehicleOf(member.api, vehicleId)).specs).toMatchObject({
      engine_code: 'RB26DETT',
      displacement_cc: 2568,
      fuel: 'petrol',
      aspiration: 'biturbo',
      power_value: 280,
      power_unit: 'ps',
      power_source: 'factory',
      torque_nm: 392,
      torque_source: 'factory',
      drivetrain: 'all',
      gearbox: 'manual',
    });
  });

  test('step 3 Fotos & Beschreibung takes a real photo through the queue, and the description', async ({ page }) => {
    const member = await signedInMember(page, 'happy-photos');
    const { id: vehicleId } = await buildVehicle(member.api, { draft: true, photos: 0 });
    expectStatus(await member.api.patch(`vehicles/${vehicleId}`, { wizard_step: 3 }), 200, 'PATCH wizard_step');
    await open(page, `/app/add-vehicle/${vehicleId}/photos`);

    // Step 3 Fotos & Beschreibung: a real photo through the queue, and the 500 character description.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), id(page, 'GAR-03.photos.add').click()]);
    await chooser.setFiles(photoFile('generic-exterior-01.jpg'));
    await expect(photoTiles(page)).toHaveCount(1, { timeout: 60_000 });
    await expect(id(page, 'GAR-03.photos.count')).toHaveText('1 von 30 Fotos');
    const description = 'Bayside Blue, seit 2015 in meiner Garage. Ziel: zuverlässige 500 PS.';
    await page.getByTestId('GAR-03.description').fill(description);
    await id(page, 'GAR-03.photos.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/review$`));
    const beforePublish = await vehicleOf(member.api, vehicleId);
    expect(beforePublish.description).toBe(description);
    expect(beforePublish.photos).toHaveLength(1);
  });

  test('step 4 publishes: the QR reveal, "QR-Code ansehen", the garage, and a stranger who scans the new sticker', async ({ page, browser }) => {
    const member = await signedInMember(page, 'happy-publish');
    const { id: vehicleId } = await buildVehicle(member.api, { draft: true, photos: 1 });
    expectStatus(await member.api.patch(`vehicles/${vehicleId}`, { wizard_step: 4 }), 200, 'PATCH wizard_step');
    await open(page, `/app/add-vehicle/${vehicleId}/review`);

    // Step 4 Prüfen & veröffentlichen: nothing missing, public by default.
    await expect(id(page, 'GAR-03.review.card')).toBeVisible();
    await expect(id(page, 'GAR-03.review.missing')).toHaveCount(0);
    await expect(id(page, 'GAR-03.review.visibility.public')).toHaveAttribute('aria-checked', 'true');
    await id(page, 'GAR-03.review.cta.primary').click();

    // GAR-04: the QR reveal with the vehicle's own code.
    await expect(id(page, 'GAR-04.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/published/${vehicleId}`);
    await expect(id(page, 'GAR-04.title')).toHaveText('Dein Build ist live.');
    const published = await vehicleOf(member.api, vehicleId);
    expect(published).toMatchObject({ status: 'published', visibility: 'public', is_main: true });
    expect(published.qr?.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const code = published.qr.code as string;
    await expect(id(page, 'GAR-04.qr.shortCode')).toHaveText(`${code.slice(0, 4)} ${code.slice(4)}`);

    // "QR-Code ansehen" (09 §7.6 GAR-04) → QR-02 of this vehicle, with the same code.
    await id(page, 'GAR-04.viewQr').click();
    await expect(id(page, 'QR-02.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/qr/${vehicleId}`);
    await expect(id(page, 'QR-02.card.shortCode')).toHaveText(`${code.slice(0, 4)} ${code.slice(4)}`);

    // GAR-09 of this vehicle is still empty (GAR-04 no longer links it; the garage's quick action "Mods" does).
    await open(page, `/app/garage/${vehicleId}/mods`);
    await expect(id(page, 'GAR-09.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/garage/${vehicleId}/mods`);
    await expect(id(page, 'GAR-09.empty')).toBeVisible();

    // The garage shows it as the main vehicle, with its QR.
    await open(page, '/app/garage');
    await expect(id(page, `GAR-01.card.${vehicleId}`)).toBeVisible();
    await expect(id(page, `GAR-01.card.${vehicleId}.badge`)).toBeVisible();
    await expect(id(page, `GAR-01.card.${vehicleId}.qr`)).toBeVisible();

    // A stranger's scan of the new sticker lands on the new public page.
    const guest = await browser.newContext({ baseURL: BASE_URL });
    try {
      const scan = await guest.request.get(`/C/${code}`, { maxRedirects: 0 });
      expect(scan.status()).toBe(302);
      expect(new URL(scan.headers().location ?? '', BASE_URL).pathname).toBe(`/v/${published.slug}`);
      const stranger = await guest.newPage();
      await stranger.goto(`/v/${published.slug}`);
      await expect(stranger.getByTestId('WEB-01.root')).toBeVisible();
      await expect(stranger.getByTestId('VEH-01.title')).toHaveText('Skyline GT-R R34');
    } finally {
      await guest.close();
    }
  });

  test('every step autosaves, and a closed wizard resumes from Entwürfe', async ({ page }) => {
    const member = await signedInMember(page, 'resume');
    const ids = await catalogueIds(member.api, SKYLINE);
    await open(page, '/app/add-vehicle/new/vehicle');
    await fillVehicleStep(page, ids);
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${ULID}/specs$`));
    const vehicleId = pathOf(page).split('/')[3] as string;

    // "Entwurf speichern" keeps step 2 as it is and leaves the wizard, without the guard.
    await page.getByTestId('GAR-03.engineCode').fill('RB26DETT');
    await id(page, 'GAR-03.specs.saveDraft').click();
    await expect(id(page, 'GAR-03.toast')).toHaveText('Entwurf gespeichert');
    await expect.poll(async () => (await vehicleOf(member.api, vehicleId)).specs?.engine_code).toBe('RB26DETT');
    await expect(id(page, 'GAR-03.discard')).toHaveCount(0);

    await expect(id(page, 'GAR-01.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/garage');
    await expect(id(page, 'GAR-01.drafts')).toBeVisible();
    const row = id(page, `GAR-01.draft.${vehicleId}`);
    await expectTextContaining(row, 'Nissan Skyline GT-R R34');
    await expect(row).toContainText('Entwurf · Schritt 2 von 4');
    await expect(id(page, `GAR-01.draft.${vehicleId}.value`)).toHaveText('Fortsetzen');

    await row.click();
    await expect(id(page, 'GAR-03.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/add-vehicle/${vehicleId}/specs`);
    await expect(page.getByTestId('GAR-03.engineCode')).toHaveValue('RB26DETT');

    // A reload lands on the same step with the same values: nothing lived only in the page.
    await page.reload();
    await expect(page.getByTestId('GAR-03.engineCode')).toHaveValue('RB26DETT');
    expect(pathOf(page)).toBe(`/app/add-vehicle/${vehicleId}/specs`);
  });

  test('leaving a changed step asks first, and a discarded new vehicle leaves nothing behind', async ({ page }) => {
    const member = await signedInMember(page, 'discard');
    const ids = await catalogueIds(member.api, SKYLINE);
    await open(page, '/app/garage');
    await id(page, 'GAR-01.empty.action').click();
    await expect(id(page, 'GAR-03.make')).toBeVisible();
    // Untouched: closing goes straight back.
    await id(page, 'GAR-03.header.back').click();
    await expect(id(page, 'GAR-01.empty')).toBeVisible();

    await id(page, 'GAR-01.empty.action').click();
    await fillVehicleStep(page, ids);
    await id(page, 'GAR-03.header.back').click();
    await expect(id(page, 'GAR-03.discard')).toBeVisible();
    await id(page, 'GAR-03.discard.keep').click();
    await expect(id(page, 'GAR-03.discard')).toHaveCount(0);
    await expect(page.getByTestId('GAR-03.year')).toHaveValue('2002');
    expect(pathOf(page)).toBe('/app/add-vehicle/new/vehicle');

    await id(page, 'GAR-03.header.back').click();
    await id(page, 'GAR-03.discard.discard').click();
    await expect(id(page, 'GAR-01.empty')).toBeVisible();
    expect(pathOf(page)).toBe('/app/garage');
    expect(expectStatus(await member.api.get('me/vehicles'), 200, 'GET me/vehicles').data).toEqual([]);
  });

  test('the steps refuse what is missing', async ({ page }) => {
    const member = await signedInMember(page, 'missing');
    await open(page, '/app/add-vehicle/new/vehicle');
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await expect(id(page, 'GAR-03.make.error')).toBeVisible();
    await expect(id(page, 'GAR-03.year.error')).toBeVisible();
    expect(pathOf(page)).toBe('/app/add-vehicle/new/vehicle');
    expect(expectStatus(await member.api.get('me/vehicles'), 200, 'GET me/vehicles').data).toEqual([]);

    // A draft without a photo cannot be published: step 4 names the photo and leads back to step 3.
    const draft = await buildVehicle(member.api, { draft: true, photos: 0 });
    expectStatus(await member.api.patch(`vehicles/${draft.id}`, { wizard_step: 4 }), 200, 'PATCH wizard_step');
    await open(page, `/app/add-vehicle/${draft.id}/review`);
    await expect(id(page, 'GAR-03.review.missing')).toBeVisible();
    await expect(id(page, 'GAR-03.review.missing.photo')).toContainText('Mindestens ein Foto');
    // DQ-1069 (M4.9 design QA): while "Fehlt noch" lists anything, "Veröffentlichen" is disabled and says why, so nothing is posted.
    await expect(id(page, 'GAR-03.review.cta.primary')).toBeDisabled();
    await expect(id(page, 'GAR-03.review.publishNote')).toContainText('Zum Veröffentlichen fehlt noch: Mindestens ein Foto');
    expect(pathOf(page)).toBe(`/app/add-vehicle/${draft.id}/review`);
    expect((await vehicleOf(member.api, draft.id)).status).toBe('draft');

    await id(page, 'GAR-03.review.missing.photo').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/photos$`));
    await expect(id(page, 'GAR-03.photos.add')).toBeVisible();
  });

  test('a failed upload stays in the queue with its reason, and goes through on retry', async ({ page, expectFailedResponses }) => {
    const member = await signedInMember(page, 'upload');
    const draft = await buildVehicle(member.api, { draft: true, photos: 0 });
    expectStatus(await member.api.patch(`vehicles/${draft.id}`, { wizard_step: 3 }), 200, 'PATCH wizard_step');
    const media = api(`vehicles/${draft.id}/media`);
    expectFailedResponses([{ status: 500, url: media }]);
    let refused = 0;
    await page.route(media, async (route) => {
      if (route.request().method() === 'POST' && refused === 0) {
        refused += 1;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server Error' }) });
      } else {
        await route.fallback();
      }
    });

    await open(page, `/app/add-vehicle/${draft.id}/photos`);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), id(page, 'GAR-03.photos.add').click()]);
    await chooser.setFiles(photoFile('generic-wheels-01.jpg'));
    const tile = page.locator('[data-testid^="GAR-03.photos.upload."][role="button"]:visible');
    await expect(tile).toHaveCount(1);
    await expect(tile).toHaveAttribute('aria-label', 'Fehlgeschlagen: Der Upload hat nicht geklappt. Versuche es noch einmal.');
    expect(refused).toBe(1);
    expect((await vehicleOf(member.api, draft.id)).photos).toHaveLength(0);

    await tile.click();
    await expect(id(page, 'GAR-03.uploadSheet')).toBeVisible();
    await expect(id(page, 'GAR-03.uploadSheet.message')).toHaveText('Der Upload hat nicht geklappt. Versuche es noch einmal.');
    await id(page, 'GAR-03.uploadSheet.retry').click();
    await expect(photoTiles(page)).toHaveCount(1, { timeout: 60_000 });
    await expect(tile).toHaveCount(0);
    expect((await vehicleOf(member.api, draft.id)).photos).toHaveLength(1);
  });

  test('a server error on publish keeps the draft and says so, and the next try publishes', async ({ page, expectFailedResponses }) => {
    const member = await signedInMember(page, 'publish');
    const draft = await buildVehicle(member.api, { draft: true, photos: 1 });
    expectStatus(await member.api.patch(`vehicles/${draft.id}`, { wizard_step: 4 }), 200, 'PATCH wizard_step');
    const publish = api(`vehicles/${draft.id}/publish`);
    expectFailedResponses([{ status: 500, url: publish }]);
    await page.route(publish, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Server Error"}' }));

    await open(page, `/app/add-vehicle/${draft.id}/review`);
    await expect(id(page, 'GAR-03.review.missing')).toHaveCount(0);
    await id(page, 'GAR-03.review.visibility.unlisted').click();
    // ADR-176 a: the pick saves at once, and Veröffentlichen is busy until it is stored.
    await expect(id(page, 'GAR-03.review.cta.primary')).not.toHaveAttribute('aria-busy', 'true');
    await id(page, 'GAR-03.review.cta.primary').click();
    await expect(id(page, 'GAR-03.notice')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/add-vehicle/${draft.id}/review`);
    expect((await vehicleOf(member.api, draft.id)).status).toBe('draft');
    await expect(id(page, 'GAR-03.review.visibility.unlisted')).toHaveAttribute('aria-checked', 'true');

    await page.unroute(publish);
    await id(page, 'GAR-03.review.cta.primary').click();
    await expect(id(page, 'GAR-04.root')).toBeVisible();
    expect(await vehicleOf(member.api, draft.id)).toMatchObject({ status: 'published', visibility: 'unlisted' });
  });

  test('on a desktop: the steps rail, the form and the live preview card (FS-5)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const member = await signedInMember(page, 'desktop');
    const ids = await catalogueIds(member.api, SKYLINE);
    await open(page, '/app/add-vehicle/new/vehicle');
    const rail = id(page, 'GAR-03.rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('role', 'navigation');
    for (const step of ['vehicle', 'specs', 'photos', 'review']) await expect(id(page, `GAR-03.rail.${step}`)).toBeVisible();
    await expect(id(page, 'GAR-03.previewCard')).toBeVisible();

    await expect(id(page, 'GAR-03.previewCard')).toContainText('Neues Fahrzeug');
    await fillVehicleStep(page, ids);
    // Live: the card follows the form before anything is saved.
    await expect(id(page, 'GAR-03.previewCard')).toContainText('Nissan Skyline GT-R');
    await expect(id(page, 'GAR-03.previewCard')).toContainText('2002');
    const [form, preview] = await Promise.all([id(page, 'GAR-03.make').boundingBox(), id(page, 'GAR-03.previewCard').boundingBox()]);
    if (!form || !preview) throw new Error('missing geometry');
    expect(preview.x, 'the preview stands right of the form').toBeGreaterThan(form.x + form.width);

    // After step 1 the card is the saved draft's, as the garage will show it.
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${ULID}/specs$`));
    await expect(id(page, 'GAR-03.previewCard')).toContainText('Nissan Skyline GT-R R34');
    await expect(id(page, 'GAR-03.rail.specs')).toHaveAttribute('aria-current', 'step');
  });

  // BH-00: the server keeps a draft with no model, which the type of the review's checklist did not expect.
  test('a draft that lost its model opens Prüfen from Fortsetzen and names what is missing', async ({ page }) => {
    const member = await signedInMember(page, 'nameless');
    const draft = await buildVehicle(member.api, { draft: true, photos: 1 });
    expectStatus(await member.api.patch(`vehicles/${draft.id}`, { wizard_step: 4 }), 200, 'PATCH wizard_step');
    const bmw = await catalogueIds(member.api, { make: 'BMW', model: 'M3' });

    await open(page, `/app/add-vehicle/${draft.id}/vehicle`);
    await expect(id(page, 'GAR-03.make.value')).toHaveText('Nissan');
    await pick(page, 'make', bmw.make_id, 'BMW');
    await id(page, 'GAR-03.vehicle.saveDraft').click();
    await expect(id(page, 'GAR-01.root')).toBeVisible();
    expect(await vehicleOf(member.api, draft.id)).toMatchObject({ make: 'BMW', model: null, wizard: { step: 4 } });

    await id(page, `GAR-01.draft.${draft.id}`).click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/review$`));
    await expect(id(page, 'GAR-03.review.card')).toBeVisible();
    await expect(id(page, 'GAR-03.review.missing.model')).toBeVisible();
    await id(page, 'GAR-03.review.missing.model').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/vehicle$`));
  });

  test.describe('the review saves its visibility when it is picked (BH-08)', () => {
    async function readyDraft(page: Page, label: string) {
      const member = await signedInMember(page, label);
      const draft = await buildVehicle(member.api, { draft: true, photos: 1 });
      expectStatus(await member.api.patch(`vehicles/${draft.id}`, { wizard_step: 4 }), 200, 'PATCH wizard_step');
      return { member, draft };
    }

    test('it survives editing another step', async ({ page }) => {
      const { member, draft } = await readyDraft(page, 'vis-edit');
      await open(page, `/app/add-vehicle/${draft.id}/review`);
      await id(page, 'GAR-03.review.visibility.private').click();
      await expect(id(page, 'GAR-03.review.visibility.private')).toHaveAttribute('aria-checked', 'true');
      await expect.poll(async () => (await vehicleOf(member.api, draft.id)).visibility).toBe('private');

      await id(page, 'GAR-03.review.photos').click();
      await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/photos$`));
      await id(page, 'GAR-03.photos.cta.primary').click();
      await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/review$`));
      await expect(id(page, 'GAR-03.review.visibility.private')).toHaveAttribute('aria-checked', 'true');
    });

    test('Entwurf speichern keeps it, and so does Fortsetzen', async ({ page }) => {
      const { member, draft } = await readyDraft(page, 'vis-draft');
      await open(page, `/app/add-vehicle/${draft.id}/review`);
      await id(page, 'GAR-03.review.visibility.private').click();
      await expect.poll(async () => (await vehicleOf(member.api, draft.id)).visibility).toBe('private');
      await id(page, 'GAR-03.review.saveDraft').click();
      await expect(id(page, 'GAR-03.toast')).toHaveText('Entwurf gespeichert');
      await expect(id(page, 'GAR-01.root')).toBeVisible();
      expect((await vehicleOf(member.api, draft.id)).visibility).toBe('private');

      await id(page, `GAR-01.draft.${draft.id}`).click();
      await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/review$`));
      await expect(id(page, 'GAR-03.review.visibility.private')).toHaveAttribute('aria-checked', 'true');
    });

    test('× keeps it too, with no question', async ({ page }) => {
      const { member, draft } = await readyDraft(page, 'vis-close');
      await open(page, `/app/add-vehicle/${draft.id}/review`);
      await id(page, 'GAR-03.review.visibility.unlisted').click();
      await expect.poll(async () => (await vehicleOf(member.api, draft.id)).visibility).toBe('unlisted');
      await id(page, 'GAR-03.header.back').click();
      await expect(id(page, 'GAR-01.root')).toBeVisible();
      await expect(id(page, 'GAR-03.discard')).toHaveCount(0);
    });

    test('the car is published private after picking private', async ({ page }) => {
      const { member, draft } = await readyDraft(page, 'vis-publish');
      const visibility = api(`vehicles/${draft.id}/visibility`);
      // A slow save: Veröffentlichen waits for it.
      await page.route(visibility, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fallback();
      });
      await open(page, `/app/add-vehicle/${draft.id}/review`);
      await id(page, 'GAR-03.review.visibility.private').click();
      await expect(id(page, 'GAR-03.review.visibility.private')).toHaveAttribute('aria-checked', 'true');
      await expect(id(page, 'GAR-03.review.cta.primary')).toHaveAttribute('aria-busy', 'true');
      await expect(id(page, 'GAR-03.review.cta.primary')).not.toHaveAttribute('aria-busy', 'true');
      await id(page, 'GAR-03.review.cta.primary').click();
      await expect(id(page, 'GAR-04.root')).toBeVisible();
      expect(await vehicleOf(member.api, draft.id)).toMatchObject({ status: 'published', visibility: 'private' });
    });

    test('a failed save goes back to the previous choice and says why, with no claim that it is saved', async ({ page, expectFailedResponses }) => {
      const { member, draft } = await readyDraft(page, 'vis-fail');
      const visibility = api(`vehicles/${draft.id}/visibility`);
      expectFailedResponses([{ status: 500, url: visibility }]);
      await page.route(visibility, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Server Error"}' }));
      await open(page, `/app/add-vehicle/${draft.id}/review`);
      await id(page, 'GAR-03.review.visibility.private').click();
      await expect(id(page, 'GAR-03.notice')).toHaveText('Speichern hat nicht geklappt. Versuche es noch einmal.');
      await expect(id(page, 'GAR-03.review.visibility.public')).toHaveAttribute('aria-checked', 'true');
      await expect(id(page, 'GAR-03.toast')).toHaveCount(0);
      expect((await vehicleOf(member.api, draft.id)).visibility).toBe('public');
    });
  });

  test.describe('a lost answer on the first save (BH-03, BH-12)', () => {
    const vehicles = api('vehicles');

    /** The first POST reaches the server, and the member never hears of it. */
    async function dropFirstAnswer(page: Page): Promise<void> {
      let dropped = false;
      await page.route(vehicles, async (route) => {
        if (route.request().method() !== 'POST' || dropped) {
          await route.fallback();
          return;
        }
        dropped = true;
        await route.fetch();
        await route.abort('connectionreset');
      });
    }

    test('a changed year adopts the draft that exists and applies the change', async ({ page, expectFailedResponses }) => {
      expectFailedResponses([{ status: 'network', url: vehicles }]);
      const member = await signedInMember(page, 'lost-year');
      const ids = await catalogueIds(member.api, SKYLINE);
      await dropFirstAnswer(page);
      await open(page, '/app/add-vehicle/new/vehicle');
      await fillVehicleStep(page, ids);
      await id(page, 'GAR-03.vehicle.cta.primary').click();
      await expect(id(page, 'GAR-03.notice')).toContainText('Vielleicht kam es trotzdem an');

      await page.getByTestId('GAR-03.year').fill('2001');
      await id(page, 'GAR-03.vehicle.cta.primary').click();
      await page.waitForURL(new RegExp(`/app/add-vehicle/${ULID}/specs$`));
      const drafts = expectStatus(await member.api.get('me/vehicles'), 200, 'GET me/vehicles').data;
      expect(drafts, 'the second try made no second draft').toHaveLength(1);
      expect(drafts[0].model_year).toBe(2001);
    });

    test('Entwurf speichern adopts it too, with no raw error', async ({ page, expectFailedResponses }) => {
      expectFailedResponses([{ status: 'network', url: vehicles }]);
      const member = await signedInMember(page, 'lost-draft');
      const ids = await catalogueIds(member.api, SKYLINE);
      await dropFirstAnswer(page);
      await open(page, '/app/add-vehicle/new/vehicle');
      await fillVehicleStep(page, ids);
      await id(page, 'GAR-03.vehicle.cta.primary').click();
      await expect(id(page, 'GAR-03.notice')).toBeVisible();

      await id(page, 'GAR-03.vehicle.saveDraft').click();
      await expect(id(page, 'GAR-03.toast')).toHaveText('Entwurf gespeichert');
      await expect(id(page, 'GAR-01.root')).toBeVisible();
      const drafts = expectStatus(await member.api.get('me/vehicles'), 200, 'GET me/vehicles').data;
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ model_year: 2002, wizard: { step: 2 } });
    });
  });

  // BH-14: the save is kept, only the navigation behind it is not.
  test('leaving during a slow save sticks', async ({ page }) => {
    const member = await signedInMember(page, 'slow');
    const draft = await buildVehicle(member.api, { draft: true, photos: 0, specs: null });
    const specs = api(`vehicles/${draft.id}/specs`);
    await page.route(specs, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fallback();
    });
    await open(page, '/app/garage');
    await id(page, `GAR-01.draft.${draft.id}`).click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${draft.id}/specs$`));
    await page.getByTestId('GAR-03.engineCode').fill('RB26DETT');

    const stepSaved = page.waitForResponse((response) => response.request().method() === 'PATCH' && api(`vehicles/${draft.id}`).test(response.url()));
    await id(page, 'GAR-03.specs.cta.primary').click();
    // On its way, so the guard is off: × during a save closes without a question.
    await expect(id(page, 'GAR-03.specs.cta.primary')).toHaveAttribute('aria-busy', 'true');
    await id(page, 'GAR-03.header.back').click();
    await expect(id(page, 'GAR-01.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/garage');

    await stepSaved;
    await page.waitForTimeout(500);
    expect(pathOf(page), 'the wizard did not open again').toBe('/app/garage');
    await expect(id(page, 'GAR-03.root')).toHaveCount(0);
    expect(await vehicleOf(member.api, draft.id)).toMatchObject({ specs: { engine_code: 'RB26DETT' }, wizard: { step: 3 } });
  });

  // BH-18: the route of a new draft stays add-vehicle/new after going back.
  test('going back and on again never moves the mark back', async ({ page }) => {
    const member = await signedInMember(page, 'mark');
    const ids = await catalogueIds(member.api, SKYLINE);
    await open(page, '/app/add-vehicle/new/vehicle');
    await fillVehicleStep(page, ids);
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${ULID}/specs$`));
    const vehicleId = pathOf(page).split('/')[3] as string;
    await id(page, 'GAR-03.specs.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/photos$`));
    expect((await vehicleOf(member.api, vehicleId)).wizard.step).toBe(3);

    await page.goBack();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/specs$`));
    await page.goBack();
    await page.waitForURL(/\/app\/add-vehicle\/new\/vehicle(\?.*)?$/);
    await id(page, 'GAR-03.vehicle.cta.primary').click();
    await page.waitForURL(new RegExp(`/app/add-vehicle/${vehicleId}/specs$`));
    expect((await vehicleOf(member.api, vehicleId)).wizard.step).toBe(3);
  });

  // Start's Neue Builds are everyone's newest public builds, so a build another spec publishes in between would take this test's
  // place: each test holds the Start lock (support/start-lock.mjs) from its publish until Start shows its card; every other publish
  // of the run waits meanwhile.
  test.describe('what the member did reaches Start at once (BH-37)', () => {
    test.afterEach(() => releaseStartLockFully());
    // One after the other, in one worker: Start is everyone's feed, so the published draft's Start showed the other test's car,
    // and asked for a smaller size of its cover just after that test deleted it: a 404 that was neither test's (M1.9 r4,
    // docs/reports/logs/m19-r4-e2e.log). Not `serial`: a failure of the first must not hide the second.
    test.describe.configure({ mode: 'default' });
    const tab =(page: Page, name: 'home' | 'garage' | 'profile'): Locator => id(page, `tab.${name}`);

    test('a published draft is on Start and in the Profile count, with no reload', async ({ page }) => {
      const member = await signedInMember(page, 'feed-publish');
      const draft = await buildVehicle(member.api, { draft: true, photos: 1 });
      await acquireStartLock();
      expectStatus(await member.api.patch(`vehicles/${draft.id}`, { wizard_step: 4 }), 200, 'PATCH wizard_step');
      await open(page, '/app/');
      await expect(id(page, 'HOME-01.root')).toBeVisible();
      // M4.8 (09 §7.3): the newest builds are the "Neu in der Garage" rail, and the stream repeats nothing above it.
      await expect(page.locator(`[data-testid="HOME-01.card.${draft.id}"], [data-testid="HOME-01.newBuilds.item.${draft.id}"]`)).toHaveCount(0);
      await tab(page, 'profile').click();
      await expect(id(page, 'PROF-01.stats')).toContainText('0 Fahrzeuge');

      await tab(page, 'garage').click();
      await id(page, `GAR-01.draft.${draft.id}`).click();
      await id(page, 'GAR-03.review.cta.primary').click();
      await expect(id(page, 'GAR-04.root')).toBeVisible();
      await id(page, 'GAR-04.header.back').click();

      await tab(page, 'home').click();
      await expect(id(page, `HOME-01.newBuilds.item.${draft.id}`)).toBeVisible();
      releaseStartLock();
      await tab(page, 'profile').click();
      await expect(id(page, 'PROF-01.stats')).toContainText('1 Fahrzeug');
    });

    test('a deleted build leaves Start, with no reload', async ({ page }) => {
      // From 1280, so Start's own-garage rail is on screen too.
      await page.setViewportSize({ width: 1280, height: 800 });
      const member = await signedInMember(page, 'feed-delete');
      await acquireStartLock();
      const car = await buildVehicle(member.api, { photos: 1 });
      await open(page, '/app/');
      const rail = id(page, 'HOME-01.rail.garage.open');
      await expect(rail).toContainText('1 Fahrzeug');
      // The newest public build, a card of "Neu in der Garage" (M4.8): nothing else published meanwhile.
      await expect(id(page, `HOME-01.newBuilds.item.${car.id}`)).toBeVisible();
      releaseStartLock();

      await tab(page, 'garage').click();
      await id(page, `GAR-01.card.${car.id}`).click();
      await id(page, 'GAR-02.tool.edit').click();
      await id(page, 'GAR-02.editSheet.basics').click();
      await id(page, 'GAR-05.delete').click();
      noteDeletedMedia(car); // its photo may still be loading in another worker's Start (support/deleted-media.mjs)
      await id(page, 'GAR-05.deleteDialog.confirm').click();
      await expect(id(page, 'GAR-05.deleted')).toBeVisible();

      await tab(page, 'home').click();
      await expect(id(page, 'HOME-01.root')).toBeVisible();
      await expect(page.locator(`[data-testid="HOME-01.card.${car.id}"], [data-testid="HOME-01.newBuilds.item.${car.id}"]`)).toHaveCount(0);
      // No "0 Fahrzeuge" (DQ-311): the count goes, with no reload.
      await expect(rail).not.toContainText('Fahrzeug');
    });
  });

  test.describe('GAR-07', () => {
    // BH-13: a sort is saved by "Fertig"; every other way out asks.
    test('a sort abandoned with back asks first, then keeps or drops it', async ({ page }) => {
      const member = await signedInMember(page, 'sort-guard');
      const car = await buildVehicle(member.api, { photos: 2 });
      const [first, second] = car.photos.map((photo: { id: string }) => photo.id) as [string, string];
      await open(page, `/app/garage/${car.id}/photos`);
      await expect(id(page, 'GAR-07.photos')).toBeVisible();

      // Sorting without a move has nothing to lose.
      await id(page, 'GAR-07.sort').click();
      await expect(id(page, 'GAR-07.sortHint')).toBeVisible();
      await page.locator(`[data-testid="GAR-07.sortable.${first}.handle"]`).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-testid="GAR-07.sortable.announcement"]')).toHaveText(/: Platz 2 von 2$/);

      await id(page, 'GAR-07.header.back').click();
      await expect(id(page, 'GAR-07.discard')).toBeVisible();
      await id(page, 'GAR-07.discard.keep').click();
      await expect(id(page, 'GAR-07.discard')).toHaveCount(0);
      await expect(id(page, 'GAR-07.sortDone')).toBeVisible();

      await id(page, 'GAR-07.header.back').click();
      await id(page, 'GAR-07.discard.discard').click();
      await expect(id(page, 'GAR-07.root')).toHaveCount(0);
      const stored = (await vehicleOf(member.api, car.id)).photos.map((photo: { id: string }) => photo.id);
      expect(stored, 'nothing was written').toEqual([first, second]);
    });

    test('Fertig does not trip the guard', async ({ page }) => {
      const member = await signedInMember(page, 'sort-done');
      const car = await buildVehicle(member.api, { photos: 2 });
      const [first, second] = car.photos.map((photo: { id: string }) => photo.id) as [string, string];
      await open(page, `/app/garage/${car.id}/photos`);
      await id(page, 'GAR-07.sort').click();
      await page.locator(`[data-testid="GAR-07.sortable.${first}.handle"]`).focus();
      await page.keyboard.press('ArrowRight');
      await id(page, 'GAR-07.sortDone').click();
      await expect(id(page, 'GAR-07.toast')).toHaveText('Reihenfolge gespeichert');
      await id(page, 'GAR-07.header.back').click();
      await expect(id(page, 'GAR-07.discard')).toHaveCount(0);
      expect((await vehicleOf(member.api, car.id)).photos.map((photo: { id: string }) => photo.id)).toEqual([second, first]);
    });

    // BH-46. A failed row cannot be made from outside, so the owner's answer carries one: its shape is the API's own.
    test('an upload that failed on the server is a tile that only deletes, and stays out of the order', async ({ page }) => {
      const member = await signedInMember(page, 'failed-tile');
      const car = await buildVehicle(member.api, { photos: 2 });
      const [first, second] = car.photos.map((photo: { id: string }) => photo.id) as [string, string];
      const failedId = '01j0000000000000000000fail';
      let gone = false;
      await page.route(api(`vehicles/${car.id}`), async (route) => {
        if (route.request().method() !== 'GET' || gone) {
          await route.fallback();
          return;
        }
        const answer = await route.fetch();
        const body = await answer.json();
        body.data.failed_photos = [
          { id: failedId, status: 'failed', category: 'exterior', width: null, height: null, blurhash: null, focal_x: null, focal_y: null, alt: null, sort: 2, variants: [], created_at: null },
        ];
        await route.fulfill({ response: answer, json: body });
      });
      await page.route(api(`media/${failedId}`), (route) => {
        gone = true;
        return route.fulfill({ status: 204 });
      });

      await open(page, `/app/garage/${car.id}/photos`);
      const tile = id(page, `GAR-07.photos.failed.${failedId}`);
      await expect(tile).toBeVisible();
      await expect(tile).toHaveAttribute('aria-label', /konnte nicht verarbeitet werden/);
      await expect(id(page, 'GAR-07.photos.count')).toHaveText('2 von 30 Fotos');

      // Sorting leaves it out: PUT media/order would refuse its id.
      await id(page, 'GAR-07.sort').click();
      await expect(page.locator(`[data-testid="GAR-07.sortable.${failedId}.handle"]`)).toHaveCount(0);
      await page.locator(`[data-testid="GAR-07.sortable.${first}.handle"]`).focus();
      await page.keyboard.press('ArrowRight');
      await id(page, 'GAR-07.sortDone').click();
      await expect(id(page, 'GAR-07.toast')).toHaveText('Reihenfolge gespeichert');
      expect((await vehicleOf(member.api, car.id)).photos.map((photo: { id: string }) => photo.id)).toEqual([second, first]);

      await tile.click();
      await expect(id(page, 'GAR-07.photoSheet')).toHaveCount(0);
      await expect(id(page, 'GAR-07.deletePhoto')).toBeVisible();
      await id(page, 'GAR-07.deletePhoto.confirm').click();
      await expect(tile).toHaveCount(0);
    });
  });
});
