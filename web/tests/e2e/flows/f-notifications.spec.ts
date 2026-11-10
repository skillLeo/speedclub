// HOME-02 Mitteilungen on the member web (M2.2, docs/reports/phase-2/m2.2-contract.md §2 and §5, m2.2-api-handover.md §2 and §4):
// a follow writes one new_follower row per Berlin day; the recipient sees it on HOME-02, the bell on Start gets its unread dot and
// count, the Start tab its dot; a second follower the same day joins the row ("@C und @B folgen dir jetzt") and makes it unread
// again; opening a row marks it read and opens what it is about; "Alle als gelesen markieren" clears every dot; a follower the
// recipient blocks leaves the row, and a row left without actors leaves the list and the count.
//
// Every test uses members of its own under E2E_DOMAIN (support/garage.mjs createGarageMember), so lukas.sc's demo history, which the
// visual matrix photographs, is never read or changed here. The rows come from FollowMember through the Notifier, synchronously;
// push is off locally (PUSH_ENABLED=false), so nothing leaves the machine. The browser's clock is fixed (qaNow), the server's is not:
// the day label of a new row is therefore not compared, only its text, its unread mark and where it leads.
import { readFileSync } from 'node:fs';
import type { Locator, Page, Response } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { createGarageMember, expectStatus } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';
import { expectText } from '../support/text.mjs';

type Member = Awaited<ReturnType<typeof createGarageMember>>;
type Notification = {
  id: string;
  type: string;
  group_key: string | null;
  actors: { username: string }[];
  actor_count: number;
  read_at: string | null;
};

/** The app's German copy from its locale files, so the spec follows the keys (the copy review edits the sentences). */
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
const open = (page: Page, path: string): Promise<Response | null> => page.goto(qaUrl(path, { theme: 'carbon', locale: 'de' }));
const isCall = (method: string, path: string) => (r: Response) => r.request().method() === method && new URL(r.url()).pathname === `/api/v1/${path}`;

async function follow(by: Member, username: string): Promise<void> {
  expectStatus(await by.api.post(`users/${username}/follow`), 200, `${by.username} follows ${username}`);
}

async function block(by: Member, username: string): Promise<void> {
  expectStatus(await by.api.post(`users/${username}/block`), 200, `${by.username} blocks ${username}`);
}

/** The member's list and unread count as the server has them now. */
async function inbox(member: Member): Promise<{ rows: Notification[]; unread: number }> {
  const rows = expectStatus(await member.api.get('notifications'), 200, 'GET notifications').data as Notification[];
  const unread = (expectStatus(await member.api.get('notifications/unread-count'), 200, 'GET notifications/unread-count').data as { notifications: number })
    .notifications;
  return { rows, unread };
}

/** The bell's name as Start gives it, with or without "N ungelesen". */
const bellName = (unread: number): string =>
  unread > 0 ? `${de('home', 'bell.label')}, ${de('home', 'bell.unread', { count: unread })}` : de('home', 'bell.label');

/** Start, read again from the server: the bell and the Start tab say whether something is unread. */
async function expectStartBadges(page: Page, unread: number): Promise<void> {
  const counted = page.waitForResponse((r) => isCall('GET', 'notifications/unread-count')(r));
  await open(page, '/app/');
  expect((await counted).status()).toBe(200);
  await expect(id(page, 'HOME-01.bell')).toHaveAccessibleName(bellName(unread));
  if (unread > 0) {
    await expect(id(page, 'tab.home.dot')).toBeVisible();
    await expect(id(page, 'tab.home')).toHaveAccessibleName(new RegExp(de('common', 'a11y.unreadNotifications')));
  } else {
    await expect(anyWithId(page, 'tab.home.dot')).toHaveCount(0);
  }
}

test.describe('F-notifications: HOME-02', () => {
  test('a new follower: the row, the bell dot and the Start badge; opening it reads it and opens PROF-02; a second follower the same day joins the row; Alle als gelesen clears the dots', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const recipient = await createGarageMember('ntfto');
    const first = await createGarageMember('ntffirst');
    const second = await createGarageMember('ntfsecond');
    await useSession(context, recipient.session);

    // Before: nothing to read.
    await open(page, '/app/notifications');
    await expect(id(page, 'HOME-02.empty')).toBeVisible();
    await expect(id(page, 'HOME-02.empty.title')).toHaveText(de('home', 'notifications.emptyTitle'));
    await expect(anyWithId(page, 'HOME-02.readAll')).toHaveCount(0);
    await expectStartBadges(page, 0);

    // The first follow writes one unread new_follower row.
    await follow(first, recipient.username);
    let state = await inbox(recipient);
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0]!;
    expect(row).toMatchObject({ type: 'new_follower', actor_count: 1, read_at: null });
    expect(row.actors.map((a) => a.username)).toEqual([first.username]);
    expect(row.group_key).toMatch(/^new_follower:\d{4}-\d{2}-\d{2}$/);
    expect(state.unread).toBe(1);

    // Start: the bell's dot and count, the Start tab's dot; the bell opens HOME-02.
    await expectStartBadges(page, 1);
    await id(page, 'HOME-01.bell').click();
    await expect(id(page, 'HOME-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe('/app/notifications');
    await expectText(id(page, `HOME-02.row.${row.id}.text`), de('home', 'notifications.text.newFollower', { actor: `@${first.username}` }));
    await expect(id(page, `HOME-02.row.${row.id}.unread`)).toBeVisible();
    await expect(id(page, 'HOME-02.readAll')).toBeEnabled();

    // Opening the row marks it read and opens the follower's PROF-02.
    const marked = page.waitForResponse(isCall('PATCH', `notifications/${row.id}`));
    await id(page, `HOME-02.row.${row.id}.body`).click();
    expect((await marked).status()).toBe(200);
    await expect(id(page, 'PROF-02.root')).toBeVisible();
    await expect.poll(() => pathOf(page)).toBe(`/app/u/${first.username}`);
    state = await inbox(recipient);
    expect(state.rows[0]!.read_at).not.toBeNull();
    expect(state.unread).toBe(0);
    await page.goBack();
    await expect(id(page, `HOME-02.row.${row.id}`)).toBeVisible();
    await expect(anyWithId(page, `HOME-02.row.${row.id}.unread`)).toHaveCount(0);
    await expect(id(page, 'HOME-02.readAll')).toBeDisabled();

    // A second follower the same Berlin day joins the same row, newest first, and makes it unread again.
    await follow(second, recipient.username);
    state = await inbox(recipient);
    expect(state.rows, 'still one row for the day').toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ id: row.id, group_key: row.group_key, actor_count: 2, read_at: null });
    expect(state.rows[0]!.actors.map((a) => a.username)).toEqual([second.username, first.username]);
    expect(state.unread).toBe(1);
    await page.reload();
    await expectText(
      id(page, `HOME-02.row.${row.id}.text`),
      de('home', 'notifications.text.newFollowerTwo', { actor: `@${second.username}`, other: `@${first.username}` }),
    );
    await expect(id(page, `HOME-02.row.${row.id}.unread`)).toBeVisible();
    await expect(page.locator('[data-testid^="HOME-02.row."][data-testid$=".body"]:visible')).toHaveCount(1);

    // "Alle als gelesen markieren": the mark goes, the button turns off, and Start has no dot left.
    const readAll = page.waitForResponse(isCall('POST', 'notifications/read-all'));
    await id(page, 'HOME-02.readAll').click();
    expect((await readAll).status()).toBe(204);
    await expect(anyWithId(page, `HOME-02.row.${row.id}.unread`)).toHaveCount(0);
    await expect(id(page, 'HOME-02.readAll')).toBeDisabled();
    state = await inbox(recipient);
    expect(state.unread).toBe(0);
    expect(state.rows.every((r) => r.read_at !== null)).toBe(true);
    await expectStartBadges(page, 0);

    // A row of several followers opens the own Follower list.
    await open(page, '/app/notifications');
    await id(page, `HOME-02.row.${row.id}.body`).click();
    await expect(id(page, 'PROF-04.root')).toBeVisible();
    await expect.poll(() => `${pathOf(page)}?tab=${new URL(page.url()).searchParams.get('tab')}`).toBe('/app/profile/connections?tab=followers');
  });

  test('a follower the recipient blocks leaves the row; a row left without actors leaves the list and the count', async ({ page, context }) => {
    test.setTimeout(150_000);
    const recipient = await createGarageMember('ntfblock');
    const kept = await createGarageMember('ntfkept');
    const blocked = await createGarageMember('ntfblocked');
    await follow(kept, recipient.username);
    await follow(blocked, recipient.username);
    await useSession(context, recipient.session);

    let state = await inbox(recipient);
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0]!;
    expect(row.actors.map((a) => a.username)).toEqual([blocked.username, kept.username]);
    await open(page, '/app/notifications');
    await expectText(
      id(page, `HOME-02.row.${row.id}.text`),
      de('home', 'notifications.text.newFollowerTwo', { actor: `@${blocked.username}`, other: `@${kept.username}` }),
    );

    // The block: the blocked member's name leaves the row at once, the other follower stays.
    await block(recipient, blocked.username);
    state = await inbox(recipient);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.actors.map((a) => a.username)).toEqual([kept.username]);
    expect(state.rows[0]!.actor_count).toBe(1);
    await page.reload();
    await expectText(id(page, `HOME-02.row.${row.id}.text`), de('home', 'notifications.text.newFollower', { actor: `@${kept.username}` }));
    await expect(page.locator('[data-testid="HOME-02.root"]:visible')).not.toContainText(blocked.username);

    // Blocking the last actor too: the row is gone from the list and from the count, and HOME-02 is empty.
    await block(recipient, kept.username);
    state = await inbox(recipient);
    expect(state.rows).toEqual([]);
    expect(state.unread).toBe(0);
    await page.reload();
    await expect(id(page, 'HOME-02.empty')).toBeVisible();
    await expect(anyWithId(page, `HOME-02.row.${row.id}`)).toHaveCount(0);
    await expectStartBadges(page, 0);
  });

  test('a follow by a member the recipient has blocked writes no row at all', async ({ page, context }) => {
    const recipient = await createGarageMember('ntfnone');
    const stranger = await createGarageMember('ntfstranger');
    await block(recipient, stranger.username);
    // A block hides both members from each other: the follow answers 404 member_unavailable (FollowController::store), and nothing
    // reaches the recipient.
    const answer = await stranger.api.post(`users/${recipient.username}/follow`);
    expect(answer.status, 'the blocked member cannot follow').toBe(404);
    expect(answer.body?.code).toBe('member_unavailable');
    expect(await inbox(recipient)).toEqual({ rows: [], unread: 0 });
    await useSession(context, recipient.session);
    await open(page, '/app/notifications');
    await expect(id(page, 'HOME-02.empty')).toBeVisible();
  });

  test('a guest gets the sign-in state on HOME-02', async ({ page }) => {
    await open(page, '/app/notifications');
    await expect(id(page, 'HOME-02.guest')).toBeVisible();
    await expect(id(page, 'HOME-02.guest.title')).toHaveText(de('home', 'notifications.guest.title'));
    await id(page, 'HOME-02.guest.action').click();
    await expect(id(page, 'AUTH-03.root')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/notifications');
  });
});
