// F13 Businesses (09 §8.10, §7.11, §14.5 F13; M4.14 app, ADR-414/455): on the member web a member applies with a business through the
// BIZ-02 wizard (Betrieb → Impressum → Adresse & Kontakt → Öffnungszeiten → Bilder & Abschluss, POST with an Idempotency-Key), sees it
// "In Prüfung", staff verify it (ADM-55, through the test backend until the admin queue drives it), a second member tags the business as
// "Eingebaut von" on a mod in GAR-10 (it waits for the business), the business confirms it in BIZ-04 (sent once the undo toast is gone),
// and the build then shows on BIZ-01 under "Builds aus unserer Werkstatt" next to the Impressum (§ 5 DDG), and VEH-02 names the business.
// parts_catalogue and businesses are off everywhere until the module's design QA passed (ADR-455): the flow switches both on for its
// run and off after (support/backend.php m414FlagsFixture, never a flag a person switched on). Runs at 390 × carbon × de like the
// other flows; no map loads (BIZ-01's map waits for "Karte anzeigen").
import { expect, test } from '../support/fixtures';
import { disableM414Flags, enableM414Flags, reviewTestBusiness } from '../support/backend.mjs';
import { browserOf, de, id, isCall, members, named, open } from '../support/flow';
import { BBS_WHEELS, buildVehicle } from '../support/garage.mjs';

type MyBusiness = { id: string; slug: string; status: string; name: string };
type Tag = { id: string; status: string; initiated_by: string; business: { slug: string } };

const FLAGS = 'qaFlags=parts_catalogue,businesses';

test.describe('F13 Businesses', () => {
  test.beforeAll(async () => {
    await enableM414Flags();
  });
  test.afterAll(async () => {
    await disableM414Flags();
  });

  test('apply → in review → verified → a member tags a mod → the business confirms → portfolio and Impressum', async ({ browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [owner, member] = await members('f13business', 'f13member');
    await named(owner, 'Jana F13', 'Hamburg');
    await named(member, 'Max F13', 'Hamburg');
    const vehicle = await buildVehicle(member.api, { photos: 1, mods: [BBS_WHEELS] });
    const modId = (vehicle.mods[0] as { id: string }).id;
    const name = `F13 Werkstatt ${owner.username.slice(-4)}`;

    // 1. BIZ-02: the five steps; each step refuses "Weiter" until its fields are valid.
    // GET me/business answers 404 business_unavailable while the member has none: that is how BIZ-02 knows to offer the form.
    const own = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [{ status: 404, url: /\/api\/v1\/me\/business$/ }] });
    let business: MyBusiness;
    try {
      await open(own.page, `/app/settings/business/apply?${FLAGS}`);
      await expect(id(own.page, 'BIZ-02.name')).toBeVisible();
      await id(own.page, 'BIZ-02.cta.primary').click();
      await expect(own.page.getByText(de('parts', 'validation.required')).first()).toBeVisible();
      await id(own.page, 'BIZ-02.name').fill(name);
      await id(own.page, 'BIZ-02.service').fill('Fahrwerk');
      await id(own.page, 'BIZ-02.service.add').click();
      await expect(id(own.page, 'BIZ-02.services.Fahrwerk')).toBeVisible();
      await id(own.page, 'BIZ-02.cta.primary').click();

      await expect(id(own.page, 'BIZ-02.step')).toContainText(de('parts', 'apply.steps.impressum'));
      await id(own.page, 'BIZ-02.legalName').fill(`${name} GmbH`);
      await id(own.page, 'BIZ-02.representative').fill('Jana Testerin');
      await id(own.page, 'BIZ-02.registerCourt').fill('Amtsgericht Hamburg');
      await id(own.page, 'BIZ-02.registerNumber').fill('HRB 990013');
      await id(own.page, 'BIZ-02.cta.primary').click();

      await expect(id(own.page, 'BIZ-02.step')).toContainText(de('parts', 'apply.steps.contact'));
      await id(own.page, 'BIZ-02.street').fill('Testweg 13');
      await id(own.page, 'BIZ-02.postcode').fill('20095');
      await id(own.page, 'BIZ-02.city').fill('Hamburg');
      await id(own.page, 'BIZ-02.email').fill(`kontakt.${owner.username}@example.org`);
      await id(own.page, 'BIZ-02.cta.primary').click();

      await expect(id(own.page, 'BIZ-02.step')).toContainText(de('parts', 'apply.steps.hours'));
      await expect(id(own.page, 'BIZ-02.hours.mon')).toBeVisible();
      await id(own.page, 'BIZ-02.cta.primary').click();

      await expect(id(own.page, 'BIZ-02.step')).toContainText(de('parts', 'apply.steps.finish'));
      await id(own.page, 'BIZ-02.acceptTerms').click();
      const applied = own.page.waitForResponse(isCall('POST', 'me/business'));
      await id(own.page, 'BIZ-02.cta.primary').click();
      const answer = await applied;
      expect(answer.status()).toBe(201);
      expect(answer.request().headers()['idempotency-key']).toBeTruthy();
      business = ((await answer.json()) as { data: MyBusiness }).data;
      expect(business.status).toBe('applied');

      // The status screen: in review, nothing public yet.
      await expect(id(own.page, 'BIZ-02.status.pill')).toHaveText(de('parts', 'status.applied'));

      // 2. Staff verify it (ADM-55).
      await reviewTestBusiness(business.slug, 'verify');
    } finally {
      await own.context.close();
    }

    // 3. GAR-10: the member names the business under "Eingebaut von"; it waits for the business.
    const mine = await browserOf(browser, member, { pageErrors, blockedRequests, expected: [] });
    let tag: Tag;
    try {
      await open(mine.page, `/app/garage/${vehicle.id}/mods/${modId}?${FLAGS}`);
      await expect(id(mine.page, 'GAR-10.installedBy')).toBeVisible();
      await id(mine.page, 'GAR-10.installedBy').click();
      await expect(id(mine.page, 'GAR-10.businessSheet.search')).toBeVisible();
      await id(mine.page, 'GAR-10.businessSheet.search').fill(name);
      await expect(id(mine.page, `GAR-10.businessSheet.business.${business.slug}`)).toBeVisible();
      const tagged = mine.page.waitForResponse(isCall('PUT', `mods/${modId}/business-tag`));
      await id(mine.page, `GAR-10.businessSheet.business.${business.slug}`).click();
      const tagAnswer = await tagged;
      expect(tagAnswer.status()).toBe(201);
      tag = ((await tagAnswer.json()) as { data: Tag }).data;
      expect(tag).toMatchObject({ status: 'pending', initiated_by: 'member', business: { slug: business.slug } });
      await expect(id(mine.page, 'GAR-10.installedBy.tag.status')).toHaveText(de('parts', 'tags.state.pending'));
    } finally {
      await mine.context.close();
    }

    // 4. BIZ-04: the business confirms; the call goes out once the undo toast is gone.
    const desk = await browserOf(browser, owner, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(desk.page, `/app/business/requests?${FLAGS}`);
      await expect(id(desk.page, `BIZ-04.tag.${tag.id}`)).toBeVisible();
      const decided = desk.page.waitForResponse(isCall('PATCH', `me/business/tag-requests/${tag.id}`), { timeout: 20_000 });
      await id(desk.page, `BIZ-04.tag.${tag.id}.accept`).click();
      await expect(id(desk.page, `BIZ-04.tag.${tag.id}`)).toHaveCount(0);
      const decision = await decided;
      expect(decision.status()).toBe(200);
      expect(((await decision.json()) as { data: Tag }).data.status).toBe('accepted');

      // 5. BIZ-01: the confirmed build in "Builds aus unserer Werkstatt", the Impressum with the register entry.
      await open(desk.page, `/app/b/${business.slug}?${FLAGS}`);
      await expect(id(desk.page, 'BIZ-01.title')).toHaveText(name);
      await expect(id(desk.page, 'BIZ-01.verified')).toBeVisible();
      await expect(id(desk.page, `BIZ-01.portfolio.build.${vehicle.id}`)).toBeVisible();
      await expect(id(desk.page, 'BIZ-01.impressum.register')).toContainText('HRB 990013');
      await expect(id(desk.page, 'BIZ-01.impressum.name')).toContainText(`${name} GmbH`);

      // 6. VEH-02 of the mod names the business, for everybody.
      await open(desk.page, `/app/v/${vehicle.slug}/mods/${modId}?${FLAGS}`);
      await expect(id(desk.page, 'VEH-02.installedBy')).toContainText(name);
    } finally {
      await desk.context.close();
    }
  });
});
