// A5 Sticker-Designs (ADM-65, M5.4 admin; m5.4-contract §8), Chromium at 1280 like the other admin flows. A test member publishes a car,
// designs a Classic sticker (M, white print on clear film) through the member API, passes the server Scan-Test (version 1, validated) and
// changes the colourway afterwards (version 2, a draft). The admin finds both versions by @username, narrows to "Geprüft" through the
// filter bar, opens the design in the drawer (dimension sketch, facts, the audit note) and downloads the print PDF: a real PDF named after
// the design id, and one `sticker.print_downloaded` row in the audit log with the design as its target. The draft has no print files. The
// moderator (no stickers.print) has no nav entry, gets the 403 page and a direct download answers 403 without an audit row.
//
// With A5_STICKER_SHOTS=<dir> (relative to the repo root) the flow also saves pictures of the list and the drawer on real rows, Carbon
// and Hell, for design QA: the matrix cells of routes-m54-adm.mjs see only the rows the local database happens to have.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { admin, choose, DESKTOP, pageProps, realClock, staffContext } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

type DesignRow = { id: string; reference: string; version: number; state: 'draft' | 'validated'; downloads: { pdf: string; svg: string } | null };
type AuditRow = { id: number; action: string; target: { type: string; id: string | null } | null; actor: { type: string } };

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SHOTS = process.env.A5_STICKER_SHOTS ? new URL(`${process.env.A5_STICKER_SHOTS.replace(/\/?$/, '/')}`, `file://${REPO}`) : null;

/** The page at `path` in Carbon and Hell (?qaTheme, non-production), once `ready` shows; deep links keep a drawer open (?design=SD…). */
async function shot(page: Page, name: string, path: string, ready: string): Promise<void> {
  if (SHOTS === null) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const theme of ['carbon', 'light'] as const) {
    await page.goto(`${path}${path.includes('?') ? '&' : '?'}qaTheme=${theme}`);
    await expect(page.locator(ready).first()).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}__1280x800__${theme}__de.png`, SHOTS)), animations: 'disabled' });
  }
}

test.describe('A5 Sticker-Designs', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('find by @username → filter Geprüft → open → download the print PDF (audited) → moderator refused', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const [owner] = await members('a5sticker');
    await named(owner, 'Jonas A5', 'Hamburg');
    const car = await buildVehicle(owner.api, { photos: 1 });

    // 1. The member's sticker: version 1 validated by the server Scan-Test, then a change opens version 2 as a draft. Every save sends the
    // version and the revision it last saw (`base_revision`, review MF-4: the revision moves on every write of the design, 0 before the first).
    const first = expectStatus(
      await owner.api.put(`vehicles/${car.id}/sticker-design`, {
        base_version: 0,
        base_revision: 0,
        template: 'classic',
        options: { size: 'm', colourway: 'white', material: 'transparent', qr: true },
      }),
      201,
      'PUT sticker-design',
    ).data as { version: number; revision: number; reference: string };
    const tested = expectStatus(await owner.api.post(`vehicles/${car.id}/sticker-design/validate`, { version: first.version }), 200, 'POST validate').data as {
      state: string;
      scan_test: string;
      reference: string;
      revision: number;
    };
    expect(tested.state).toBe('validated');
    expect(tested.scan_test).toBe('passed');
    expect(typeof tested.revision, 'the validated design carries its revision').toBe('number');
    expectStatus(
      await owner.api.put(`vehicles/${car.id}/sticker-design`, { base_version: first.version, base_revision: tested.revision, template: 'classic', options: { colourway: 'black' } }),
      201,
      'PUT sticker-design v2',
    );

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'admin');
    await realClock(page);

    // 2. ADM-65 from the nav, then the filter bar: @username finds both versions, "Geprüft" leaves version 1.
    await page.goto('/admin');
    await id(page, 'shell.nav.sticker-designs').click();
    await expect(page).toHaveURL(/\/admin\/stickers\/designs/);
    await expect(id(page, 'ADM-65.table')).toBeVisible();
    const filters = page.getByRole('form', { name: admin('stickers', 'designs.filters.label') });
    await id(page, 'ADM-65.filter.q').fill(`@${owner.username}`);
    await id(page, 'ADM-65.filter.apply').click();
    // Wait for the filtered answer itself: on a database without other designs the unfiltered list has the same two rows.
    await expect(page).toHaveURL(/filter%5Bq%5D=|filter\[q\]=/);
    await expect(page.locator('html.nprogress-busy')).toHaveCount(0);
    const rows = id(page, 'ADM-65.table.row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByTestId('ADM-65.download.none')).toBeVisible();

    await choose(page, filters, admin('stickers', 'designs.filters.state'), admin('stickers', 'designs.state.validated'));
    await id(page, 'ADM-65.filter.apply').click();
    await expect(page).toHaveURL(/filter%5Bstate%5D=validated|filter\[state\]=validated/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(tested.reference);

    const listPath = `/admin/stickers/designs?filter[q]=${encodeURIComponent(`@${owner.username}`)}`;
    const listed = (await pageProps<{ rows: { data: DesignRow[] } }>(context, listPath)).rows.data;
    expect(listed.map((row) => [row.version, row.state])).toEqual([
      [1, 'validated'],
      [2, 'draft'],
    ]);
    const design = listed[0]!;
    expect(design.reference).toBe(tested.reference);
    expect(design.downloads?.pdf).toMatch(new RegExp(`/admin/stickers/designs/${design.reference}/print\\.pdf$`));
    expect(listed[1]!.downloads).toBeNull();

    // 3. Open it: the drawer with the sketch, the facts and the audit note.
    await rows.first().getByTestId('ADM-65.open').click();
    const drawer = id(page, 'ADM-65.drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(admin('stickers', 'designs.detail.title', { reference: design.reference }));
    await expect(id(page, 'ADM-65.sketch')).toBeVisible();
    await expect(id(page, 'ADM-65.detail.state')).toHaveText(admin('stickers', 'designs.state.validated'));
    await expect(drawer).toContainText(admin('stickers', 'designs.download.audited'));
    await shot(page, 'ADM-65-member', listPath, '[data-testid="ADM-65.table"] [data-testid="ADM-65.open"]');
    await shot(page, 'ADM-65-drawer', `${listPath}&design=${design.reference}`, '[data-testid="ADM-65.detail"]');
    if (SHOTS !== null) {
      await page.goto(`${listPath}&design=${design.reference}`);
      await expect(drawer).toBeVisible();
    }

    // 4. The print PDF: a real PDF named after the design id and version, and one audit row with the design as its target.
    const [download] = await Promise.all([page.waitForEvent('download'), id(page, 'ADM-65.drawer.download.pdf').click()]);
    expect(download.suggestedFilename()).toBe(`speedclub-sticker-${design.reference}-v1.pdf`);
    const file = await download.createReadStream();
    const head = await new Promise<string>((resolve, reject) => {
      file.once('data', (chunk) => resolve(chunk.subarray(0, 5).toString('latin1')));
      file.once('error', reject);
    });
    expect(head).toBe('%PDF-');
    await expect
      .poll(async () => {
        const audit = await pageProps<{ rows: { data: AuditRow[] } }>(context, '/admin/audit?filter[action]=sticker.print_downloaded&per_page=100');
        return audit.rows.data.filter((row) => row.action === 'sticker.print_downloaded' && row.target?.id === design.id && row.actor.type === 'staff').length;
      })
      .toBe(1);

    // 5. The draft's print file is refused (409), and nothing is audited for it.
    const draftFile = await context.request.get(`/admin/stickers/designs/${listed[1]!.reference}/print.pdf`, { maxRedirects: 0 });
    expect(draftFile.status()).toBe(409);

    // 6. The moderator: no nav entry, the 403 page, a direct download refused and not audited.
    // The refusals below are what this step proves: the page and the direct download answer 403 (logged by the browser as failed loads).
    const { context: moderator, page: moderatorPage } = await browserOf(
      browser,
      null,
      { pageErrors, blockedRequests, expected: [{ status: 403, url: /\/admin\/stickers\/designs(\/[^/]+\/print\.(pdf|svg))?$/ }] },
      DESKTOP,
    );
    try {
      await staffContext(moderator, 'moderator');
      await realClock(moderatorPage);
      await moderatorPage.goto('/admin');
      await expect(id(moderatorPage, 'ADM-06')).toBeVisible();
      await expect(moderatorPage.locator('[data-testid="shell.nav.sticker-designs"]')).toHaveCount(0);
      const refused = await moderatorPage.goto('/admin/stickers/designs');
      expect(refused?.status()).toBe(403);
      await expect(id(moderatorPage, 'ADM-05')).toHaveAttribute('data-status', '403');
      const direct = await moderator.request.get(`/admin/stickers/designs/${design.reference}/print.pdf`, { maxRedirects: 0 });
      expect(direct.status()).toBe(403);
    } finally {
      await moderator.close();
    }
    const after = await pageProps<{ rows: { data: AuditRow[] } }>(context, '/admin/audit?filter[action]=sticker.print_downloaded&per_page=100');
    expect(after.rows.data.filter((row) => row.target?.id === design.id).length).toBe(1);
  });
});
