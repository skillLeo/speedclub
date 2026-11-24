// R4-2.3 Crews (docs/11_CLIENT_ROUND_4.md, contract-crews §3; app CREW-00…05): on the member web a member founds a crew through
// CREW-02 (POST crews with an Idempotency-Key) and lands on its page (CREW-01); a second member finds it in Entdecken › Crews (CREW-00)
// and sends a join request; the founder approves it in CREW-03 (the tap path of `request_received`), and the member list shows both.
// The founder then invites a third member by username; that member accepts in CREW-05 and leaves again from the crew page. The flag
// `crews` is on in local and staging (FeatureFlagSeeder ON_OUTSIDE_PRODUCTION). Runs at 390 × carbon × de like the other flows.
import { expect, test } from '../support/fixtures';
import { browserOf, id, isCall, members, named, open } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type CrewBody = { id: string; slug: string; name: string; member_count: number; viewer: { state: string; role: string | null } | null };
type MemberRowBody = { member: { username: string }; role: string };

test.describe('R4 Crews', () => {
  test('found → page → request → approve → members; invite → accept; leave', async ({ browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [founder, rider, guest] = await members('r4crewfounder', 'r4crewrider', 'r4crewguest');
    await named(founder, 'Jana R4', 'Hamburg');
    await named(rider, 'Timo R4', 'Kiel');
    await named(guest, 'Mira R4', 'Lübeck');
    expectStatus(await founder.api.get('crews'), 200, 'GET crews (the crews flag must be on)');
    const name = `R4 Nordlicht ${founder.username.slice(-5)}`;

    // 1. CREW-02: found the crew (join mode "Auf Anfrage", Bundesland Hamburg); the app opens CREW-01.
    const own = await browserOf(browser, founder, { pageErrors, blockedRequests, expected: [] });
    let crew: CrewBody;
    try {
      const { page } = own;
      await open(page, '/app/crews/new');
      await id(page, 'CREW-02.name').fill(name);
      await id(page, 'CREW-02.description').fill('Ausfahrten an der Küste und ein Treffen im Monat.');
      await id(page, 'CREW-02.bundesland').click();
      await id(page, 'CREW-02.regionSheet.HH').click();
      await id(page, 'CREW-02.joinMode.request').click();
      const created = page.waitForResponse(isCall('POST', 'crews'));
      await id(page, 'CREW-02.cta.primary').click();
      const answer = await created;
      expect(answer.status()).toBe(201);
      expect(answer.request().headers()['idempotency-key']).toBeTruthy();
      crew = ((await answer.json()) as { data: CrewBody }).data;
      expect(crew.viewer?.role).toBe('founder');
      await expect(id(page, 'CREW-01.name')).toHaveText(name);
      await expect(id(page, 'CREW-01.facts')).toContainText('Auf Anfrage');
      await expect(id(page, 'CREW-01.manage')).toBeVisible();
    } finally {
      await own.context.close();
    }

    // 2. CREW-00 → CREW-01: the rider finds it by name and asks to join.
    const second = await browserOf(browser, rider, { pageErrors, blockedRequests, expected: [] });
    try {
      const { page } = second;
      await open(page, '/app/crews');
      const searched = page.waitForResponse((response) => isCall('GET', 'crews')(response) && response.url().includes('q='));
      await id(page, 'CREW-00.search').fill(name.slice(0, 20));
      expect((await searched).status()).toBe(200);
      await id(page, `CREW-00.crew.${crew.slug}`).click();
      await expect(id(page, 'CREW-01.name')).toHaveText(name);
      const requested = page.waitForResponse(isCall('POST', `crews/${crew.slug}/join`));
      await id(page, 'CREW-01.request').click();
      expect((await requested).status()).toBe(200);
      await expect(id(page, 'CREW-01.withdraw')).toBeVisible();
    } finally {
      await second.context.close();
    }

    // 3. CREW-03 (the `request_received` tap path): the founder approves; CREW-01 lists founder and rider.
    const manage = await browserOf(browser, founder, { pageErrors, blockedRequests, expected: [] });
    try {
      const { page } = manage;
      await open(page, `/app/crews/${crew.slug}/requests`);
      const requests = expectStatus(await founder.api.get(`crews/${crew.slug}/requests`), 200, 'GET requests').data as { id: string }[];
      expect(requests).toHaveLength(1);
      const approved = page.waitForResponse(isCall('POST', `crews/${crew.slug}/requests/${requests[0]!.id}/approve`));
      await id(page, `CREW-03.request.${requests[0]!.id}.approve`).click();
      expect((await approved).status()).toBe(201);

      // 4. Invite the third member by username (the Einladungen tab).
      await id(page, 'CREW-03.tab.invites').click();
      await id(page, 'CREW-03.username').fill(`@${guest.username}`);
      const invited = page.waitForResponse(isCall('POST', `crews/${crew.slug}/invites`));
      await id(page, 'CREW-03.inviteSend').click();
      const invite = await invited;
      expect(invite.status()).toBe(201);
      expect(JSON.parse(invite.request().postData() ?? '{}')).toEqual({ username: guest.username });

      await open(page, `/app/crews/${crew.slug}`);
      await expect(id(page, `CREW-01.member.${founder.username}`)).toContainText('Gründer');
      await expect(id(page, `CREW-01.member.${rider.username}`)).toContainText('Mitglied');
    } finally {
      await manage.context.close();
    }

    // 5. CREW-05: the invited member accepts and lands on the crew page, then leaves it.
    const third = await browserOf(browser, guest, { pageErrors, blockedRequests, expected: [] });
    try {
      const { page } = third;
      await open(page, '/app/crews/invites');
      const invites = expectStatus(await guest.api.get('me/crew-invites'), 200, 'GET me/crew-invites').data as { id: string }[];
      expect(invites).toHaveLength(1);
      const accepted = page.waitForResponse(isCall('POST', `me/crew-invites/${invites[0]!.id}/accept`));
      await id(page, `CREW-05.invite.${invites[0]!.id}.accept`).click();
      expect((await accepted).status()).toBe(200);
      await expect(id(page, 'CREW-01.leave')).toBeVisible();
      await id(page, 'CREW-01.leave').click();
      const left = page.waitForResponse(isCall('POST', `crews/${crew.slug}/leave`));
      await id(page, 'CREW-01.leave.confirm').click();
      expect((await left).status()).toBe(204);
      await expect(id(page, 'CREW-01.request')).toBeVisible();
    } finally {
      await third.context.close();
    }

    const rows = expectStatus(await rider.api.get(`crews/${crew.slug}/members`), 200, 'GET members').data as MemberRowBody[];
    expect(rows.map((row) => [row.member.username, row.role])).toEqual([
      [founder.username, 'founder'],
      [rider.username, 'member'],
    ]);
  });
});
