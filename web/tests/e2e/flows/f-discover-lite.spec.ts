// M1.8 browse tabs on the member web at /app, against the real API and the DemoSeeder (docs/07_QA_AND_RELEASE.md, test data):
// HOME-01 (FS-2 P1-lite: the featured build, Neue Builds, the 1280 rail), DISC-01 (search, recent searches, make tiles with
// real counts), DISC-02 (search with q in the URL, Fahrzeuge and Mitglieder) and MSG-01 (the honest "not available yet" state).
// The part of flow F5 that Phase 1 has (DISC-01 → DISC-02 → VEH-01) runs here; DISC-02 → PROF-02 since M2.1, the rest of the social
// part in f5-social.spec.ts; MSG-02 arrives with M2.4.
//
// What a list shows is compared with the very answer the page received, so builds other specs publish at the same time
// cannot make a test flaky. Privacy: a fresh member under E2E_DOMAIN publishes one public, one unlisted and one private
// build, and is then taken out of the member search; only the public build and the discoverable member are ever found.
// The global teardown deletes that member with everything it owns.
import { readFileSync } from 'node:fs';
import type { Locator, Page, Response } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { setDiscoverable } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { buildVehicle, createGarageMember, demoIds, R34 } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';

type Owner = { username: string; city: string | null } | null;
type FeedVehicle = { id: string; slug: string; full_title: string; owner: Owner; latest_update: { id: string; summary: string } | null };
type Member = { username: string; garage: { line: string }; is_self: boolean };
type Overview = {
  query: string;
  vehicles: { count: number; count_capped: boolean; items: FeedVehicle[]; next_cursor: string | null };
  members: { count: number; count_capped: boolean; items: Member[]; next_cursor: string | null };
};
type MakeTile = { id: string; slug: string; name: string; vehicle_count: number };
/** One page of GET feed (M2.2, m2.2-api-handover.md §2): vehicle cards and update rows of the stream. */
type FeedPage = { data: { type: 'vehicle' | 'update'; key: string; vehicle: FeedVehicle | null; update: { id: string; vehicle: { id: string } } | null }[] };

/** MSG-01's approved copy, read from the app's German locale so the spec follows the key, not a sentence of its own. */
const MESSAGES_DE = JSON.parse(readFileSync(new URL('../../../../mobile/src/i18n/locales/de/messages.json', import.meta.url), 'utf8')) as {
  inbox: { guestTitle: string };
};
const ULID = /^[0-9a-z]{26}$/;
/** Words of the engagement metrics V1 never has (brief: no likes, no fake counts). */
const ENGAGEMENT = /\b(Likes?|Gefällt|Aufrufe|Views?|Follower|Kommentare?|Comments?)\b/i;

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const api = (path: string): RegExp => new RegExp(`/api/v1/${path}(\\?.*)?$`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const queryOf = (page: Page): string | null => new URL(page.url()).searchParams.get('q');
/** Text as read: the word joiner keepNameTogether puts after a hyphen and soft hyphens are invisible. */
const plain = (text: string | null): string => (text ?? '').replace(/[⁠­]/g, '').replace(/\s+/g, ' ').trim();

/** The answer to the next GET of `path` (any query) whose `q` is `q`, when given. */
function answerOf(page: Page, path: string, q?: string): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    if (url.pathname !== `/api/v1/${path}` || response.request().method() !== 'GET') return false;
    return q === undefined || url.searchParams.get('q') === q;
  });
}

async function json<T>(response: Response): Promise<T> {
  expect(response.status(), `${response.url()} answered`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

/** The visible items of a list by their `<prefix><ULID>` test IDs, top to bottom. */
function shownIds(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(
    ({ prefix, pattern }) => {
      const ulid = new RegExp(pattern);
      return [...document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)]
        .map((el) => ({ el, rest: (el.getAttribute('data-testid') ?? '').slice(prefix.length) }))
        .filter(({ el, rest }) => ulid.test(rest) && el.checkVisibility())
        .map(({ el, rest }) => ({ rest, top: el.getBoundingClientRect().top }))
        .sort((a, b) => a.top - b.top)
        .map(({ rest }) => rest);
    },
    { prefix, pattern: ULID.source },
  );
}

/** How many visible elements carry `<prefix><slug>` exactly, without the IDs of their parts (`….body`, `….value`). */
function countSlugs(page: Page, prefix: string): Promise<number> {
  return page.evaluate(
    (prefix) =>
      [...document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)].filter(
        (el) => /^[a-z0-9-]+$/.test((el.getAttribute('data-testid') ?? '').slice(prefix.length)) && el.checkVisibility(),
      ).length,
    prefix,
  );
}

/** Holds GET /api/v1/search?q=<q> until released; a request the app cancels meanwhile is simply dropped. */
async function holdSearch(page: Page, q: string) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const matcher = (url: URL) => url.pathname === '/api/v1/search' && url.searchParams.get('q') === q;
  await page.route(matcher, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  return {
    release,
    stop: async () => {
      release();
      await page.unroute(matcher);
    },
  };
}

/**
 * Resolves once the list's scroll offset has stopped changing (two reads 50 ms apart, at most 2 s): page.mouse.wheel returns
 * before the list has moved. The list is its own scroller, or the scrolling element inside or around it. One round trip,
 * since this runs at every step; the page's timers run in real time here (the spec fixes the date, not the timers).
 */
function settle(list: Locator): Promise<number> {
  return list.evaluate(async (root) => {
    const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight;
    let found: Element | null = scrolls(root) ? root : ([...root.querySelectorAll('*')].find(scrolls) ?? null);
    for (let up = root.parentElement; !found && up; up = up.parentElement) if (scrolls(up)) found = up;
    const scroller = found ?? document.scrollingElement ?? document.documentElement;
    let last = scroller.scrollTop;
    for (let read = 0; read < 40; read++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (scroller.scrollTop === last) break;
      last = scroller.scrollTop;
    }
    return last;
  });
}

/**
 * Moves the list's own scroller by `delta` px (or to its top), without the pointer: the wheel depends on where the pointer
 * stands and on WebKit delivering it, a scrollTop does not. FlashList hears the scroll event and draws and loads as for a wheel.
 */
function scrollListBy(list: Locator, delta: number | 'top'): Promise<{ top: number; height: number; client: number }> {
  return list.evaluate((root, by) => {
    const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight;
    let found: Element | null = scrolls(root) ? root : ([...root.querySelectorAll('*')].find(scrolls) ?? null);
    for (let up = root.parentElement; !found && up; up = up.parentElement) if (scrolls(up)) found = up;
    const scroller = (found ?? document.scrollingElement ?? document.documentElement) as HTMLElement;
    scroller.scrollTop = by === 'top' ? 0 : scroller.scrollTop + by;
    scroller.dispatchEvent(new Event('scroll'));
    return { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight };
  }, delta);
}

/**
 * Walks the list from its top in steps of 80 % of its height until a row with this testID is attached (FlashList attaches only
 * the rows near the window), then brings it into view. Ends at the list's end: a row that never attaches is a failure.
 */
async function revealRow(page: Page, listId: string, testId: string): Promise<void> {
  const list = id(page, listId);
  const row = page.locator(`[data-testid="${testId}"]`);
  let at = await scrollListBy(list, 'top');
  await settle(list);
  let still = 0;
  for (let step = 0; step < 400 && (await row.count()) === 0; step++) {
    const before = at.top;
    at = await scrollListBy(list, Math.round(at.client * 0.8));
    await settle(list);
    // At the end: let the next page arrive (the list asks for it on reaching its end) before looking again. Three times at the end
    // with nothing new in between: the row is not on this list.
    if (at.top === before) {
      // The list did not ask by itself (a jump to the end can land before its new length is measured): "Mehr laden" is the designed
      // end of a list with more (BH-43), and a person taps it (E2E run 3, WebKit, 63 hits: the walk stopped after the second page).
      const more = page.locator(`[data-testid="${listId.split('.')[0]}.more"]:visible`);
      if ((await more.count()) > 0 && (await more.isEnabled())) await more.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      await settle(list);
    }
    still = at.top === before ? still + 1 : 0;
    if (still >= 3) break;
  }
  await expect(row.first(), `${testId} is on ${listId}`).toBeAttached();
  await row.first().scrollIntoViewIfNeeded();
  await expect(row.first()).toBeInViewport();
}

/**
 * Wheels the list until `target` is drawn and in view: FlashList renders only the rows near the window, and unmounts a row
 * that a scroll still under way carries out of it. So every step lets the scroll come to rest before it looks, and a row
 * that went away again is looked for on the side where it was last seen. A step is 80 % of the list's height, so every
 * row passes through the window at least once.
 */
async function scrollUntilVisible(page: Page, listId: string, target: Locator, steps = 40): Promise<void> {
  const list = id(page, listId);
  const box = await list.boundingBox();
  if (!box) throw new Error(`${listId} is not on screen`);
  // The part of the list inside the window, should the element be taller than what it shows.
  const shown = Math.min(box.y + box.height, page.viewportSize()?.height ?? box.y + box.height) - Math.max(box.y, 0);
  const middle = Math.max(box.y, 0) + shown / 2;
  const stride = Math.max(100, Math.round(shown * 0.8));
  await page.mouse.move(box.x + box.width / 2, middle);
  let direction = 1;
  for (let step = 0; step < steps; step++) {
    await settle(list);
    // isVisible does not wait; boundingBox gets a short bound, since the row can go between the two calls.
    const seen = (await target.isVisible()) ? await target.boundingBox({ timeout: 1_000 }).catch(() => null) : null;
    if (seen) {
      try {
        await target.scrollIntoViewIfNeeded({ timeout: 2_000 });
        await expect(target).toBeInViewport({ timeout: 2_000 });
        return;
      } catch {
        // Unmounted between the look and the scroll: look again from a list at rest, towards where the row was.
        direction = seen.y < middle ? -1 : 1;
        continue;
      }
    }
    await page.mouse.wheel(0, stride * direction);
  }
  await expect(target).toBeInViewport();
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(qaUrl(path));
}

async function expectNoEngagementWords(page: Page, rootId: string): Promise<void> {
  const text = plain(await id(page, rootId).innerText());
  expect(text, 'V1 shows no likes, views, followers or comments').not.toMatch(ENGAGEMENT);
}

test.describe('HOME-01 Start', () => {
  // M2.2 (FS-2): Neue Builds are two cards (home/new-builds?per_page=3, the hero left out), and the ranked stream below the modules
  // comes from GET feed?tab=for_you. Builds that other specs publish meanwhile are the newest, so the latest change is taken from
  // the stream, which ranks the demo builds, and not from Neue Builds.
  test('lists the lead and Neu in der Garage from the API, and opens a build of the stream from its feed card', async ({ page }) => {
    const featuredAnswer = answerOf(page, 'home/featured');
    const buildsAnswer = answerOf(page, 'home/new-builds');
    const streamAnswer = answerOf(page, 'feed');
    await open(page, '/app/');
    const featured = await json<{ vehicle: FeedVehicle }[]>(await featuredAnswer);
    const builds = await json<FeedVehicle[]>(await buildsAnswer);
    const streamResponse = await streamAnswer;
    expect(new URL(streamResponse.url()).searchParams.get('tab')).toBe('for_you');
    expect(streamResponse.status()).toBe(200);
    const stream = ((await streamResponse.json()) as FeedPage).data;
    expect(builds.length, 'the demo data has public builds').toBeGreaterThan(1);
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.length).toBeLessThanOrEqual(3);

    await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
    // Phone: the lead (MediaCard lead, 4:5 edge to edge), the first featured build, with its owner on the photo.
    const hero = featured[0]!.vehicle;
    await expect(id(page, 'HOME-01.featured')).toBeVisible();
    expect(plain(await id(page, 'HOME-01.featured.title').textContent())).toBe(hero.full_title);
    if (hero.owner) await expect(id(page, 'HOME-01.featured')).toContainText(`@${hero.owner.username}`);
    await expect(id(page, 'HOME-01.newBuilds')).toContainText('Neu in der Garage');
    // DQ-188: the lead is not repeated in the rail, nor as a card.
    const fresh = builds.filter((v) => v.id !== hero.id);
    await expect(id(page, `HOME-01.newBuilds.item.${fresh[0]!.id}`)).toBeVisible();
    await expect(page.locator(`[data-testid="HOME-01.newBuilds.item.${hero.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="HOME-01.card.${hero.id}"]`)).toHaveCount(0);
    const shown = (await shownIds(page, 'HOME-01.newBuilds.item.')).slice(0, 3);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown, 'the rail in the order of the answer').toEqual(fresh.slice(0, shown.length).map((v) => v.id));
    await expectNoEngagementWords(page, 'HOME-01.root');

    // A feed card of the stream: its header opens the build, its caption tells the latest change (09 §7.3).
    const streamCar = stream.find((item) => item.type === 'vehicle' && item.vehicle && !fresh.slice(0, 8).some((v) => v.id === item.vehicle!.id) && item.vehicle.id !== hero.id)?.vehicle;
    expect(streamCar, 'the stream has a build below the rail').toBeTruthy();
    const header = page.locator(`[data-testid="HOME-01.card.${streamCar!.id}.header"]:visible`);
    for (let step = 0; step < 30 && (await header.count()) === 0; step++) {
      await page.mouse.move(195, 500);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(150);
    }
    if (streamCar!.latest_update) {
      await expect(id(page, `HOME-01.card.${streamCar!.id}.caption`)).toContainText(plain(streamCar!.latest_update.summary).slice(0, 12));
    }
    await header.click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/v/${streamCar!.slug}`);
  });

  test('opens at the top when the featured build answers after Neue Builds', async ({ page }) => {
    // Regression: the late hero was inserted above the cards and FlashList kept them in place, so Start opened scrolled.
    await page.setViewportSize({ width: 360, height: 780 });
    const held = new Promise<void>((resolve) => setTimeout(resolve, 1500));
    await page.route(api('home/featured'), async (route) => {
      await held;
      await route.continue();
    });
    const builds = answerOf(page, 'home/new-builds');
    await open(page, '/app/');
    await builds;
    await expect(page.locator('[data-testid^="HOME-01.card."]:visible').first()).toBeVisible();
    await expect(id(page, 'HOME-01.featured')).toBeVisible();
    await page.waitForTimeout(500);
    const scrolled = await id(page, 'HOME-01.list').evaluate((list) => {
      for (let node: Element | null = list; node; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible') return node.scrollTop;
      }
      return null;
    });
    expect(scrolled, 'Start is still at the top').toBe(0);
    await expect(id(page, 'HOME-01.header.logo')).toBeInViewport();
    await expect(id(page, 'HOME-01.featured.title')).toBeInViewport();
  });

  test('at 1280: the featured build heads the column, the rail has the top makes with real counts and Über SPEED CLUB for guests', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const featuredAnswer = answerOf(page, 'home/featured');
    const makesAnswer = answerOf(page, 'discover');
    await open(page, '/app/');
    const featured = await json<{ vehicle: FeedVehicle }[]>(await featuredAnswer);
    const { makes } = await json<{ makes: MakeTile[] }>(await makesAnswer);

    await expect(id(page, 'HOME-01.rail')).toBeVisible();
    // 09 §7.3 on every width (DQ-188): the lead heads the column, then Neu in der Garage. The side rail shows no build, so none
    // appears twice above the fold.
    expect(plain(await id(page, 'HOME-01.featured.title').textContent())).toBe(featured[0]!.vehicle.full_title);
    await expect(id(page, 'HOME-01.rail').locator('[data-testid="HOME-01.featured"]')).toHaveCount(0);
    const heroBox = await id(page, 'HOME-01.featured').boundingBox();
    const sectionBox = await id(page, 'HOME-01.newBuilds').boundingBox();
    expect(heroBox!.y, 'the featured build is above Neue Builds').toBeLessThan(sectionBox!.y);
    for (const make of makes.slice(0, 3)) {
      const row = id(page, `HOME-01.rail.make.${make.slug}`);
      expect(plain(await row.textContent())).toContain(make.name);
      await expect(row).toContainText(`${make.vehicle_count} Build${make.vehicle_count === 1 ? '' : 's'}`);
    }
    expect(await countSlugs(page, 'HOME-01.rail.make.')).toBe(Math.min(3, makes.length));
    await expect(id(page, 'HOME-01.rail.about')).toContainText('Über SPEED CLUB');
    await expectNoEngagementWords(page, 'HOME-01.root');

    const make = makes[0]!;
    const results = answerOf(page, 'search', make.name);
    await id(page, `HOME-01.rail.make.${make.slug}`).click();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/discover/search');
    expect(queryOf(page)).toBe(make.name);
    const overview = await json<Overview>(await results);
    await expect(id(page, 'DISC-02.tab.vehicles')).toContainText(`Fahrzeuge (${overview.vehicles.count})`);
  });

  test('signed in, the rail has Deine Garage with the real count and no Über SPEED CLUB', async ({ page, context }) => {
    await applyAuth(context, 'member');
    await page.setViewportSize({ width: 1280, height: 800 });
    const garageAnswer = answerOf(page, 'me/vehicles');
    await open(page, '/app/');
    await expect(id(page, 'HOME-01.rail')).toBeVisible();
    await expect(page.locator('[data-testid^="HOME-01.rail.make."]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="HOME-01.rail.about"]:visible')).toHaveCount(0);
    const garage = await json<{ status: string }[]>(await garageAnswer);
    // BH-45: the Profile's number. Drafts and archived vehicles are not in the count (MemberStats, profileVehicles).
    const count = garage.filter((vehicle) => vehicle.status === 'published').length;
    await expect(id(page, 'HOME-01.rail.garage')).toContainText('Deine Garage');
    await expect(id(page, 'HOME-01.rail.garage.open')).toContainText(`${count} Fahrzeug${count === 1 ? '' : 'e'}`);
    await id(page, 'HOME-01.rail.garage.open').click();
    await expect(id(page, 'GAR-01.root')).toBeVisible();
  });

  test('empty: no public builds yet', async ({ page }) => {
    // With no public build every source of FS-2 is empty: the hero, Neue Builds, the three modules and the stream (M2.2).
    await page.route(api('home/featured'), (route) => route.fulfill({ json: { data: [] } }));
    await page.route(api('home/new-builds'), (route) =>
      route.fulfill({ json: { data: [], meta: { path: '/api/v1/home/new-builds', per_page: 20, next_cursor: null, prev_cursor: null } } }),
    );
    await page.route(api('home/modules'), (route) => route.fulfill({ json: { data: { build_updates: [], active_members: [], popular_mods: [] } } }));
    await page.route(api('feed'), (route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, per_page: 20, suggestions: null } } }));
    await open(page, '/app/');
    await expect(id(page, 'HOME-01.empty')).toBeVisible();
    await expect(id(page, 'HOME-01.empty.title')).toHaveText('Noch keine öffentlichen Builds');
    await expect(id(page, 'HOME-01.empty.action')).toContainText('Fahrzeug hinzufügen');
    await expect(page.locator('[data-testid^="HOME-01.card."]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid="HOME-01.featured"]:visible')).toHaveCount(0);
  });

  // M2.2: the list of Start is the stream (GET feed); its failure is the error state. A failing module only hides its section.
  test('error: the feed fails, Erneut versuchen loads it', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 500, url: api('feed') }]);
    await page.route(api('feed'), (route) => route.fulfill({ status: 500, json: { message: 'Serverfehler', code: 'server_error' } }));
    await open(page, '/app/');
    await expect(id(page, 'HOME-01.error')).toBeVisible();
    await expect(id(page, 'HOME-01.error.title')).toHaveText('Builds konnten nicht geladen werden');
    await expect(page.locator('[data-testid="HOME-01.skeleton"]:visible')).toHaveCount(0);

    await page.unroute(api('feed'));
    await id(page, 'HOME-01.error.action').click();
    await expect(page.locator('[data-testid^="HOME-01.card."]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="HOME-01.error"]:visible')).toHaveCount(0);
  });
});

test.describe('DISC-01 Entdecken', () => {
  test('make tiles carry the real counts and open the make page (DISC-03 since M2.3)', async ({ page }) => {
    const makesAnswer = answerOf(page, 'discover');
    await open(page, '/app/discover');
    const { makes } = await json<{ makes: MakeTile[] }>(await makesAnswer);
    expect(makes.length).toBeGreaterThan(0);
    await expect(id(page, 'DISC-01.title')).toHaveText('Entdecken');
    await expect(id(page, 'DISC-01.makesHeader')).toContainText('Marken');
    await expect(id(page, `DISC-01.makes.${makes[0]!.slug}`)).toBeVisible();
    // DQ-1036 / DQ-1038: the grid shows whole rows (6 on a phone) and "Alle N" in its header shows the rest; every make is reachable.
    const shown = await countSlugs(page, 'DISC-01.makes.');
    if (shown < makes.length) {
      await expect(id(page, 'DISC-01.makesHeader.action')).toContainText(String(makes.length));
      await id(page, 'DISC-01.makesHeader.action').click();
    }
    await expect.poll(() => countSlugs(page, 'DISC-01.makes.')).toBe(makes.length);
    for (const make of makes) {
      const tile = id(page, `DISC-01.makes.${make.slug}`);
      // DQ-186: the name carries a word joiner after a hyphen ("Mercedes-Benz" stays whole).
      expect(plain(await tile.textContent())).toContain(make.name);
      await expect(tile).toContainText(`${make.vehicle_count} Build${make.vehicle_count === 1 ? '' : 's'}`);
    }
    // Nothing searched on this device yet: no "Zuletzt gesucht".
    await expect(page.locator('[data-testid="DISC-01.recent"]:visible')).toHaveCount(0);
    await expectNoEngagementWords(page, 'DISC-01.root');

    // M2.3 (m2.3-contract.md §8): a tile opens DISC-03 of its make, which names the make with the count of its own answer.
    const bmw = makes.find((m) => m.slug === 'bmw') ?? makes[0]!;
    const makePage = answerOf(page, `discover/makes/${bmw.slug}`);
    await id(page, `DISC-01.makes.${bmw.slug}`).click();
    await expect(id(page, 'DISC-03.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/discover/make/${bmw.slug}`);
    const { make } = await json<{ make: MakeTile }>(await makePage);
    expect(make.slug).toBe(bmw.slug);
    expect(plain(await id(page, 'DISC-03.title').textContent())).toBe(bmw.name);
    await expect(id(page, 'DISC-03.count')).toHaveText(new RegExp(`^${make.vehicle_count}\\s`));
  });

  test('error: the makes fail, Erneut versuchen loads them', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 500, url: api('discover') }]);
    await page.route(api('discover'), (route) => route.fulfill({ status: 500, json: { message: 'Serverfehler', code: 'server_error' } }));
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.error')).toBeVisible();
    await expect(id(page, 'DISC-01.error.title')).toHaveText('Marken konnten nicht geladen werden');
    // The search stays usable while the tiles failed.
    await expect(id(page, 'DISC-01.search')).toBeEditable();
    await page.unroute(api('discover'));
    await id(page, 'DISC-01.error.action').click();
    await expect(page.locator('[data-testid^="DISC-01.makes."]:visible').first()).toBeVisible();
  });

  test('empty: no makes yet', async ({ page }) => {
    await page.route(api('discover'), (route) => route.fulfill({ json: { data: { makes: [] } } }));
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.empty')).toBeVisible();
    await expect(id(page, 'DISC-01.empty.title')).toHaveText('Noch keine Marken');
  });
});

test.describe('DISC-02 Suche', () => {
  test('"r34" finds the R34 of lukas.sc and kenji.r34, opens VEH-01 (F5 in Phase 1), and is remembered on the device', async ({ page }) => {
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.search')).toBeVisible();
    // M2.3 (m2.3-api-handover.md §4): a submitted text is read for filters. "r34" is Nissan · Skyline GT-R · R34 as visible chips,
    // nothing is left as text, so the list is the filtered one and has no Mitglieder tab (members are found by text only).
    const filtered = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/search' && url.searchParams.get('generation') === 'r34' && !url.searchParams.get('q');
    });
    await page.getByTestId('DISC-01.search').fill('r34');
    await expect(id(page, 'DISC-01.searchSubmit')).toContainText('Nach „r34“ suchen');
    await page.getByTestId('DISC-01.search').press('Enter');
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/discover/search');
    const understood = await json<Overview>(await filtered);
    await expect(id(page, 'DISC-02.chips.make.nissan')).toBeVisible();
    await expect(id(page, 'DISC-02.chips.model.skyline-gt-r')).toBeVisible();
    await expect(id(page, 'DISC-02.chips.generation.r34')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('generation')).toBe('r34');
    expect(queryOf(page), 'the text was used up by the chips').toBeNull();
    expect(understood.vehicles.count, 'both demo R34s are hits').toBeGreaterThanOrEqual(2);
    await expect(id(page, `DISC-02.vehicle.${understood.vehicles.items[0]!.id}`)).toBeVisible();
    await expect(page.locator('[data-testid="DISC-02.tabs"]:visible')).toHaveCount(0);

    // The same text as a link, without the request to read it: the text search with both tabs.
    const results = answerOf(page, 'search', 'r34');
    await open(page, '/app/discover/search?q=r34');
    const overview = await json<Overview>(await results);
    expect(overview.vehicles.count, 'both demo R34s are hits').toBeGreaterThanOrEqual(2);

    await expect(id(page, 'DISC-02.tab.vehicles')).toHaveAttribute('aria-selected', 'true');
    await expect(id(page, 'DISC-02.tab.vehicles')).toContainText(`Fahrzeuge (${overview.vehicles.count})`);
    await expect(id(page, 'DISC-02.tab.members')).toContainText(`Mitglieder (${overview.members.count})`);
    await expect(id(page, `DISC-02.vehicle.${overview.vehicles.items[0]!.id}`)).toBeVisible();
    const shown = await shownIds(page, 'DISC-02.vehicle.');
    expect(shown).toEqual(overview.vehicles.items.slice(0, shown.length).map((v) => v.id));
    await expectNoEngagementWords(page, 'DISC-02.root');
    // Other specs of the run publish R34s of their own test members, which rank as new above the flagship: it is found by
    // scrolling, through the next cursor pages when there are more hits than the first ten.
    const flagship = (await demoIds()).r34;
    const card = id(page, `DISC-02.vehicle.${flagship}`);
    // Under load other specs' R34s rank first: walk the list by its scroller until the card is attached.
    await revealRow(page, 'DISC-02.list', `DISC-02.vehicle.${flagship}`);
    await expect(id(page, `DISC-02.vehicle.${flagship}.owner`)).toContainText('@lukas.sc');

    // Mitglieder: the member row with its garage line, no Follow button before PROF-02.
    const kenji = overview.members.items.find((m) => m.username === 'kenji.r34');
    expect(kenji, 'kenji.r34 is a member hit for "r34"').toBeTruthy();
    await id(page, 'DISC-02.tab.members').click();
    await expect(id(page, 'DISC-02.tab.members')).toHaveAttribute('aria-selected', 'true');
    await expect(id(page, 'DISC-02.member.kenji.r34')).toBeVisible();
    await expect(id(page, 'DISC-02.member.kenji.r34.garage')).toHaveText(kenji!.garage.line);
    // M2.7 (DQ-326): member hits carry Folgen for a signed-in member; a guest's opens the auth sheet.
    await expect(id(page, 'DISC-02.member.kenji.r34')).toContainText('Folgen');

    // Back to Fahrzeuge, then the hit opens its build page.
    await id(page, 'DISC-02.tab.vehicles').click();
    await scrollUntilVisible(page, 'DISC-02.list', card, 120);
    await id(page, `DISC-02.vehicle.${flagship}.header`).click();
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/v/${R34.slug}`);

    // The term is kept on this device only, and "Löschen" forgets it.
    await open(page, '/app/discover');
    await expect(id(page, 'DISC-01.recent')).toBeVisible();
    await expect(id(page, 'DISC-01.recent.0')).toHaveText('r34');
    await id(page, 'DISC-01.recent.header').getByText('Löschen').click();
    await expect(page.locator('[data-testid="DISC-01.recent"]:visible')).toHaveCount(0);
  });

  test('typing is debounced, the old results stay while the next load, and an older request is cancelled', async ({ page }) => {
    const r34 = answerOf(page, 'search', 'r34');
    await open(page, '/app/discover/search?q=r34');
    const first = await json<Overview>(await r34);
    const shownBefore = first.vehicles.items[0]!.id;
    await expect(id(page, `DISC-02.vehicle.${shownBefore}`)).toBeVisible();

    const asked: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/search') asked.push(url.searchParams.get('q') ?? '');
    });
    // "e46" answers late, so the screen is seen between the two answers.
    const e46Held = await holdSearch(page, 'e46');
    const field = page.getByTestId('DISC-02.search');
    await field.click();
    await field.press('ControlOrMeta+a');
    // Three keys well inside the 300 ms: one request, for the whole word.
    await field.pressSequentially('e46', { delay: 40 });
    await expect.poll(() => asked).toEqual(['e46']);
    await expect.poll(() => queryOf(page)).toBe('e46');
    // Still the "r34" list, no skeleton in between.
    await expect(id(page, `DISC-02.vehicle.${shownBefore}`)).toBeVisible();
    await expect(page.locator('[data-testid="DISC-02.skeleton"]:visible')).toHaveCount(0);

    const e46 = answerOf(page, 'search', 'e46');
    await e46Held.stop();
    const next = await json<Overview>(await e46);
    const m3 = next.vehicles.items.find((v) => v.owner?.username === 'max.e46');
    expect(m3, 'max.e46 owns the E46 of the demo data').toBeTruthy();
    await expect(id(page, `DISC-02.vehicle.${m3!.id}`)).toBeVisible();
    await expect(page.locator(`[data-testid="DISC-02.vehicle.${shownBefore}"]:visible`)).toHaveCount(next.vehicles.items.some((v) => v.id === shownBefore) ? 1 : 0);
    expect(next.members.items.map((m) => m.username)).toContain('max.e46');
    await id(page, 'DISC-02.tab.members').click();
    await expect(id(page, 'DISC-02.member.max.e46')).toBeVisible();

    // A slow "bmw" is overtaken by "bmw m4": its request is cancelled and its late answer never replaces the newer one.
    const cancelled = page.waitForEvent('requestfailed', (request) => new URL(request.url()).searchParams.get('q') === 'bmw');
    const bmwHeld = await holdSearch(page, 'bmw');
    await field.press('ControlOrMeta+a');
    await field.pressSequentially('bmw', { delay: 40 });
    await expect.poll(() => asked.includes('bmw')).toBe(true);
    const m4 = answerOf(page, 'search', 'bmw m4');
    await field.pressSequentially(' m4', { delay: 40 });
    const final = await json<Overview>(await m4);
    await cancelled;
    await bmwHeld.stop();
    // Long enough for the cancelled answer to have arrived, had it been let through.
    await page.waitForTimeout(500);
    expect(queryOf(page)).toBe('bmw m4');
    const hit = final.vehicles.items[0];
    expect(hit, '"bmw m4" finds the M4 of jann.ptrs').toBeTruthy();
    await id(page, 'DISC-02.tab.vehicles').click();
    await expect(id(page, `DISC-02.vehicle.${hit!.id}`)).toBeVisible();
    await expect(id(page, 'DISC-02.tab.vehicles')).toContainText(`Fahrzeuge (${final.vehicles.count})`);
  });

  // BH-38: react-native-web blurs the field on every scroll event of a list with keyboardDismissMode, and an answer used to scroll it.
  test('an answer arriving while the query is corrected leaves the field focused, and the next key counts', async ({ page }) => {
    const m4 = answerOf(page, 'search', 'm4');
    await open(page, '/app/discover/search?q=m4');
    await json<Overview>(await m4);
    const field = page.getByTestId('DISC-02.search');
    await field.click();
    await field.press('End');

    const m = answerOf(page, 'search', 'm');
    await field.press('Backspace');
    await json<Overview>(await m);
    await expect.poll(() => queryOf(page)).toBe('m');
    // Long enough for the scroll that used to follow the answer.
    await page.waitForTimeout(300);
    await expect(field).toBeFocused();

    const m3 = answerOf(page, 'search', 'm3');
    await page.keyboard.press('3');
    await json<Overview>(await m3);
    await expect(field).toHaveValue('m3');
    expect(queryOf(page)).toBe('m3');
    await expect(field).toBeFocused();
  });

  // BH-39: the anchor rode on the card that was first, so the best results sat above the screen with nothing to say so.
  test('a new query starts at its top result, also after a scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const m4 = answerOf(page, 'search', 'm4');
    await open(page, '/app/discover/search?q=m4');
    const first = (await json<Overview>(await m4)).vehicles.items[0]!;
    await expect(id(page, `DISC-02.vehicle.${first.id}`)).toBeVisible();

    // Whatever the demo data ranks first for "m", the card on screen now comes second in the next answer: the case that went wrong.
    await page.route(
      (url) => url.pathname === '/api/v1/search' && url.searchParams.get('q') === 'm',
      async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { data: Overview };
        const items = body.data.vehicles.items;
        const kept = items.find((v) => v.id === first.id);
        const others = items.filter((v) => v.id !== first.id);
        if (kept && others[0]) body.data.vehicles.items = [others[0], kept, ...others.slice(1)];
        await route.fulfill({ response, json: body });
      },
    );
    const field = page.getByTestId('DISC-02.search');
    await field.click();
    await field.press('End');
    const m = answerOf(page, 'search', 'm');
    await field.press('Backspace');
    const shifted = await json<Overview>(await m);
    expect(shifted.vehicles.items[1]?.id, 'the first card of "m4" is also a hit for "m"').toBe(first.id);
    await expect(id(page, `DISC-02.vehicle.${shifted.vehicles.items[0]!.id}`)).toBeInViewport();
    expect(await settle(id(page, 'DISC-02.list'))).toBe(0);
    expect((await shownIds(page, 'DISC-02.vehicle.'))[0]).toBe(shifted.vehicles.items[0]!.id);

    // Scrolled down, then another query.
    const list = await id(page, 'DISC-02.list').boundingBox();
    await page.mouse.move(list!.x + list!.width / 2, list!.y + 200);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => settle(id(page, 'DISC-02.list'))).toBeGreaterThan(100);
    const next = answerOf(page, 'search', 'mazda');
    await field.fill('mazda');
    const mazda = await json<Overview>(await next);
    await expect(id(page, `DISC-02.vehicle.${mazda.vehicles.items[0]!.id}`)).toBeInViewport();
    expect(await settle(id(page, 'DISC-02.list'))).toBe(0);
  });

  test('only members match: the Mitglieder tab opens first, and a row opens PROF-02 inside Entdecken', async ({ page }) => {
    const answer = answerOf(page, 'search', 'kenji');
    await open(page, '/app/discover/search?q=kenji');
    const overview = await json<Overview>(await answer);
    expect(overview.vehicles.count).toBe(0);
    expect(overview.members.count).toBeGreaterThan(0);
    await expect(id(page, 'DISC-02.tab.members')).toHaveAttribute('aria-selected', 'true');
    await expect(id(page, 'DISC-02.tab.vehicles')).toContainText('Fahrzeuge (0)');
    await expect(id(page, 'DISC-02.member.kenji.r34')).toBeVisible();

    // Since M2.1 the row opens PROF-02 in the Entdecken stack (shared routes, ADR-101), no longer the web page in a new tab.
    await id(page, 'DISC-02.member.kenji.r34.body').click();
    await expect(id(page, 'PROF-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/u/kenji.r34');
    await expect(id(page, 'PROF-02.username')).toContainText('@kenji.r34');
    await expect(id(page, 'tab.discover')).toHaveAttribute('aria-selected', 'true');
    await id(page, 'PROF-02.header.back').click();
    await expect(id(page, 'DISC-02.member.kenji.r34')).toBeVisible();
  });

  test('signed in as lukas.sc, the own row says Du and leads to the own profile', async ({ page, context }) => {
    await applyAuth(context, 'member');
    await open(page, '/app/discover/search?q=lukas');
    await expect(id(page, 'DISC-02.member.lukas.sc')).toBeVisible();
    await expect(id(page, 'DISC-02.member.lukas.sc')).toContainText('Du');
    await id(page, 'DISC-02.member.lukas.sc.body').click();
    await expect(id(page, 'PROF-01.root')).toBeVisible();
    expect(pathOf(page)).toBe('/app/profile');
  });

  test('no result: the server found nothing, and the real makes are offered', async ({ page }) => {
    const makesAnswer = answerOf(page, 'discover');
    await open(page, '/app/discover/search?q=zzqxv');
    const { makes } = await json<{ makes: MakeTile[] }>(await makesAnswer);
    await expect(id(page, 'DISC-02.noResults')).toBeVisible();
    await expect(id(page, 'DISC-02.noResults.title')).toHaveText('Keine Treffer für „zzqxv“');
    await expect(page.locator('[data-testid="DISC-02.tabs"]:visible')).toHaveCount(0);
    await expect(id(page, 'DISC-02.suggestions')).toBeVisible();
    await expect(id(page, 'DISC-02.suggestions.0')).toHaveText(makes[0]!.name);

    // M2.3: a picked suggestion is a submitted term, read for filters: the make becomes its chip and nothing stays as text.
    const results = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/search' && url.searchParams.get('make') === makes[0]!.slug && !url.searchParams.get('q');
    });
    await id(page, 'DISC-02.suggestions.0').click();
    await expect(id(page, `DISC-02.chips.make.${makes[0]!.slug}`)).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('make')).toBe(makes[0]!.slug);
    expect(queryOf(page)).toBeNull();
    const overview = await json<Overview>(await results);
    await expect(id(page, `DISC-02.vehicle.${overview.vehicles.items[0]!.id}`)).toBeVisible();
  });

  test('invalid query: the server\'s own sentence', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 422, url: api('search') }]);
    await open(page, `/app/discover/search?q=${encodeURIComponent('!!!')}`);
    await expect(id(page, 'DISC-02.invalid')).toBeVisible();
    await expect(id(page, 'DISC-02.invalid.title')).toHaveText('Suchbegriff prüfen');
    await expect(id(page, 'DISC-02.invalid.body')).toHaveText('Der Suchbegriff braucht mindestens einen Buchstaben oder eine Ziffer.');
  });

  test('error: the search fails, Erneut versuchen runs it again', async ({ page, expectFailedResponses }) => {
    expectFailedResponses([{ status: 500, url: api('search') }]);
    await page.route(api('search'), (route) => route.fulfill({ status: 500, json: { message: 'Serverfehler', code: 'server_error' } }));
    await open(page, '/app/discover/search?q=r34');
    await expect(id(page, 'DISC-02.error')).toBeVisible();
    await expect(id(page, 'DISC-02.error.title')).toHaveText('Die Suche hat nicht geklappt');
    await expect(page.locator('[data-testid="DISC-02.skeleton"]:visible')).toHaveCount(0);
    await page.unroute(api('search'));
    await id(page, 'DISC-02.error.action').click();
    await expect(page.locator('[data-testid^="DISC-02.vehicle."]:visible').first()).toBeVisible();
  });

  test('rate limited: the server says how long to wait', async ({ page, expectFailedResponses }) => {
    const message = 'Zu viele Suchanfragen. Versuch es in 30 Sekunden noch einmal.';
    expectFailedResponses([{ status: 429, url: api('search') }]);
    await page.route(api('search'), (route) =>
      route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: { message, code: 'rate_limited' } }),
    );
    await open(page, '/app/discover/search?q=r34');
    await expect(id(page, 'DISC-02.error')).toBeVisible();
    await expect(id(page, 'DISC-02.error.body')).toHaveText(message);
  });

  test('offline: the search waits for a connection and says so', async ({ page, context, expectFailedResponses }) => {
    // The search may set off before the app has seen the connection go: the browser refuses it, as intended here.
    // Since M2.3 the submit also asks search/interpret, which fails at once offline (networkMode offlineFirst, retry: false; the
    // text search then stands on its own).
    expectFailedResponses([
      { status: 'network', url: api('search') },
      { status: 'network', url: api('search/interpret') },
    ]);
    // The web export loads each route's code when it is first opened, so DISC-02 is opened once online (see the M1.8
    // report: an unvisited route cannot load offline on web; the APK bundles everything).
    await open(page, '/app/discover/search');
    await expect(id(page, 'DISC-02.suggestions')).toBeVisible();
    await id(page, 'DISC-02.header.back').click();
    await expect(page.locator('[data-testid^="DISC-01.makes."]:visible').first()).toBeVisible();
    // DISC-01 has photos since M2.3 (Kollektionen) and the "Neu entdeckt" wall since M4.8, which the browser loads lazily: the page is
    // wheeled through once and all of them finish loading first, so going offline fails no picture half way.
    await page.mouse.move(195, 500);
    for (let step = 0; step < 12; step++) await page.mouse.wheel(0, 600);
    await page.waitForLoadState('networkidle');
    for (let step = 0; step < 12; step++) await page.mouse.wheel(0, -900);
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await expect(id(page, 'shell.offline')).toBeVisible();
    await page.getByTestId('DISC-01.search').fill('r34');
    await page.getByTestId('DISC-01.search').press('Enter');
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    await expect(id(page, 'DISC-02.offline')).toBeVisible();
    await expect(id(page, 'DISC-02.offline.title')).toHaveText('Du bist offline');
    await context.setOffline(false);
    await expect(page.locator('[data-testid^="DISC-02.vehicle."]:visible').first()).toBeVisible();
  });
});

test.describe('privacy of the lists', () => {
  test('private and unlisted builds and a member outside the search never appear', async ({ page }) => {
    test.setTimeout(120_000);
    const member = await createGarageMember('discover');
    const tag = member.username.slice(1).replace(/[^a-z0-9]/g, '');
    const words = { public: `sichtbar${tag}`, unlisted: `perlink${tag}`, private: `geheim${tag}` };
    const visible = await buildVehicle(member.api, { nickname: words.public });
    const unlisted = await buildVehicle(member.api, { nickname: words.unlisted, visibility: 'unlisted' });
    const hidden = await buildVehicle(member.api, { nickname: words.private, visibility: 'private' });
    await member.api.dispose();
    const never = [unlisted.id, hidden.id];

    // Search as a guest: the public build is found by its nickname, the two others by nothing.
    let answer = answerOf(page, 'search', words.public);
    await open(page, `/app/discover/search?q=${words.public}`);
    let overview = await json<Overview>(await answer);
    expect(overview.vehicles.items.map((v) => v.id)).toEqual([visible.id]);
    await expect(id(page, `DISC-02.vehicle.${visible.id}`)).toBeVisible();
    for (const word of [words.unlisted, words.private]) {
      answer = answerOf(page, 'search', word);
      await open(page, `/app/discover/search?q=${word}`);
      overview = await json<Overview>(await answer);
      expect(overview.vehicles.count, `"${word}" finds nothing`).toBe(0);
      await expect(id(page, 'DISC-02.noResults')).toBeVisible();
    }

    // Start: the public build is among the newest, the others nowhere.
    const builds = answerOf(page, 'home/new-builds');
    await open(page, '/app/');
    const feed = (await json<FeedVehicle[]>(await builds)).map((v) => v.id);
    expect(feed).toContain(visible.id);
    for (const vehicle of never) expect(feed).not.toContain(vehicle);
    await expect(page.locator('[data-testid^="HOME-01.card."]:visible').first()).toBeVisible();
    for (const vehicle of never) await expect(page.locator(`[data-testid^="HOME-01.card.${vehicle}"]`)).toHaveCount(0);

    // Members: found while discoverable, never once taken out of the search.
    answer = answerOf(page, 'search', member.username);
    await open(page, `/app/discover/search?q=${member.username}`);
    overview = await json<Overview>(await answer);
    expect(overview.members.items.map((m) => m.username)).toEqual([member.username]);
    await id(page, 'DISC-02.tab.members').click();
    await expect(id(page, `DISC-02.member.${member.username}`)).toBeVisible();

    await setDiscoverable(member.email, false);
    answer = answerOf(page, 'search', member.username);
    await page.reload();
    overview = await json<Overview>(await answer);
    expect(overview.members.count).toBe(0);
    expect(overview.members.items).toEqual([]);
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    await expect(page.locator(`[data-testid="DISC-02.member.${member.username}"]`)).toHaveCount(0);
  });
});

// Since M2.4 MSG-01 is the inbox (04_SCREEN_REGISTER: "P1 placeholder → P2"); its flows are f5-messaging and f6-requests-safety.
test.describe('MSG-01 Nachrichten', () => {
  test('guest: one invitation to sign in that comes back to /messages, and no inbox', async ({ page }) => {
    await open(page, '/app/messages');
    await expect(id(page, 'MSG-01.title')).toHaveText('Nachrichten');
    await expect(id(page, 'MSG-01.guest.title')).toHaveText(MESSAGES_DE.inbox.guestTitle);
    await expect(id(page, 'MSG-01.tabs')).toHaveCount(0);
    await expect(id(page, 'MSG-01.soon')).toHaveCount(0);
    await id(page, 'MSG-01.guest.action').click();
    // M4.6 (09 §7.2): signing in starts passwordless, at AUTH-12 Mit E-Mail fortfahren. Its requests settle before the test ends.
    await expect(id(page, 'AUTH-12.root')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/messages');
  });

  test('member: the inbox with Chats · Anfragen and the seeded conversations, not the Phase 1 placeholder', async ({ page, context }) => {
    await applyAuth(context, 'member');
    await open(page, '/app/messages');
    await expect(id(page, 'MSG-01.title')).toHaveText('Nachrichten');
    await expect(id(page, 'MSG-01.tabs.chats')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid^="MSG-01.row."][data-testid$=".open"]:visible').first()).toBeVisible();
    await expect(id(page, 'MSG-01.soon')).toHaveCount(0);
  });
});
