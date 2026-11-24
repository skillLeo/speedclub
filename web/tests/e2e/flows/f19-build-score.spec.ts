// F19 Build Score (10 §16.3, docs/reports/phase-5/m5.9c-contract.md §3–§6, owner gift detail M5.9c): a member adds a documented mod
// (brand, photo, date) through the member web, the debounced recompute runs (through the test backend, as no queue worker runs
// locally), and VEH-01 shows the new total with its "+25"; the nightly rank job (test backend) moves the car from #3 to #1 of its
// generation; the share card (VEH-07) is drawn anew with the new score. Never a power, speed or money figure in the score answers.
// The car sits in a catalogue generation no other rankable car uses, next to two test members' cars whose scores lie between the
// owner's before and after. Runs at 390 × carbon × de like the other flows; every account ends in E2E_DOMAIN and goes with the teardown.
import type { Page, Response } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { buildScoreFreeGeneration, buildScoreNightly, buildScorePeers, buildScoreRun } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { de, id, members, named, open } from '../support/flow';
import { buildVehicle, expectStatus, photoFile, type MemberApi } from '../support/garage.mjs';
import { BASE_URL } from '../support/qa.mjs';

type Rank = { scope: 'generation' | 'bundesland'; label: string; rank: number; group_size: number; region: string | null };
type Score = {
  total: number;
  stage: number;
  parts: Record<string, { points: number; max: number }>;
  ranks: Rank[];
  previous_total: number | null;
  next_upgrades?: { key: string; points: number }[];
};

/** Keys that would carry a power, speed or money figure: none of them belongs in a score answer. */
const FORBIDDEN = /^(power|ps|kw|hp|torque|nm|speed|top_speed|vmax|zero_to_100|lap_time|price|cost|cents|money)$/i;

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [key, ...keysOf(item)]);
}

async function scoreOf(api: MemberApi, vehicleId: string): Promise<Score> {
  const score = expectStatus(await api.get(`vehicles/${vehicleId}/build-score`), 200, 'GET build-score').data as Score;
  expect(keysOf(score).filter((key) => FORBIDDEN.test(key))).toEqual([]);
  return score;
}

async function shareCard(page: Page, vehicleId: string): Promise<Buffer> {
  const response = await page.request.get(`${BASE_URL}/api/v1/vehicles/${vehicleId}/share-card.png?format=story`);
  expect(response.status(), 'GET share-card.png').toBe(200);
  expect(response.headers()['content-type']).toBe('image/png');
  return response.body();
}

const generationRank = (score: Score): Rank | undefined => score.ranks.find((rank) => rank.scope === 'generation');

test.describe('F19 Build Score', () => {
  test('documented mod → score rises with "+25" → nightly ranks → rank line moves → new share card', async ({ page }) => {
    test.setTimeout(300_000);
    const [owner] = await members('f19owner');
    await named(owner, 'Jana F19', 'Bochum');
    const car = await buildVehicle(owner.api, { car: await buildScoreFreeGeneration(), photos: 1, nickname: `F19${owner.username.slice(-5)}` });
    // The edits of the build queued the debounced recompute; run it, then read the score the page shows.
    await buildScoreRun(car.id);
    const before = await scoreOf(owner.api, car.id);
    expect(before.total).toBeGreaterThan(0);
    expect(before.next_upgrades?.map((item) => item.key)).toContain('documented_mods');

    // Two test members' cars of the same generation, scored between the owner's before and after (+25 for one documented mod).
    const { peers } = await buildScorePeers(car.id, [before.total + 10, before.total + 15]);
    for (const peer of peers) {
      expect(peer.total).toBeGreaterThan(before.total);
      expect(peer.total).toBeLessThan(before.total + 25);
    }
    expect((await buildScoreNightly()).done).toBe(true);
    const ranked = await scoreOf(owner.api, car.id);
    expect(generationRank(ranked)).toMatchObject({ rank: 3, group_size: 3, region: expect.any(String) });
    const cardBefore = await shareCard(page, car.id);

    await useSession(page.context(), owner.session);
    await open(page, `/app/v/${car.slug}`);
    await expect(id(page, 'VEH-01.score.gauge.value')).toHaveText(String(before.total));
    await expect(id(page, 'VEH-01.score.rank.generation')).toHaveText(
      de('vehicle', 'score.rankGeneration', { rank: '3', size: '3', label: ranked.ranks[0]?.label ?? '', region: 'Deutschland' }),
    );

    // GAR-10: a wheel set with brand (BBS from the catalogue), a photo and the month it went on.
    await open(page, `/app/garage/${car.id}/mods`);
    await expect(id(page, 'GAR-09.root')).toBeVisible();
    await id(page, 'GAR-09.empty.action').click();
    await id(page, 'GAR-09.categories.wheels_tires').click();
    await expect(id(page, 'GAR-10.root')).toBeVisible();
    await page.getByTestId('GAR-10.field.wheel_brand').fill('BB');
    await id(page, 'GAR-10.field.wheel_brand.suggestions').getByText('BBS', { exact: true }).click();
    await page.getByTestId('GAR-10.field.wheel_model').fill('LM');
    await page.getByTestId('GAR-10.field.diameter').fill('19');
    await page.getByTestId('GAR-10.installedOn').fill('032023');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), id(page, 'GAR-10.photos.add').click()]);
    await chooser.setFiles(photoFile('generic-exterior-01.jpg'));
    // M5.9a: the plate blur review comes up for the pick; its default (one suggested rectangle) is fine for a wheel photo.
    await id(page, 'GAR-10.plateBlur.confirm').click();
    const uploaded = page.waitForResponse(
      (response: Response) => /\/api\/v1\/mods\/[^/]+\/media$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await id(page, 'GAR-10.cta.primary').click();
    expect((await uploaded).status(), 'POST mods/{id}/media').toBe(201);
    await expect(id(page, 'GAR-09.list')).toBeVisible();
    const [mod] = expectStatus(await owner.api.get(`vehicles/${car.id}/mods`), 200, 'GET mods').data as { id: string; brand: string | null; installed_on: string | null; is_registered: boolean }[];
    expect(mod).toMatchObject({ brand: 'BBS', installed_on: '2023-03', is_registered: false });

    // The debounced recompute (30 s on a host with a worker): run now. The mod adds 25, nothing else changed.
    const run = await buildScoreRun(car.id);
    expect(run.ran).toBeGreaterThanOrEqual(1);
    const after = await scoreOf(owner.api, car.id);
    expect(after.total).toBe(before.total + 25);
    expect(after.previous_total).toBe(before.total);
    expect(after.parts.documentation?.points).toBe((before.parts.documentation?.points ?? 0) + 25);

    await open(page, `/app/v/${car.slug}`);
    await expect(id(page, 'VEH-01.score.gauge.value')).toHaveText(String(after.total));
    await expect(id(page, 'VEH-01.score.gauge.delta')).toHaveText(de('vehicle', 'score.delta', { points: '25' }));
    // Ranks are the night's: until it runs the line stays.
    await expect(id(page, 'VEH-01.score.rank.generation')).toContainText('#3');

    expect((await buildScoreNightly()).done).toBe(true);
    const moved = await scoreOf(owner.api, car.id);
    expect(generationRank(moved)).toMatchObject({ rank: 1, group_size: 3 });
    await page.reload();
    await expect(id(page, 'VEH-01.score.rank.generation')).toHaveText(
      de('vehicle', 'score.rankGeneration', { rank: '1', size: '3', label: moved.ranks[0]?.label ?? '', region: 'Deutschland' }),
    );

    // VEH-07: the card shows the new score, so it is a new drawing (and a new stored name for the public build).
    const cardAfter = await shareCard(page, car.id);
    expect(cardAfter.equals(cardBefore)).toBe(false);
    const vehicle = expectStatus(await owner.api.get(`vehicles/${car.id}`), 200, 'GET vehicle').data as { build_score: { total: number; stage: number } | null };
    expect(vehicle.build_score).toEqual({ total: after.total, stage: after.stage });
  });
});
