// A5 Spots (ADM-62, M5.9b admin; m5.9b contract §7), Chromium at 1280 like the other admin flows. A test owner publishes a car; a test
// spotter (aged past the 24 h of contract §2) gets twelve spots of it 30 hours ago inside nine minutes, ten in Köln and two in München
// (backend dex-spot-fixture), so every one of them is a burst (> 10 in 10 min) and a city hop (> 300 km within 1 h). The moderator
// filters ADM-62 by "Nur Auffälligkeiten", sees the badges, opens a spot, removes it with a reason (template + text, ⚿ recent
// password): the record says "Entfernt", its activity holds "Spot entfernt", the list no longer has the row and the owner's spot count
// went down by one. The analyst sees the list read-only and a direct POST answers 403. No coordinate in any page prop.
import { admin, choose, confirmPasswordDirectly, DESKTOP, pageProps, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { ageTestMember, dexSpotFixture } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

/** GeoNames ids of the seeded city table (public/geo/de-cities.json): about 456 km apart. */
const KOELN = 2886242;
const MUENCHEN = 2867714;
const COORDINATE_KEY = /^(lat|lng|lon|latitude|longitude|coordinates?|location|geo|install_key|install_id_hash)$/i;

type Row = { id: string; spotter: { username: string | null }; signals: { burst: { spots: number } | null; hop: { km: number } | null } };
type ListProps = { rows: { data: Row[] }; canRemove: boolean };

function coordinateKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [...(COORDINATE_KEY.test(key) ? [`${path}.${key}`] : []), ...coordinateKeys(item, `${path}.${key}`)]);
}

test.describe('A5 Spots', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('filter by signal → open → remove with reason → row gone + audit entry → analyst read-only', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const [owner, spotter] = await members('a5spotowner', 'a5spotter');
    await named(owner, 'Kai A5', 'Düsseldorf');
    await named(spotter, 'Mira A5', 'Köln');
    await ageTestMember(spotter.email, 3);
    const car = await buildVehicle(owner.api, { photos: 1 });
    await dexSpotFixture(spotter.email, car.id, KOELN, { count: 10, hoursAgo: 30 });
    await dexSpotFixture(spotter.email, car.id, MUENCHEN, { count: 2, hoursAgo: 30 });
    const statsBefore = expectStatus(await owner.api.get(`vehicles/${car.id}/spot-stats`), 200, 'GET spot-stats').data as { total: number };
    expect(statsBefore.total).toBe(12);

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'moderator');
    await realClock(page);
    await confirmPasswordDirectly(context);
    const list = `/admin/moderation/spots?filter[spotter]=${encodeURIComponent(`@${spotter.username}`)}`;

    // 1. ADM-62, this spotter only, then "Nur Auffälligkeiten" through the filter bar: all twelve carry Serie and Städtesprung.
    await page.goto(list);
    await expect(id(page, 'ADM-62.table')).toBeVisible();
    const filters = page.getByRole('form', { name: admin('spots', 'filters.label') });
    await choose(page, filters, admin('spots', 'filters.signal'), admin('spots', 'filters.signals_only'));
    await id(page, 'ADM-62.filter.apply').click();
    await expect(page).toHaveURL(/filter%5Bsignal%5D=any|filter\[signal\]=any/);
    const rows = id(page, 'ADM-62.table.row');
    await expect(rows).toHaveCount(12);
    await expect(rows.first().getByTestId('ADM-62.signal.burst')).toBeVisible();
    await expect(rows.first().getByTestId('ADM-62.signal.hop')).toBeVisible();

    const props = await pageProps<ListProps>(context, `${list}&filter[signal]=any`);
    expect(props.canRemove).toBe(true);
    expect(props.rows.data).toHaveLength(12);
    expect(props.rows.data.every((row) => row.signals.burst?.spots === 12 && (row.signals.hop?.km ?? 0) > 300)).toBe(true);
    expect(coordinateKeys(props)).toEqual([]);
    const target = props.rows.data[0]!;

    // 2. Open the newest spot: the record with its signals and the city, never a place.
    await rows.first().getByTestId('ADM-62.open').click();
    await expect(page).toHaveURL(new RegExp(`/admin/moderation/spots/${target.id}`));
    await expect(id(page, 'ADM-62R.detail')).toBeVisible();
    await expect(id(page, 'ADM-62R.signal.burst')).toBeVisible();
    await expect(id(page, 'ADM-62R.signal.hop')).toBeVisible();
    const record = await pageProps<Record<string, unknown>>(context, `/admin/moderation/spots/${target.id}`);
    expect(coordinateKeys(record)).toEqual([]);

    // 3. "Spot entfernen": a plain confirmation (ADR-540, no internal reason); the confirm is the one red button.
    await id(page, 'ADM-62R.remove').click();
    const dialog = id(page, 'ADM-62R.remove-dialog');
    await expect(dialog).toBeVisible();
    await id(page, 'ADM-62R.remove-dialog.confirm').click();
    await expect(toast(page, admin('spots', 'flash.removed'))).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(id(page, 'ADM-62R.status')).toHaveText(admin('spots', 'status.removed'));
    await expect(id(page, 'ADM-62R.remove')).toHaveCount(0);
    await expect(id(page, 'ADM-62R.activity')).toContainText(admin('audit', 'actions.spot.removed'));

    // 4. Back on the list: the row is gone, eleven remain; the owner's count went down by one.
    await page.goto(`${list}&filter[signal]=any`);
    await expect(rows).toHaveCount(11);
    await expect(page.locator(`a[href$="/admin/moderation/spots/${target.id}"]`)).toHaveCount(0);
    const statsAfter = expectStatus(await owner.api.get(`vehicles/${car.id}/spot-stats`), 200, 'GET spot-stats').data as { total: number };
    expect(statsAfter.total).toBe(11);

    // Removing it again changes nothing (idempotent).
    const again = await context.request.post(`/admin/moderation/spots/${target.id}/remove`, {
      headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(context) },
      data: {},
    });
    expect(again.status()).toBe(200);
    expect(((await again.json()) as { removed: boolean }).removed).toBe(false);

    // 5. The analyst: the list read-only, a direct removal refused.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await analystPage.goto(list);
      await expect(id(analystPage, 'ADM-62.view-only')).toBeVisible();
      await expect(id(analystPage, 'ADM-62.remove')).toHaveCount(0);
      const second = props.rows.data[1]!;
      const refused = await analyst.request.post(`/admin/moderation/spots/${second.id}/remove`, {
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst) },
        data: { reason: 'Serie von Spots in wenigen Minuten.' },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await analyst.close();
    }
    const statsEnd = expectStatus(await owner.api.get(`vehicles/${car.id}/spot-stats`), 200, 'GET spot-stats').data as { total: number };
    expect(statsEnd.total).toBe(11);
  });
});
