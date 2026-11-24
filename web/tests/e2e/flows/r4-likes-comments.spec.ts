// R4-2.2 likes and comments (docs/11_CLIENT_ROUND_4.md): a member who follows a build finds its owner's post in Start → Folge ich,
// likes it with one tap on the heart ("Gefällt mir", a private reaction: no count for them, ADR-413), opens "Kommentare" on the card
// and comments in the sheet; the owner sees "Gefällt mir 1" privately on VEH-05 and answers the comment there. Needs the
// `build_comments` flag on (local/staging): otherwise the comment part says why it is skipped.
import { expect, test } from '../support/fixtures';
import { browserOf, de, id, isCall, members, open } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

type Comment = { id: string; body: string; parent_id: string | null; replies: Comment[] };

test.describe('R4-2.2 likes and comments', () => {
  test('heart on the feed card → comment in the sheet → owner sees the like privately and replies on VEH-05', async ({ browser, page, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const config = await page.request.get('/api/v1/app-config');
    const flags = ((await config.json()) as { data: { flags: Record<string, boolean> } }).data.flags;
    test.skip(flags.build_reactions !== true, 'build_reactions is off on this host');

    const [owner, fan] = await members('r4likeowner', 'r4likefan');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    expectStatus(await fan.api.put(`vehicles/${vehicle.id}/follow`, {}), 200, 'follow build');
    const posted = expectStatus(await owner.api.post('build-updates', { vehicle_id: vehicle.id, text: 'Fahrwerk neu eingestellt, vorne 5 mm tiefer.' }), 201, 'post update')
      .data as { id: string };
    const updateId = posted.id;
    const card = `HOME-01.stream.update.${updateId}`;

    // 1. The fan likes the post with one tap on the card's heart; their answer knows only their own reaction.
    const fanSide = await browserOf(browser, fan, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(fanSide.page, '/app/?tab=following');
      const heart = id(fanSide.page, `${card}.reaction.button`);
      await expect(heart).toBeVisible({ timeout: 30_000 });
      await expect(heart).toHaveAttribute('aria-label', de('home', 'actions.like'));
      const liked = fanSide.page.waitForResponse(isCall('PUT', `build-updates/${updateId}/reactions`));
      await heart.click();
      const reaction = await liked;
      expect(reaction.status()).toBe(200);
      expect(reaction.request().postDataJSON()).toEqual({ reaction: 'like' });
      const state = (await reaction.json()) as { data: Record<string, unknown> };
      expect(state.data.my_reaction).toBe('like');
      expect(JSON.stringify(state)).not.toMatch(/"(total|count|reaction_summary)"/);
      await expect(heart).toHaveAttribute('aria-pressed', 'true');
      await expect(id(fanSide.page, card)).not.toContainText(/\b\d+\s*(Gefällt|Reaktion|Like)/);

      // 2. "Kommentare" opens the update's comments in a sheet; the comment shows at once and stays after the answer.
      if (flags.build_comments === true) {
        await id(fanSide.page, `${card}.comment`).click();
        const sheet = `HOME-01.comments.${updateId}`;
        await expect(id(fanSide.page, `${sheet}.empty`)).toHaveText(de('vehicle', 'comments.empty'), { timeout: 30_000 });
        const input = id(fanSide.page, `${sheet}.composer.input`);
        await input.click();
        await input.pressSequentially('Wie fährt er sich jetzt auf der Landstraße?');
        const sent = fanSide.page.waitForResponse(isCall('POST', `build-updates/${updateId}/comments`));
        await id(fanSide.page, `${sheet}.composer.send`).click();
        const answer = await sent;
        expect(answer.status()).toBe(201);
        expect(answer.request().headers()['idempotency-key']).toBeTruthy();
        const created = ((await answer.json()) as { data: Comment }).data;
        await expect(id(fanSide.page, `${sheet}.comment.${created.id}.body`)).toHaveText('Wie fährt er sich jetzt auf der Landstraße?');
        // The list carries no count either.
        const listed = expectStatus(await fan.api.get(`build-updates/${updateId}/comments`), 200, 'list comments');
        expect(JSON.stringify(listed)).not.toMatch(/"(total|count|comments_count)"/);
      }
    } finally {
      await fanSide.context.close();
    }

    // 3. The owner sees "Gefällt mir 1" privately on VEH-05 and replies to the comment there.
    const ownSide = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(ownSide.page, `/app/v/${vehicle.slug}/updates/${updateId}`);
      await expect(id(ownSide.page, 'VEH-05.reactions.like')).toContainText('1', { timeout: 30_000 });
      await expect(id(ownSide.page, 'VEH-05.react.button')).toHaveCount(0);
      if (flags.build_comments === true) {
        const comments = expectStatus(await owner.api.get(`build-updates/${updateId}/comments`), 200, 'owner reads comments').data as Comment[];
        const first = comments[0]!;
        await id(ownSide.page, `VEH-05.comments.comment.${first.id}.reply`).click();
        await expect(id(ownSide.page, 'VEH-05.comments.replyTo')).toContainText(`@${fan.username}`);
        const input = id(ownSide.page, 'VEH-05.comments.composer.input');
        await input.pressSequentially('Deutlich ruhiger, danke.');
        const replied = ownSide.page.waitForResponse(isCall('POST', `build-updates/${updateId}/comments`));
        await id(ownSide.page, 'VEH-05.comments.composer.send').click();
        const answer = await replied;
        expect(answer.status()).toBe(201);
        const reply = ((await answer.json()) as { data: Comment }).data;
        expect(reply.parent_id).toBe(first.id);
        await expect(id(ownSide.page, `VEH-05.comments.comment.${reply.id}.body`)).toHaveText('Deutlich ruhiger, danke.');
        // The owner may delete any comment on their update, after a question.
        await id(ownSide.page, `VEH-05.comments.comment.${reply.id}.delete`).click();
        const removed = ownSide.page.waitForResponse(isCall('DELETE', `comments/${reply.id}`));
        await id(ownSide.page, 'VEH-05.comments.delete.confirm').click();
        expect((await removed).status()).toBe(204);
        await expect(id(ownSide.page, `VEH-05.comments.comment.${reply.id}`)).toHaveCount(0);
      }
    } finally {
      await ownSide.context.close();
    }
  });
});
