// F5, the Discover half (M2.3, docs/reports/phase-2/m2.3-contract.md §8 and m2.3-api-handover.md): a typed "M4" becomes the
// visible chips BMW · M4 (search/interpret), the filter sheet narrows it with facet counts and its live total to one build, which
// opens VEH-01, its owner PROF-02, and Folgen follows. Then the chip row (remove, reset), the sort sheet, list and grid, the URL
// round trip (reload keeps the filters, back restores them), DISC-03 → DISC-04 → the wheel table → VEH-01, VEH-02 "Ähnliche
// suchen", the [SIG] similar builds on VEH-01, the member search by city, DISC-01's Kollektionen and, from 1280, the filter panel.
// f-discover-lite.spec.ts keeps the Phase 1 part (text search, tabs, states).
//
// Data. The demo M4 G82 (jann.ptrs) runs 20″. The main flow publishes an M4 G82 of a member of its own on 19″ (Chromium) or 19,5″
// (WebKit: both projects run at the same time, each with its own build), so "G82 + that size" is that one build, and a second member of its own follows it: no follow, block or save of a demo member changes (the visual matrix
// photographs those). The global teardown deletes both members and the build. Other specs publish builds at the same time, so a
// list is compared with the very answer the page received, never with a fixed count; only the build of this spec is named.
//
// The filter sheet is an overlay the visual matrix cannot hold open: the main flow saves two pictures of it at 390 carbon de under
// docs/reports/visual/phase-2/flows/ for design QA (Chromium) and attaches them to the report.
import { mkdirSync, readFileSync } from 'node:fs';
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { DEMO_MEMBER, sessionOf, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { catalogueIds, createGarageMember, demoIds, expectStatus, R34, SEED_PHOTOS } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';
import { withStartLock } from '../support/start-lock.mjs';
import { readable } from '../support/text.mjs';

type Member = Awaited<ReturnType<typeof createGarageMember>>;
type FeedVehicle = { id: string; slug: string; full_title: string; owner: { username: string } | null };
type Overview = { vehicles: { count: number; items: FeedVehicle[] }; members: { count: number; items: { username: string; city: string | null }[] } };
type Facet = { value: string; label: string; count: number };
type Facets = { total: number; total_capped: boolean; generations: Facet[] | null; wheel_diameter: Facet[] };
type MakePage = { make: { slug: string; name: string; vehicle_count: number }; models: { slug: string; key: string; name: string; vehicle_count: number; generations: { slug: string; vehicle_count: number }[] }[] };
type WheelSetup = { vehicle: { id: string; slug: string; full_title: string }; wheel: { brand: string | null } };
type Collection = { key: string; title: string; filters: Record<string, unknown>; sort: string | null };

const FLOW_SHOTS = new URL('../../../../docs/reports/visual/phase-2/flows/', import.meta.url);

/**
 * The app's German copy, read from its locale files, so the spec follows the keys and not sentences of its own (copy review edits
 * the sentences). `de('discover', 'filters.show', { count: 1, formatted: '1' })`, with i18next's _one/_other plural keys for `count`.
 */
const LOCALES = new URL('../../../../mobile/src/i18n/locales/de/', import.meta.url);
const catalogues = new Map<string, Record<string, unknown>>();
function de(namespace: string, key: string, values: Record<string, string | number> = {}): string {
  let catalogue = catalogues.get(namespace);
  if (!catalogue) {
    catalogue = JSON.parse(readFileSync(new URL(`${namespace}.json`, LOCALES), 'utf8')) as Record<string, unknown>;
    catalogues.set(namespace, catalogue);
  }
  const lookup = (path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
  const count = values.count;
  const found = (count === undefined ? undefined : lookup(`${key}_${count === 1 ? 'one' : 'other'}`)) ?? lookup(key);
  if (typeof found !== 'string') throw new Error(`No German copy for ${namespace}:${key}`);
  return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const anyWithId = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const param = (page: Page, key: string): string | null => new URL(page.url()).searchParams.get(key);
const open = (page: Page, path: string): Promise<Response | null> => page.goto(qaUrl(path, { theme: 'carbon', locale: 'de' }));
const ULID = /^[0-9a-z]{26}$/;

/** The answer of the next GET of exactly this API path whose query passes `accept`. */
function answerOf(page: Page, path: string, accept: (query: URLSearchParams) => boolean = () => true): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1/${path}` && response.request().method() === 'GET' && accept(url.searchParams);
  });
}

async function dataOf<T>(response: Promise<Response>): Promise<T> {
  const answered = await response;
  expect(answered.status(), `${answered.url()} answered`).toBe(200);
  return ((await answered.json()) as { data: T }).data;
}

/** The ids of the visible `<prefix><ULID>` elements, top to bottom, then left to right. */
function shownIds(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(
    ({ prefix, pattern }) => {
      const ulid = new RegExp(pattern);
      return [...document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)]
        .map((el) => ({ el, rest: (el.getAttribute('data-testid') ?? '').slice(prefix.length) }))
        .filter(({ el, rest }) => ulid.test(rest) && el.checkVisibility())
        .map(({ el, rest }) => ({ rest, box: el.getBoundingClientRect() }))
        .sort((a, b) => Math.round(a.box.top) - Math.round(b.box.top) || a.box.left - b.box.left)
        .map(({ rest }) => rest);
    },
    { prefix, pattern: ULID.source },
  );
}

/**
 * What a list shows is the start of the answer, in its order. The previous answer stays on screen under the busy sign until the new
 * one is drawn (BH-39), so the list is read until it has turned into this answer.
 */
async function expectListOf(page: Page, prefix: string, answer: FeedVehicle[]): Promise<void> {
  expect(answer.length, 'the answer has builds').toBeGreaterThan(0);
  const expected = answer.map((vehicle) => vehicle.id);
  const startOfAnswer = async () => {
    const shown = await shownIds(page, prefix);
    return shown.length > 0 && shown.every((vehicleId, index) => vehicleId === expected[index]) ? shown : { shown, expected };
  };
  await expect.poll(async () => Array.isArray(await startOfAnswer()), { message: `${prefix}* shows the start of the answer` }).toBe(true);
}

/** The test IDs of the active chips of DISC-02's chip row, in their order. */
function chipIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="DISC-02.chips."]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((testId) => !/\.(filter|body|remove)$/.test(testId) && testId !== 'DISC-02.chips')
      .filter((testId, index, all) => all.indexOf(testId) === index)
      .filter((testId) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.checkVisibility()),
  );
}

/** Text as read, also the figure a chip draws in its own pill ("G82" + "2" → "G82 2"). */
async function textOf(locator: Locator): Promise<string> {
  return readable((await locator.innerText()).replace(/ /g, ' '));
}

/** A picture of an overlay for design QA, which the matrix cannot hold open (Chromium only, one file per overlay). */
async function overlayShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // No hover state on the picture.
  await page.mouse.move(0, 0);
  const body = await page.screenshot({ animations: 'disabled' });
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (testInfo.project.name !== 'chromium') return;
  mkdirSync(FLOW_SHOTS, { recursive: true });
  await page.screenshot({ path: new URL(`${name}__390x844__carbon__de.png`, FLOW_SHOTS).pathname, animations: 'disabled' });
}

/** The BMW M4 G82 of a test member on BBS, in the size of its project (see the head of the file). */
const M4 = { make: 'BMW', model: 'M4', generation: 'G82', year: 2022 };
const M4_SPECS = {
  engine_code: 'S58',
  engine_text: '3,0 l R6 Biturbo',
  displacement_cc: 2993,
  fuel: 'petrol',
  aspiration: 'biturbo',
  power_value: 510,
  power_unit: 'ps',
  power_source: 'factory',
  torque_nm: 650,
  torque_source: 'factory',
  drivetrain: 'rear',
  gearbox: 'automatic',
};
const m4Wheels = (diameter: number) => ({
  category: 'wheels_tires',
  status: 'installed',
  installed_on: '2024-04',
  fields: { wheel_brand: 'BBS', wheel_model: 'CI-R', diameter, width_front: 9.5, et_front: 22 },
});

/**
 * Built as a draft with its wheels and published last: the publish projects the build with its facet rows at once
 * (PublishVehicle → VehicleSearchProjector::rebuild), while a mod added later reaches the search only through the queue worker.
 */
async function buildM4(owner: Member, diameter: number): Promise<{ id: string; slug: string }> {
  const ids = await catalogueIds(owner.api, M4);
  const draft = expectStatus(await owner.api.post('vehicles', { ...ids, model_year: M4.year, wizard_step: 2 }), 201, 'POST vehicles').data;
  expectStatus(await owner.api.put(`vehicles/${draft.id}/specs`, M4_SPECS), 200, 'PUT specs');
  expectStatus(await owner.api.upload(`vehicles/${draft.id}/media`, SEED_PHOTOS[0] ?? 'generic-exterior-01.jpg'), 201, 'POST media');
  expectStatus(await owner.api.post(`vehicles/${draft.id}/mods`, m4Wheels(diameter)), 201, 'POST mods');
  const published = expectStatus(await withStartLock(() => owner.api.post(`vehicles/${draft.id}/publish`, {})), 200, 'POST publish').data;
  return { id: published.id, slug: published.slug };
}

test.describe('F5 discover: M4 → chips → filter sheet → build → owner → Folgen', () => {
  test('a typed M4 becomes BMW · M4, the sheet narrows it to one build with live counts, and its owner is followed', async ({ page, context }, testInfo) => {
    test.setTimeout(180_000);
    const owner = await createGarageMember('discm4');
    expectStatus(await owner.api.patch('me/profile', { display_name: 'Felix Brandt', city: 'Augsburg' }), 200, 'PATCH me/profile');
    // A size only this project's build has among the M4 G82 (see the head of the file).
    const size = testInfo.project.name === 'webkit' ? '19.5' : '19';
    const m4 = await buildM4(owner, Number(size));
    const viewer = await createGarageMember('discfan');
    await useSession(context, viewer.session);

    // DISC-01: "M4" and Enter. DISC-02 reads it for filters: BMW · M4 as visible chips, nothing left as text.
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.search')).toBeVisible();
    const interpreted = answerOf(page, 'search/interpret', (q) => q.get('q')?.toLowerCase() === 'm4');
    const chipped = answerOf(page, 'search', (q) => q.get('make') === 'bmw' && q.get('model') === 'm4' && !q.get('q'));
    // The facets of the applied filters: the sheet's draft starts as those filters and reads the same answer from the cache.
    const opened = answerOf(page, 'search/facets', (q) => q.get('model') === 'm4' && !q.get('generation'));
    await page.getByTestId('DISC-01.search').fill('M4');
    await page.getByTestId('DISC-01.search').press('Enter');
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    const understanding = await dataOf<{ chips: { field: string; value: string }[]; remaining_q: string }>(interpreted);
    expect(understanding.chips.map((chip) => `${chip.field}:${chip.value}`)).toEqual(['make:bmw', 'model:m4']);
    expect(understanding.remaining_q).toBe('');
    await expect.poll(() => chipIds(page)).toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.model.m4']);
    expect(await textOf(id(page, 'DISC-02.chips.make.bmw'))).toBe('BMW');
    expect(await textOf(id(page, 'DISC-02.chips.model.m4'))).toBe('M4');
    await expect.poll(() => param(page, 'model')).toBe('m4');
    expect(param(page, 'make')).toBe('bmw');
    expect(param(page, 'q'), 'the text was used up by the chips').toBeNull();
    expect(param(page, 'understand'), 'and the request to read it').toBeNull();
    const bothM4 = (await dataOf<Overview>(chipped)).vehicles;
    expect(bothM4.items.map((vehicle) => vehicle.id), 'the demo M4 and ours').toContain(m4.id);
    await expectListOf(page, 'DISC-02.vehicle.', bothM4.items);
    await expect(id(page, 'DISC-02.results.count')).toHaveText(new RegExp(`^${bothM4.count}\\sBuilds?\\s·\\s$`));
    expect(await textOf(id(page, 'DISC-02.chips.filter')), 'Filter with the active count').toBe(`${de('discover', 'chips.filter')} 2`);

    // The sheet: the draft starts as the URL's filters, every option carries its facet count, the button the live total.
    await id(page, 'DISC-02.chips.filter').click();
    await expect(id(page, 'DISC-02.filterSheet')).toBeVisible();
    const before = await dataOf<Facets>(opened);
    const g82 = before.generations?.find((facet) => facet.value === 'g82');
    expect(g82?.count, 'G82: the demo M4 and ours').toBeGreaterThanOrEqual(2);
    const generationChip = id(page, 'DISC-02.filterSheet.panel.generation.g82');
    expect(await textOf(generationChip)).toBe(`G82 ${g82!.count}`);
    await expect(id(page, 'DISC-02.filterSheet.apply')).toHaveText(de('discover', 'filters.show', { count: before.total, formatted: String(before.total) }));

    const withGeneration = answerOf(page, 'search/facets', (q) => q.get('generation') === 'g82' && q.getAll('wheel_diameter[]').length === 0);
    await generationChip.click();
    await expect(generationChip).toHaveAttribute('aria-checked', 'true');
    const afterGeneration = await dataOf<Facets>(withGeneration);
    const ours = afterGeneration.wheel_diameter.find((facet) => facet.value === size);
    const twenty = afterGeneration.wheel_diameter.find((facet) => facet.value === '20');
    expect(ours?.count, `${size}″: ours`).toBe(1);
    expect(twenty?.count, '20″: the demo M4').toBeGreaterThanOrEqual(1);
    await expect(id(page, 'DISC-02.filterSheet.apply')).toHaveText(
      de('discover', 'filters.show', { count: afterGeneration.total, formatted: String(afterGeneration.total) }),
    );
    await overlayShot(page, testInfo, 'DISC-02-filterSheet');

    const wheelChip = id(page, `DISC-02.filterSheet.panel.wheel_diameter.${size}`);
    expect(await textOf(wheelChip)).toBe(`${ours!.label} ${ours!.count}`);
    // Disjunctive: with our size chosen, 20″ keeps the count it has without a diameter.
    const withWheel = answerOf(page, 'search/facets', (q) => q.get('generation') === 'g82' && q.getAll('wheel_diameter[]').includes(size));
    await wheelChip.click();
    await expect(wheelChip).toHaveAttribute('aria-checked', 'true');
    const afterWheel = await dataOf<Facets>(withWheel);
    expect(afterWheel.total, `G82 on ${size}″ is our build alone`).toBe(1);
    expect(afterWheel.wheel_diameter.find((facet) => facet.value === '20')?.count).toBe(twenty!.count);
    await expect(id(page, 'DISC-02.filterSheet.apply')).toHaveText(de('discover', 'filters.show', { count: 1, formatted: '1' }));
    expect(await textOf(id(page, 'DISC-02.filterSheet.panel.wheel_diameter.20'))).toBe(`20″ ${twenty!.count}`);
    await overlayShot(page, testInfo, 'DISC-02-filterSheet-wheels');

    // Apply: the sheet closes, the chips and the URL carry all four filters, the list is the one build.
    const narrowed = answerOf(page, 'search', (q) => q.get('generation') === 'g82' && q.getAll('wheel_diameter[]').includes(size));
    await id(page, 'DISC-02.filterSheet.apply').click();
    await expect(id(page, 'DISC-02.filterSheet')).toHaveCount(0);
    await expect
      .poll(() => chipIds(page))
      .toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.model.m4', 'DISC-02.chips.generation.g82', `DISC-02.chips.wheel_diameter.${size}`]);
    expect(param(page, 'generation')).toBe('g82');
    expect(param(page, 'wheel_diameter')).toBe(size);
    const one = (await dataOf<Overview>(narrowed)).vehicles;
    expect(one.items.map((vehicle) => vehicle.id)).toEqual([m4.id]);
    await expect(id(page, 'DISC-02.results.count')).toHaveText(new RegExp(`^${de('discover', 'results.count', { count: 1, formatted: '1' })}\\s·\\s$`));
    expect(await shownIds(page, 'DISC-02.vehicle.')).toEqual([m4.id]);

    // The build, its owner, Folgen.
    await id(page, `DISC-02.vehicle.${m4.id}.body`).click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/v/${m4.slug}`);
    await expect(id(page, 'VEH-01.ownerRow')).toContainText(`@${owner.username}`);
    // A tap on the owner's avatar and name, as a member makes it (a ceiling, so a covered row fails fast instead of at the test timeout).
    await id(page, 'VEH-01.ownerRow.identity').click({ timeout: 15_000 });
    await expect(id(page, 'PROF-02.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/u/${owner.username}`);
    const follow = id(page, 'PROF-02.follow');
    await expect(follow).toHaveText(de('profile', 'follow.follow'));
    const followed = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/users/${owner.username}/follow`);
    await follow.click();
    await expect(follow).toHaveText(de('profile', 'follow.following'));
    expect((await followed).status()).toBe(200);
    const relation = expectStatus(await viewer.api.get(`public/users/${owner.username}`), 200, 'GET profile').data as { is_following: boolean };
    expect(relation.is_following, 'the follow is on the server').toBe(true);

    // Back, back: DISC-02 again with every filter, the chips and the one build.
    await id(page, 'PROF-02.header.back').click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    await id(page, 'VEH-01.header.back').click();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    expect(param(page, 'generation')).toBe('g82');
    expect(param(page, 'wheel_diameter')).toBe(size);
    await expect.poll(() => chipIds(page)).toHaveLength(4);
    await expect(id(page, `DISC-02.vehicle.${m4.id}`)).toBeVisible();
  });
});

test.describe('F5 discover: the chip row, sort, view and the URL', () => {
  test('a link in the API form shows its chips; remove one, sort, grid, reload and back keep it all', async ({ page }) => {
    test.setTimeout(120_000);
    const first = answerOf(page, 'search', (q) => q.get('make') === 'bmw' && q.getAll('wheel_diameter[]').length === 2);
    await open(page, '/app/discover/search?make=bmw&wheel_diameter[]=19&wheel_diameter[]=20');
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    const both = (await dataOf<Overview>(first)).vehicles.items;
    await expect.poll(() => chipIds(page)).toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.wheel_diameter.19', 'DISC-02.chips.wheel_diameter.20']);
    expect(await textOf(id(page, 'DISC-02.chips.wheel_diameter.20'))).toBe('20″');
    await expectListOf(page, 'DISC-02.vehicle.', both);
    expect(both.map((vehicle) => vehicle.slug), 'the demo M4 G82 and M3 E92').toEqual(expect.arrayContaining(['bmw-m4-g82-f3pqxpjb', 'bmw-m3-e90-e92-e93-3aymcw76']));

    // Remove 20″: its chip goes, the URL follows, the list is the new answer.
    await expect(id(page, 'DISC-02.chips.wheel_diameter.20.remove')).toHaveAccessibleName(de('discover', 'chips.remove', { label: '20″' }));
    const removed = answerOf(page, 'search', (q) => q.get('make') === 'bmw' && q.getAll('wheel_diameter[]').join() === '19');
    await id(page, 'DISC-02.chips.wheel_diameter.20.remove').click();
    await expect.poll(() => chipIds(page)).toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.wheel_diameter.19']);
    await expect.poll(() => param(page, 'wheel_diameter')).toBe('19');
    const nineteen = (await dataOf<Overview>(removed)).vehicles.items;
    expect(nineteen.map((vehicle) => vehicle.slug)).toContain('bmw-m3-e90-e92-e93-3aymcw76');
    expect(nineteen.map((vehicle) => vehicle.slug), 'the 20″ M4 is gone').not.toContain('bmw-m4-g82-f3pqxpjb');
    await expectListOf(page, 'DISC-02.vehicle.', nineteen);

    // Sort: the sheet offers no Relevanz without a text; Meiste PS applies and closes.
    await expect(id(page, 'DISC-02.results.sort')).toHaveAccessibleName(de('discover', 'results.sortLabel', { sort: de('discover', 'sort.newest') }));
    await id(page, 'DISC-02.results.sort').click();
    await expect(id(page, 'DISC-02.sortSheet')).toBeVisible();
    await expect(anyWithId(page, 'DISC-02.sortSheet.relevance')).toHaveCount(0);
    await expect(id(page, 'DISC-02.sortSheet.newest')).toHaveAttribute('aria-checked', 'true');
    const byPower = answerOf(page, 'search', (q) => q.get('sort') === 'power' && q.get('make') === 'bmw');
    await id(page, 'DISC-02.sortSheet.power').click();
    await expect(id(page, 'DISC-02.sortSheet')).toHaveCount(0);
    await expect.poll(() => param(page, 'sort')).toBe('power');
    await expect(id(page, 'DISC-02.results.sort')).toHaveText(de('discover', 'sort.power'));
    const powered = (await dataOf<Overview>(byPower)).vehicles.items;
    await expectListOf(page, 'DISC-02.vehicle.', powered);

    // Grid and back to the list: tiles in two columns on a phone, the URL keeps the choice.
    await id(page, 'DISC-02.results.view.grid').click();
    await expect.poll(() => param(page, 'view')).toBe('grid');
    await expect(id(page, `DISC-02.tile.${powered[0]!.id}`)).toBeVisible();
    await expect(page.locator('[data-testid^="DISC-02.vehicle."]:visible')).toHaveCount(0);
    expect(await shownIds(page, 'DISC-02.tile.')).toEqual(powered.slice(0, (await shownIds(page, 'DISC-02.tile.')).length).map((v) => v.id));
    if (powered.length >= 2) {
      const [a, b] = await Promise.all([0, 1].map((n) => id(page, `DISC-02.tile.${powered[n]!.id}`).boundingBox()));
      expect(Math.round(a!.y), 'two tiles side by side').toBe(Math.round(b!.y));
    }

    // Reload: the URL is the state.
    const reloaded = answerOf(page, 'search', (q) => q.get('sort') === 'power');
    await page.reload();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    await dataOf<Overview>(reloaded);
    await expect.poll(() => chipIds(page)).toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.wheel_diameter.19']);
    await expect(id(page, 'DISC-02.results.sort')).toHaveText(de('discover', 'sort.power'));
    await expect(id(page, `DISC-02.tile.${powered[0]!.id}`)).toBeVisible();
    await expect(id(page, 'DISC-02.results.view.grid')).toHaveAttribute('aria-pressed', 'true');

    // A tile opens its build; the browser's back restores the list as it was.
    await id(page, `DISC-02.tile.${powered[0]!.id}`).click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/v/${powered[0]!.slug}`);
    await page.goBack();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    expect(param(page, 'sort')).toBe('power');
    expect(param(page, 'view')).toBe('grid');
    expect(param(page, 'wheel_diameter')).toBe('19');
    await expect.poll(() => chipIds(page)).toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.wheel_diameter.19']);
    await id(page, 'DISC-02.results.view.list').click();
    await expect.poll(() => param(page, 'view')).toBe('list');
    await expect(id(page, `DISC-02.vehicle.${powered[0]!.id}`)).toBeVisible();
  });

  test('no build for the filters: the state names it, "Filter zurücksetzen" clears every filter; the sheet resets its draft', async ({ page }) => {
    // 22″: no BMW M4 of the seed or of a spec runs it (one demo build of another make does).
    await open(page, '/app/discover/search?make=bmw&model=m4&wheel_diameter=22');
    await expect(id(page, 'DISC-02.noResultsFiltered')).toBeVisible();
    await expect(id(page, 'DISC-02.noResultsFiltered.title')).toHaveText(de('discover', 'noResultsFiltered.title'));
    await expect.poll(() => chipIds(page)).toEqual(['DISC-02.chips.make.bmw', 'DISC-02.chips.model.m4', 'DISC-02.chips.wheel_diameter.22']);

    // The sheet's Zurücksetzen empties the draft only; nothing changes until it is applied.
    await id(page, 'DISC-02.chips.filter').click();
    await expect(id(page, 'DISC-02.filterSheet')).toBeVisible();
    await expect(id(page, 'DISC-02.filterSheet.panel.wheel_diameter.22')).toHaveAttribute('aria-checked', 'true');
    await id(page, 'DISC-02.filterSheet.reset').click();
    await expect(id(page, 'DISC-02.filterSheet.panel.wheel_diameter.22')).toHaveAttribute('aria-checked', 'false');
    await expect(id(page, 'DISC-02.filterSheet.panel.make')).toContainText(de('discover', 'filters.any'));
    await expect(id(page, 'DISC-02.filterSheet.panel.model')).toContainText(de('discover', 'filters.modelNeedsMake'));
    expect(param(page, 'make'), 'the list keeps its filters until applied').toBe('bmw');
    await page.keyboard.press('Escape');
    await expect(id(page, 'DISC-02.filterSheet')).toHaveCount(0);
    await expect.poll(() => chipIds(page)).toHaveLength(3);

    await id(page, 'DISC-02.noResultsFiltered.action').click();
    await expect.poll(() => chipIds(page)).toEqual([]);
    for (const key of ['make', 'model', 'wheel_diameter']) expect(param(page, key), `${key} left the URL`).toBeNull();
    await expect(id(page, 'DISC-02.suggestions')).toBeVisible();
  });
});

test.describe('F5 discover: make and model pages', () => {
  test('DISC-01 Toyota → DISC-03 → Supra A80 → DISC-04 Räder-Vergleich → a row opens VEH-01', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '/app/discover');
    const makeAnswer = answerOf(page, 'discover/makes/toyota');
    await id(page, 'DISC-01.makes.toyota').click();
    await expect(id(page, 'DISC-03.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/discover/make/toyota');
    const make = await dataOf<MakePage>(makeAnswer);
    expect(readable(await id(page, 'DISC-03.title').textContent())).toBe('Toyota');
    await expect(id(page, 'DISC-03.count')).toHaveText(de('discover', 'make.count', { count: make.make.vehicle_count, formatted: String(make.make.vehicle_count) }));
    const supra = make.models.find((model) => model.slug === 'supra');
    expect(supra, 'the demo has two Supra A80').toBeTruthy();
    // Models by count as the answer orders them, each with its generation chips and their counts.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid^="DISC-03.model."]')]
        .map((el) => el.getAttribute('data-testid') ?? '')
        .filter((testId) => /^DISC-03\.model\.[a-z0-9-]+$/.test(testId)),
    );
    expect(rows).toEqual(make.models.slice(0, rows.length).map((model) => `DISC-03.model.${model.slug}`));
    const a80 = supra!.generations.find((generation) => generation.slug === 'a80')!;
    expect(await textOf(id(page, 'DISC-03.model.supra.generation.a80'))).toMatch(new RegExp(`^A80 .* ${a80.vehicle_count}$`));

    // A generation chip opens DISC-04 at that generation.
    await id(page, 'DISC-03.model.supra.generation.a80').click();
    await expect(id(page, 'DISC-04.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/discover/model/toyota--supra');
    expect(param(page, 'generation')).toBe('a80');
    await expect(id(page, 'DISC-04.generation.a80')).toHaveAttribute('aria-checked', 'true');
    await expect(id(page, 'DISC-04.segment.builds')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid^="DISC-04.vehicle."]:visible').first()).toBeVisible();

    // Räder-Vergleich: one row per build with wheels, in the answer's order; the cells carry the answer's brand.
    const setupsAnswer = answerOf(page, 'discover/models/toyota--supra/wheel-setups', (q) => q.get('generation') === 'a80');
    await id(page, 'DISC-04.segment.wheels').click();
    await expect.poll(() => param(page, 'segment')).toBe('wheels');
    const setups = await dataOf<WheelSetup[]>(setupsAnswer);
    expect(setups.length, 'both A80 run wheels').toBeGreaterThanOrEqual(2);
    // DQ-436: the table only where its 7 content-sized columns fit (960); everywhere else one card per build, in the answer's
    // order: single cards below 768, cards in pairs at 768 and 1024, the table at 1280 and 1440 at 1×, cards again at 1280 at 2×.
    const ownIds = (ids: string[]) => ids.filter((t) => /^DISC-04\.wheels\.[0-9a-z]{26}$/.test(t)).map((t) => t.slice('DISC-04.wheels.'.length));
    const visibleIds = async (selector: string) =>
      ownIds(await page.locator(selector).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? '')));
    const order = setups.map((setup) => setup.vehicle.id);
    const [firstId, secondId] = order as [string, string];
    const expectCards = async (perRow: 1 | 2) => {
      await expect(page.locator(`[data-testid="DISC-04.wheels.${firstId}"]:visible`)).toBeVisible();
      expect(await visibleIds('[data-testid^="DISC-04.wheels."]:visible')).toEqual(order);
      await expect(page.locator('[data-testid^="DISC-04.wheels."][role="row"]:visible')).toHaveCount(0);
      // After a resize the cards are laid out again: both are on screen before their boxes are read.
      await expect(id(page, `DISC-04.wheels.${secondId}`)).toBeVisible();
      const [a, b] = [await id(page, `DISC-04.wheels.${firstId}`).boundingBox(), await id(page, `DISC-04.wheels.${secondId}`).boundingBox()];
      if (!a || !b) throw new Error('the first two wheel cards have no box');
      if (perRow === 2) {
        expect(Math.abs(a.y - b.y), 'the first two cards stand side by side').toBeLessThan(1);
        expect(b.x).toBeGreaterThan(a.x + a.width - 1);
      } else {
        expect(b.y, 'one card per row').toBeGreaterThanOrEqual(a.y + a.height - 1);
      }
      for (const setup of setups) await expect(id(page, `DISC-04.wheels.${setup.vehicle.id}.size`)).toContainText('″');
    };
    await expectCards(1);
    for (const setup of setups) {
      if (setup.wheel.brand) expect(readable(await id(page, `DISC-04.wheels.${setup.vehicle.id}.wheel`).textContent())).toContain(setup.wheel.brand);
    }
    for (const width of [768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expectCards(2);
    }
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(id(page, 'DISC-04.wheels')).toHaveAttribute('role', 'table');
      expect(await visibleIds('[data-testid^="DISC-04.wheels."][role="row"]:visible')).toEqual(order);
      for (const setup of setups) await expect(id(page, `DISC-04.wheels.${setup.vehicle.id}.size`)).toContainText('″');
    }
    // 2× font at 1280: the columns no longer fit, so cards in pairs.
    const here = new URL(page.url());
    for (const key of [...here.searchParams.keys()]) if (key.startsWith('qa')) here.searchParams.delete(key);
    const wheelsUrl = `${here.pathname}${here.search}`;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(qaUrl(wheelsUrl, { theme: 'carbon', locale: 'de', fontScale: 2 }));
    await expectCards(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, wheelsUrl);
    await expect(id(page, `DISC-04.wheels.${firstId}`)).toBeVisible();

    // A row opens VEH-01 of its build; back returns to the table.
    const target = setups[0]!.vehicle;
    // On the web the link's name is its visible text: the build, then its owner (WCAG 2.5.3, M2.8 round 1).
    expect(readable(await id(page, `DISC-04.wheels.${target.id}.open`).textContent())).toContain(readable(target.full_title));
    await id(page, `DISC-04.wheels.${target.id}.open`).click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/v/${target.slug}`);
    await id(page, 'VEH-01.header.back').click();
    await expect(id(page, `DISC-04.wheels.${target.id}`)).toBeVisible();
    expect(param(page, 'segment')).toBe('wheels');
    expect(param(page, 'generation')).toBe('a80');

    // "Alle" drops the generation and keeps the segment.
    await id(page, 'DISC-04.generation.all').click();
    await expect.poll(() => param(page, 'generation')).toBeNull();
    await expect(id(page, 'DISC-04.generation.all')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid^="DISC-04.wheels."][data-testid$=".size"]:visible').first()).toBeVisible();
  });
});

test.describe('F5 discover: from a build page', () => {
  test('VEH-02 "Ähnliche suchen" opens DISC-02 with the mod\'s own filters', async ({ page }) => {
    const { r34Mod } = await demoIds();
    const modAnswer = answerOf(page, `public/vehicles/${R34.slug}/mods/${r34Mod}`);
    await open(page, `/app/v/${R34.slug}/mods/${r34Mod}`);
    await expect(id(page, 'VEH-02.title')).toBeVisible();
    const mod = await dataOf<{ title: string; search: { wheel_brand: string | null; wheel_diameter: number | null } }>(modAnswer);
    expect(mod.search.wheel_brand, 'the R34 wheels have a catalogue brand').toBeTruthy();
    expect(mod.search.wheel_diameter).not.toBeNull();
    const button = id(page, 'VEH-02.searchSimilar');
    await expect(button).toHaveText(de('discover', 'searchSimilar.action'));
    await expect(button).toHaveAccessibleName(de('discover', 'searchSimilar.label', { mod: mod.title }));

    const results = answerOf(page, 'search', (q) => q.getAll('wheel_brand[]').includes(mod.search.wheel_brand!));
    await button.click();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/discover/search');
    expect(param(page, 'wheel_brand')).toBe(mod.search.wheel_brand);
    expect(param(page, 'wheel_diameter')).toBe(String(mod.search.wheel_diameter));
    await expect
      .poll(() => chipIds(page))
      .toEqual([`DISC-02.chips.wheel_diameter.${mod.search.wheel_diameter}`, `DISC-02.chips.wheel_brand.${mod.search.wheel_brand}`]);
    const found = (await dataOf<Overview>(results)).vehicles.items;
    expect(found.map((vehicle) => vehicle.slug), 'the build of the mod itself is found').toContain(R34.slug);
    await expectListOf(page, 'DISC-02.vehicle.', found);
  });

  test('VEH-01 [SIG] Ähnliche Builds: the answer\'s builds, an R34 first; a tile opens it', async ({ page }) => {
    const { r34 } = await demoIds();
    const similarAnswer = answerOf(page, `vehicles/${r34}/similar`);
    await open(page, `/app/v/${R34.slug}`);
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    const similar = await dataOf<FeedVehicle[]>(similarAnswer);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar.length).toBeLessThanOrEqual(8);
    // Same generation first (handover §8): an R34, and the R34 of kenji.r34 is among them. Specs publish R34s of their own meanwhile,
    // so which R34 leads is not fixed here.
    expect(similar[0]!.full_title, 'the first similar build shares the generation').toContain('R34');
    expect(similar.map((vehicle) => vehicle.slug)).toContain('nissan-skyline-gt-r-r34-xmeypf41');
    expect(similar.map((vehicle) => vehicle.owner?.username), 'never the owner\'s own builds').not.toContain('lukas.sc');
    const strip = id(page, 'VEH-01.similar');
    await strip.scrollIntoViewIfNeeded();
    await expect(strip).toHaveAttribute('role', 'region');
    await expect(id(page, 'VEH-01.similar.header')).toContainText(de('discover', 'similar.title'));
    expect(await shownIds(page, 'VEH-01.similar.')).toEqual(similar.slice(0, (await shownIds(page, 'VEH-01.similar.')).length).map((v) => v.id));
    await id(page, `VEH-01.similar.${similar[0]!.id}`).click();
    await expect.poll(() => pathOf(page)).toBe(`/app/v/${similar[0]!.slug}`);
    await expect(id(page, 'VEH-01.title')).toBeVisible();
  });
});

test.describe('F5 discover: members and DISC-01', () => {
  test('"stutt" finds lukas.sc by the start of his city', async ({ page }) => {
    await open(page, '/app/discover');
    const results = answerOf(page, 'search', (q) => q.get('q') === 'stutt');
    await page.getByTestId('DISC-01.search').fill('stutt');
    await page.getByTestId('DISC-01.search').press('Enter');
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    const overview = await dataOf<Overview>(results);
    expect(overview.members.items.map((member) => member.username)).toContain('lukas.sc');
    // Nothing to read for filters in "stutt": the text stays, and with no vehicle hit the Mitglieder tab is in front.
    await expect.poll(() => param(page, 'q')).toBe('stutt');
    await expect(id(page, 'DISC-02.tab.members')).toHaveAttribute('aria-selected', overview.vehicles.count === 0 ? 'true' : 'false');
    if (overview.vehicles.count > 0) await id(page, 'DISC-02.tab.members').click();
    await expect(id(page, 'DISC-02.member.lukas.sc')).toBeVisible();
    await expect(id(page, 'DISC-02.member.lukas.sc.meta')).toContainText('Stuttgart');
  });

  test('Kollektionen and Beliebte Mods as the answer has them; a collection opens DISC-02 with its filters and sort', async ({ page }) => {
    const answer = answerOf(page, 'discover');
    await open(page, '/app/discover');
    const discover = await dataOf<{ collections: Collection[]; popular_mods: { label: string }[]; similar_members: unknown }>(answer);
    expect(discover.collections.length, 'the seeded collections').toBeGreaterThan(0);
    expect(discover.similar_members, 'a guest gets no similar members').toBeNull();
    await expect(anyWithId(page, 'DISC-01.similarMembers')).toHaveCount(0);
    await expect(id(page, 'DISC-01.collections.header')).toHaveText(de('discover', 'collections.title'));
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid^="DISC-01.collections."]')]
        .map((el) => (el.getAttribute('data-testid') ?? '').slice('DISC-01.collections.'.length))
        .filter((key) => /^[a-z0-9-]+$/.test(key) && !['header', 'list'].includes(key)),
    );
    expect(cards).toEqual(discover.collections.slice(0, cards.length).map((collection) => collection.key));
    const chips = (await page.locator('[data-testid^="DISC-01.popularMods.chip."]:visible').allTextContents()).map(readable);
    expect(chips).toEqual(discover.popular_mods.slice(0, chips.length).map((mod) => readable(mod.label)));

    const bmw = discover.collections.find((collection) => collection.key === 'bmw-m') ?? discover.collections[0]!;
    const card = id(page, `DISC-01.collections.${bmw.key}`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText(readable(bmw.title));
    await card.click();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    for (const [key, value] of Object.entries(bmw.filters)) {
      const expected = Array.isArray(value) ? value.map(String).join(',') : String(value);
      expect(param(page, key.replace(/\[\]$/, '')), `${key} of the collection`).toBe(expected);
    }
    expect(param(page, 'sort')).toBe(bmw.sort);
  });

  test('signed in as lukas.sc, "Mitglieder mit ähnlichen Autos" lists the answer\'s members [SIG]', async ({ page, context }) => {
    await useSession(context, await sessionOf(DEMO_MEMBER));
    const answer = answerOf(page, 'discover');
    await open(page, '/app/discover');
    const discover = await dataOf<{ similar_members: { username: string }[] | null }>(answer);
    expect(discover.similar_members?.length ?? 0, 'lukas.sc has public builds that others share').toBeGreaterThan(0);
    const members = discover.similar_members!;
    const section = id(page, 'DISC-01.similarMembers');
    await section.scrollIntoViewIfNeeded();
    await expect(id(page, 'DISC-01.similarMembers.header')).toHaveText(de('discover', 'similarMembers.title'));
    for (const member of members) await expect(anyWithId(page, `DISC-01.similarMembers.${member.username}`)).toHaveCount(1);
    expect(members.map((member) => member.username)).not.toContain('lukas.sc');
  });
});

test.describe('F5 discover: the filter panel from 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('the filters stay open beside a 3-column grid, and a choice there applies at once', async ({ page }) => {
    const first = answerOf(page, 'search', (q) => q.get('make') === 'bmw' && !q.get('model'));
    await open(page, '/app/discover/search?make=bmw');
    await expect(id(page, 'DISC-02.panel')).toBeVisible();
    await expect(anyWithId(page, 'DISC-02.chips.filter'), 'no Filter chip beside the panel').toHaveCount(0);
    const bmw = (await dataOf<Overview>(first)).vehicles.items;
    expect(bmw.length).toBeGreaterThanOrEqual(3);
    await expect(id(page, `DISC-02.tile.${bmw[0]!.id}`)).toBeVisible();
    const tops = await Promise.all(bmw.slice(0, 3).map(async (vehicle) => Math.round((await id(page, `DISC-02.tile.${vehicle.id}`).boundingBox())!.y)));
    expect(new Set(tops).size, 'three tiles on one line').toBe(1);
    const panelBox = await id(page, 'DISC-02.panel').boundingBox();
    const tileBox = await id(page, `DISC-02.tile.${bmw[0]!.id}`).boundingBox();
    expect(panelBox!.x + panelBox!.width, 'the panel is left of the grid').toBeLessThanOrEqual(tileBox!.x);

    // A model from the panel's picker applies at once, with no sheet button to press.
    await id(page, 'DISC-02.panel.filters.model').click();
    await expect(id(page, 'DISC-02.pickerSheet')).toBeVisible();
    const narrowed = answerOf(page, 'search', (q) => q.get('model') === 'm3');
    await id(page, 'DISC-02.picker.model.m3').click();
    await expect.poll(() => param(page, 'model')).toBe('m3');
    const m3 = (await dataOf<Overview>(narrowed)).vehicles.items;
    await expectListOf(page, 'DISC-02.tile.', m3);
    await expect(id(page, 'DISC-02.panel.reset')).toBeVisible();
    await id(page, 'DISC-02.panel.reset').click();
    await expect.poll(() => param(page, 'make')).toBeNull();
  });
});
