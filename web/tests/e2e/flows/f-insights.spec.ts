// M5.7 Engagement, the app part (10 §6.1, docs/reports/phase-5/m5.7-contract.md §2–§3): another member opens a build in the member
// web, the page sends its one view beacon, and the owner's INS-01 counts that person once (a reload and the owner's own visit add
// nothing); the owner opens "Statistiken" from the car and reads the view, its source (Web) and the server's sentence. Never who it
// was. The visitor's browser carries an ordinary Safari user agent: the server leaves browser automation out of the count (HumanVisit),
// and the app opens without qa* overrides, which would make it a QA render the beacon never sends. Runs at 390 × carbon × de like the
// other flows; every account ends in E2E_DOMAIN and goes with the teardown.
import type { Page, Response } from '@playwright/test';
import { useSession } from '../support/auth.mjs';
import { routeCsrfCookie } from '../support/csrf-limit.mjs';
import { expect, test, watchPageErrors } from '../support/fixtures';
import { de, id, members, named, open, type Sinks } from '../support/flow';
import { buildVehicle, expectStatus, type MemberApi } from '../support/garage.mjs';
import { BASE_URL, makeContextDeterministic, QA_LOCALES, QA_TIMEZONE } from '../support/qa.mjs';

type Pair = { this_week: number; last_week: number };
type Insights = {
  scope: string;
  headline: string;
  views: Pair & { total_30_days: number };
  sources: { source: string; views: number }[];
  breakdown: unknown[];
};

/** A person's phone, not a test runner: the server counts no browser automation (headless, playwright, …) on the beacon. */
const PERSON_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

async function insightsOf(api: MemberApi, vehicleId: string): Promise<Insights> {
  return expectStatus(await api.get(`vehicles/${vehicleId}/insights`), 200, 'GET vehicles/{id}/insights').data as Insights;
}

const isBeacon = (response: Response): boolean => response.request().method() === 'POST' && /\/api\/v1\/views$/.test(new URL(response.url()).pathname);

/** Opens the build as a person would (no qa* override) and waits for its one beacon. */
async function openAsPerson(page: Page, slug: string): Promise<Response> {
  const beacon = page.waitForResponse(isBeacon, { timeout: 30_000 });
  await page.goto(`${BASE_URL}/app/v/${slug}`);
  return beacon;
}

test.describe('F-INSIGHTS views and INS-01', () => {
  test("a visitor's view is counted once; the owner reads it in INS-01, never who it was", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const [owner, visitor] = await members('insowner', 'insvisit');
    await named(owner, 'Mara Insights', 'Leipzig');
    await named(visitor, 'Tom Besuch', 'Halle');
    const car = await buildVehicle(owner.api, { photos: 1, nickname: `INS${owner.username.slice(-5)}` });
    const before = await insightsOf(owner.api, car.id);
    expect(before.views.this_week).toBe(0);

    // The visitor: a second browser with a person's user agent, signed in.
    const sinks: Sinks = { pageErrors: [], blockedRequests: [], expected: [] };
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      locale: QA_LOCALES.de,
      timezoneId: QA_TIMEZONE,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      userAgent: PERSON_UA,
    });
    await makeContextDeterministic(context, { onBlocked: (url: string) => sinks.blockedRequests.push(url) });
    await routeCsrfCookie(context);
    await useSession(context, visitor.session);
    const visitorPage = await context.newPage();
    watchPageErrors(visitorPage, sinks.pageErrors, sinks.expected);

    const first = await openAsPerson(visitorPage, car.slug);
    expect(first.status()).toBe(204);
    expect(first.request().postDataJSON()).toEqual({ subject: 'vehicle', id: car.id, source: 'web' });
    // The view is stored after the answer: wait for it.
    await expect.poll(async () => (await insightsOf(owner.api, car.id)).views.this_week, { timeout: 20_000 }).toBe(1);

    // The same person again the same day (a reload is a new app run, so the page sends again): still one.
    const second = await openAsPerson(visitorPage, car.slug);
    expect(second.status()).toBe(204);
    // A revalidation of the open page sends nothing more.
    let extra = 0;
    visitorPage.on('response', (response) => {
      if (isBeacon(response)) extra += 1;
    });
    await visitorPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await visitorPage.waitForTimeout(1_500);
    expect(extra).toBe(0);
    await context.close();

    // The owner's own visit is never a view (the app does not even send one).
    await useSession(page.context(), owner.session);
    let ownBeacons = 0;
    page.on('response', (response) => {
      if (isBeacon(response)) ownBeacons += 1;
    });
    await page.goto(`${BASE_URL}/app/v/${car.slug}`);
    await expect(id(page, 'VEH-01.ownerRows')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);
    expect(ownBeacons).toBe(0);

    const after = await insightsOf(owner.api, car.id);
    expect(after.views.this_week).toBe(1);
    expect(after.sources.find((row) => row.source === 'web')?.views).toBe(1);
    // Sums only: no username, id or hash of the visitor anywhere in the answer.
    const raw = JSON.stringify(after);
    expect(raw).not.toContain(visitor.username);
    expect(raw).not.toContain('Tom Besuch');

    // INS-01 from the car: "Statistiken" under Build-Fortschritt, then the numbers and the server's sentence.
    await open(page, `/app/v/${car.slug}`);
    await id(page, 'VEH-01.insights').click();
    await expect(page).toHaveURL(new RegExp(`/app/vehicles/${car.id}/insights`));
    await expect(id(page, 'INS-01.thisWeek')).toHaveText('1');
    await expect(id(page, 'INS-01.headline')).toHaveText(after.headline);
    await expect(id(page, 'INS-01.source.web')).toContainText('1');
    await expect(id(page, 'INS-01.privacy')).toHaveText(de('profile', 'insights.privacy'));
    await expect(page.getByText('Tom Besuch')).toHaveCount(0);

    expect(sinks.pageErrors).toEqual([]);
  });
});
