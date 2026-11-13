// F15 Events and meets (09 §8.7, §7.10, §14.5 F12; M4.12 app, ADR-437/439): on the member web an organiser (account older than 14
// days) creates a meet with the place shown only after an RSVP through the EVT-03 wizard (draft with an Idempotency-Key, then
// "Zur Prüfung senden"), finds it frozen while it is in review (409 event_in_review), staff approve it (ADM-53, through the test
// backend until the admin queue drives it), a member sees only the city until they say "Zusagen", then the exact place, the route
// and the calendar link; the list never carries the place; the organiser's update reaches the attendee. The place search answers
// from a fixed result (the server's geocoder calls OpenStreetMap, a third party). No map loads: the snippet waits for "Karte
// anzeigen" (third-party tiles), so the flow stays inside the no-third-party rule. Runs at 390 × carbon × de like the other flows.
import { expect, test } from '../support/fixtures';
import { ageTestMember, reviewTestEvent } from '../support/backend.mjs';
import { browserOf, de, id, isCall, members, named, open } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type EventBody = {
  id: string;
  slug: string;
  status: string;
  location: { exact: boolean; street: string | null; lat: number | null; city: string | null };
  counts: { going: number; interested: number } | null;
  my_rsvp: string | null;
};

const PLACE = {
  label: 'Beispielkai 1, 20457 Hamburg, Deutschland',
  venue_name: 'F15 Parkplatz am Kai',
  street: 'Beispielkai 1',
  postcode: '20457',
  city: 'Hamburg',
  country: 'DE',
  lat: 53.5413,
  lng: 9.9845,
};

/** A day three weeks ahead of both the real server time and the browser's fixed QA clock, as "TT.MM.JJJJ". */
function meetDay(): string {
  const day = new Date(Date.now() + 21 * 24 * 3600 * 1000);
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(day);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}.${part('month')}.${part('year')}`;
}

test.describe('F15 Events and meets', () => {
  test('create with a private place → frozen in review → approved → RSVP reveals the place → organiser update', async ({ browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [organiser, attendee] = await members('f15organiser', 'f15attendee');
    await named(organiser, 'Lena F15', 'Hamburg');
    await ageTestMember(organiser.email, 15);
    const title = `F15 Nachttreffen ${organiser.username.slice(-4)}`;

    // 1. EVT-03: Basis → Ort (fixed geocode answer, "Nach Zusage") → Zeit → Details & Regeln → Vorschau → "Zur Prüfung senden".
    const own = await browserOf(browser, organiser, { pageErrors, blockedRequests, expected: [] });
    let slug = '';
    try {
      await own.page.route(/\/api\/v1\/geocode(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [PLACE] }) }));
      await open(own.page, '/app/event-editor/new');
      await expect(id(own.page, 'EVT-03.title')).toBeVisible();
      await id(own.page, 'EVT-03.title').fill(title);
      await id(own.page, 'EVT-03.cta.primary').click();

      await expect(id(own.page, 'EVT-03.step')).toContainText(de('events', 'editor.steps.place'));
      await expect(id(own.page, 'EVT-03.map.consent')).toBeVisible();
      await id(own.page, 'EVT-03.placeQuery').fill('Beispielkai 1 Hamburg');
      await id(own.page, 'EVT-03.placeSearch').click();
      await id(own.page, 'EVT-03.place.0').click();
      await expect(id(own.page, 'EVT-03.pinHelper')).toHaveText(de('events', 'editor.pinSet'));
      await expect(id(own.page, 'EVT-03.city')).toHaveValue('Hamburg');
      await id(own.page, 'EVT-03.locationVisibility.after_rsvp').click();
      await id(own.page, 'EVT-03.cta.primary').click();

      await expect(id(own.page, 'EVT-03.step')).toContainText(de('events', 'editor.steps.time'));
      await id(own.page, 'EVT-03.startDate').fill(meetDay());
      await id(own.page, 'EVT-03.startTime').fill('19:00');
      await id(own.page, 'EVT-03.endTime').fill('22:00');
      await id(own.page, 'EVT-03.cta.primary').click();

      await expect(id(own.page, 'EVT-03.step')).toContainText(de('events', 'editor.steps.details'));
      await id(own.page, 'EVT-03.description').fill('Motor aus auf dem Platz, Gespräche über Builds.');
      await id(own.page, 'EVT-03.acceptRules').click();
      await id(own.page, 'EVT-03.cta.primary').click();

      await expect(id(own.page, 'EVT-03.preview')).toBeVisible();
      await expect(id(own.page, 'EVT-03.cta.primary')).toHaveText(de('events', 'editor.submitReview'));
      const created = own.page.waitForResponse(isCall('POST', 'events'));
      await id(own.page, 'EVT-03.cta.primary').click();
      const draft = await created;
      expect(draft.status()).toBe(201);
      expect(draft.request().headers()['idempotency-key']).toBeTruthy();
      const draftBody = ((await draft.json()) as { data: EventBody }).data;
      slug = draftBody.slug;
      const sent = await own.page.waitForResponse(isCall('POST', `events/${slug}/submit`));
      expect(sent.status()).toBe(200);
      expect(((await sent.json()) as { data: EventBody }).data.status).toBe('pending_review');

      // 2. EVT-02 for the organiser: the review notice; the exact place is theirs to see.
      await expect(id(own.page, 'EVT-02.review.title')).toHaveText(de('events', 'review.pendingTitle'));
      await expect(id(own.page, 'EVT-02.place')).toContainText('Beispielkai 1');

      // 3. Frozen in review (ADR-439): the editor shows the state, the API refuses a change.
      await open(own.page, `/app/event-editor/${slug}`);
      await expect(id(own.page, 'EVT-03.frozen')).toBeVisible();
      const refused = await organiser.api.patch(`events/${slug}`, { title: `${title} geändert` });
      expect(refused.status).toBe(409);
      expect((refused.body as { code: string }).code).toBe('event_in_review');
    } finally {
      await own.context.close();
    }

    // 4. ADM-53 approves.
    expect((await reviewTestEvent(slug, 'approve')).status).toBe('published');

    // 5. The list and the detail never give a stranger the place; "Zusagen" does (ADR-437 c).
    const listed = expectStatus(await attendee.api.get('events?per_page=50'), 200, 'GET events').data as EventBody[];
    const card = listed.find((event) => event.slug === slug);
    if (card) {
      expect(card.location.exact).toBe(false);
      expect(card.location.street).toBeNull();
      expect(card.location.lat).toBeNull();
    }
    const guest = await browserOf(browser, attendee, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(guest.page, `/app/events/${slug}`);
      await expect(id(guest.page, 'EVT-02.title')).toHaveText(title);
      await expect(id(guest.page, 'EVT-02.place')).toContainText(de('events', 'place.afterRsvp'));
      await expect(id(guest.page, 'EVT-02.place')).not.toContainText('Beispielkai');
      await expect(id(guest.page, 'EVT-02.route')).toHaveCount(0);

      const answered = guest.page.waitForResponse(isCall('PUT', `events/${slug}/rsvp`));
      await id(guest.page, 'EVT-02.rsvp.going').click();
      const rsvp = await answered;
      expect(rsvp.status()).toBe(200);
      expect(await rsvp.request().postDataJSON()).toEqual({ status: 'going' });
      await expect(id(guest.page, 'EVT-02.rsvp.state')).toContainText(de('events', 'rsvp.goingDone'));
      await expect(id(guest.page, 'EVT-02.place')).toContainText('Beispielkai 1');
      await expect(id(guest.page, 'EVT-02.route')).toBeVisible();
      await expect(id(guest.page, 'EVT-02.rsvp.calendar')).toBeVisible();
      await expect(id(guest.page, 'EVT-02.counts')).toContainText(de('events', 'counts.going', { count: 1, value: '1' }));
    } finally {
      await guest.context.close();
    }

    // 6. EVT-06: the organiser's update goes to everybody with an answer; the attendee reads it.
    const tools = await browserOf(browser, organiser, { pageErrors, blockedRequests, expected: [] });
    try {
      await open(tools.page, `/app/events/${slug}/manage`);
      await expect(id(tools.page, 'EVT-06.updateText')).toBeVisible();
      await id(tools.page, 'EVT-06.updateText').fill('Wir treffen uns 15 Minuten früher an der Einfahrt.');
      const posted = tools.page.waitForResponse(isCall('POST', `events/${slug}/updates`));
      await id(tools.page, 'EVT-06.updateSend').click();
      const update = await posted;
      expect(update.status()).toBe(201);
      expect(update.request().headers()['idempotency-key']).toBeTruthy();
      await expect(tools.page.getByText(de('events', 'manage.updateSent'))).toBeVisible();
    } finally {
      await tools.context.close();
    }
    const updates = expectStatus(await attendee.api.get(`events/${slug}/updates`), 200, 'GET updates').data as { body: string }[];
    expect(updates.map((entry) => entry.body)).toContain('Wir treffen uns 15 Minuten früher an der Einfahrt.');
  });
});
