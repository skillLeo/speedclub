// F17 Forum (docs/10_CLIENT_ROUND_1.md §7, m5.8-contract §4, ADR-506; M5.8 app): on the member web a member browses Entdecken › Forum,
// finds a thread through the forum's own search, opens it (FOR-03), votes "Hilfreich" on a reply (the count is visible, in the forum
// only), replies through the composer at the bottom, subscribes with the bell and reports another reply through the DSA pipeline
// (target `forum_post`); the thread's author then marks that reply as the solution and the thread reads "Gelöst" in the list.
// The thread and the first reply are written through the API by two other members, all three aged past the pre-moderation window
// (3 days, contract §2), so nothing waits in the admin queue. Runs at 390 × carbon × de like the other flows; needs the M5.8 server.
import { expect, test } from '../support/fixtures';
import { ageTestMember } from '../support/backend.mjs';
import { browserOf, de, id, isCall, members, named, open, row } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type ThreadBody = { id: string; status: string; is_solved: boolean; replies_count: number; viewer: { subscribed: boolean } };
type PostBody = { id: string; helpful_count: number; status: string };

test.describe('F17 Forum', () => {
  test('browse → open thread → vote → reply → subscribe → report → author marks the solution', async ({ browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [author, helper, reader] = await members('f17author', 'f17helper', 'f17reader');
    await named(author, 'Jonas F17', 'Leipzig');
    await named(helper, 'Mira F17', 'Dresden');
    await named(reader, 'Timo F17', 'Halle');
    for (const member of [author, helper, reader]) await ageTestMember(member.email, 15);
    const title = `F17 Welche Federn für den E46 Touring ${author.username.slice(-4)}?`;

    // 1. The thread (author) and a first reply (helper), through the API.
    const created = expectStatus(
      await author.api.post('forum/threads', { title, category: 'fahrwerk', body: 'Ich suche Federn mit Gutachten für den **Touring** mit AHK.', tags: ['fahrwerk', 'e46'] }),
      201,
      'POST forum/threads',
    ).data as ThreadBody;
    expect(created.status, 'an aged, verified account posts without pre-moderation').toBe('published');
    const answer = expectStatus(
      await helper.api.post(`forum/threads/${created.id}/posts`, { body: 'Die H&R mit 30 mm passen, lass sie danach eintragen.' }),
      201,
      'POST posts',
    ).data as PostBody;

    // 2. FOR-01: Entdecken › Forum, the forum's own search finds it; the row opens FOR-03.
    const own = await browserOf(browser, reader, { pageErrors, blockedRequests, expected: [] });
    try {
      const { page } = own;
      await open(page, '/app/forum');
      await expect(id(page, 'FOR-01.search')).toBeVisible();
      const searched = page.waitForResponse(isCall('GET', 'search/threads'));
      await id(page, 'FOR-01.search').fill(title.slice(0, 40));
      expect((await searched).status()).toBe(200);
      await id(page, `FOR-01.thread.${created.id}`).click();
      await expect(id(page, 'FOR-03.title')).toHaveText(title);
      await expect(id(page, 'FOR-03.body')).toContainText('Touring');

      // 3. "Hilfreich" on the helper's reply: the count shows at once and the server agrees.
      const voted = page.waitForResponse(isCall('PUT', `forum/posts/${answer.id}/vote`));
      await id(page, `FOR-03.post.${answer.id}.helpful`).click();
      await expect(id(page, `FOR-03.post.${answer.id}.helpful.count`)).toHaveText('1');
      expect((await voted).status()).toBe(200);

      // 4. A reply to the helper's reply through the composer (it joins the helper's reply, one level in).
      await id(page, `FOR-03.post.${answer.id}.reply`).click();
      await expect(id(page, 'FOR-03.replyTo')).toContainText(`@${helper.username}`);
      await id(page, 'FOR-03.composer.input').fill('Danke, genau die hatte ich im Blick.');
      const replied = page.waitForResponse(isCall('POST', `forum/threads/${created.id}/posts`));
      await id(page, 'FOR-03.composer.send').click();
      expect((await replied).status()).toBe(201);
      await expect(id(page, `FOR-03.post.${answer.id}.answers`)).toContainText('Danke, genau die hatte ich im Blick.');

      // 5. The bell subscribes.
      const subscribed = page.waitForResponse(isCall('PUT', `forum/threads/${created.id}/subscription`));
      await page.getByRole('button', { name: de('forum', 'thread.subscribe') }).click();
      expect((await subscribed).status()).toBe(200);
      await expect(page.getByRole('button', { name: de('forum', 'thread.unsubscribe') })).toBeVisible();

      // 6. Report the helper's reply (DSA pipeline, target forum_post).
      await id(page, `FOR-03.post.${answer.id}.more`).click();
      await row(page, 'FOR-03.postSheet.report').click();
      await row(page, 'FOR-03.report.reason.spam').click();
      const reported = page.waitForResponse(isCall('POST', 'reports'));
      await id(page, 'FOR-03.report.send').click();
      const report = await reported;
      expect(report.status()).toBe(201);
      expect(JSON.parse(report.request().postData() ?? '{}')).toMatchObject({ target_type: 'forum_post', target_id: answer.id, reason: 'spam' });
    } finally {
      await own.context.close();
    }
    const after = expectStatus(await reader.api.get(`forum/threads/${created.id}`), 200, 'GET thread').data as ThreadBody;
    expect(after.viewer.subscribed).toBe(true);
    expect(after.replies_count).toBe(2);

    // 7. The author marks the helper's reply as the solution; the list reads "Gelöst".
    const writer = await browserOf(browser, author, { pageErrors, blockedRequests, expected: [] });
    try {
      const { page } = writer;
      await open(page, `/app/forum/${created.id}`);
      const marked = page.waitForResponse(isCall('PUT', `forum/threads/${created.id}/solution`));
      await id(page, `FOR-03.post.${answer.id}.markSolution`).click();
      expect((await marked).status()).toBe(200);
      await expect(id(page, `FOR-03.post.${answer.id}.solution`)).toHaveText(de('forum', 'row.solved'));
      await expect(id(page, 'FOR-03.solutionBlock')).toBeVisible();
      await open(page, '/app/forum?sort=solved');
      await expect(id(page, `FOR-01.thread.${created.id}.solved`)).toBeVisible();
    } finally {
      await writer.context.close();
    }
    const solved = expectStatus(await helper.api.get(`forum/threads/${created.id}`), 200, 'GET thread').data as ThreadBody;
    expect(solved.is_solved).toBe(true);
  });
});
