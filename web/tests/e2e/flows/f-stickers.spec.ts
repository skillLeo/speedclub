// M5.4 Sticker flow on the member web (docs/10_CLIENT_ROUND_1.md §2, contract docs/reports/phase-5/m5.4-contract.md): the hub STK-01,
// the designer STK-05 (template and options, undo/redo, autosave with base_version, the server Scan-Test), the print PDF download and
// the order page STK-06. A fresh member under E2E_DOMAIN with one published R34 (support/garage.mjs), deleted in the global teardown,
// so lukas.sc's demo design is never written. The old app addresses /qr/{id} and /profile/qr land on the sticker routes.
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { buildVehicle, createGarageMember, expectStatus } from '../support/garage.mjs';

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const PDF_SIGNATURE = Buffer.from('%PDF-');

test.describe('Stickers (M5.4)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('hub → designer → template and options → autosave → Scan-Test passed → print PDF → order page', async ({ page, qaGoto }) => {
    const member = await createGarageMember('stickers');
    const vehicle = await buildVehicle(member.api, { photos: 1 });
    await useSession(page.context(), member.session);

    // STK-01: one card, the live default on the vinyl stage, status, the week's scans, the three actions.
    await qaGoto('/app/stickers');
    const card = `STK-01.card.${vehicle.id}`;
    await expect(id(page, `${card}.art`)).toBeVisible({ timeout: 30_000 });
    await expect(id(page, `${card}.status`)).toHaveText('Aktiv');
    // DQ-M54-08: a week without scans is a sentence, never a big zero.
    await expect(id(page, `${card}.scansNone`)).toHaveText('Noch keine Scans diese Woche');
    await expect(id(page, `${card}.designLine`)).toHaveText('Noch nicht gestaltet');
    await expect(id(page, `${card}.download`)).toBeDisabled();

    // STK-05: the designer opens on the server default (version 0) with its live preview.
    await id(page, `${card}.design`).click();
    await expect.poll(() => pathOf(page)).toBe(`/app/stickers/${vehicle.id}/design`);
    await expect(id(page, 'STK-05.preview.art')).toBeVisible({ timeout: 30_000 });
    await expect(id(page, 'STK-05.preview.art')).toHaveAttribute('aria-label', /^Sticker Classic, 156 × 65 mm, Weißer Druck, mit QR-⁠Code/);
    await expect(id(page, 'STK-05.undo')).toBeDisabled();

    // A template switch autosaves after the pause: the first save sends base_version 0 and creates version 1.
    const firstSave = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/vehicles/${vehicle.id}/sticker-design`));
    await id(page, 'STK-05.template.round').click();
    const first = await firstSave;
    // Review MF-4: the draft revision travels with the version (0 and 0 for the unsaved default).
    expect(first.request().postDataJSON()).toMatchObject({ base_version: 0, base_revision: 0, template: 'round' });
    const firstRevision = (await first.json()).data.revision as number;
    await expect(id(page, 'STK-05.saveStatus')).toContainText('Gespeichert', { timeout: 15_000 });
    await expect(id(page, 'STK-05.preview.art')).toHaveAttribute('aria-label', /^Sticker Round, 78 × 78 mm/);

    // Undo and redo are local; what reaches the server is just the next autosave.
    await id(page, 'STK-05.undo').click();
    await expect(id(page, 'STK-05.template.classic')).toHaveAttribute('aria-checked', 'true');
    await id(page, 'STK-05.redo').click();
    await expect(id(page, 'STK-05.template.round')).toHaveAttribute('aria-checked', 'true');

    // Every option of §2.3 sits in the dock: black print for light paint, size L. The second save carries version 1.
    await id(page, 'STK-05.grabber').click();
    await expect(id(page, 'STK-05.qr')).toBeVisible();
    const secondSave = page.waitForRequest(
      (request) => request.method() === 'PUT' && request.postDataJSON()?.options?.colourway === 'black' && request.postDataJSON()?.options?.size === 'l',
    );
    await id(page, 'STK-05.colourway.black').click();
    await id(page, 'STK-05.size.l').click();
    expect((await secondSave).postDataJSON()).toMatchObject({ base_version: 1, base_revision: firstRevision, template: 'round' });
    await expect(id(page, 'STK-05.saveStatus')).toContainText('Gespeichert', { timeout: 15_000 });
    // QR off warns in the words of 10 §2.3; back on before the test.
    await id(page, 'STK-05.qr').click();
    await expect(id(page, 'STK-05.qrOff')).toHaveText('Ohne QR-⁠Code kann niemand deinen Build scannen.');
    await id(page, 'STK-05.qr').click();
    await expect(id(page, 'STK-05.qrOff')).toHaveCount(0);
    await id(page, 'STK-05.grabber').click();

    // The Scan-Test: the server renders the print raster and decodes it; its verdict decides. Only then "Sticker bestellen".
    await expect(id(page, 'STK-05.cta.primary')).toHaveText('Scan-Test starten');
    const validate = page.waitForResponse((response) => response.url().endsWith(`/vehicles/${vehicle.id}/sticker-design/validate`));
    await id(page, 'STK-05.cta.primary').click();
    const validated = await validate;
    expect(validated.status()).toBe(200);
    expect(validated.request().postDataJSON()).toMatchObject({ client_scan_test: 'unavailable' });
    await expect(id(page, 'STK-05.scanState')).toHaveText('Scan-Test bestanden', { timeout: 60_000 });
    await expect(id(page, 'STK-05.cta.primary')).toHaveText('Sticker bestellen');
    const design = expectStatus(await member.api.get(`vehicles/${vehicle.id}/sticker-design`), 200, 'GET design').data;
    expect(design).toMatchObject({ state: 'validated', scan_test: 'passed', template: 'round', options: { colourway: 'black', size: 'l' } });

    // The print PDF of exactly this version (3 mm bleed, crop marks and the design id are the server's, StickerPdfTest).
    await id(page, 'STK-05.download').click();
    await expect(id(page, 'STK-05.downloadSheet')).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent('download'), id(page, 'STK-05.download.pdf').click()]);
    expect(file.suggestedFilename()).toBe(`speedclub-sticker-${design.reference}-v${design.version}.pdf`);
    expect((await readFile(await file.path())).subarray(0, 5).equals(PDF_SIGNATURE)).toBe(true);

    // STK-06: the checked design and its id; without a configured store the button says so instead of opening a broken link.
    await id(page, 'STK-05.cta.primary').click();
    await expect.poll(() => pathOf(page)).toBe(`/app/stickers/${vehicle.id}/order`);
    await expect(id(page, 'STK-06.reference')).toContainText(design.reference);
    await expect(id(page, 'STK-06.scanTest')).toContainText('Scan-Test bestanden');
    const hub = expectStatus(await member.api.get('me/stickers'), 200, 'GET me/stickers').data[0];
    if (hub.actions.order.reason === 'not_configured') {
      await expect(id(page, 'STK-06.notice')).toHaveText('Bestellung bald verfügbar');
      await expect(id(page, 'STK-06.cta')).toBeDisabled();
    } else {
      const popup = page.waitForEvent('popup');
      await id(page, 'STK-06.cta').click();
      const shop = await popup;
      expect(shop.url()).toContain(`attributes[sticker_design]=${design.reference}`);
      await shop.close();
    }
  });

  test('the old app addresses land on the sticker routes', async ({ page, qaGoto }) => {
    const member = await createGarageMember('stickerlinks');
    const vehicle = await buildVehicle(member.api, { photos: 1 });
    await useSession(page.context(), member.session);
    await qaGoto(`/app/qr/${vehicle.id}`);
    await expect(id(page, 'STK-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(`/app/stickers/${vehicle.id}`);
    await qaGoto('/app/profile/qr');
    await expect(id(page, 'STK-01.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/stickers');
  });
});
