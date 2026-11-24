// The M2.7 signature features (02_PRODUCT_SPEC §5, m2.7-api-handover.md), all flags on outside production: VEH-06 compare from the
// VEH-01 picker, the VEH-07 share card in both formats, the placard PDFs of QR-02's download sheet, the plate blur of GAR-08 (the
// variants are redrawn), the HU/AU month of GAR-06, the legal status of GAR-10 and its pill on VEH-02, the scans row of QR-02, and
// SYS-01 / SYS-02, which only app-config opens.
//
// Builds that change belong to members of this spec; the demo R34 and G82 are only read (compare, share card). The queue worker
// does not run locally, so the blur job of the test account runs through support/backend.mjs runTestJobs, and no other job. The
// sheets and dialogs opened by a tap are saved for design QA under docs/reports/visual/phase-2/flows/.
import type { Locator, Route } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { runTestJobs } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { apiPath, browserOf, flowShot, id, isCall, members, open, pathOf, row } from '../support/flow';
import { BBS_WHEELS, buildVehicle, demoIds, expectStatus, R34 } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';

const G82 = 'bmw-m4-g82-f3pqxpjb';

/** Of several copies of a control (a sticky header repeats the pair of cars), the one on top at its centre, which a press reaches. */
async function topmost(locator: Locator): Promise<Locator> {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const candidate = locator.nth(i);
    const onTop = await candidate.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && (el === hit || el.contains(hit));
    });
    if (onTop) return candidate;
  }
  throw new Error(`no copy of ${locator} is on top`);
}

/** Width and height from a PNG's IHDR. */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test.describe('VEH-06 and VEH-07', () => {
  test('compare from the VEH-01 picker: two builds side by side, differences named', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await open(page, `/app/v/${R34.slug}`);
    await id(page, 'VEH-01.moreActions').click();
    await row(page, 'VEH-01.moreSheet.compare').click();
    await expect(id(page, 'VEH-01.comparePicker')).toBeVisible();
    await id(page, 'VEH-01.comparePicker.search').fill('M4');
    const first = row(page, 'VEH-01.comparePicker.results.0');
    await expect(first).toBeVisible();
    await flowShot(page, testInfo, 'VEH-01-comparePicker');
    const compared = page.waitForResponse(isCall('GET', 'compare'));
    await first.click();
    expect((await compared).status()).toBe(200);
    await expect.poll(() => pathOf(page)).toBe('/app/compare');
    const query = new URL(page.url()).searchParams;
    expect(query.get('a')).toBe(R34.slug);
    expect(query.get('b')).toBeTruthy();

    // The pair of cars is drawn twice (in the list and as the sticky header): either proves the screen.
    await expect(id(page, 'VEH-06.cars').first()).toBeVisible();
    await expect(id(page, 'VEH-06.car.a.title').first()).toContainText(/Skyline GT-.?R/);
    await expect(id(page, 'VEH-06.summary').first()).toBeVisible();
    // A differing row says so to a screen reader; at least the power differs between an R34 and an M4.
    const rows = page.locator('[data-testid^="VEH-06.spec."]:not([data-testid$=".a"]):not([data-testid$=".b"]):visible');
    const labels = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    expect(labels.some((label) => label.endsWith(', unterschiedlich'))).toBe(true);
    // The card opens the build.
    await (await topmost(id(page, 'VEH-06.car.a'))).click();
    await expect.poll(() => pathOf(page)).toBe(`/app/v/${R34.slug}`);
  });

  test('the same build twice is refused calmly; compare answers 422 for it', async ({ page }) => {
    await open(page, `/app/compare?a=${R34.slug}&b=${R34.slug}`);
    await expect(id(page, 'VEH-06.same')).toBeVisible();
    const answer = await page.request.get(`${BASE_URL}/api/v1/compare?a=${R34.slug}&b=${R34.slug}`, { headers: { Accept: 'application/json' } });
    expect(answer.status()).toBe(422);
    const both = await page.request.get(`${BASE_URL}/api/v1/compare?a=${R34.slug}&b=${G82}`, { headers: { Accept: 'application/json' } });
    expect(both.status()).toBe(200);
  });

  test('the share card preview loads as a story and as a square; the PNGs have the promised sizes', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const { r34 } = await demoIds();
    await open(page, `/app/share-card/${r34}`);
    const image = id(page, 'VEH-07.preview.image');
    await expect(image).toBeVisible();
    await expect(id(page, 'VEH-07.format.story')).toHaveAttribute('aria-checked', 'true');
    const decoded = () =>
      image.evaluate((el) => ((el.tagName === 'IMG' ? el : el.querySelector('img')) as HTMLImageElement | null)?.naturalWidth ?? 0).catch(() => 0);
    await expect.poll(decoded, { message: 'the card image decoded' }).toBeGreaterThan(0);
    await flowShot(page, testInfo, 'VEH-07-story');
    await id(page, 'VEH-07.format.square').click();
    await expect(id(page, 'VEH-07.format.square')).toHaveAttribute('aria-checked', 'true');
    await expect(image).toBeVisible();
    await flowShot(page, testInfo, 'VEH-07-square');

    for (const [format, size] of [['story', { width: 1080, height: 1920 }], ['square', { width: 1080, height: 1080 }]] as const) {
      const png = await page.request.get(`${BASE_URL}/api/v1/vehicles/${r34}/share-card.png?format=${format}`);
      expect(png.status()).toBe(200);
      expect(png.headers()['content-type']).toBe('image/png');
      expect(pngSize(await png.body())).toEqual(size);
    }
  });
});

test.describe('VEH-07 2.0 share card (R5-2e)', () => {
  test('template, crop with the buttons, Mods and an own line: the redraw carries them; Speichern downloads the PNG', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    // The choices are read from the build's page in the cache, so the card opens from VEH-01 as a member does it.
    await open(page, `/app/v/${R34.slug}?qaFlags=sig.share_cards`);
    await id(page, 'VEH-01.moreActions').first().click();
    await id(page, 'VEH-01.moreSheet.shareCard').first().click();
    await expect(id(page, 'VEH-07.customise')).toBeVisible();
    const image = id(page, 'VEH-07.preview.image');
    await expect(image).toBeVisible();

    // The template picker is a radio group of three; the poster takes over.
    await expect(id(page, 'VEH-07.template.band')).toHaveAttribute('aria-checked', 'true');
    await id(page, 'VEH-07.template.poster').click();
    await expect(id(page, 'VEH-07.template.poster')).toHaveAttribute('aria-checked', 'true');

    // The crop: twice "+", once "−" is zoom 1.25; "Zurücksetzen" is now possible.
    await expect(id(page, 'VEH-07.crop')).toBeVisible();
    await expect(id(page, 'VEH-07.crop.reset')).toBeDisabled();
    await id(page, 'VEH-07.crop.zoomIn').click();
    await id(page, 'VEH-07.crop.zoomIn').click();
    await id(page, 'VEH-07.crop.zoomOut').click();
    await expect(id(page, 'VEH-07.crop.zoom')).toHaveText('1,25×');
    await expect(id(page, 'VEH-07.crop.reset')).toBeEnabled();
    // Keyboard on the web: an arrow moves the window.
    await id(page, 'VEH-07.crop').focus();
    await page.keyboard.press('ArrowRight');

    // Mods is off by default and only offered for a build with fitted parts (the demo R34 has them).
    const mods = id(page, 'VEH-07.element.mods');
    await expect(mods).toHaveAttribute('aria-checked', 'false');
    await mods.click();
    await expect(mods).toHaveAttribute('aria-checked', 'true');

    // One redraw once the choices settle (400 ms), carrying every choice.
    const redrawn = page.waitForRequest((request) => {
      if (request.method() !== 'GET' || !/\/api\/v1\/vehicles\/[^/]+\/share-card\.png\?/.test(request.url())) return false;
      return new URL(request.url()).searchParams.get('text') === 'Saisonstart am Nürburgring';
    });
    await id(page, 'VEH-07.text').fill('Saisonstart am Nürburgring');
    await expect(id(page, 'VEH-07.text.helper')).toHaveText('26 / 60 Zeichen');
    const redraw = await redrawn;
    const query = new URL(redraw.url()).searchParams;
    expect(query.get('format')).toBe('story');
    expect(query.get('template')).toBe('poster');
    expect(query.get('zoom')).toBe('1.25');
    expect(Number(query.get('x'))).toBeGreaterThanOrEqual(0);
    expect(Number(query.get('y'))).toBeLessThanOrEqual(1);
    expect(query.get('show')?.split(',')).toContain('mods');
    expect(query.has('theme')).toBe(false);
    const answer = await redraw.response();
    expect(answer?.status()).toBe(200);
    expect(answer?.headers()['content-type']).toBe('image/png');

    // The PNG at its exact aspect, uncropped (contain), and "Teilen" back once it is drawn.
    await expect(id(page, 'VEH-07.cta.primary')).toBeEnabled({ timeout: 30_000 });
    expect(await image.evaluate((el) => getComputedStyle((el.tagName === 'IMG' ? el : el.querySelector('img')) ?? el).objectFit)).toBe('contain');
    await flowShot(page, testInfo, 'VEH-07-poster-custom', { phase: 5 });

    // "Speichern" on the web downloads the same PNG.
    const download = page.waitForEvent('download');
    await id(page, 'VEH-07.save').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^speedclub-[0-9a-z]+-story-[0-9a-z]+\.png$/);
    const path = await file.path();
    const { readFile } = await import('node:fs/promises');
    expect(pngSize(await readFile(path))).toEqual({ width: 1080, height: 1920 });

    // "Standard" goes back to the stored card.
    await id(page, 'VEH-07.reset').click();
    await expect(id(page, 'VEH-07.template.band')).toHaveAttribute('aria-checked', 'true');
    await expect(id(page, 'VEH-07.element.mods')).toHaveAttribute('aria-checked', 'false');
    await expect(id(page, 'VEH-07.text')).toHaveValue('');
  });
});

test.describe('QR-02 signature parts', () => {
  test('the download sheet offers the placards; A5 downloads a PDF named after the code', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const [owner] = await members('fsigplacard');
    const vehicle = await buildVehicle(owner.api);
    await useSession(context, owner.session);
    await open(page, `/app/stickers/${vehicle.id}`);
    // "Weitere Formate" waits for the code's SVG (a click before it lands does nothing); under load that can take a while.
    // ListRow: the pressable that carries aria-disabled is `<testID>.body`; the testID itself names its wrapper, which is never disabled.
    const more = page.locator('[data-testid="STK-02.download.body"]:visible');
    await expect(more).toBeEnabled({ timeout: 30_000 });
    await more.click();
    await expect(id(page, 'STK-02.downloadSheet')).toBeVisible();
    await expect(id(page, 'STK-02.download.placardA4')).toBeVisible();
    await flowShot(page, testInfo, 'STK-02-downloadSheet');
    const pdf = page.waitForResponse(isCall('GET', `vehicles/${vehicle.id}/placard.pdf`));
    const download = page.waitForEvent('download');
    await id(page, 'STK-02.download.placardA5').click();
    const answer = await pdf;
    expect(answer.status()).toBe(200);
    expect(new URL(answer.url()).searchParams.get('size')).toBe('a5');
    expect(answer.headers()['content-type']).toContain('application/pdf');
    expect((await answer.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await download).suggestedFilename()).toBe(`speedclub-placard-a5-${vehicle.qr?.code}.pdf`);
    // Another member's build: refused (403 for a visible build, never the file).
    const [stranger] = await members('fsigplacardother');
    expect((await stranger.api.get(`vehicles/${vehicle.id}/placard.pdf?size=a4`)).status).toBe(403);
  });

  test('the scan statistics count a stranger\'s scan (STK-04; DQ-M54-10 folded the scans row into it)', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(120_000);
    const [owner] = await members('fsigscans');
    const vehicle = await buildVehicle(owner.api);
    await useSession(context, owner.session);
    await open(page, `/app/stickers/${vehicle.id}/stats`);
    await expect(id(page, 'STK-04.root')).toBeVisible();
    const before = expectStatus(await owner.api.get(`vehicles/${vehicle.id}/qr/stats`), 200, 'GET qr/stats').data;
    // QrStatsResource: exactly 30 days since M4.9 (QR-02 shows the 30-day bars), 14 before.
    expect(before.days).toHaveLength(30);

    const stranger = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] });
    try {
      await stranger.page.goto(`/C/${vehicle.qr?.code}`);
      await expect.poll(() => new URL(stranger.page.url()).pathname).toBe(`/v/${vehicle.slug}`);
    } finally {
      await stranger.context.close();
    }
    const after = expectStatus(await owner.api.get(`vehicles/${vehicle.id}/qr/stats`), 200, 'GET qr/stats').data;
    expect(after.total).toBe(before.total + 1);
    expect(after.total_14_days).toBe(before.total_14_days + 1);
    await page.reload();
    await expect(id(page, 'STK-04.total')).toHaveText(String(after.total));
  });
});

test.describe('Garage signature parts', () => {
  test('GAR-08 plate blur: two regions, the dialog, processing, then new variants', async ({ page, context }, testInfo) => {
    test.setTimeout(180_000);
    const [owner] = await members('fsigblur');
    // Unlisted: the blur replaces the photo's files, and a public build would leave other specs' Start pages asking for the old
    // ones (a 404 in F7 under load, round 3).
    const vehicle = await buildVehicle(owner.api, { visibility: 'unlisted' });
    const photo = vehicle.photos[0] as { id: string };
    const before = expectStatus(await owner.api.get(`vehicles/${vehicle.id}`), 200, 'GET vehicle').data.photos.find((p: { id: string }) => p.id === photo.id);
    await useSession(context, owner.session);
    await open(page, `/app/garage/${vehicle.id}/photos/${photo.id}`);
    await id(page, 'GAR-08.blur.start').click();
    const stage = id(page, 'GAR-08.blur.stage');
    await expect(stage).toBeVisible();
    await id(page, 'GAR-08.blur.add').click();
    await expect(id(page, 'GAR-08.blur.region.0')).toBeVisible();
    await flowShot(page, testInfo, 'GAR-08-blurRegions');
    await id(page, 'GAR-08.blur.apply').click();
    await expect(id(page, 'GAR-08.blur.confirm')).toBeVisible();
    await flowShot(page, testInfo, 'GAR-08-blurConfirm');
    const patched = page.waitForResponse(isCall('PATCH', `media/${photo.id}`));
    await id(page, 'GAR-08.blur.confirm.apply').click();
    const answer = await patched;
    expect(answer.status()).toBe(200);
    const regions = answer.request().postDataJSON().blur_regions as { x: number; y: number; w: number; h: number }[];
    expect(regions).toHaveLength(1);
    for (const r of regions) {
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
    expect((await answer.json()).data).toMatchObject({ status: 'processing', variants: [] });
    await expect(id(page, 'GAR-08.blur.processing')).toBeVisible();

    await runTestJobs(owner.email);
    await expect(id(page, 'GAR-08.blur.done')).toBeVisible({ timeout: 30_000 });
    const after = expectStatus(await owner.api.get(`vehicles/${vehicle.id}`), 200, 'GET vehicle').data.photos.find((p: { id: string }) => p.id === photo.id);
    expect(after.status).toBe('ready');
    const urls = (p: { variants: { url: string }[] }) => p.variants.map((v) => v.url);
    expect(urls(after).length).toBeGreaterThan(0);
    for (const url of urls(after)) expect(urls(before)).not.toContain(url);
    // The old public files are gone.
    expect((await page.request.get(urls(before)[0] as string)).status()).toBeGreaterThanOrEqual(400);
  });

  test('GAR-08: a region is drawn with the mouse on the desktop web', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [owner] = await members('fsigblurmouse');
    const vehicle = await buildVehicle(owner.api);
    await useSession(context, owner.session);
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, `/app/garage/${vehicle.id}/photos/${(vehicle.photos[0] as { id: string }).id}`);
    await id(page, 'GAR-08.blur.start').click();
    const stage = id(page, 'GAR-08.blur.stage');
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    if (!box) throw new Error('no stage');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.02), box.y + box.height * (0.3 + i * 0.015));
    await page.mouse.up();
    // A drag of a fifth of the stage is a region (blur.ts: TAP_SLOP 8 px, sides of at least 2 %).
    await expect(id(page, 'GAR-08.blur.region.0')).toBeVisible();
    await expect(id(page, 'GAR-08.blur.count')).toBeVisible();
  });

  test('GAR-06 HU/AU month: saved as YYYY-MM, shown again', async ({ page, context }) => {
    test.setTimeout(90_000);
    const [owner] = await members('fsighuau');
    const vehicle = await buildVehicle(owner.api);
    await useSession(context, owner.session);
    await open(page, `/app/garage/${vehicle.id}/specs`);
    await id(page, 'GAR-06.huAu').fill('03/2027');
    await expect(id(page, 'GAR-06.huAu')).toHaveValue('03/2027');
    const saved = page.waitForResponse(isCall('PATCH', `vehicles/${vehicle.id}`));
    await id(page, 'GAR-06.cta.primary').click();
    const answer = await saved;
    expect(answer.status()).toBe(200);
    expect(answer.request().postDataJSON()).toEqual({ hu_au_due: '2027-03' });
    await expect(id(page, 'GAR-06.saved')).toBeVisible();
    expect(expectStatus(await owner.api.get(`vehicles/${vehicle.id}`), 200, 'GET vehicle').data.hu_au_due).toBe('2027-03');
    await open(page, `/app/garage/${vehicle.id}/specs`);
    await expect(id(page, 'GAR-06.huAu')).toHaveValue('03/2027');
  });

  test('GAR-10 legal status ABE, and the pill with the disclaimer on VEH-02', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const [owner] = await members('fsiglegal');
    const vehicle = await buildVehicle(owner.api, { mods: [BBS_WHEELS] });
    const mod = vehicle.mods[0] as { id: string };
    await useSession(context, owner.session);
    await open(page, `/app/garage/${vehicle.id}/mods/${mod.id}`);
    await id(page, 'GAR-10.legalStatus').click();
    await expect(id(page, 'GAR-10.legalStatusSheet')).toBeVisible();
    await flowShot(page, testInfo, 'GAR-10-legalStatusSheet');
    await row(page, 'GAR-10.legalStatusSheet.option.abe').click();
    await expect(id(page, 'GAR-10.legalStatus.value')).toHaveText('ABE');
    const saved = page.waitForResponse((r) => ['PATCH', 'PUT'].includes(r.request().method()) && new URL(r.url()).pathname.endsWith(`/mods/${mod.id}`));
    await id(page, 'GAR-10.cta.primary').click();
    const answer = await saved;
    expect(answer.status()).toBe(200);
    expect(answer.request().postDataJSON()).toMatchObject({ legal_status: 'abe' });

    await open(page, `/app/v/${vehicle.slug}/mods/${mod.id}`);
    await expect(id(page, 'VEH-02.legalStatus')).toHaveText('ABE');
    await expect(id(page, 'VEH-02.legalDisclaimer')).toBeVisible();
  });
});

test.describe('SYS-01 and SYS-02', () => {
  test('maintenance from app-config sends every route to SYS-02 with the server\'s message', async ({ page }, testInfo) => {
    const message = 'Wir spielen ein Update ein. In etwa 20 Minuten sind wir zurück.';
    await page.route(apiPath('app-config'), async (route: Route) => {
      const real = await route.fetch();
      const body = await real.json();
      body.data.maintenance = { enabled: true, message };
      await route.fulfill({ response: real, json: body });
    });
    await open(page, '/app/discover');
    await expect.poll(() => pathOf(page)).toBe('/app/maintenance');
    await expect(id(page, 'SYS-02.state.title')).toBeVisible();
    await expect(id(page, 'SYS-02.root')).toContainText(message);
    await flowShot(page, testInfo, 'SYS-02');
  });

  test('SYS-01 renders on a direct load while app-config does not answer', async ({ page, expectFailedResponses }, testInfo) => {
    expectFailedResponses([{ status: 'network', url: apiPath('app-config') }]);
    await page.route(apiPath('app-config'), (route: Route) => route.abort('internetdisconnected'));
    await open(page, '/app/update-required');
    await expect(id(page, 'SYS-01.state.title')).toBeVisible();
    await expect(id(page, 'SYS-01.state.action')).toBeVisible();
    await flowShot(page, testInfo, 'SYS-01');
  });
});
