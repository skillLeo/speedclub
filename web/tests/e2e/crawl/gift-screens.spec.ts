// M5.9f owner report: the 8 iPhone-size screenshots of the gift features (owner gift detail "show the owner"), on the showcase member
// sebastian.demo (DemoShowcaseSeeder + GiftDemoSeeder). Same sign-in and secrets as the crawl (environment only, never logged):
//   CRAWL_BASE_URL=https://… CRAWL_MEMBER_PASSWORD=… \
//   node scripts/dev/qa-run.mjs web/node_modules/.bin/playwright test --config=web/tests/e2e/crawl/gift-screens.config.ts
// Output: docs/reports/phase-5/gift-screens/<n>-<name>.png (CRAWL_SCREENS_DIR overrides it). The scanner (DEX-02) is native only: the
// member web shows its "nur in der App" state, which is what this picture shows.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { endMemberSession, memberSignIn, resolveTokens, TARGET, useMemberSession } from './lib';

const OUT = process.env.CRAWL_SCREENS_DIR ?? fileURLToPath(new URL('../../../../docs/reports/phase-5/gift-screens/', import.meta.url));

type Json = Record<string, unknown>;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Photos fade in from their blurhash; give the last ones a moment.
  await page.waitForTimeout(2000);
}

async function shoot(page: Page, file: string, url: string, ready?: string): Promise<void> {
  const response = await page.goto(`${TARGET.baseUrl}${url}`, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 0, url).toBeLessThan(400);
  if (ready) await page.locator(ready).first().waitFor({ timeout: 30_000 });
  await settle(page);
  await page.screenshot({ path: path.join(OUT, file) });
}

test('gift screens for the owner', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const member = await memberSignIn();
  try {
    const tokens = await resolveTokens(member.api);
    const spot = tokens.values.mySpot;
    expect(spot, 'the showcase member has spotted a car').toBeTruthy();
    // His RX-7 FD (m5.9f demo handover: Build Score 622, Stufe 4, ranks), by its seeded slug prefix.
    const vehicles = ((await (await member.api.get('/api/v1/me/vehicles')).json()) as { data: Json[] }).data;
    const fd = vehicles.find((v) => String(v.slug ?? '').startsWith('mazda-rx-7-fd-')) ?? vehicles.find((v) => v.is_main === true) ?? vehicles[0];
    expect(fd, 'the showcase member has a build').toBeTruthy();

    const context = await browser.newContext({ ...test.info().project.use });
    await useMemberSession(context, member);
    const page = await context.newPage();
    await shoot(page, '1-dex.png', '/app/dex', '[data-testid="DEX-01.root"]');
    await shoot(page, '2-scanner.png', '/app/scan', '[data-testid^="DEX-02"]');
    await shoot(page, '3-spot-reveal.png', `/app/dex/spot/${spot}`, '[data-testid="DEX-03.card"]');
    await shoot(page, '4-vehicle-build-score.png', `/app/v/${String(fd?.slug)}`, '[data-testid="VEH-01.score.gauge"]');
    // The gauge sits under the photo stage: bring it into the picture.
    await page.getByTestId('VEH-01.score').scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, '4-vehicle-build-score.png') });
    await shoot(page, '5-badges.png', '/app/profile/badges', '[data-testid^="BDG-01"]');
    await shoot(page, '6-home-car-of-the-day.png', '/app/', '[data-testid^="HOME-01"]');
    await shoot(page, '7-wrapped.png', '/app/wrapped/2026-saison', '[data-testid^="WRP-01.card"]');
    await shoot(page, '8-share-card.png', `/app/share-card/${String(fd?.id)}`, '[data-testid^="VEH-07"]');
    await context.close();
  } finally {
    await endMemberSession(member);
  }
});
