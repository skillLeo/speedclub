// R4-2.1 Car of the Day voting (docs/11_CLIENT_ROUND_4.md, contract docs/reports/round-4/contract-cotd-voting.md): the demo member lukas.sc
// (an account older than three days, verified) sees "Wähle das Car of the Day von morgen" on Start with the round's candidates, votes
// (Idempotency-Key, optimistic), reads "Du hast abgestimmt", changes the vote, and no answer or screen carries a count. The vote the
// member had before the test is put back at the end (a vote cannot be withdrawn, V4). Needs the `cotd_voting` flag on and an open
// round with at least two votable candidates: otherwise the test says why it is skipped.
import { DEMO_MEMBER, sessionOf, useSession } from '../support/auth.mjs';
import { expect, test } from '../support/fixtures';
import { de, id, isCall, open } from '../support/flow';
import { expectText, expectTextContaining } from '../support/text.mjs';

type Candidate = { position: number; own: boolean; votable: boolean; vehicle: { id: string; full_title: string } };
type VoteState = { round: { day: string; status: string; can_vote: boolean; my_vote: string | null; candidates: Candidate[] }; last_result: unknown };

/**
 * No count, share or leader in the round or on a candidate (V7). The cars themselves are FeedVehicles (their own photo_count or
 * completeness.percent are no votes), so they are left out of the check.
 */
function expectNoCounts(body: unknown): void {
  const shape = JSON.stringify(body, (key, value: unknown) => (key === 'vehicle' || key === 'winner' ? '[car]' : value));
  expect(shape).not.toMatch(/"(votes|vote_count|votes_count|count|counted|share|percent|percentage|leading|tally)"/);
}

test.describe('R4-2.1 Car of the Day voting', () => {
  test('HOME-01: vote, "Du hast abgestimmt", change, no count anywhere', async ({ page, context }) => {
    test.setTimeout(120_000);
    const config = await page.request.get('/api/v1/app-config');
    const flags = ((await config.json()) as { data: { flags: Record<string, boolean> } }).data.flags;
    test.skip(flags.cotd_voting !== true, 'cotd_voting is off on this host (seed FeatureFlagSeeder and switch it on for local/staging)');

    await useSession(context, await sessionOf(DEMO_MEMBER));
    const read = page.waitForResponse((response) => isCall('GET', 'car-of-the-day/vote')(response));
    await open(page, '/app/');
    const answer = await read;
    expect(answer.status()).toBe(200);
    const first = ((await answer.json()) as { data: VoteState }).data;
    expectNoCounts(first);
    const votable = first.round.candidates.filter((candidate) => candidate.votable && !candidate.own);
    test.skip(first.round.status !== 'open' || !first.round.can_vote || votable.length < 2, `no open round with two votable candidates (status ${first.round.status})`);

    const module = id(page, 'HOME-01.vote');
    await expect(module).toBeVisible({ timeout: 30_000 });
    const titles = [de('home', 'vote.title'), de('home', 'vote.titleToday')];
    await expect(id(page, 'HOME-01.vote.title')).toHaveText(new RegExp(`^(${titles.join('|')})$`));
    // The Picker's order, never by votes.
    expect(first.round.candidates.map((candidate) => candidate.position)).toEqual([...first.round.candidates.map((candidate) => candidate.position)].sort((a, b) => a - b));
    for (const candidate of first.round.candidates) {
      // The shown name keeps its own breaks (a word joiner after a hyphen: "MX-5", "GT-R", DQ-162): compared apart from it.
      await expectText(id(page, `HOME-01.vote.candidate.${candidate.position}.name`), candidate.vehicle.full_title);
    }
    await expect(module).not.toContainText(/\d+\s*(Stimme|Stimmen|%)/);

    const before = first.round.my_vote;
    const pick = votable.find((candidate) => candidate.vehicle.id !== before) ?? votable[0]!;
    const other = votable.find((candidate) => candidate.vehicle.id !== pick.vehicle.id)!;
    const tile = id(page, `HOME-01.vote.candidate.${pick.position}`);

    const posted = page.waitForResponse(isCall('POST', 'car-of-the-day/vote'));
    await tile.click();
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    const cast = await posted;
    expect(cast.status()).toBe(200);
    expect(cast.request().headers()['idempotency-key']).toBeTruthy();
    expect(cast.request().postDataJSON()).toEqual({ day: first.round.day, vehicle_id: pick.vehicle.id });
    const after = ((await cast.json()) as { data: VoteState }).data;
    expectNoCounts(after);
    expect(after.round.my_vote).toBe(pick.vehicle.id);
    await expectTextContaining(id(page, 'HOME-01.vote.voted'), pick.vehicle.full_title);
    await expect(id(page, `HOME-01.vote.candidate.${pick.position}.chosen`)).toHaveText(de('home', 'vote.yourChoice'));

    // Changeable until closes_at: another candidate replaces the vote.
    const changed = page.waitForResponse(isCall('POST', 'car-of-the-day/vote'));
    await id(page, `HOME-01.vote.candidate.${other.position}`).click();
    expect((await changed).status()).toBe(200);
    await expect(id(page, `HOME-01.vote.candidate.${other.position}`)).toHaveAttribute('aria-checked', 'true');
    await expect(tile).toHaveAttribute('aria-checked', 'false');

    // After a reload the vote is still there.
    await open(page, '/app/');
    await expect(id(page, `HOME-01.vote.candidate.${other.position}`)).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });

    // Put the member's earlier vote back (there is no withdraw).
    if (before && before !== other.vehicle.id) {
      const restore = page.waitForResponse(isCall('POST', 'car-of-the-day/vote'));
      const position = first.round.candidates.find((candidate) => candidate.vehicle.id === before)?.position;
      if (position !== undefined) {
        await id(page, `HOME-01.vote.candidate.${position}`).click();
        expect((await restore).status()).toBe(200);
      }
    }
  });

  test('a guest sees no vote module and the route answers 401', async ({ page }) => {
    const answer = await page.request.get('/api/v1/car-of-the-day/vote');
    expect([401, 404]).toContain(answer.status());
    await open(page, '/app/');
    await expect(id(page, 'HOME-01.root')).toBeVisible({ timeout: 30_000 });
    await expect(id(page, 'HOME-01.vote')).toHaveCount(0);
  });
});
