// A5 Wrapped preview (ADM-10 tab "Wrapped", M5.9e admin; m5.9e contract §2), Chromium at 1280 like the other admin flows. A test member
// publishes a car and documents a mod installed in May of this year's season (the season is March to October in Berlin, so the flow
// needs a date after 31 October to have a finished season; before that it uses last year's). Support opens the member's record, tab
// Wrapped: no season yet, the empty state; "Vorschau erzeugen" (password confirmed first) writes it: the toast, the season row, the cards (intro and Top-Mod among
// them) with their staff-only PNGs (200, image/png, private no-store), and "Wrapped-Vorschau erzeugt" in the activity column. No member
// media URL in the props. The moderator sees the tab read-only and a direct POST answers 403; the analyst has no tab and no PNG.
import { admin, confirmPassword, DESKTOP, pageProps, realClock, staffContext, toast, xsrfOf } from '../support/admin-flow';
import { expect, test } from '../support/fixtures';
import { browserOf, id, members, named } from '../support/flow';
import { BBS_WHEELS, buildVehicle } from '../support/garage.mjs';

type Card = { n: number; kind: string; fields: Record<string, unknown>; image: string };
type WrappedProps = { wrapped: { selected: string; seasons: { key: string }[]; preview: { cards: Card[] } | null; can: { generate: boolean } } | null; tab: string };

function keysOf(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [key, ...keysOf(item)]);
}

/** The newest finished season (Berlin): this year's after 31 October, else last year's. */
function finishedSeason(): { key: string; year: number } {
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(berlin.find((p) => p.type === 'year')?.value);
  const month = Number(berlin.find((p) => p.type === 'month')?.value);
  const season = month >= 11 ? year : year - 1;
  return { key: `${season}-saison`, year: season };
}

test.describe('A5 Wrapped preview', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One staff session per role; the admin is a desktop Chromium tool (ADR-212).');

  test('empty tab → Vorschau erzeugen → cards + PNGs + audit → moderator read-only → analyst without tab', async ({ page, context, browser, pageErrors, blockedRequests }) => {
    test.setTimeout(240_000);
    const season = finishedSeason();
    const [member] = await members('a5wrapped');
    await named(member, 'Jonas A5', 'Köln');
    await buildVehicle(member.api, {
      photos: 1,
      mods: [{ ...BBS_WHEELS, installed_on: `${season.year}-05` }],
    });
    const record = `/admin/members/${member.username}`;
    const seasonLabel = admin('members', 'wrapped.seasons.saison', { year: String(season.year) });

    await page.setViewportSize(DESKTOP);
    await staffContext(context, 'support');
    await realClock(page);

    // 1. Support, tab Wrapped on the finished season: nothing generated yet.
    await page.goto(`${record}?tab=wrapped&season=${season.key}`);
    await expect(id(page, 'ADM-10.wrapped')).toBeVisible();
    await expect(id(page, 'ADM-10.wrapped.seasons-empty')).toBeVisible();
    await expect(id(page, 'ADM-10.wrapped.empty')).toContainText(admin('members', 'wrapped.empty_title'));
    await expect(page.getByRole('combobox', { name: new RegExp(`^${admin('members', 'wrapped.season')}`) })).toContainText(seasonLabel);

    // 2. "Vorschau erzeugen" (⚿, ADR-215: the password first in a new session): the toast, the row, the cards with their PNGs.
    await id(page, 'ADM-10.wrapped.generate').click();
    await confirmPassword(page);
    await expect(toast(page, admin('members', 'wrapped.flash.generated'))).toBeVisible();
    await expect(id(page, 'ADM-10.wrapped.season-row')).toHaveCount(1);
    const cards = id(page, 'ADM-10.wrapped.card');
    await expect(cards.first()).toBeVisible();
    await expect(page.locator('[data-testid="ADM-10.wrapped.card"][data-kind="intro"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="ADM-10.wrapped.card"][data-kind="top_mod"]')).toHaveCount(1);
    await expect(id(page, 'ADM-10.wrapped.card-image-failed')).toHaveCount(0);
    await expect(id(page, 'ADM-10.activity')).toContainText(admin('audit', 'actions.wrapped.preview_generated'));

    const props = await pageProps<WrappedProps>(context, `${record}?tab=wrapped&season=${season.key}`);
    expect(props.wrapped?.selected).toBe(season.key);
    expect(props.wrapped?.can.generate).toBe(true);
    const presented = props.wrapped?.preview?.cards ?? [];
    expect(presented.length).toBeGreaterThanOrEqual(2);
    expect(keysOf(props.wrapped)).not.toContain('url');
    const png = await context.request.get(presented[0]!.image);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toBe('image/png');
    expect(png.headers()['cache-control']).toContain('no-store');
    expect(png.headers()['cache-control']).toContain('private');

    // 3. The moderator: the cards, no generate button; a direct POST is refused and writes nothing.
    const { context: moderator, page: moderatorPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(moderator, 'moderator');
      await realClock(moderatorPage);
      await moderatorPage.goto(`${record}?tab=wrapped&season=${season.key}`);
      await expect(id(moderatorPage, 'ADM-10.wrapped.view-only')).toBeVisible();
      await expect(id(moderatorPage, 'ADM-10.wrapped.generate')).toHaveCount(0);
      await expect(id(moderatorPage, 'ADM-10.wrapped.card').first()).toBeVisible();
      const refused = await moderator.request.post(`${record}/wrapped`, {
        headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(moderator) },
        data: { season_key: season.key },
        maxRedirects: 0,
      });
      expect(refused.status()).toBe(403);
    } finally {
      await moderator.close();
    }

    // 4. The analyst: members.view without support.view: no tab, and the PNG is refused.
    const { context: analyst, page: analystPage } = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
    try {
      await staffContext(analyst, 'analyst');
      await realClock(analystPage);
      await analystPage.goto(`${record}?tab=wrapped&season=${season.key}`);
      await expect(analystPage.getByRole('tab', { name: admin('members', 'tabs.overview') })).toBeVisible();
      await expect(analystPage.getByRole('tab', { name: admin('members', 'tabs.wrapped') })).toHaveCount(0);
      await expect(id(analystPage, 'ADM-10.wrapped')).toHaveCount(0);
      const image = await analyst.request.get(presented[0]!.image, { maxRedirects: 0 });
      expect(image.status()).toBe(403);
    } finally {
      await analyst.close();
    }
  });
});
