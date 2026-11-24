// A5 Forum-Moderation (10 §7.3, 09 §10.2 SplitQueue, m5.8-contract §6; ADM-68/69), Chromium at 1280 like the other admin flows.
// A new member (account younger than 3 days: pre-moderation) opens two threads through the member API; an established member opens two
// published ones. The moderator opens the first pending thread in the pane and approves it with the key `a`, rejects the second with
// `r` and a reason the author reads; pins and locks a published thread, moves the other to Bremsen and merges it into the first; hides
// the approved thread with a statement of reasons (DSA remove_content) and bans its author from the forum (DSA restriction: the next
// thread answers 403 account_restricted). On ADM-69 the moderator creates a category and deletes it again (empty). The analyst sees the
// queue read-only and a direct staff-tool POST answers 403. None of these is a four-eyes action (06 §2). Runs on Chromium only.
import type { Page } from '@playwright/test';
import { admin, confirmPasswordDirectly, DESKTOP, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { ageTestMember } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named, type Member } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type Thread = { id: string; title: string; status: string; opening_post_id: string; is_pinned: boolean; is_locked: boolean; category: { slug: string }; review_reason?: string | null };

async function openThread(member: Member, title: string, category: string): Promise<Thread> {
  return expectStatus(await member.api.post('forum/threads', { title, category, body: 'Welche **Federn** fahrt ihr im Alltag? Bitte mit Gutachten.', tags: ['a5'] }), 201, `POST forum/threads ${title}`)
    .data as Thread;
}

async function threadOf(member: Member, threadId: string): Promise<Thread> {
  return expectStatus(await member.api.get(`forum/threads/${threadId}`), 200, `GET forum/threads/${threadId}`).data as Thread;
}

/** The queue with one item open in the pane (`?item=` a post, `?thread=` a thread), so other runs' rows never shift it. */
async function openPane(page: Page, params: Record<string, string>): Promise<void> {
  await page.goto(`/admin/forum?${new URLSearchParams(params).toString()}`);
  await expect(id(page, 'ADM-68.pane.thread')).toBeVisible();
}

test.describe('A5 Forum-Moderation', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('a (approve) → r (reject) → pin, lock, move, merge → hide + forum ban → categories → analyst read-only', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [newbie, veteran] = await members('a5forumnew', 'a5forumvet');
    await named(newbie, 'Mia A5', 'Leipzig');
    await named(veteran, 'Jonas A5', 'Hamburg');
    await ageTestMember(veteran.email, 15);
    const prefix = `A5 ${newbie.username.slice(-5)}`;
    const pending1 = await openThread(newbie, `${prefix} Federn für den Touring`, 'fahrwerk');
    const pending2 = await openThread(newbie, `${prefix} Spurplatten eintragen lassen`, 'fahrwerk');
    expect(pending1.status, 'a new account posts into pre-moderation').toBe('pending');
    expect(pending2.status).toBe('pending');
    const target = await openThread(veteran, `${prefix} Gewindefahrwerk einstellen`, 'fahrwerk');
    const duplicate = await openThread(veteran, `${prefix} Gewinde richtig einstellen`, 'fahrwerk');
    expect(target.status).toBe('published');

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'moderator');
    await realClock(page);
    await confirmPasswordDirectly(context);

    // 1. Vormoderation: the pane shows the waiting thread; `a` approves it.
    await openPane(page, { item: pending1.opening_post_id });
    await expect(id(page, 'ADM-68.pane.title')).toHaveText(pending1.title);
    await expect(id(page, 'ADM-68.pane.decide')).toContainText(admin('forum', 'decide.thread', { username: newbie.username }));
    await page.locator('body').press('a');
    await expect(toast(page, admin('forum', 'flash.approved'))).toBeVisible();
    await expect.poll(async () => (await threadOf(veteran, pending1.id)).status).toBe('published');

    // 2. `r` asks for the reason the author reads.
    const reason = 'Bitte stell die Frage im bestehenden Thema zu Spurplatten.';
    await openPane(page, { item: pending2.opening_post_id });
    await page.locator('body').press('r');
    await expect(id(page, 'ADM-68.reject-dialog')).toBeVisible();
    await id(page, 'ADM-68.reject-dialog.reason').fill(reason);
    await id(page, 'ADM-68.reject-dialog.confirm').click();
    await expect(toast(page, admin('forum', 'flash.rejected'))).toBeVisible();
    const rejected = await threadOf(newbie, pending2.id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.review_reason).toBe(reason);

    // 3. Staff tools on a published thread: pin and lock without a dialog.
    await openPane(page, { tab: 'threads', thread: target.id });
    await id(page, 'ADM-68.pane.tools.pin').click();
    await expect(toast(page, admin('forum', 'flash.pinned'))).toBeVisible();
    await id(page, 'ADM-68.pane.tools.lock').click();
    await expect(toast(page, admin('forum', 'flash.locked'))).toBeVisible();
    const tooled = await threadOf(veteran, target.id);
    expect(tooled.is_pinned).toBe(true);
    expect(tooled.is_locked).toBe(true);

    // 4. Move the duplicate to Bremsen, then merge it into the target (pasted id).
    await openPane(page, { tab: 'threads', thread: duplicate.id });
    await id(page, 'ADM-68.pane.tools.more').click();
    await page.getByRole('menuitem', { name: admin('forum', 'tools.move') }).click();
    const tool = id(page, 'ADM-68.pane.tool-dialog');
    await expect(tool).toBeVisible();
    await tool.getByRole('combobox').fill('Bremsen');
    await page.getByRole('option', { name: /› Bremsen$/ }).first().click();
    await id(page, 'ADM-68.pane.tool-dialog.confirm').click();
    await expect(toast(page, admin('forum', 'flash.moved'))).toBeVisible();
    expect((await threadOf(veteran, duplicate.id)).category.slug).not.toBe('fahrwerk');

    await id(page, 'ADM-68.pane.tools.more').click();
    await page.getByRole('menuitem', { name: admin('forum', 'tools.merge') }).click();
    await expect(tool).toBeVisible();
    await id(page, 'ADM-68.pane.tool-dialog.paste').fill(`https://example.test/app/forum/${target.id}`);
    await id(page, 'ADM-68.pane.tool-dialog.confirm').click();
    await expect(toast(page, admin('forum', 'flash.merged'))).toBeVisible();
    await expect(id(page, 'ADM-68.pane.status')).toHaveText(admin('forum', 'status.thread.merged'));
    expect((await threadOf(veteran, duplicate.id)).status).toBe('merged');

    // 5. Hide the approved thread (statement of reasons), then ban its author from the forum.
    await openPane(page, { tab: 'threads', thread: pending1.id });
    await id(page, 'ADM-68.pane.post.menu').first().click();
    await page.getByRole('menuitem', { name: admin('forum', 'post.hide') }).click();
    const hide = id(page, 'ADM-68.pane.hide-dialog');
    await expect(hide).toBeVisible();
    await id(page, 'ADM-68.pane.hide-dialog.statement.facts').fill('Der Beitrag wirbt für einen eigenen Verkauf von Federn.');
    await id(page, 'ADM-68.pane.hide-dialog.statement.ground').fill('Keine Werbung und kein Spam');
    await id(page, 'ADM-68.pane.hide-dialog.confirm').click();
    await expect(toast(page, admin('forum', 'flash.hidden'))).toBeVisible();
    expect((await threadOf(newbie, pending1.id)).status).toBe('removed');

    await id(page, 'ADM-68.pane.ban').click();
    await expect(id(page, 'ADM-68.pane.ban-dialog')).toBeVisible();
    await id(page, 'ADM-68.pane.ban-dialog.statement.facts').fill('Du hast im Forum wiederholt für eigene Verkäufe geworben.');
    await id(page, 'ADM-68.pane.ban-dialog.statement.ground').fill('Keine Werbung und kein Spam');
    await id(page, 'ADM-68.pane.ban-dialog.confirm').click();
    await expect(toast(page, admin('forum', 'flash.banned'))).toBeVisible();
    await expect(id(page, 'ADM-68.pane.author.restricted')).toBeVisible();
    const refused = await newbie.api.post('forum/threads', { title: `${prefix} Noch eine Frage`, category: 'fahrwerk', body: 'Darf ich noch etwas fragen?', tags: [] });
    expect(refused.status).toBe(403);
    expect((refused.body as { code?: string }).code).toBe('account_restricted');

    // 6. ADM-69: create a category and delete it again while it is empty.
    const slug = `a5-${newbie.username.slice(-5).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    await page.goto('/admin/forum/categories');
    await expect(id(page, 'ADM-69.table')).toBeVisible();
    await id(page, 'ADM-69.new').click();
    await id(page, 'ADM-69.name-de').fill(`A5 Prüfkategorie ${slug}`);
    await id(page, 'ADM-69.name-en').fill(`A5 test category ${slug}`);
    await id(page, 'ADM-69.slug').fill(slug);
    await id(page, 'ADM-69.save').click();
    await expect(toast(page, admin('forum', 'flash.category_created'))).toBeVisible();
    const created = page.locator('[data-testid="ADM-69.row"]').filter({ hasText: slug });
    await expect(created).toHaveCount(1);
    await created.getByTestId('ADM-69.row.menu').click();
    await page.getByRole('menuitem', { name: admin('forum', 'categories.delete') }).click();
    await id(page, 'ADM-69.delete-dialog.confirm').click();
    await expect(toast(page, admin('forum', 'flash.category_deleted'))).toBeVisible();
    await expect(page.locator('[data-testid="ADM-69.row"]').filter({ hasText: slug })).toHaveCount(0);

    // 7. The analyst: read-only pane, a direct staff-tool POST refused.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await openPane(analystPage, { tab: 'threads', thread: target.id });
      await expect(id(analystPage, 'ADM-68.view-only')).toBeVisible();
      await expect(id(analystPage, 'ADM-68.pane.tools')).toHaveCount(0);
      await expect(id(analystPage, 'ADM-68.pane.ban')).toHaveCount(0);
      const direct = await analyst.request.post(`/admin/forum/threads/${target.id}/unpin`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst) }, data: {} });
      expect(direct.status()).toBe(403);
    } finally {
      await analyst.close();
    }
    expect((await threadOf(veteran, target.id)).is_pinned).toBe(true);
  });
});
