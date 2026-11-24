// F18 STREET DEX (10 §16.2, docs/reports/phase-5/m5.9b-contract.md §8–§9, owner gift detail M5.9b): a member scans another member's
// sticker. The member web has no camera (DEX-02 shows "only in the app"), so the scan goes through the API exactly as the native scanner
// sends it: POST /api/v1/spots with the code, the device's nearest city id and an Idempotency-Key, never a coordinate. Then, in the
// member web: the reveal DEX-03 → Mein Dex DEX-01 → the sets DEX-05 with the JDM Legends progress; the 3-hourly owner alert runs through
// the test backend for this car only and the owner finds the grouped row on HOME-02; then the privacy rules: no coordinate in any Dex
// answer, a ghost car leaves search and the public garage list, a night spot's city never reaches the owner's numbers (DEX-06), and the
// public spot map lists only cities where at least five different cars were spotted more than 24 hours ago (SEC-P5G-03: one car spotted
// five times never puts its town on the map). Runs at 390 × carbon × de like the other flows.
import type { Page, Response } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { ageTestMember, dexForgetSpotMap, dexFreeCities, dexRunAlerts, dexSpotFixture } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, de, id, members, named, open } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

type SpotCard = {
  spot_id: string | null;
  spotted: boolean;
  vehicle: { id: string; name: string; dex_number: number | null; rarity: string; ghost: boolean };
  first_spotter: boolean;
};
type SpotResult = { data: SpotCard; meta: { new_in_dex: boolean; duplicate: boolean; counted: boolean; first_spotter: boolean } };
type City = { id: number; name: string; bundesland: string };

/** Any key that could carry a place finer than a city. */
const COORDINATE_KEY = /^(lat|lng|lon|latitude|longitude|coords?|coordinates|geo|geohash|point|location)$/i;

function coordinateKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => coordinateKeys(item, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...(COORDINATE_KEY.test(key) ? [`${path}.${key}`] : []),
    ...coordinateKeys(item, `${path}.${key}`),
  ]);
}

/** Whether a moment is inside the night window (22:00–06:00 Europe/Berlin), when a spot's city is never shown for a single car. */
function berlinNight(at: Date): boolean {
  // The hour part itself: the whole string reads "22 Uhr" in current ICU, and Number() of that was NaN, so every night counted as day
  // (E2E P5 final run, F18 at 22:44 in Berlin).
  const part = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at).find((p) => p.type === 'hour');
  const hour = Number(part?.value);
  if (!Number.isInteger(hour)) throw new Error(`berlinNight: no hour in ${JSON.stringify(part)}`);
  return hour >= 22 || hour < 6;
}

/** Collects the JSON answers of the Dex endpoints a page loads, for the coordinate scan. */
function watchDexAnswers(page: Page, sink: unknown[]): void {
  page.on('response', (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (!/^\/api\/v1\/(spots|me\/dex|vehicles\/[^/]+\/(dex-card|spot-stats)|spot-map|rarity-rules)/.test(path)) return;
    void response.json().then((body: unknown) => sink.push(body), () => undefined);
  });
}

test.describe('F18 STREET DEX', () => {
  test('scan → reveal → Mein Dex → sets → grouped owner alert → privacy', async ({ page, context, browser, pageErrors, blockedRequests, expectFailedResponses }) => {
    test.setTimeout(300_000);
    const [owner, spotter] = await members('f18owner', 'f18spotter');
    await named(owner, 'Kai F18', 'Düsseldorf');
    await named(spotter, 'Mira F18', 'Köln');
    // Spots of accounts younger than 24 hours are stored but not counted (contract §2).
    await ageTestMember(spotter.email, 3);
    const nickname = `F18Geist${owner.username.slice(-5)}`;
    const car = await buildVehicle(owner.api, { photos: 1, nickname });
    const code = car.qr?.code as string;
    expect(code).toBeTruthy();
    const [scanCity, mapCity, nightCity] = (await dexFreeCities(3)).cities as [City, City, City];
    const answers: unknown[] = [];
    // The member web export may already carry lane A's M5.9d badge poll before its server part exists (GET me/badges answers 404 then).
    // Allowed only while the endpoint is really missing, so the allowance goes away by itself with M5.9d.
    const badgesMissing = (await spotter.api.get('me/badges?unseen=1')).status === 404;
    const expected = badgesMissing ? [{ status: 404, url: /\/api\/v1\/me\/badges(\?.*)?$/ }] : [];
    expectFailedResponses(expected);

    // 1. DEX-02 on the device: the code, the nearest city id and its Bundesland, an Idempotency-Key. Never a coordinate.
    const refused = await spotter.api.post('spots', { code, city_id: scanCity.id, lat: 51.2277, lng: 6.7735 });
    expect(refused.status).toBe(422);
    const scannedAt = new Date();
    const scan = await spotter.api.post('spots', { code, city_id: scanCity.id, bundesland: scanCity.bundesland });
    const spot = expectStatus(scan, 201, 'POST spots') as SpotResult;
    answers.push(spot);
    expect(spot.meta).toMatchObject({ new_in_dex: true, duplicate: false, counted: true, first_spotter: true });
    expect(spot.data.vehicle.id).toBe(car.id);
    expect(spot.data.vehicle.dex_number).toEqual(expect.any(Number));
    // The same car again within 24 h answers with that spot (200, duplicate), no error.
    const again = expectStatus(await spotter.api.post('spots', { code, city_id: scanCity.id }), 200, 'POST spots again') as SpotResult;
    expect(again.meta.duplicate).toBe(true);
    expect(again.data.spot_id).toBe(spot.data.spot_id);
    // Own car: refused.
    expect((await owner.api.post('spots', { code })).body.code).toBe('spot_own_car');

    // 2. DEX-03 reveal from its deep link, then Mein Dex and the sets, in the member web.
    await useSession(context, spotter.session);
    watchDexAnswers(page, answers);
    await open(page, `/app/dex/spot/${spot.data.spot_id}`);
    await expect(id(page, 'DEX-03.root')).toBeVisible();
    await expect(id(page, 'DEX-03.statusLine')).toHaveText(de('dex', 'reveal.newLine'));
    await expect(id(page, 'DEX-03.new')).toBeVisible();
    await expect(id(page, 'DEX-03.cardFrame')).toHaveAttribute('aria-label', de('dex', 'reveal.label', { name: spot.data.vehicle.name }));

    await open(page, '/app/dex');
    await expect(id(page, 'DEX-01.root')).toBeVisible();
    await expect(id(page, `DEX-01.card.${car.id}`)).toBeVisible();
    const dex = expectStatus(await spotter.api.get('me/dex'), 200, 'GET me/dex') as { data: SpotCard[]; meta: { found: number; total: number } };
    answers.push(dex);
    expect(dex.meta.found).toBe(1);
    expect(dex.data.map((card) => card.vehicle.id)).toEqual([car.id]);

    await open(page, '/app/dex/sets');
    await expect(id(page, 'DEX-05.root')).toBeVisible();
    const sets = expectStatus(await spotter.api.get('me/dex/sets'), 200, 'GET me/dex/sets') as { data: { key: string; name: string; progress: number; target: number }[] };
    answers.push(sets);
    const jdm = sets.data.find((set) => set.key === 'jdm-legends');
    expect(jdm?.progress).toBe(1);
    await expect(id(page, 'DEX-05.set.jdm-legends.progress')).toHaveText(de('dex', 'sets.progress', { progress: '1', target: String(jdm?.target) }));
    await expect(id(page, 'DEX-05.set.jdm-legends.progress')).toHaveAttribute(
      'aria-label',
      de('dex', 'sets.progressLabel', { name: jdm?.name ?? '', progress: 1, target: jdm?.target ?? 0 }),
    );

    // 3. The 3-hourly alert for this car: one grouped row on the owner's HOME-02, the day's count, the city only for a day spot.
    expect((await dexRunAlerts(car.id)).told).toBe(1);
    const inbox = expectStatus(await owner.api.get('notifications'), 200, 'GET notifications') as {
      data: { id: string; type: string; group_key: string; actors: unknown[]; vehicle: { id: string } | null; details: Record<string, unknown> }[];
    };
    const alert = inbox.data.find((row) => row.type === 'spot_alert');
    expect(alert).toBeTruthy();
    expect(alert!.group_key).toMatch(new RegExp(`^spot_alert:${car.id}:\\d{4}-\\d{2}-\\d{2}$`));
    expect(alert!.actors).toEqual([]);
    expect(alert!.vehicle?.id).toBe(car.id);
    expect(alert!.details).toMatchObject(
      berlinNight(scannedAt) ? { count: 1, cities_count: 0, city: null } : { count: 1, cities_count: 1, city: scanCity.name },
    );
    // Run again with nothing new: still one row.
    await dexRunAlerts(car.id);
    const after = expectStatus(await owner.api.get('notifications'), 200, 'GET notifications').data as { type: string }[];
    expect(after.filter((row) => row.type === 'spot_alert')).toHaveLength(1);

    const ownerSide = await browserOf(browser, owner, { pageErrors, blockedRequests, expected });
    try {
      const ownerPage = ownerSide.page;
      await open(ownerPage, '/app/notifications');
      await expect(id(ownerPage, 'HOME-02.root')).toBeVisible();
      await expect(id(ownerPage, `HOME-02.row.${alert!.id}`)).toBeVisible();
      await expect(id(ownerPage, `HOME-02.row.${alert!.id}.text`)).not.toHaveText('');

      // 4. Night rule: a night spot's city never reaches the owner's numbers (DEX-06); day spots name theirs.
      await dexSpotFixture(spotter.email, car.id, nightCity.id, { count: 1, hoursAgo: 30, time: 'night' });
      await dexSpotFixture(spotter.email, car.id, mapCity.id, { count: 5, hoursAgo: 48 });
      const stats = expectStatus(await owner.api.get(`vehicles/${car.id}/spot-stats`), 200, 'GET spot-stats') as {
        data: { cities: { name: string; count: number }[]; total: number };
      };
      answers.push(stats);
      const cityNames = stats.data.cities.map((city) => city.name);
      expect(cityNames).toContain(mapCity.name);
      expect(cityNames).not.toContain(nightCity.name);
      expect(stats.data.total).toBe(7);
      await open(ownerPage, `/app/vehicles/${car.id}/spots`);
      await expect(id(ownerPage, 'DEX-06.root')).toBeVisible();
      await expect(id(ownerPage, 'DEX-06.cities')).toContainText(mapCity.name);
      await expect(id(ownerPage, 'DEX-06.cities')).not.toContainText(nightCity.name);
    } finally {
      await ownerSide.context.close();
    }

    // 5. The public spot map: only cities where at least 5 different cars were spotted more than 24 hours ago (SEC-P5G-03, dex.map.min_cars);
    // never a vehicle.
    await dexSpotFixture(spotter.email, car.id, scanCity.id, { count: 4, hoursAgo: 48 });
    await dexSpotFixture(spotter.email, car.id, nightCity.id, { count: 5, hoursAgo: 2 });
    const readMap = async (): Promise<Map<number, number>> => {
      await dexForgetSpotMap();
      const mapAnswer = await page.request.get('/api/v1/spot-map');
      expect(mapAnswer.status()).toBe(200);
      const map = (await mapAnswer.json()) as { data: { cities: { city_id: number; count: number }[] } };
      answers.push(map);
      expect(JSON.stringify(map)).not.toContain(car.id);
      return new Map(map.data.cities.map((city) => [city.city_id, city.count]));
    };
    // mapCity: 5 day spots of one car, 48 h old → one car → not listed. scanCity: the fresh API spot (< 24 h) + 4 old, one car → not
    // listed. nightCity: one 30 h old + five 2 h old, one car → not listed.
    let byId = await readMap();
    expect(byId.has(mapCity.id)).toBe(false);
    expect(byId.has(scanCity.id)).toBe(false);
    expect(byId.has(nightCity.id)).toBe(false);
    // Four more of the owner's cars, each spotted once in mapCity 48 h ago: 5 different cars → listed, with all 9 spots counted.
    const others: string[] = [];
    for (let index = 1; index <= 4; index++) {
      const other = await buildVehicle(owner.api, { photos: 1, nickname: `${nickname}M${index}` });
      others.push(other.id);
      await dexSpotFixture(spotter.email, other.id, mapCity.id, { count: 1, hoursAgo: 48 });
    }
    byId = await readMap();
    expect(byId.get(mapCity.id)).toBe(9);
    expect(byId.has(scanCity.id)).toBe(false);
    expect(byId.has(nightCity.id)).toBe(false);
    for (const other of others) expect(JSON.stringify(answers.at(-1))).not.toContain(other);

    // 6. Ghost mode: the car leaves search and the public garage list; the sticker and the spotter's Dex still reach it.
    const findable = async (): Promise<boolean> => {
      const found = expectStatus(await spotter.api.get(`search/vehicles?q=${encodeURIComponent(nickname)}`), 200, 'GET search/vehicles') as { data: { id: string }[] };
      return found.data.some((hit) => hit.id === car.id);
    };
    const listed = async (): Promise<boolean> => {
      const garage = expectStatus(await spotter.api.get(`public/users/${owner.username}/vehicles`), 200, 'GET public garage') as { data: { id: string }[] };
      return garage.data.some((vehicle) => vehicle.id === car.id);
    };
    await expect.poll(findable, { timeout: 20_000 }).toBe(true);
    expect(await listed()).toBe(true);
    const ghost = expectStatus(await owner.api.patch(`vehicles/${car.id}`, { ghost_mode: true }), 200, 'PATCH ghost_mode');
    expect(ghost.data.ghost_mode).toBe(true);
    expect(await findable()).toBe(false);
    expect(await listed()).toBe(false);
    const card = expectStatus(await spotter.api.get(`vehicles/${car.id}/dex-card`), 200, 'GET dex-card') as { data: SpotCard };
    answers.push(card);
    expect(card.data.vehicle.rarity).toBe('ghost');
    expect(card.data.spotted).toBe(true);

    // 7. No coordinate in any Dex answer of this flow, from the API or loaded by the app.
    await expect.poll(() => answers.length).toBeGreaterThan(6);
    expect(answers.flatMap((answer) => coordinateKeys(answer))).toEqual([]);
  });
});
