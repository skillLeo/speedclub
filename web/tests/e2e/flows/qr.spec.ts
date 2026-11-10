// M1.7 app screens on the member web (FS-9, 02_PRODUCT_SPEC §3.4, 08_LEGAL_COMPLIANCE §7): QR-01 my codes, QR-02 the
// detail with the server-rendered card and real downloads, QR-03 the placement guide in the legal wording, QR-04 the
// public page preview, and the reissue behind its destructive dialog. lukas.sc is only read; the reissue and the failed
// download belong to a fresh member under E2E_DOMAIN (support/garage.mjs), deleted in the global teardown.
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { applyAuth, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { buildVehicle, createGarageMember, demoIds, expectStatus, R34 } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';
import { expectText, expectTextContaining } from '../support/text.mjs';

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LEGAL_RULES = [
  'Am sichersten: außen auf der Karosserie (z. B. Kofferraumdeckel, Stoßfänger) oder klein innen in einer Ecke der Heckscheibe.',
  'Heckscheibe nur, wenn dein Auto zwei Außenspiegel hat. Sonst nur ganz am Rand, damit die Sicht nach hinten frei bleibt.',
  'Vordere Seitenscheiben: nicht bekleben.',
  'Windschutzscheibe: möglichst gar nicht. Wenn überhaupt, nur ganz am Rand außerhalb des Sichtfelds und nie im Wischerbereich.',
  'Klein halten: deutlich unter 0,1 m² und nie mehr als ein Viertel einer Scheibe. Nicht spiegelnd, nicht leuchtend, keine Kennzeichen, Leuchten oder Plaketten verdecken.',
];
const LEGAL_FOOTER = 'Keine Rechtsberatung. Maßgeblich sind die StVZO (u. a. §§ 35b, 40) und die Auslegung der Behörden. Verstöße können ein Bußgeld nach sich ziehen.';

test.describe('QR codes in the app', () => {
  test('QR-01 lists the codes, QR-02 shows the card and downloads a real PNG', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    // A stable page first: the garage strip's photos still move the rows below them while they load.
    await qaGoto('/app/profile');
    await id(page, 'PROF-01.qrCodes').click();
    await expect(id(page, 'QR-01.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/profile/qr');
    const row = id(page, `QR-01.row.${r34}`);
    await expectTextContaining(row, 'Nissan Skyline GT-R R34');
    await expect(row).toContainText(R34.shortCode);
    await expect(row).toContainText('Aktiv');

    await id(page, `QR-01.row.${r34}.body`).click();
    await expect(id(page, 'QR-02.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/qr/${r34}`);
    await expectText(id(page, 'QR-02.title'), 'QR-Code');
    await expect(id(page, 'QR-02.card.shortCode')).toHaveText(R34.shortCode);
    expect((await id(page, 'QR-02.card.url').innerText()).replace(/\s+/g, '')).toBe(`${new URL(BASE_URL).host}/C/${R34.code}`);
    // Always black on white (§3.4), whatever the theme.
    expect(await id(page, 'QR-02.card').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    // FS-9 / DQ-035: the card lines up with the title and the buttons on both edges.
    const [card, title, download] = await Promise.all(['QR-02.card', 'QR-02.title', 'QR-02.download'].map((t) => id(page, t).boundingBox()));
    if (!card || !title || !download) throw new Error('missing geometry');
    expect(Math.abs(card.x - title.x)).toBeLessThan(1);
    expect(Math.abs(card.x + card.width - (download.x + download.width))).toBeLessThan(1);

    await id(page, 'QR-02.download').click();
    await expect(id(page, 'QR-02.downloadSheet')).toBeVisible();
    for (const format of ['png', 'png2048', 'svg', 'pdf']) await expect(id(page, `QR-02.download.${format}`)).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent('download'), id(page, 'QR-02.download.png').click()]);
    // The toast first: it stays for seconds, and reading the finished file can take longer on a busy machine.
    await expect(id(page, 'QR-02.downloadToast')).toHaveText(`Download gestartet: speedclub-qr-${R34.code}.png`);
    expect(file.suggestedFilename()).toBe(`speedclub-qr-${R34.code}.png`);
    const bytes = await readFile(await file.path());
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1024, 1024]);
  });

  test('a failed download stays on its row with the reason', async ({ page, qaGoto, expectFailedResponses }) => {
    const member = await createGarageMember('qrdownload');
    const vehicle = await buildVehicle(member.api, { photos: 1 });
    await useSession(page.context(), member.session);
    const svg = new RegExp(`/api/v1/vehicles/${vehicle.id}/qr\\.svg(\\?.*)?$`);
    expectFailedResponses([{ status: 500, url: svg }]);
    await qaGoto(`/app/qr/${vehicle.id}`);
    await expect(id(page, 'QR-02.card')).toBeVisible();
    await page.route(svg, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Server Error"}' }));
    await id(page, 'QR-02.download').click();
    await id(page, 'QR-02.download.svg').click();
    await expect(id(page, 'QR-02.download.svg.error')).toBeVisible();
    await expect(id(page, 'QR-02.downloadSheet')).toBeVisible();
  });

  test('QR-03 gives the placement rules in the words of 08_LEGAL §7, QR-04 links the public page', async ({ page, context, qaGoto }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    await qaGoto(`/app/qr/${r34}`);
    await id(page, 'QR-02.placement').click();
    await expect(id(page, 'QR-03.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/qr/${r34}/placement`);
    for (const rule of LEGAL_RULES) await expect(page.getByText(rule, { exact: true })).toHaveCount(1);
    await expect(id(page, 'QR-03.disclaimer')).toHaveText(LEGAL_FOOTER);
    await expect(id(page, 'QR-03.rule.print')).toContainText('30 × 30 mm');
    await expect(id(page, 'QR-03.diagram')).toBeVisible();

    await qaGoto(`/app/qr/${r34}`);
    await id(page, 'QR-02.publicPage').click();
    await expect(id(page, 'QR-04.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/qr/${r34}/preview`);
    await expect(id(page, 'QR-04.open')).toHaveAttribute('href', `${BASE_URL}/v/${R34.slug}?view=public`);
    await expect(id(page, 'QR-04.url')).toContainText(`/v/${R34.slug}`);
    await expect(id(page, 'QR-04.url')).not.toContainText('view=public');

    // BH-22: the owner, signed in, really sees what a stranger sees: the server's page, and none of the app around the car.
    const popup = page.waitForEvent('popup');
    await id(page, 'QR-04.open').click();
    const stranger = await popup;
    await stranger.waitForLoadState();
    expect(pathOf(stranger)).toBe(`/v/${R34.slug}`);
    await expect(stranger.locator('[data-testid="WEB-01.root"]')).toBeVisible();
    await expect(stranger.locator('[data-testid="WEB-01.register"]').first()).toBeAttached();
    await expect(stranger.locator('[data-testid="VEH-01.root"]')).toHaveCount(0);
    await expect(stranger.locator('[data-testid="VEH-01.moreActions"]')).toHaveCount(0);
    await expect(stranger.locator('[data-testid="VEH-01.moreSheet"]')).toHaveCount(0);
    await expect(stranger.locator('[data-testid^="shell."]')).toHaveCount(0);
    await stranger.close();
  });

  test('replacing the code asks first, then the old sticker is no longer valid', async ({ page, qaGoto, expectFailedResponses }) => {
    const member = await createGarageMember('qrreissue');
    const vehicle = await buildVehicle(member.api, { photos: 1 });
    const old = vehicle.qr?.code as string;
    expectFailedResponses([{ status: 410, url: new RegExp(`/C/${old}$`) }]);
    await useSession(page.context(), member.session);
    await qaGoto(`/app/qr/${vehicle.id}`);
    await expect(id(page, 'QR-02.card.shortCode')).toHaveText(`${old.slice(0, 4)} ${old.slice(4)}`);

    await id(page, 'QR-02.reissue').click();
    await expect(id(page, 'QR-02.reissueDialog')).toBeVisible();
    await id(page, 'QR-02.reissueCancel').click();
    await expect(id(page, 'QR-02.reissueDialog')).toHaveCount(0);
    expect(expectStatus(await member.api.get(`vehicles/${vehicle.id}`), 200, 'GET vehicle').data.qr.code).toBe(old);

    await id(page, 'QR-02.reissue').click();
    await id(page, 'QR-02.reissueConfirm').click();
    await expectText(id(page, 'QR-02.reissueToast'), 'Neuer QR-Code ist aktiv. Lade ihn herunter und tausch den alten Sticker aus.');
    const fresh = expectStatus(await member.api.get(`vehicles/${vehicle.id}`), 200, 'GET vehicle').data.qr.code as string;
    expect(fresh).not.toBe(old);
    await expect(id(page, 'QR-02.card.shortCode')).toHaveText(`${fresh.slice(0, 4)} ${fresh.slice(4)}`);

    const scan = await page.goto(`/C/${old}`);
    expect(scan?.status()).toBe(410);
    await expectText(id(page, 'WEB-06.title'), 'Dieser QR-Code ist nicht mehr gültig');
  });

  // ADR-148 a, DQ-173: the account-wide switch on GAR-12 saves at once through PATCH me/settings, apart from the form's
  // Speichern; off, strangers no longer see who owns the car, and a change the server refuses goes back with a toast.
  test('GAR-12 "Besitzer auf der QR-Seite" hides the owner from strangers, and a refused change goes back', async ({ page, browser, qaGoto, expectFailedResponses }) => {
    const member = await createGarageMember('qrowner');
    const vehicle = await buildVehicle(member.api, { photos: 1 });
    expect(expectStatus(await member.api.get('me/settings'), 200, 'GET me/settings').data.show_owner_on_qr).toBe(true);
    await useSession(page.context(), member.session);
    await qaGoto(`/app/garage/${vehicle.id}/visibility`);
    await expectTextContaining(id(page, 'GAR-12.ownerOnQr'), 'Für alle deine Fahrzeuge');
    await expectTextContaining(id(page, 'GAR-12.ownerOnQr'), 'Besitzer auf der QR-Seite');
    const toggle = id(page, 'GAR-12.ownerOnQr.switch');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    const isSettingsPatch = (r: { url: () => string; request: () => { method: () => string } }) =>
      new URL(r.url()).pathname === '/api/v1/me/settings' && r.request().method() === 'PATCH';
    const [saved] = await Promise.all([page.waitForResponse(isSettingsPatch), toggle.click()]);
    expect(saved.status()).toBe(200);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(expectStatus(await member.api.get('me/settings'), 200, 'GET me/settings').data.show_owner_on_qr).toBe(false);

    const guest = await browser.newContext({ baseURL: BASE_URL });
    try {
      const shown = await guest.request.get(`/api/v1/public/vehicles/${vehicle.slug}`, { headers: { Accept: 'application/json' } });
      expect(shown.status()).toBe(200);
      expect((await shown.json()).data.owner).toBeNull();
      const stranger = await guest.newPage();
      await stranger.goto(`/v/${vehicle.slug}`);
      await expect(stranger.getByTestId('WEB-01.root')).toBeVisible();
      await expect(stranger.locator('[data-testid="VEH-01.ownerRow"]')).toHaveCount(0);
    } finally {
      await guest.close();
    }

    const settings = /\/api\/v1\/me\/settings(\?.*)?$/;
    expectFailedResponses([{ status: 500, url: settings }]);
    await page.route(settings, (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Server Error"}' }) : route.fallback(),
    );
    await toggle.click();
    await expect(id(page, 'GAR-12.ownerOnQr.failed')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(expectStatus(await member.api.get('me/settings'), 200, 'GET me/settings').data.show_owner_on_qr).toBe(false);
  });
});
