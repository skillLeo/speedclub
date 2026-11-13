// F11 Social 2.0 (09 §8.5–§8.6, §14.5; M4.11): the owner posts a build update with an @mention from UPD-01, a member who follows
// only the build (not the person) reacts, the owner sees the reactions privately on VEH-05 (who and how, never a public count),
// nobody else gets a count, and the follower finds the post in Home → "Folge ich". Runs at 390 × carbon × de like the other flows.
import { expect, test } from '../support/fixtures';
import { browserOf, de, id, isCall, members, open } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

type Update = { id: string; note: string | null; mentions: { username: string }[]; my_reaction: string | null; reaction_summary?: unknown };
type FeedPage = { data: { type: string; update?: { id: string } | null }[] };

test.describe('F11 Social 2.0', () => {
  test('post with a mention → follower reacts → owner sees it privately → follower sees it in Folge ich', async ({ browser, pageErrors, blockedRequests }) => {
    test.setTimeout(180_000);
    const [owner, follower, mentioned] = await members('f11owner', 'f11follower', 'f11mentioned');
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    // The mentioned member follows the owner, so the owner may mention them (mentions/suggest: followers and follows).
    expectStatus(await mentioned.api.post(`users/${owner.username}/follow`), 200, 'follow owner');
    // The follower follows the build only (09 §8.6), not its owner.
    expectStatus(await follower.api.put(`vehicles/${vehicle.id}/follow`), 200, 'follow build');

    // 1. The owner posts from UPD-01 and mentions through the @ autocomplete.
    const own = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [] });
    let updateId = '';
    try {
      await open(own.page, `/app/post-update?vehicleId=${vehicle.id}`);
      await expect(id(own.page, 'UPD-01.root')).toBeVisible();
      const field = id(own.page, 'UPD-01.text');
      await field.click();
      await field.pressSequentially(`Bremsen neu entlüftet, danke @${mentioned.username.slice(0, 4)}`);
      const suggestion = id(own.page, `UPD-01.mention.${mentioned.username}`);
      await expect(suggestion).toBeVisible();
      await suggestion.click();
      await expect(field).toHaveValue(`Bremsen neu entlüftet, danke @${mentioned.username} `);
      await field.pressSequentially('für die Hilfe.');

      const posted = own.page.waitForResponse(isCall('POST', 'build-updates'));
      await expect(id(own.page, 'UPD-01.cta.primary')).toHaveText(de('vehicle', 'composer.post'));
      await id(own.page, 'UPD-01.cta.primary').click();
      const answer = await posted;
      expect(answer.status()).toBe(201);
      const update = ((await answer.json()) as { data: Update }).data;
      updateId = update.id;
      expect(update.mentions.map((member) => member.username)).toEqual([mentioned.username]);
      expect(update.note).toContain(`@${mentioned.username}`);
    } finally {
      await own.context.close();
    }

    // 2. The follower reacts. Their answer carries only their own reaction, never a count.
    const reacted = expectStatus(await follower.api.put(`build-updates/${updateId}/reactions`, { reaction: 'low' }), 200, 'react').data as {
      my_reaction: string;
    };
    expect(reacted.my_reaction).toBe('low');
    const seen = expectStatus(await follower.api.get(`build-updates/${updateId}`), 200, 'read update').data as Update;
    expect(seen.my_reaction).toBe('low');
    expect(seen).not.toHaveProperty('reaction_summary');

    // 3. The owner sees who reacted and how, privately, on VEH-05.
    const ownAgain = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(ownAgain.page, `/app/v/${vehicle.slug}/updates/${updateId}`);
      await expect(id(ownAgain.page, 'VEH-05.reactions.hint')).toHaveText(de('vehicle', 'reactions.ownerHint'));
      await expect(id(ownAgain.page, 'VEH-05.reactions.low')).toContainText('1');
      await expect(id(ownAgain.page, 'VEH-05.react.button')).toHaveCount(0);
      await expect(id(ownAgain.page, `VEH-05.note.mention.${mentioned.username}`)).toHaveText(`@${mentioned.username}`);
      await id(ownAgain.page, 'VEH-05.reactions.showAll').click();
      await expect(id(ownAgain.page, 'VEH-05.reactions.sheet.row.0')).toContainText(de('vehicle', 'reactions.low'));
    } finally {
      await ownAgain.context.close();
    }

    // 4. The follower finds the post in Home → Folge ich, with their reaction and no count.
    const fan = await browserOf(browser, follower, { pageErrors, blockedRequests, expected: [] });
    try {
      const feed = fan.page.waitForResponse((r) => r.url().includes('/api/v1/feed') && r.url().includes('tab=following') && r.status() === 200);
      await open(fan.page, '/app/?tab=following');
      const page1 = (await (await feed).json()) as FeedPage;
      expect(page1.data.some((item) => item.update?.id === updateId), 'the followed build’s post is in Folge ich').toBe(true);
      await expect(id(fan.page, `HOME-01.stream.update.${updateId}`)).toBeVisible();
      await expect(id(fan.page, `HOME-01.stream.update.${updateId}`)).not.toContainText(/\b\d+ Reaktion/);
    } finally {
      await fan.context.close();
    }
  });
});
