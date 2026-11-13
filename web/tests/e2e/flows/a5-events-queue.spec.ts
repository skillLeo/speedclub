// A5 Treffen-Queue (09 §10.2 SplitQueue, §10.3 ADM-53/54; ADR-437/439), Chromium at 1280 like the other admin flows. A test organiser
// (account aged past the 14 days of 09 §8.7) sends three meets with the place shown after an RSVP for review through the member API.
// The moderator finds them on ADM-53 "In Prüfung", opens one in the pane (the exact place for staff), approves it with the key `a`,
// undoes that within the 5 s (`u`, back in review), approves it with the button and the queue moves on to the next meet; rejects the
// second with `r` and a reason the organiser reads in the app's API. The third is open on ADM-54 while the same meet is decided by
// another request: "Freigeben" then shows "Inzwischen geändert" and changes nothing (optimistic locking), and a direct JSON write with
// the old version answers 409 changed_meanwhile. The analyst sees the queue read-only and a direct POST answers 403.
// None of these is a four-eyes action (06 §2). Runs on Chromium only: one staff session per role is shared by the browser projects.
import type { Page } from '@playwright/test';
import { admin, confirmPasswordDirectly, DESKTOP, pageProps, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { ageTestMember } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named, type Member } from '../support/flow';
import { expectStatus } from '../support/garage.mjs';

type Organised = { id: string; slug: string; title: string };

function startsIn(days: number, hour: number): string {
  const day = new Date(Date.now() + days * 24 * 3600 * 1000);
  day.setUTCHours(hour - 1, 0, 0, 0);
  return day.toISOString();
}

/** A meet in review: the place after an RSVP always goes to pre-moderation (09 §8.7). */
async function sendForReview(organiser: Member, title: string, days: number): Promise<Organised> {
  const made = expectStatus(
    await organiser.api.post('events', {
      title,
      type: 'meet',
      visibility: 'public',
      location_visibility: 'after_rsvp',
      starts_at: startsIn(days, 19),
      ends_at: startsIn(days, 22),
      venue_name: 'A5 Parkplatz am Kai',
      street: 'Beispielkai 5',
      postcode: '20457',
      city: 'Hamburg',
      country: 'DE',
      lat: 53.5413,
      lng: 9.9845,
      description: 'Motor aus auf dem Platz, Gespräche über Builds.',
      rules: ['legal_only', 'no_racing', 'respect_residents', 'no_litter'],
      accept_rules: true,
      submit: true,
    }),
    201,
    `POST events ${title}`,
  ).data as Organised & { status: string };
  expect(made.status, `${title} must wait for review`).toBe('pending_review');
  return made;
}

async function statusOf(organiser: Member, slug: string): Promise<{ status: string; review?: { reason: string | null } | null }> {
  return expectStatus(await organiser.api.get(`events/${slug}`), 200, `GET events/${slug}`).data;
}

/** The queue filtered to this run's meets, so other pending meets never shift the rows. */
async function openQueue(page: Page, prefix: string, eventId?: string): Promise<void> {
  const params = new URLSearchParams({ 'filter[q]': prefix });
  if (eventId) params.set('event', eventId);
  await page.goto(`/admin/events?${params.toString()}`);
  await expect(id(page, 'ADM-53.table')).toBeVisible();
}

test.describe('A5 Treffen-Queue', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('pane → a (approve) → u (undo) → approve, auto-advance → r (reject with reason) → ADM-54 "changed meanwhile" → analyst read-only', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(300_000);
    const [organiser] = await members('a5organiser');
    await named(organiser, 'Jonas A5', 'Hamburg');
    await ageTestMember(organiser.email, 15);
    const prefix = `A5 ${organiser.username.slice(-5)}`;
    const first = await sendForReview(organiser, `${prefix} Hafentreffen`, 20);
    const second = await sendForReview(organiser, `${prefix} Nachtausfahrt`, 21);
    const third = await sendForReview(organiser, `${prefix} Cars am Kai`, 22);

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'moderator');
    await realClock(page);
    await confirmPasswordDirectly(context);

    // 1. ADM-53 In Prüfung, oldest first; the pane shows the exact place to staff.
    await openQueue(page, prefix);
    const rows = id(page, 'ADM-53.table.row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(first.title);
    await rows.first().getByTestId('ADM-53.open').click();
    await expect(id(page, 'ADM-53.pane.title')).toHaveText(first.title);
    await expect(id(page, 'ADM-53.detail.place')).toContainText('Beispielkai 5');
    await expect(id(page, 'ADM-53.detail.place')).toContainText(admin('events', 'detail.place_private'));

    // 2. `a` approves, the undo offers itself for 5 s, `u` puts it back into review.
    await page.locator('body').press('a');
    await expect(toast(page, admin('events', 'flash.approved'))).toBeVisible();
    await expect(id(page, 'ADM-53.undo')).toContainText(admin('events', 'undo.approved', { title: first.title }));
    await expect(id(page, 'ADM-53.pane.title')).toHaveText(second.title);
    expect((await statusOf(organiser, first.slug)).status).toBe('published');
    await page.locator('body').press('u');
    await expect(toast(page, admin('events', 'flash.reopened'))).toBeVisible();
    await expect(id(page, 'ADM-53.pane.title')).toHaveText(first.title);
    expect((await statusOf(organiser, first.slug)).status).toBe('pending_review');

    // 3. The button approves; the queue moves on to the next meet (auto-advance).
    await id(page, 'ADM-53.approve').click();
    await expect(id(page, 'ADM-53.pane.title')).toHaveText(second.title);
    expect((await statusOf(organiser, first.slug)).status).toBe('published');

    // 4. `r` opens the rejection; the reason is what the organiser reads.
    const reason = 'Bitte nenn die Genehmigung des Platzbetreibers.';
    await page.locator('body').press('r');
    await expect(id(page, 'ADM-53.reject-dialog')).toBeVisible();
    await id(page, 'ADM-53.reject-dialog.reason').fill(reason);
    await id(page, 'ADM-53.reject-dialog.confirm').click();
    await expect(toast(page, admin('events', 'flash.rejected'))).toBeVisible();
    await expect(id(page, 'ADM-53.pane.title')).toHaveText(third.title);
    const rejected = await statusOf(organiser, second.slug);
    expect(rejected.status).toBe('rejected');
    expect(rejected.review?.reason).toBe(reason);

    // 5. ADM-54 of the third meet while another request decides it: the page's version is stale.
    await page.goto(`/admin/events/${third.id}`);
    await expect(id(page, 'ADM-54.detail')).toBeVisible();
    const seen = (await pageProps<{ event: { version: string } }>(context, `/admin/events/${third.id}`)).event.version;
    expect(seen).not.toBe('');
    await page.waitForTimeout(1100); // the version has second precision (updated_at)
    const headers = { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(context) };
    const elsewhere = await context.request.post(`/admin/events/${third.id}/reject`, { headers, data: { reason: 'Parallel entschieden: Ort ist eine Wohnstraße.', version: seen } });
    expect(elsewhere.status()).toBe(200);
    const stale = await context.request.post(`/admin/events/${third.id}/reopen`, { headers, data: { version: seen } });
    expect(stale.status()).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('changed_meanwhile');

    await id(page, 'ADM-54.approve').click();
    await expect(id(page, 'ADM-54.conflict')).toContainText(admin('events', 'conflict.changed'));
    expect((await statusOf(organiser, third.slug)).status).toBe('rejected');
    await id(page, 'ADM-54.conflict.reload').click();
    await expect(id(page, 'ADM-54.status')).toHaveText(admin('events', 'status.rejected'));
    await expect(id(page, 'ADM-54.approve')).toHaveCount(0);
    await expect(id(page, 'ADM-54.reopen')).toBeVisible();

    // 6. The analyst: the queue read-only, a direct decision refused.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await openQueue(analystPage, prefix, third.id);
      await expect(id(analystPage, 'ADM-53.view-only')).toBeVisible();
      await expect(id(analystPage, 'ADM-53.approve')).toHaveCount(0);
      const refused = await analyst.request.post(`/admin/events/${third.id}/reopen`, {
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await xsrfOf(analyst) },
        data: { version: seen },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await analyst.close();
    }
    expect((await statusOf(organiser, third.slug)).status).toBe('rejected');
  });
});
