// R5-5 "like and comment directly in the Home feed" (client round 5): a member who follows a builder finds the builder's car as a
// card in Start → Folge ich, likes the car with one tap on the card's heart (`PUT vehicles/{id}/reactions`, a private reaction: no
// count, ADR-413), opens "Kommentare" on the card and comments on the car in the sheet (`POST vehicles/{id}/comments`), then opens the
// car and finds the comment in its own thread from VEH-01's "Kommentare" row. Needs the R5-5 server part (the car's thread) and the
// `build_comments` flag on (local/staging): otherwise the comment part says why it is skipped.
import { mkdirSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { browserOf, de, follow, id, isCall, members, open } from '../support/flow';
import { buildVehicle, expectStatus } from '../support/garage.mjs';

type Comment = { id: string; body: string; parent_id: string | null; replies: Comment[] };

test.describe('R5-5 like and comment from the Home feed', () => {
  test('heart on a car card → comment on the car from the feed → the comment is in the car’s thread on VEH-01', async ({ browser, page, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const config = await page.request.get('/api/v1/app-config');
    const flags = ((await config.json()) as { data: { flags: Record<string, boolean> } }).data.flags;
    test.skip(flags.build_reactions !== true, 'build_reactions is off on this host');

    const [owner, fan] = await members('r5feedowner', 'r5feedfan');
    await follow(fan, owner.username);
    const vehicle = await buildVehicle(owner.api, { photos: 1 });
    const card = `HOME-01.card.${vehicle.id}`;

    const fanSide = await browserOf(browser, fan, { pageErrors, blockedRequests, expected: [] });
    try {
      // 1. The car's card in Folge ich: one tap on the heart likes the car itself; the answer knows only the fan's own reaction.
      await open(fanSide.page, '/app/?tab=following');
      const heart = id(fanSide.page, `${card}.reaction.button`);
      await expect(heart).toBeVisible({ timeout: 30_000 });
      await expect(heart).toHaveAttribute('aria-label', de('home', 'actions.like'));
      const liked = fanSide.page.waitForResponse(isCall('PUT', `vehicles/${vehicle.id}/reactions`));
      await heart.click();
      const reaction = await liked;
      expect(reaction.status()).toBe(200);
      expect(reaction.request().postDataJSON()).toEqual({ reaction: 'like' });
      const state = (await reaction.json()) as { data: Record<string, unknown> };
      expect(state.data.my_reaction).toBe('like');
      expect(JSON.stringify(state)).not.toMatch(/"(total|count|reaction_summary)"/);
      await expect(heart).toHaveAttribute('aria-pressed', 'true');
      await expect(id(fanSide.page, card)).not.toContainText(/\b\d+\s*(Gefällt|Reaktion|Like)/);

      test.skip(flags.build_comments !== true, 'build_comments is off on this host: the comment part needs it');
      const thread = await fan.api.get(`vehicles/${vehicle.id}/comments`);
      test.skip(thread.status !== 200, `the car's thread is not on this server yet (GET vehicles/{id}/comments: HTTP ${thread.status}); R5-5 server part`);

      // 2. "Kommentare" on the car card opens the car's own thread in the sheet; the comment shows at once and stays after the answer.
      await id(fanSide.page, `${card}.comment`).click();
      const sheet = `HOME-01.comments.${vehicle.id}`;
      await expect(id(fanSide.page, `${sheet}.empty`)).toHaveText(de('vehicle', 'comments.empty'), { timeout: 30_000 });
      const input = id(fanSide.page, `${sheet}.composer.input`);
      await input.click();
      await input.pressSequentially('Welche Felgen fährst du da?');
      const sent = fanSide.page.waitForResponse(isCall('POST', `vehicles/${vehicle.id}/comments`));
      await id(fanSide.page, `${sheet}.composer.send`).click();
      const answer = await sent;
      expect(answer.status()).toBe(201);
      expect(answer.request().headers()['idempotency-key']).toBeTruthy();
      const created = ((await answer.json()) as { data: Comment }).data;
      await expect(id(fanSide.page, `${sheet}.comment.${created.id}.body`)).toHaveText('Welche Felgen fährst du da?');
      const listed = expectStatus(await fan.api.get(`vehicles/${vehicle.id}/comments`), 200, 'list the car’s comments');
      expect(JSON.stringify(listed)).not.toMatch(/"(total|count|comments_count)"/);
      await fanSide.page.keyboard.press('Escape');
      await expect(id(fanSide.page, `${sheet}.composer.input`)).toHaveCount(0);

      // 3. On the car's page the same thread is one calm row away, without a count.
      await open(fanSide.page, `/app/v/${vehicle.slug}`);
      const entry = id(fanSide.page, 'VEH-01.comments.open');
      await expect(entry).toBeVisible({ timeout: 30_000 });
      await expect(entry).not.toContainText(/\d/);
      await entry.click();
      await expect(id(fanSide.page, `VEH-01.comments.${vehicle.id}.comment.${created.id}.body`)).toHaveText('Welche Felgen fährst du da?', { timeout: 30_000 });
    } finally {
      await fanSide.context.close();
    }
  });
});

// Opt-in (R5_FEED_SHOTS=1): the pictures for design QA in docs/reports/round-5/feed-actions/ (JPEG), 390 on WebKit at 200 % and 1440
// on Chromium, Carbon, DE. A local member follows the showcase's felix.gt3 and finds his badged sample 992 in Folge ich with the whole
// action row (ADR-538), opens its seeded car thread (ShowcasePhase5::seedCarComments) from the card, and again from VEH-01's row.
const SHOTS = new URL('../../../../docs/reports/round-5/feed-actions/', import.meta.url);
const SAMPLE = { owner: 'felix.gt3', slug: 'porsche-911-992-afvdbzbr' };

test.describe('R5-5 pictures', () => {
  test('a sample car card with its row, its seeded thread from the feed and from VEH-01', async ({ browser, pageErrors, blockedRequests }, testInfo) => {
    test.skip(!process.env.R5_FEED_SHOTS, 'Opt-in: R5_FEED_SHOTS=1.');
    test.setTimeout(240_000);
    const chromium = testInfo.project.name === 'chromium';
    const viewport = chromium ? { width: 1440, height: 900 } : { width: 390, height: 844 };
    const fontScale = chromium ? 1 : 2;
    const [fan] = await members('r5shotfan');
    await follow(fan, SAMPLE.owner);
    const page992 = expectStatus(await fan.api.get(`public/vehicles/${SAMPLE.slug}`), 200, 'the sample 992').data as {
      id: string;
      is_sample: boolean;
      comment_thread: { enabled: boolean; can_write: boolean };
    };
    expect(page992.is_sample, 'the seeded thread sits on a sample build').toBe(true);
    expect(page992.comment_thread.enabled).toBe(true);
    const seeded = expectStatus(await fan.api.get(`vehicles/${page992.id}/comments`), 200, 'the seeded thread').data as Comment[];
    expect(seeded.length, 'ShowcasePhase5 seeded this thread').toBeGreaterThan(0);
    const first = seeded[0]!;
    const card = `HOME-01.card.${page992.id}`;
    const sheet = (route: string) => `${route}.comments.${page992.id}`;
    mkdirSync(SHOTS, { recursive: true });
    const scale = fontScale === 1 ? '' : `__fs${fontScale}`;
    const shot = (page: Page, route: string, name: string) =>
      page.screenshot({
        path: new URL(`${route}__${viewport.width}x${viewport.height}__${testInfo.project.name}__carbon__de${scale}__${name}.jpg`, SHOTS).pathname,
        type: 'jpeg',
        quality: 85,
        animations: 'disabled',
      });

    const side = await browserOf(browser, fan, { pageErrors, blockedRequests, expected: [] }, viewport);
    try {
      // 1. Folge ich: the sample 992's card with heart and Kommentare (no count).
      await open(side.page, '/app/?tab=following', { fontScale });
      const heart = id(side.page, `${card}.reaction.button`);
      await expect(heart).toBeAttached({ timeout: 30_000 });
      await heart.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await expect(heart).toBeVisible();
      await expect(id(side.page, `${card}.comment`)).toBeVisible();
      await side.page.mouse.move(0, 0);
      await shot(side.page, 'HOME-01', 'sampleCarCard');

      // 2. Its seeded thread from the card: "Kommentare" over the car's name, the question and the owner's answer.
      await id(side.page, `${card}.comment`).click();
      await expect(id(side.page, `${sheet('HOME-01')}.comment.${first.id}.body`)).toHaveText(first.body, { timeout: 30_000 });
      await expect(id(side.page, `${sheet('HOME-01')}.title`)).toHaveText(de('vehicle', 'update.comments'));
      await shot(side.page, 'HOME-01', 'sampleCarComments');
      await side.page.keyboard.press('Escape');

      // 3. The same thread from the car's page.
      await open(side.page, `/app/v/${SAMPLE.slug}`, { fontScale });
      const entry = id(side.page, 'VEH-01.comments.open');
      await expect(entry).toBeAttached({ timeout: 30_000 });
      await entry.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await side.page.mouse.move(0, 0);
      await shot(side.page, 'VEH-01', 'commentsEntry');
      await entry.click();
      await expect(id(side.page, `${sheet('VEH-01')}.comment.${first.id}.body`)).toHaveText(first.body, { timeout: 30_000 });
      await shot(side.page, 'VEH-01', 'sampleCarComments');
    } finally {
      await side.context.close();
    }
  });
});
