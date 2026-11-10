// F5, the social part (M2.1, docs/reports/phase-2/m2.1-contract.md §8 and m2.1-api-handover.md): PROF-02 Folgen optimistic and
// persisted, PROF-04 search and "Entfernen", a guest's Folgen through the auth sheet, a block from PROF-02 that hides both members
// from each other everywhere (profile, search, Home, third-party follow lists, the Blade pages) until SET-08 frees it again without
// bringing the follows back, saves on VEH-01 and PROF-05 with Rückgängig, and the /u redirect of a signed-in browser.
// Messaging joins this flow in M2.4.
//
// Every test that changes a follow, block or save uses members of its own under E2E_DOMAIN (support/garage.mjs createGarageMember);
// the demo members the visual matrix photographs are only read. The global teardown deletes the test members, and with them their
// follows, blocks, saves and vehicles (foreign keys cascade).
//
// The block dialog and the "Entfernen" confirm open on a tap, which the visual matrix cannot hold open: this spec saves one picture
// of each at 390 carbon de under docs/reports/visual/phase-2/flows/ for design QA (Chromium) and attaches it to the report.
import { mkdirSync, readFileSync } from 'node:fs';
import type { Browser, BrowserContext, Locator, Page, Response, TestInfo } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { createMember, E2E_DOMAIN, resetAuthLimits, setWhoCanMessage } from '../support/backend.mjs';
import { expect, test, watchPageErrors, type ExpectedFailure } from '../support/fixtures';
import { buildVehicle, createGarageMember, expectStatus, GARAGE_PASSWORD } from '../support/garage.mjs';
import { routeCsrfCookie } from '../support/csrf-limit.mjs';
import { BASE_URL, makeContextDeterministic, QA_LOCALES, QA_TIMEZONE, qaUrl } from '../support/qa.mjs';
import { readable } from '../support/text.mjs';

type Member = Awaited<ReturnType<typeof createGarageMember>>;
type Overview = { members: { count: number; items: { username: string }[] }; vehicles: { count: number; items: { id: string }[] } };

const FLOW_SHOTS = new URL('../../../../docs/reports/visual/phase-2/flows/', import.meta.url);

/**
 * The app's German copy, read from its locale files, so the spec follows the keys and not sentences of its own (copy review edits
 * the sentences). `de('profile', 'follow.follow')`, with i18next's {{name}} values and its _one/_other plural keys for `count`.
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
const apiPath = (path: string): RegExp => new RegExp(`/api/v1/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?.*)?$`);
const open = (page: Page, path: string): Promise<Response | null> => page.goto(qaUrl(path, { theme: 'carbon', locale: 'de' }));

/** The responses a hidden member costs: the profile and its lists answer 404 member_unavailable, the Blade pages their 404 state. */
function hiddenMember(username: string, slug?: string): ExpectedFailure[] {
  const failures: ExpectedFailure[] = [
    { status: 404, url: new RegExp(`/api/v1/public/users/${username.replace(/\./g, '\\.')}(/[a-z]+)?(\\?.*)?$`) },
    { status: 404, url: new RegExp(`/u/${username.replace(/\./g, '\\.')}(\\?.*)?$`) },
  ];
  if (slug) failures.push({ status: 404, url: new RegExp(`/v/${slug}(\\?.*)?$`) });
  return failures;
}

/** The number in front of a stat link of FS-8 ("4 Follower"), as shown. */
async function statOf(page: Page, testId: string): Promise<number> {
  const text = (await id(page, testId).innerText()).replace(/\s+/g, ' ');
  const match = /^(\d+)/.exec(text.trim());
  if (!match) throw new Error(`${testId} shows no number: "${text}"`);
  return Number(match[1]);
}

/**
 * The accessible name of a control starts with its visible text (WCAG 2.5.3, the M2.1 axe fix): "5 Gefolgt – Konten anzeigen, …".
 * Both sides are read as a reader sees them: no-break spaces and word joiners do not count.
 */
async function expectNameStartsWithText(locator: Locator): Promise<void> {
  const shown = readable((await locator.innerText()).replace(/\u00a0/g, ' '));
  const name = readable((await locator.getAttribute('aria-label'))?.replace(/\u00a0/g, ' '));
  expect(shown, `visible text of ${locator}`).not.toBe('');
  expect(name.startsWith(shown), `aria-label "${name}" starts with the visible text "${shown}"`).toBe(true);
}

/** What the server says about `username` to this member. */
async function relation(member: Member, username: string): Promise<{ is_following: boolean; follows_you: boolean; followers: number }> {
  const profile = expectStatus(await member.api.get(`public/users/${username}`), 200, `GET public/users/${username}`).data;
  return { is_following: profile.is_following, follows_you: profile.follows_you, followers: profile.stats.followers };
}

/** The usernames of a member's follow list as `viewer` gets them. */
async function listOf(viewer: Member, username: string, tab: 'followers' | 'following'): Promise<string[]> {
  const page = expectStatus(await viewer.api.get(`public/users/${username}/${tab}?per_page=50`), 200, `GET ${username}/${tab}`);
  return page.data.map((row: { username: string }) => row.username);
}

/** A real name and city, so the pictures of the overlays for design QA read like the app does with real members. */
async function named(member: Member, displayName: string, city: string): Promise<void> {
  expectStatus(await member.api.patch('me/profile', { display_name: displayName, city }), 200, `PATCH me/profile of ${member.username}`);
}

async function follow(by: Member, username: string): Promise<void> {
  expectStatus(await by.api.post(`users/${username}/follow`), 200, `${by.username} follows ${username}`);
}

/**
 * A second browser, signed in as another member (or a guest's, for `null`), set up like the fixture's own: fixed clock, no third parties, and its page errors
 * and blocked requests count for this test.
 */
async function browserOf(
  browser: Browser,
  member: Member | null,
  sinks: { pageErrors: string[]; blockedRequests: string[]; expected: ExpectedFailure[] },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    locale: QA_LOCALES.de,
    timezoneId: QA_TIMEZONE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await makeContextDeterministic(context, { onBlocked: (url: string) => sinks.blockedRequests.push(url) });
  await routeCsrfCookie(context);
  if (member) await useSession(context, member.session);
  const page = await context.newPage();
  watchPageErrors(page, sinks.pageErrors, sinks.expected);
  return { context, page };
}

/** A picture of an overlay for design QA, which the matrix cannot hold open (Chromium only, one file per overlay). */
async function overlayShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // No hover state on the picture (the scrolled list was wheeled with the pointer over a row).
  await page.mouse.move(0, 0);
  const body = await page.screenshot({ animations: 'disabled' });
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (testInfo.project.name !== 'chromium') return;
  mkdirSync(FLOW_SHOTS, { recursive: true });
  await page.screenshot({ path: new URL(`${name}__390x844__carbon__de.png`, FLOW_SHOTS).pathname, animations: 'disabled' });
}

/** The answer of the next GET of exactly this API path. */
function answerOf(page: Page, path: string): Promise<Response> {
  return page.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/${path}` && r.request().method() === 'GET');
}

const isWrite = (method: string, path: string) => (r: Response) =>
  r.request().method() === method && new URL(r.url()).pathname === `/api/v1/${path}`;

test.describe('F5 social: PROF-02 Folgen', () => {
  test('Folgen turns at once, holds after a reload, and both counts follow; Folge ich undoes it', async ({ page, context }) => {
    test.setTimeout(120_000);
    const [viewer, member] = [await createGarageMember('f5follow'), await createGarageMember('f5followed')];
    await useSession(context, viewer.session);
    const handle = `@${member.username}`;

    await open(page, `/app/u/${member.username}`);
    const button = id(page, 'PROF-02.follow');
    await expect(button).toHaveText(de('profile', 'follow.follow'));
    await expect(button).toHaveAttribute('aria-label', de('profile', 'follow.followName', { name: handle }));
    expect(await statOf(page, 'PROF-02.stats.followers')).toBe(0);
    await expect(anyWithId(page, 'PROF-02.followsYou')).toHaveCount(0);

    // Optimistic: label and count turn while the server has not answered yet.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(apiPath(`users/${member.username}/follow`), async (route) => {
      await held;
      await route.continue();
    });
    const followed = page.waitForResponse(isWrite('POST', `users/${member.username}/follow`));
    await button.click();
    await expect(button).toHaveText(de('profile', 'follow.following'));
    await expect(button).toHaveAttribute('aria-label', de('profile', 'follow.followingName', { name: handle }));
    await expectNameStartsWithText(button);
    expect(await statOf(page, 'PROF-02.stats.followers')).toBe(1);
    release();
    expect((await followed).status()).toBe(200);
    await page.unroute(apiPath(`users/${member.username}/follow`));
    expect(await relation(viewer, member.username)).toEqual({ is_following: true, follows_you: false, followers: 1 });
    expect(await listOf(viewer, member.username, 'followers')).toEqual([viewer.username]);

    // Persisted: a reload reads it from the server, and the viewer's own Folge ich count has it too.
    await page.reload();
    await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.following'));
    expect(await statOf(page, 'PROF-02.stats.followers')).toBe(1);
    await open(page, '/app/profile');
    await expect(id(page, 'PROF-01.name')).toBeVisible();
    expect(await statOf(page, 'PROF-01.stats.following')).toBe(1);

    // The other member sees "Folgt dir" on the viewer's profile.
    expect((await relation(member, viewer.username)).follows_you).toBe(true);

    // Folge ich undoes it, also after a reload.
    await open(page, `/app/u/${member.username}`);
    const unfollowed = page.waitForResponse(isWrite('DELETE', `users/${member.username}/follow`));
    await id(page, 'PROF-02.follow').click();
    await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.follow'));
    expect(await statOf(page, 'PROF-02.stats.followers')).toBe(0);
    expect((await unfollowed).status()).toBe(200);
    await page.reload();
    await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.follow'));
    expect(await statOf(page, 'PROF-02.stats.followers')).toBe(0);
    expect(await relation(viewer, member.username)).toEqual({ is_following: false, follows_you: false, followers: 0 });
  });

  // DQ-265 (design QA round 1): PROF-02 follows the VEH-01 rule until messaging lands in M2.4. A member gets no Nachricht at all, so
  // no button that only opens the Nachrichten tab, whatever the other member takes; a guest keeps it, and it asks to sign in.
  test('Nachricht: a member writes while can_message allows it, sees it off with the reason when not; a guest gets it behind sign-in', async ({
    page,
    context,
    browser,
    pageErrors,
    blockedRequests,
  }) => {
    const [viewer, member] = [await createGarageMember('f5msg'), await createGarageMember('f5msgto')];
    await useSession(context, viewer.session);

    // Since M2.4 (DQ-265): Nachricht for members, enabled while can_message allows it.
    await open(page, `/app/u/${member.username}`);
    await expect(id(page, 'PROF-02.follow')).toBeVisible();
    await expect(id(page, 'PROF-02.message')).toHaveText(de('profile', 'member.message'));
    await expect(id(page, 'PROF-02.message')).toBeEnabled();
    await expect(anyWithId(page, 'PROF-02.messageHelper')).toHaveCount(0);

    // "Niemand": the button stays, disabled, with the reason under the actions.
    await setWhoCanMessage(member.email, 'nobody');
    await page.reload();
    await expect(id(page, 'PROF-02.follow')).toBeVisible();
    await expect(id(page, 'PROF-02.message')).toBeDisabled();
    await expect(id(page, 'PROF-02.messageHelper')).toBeVisible();

    const guest = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(guest.page, `/app/u/${member.username}`);
      await expect(id(guest.page, 'PROF-02.message')).toHaveText(de('profile', 'member.message'));
      await expect(anyWithId(guest.page, 'PROF-02.messageHelper')).toHaveCount(0);
      await id(guest.page, 'PROF-02.message').click();
      await expect(id(guest.page, 'shell.authRequired')).toBeVisible();
    } finally {
      await guest.context.close();
    }
  });

  test('your own name opens your profile; a name nobody has is "Profil nicht verfügbar"', async ({ page, context, expectFailedResponses }) => {
    const viewer = await createGarageMember('f5self');
    await useSession(context, viewer.session);
    await open(page, `/app/u/${viewer.username}`);
    await expect(id(page, 'PROF-01.name')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/profile');

    const nobody = `zz${viewer.username}x`;
    expectFailedResponses(hiddenMember(nobody));
    await open(page, `/app/u/${nobody}`);
    await expect(id(page, 'PROF-02.unavailable')).toBeVisible();
    await expect(id(page, 'PROF-02.unavailable')).toContainText(de('profile', 'member.unavailableTitle'));
    await expect(anyWithId(page, 'PROF-02.follow')).toHaveCount(0);
  });
});

test.describe('F5 social: a guest follows', () => {
  test('Folgen → auth sheet → sign-in → back on the profile, and the follow happened', async ({ page }) => {
    test.setTimeout(90_000);
    const [guest, member] = [await createGarageMember('f5guest'), await createGarageMember('f5guestto')];

    await open(page, `/app/u/${member.username}`);
    await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.follow'));
    // Nachricht asks to sign in as well, and says nothing about the member's settings to a guest.
    await expect(anyWithId(page, 'PROF-02.messageHelper')).toHaveCount(0);
    await id(page, 'PROF-02.follow').click();
    await expect(id(page, 'shell.authRequired')).toBeVisible();
    await id(page, 'shell.authRequired.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/u/${member.username}`);

    await resetAuthLimits([guest.email]);
    await id(page, 'AUTH-03.email').fill(guest.email);
    await id(page, 'AUTH-03.password').fill(GARAGE_PASSWORD);
    const followed = page.waitForResponse(isWrite('POST', `users/${member.username}/follow`));
    await id(page, 'AUTH-03.cta.primary').click();
    expect((await followed).status()).toBe(200);
    await expect.poll(() => pathOf(page)).toBe(`/app/u/${member.username}`);
    await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.following'));
    expect(await statOf(page, 'PROF-02.stats.followers')).toBe(1);
    expect((await relation(guest, member.username)).is_following).toBe(true);
  });
});

test.describe('F5 social: PROF-04 connections', () => {
  test('stats open the lists; search narrows them; Entfernen behind a confirm removes a follower for good', async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    const owner = await createGarageMember('f5conn');
    const first = await createGarageMember('f5connone');
    const second = await createGarageMember('f5conntwo');
    await named(first, 'Timo Brandt', 'Kassel');
    await named(second, 'Selin Aydın', 'Bremen');
    await follow(first, owner.username);
    await follow(second, owner.username);
    await follow(owner, first.username);
    await useSession(context, owner.session);

    // PROF-01 → own Follower tab, newest follow first.
    await open(page, '/app/profile');
    await id(page, 'PROF-01.stats.followers').click();
    await expect(id(page, 'PROF-04.root')).toBeVisible();
    await expect.poll(() => `${pathOf(page)}?tab=${new URL(page.url()).searchParams.get('tab')}`).toBe('/app/profile/connections?tab=followers');
    await expect(id(page, 'PROF-04.tabs.followers')).toHaveAttribute('aria-selected', 'true');
    await expect(id(page, 'PROF-04.tabs.followers')).toHaveText(de('profile', 'connections.followersCount', { count: 2, value: 2 }));
    await expect(id(page, 'PROF-04.tabs.following')).toHaveText(de('profile', 'connections.followingCount', { value: 1 }));
    const rows = page.locator('[data-testid^="PROF-04.row."][data-testid$=".body"]:visible');
    await expect(rows).toHaveCount(2);
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))).toEqual([
      `PROF-04.row.${second.username}.body`,
      `PROF-04.row.${first.username}.body`,
    ]);
    await expect(id(page, `PROF-04.row.${second.username}.remove`)).toHaveText(de('profile', 'connections.remove'));

    // Search: the debounced q goes to the server, which answers by name prefix.
    const searched = page.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === second.username && r.url().includes(`/public/users/${owner.username}/followers`));
    await id(page, 'PROF-04.search').fill(second.username);
    expect((await searched).status()).toBe(200);
    await expect(rows).toHaveCount(1);
    await expect(id(page, `PROF-04.row.${second.username}`)).toBeVisible();
    await id(page, 'PROF-04.search').fill('zzqxv');
    await expect(id(page, 'PROF-04.noResults')).toBeVisible();
    await expect(id(page, 'PROF-04.noResults')).toContainText(de('profile', 'connections.noResults', { q: 'zzqxv' }));
    await id(page, 'PROF-04.search').fill('');
    await expect(rows).toHaveCount(2);

    // Entfernen: the confirm first, Abbrechen keeps the row.
    await id(page, `PROF-04.row.${first.username}.remove`).click();
    await expect(id(page, 'PROF-04.removeDialog')).toBeVisible();
    await expect(id(page, 'PROF-04.removeDialog.title')).toHaveText(de('profile', 'connections.removeTitle', { name: `@${first.username}` }));
    await overlayShot(page, testInfo, 'PROF-04-removeDialog');
    await id(page, 'PROF-04.removeDialog.cancel').click();
    await expect(anyWithId(page, 'PROF-04.removeDialog')).toHaveCount(0);
    await expect(rows).toHaveCount(2);

    const removed = page.waitForResponse(isWrite('DELETE', `me/followers/${first.username}`));
    await id(page, `PROF-04.row.${first.username}.remove`).click();
    await id(page, 'PROF-04.removeDialog.confirm').click();
    expect((await removed).status()).toBe(200);
    await expect(id(page, 'PROF-04.toast')).toContainText(de('profile', 'connections.removed', { name: `@${first.username}` }));
    await expect(rows).toHaveCount(1);
    await expect(anyWithId(page, `PROF-04.row.${first.username}`)).toHaveCount(0);

    await page.reload();
    await expect(rows).toHaveCount(1);
    await expect(id(page, 'PROF-04.tabs.followers')).toHaveText(de('profile', 'connections.followersCount', { count: 1, value: 1 }));
    expect(await listOf(owner, owner.username, 'followers')).toEqual([second.username]);
    // Only that direction ended: the owner still follows the removed member.
    expect(await relation(owner, first.username)).toMatchObject({ is_following: true, follows_you: false });

    // Folge ich tab: the row has Folge ich, which unfollows.
    await id(page, 'PROF-04.tabs.following').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('following');
    await expect(id(page, `PROF-04.row.${first.username}.follow`)).toHaveText(de('profile', 'follow.following'));
  });

  test('another member\'s lists open from PROF-02 and follow from a row', async ({ page, context }) => {
    const viewer = await createGarageMember('f5other');
    const member = await createGarageMember('f5otherm');
    const followed = await createGarageMember('f5otherf');
    await follow(member, followed.username);
    await follow(member, viewer.username);
    await useSession(context, viewer.session);

    await open(page, `/app/u/${member.username}`);
    // Another member's count reads "Gefolgt" (DQ-266), never the own profile's "Folge ich", and its name starts with what it shows.
    const followingStat = id(page, 'PROF-02.stats.following');
    await expect(followingStat).toHaveText(new RegExp(`^2\\s${de('profile', 'stats.followingOther')}$`));
    await expect(followingStat).not.toContainText(de('profile', 'stats.following'));
    await expectNameStartsWithText(followingStat);
    await expectNameStartsWithText(id(page, 'PROF-02.stats.followers'));
    await followingStat.click();
    await expect(id(page, 'PROF-04.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(`/app/u/${member.username}/connections`);
    await expect(id(page, 'PROF-04.tabs.following')).toHaveAttribute('aria-selected', 'true');
    await expect(id(page, 'PROF-04.tabs.following')).toHaveText(de('profile', 'connections.followingCountOther', { value: 2 }));
    // The viewer's own row reads "… · Du" and has no button; the other one has Folgen.
    await expect(id(page, `PROF-04.row.${viewer.username}`)).toContainText(de('profile', 'connections.selfName', { name: `@${viewer.username}` }));
    await expect(anyWithId(page, `PROF-04.row.${viewer.username}.follow`)).toHaveCount(0);
    await expect(anyWithId(page, `PROF-04.row.${followed.username}.remove`)).toHaveCount(0);
    const answer = page.waitForResponse(isWrite('POST', `users/${followed.username}/follow`));
    await id(page, `PROF-04.row.${followed.username}.follow`).click();
    await expect(id(page, `PROF-04.row.${followed.username}.follow`)).toHaveText(de('profile', 'follow.following'));
    expect((await answer).status()).toBe(200);
    expect((await relation(viewer, followed.username)).is_following).toBe(true);
  });
});

test.describe('F5 social: PROF-04 scrolled (DQ-263)', () => {
  // The tabs and the search field are fixed chrome under the header; the list scrolls under the search band. So the hairline belongs
  // under the band and appears once the list has moved, and the header draws none of its own. A list long enough to scroll at 390:
  // 14 followed members, who need no session of their own (createMember, never signed in).
  test('the seam under the search band gets its hairline once the list scrolls, the header none', async ({ page, context }, testInfo) => {
    test.setTimeout(150_000);
    const owner = await createGarageMember('f5scroll');
    const tag = owner.username.slice(1);
    for (let n = 1; n <= 14; n++) {
      const username = `s${tag}${String(n).padStart(2, '0')}`.slice(0, 24);
      await createMember(`scroll.${tag}.${n}@${E2E_DOMAIN}`, username, GARAGE_PASSWORD);
      await follow(owner, username);
    }
    await useSession(context, owner.session);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/app/profile/connections?tab=following');
    const rows = page.locator('[data-testid^="PROF-04.row."][data-testid$=".body"]:visible');
    await expect(rows.first()).toBeVisible();
    const hairline = anyWithId(page, 'PROF-04.top.hairline');
    const opacity = () => hairline.evaluate((el) => Number(getComputedStyle(el).opacity));
    // The header's own line (Header hairline={false} with a band): none drawn, or drawn fully transparent.
    const headerLine = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="PROF-04.header.hairline"]');
        return el ? Number(getComputedStyle(el).opacity) : 0;
      });
    await expect.poll(opacity, { message: 'no seam line at the top of the list' }).toBe(0);
    expect(await headerLine(), 'the header draws no line of its own').toBe(0);

    const list = id(page, 'PROF-04.list');
    const box = await list.boundingBox();
    if (!box) throw new Error('PROF-04.list is not on screen');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(opacity, { message: 'the seam line once the list has moved' }).toBe(1);
    // It sits on the band's bottom edge, where the rows go under, and spans the pane.
    const band = await hairline.evaluate((el) => {
      const line = el.getBoundingClientRect();
      const search = document.querySelector('[data-testid="PROF-04.search"]')?.getBoundingClientRect();
      return { top: line.top, width: line.width, searchBottom: search?.bottom ?? null };
    });
    expect(band.searchBottom, 'the search field is on screen').not.toBeNull();
    expect(band.top, 'the line is below the search field').toBeGreaterThanOrEqual(band.searchBottom ?? 0);
    expect(band.width, 'the line spans the pane').toBe(390);
    expect(await headerLine(), 'and the header still draws none').toBe(0);
    await overlayShot(page, testInfo, 'PROF-04-scrolled');
  });
});

test.describe('F5 social: blocking', () => {
  test('a block from PROF-02 hides both members from each other everywhere; SET-08 frees it, and the follows stay gone', async ({
    page,
    context,
    browser,
    pageErrors,
    blockedRequests,
    expectFailedResponses,
  }, testInfo) => {
    test.setTimeout(240_000);
    const blocker = await createGarageMember('f5block');
    const blocked = await createGarageMember('f5blocked');
    const third = await createGarageMember('f5third');
    const vehicle = await buildVehicle(blocked.api, { photos: 1 });
    await named(blocked, 'Mara Keller', 'Leipzig');
    await follow(blocker, blocked.username);
    await follow(blocked, blocker.username);
    await follow(blocker, third.username);
    await follow(blocked, third.username);
    const expected = [...hiddenMember(blocked.username, vehicle.slug), ...hiddenMember(blocker.username)];
    expectFailedResponses(expected);
    await useSession(context, blocker.session);
    const other = await browserOf(browser, blocked, { pageErrors, blockedRequests, expected });

    try {
      // Before: found in the member search, and the row opens PROF-02 inside the app (M2.1, no longer the web page).
      await open(page, `/app/discover/search?q=${blocked.username}`);
      await id(page, 'DISC-02.tab.members').click();
      await id(page, `DISC-02.member.${blocked.username}.body`).click();
      await expect(id(page, 'PROF-02.root')).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe(`/app/u/${blocked.username}`);
      await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.following'));
      await expect(id(page, 'PROF-02.followsYou')).toHaveText(de('profile', 'member.followsYou'));
      expect(await listOf(blocker, third.username, 'followers')).toEqual(expect.arrayContaining([blocked.username]));
      expect((expectStatus(await blocker.api.get('home/new-builds'), 200, 'home/new-builds').data as { id: string }[]).map((v) => v.id)).toContain(vehicle.id);

      // The block: more → Blockieren → the dialog with its consequences → confirm → toast, and the page is left.
      await id(page, 'PROF-02.more').click();
      await expect(id(page, 'PROF-02.moreSheet')).toBeVisible();
      await id(page, 'PROF-02.moreSheet.block').click();
      await expect(id(page, 'PROF-02.blockDialog')).toBeVisible();
      await expect(id(page, 'PROF-02.blockDialog.title')).toHaveText(de('safety', 'block.title', { name: `@${blocked.username}` }));
      await expect(id(page, 'PROF-02.blockDialog.body')).toHaveText(de('safety', 'block.body', { name: `@${blocked.username}` }));
      await overlayShot(page, testInfo, 'PROF-02-blockDialog');
      const answer = page.waitForResponse(isWrite('POST', `users/${blocked.username}/block`));
      await id(page, 'PROF-02.blockDialog.confirm').click();
      expect((await answer).status()).toBe(200);
      await expect(id(page, 'PROF-02.blockDialog.toast')).toContainText(de('safety', 'block.done', { name: `@${blocked.username}` }));
      await expect(anyWithId(page, 'PROF-02.blockDialog')).toHaveCount(0);
      await expect.poll(() => pathOf(page)).not.toBe(`/app/u/${blocked.username}`);

      // Both ways: each one's profile is "Profil nicht verfügbar" for the other.
      await open(page, `/app/u/${blocked.username}`);
      await expect(id(page, 'PROF-02.unavailable')).toContainText(de('profile', 'member.unavailableTitle'));
      await open(other.page, `/app/u/${blocker.username}`);
      await expect(id(other.page, 'PROF-02.unavailable')).toContainText(de('profile', 'member.unavailableTitle'));
      // Nothing in the page tells the blocked member why.
      await expect(id(other.page, 'PROF-02.root')).not.toContainText(/blockiert/i);

      // Gone from the member search, both ways.
      const search = answerOf(page, 'search');
      await open(page, `/app/discover/search?q=${blocked.username}`);
      const overview = ((await (await search).json()) as { data: Overview }).data;
      expect(overview.members.items.map((m) => m.username)).not.toContain(blocked.username);
      expect(overview.vehicles.items.map((v) => v.id)).not.toContain(vehicle.id);
      await expect(id(page, 'DISC-02.root')).toBeVisible();
      await expect(anyWithId(page, `DISC-02.member.${blocked.username}`)).toHaveCount(0);
      const reverse = expectStatus(await blocked.api.get(`search?q=${blocker.username}`), 200, 'search as the blocked member').data as Overview;
      expect(reverse.members.items.map((m) => m.username)).not.toContain(blocker.username);

      // Gone from Home: Neue Builds of the blocker no longer carry the blocked member's build.
      expect((expectStatus(await blocker.api.get('home/new-builds'), 200, 'home/new-builds').data as { id: string }[]).map((v) => v.id)).not.toContain(vehicle.id);
      await open(page, '/app/');
      await expect(page.locator('[data-testid^="HOME-01.card."]:visible').first()).toBeVisible();
      await expect(page.locator(`[data-testid^="HOME-01.card.${vehicle.id}"]`)).toHaveCount(0);

      // Gone from a third member's lists, both ways; the count there stays and says nothing about who is hidden.
      await open(page, `/app/u/${third.username}/connections?tab=followers`);
      await expect(id(page, 'PROF-04.tabs.followers')).toHaveText(de('profile', 'connections.followersCount', { count: 2, value: 2 }));
      await expect(id(page, `PROF-04.row.${blocker.username}`)).toBeVisible();
      await expect(anyWithId(page, `PROF-04.row.${blocked.username}`)).toHaveCount(0);
      await open(other.page, `/app/u/${third.username}/connections?tab=followers`);
      await expect(id(other.page, 'PROF-04.tabs.followers')).toHaveText(de('profile', 'connections.followersCount', { count: 2, value: 2 }));
      await expect(anyWithId(other.page, `PROF-04.row.${blocker.username}`)).toHaveCount(0);
      await expect(id(other.page, `PROF-04.row.${blocked.username}`)).toBeVisible();

      // SET-01 → Privatsphäre › Blockierte Konten → Freigeben behind a confirm.
      await open(page, '/app/settings');
      await id(page, 'SET-01.blocked').click();
      await expect(id(page, 'SET-08.root')).toBeVisible();
      await expect.poll(() => pathOf(page)).toBe('/app/settings/privacy/blocked');
      // The row is the name as sent plus the block date (review #1): never the member's live profile, so no "Mara Keller".
      const blockedRow = id(page, `SET-08.row.${blocked.username}`);
      await expect(blockedRow).toContainText(`@${blocked.username}`);
      // The meta line keeps its words together with no-break spaces (keepValuesTogether), so a space of the copy matches any space.
      const since = de('settings', 'blocked.since', { date: '\u0000' })
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/ /g, '\\s')
        .replace('\u0000', '\\d{2}\\.\\d{2}\\.\\d{4}');
      await expect(blockedRow).toContainText(new RegExp(since));
      await expect(blockedRow).not.toContainText('Mara Keller');
      await id(page, `SET-08.row.${blocked.username}.unblock`).click();
      await expect(id(page, 'SET-08.dialog')).toBeVisible();
      await expect(id(page, 'SET-08.dialog.body')).toHaveText(de('settings', 'blocked.confirmBody', { name: `@${blocked.username}` }));
      const freed = page.waitForResponse(isWrite('DELETE', `users/${blocked.username}/block`));
      await id(page, 'SET-08.dialog.confirm').click();
      expect((await freed).status()).toBe(200);
      await expect(id(page, 'SET-08.toast')).toContainText(de('settings', 'blocked.done', { name: `@${blocked.username}` }));
      await expect(id(page, 'SET-08.empty')).toBeVisible();

      // Visible again both ways, and neither follow came back.
      await open(page, `/app/u/${blocked.username}`);
      await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.follow'));
      await expect(anyWithId(page, 'PROF-02.followsYou')).toHaveCount(0);
      expect(await statOf(page, 'PROF-02.stats.followers')).toBe(0);
      await open(other.page, `/app/u/${blocker.username}`);
      await expect(id(other.page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.follow'));
      expect(await relation(blocker, blocked.username)).toEqual({ is_following: false, follows_you: false, followers: 0 });
      expect(await relation(blocked, blocker.username)).toEqual({ is_following: false, follows_you: false, followers: 0 });
      // And back in the search, on Home and in the third member's list.
      await open(page, `/app/discover/search?q=${blocked.username}`);
      await id(page, 'DISC-02.tab.members').click();
      await expect(id(page, `DISC-02.member.${blocked.username}`)).toBeVisible();
      expect((expectStatus(await blocker.api.get('home/new-builds'), 200, 'home/new-builds').data as { id: string }[]).map((v) => v.id)).toContain(vehicle.id);
      await open(page, `/app/u/${third.username}/connections?tab=followers`);
      await expect(id(page, `PROF-04.row.${blocked.username}`)).toBeVisible();
    } finally {
      await other.context.close();
    }
  });
});

test.describe('F5 social: saved builds [SIG]', () => {
  test('save on VEH-01, find it on PROF-05, Rückgängig brings it back, unsave on VEH-01 empties the list', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(150_000);
    const saver = await createGarageMember('f5save');
    const owner = await createGarageMember('f5saveowner');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    await useSession(context, saver.session);

    await open(page, `/app/v/${vehicle.slug}`);
    await expect(id(page, 'VEH-01.title')).toBeVisible();
    const save = id(page, 'VEH-01.save');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await expect(save).toHaveAttribute('aria-label', de('vehicle', 'actions.save'));
    // The owner row follows from here too, for a member.
    await expect(id(page, 'VEH-01.ownerRow.follow')).toHaveText(de('profile', 'follow.follow'));

    let answer = page.waitForResponse(isWrite('POST', `vehicles/${vehicle.id}/save`));
    await save.click();
    expect((await answer).status()).toBe(200);
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(id(page, 'VEH-01.saveToast')).toHaveText(de('vehicle', 'save.saved'));

    // PROF-01 → Gespeichert → PROF-05 has the card.
    await open(page, '/app/profile');
    await id(page, 'PROF-01.saved').click();
    await expect(id(page, 'PROF-05.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/profile/saved');
    const card = id(page, `PROF-05.card.${vehicle.id}`);
    await expect(card).toBeVisible();
    await expect(page.locator('[data-testid^="PROF-05.card."][data-testid$=".remove"]:visible')).toHaveCount(1);

    // Remove: the card goes at once, Rückgängig puts it back on the server too.
    answer = page.waitForResponse(isWrite('DELETE', `vehicles/${vehicle.id}/save`));
    await id(page, `PROF-05.card.${vehicle.id}.remove`).click();
    await expect(anyWithId(page, `PROF-05.card.${vehicle.id}`)).toHaveCount(0);
    await expect(id(page, 'PROF-05.toast')).toBeVisible();
    await expect(id(page, 'PROF-05.toast.action')).toHaveText(de('common', 'actions.undo'));
    expect((await answer).status()).toBe(200);
    answer = page.waitForResponse(isWrite('POST', `vehicles/${vehicle.id}/save`));
    await id(page, 'PROF-05.toast.action').click();
    expect((await answer).status()).toBe(200);
    await expect(card).toBeVisible();
    await page.reload();
    await expect(id(page, `PROF-05.card.${vehicle.id}`)).toBeVisible();
    expect((expectStatus(await saver.api.get('me/saved'), 200, 'me/saved').data as { id: string }[]).map((v) => v.id)).toEqual([vehicle.id]);

    // Unsave on VEH-01: the list is empty after it.
    await open(page, `/app/v/${vehicle.slug}`);
    await expect(id(page, 'VEH-01.save')).toHaveAttribute('aria-pressed', 'true');
    answer = page.waitForResponse(isWrite('DELETE', `vehicles/${vehicle.id}/save`));
    await id(page, 'VEH-01.save').click();
    expect((await answer).status()).toBe(200);
    await expect(id(page, 'VEH-01.save')).toHaveAttribute('aria-pressed', 'false');
    await expect(id(page, 'VEH-01.saveToast')).toHaveText(de('vehicle', 'save.removed'));
    await open(page, '/app/profile/saved');
    await expect(id(page, 'PROF-05.empty')).toBeVisible();
    await expect(id(page, 'PROF-05.empty')).toContainText(de('profile', 'saved.emptyTitle'));

    // The owner never gets the action on the own build.
    const own = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(own.page, `/app/v/${vehicle.slug}`);
      await expect(id(own.page, 'VEH-01.title')).toBeVisible();
      await expect(anyWithId(own.page, 'VEH-01.save')).toHaveCount(0);
    } finally {
      await own.context.close();
    }
  });

  test('a guest\'s save asks to sign in', async ({ page }) => {
    const owner = await createGarageMember('f5saveguest');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    await open(page, `/app/v/${vehicle.slug}`);
    await id(page, 'VEH-01.save').click();
    await expect(id(page, 'shell.authRequired')).toBeVisible();
    await id(page, 'shell.authRequired.signIn').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/v/${vehicle.slug}`);
  });
});

test.describe('F5 social: /u on the web', () => {
  test('a signed-in browser goes from /u to PROF-02; ?view=public stays on the web page; a guest stays too', async ({ page, context }) => {
    const viewer = await createGarageMember('f5web');
    const member = await createGarageMember('f5webm');

    // A guest gets the web page, with next=/u/… on Registrieren and "In der App öffnen" back.
    let response = await page.goto(`/u/${member.username}`);
    expect(response?.status()).toBe(200);
    await expect(id(page, 'WEB-02.root')).toBeVisible();
    await expect(id(page, 'WEB-01.register')).toHaveAttribute('href', new RegExp(`/app/sign-up\\?next=%2Fu%2F${member.username.replace(/\./g, '\\.')}$`));

    await useSession(context, viewer.session);
    await page.goto(`/u/${member.username}?qaMotion=off`);
    await expect(id(page, 'PROF-02.root')).toBeVisible();
    expect(pathOf(page)).toBe(`/app/u/${member.username}`);
    expect(new URL(page.url()).searchParams.get('qaMotion')).toBe('off');
    await expect(id(page, 'PROF-02.follow')).toHaveText(de('profile', 'follow.follow'));

    response = await page.goto(`/u/${member.username}?view=public`);
    expect(response?.status()).toBe(200);
    expect(pathOf(page)).toBe(`/u/${member.username}`);
    await expect(id(page, 'WEB-02.root')).toBeVisible();
  });

  test('a blocked browser gets the 404 page on /u and /v, both ways, also with ?view=public', async ({ page, context, expectFailedResponses }) => {
    const blocker = await createGarageMember('f5webblock');
    const blocked = await createGarageMember('f5webblocked');
    const vehicle = await buildVehicle(blocked.api, { photos: 1 });
    const own = await buildVehicle(blocker.api, { photos: 1 });
    expectStatus(await blocker.api.post(`users/${blocked.username}/block`), 200, 'POST block');
    expectFailedResponses([...hiddenMember(blocked.username, vehicle.slug), ...hiddenMember(blocker.username, own.slug)]);

    // Guests are not affected.
    expect((await page.request.get(`/u/${blocked.username}`, { maxRedirects: 0 })).status()).toBe(200);

    await useSession(context, blocker.session);
    for (const path of [`/u/${blocked.username}?view=public`, `/v/${vehicle.slug}?view=public`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(id(page, 'WEB-STATE.root')).toHaveAttribute('data-state', path.startsWith('/u/') ? 'member_unavailable' : 'vehicle_unavailable');
      await expect(page.locator('body')).not.toContainText(blocked.username);
    }
    // Without ?view=public the browser is sent to PROF-02, which says the same.
    await page.goto(qaUrl(`/u/${blocked.username}`));
    await expect(id(page, 'PROF-02.unavailable')).toBeVisible();

    await context.clearCookies();
    await useSession(context, blocked.session);
    for (const path of [`/u/${blocker.username}?view=public`, `/v/${own.slug}?view=public`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(id(page, 'WEB-STATE.root')).toHaveAttribute('data-state', path.startsWith('/u/') ? 'member_unavailable' : 'vehicle_unavailable');
    }
  });
});
