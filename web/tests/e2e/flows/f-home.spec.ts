// HOME-01 on the member web: the full FS-2 Für dich of M2.2 (featured hero, Neue Builds + "Alle", Build-Updates, Aktive Mitglieder,
// Beliebte Mods → DISC-02 with q, and the ranked stream without a build shown above it), Folge ich (a member with follows, a guest,
// a member who follows nobody and gets suggestions), the bell's unread dot → HOME-02; then, beyond what the list shows
// (f-discover-lite.spec.ts): the place in the list across a pushed page and a tab switch (BH-41, 03_DESIGN_SYSTEM §9), the rail at a
// large font (DQ-199), and a screen that throws (BH-00). A real wheel scroll in a normal window: at 390x300 the list kept its place in
// one run, so a low window hides the bug.
//
// What a section shows is compared with the very answer the page received (m2.2-api-handover.md §2–§3), so builds and follows of
// other specs running at the same time cannot make a test flaky. Pull to refresh is native only: HomeScreen passes no onRefresh on
// web (FlashList's refresh control does not exist there), so it is not tested here.
import type { Locator, Page, Response } from '@playwright/test';
import { applyAuth, DEMO_MEMBER, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { BBS_WHEELS, buildVehicle, createGarageMember, expectStatus } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';
import { readable } from '../support/text.mjs';

type Owner = { username: string; city: string | null } | null;
type FeedVehicle = { id: string; slug: string; full_title: string; owner: Owner; latest_update: { id: string; summary: string } | null };
type UpdateRowData = { id: string; vehicle: FeedVehicle; summary: string };
type ActiveMember = { username: string; car_line: string | null; car_short: string | null; is_following: boolean };
type PopularMod = { label: string; query: string };
type FeedItem = { type: 'vehicle' | 'update'; key: string; vehicle: FeedVehicle | null; update: UpdateRowData | null };
type FeedPage = { data: FeedItem[]; meta: { next_cursor: string | null; suggestions: ActiveMember[] | null } };
type Modules = { build_updates: UpdateRowData[]; active_members: ActiveMember[]; popular_mods: PopularMod[] };

const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const anyWithId = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;
const ULID = /^[0-9a-z]{26}$/;

/** The answer of the next GET of exactly this API path, optionally with these query values. */
function answerOf(page: Page, path: string, query: Record<string, string> = {}): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    if (url.pathname !== `/api/v1/${path}` || response.request().method() !== 'GET') return false;
    return Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

async function bodyOf<T>(response: Promise<Response>): Promise<T> {
  const answered = await response;
  expect(answered.status(), `${answered.url()} answered`).toBe(200);
  return (await answered.json()) as T;
}

/** Wheels Start down in small steps until `target` is drawn and on screen: FlashList draws only a window around what is visible. */
async function reveal(page: Page, target: Locator): Promise<void> {
  const list = page.locator('[data-testid="HOME-01.list"]:visible');
  const box = await list.boundingBox();
  if (!box) throw new Error('HOME-01.list is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, page.viewportSize()?.height ?? box.height) / 2);
  // 09 §7.3: the modules sit between 4:5 feed cards (one card is about a screen), so the walk is long; a step of 500 stays below a
  // window minus a row, so it never skips one.
  for (let step = 0; step < 90; step++) {
    if ((await target.count()) > 0 && (await target.first().isVisible())) {
      // Drawn: the browser brings it the rest of the way (WebKit's wheel steps are not the ones asked for).
      await target.first().scrollIntoViewIfNeeded();
      await restingOffset(list);
      const inView = await target.first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      if (inView) return;
    }
    await page.mouse.wheel(0, 500);
    await restingOffset(list);
  }
  await expect(target.first(), 'reached by scrolling').toBeInViewport();
}

/**
 * The rows Start has drawn right now, top to bottom: `HOME-01.card.<id>` and `HOME-01.stream.update.<id>`, with the bottom of the
 * Beliebte Mods chips when they are drawn. FlashList renders a window and corrects its estimated positions as it measures, so
 * places are compared only inside one snapshot, never across scroll steps.
 */
async function drawnRows(page: Page): Promise<{ rows: { testId: string; top: number }[]; modsBottom: number | null }> {
  return page.evaluate((ulid) => {
    const pattern = new RegExp(ulid);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="HOME-01.card."], [data-testid^="HOME-01.stream.update."]')]
      .filter((el) => {
        const testId = el.getAttribute('data-testid') ?? '';
        return pattern.test(testId.replace(/^HOME-01\.(card|stream\.update)\./, '')) && el.checkVisibility();
      })
      .map((el) => ({ testId: el.getAttribute('data-testid') ?? '', top: Math.round(el.getBoundingClientRect().top) }))
      .sort((a, b) => a.top - b.top);
    const mods = document.querySelector<HTMLElement>('[data-testid="HOME-01.mods.list"]');
    return { rows, modsBottom: mods && mods.checkVisibility() ? Math.round(mods.getBoundingClientRect().bottom) : null };
  }, ULID.source);
}

/** The click on a card focuses it, which can scroll a tall card fully into view by a few pixels just before the page opens. */
const PLACE_TOLERANCE = 24;

/** The list's scroll offset once it has come to rest: page.mouse.wheel returns before the list has moved. */
function restingOffset(list: Locator): Promise<number> {
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

/** Wheels the list to about `distance`, in the steps a hand makes, and returns where it came to rest. */
async function wheelDown(page: Page, listId: string, distance: number): Promise<number> {
  const list = id(page, listId);
  const box = await list.boundingBox();
  if (!box) throw new Error(`${listId} is not on screen`);
  const height = page.viewportSize()?.height ?? box.height;
  await page.mouse.move(box.x + box.width / 2, Math.max(box.y, 0) + (Math.min(box.y + box.height, height) - Math.max(box.y, 0)) / 2);
  const step = 400;
  for (let moved = 0; moved < distance; moved += step) {
    await page.mouse.wheel(0, step);
    await restingOffset(list);
  }
  const offset = await restingOffset(list);
  expect(offset, 'the wheel moved the list').toBeGreaterThan(distance / 2);
  return offset;
}

/** The card nearest the top of the list that fits whole between the header (160: the search field and tabs of DISC-02 end above it) and the foot of the window, with its place on screen. */
async function cardInView(page: Page, prefix: string): Promise<{ testId: string; y: number } | null> {
  // A Start card and a DISC-02 list card (both MediaCard `feed` since DQ-1037) open from their header.
  const suffix = '.header';
  return page.evaluate(({ prefix, suffix }) => {
    // A card under the floating tab bar is not whole: Playwright would scroll it out from under the bar before it clicks, and the
    // place read here would no longer be the one the list keeps (M4.8 r1: a header at y 797 of 844 moved the list by 397).
    const bar = document.querySelector<HTMLElement>('[data-testid="shell.tabbar"]');
    const height = bar && bar.checkVisibility() ? Math.min(window.innerHeight, bar.getBoundingClientRect().top) : window.innerHeight;
    const bodies = [...document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"][data-testid$="${suffix}"]`)]
      .filter((el) => el.checkVisibility())
      .map((el) => ({ testId: el.getAttribute('data-testid') ?? '', box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.top > 160 && box.bottom <= height)
      .map(({ testId, box }) => ({ testId, y: box.top }))
      .sort((a, b) => a.y - b.y);
    return bodies[0] ?? null;
  }, { prefix, suffix });
}

/**
 * Wheels the list on until a whole card is on screen, and returns that card and the list's place. On a desktop one card is most of the
 * window, so a fixed distance can end with none. And a card must be whole: Playwright scrolls a card that is only partly on screen
 * before it clicks (119 px in WebKit), and the place to compare with is then no longer the one read here.
 */
async function wheelToCard(page: Page, listId: string, prefix: string, distance: number): Promise<{ offset: number; card: { testId: string; y: number } }> {
  let offset = await wheelDown(page, listId, distance);
  for (let step = 0; step < 30; step++) {
    const card = await cardInView(page, prefix);
    if (card) return { offset, card };
    await page.mouse.wheel(0, 50);
    offset = await restingOffset(id(page, listId));
  }
  throw new Error(`no whole card of ${prefix} on screen`);
}

/** Back on the list: it returns to the very place, also once FlashList has measured itself, and stays. */
async function expectPlaceKept(list: Locator, offset: number): Promise<void> {
  await expect.poll(async () => Math.abs((await restingOffset(list)) - offset), { message: `the list is back at ${offset}` }).toBeLessThanOrEqual(PLACE_TOLERANCE);
  await list.page().waitForTimeout(700);
  expect(Math.abs((await restingOffset(list)) - offset), 'and it stays there').toBeLessThanOrEqual(PLACE_TOLERANCE);
}

test.describe('FS-2 Für dich (M2.2)', () => {
  test('09 §7.3: the lead, Neu in der Garage (8) + Alle, then the stream with Aktive Mitglieder and Beliebte Mods between, repeating nothing above it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const featuredAnswer = answerOf(page, 'home/featured');
    const newAnswer = answerOf(page, 'home/new-builds');
    const modulesAnswer = answerOf(page, 'home/modules');
    const streamAnswer = answerOf(page, 'feed', { tab: 'for_you' });
    await page.goto(qaUrl('/app/'));
    const featured = (await bodyOf<{ data: { vehicle: FeedVehicle }[] }>(featuredAnswer)).data;
    const newBuilds = (await bodyOf<{ data: FeedVehicle[] }>(newAnswer)).data;
    const modules = (await bodyOf<{ data: Modules }>(modulesAnswer)).data;
    const stream = await bodyOf<FeedPage>(streamAnswer);

    // 09 §6.2 d: the brush wordmark (the page's heading, named Start) and the bell; the segments under it.
    await expect(id(page, 'HOME-01.header.logo')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
    await expect(id(page, 'HOME-01.tab.forYou')).toHaveAttribute('aria-selected', 'true');
    await expect(id(page, 'HOME-01.tab.following')).toHaveAttribute('aria-selected', 'false');

    // The lead: the first featured build, 4:5 edge to edge on a phone, its name on the photo.
    expect(featured.length, 'the demo data has a featured build').toBeGreaterThan(0);
    const hero = featured[0]!.vehicle;
    expect(readable(await id(page, 'HOME-01.featured.title').textContent())).toBe(readable(hero.full_title));
    const heroBox = await id(page, 'HOME-01.featured').boundingBox();
    expect(heroBox?.x, 'the lead starts at the screen edge').toBe(0);
    expect(heroBox?.width, 'and spans the screen').toBe(390);

    // Neu in der Garage: up to 8 rail cards of the answer that are not the lead, in that order.
    const rail = newBuilds.filter((vehicle) => vehicle.id !== hero.id).slice(0, 8);
    expect(rail.length).toBeGreaterThan(1);
    await expect(id(page, 'HOME-01.newBuilds')).toContainText('Neu in der Garage');
    const railIds = await page
      .locator('[data-testid="HOME-01.newBuilds.rail"] [data-testid^="HOME-01.newBuilds.item."]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? '').filter((t) => /^HOME-01\.newBuilds\.item\.[0-9a-z]{26}$/.test(t)));
    expect(railIds).toEqual(rail.map((vehicle) => `HOME-01.newBuilds.item.${vehicle.id}`));
    await expect(anyWithId(page, `HOME-01.card.${hero.id}`)).toHaveCount(0);

    // Aktive Mitglieder and Beliebte Mods sit between the feed cards (after every 6).
    expect(modules.active_members.length, 'the live demo has active members (B1)').toBeGreaterThan(0);
    const firstMember = modules.active_members[0]!;
    await reveal(page, page.locator(`[data-testid="HOME-01.activeMembers.member.${firstMember.username}.username"]:visible`));
    await expect(id(page, 'HOME-01.members')).toContainText('Aktive Mitglieder');
    await expect(id(page, `HOME-01.activeMembers.member.${firstMember.username}.username`)).toHaveText(`@${firstMember.username}`);

    expect(modules.popular_mods.length, 'the live demo has popular mods (B1)').toBeGreaterThanOrEqual(3);
    await reveal(page, page.locator('[data-testid="HOME-01.mods.list"]:visible'));
    await expect(id(page, 'HOME-01.mods')).toContainText('Beliebte Mods diese Woche');
    const chips = page.locator('[data-testid^="HOME-01.mods.list.chip."]:visible');
    const chipTexts = (await chips.allTextContents()).map(readable);
    expect(chipTexts.length).toBeGreaterThan(0);
    expect(chipTexts).toEqual(modules.popular_mods.slice(0, chipTexts.length).map((mod) => readable(mod.label)));
    const lines = new Set(await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top))));
    expect(lines.size, 'the chips take at most two lines (FS-2)').toBeLessThanOrEqual(2);

    // The stream: no lead, and no build of the rail as a card of its own; each build once at a time on screen.
    const streamVehicles = stream.data.flatMap((item) => (item.type === 'vehicle' && item.vehicle ? [item.vehicle.id] : []));
    expect(streamVehicles.length, 'the stream has builds').toBeGreaterThan(0);
    expect(streamVehicles, 'no lead in the stream').not.toContain(hero.id);
    const above = new Set([hero.id, ...rail.map((vehicle) => vehicle.id)].map((vehicleId) => `HOME-01.card.${vehicleId}`));
    const list = id(page, 'HOME-01.list');
    const box = await list.boundingBox();
    if (!box) throw new Error('HOME-01.list is not on screen');
    await page.mouse.move(box.x + box.width / 2, Math.min(box.y + box.height, 844) / 2);
    for (let step = 0; step <= 14; step++) {
      const { rows } = await drawnRows(page);
      const ids = rows.map((row) => row.testId);
      expect(ids.filter((testId, index) => ids.indexOf(testId) !== index), `rows drawn twice at step ${step}`).toEqual([]);
      expect(ids.filter((testId) => above.has(testId)), `a build drawn above comes again as a card at step ${step}`).toEqual([]);
      await page.mouse.wheel(0, 600);
      await restingOffset(list);
    }
  });

  // M2.3 (m2.3-api-handover.md §2): "Alle" continues Neue Builds' own order, which is sort=updated (sort=newest is first publish).
  test('"Alle" opens DISC-02 sorted by Zuletzt aktualisiert; a Beliebte Mods chip opens DISC-02 with its q', async ({ page }) => {
    // The chips sit between feed cards further down (09 §7.3): the walk there is long.
    test.setTimeout(120_000);
    const modulesAnswer = answerOf(page, 'home/modules');
    await page.goto(qaUrl('/app/'));
    const modules = (await bodyOf<{ data: Modules }>(modulesAnswer)).data;
    await expect(id(page, 'HOME-01.newBuilds.action')).toHaveAccessibleName('Alle neuen Builds in Entdecken');
    await id(page, 'HOME-01.newBuilds.action').click();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/discover/search');
    expect(new URL(page.url()).searchParams.get('sort')).toBe('updated');

    await id(page, 'tab.home').click();
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    const mod = modules.popular_mods[0]!;
    await reveal(page, page.locator('[data-testid="HOME-01.mods.list.chip.0"]:visible'));
    const search = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/search' && new URL(r.url()).searchParams.get('q') === mod.query);
    await id(page, 'HOME-01.mods.list.chip.0').click();
    await expect(id(page, 'DISC-02.root')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(mod.query);
    expect(pathOf(page)).toBe('/app/discover/search');
    expect((await search).status()).toBe(200);
  });

  test('the bell of a member with unread notifications carries the dot and the count, and opens HOME-02', async ({ page, context }) => {
    await applyAuth(context, 'member');
    const unread = answerOf(page, 'notifications/unread-count');
    await page.goto(qaUrl('/app/'));
    const count = (await bodyOf<{ data: { notifications: number } }>(unread)).data.notifications;
    expect(count, `${DEMO_MEMBER} has unread rows (DemoSeeder::seedNotifications)`).toBeGreaterThan(0);
    await expect(id(page, 'HOME-01.bell')).toHaveAccessibleName(`Mitteilungen, ${count} ungelesen`);
    await expect(id(page, 'tab.home.dot')).toBeVisible();
    await expect(id(page, 'tab.home')).toHaveAccessibleName(/Neue Benachrichtigungen/);
    const list = answerOf(page, 'notifications');
    await id(page, 'HOME-01.bell').click();
    await expect(id(page, 'HOME-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/notifications');
    const rows = (await bodyOf<{ data: { id: string; read_at: string | null }[] }>(list)).data;
    const firstUnread = rows.find((row) => row.read_at === null);
    expect(firstUnread, 'an unread row').toBeTruthy();
    await expect(id(page, `HOME-02.row.${firstUnread!.id}.unread`)).toBeVisible();
  });

  test('a guest\'s bell asks to sign in, with no dot', async ({ page }) => {
    await page.goto(qaUrl('/app/'));
    await expect(id(page, 'HOME-01.bell')).toHaveAccessibleName('Mitteilungen');
    await expect(anyWithId(page, 'tab.home.dot')).toHaveCount(0);
    await id(page, 'HOME-01.bell').click();
    await expect(id(page, 'shell.authRequired')).toBeVisible();
  });
});

test.describe('FS-2 Folge ich (M2.2)', () => {
  test('a member with follows: the followed member\'s first publish and build update, newest first, as the answer has them', async ({ page, context }) => {
    test.setTimeout(120_000);
    const viewer = await createGarageMember('homefollow');
    const followed = await createGarageMember('homefollowed');
    const vehicle = await buildVehicle(followed.api, { photos: 1, mods: [BBS_WHEELS] });
    expectStatus(await viewer.api.post(`users/${followed.username}/follow`), 200, 'follow');
    await useSession(context, viewer.session);

    const answer = answerOf(page, 'feed', { tab: 'following' });
    await page.goto(qaUrl('/app/?tab=following'));
    await expect(id(page, 'HOME-01.tab.following')).toHaveAttribute('aria-selected', 'true');
    const page1 = await bodyOf<FeedPage>(answer);
    // DQ-1027: consecutive updates of one build are one compact card, under the first update's id.
    const expected = page1.data
      .filter((item, index) => {
        const before = page1.data[index - 1];
        return !(item.type === 'update' && before?.type === 'update' && before.update!.vehicle.id === item.update!.vehicle.id);
      })
      .map((item) => (item.type === 'vehicle' ? `HOME-01.card.${item.vehicle!.id}` : `HOME-01.stream.update.${item.update!.id}`));
    expect(expected, 'the followed build is in the stream').toContain(`HOME-01.card.${vehicle.id}`);
    await expect(id(page, `HOME-01.card.${vehicle.id}`)).toBeVisible();
    const drawn = (await drawnRows(page)).rows.map((row) => row.testId);
    expect(drawn, 'rows in the order of the answer').toEqual(expected.slice(0, drawn.length));
    // Only the followed member's things: Für dich modules are not part of Folge ich.
    await expect(anyWithId(page, 'HOME-01.featured')).toHaveCount(0);
    await expect(anyWithId(page, 'HOME-01.updates')).toHaveCount(0);
    for (const item of page1.data) {
      const owner = item.vehicle?.owner ?? item.update?.vehicle.owner;
      expect(owner?.username, `${item.key} belongs to the followed member`).toBe(followed.username);
    }

    // Back to Für dich and again: the segment switch keeps working, and the URL's tab is only the way in.
    await id(page, 'HOME-01.tab.forYou').click();
    await expect(id(page, 'HOME-01.featured')).toBeVisible();
    await id(page, 'HOME-01.tab.following').click();
    await expect(id(page, `HOME-01.card.${vehicle.id}`)).toBeVisible();
  });

  test('a guest gets the sign-in prompt, which leads to AUTH-12', async ({ page }) => {
    await page.goto(qaUrl('/app/?tab=following'));
    await expect(id(page, 'HOME-01.following.guest')).toBeVisible();
    await expect(id(page, 'HOME-01.following.guest.title')).toHaveText('Sieh, was sich bei deinen Leuten tut');
    await expect(page.locator('[data-testid^="HOME-01.card."]:visible')).toHaveCount(0);
    await id(page, 'HOME-01.following.guest.action').click();
    // M4.6 (09 §7.2): signing in starts passwordless, at AUTH-12 Mit E-Mail fortfahren.
    await expect(id(page, 'AUTH-12.root')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('a member who follows nobody gets the empty state with suggestions, and Folgen there follows', async ({ page, context }) => {
    test.setTimeout(90_000);
    const viewer = await createGarageMember('homeempty');
    await useSession(context, viewer.session);
    const answer = answerOf(page, 'feed', { tab: 'following' });
    await page.goto(qaUrl('/app/?tab=following'));
    const page1 = await bodyOf<FeedPage>(answer);
    expect(page1.data).toEqual([]);
    const suggestions = page1.meta.suggestions ?? [];
    expect(suggestions.length, 'suggestions for an empty Folge ich').toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(6);
    await expect(id(page, 'HOME-01.following.empty')).toBeVisible();
    await expect(id(page, 'HOME-01.following.empty.title')).toHaveText('Folge Builds, die dich interessieren');
    const rows = page.locator('[data-testid^="HOME-01.suggestion."][data-testid$=".follow"]:visible');
    await expect(rows).toHaveCount(suggestions.length);
    expect(suggestions.map((s) => s.username), 'the viewer is never suggested').not.toContain(viewer.username);

    const first = suggestions[0]!;
    const button = id(page, `HOME-01.suggestion.${first.username}.follow`);
    await expect(button).toHaveText('Folgen');
    const followed = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/users/${first.username}/follow`);
    await button.click();
    await expect(button).toHaveText('Folge ich');
    expect((await followed).status()).toBe(200);
    const profile = expectStatus(await viewer.api.get(`public/users/${first.username}`), 200, 'profile').data as { is_following: boolean };
    expect(profile.is_following).toBe(true);
    // The suggestion is a demo member: the follow is taken back, so the demo follow graph stays as seeded.
    expectStatus(await viewer.api.delete(`users/${first.username}/follow`), 200, 'unfollow the demo member');
  });
});

for (const [width, height] of [
  [390, 844],
  [1280, 844],
] as const) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('HOME-01 keeps its place through a build page and back, and through a tab switch; a re-tap forgets it', async ({ page }) => {
      await page.goto(qaUrl('/app/'));
      const list = id(page, 'HOME-01.list');
      // The lead and the rail fill the first screen (09 §7.3); the feed cards follow below them.
      await expect(page.locator('[data-testid^="HOME-01.newBuilds.item."]:visible').first()).toBeVisible();
      const { offset, card } = await wheelToCard(page, 'HOME-01.list', 'HOME-01.card.', 2400);

      // Header back from a build.
      await id(page, card.testId).click();
      await expect(id(page, 'VEH-01.title')).toBeVisible();
      await id(page, 'VEH-01.header.back').click();
      await expect(id(page, 'HOME-01.root')).toBeVisible();
      await expectPlaceKept(list, offset);
      await expect(id(page, card.testId)).toBeInViewport();
      const box = await id(page, card.testId).boundingBox();
      expect(Math.abs((box?.y ?? 0) - card.y), 'the card is where it was').toBeLessThanOrEqual(PLACE_TOLERANCE);

      // A tab switch, there and back.
      await id(page, 'tab.discover').click();
      await expect(id(page, 'DISC-01.root')).toBeVisible();
      await id(page, 'tab.home').click();
      await expect(id(page, 'HOME-01.root')).toBeVisible();
      await expectPlaceKept(list, offset);

      // Going on from there works, and the new place is the one kept.
      const further = await wheelDown(page, 'HOME-01.list', 400);
      expect(further).toBeGreaterThan(offset);
      await id(page, 'tab.discover').click();
      await expect(id(page, 'DISC-01.root')).toBeVisible();
      await id(page, 'tab.home').click();
      await expectPlaceKept(list, further);

      // The re-tap of the tab goes to the top, and that is where the next return ends.
      await id(page, 'tab.home').click();
      await expect.poll(() => restingOffset(list)).toBe(0);
      await id(page, 'tab.discover').click();
      await expect(id(page, 'DISC-01.root')).toBeVisible();
      await id(page, 'tab.home').click();
      await expect(id(page, 'HOME-01.root')).toBeVisible();
      await page.waitForTimeout(700);
      expect(await restingOffset(list)).toBe(0);
    });

    test('DISC-02 keeps its place through a build page and back, with no anchor of its own', async ({ page }) => {
      // The list view on purpose: from 1280 DISC-02 opens as a 3-column grid by default (M2.3, FS-11 desktop).
      await page.goto(qaUrl('/app/discover/search?q=m&view=list'));
      const list = id(page, 'DISC-02.list');
      await expect(page.locator('[data-testid^="DISC-02.vehicle."]:visible').first()).toBeVisible();
      const { offset, card } = await wheelToCard(page, 'DISC-02.list', 'DISC-02.vehicle.', 1200);

      await id(page, card.testId).click();
      await expect(id(page, 'VEH-01.title')).toBeVisible();
      await id(page, 'VEH-01.header.back').click();
      await expect(id(page, 'DISC-02.root')).toBeVisible();
      await expectPlaceKept(list, offset);
      await expect(id(page, card.testId)).toBeInViewport();
    });
  });
}

test.describe('the rail at a large font (DQ-199)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('has no scroller of its own, and "Konto erstellen" is reached by scrolling the page', async ({ page }) => {
    await page.goto(qaUrl('/app/', { fontScale: 2 }));
    const rail = id(page, 'HOME-01.rail');
    await expect(rail).toBeVisible();
    const join = page.locator('[data-testid="HOME-01.rail.join"]');
    await expect(join).toBeAttached();
    await expect(page.locator('[data-testid^="HOME-01.rail.make."]:visible').first()).toBeVisible();

    const ownScroller = await rail.evaluate((root) => {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el.getAttribute('data-testid') ?? el.tagName;
      }
      return null;
    });
    expect(ownScroller, 'everything in the rail scrolls with the page').toBeNull();

    // At 200 % the rail is taller than the window: the button starts below the fold, and the one scroller brings it in.
    await expect(join).not.toBeInViewport();
    const list = id(page, 'HOME-01.list');
    const box = await list.boundingBox();
    if (!box) throw new Error('HOME-01.list is not on screen');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 800) / 2);
    const fullyInWindow = () => join.evaluate((el) => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= window.innerHeight);
    for (let step = 0; step < 20 && !(await fullyInWindow()); step++) {
      await page.mouse.wheel(0, 300);
      await restingOffset(list);
    }
    await expect(join).toBeInViewport();
    expect(await restingOffset(list), 'it was the page that moved').toBeGreaterThan(0);
    await join.click({ trial: true });
  });
});

test.describe('a screen that throws (BH-00)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** The fallback of a screen in the modal group: its own copy, a reload on web, and × that closes the group (RouteErrorBoundary). */
  async function expectModalFallback(page: Page): Promise<void> {
    await expect(id(page, 'shell.routeError')).toBeVisible();
    await expect(id(page, 'shell.routeError.title')).toHaveText('Diese Ansicht konnte nicht geladen werden');
    await expect(id(page, 'shell.routeError.body')).toHaveText('Versuch es noch einmal oder schließ die Ansicht.');
    await expect(id(page, 'shell.routeError.action')).toHaveAccessibleName('Neu laden');
    await expect(id(page, 'shell.routeError.header.back')).toHaveAccessibleName('Schließen');
  }

  test('in the wizard shows the error at its own address, and × closes the wizard to the screen below, or to Start', async ({ page, pageErrors }) => {
    const member = await createGarageMember('boundary');
    const draft = await buildVehicle(member.api, { draft: true, photos: 0 });
    await member.api.dispose();
    await useSession(page.context(), member.session);

    // An answer the review cannot render: `photos` is always a list. What matters is what the app does when a screen throws.
    const single = new RegExp(`/api/v1/vehicles/${draft.id}(\\?.*)?$`);
    const breakReview = () =>
      page.route(single, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = (await response.json()) as { data: Record<string, unknown> };
        return route.fulfill({ response, json: { ...body, data: { ...body.data, photos: null } } });
      });

    // A direct link: nothing lies below the modal, so × leads to Start, and says so by showing it.
    await breakReview();
    const review = `/app/add-vehicle/${draft.id}/review`;
    await page.goto(qaUrl(review));
    await expectModalFallback(page);
    expect(pathOf(page)).toBe(review);
    await expect(page.locator('[data-testid="HOME-01.root"]:visible')).toHaveCount(0);

    // SessionHost's turn has passed, and it stays.
    await page.waitForTimeout(500);
    expect(pathOf(page)).toBe(review);
    await expect(id(page, 'shell.routeError')).toBeVisible();

    await page.unroute(single);
    await id(page, 'shell.routeError.header.back').click();
    await expect.poll(() => pathOf(page)).toBe('/app/');
    await expect(id(page, 'HOME-01.root')).toBeVisible();
    await expect(page.locator('[data-testid="shell.routeError"]:visible')).toHaveCount(0);

    // Opened from the draft's page in the garage, × closes the whole wizard back to that page, not to one of its steps.
    await page.goto(qaUrl(`/app/garage/${draft.id}`));
    await expect(id(page, 'GAR-02.root')).toBeVisible();
    await breakReview();
    await id(page, 'GAR-02.visibilityNote').click();
    await expectModalFallback(page);
    expect(pathOf(page)).toBe(review);
    await page.unroute(single);
    await id(page, 'shell.routeError.header.back').click();
    await expect.poll(() => pathOf(page)).toBe(`/app/garage/${draft.id}`);
    await expect(id(page, 'GAR-02.root')).toBeVisible();
    await expect(page.locator('[data-testid="shell.routeError"]:visible')).toHaveCount(0);

    // The wizard answers normally again.
    await page.goto(qaUrl(`/app/add-vehicle/${draft.id}/vehicle`));
    await expect(id(page, 'GAR-03.make')).toBeVisible();

    // The throw itself reaches the console, as it should; nothing else may have.
    expect(pageErrors.filter((error) => !error.includes('TypeError'))).toEqual([]);
    pageErrors.length = 0;
  });
});
