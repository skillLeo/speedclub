// Client preview screenshots of the showcase (Home, vehicle page, Garage, QR, Messages, admin dashboard) on an iPhone 15 Pro viewport.
// Same sign-ins and secrets as the crawl (environment only, never logged):
//   CRAWL_BASE_URL=https://… CRAWL_MEMBER_PASSWORD=… CRAWL_STAFF_PASSWORD=… CRAWL_STAFF_TOTP_SECRET=… \
//   node scripts/dev/qa-run.mjs web/node_modules/.bin/playwright test --config=web/tests/e2e/crawl/client-screens.config.ts
// Output: docs/reports/phase-4/showcase-screens/<n>-<name>.png (CRAWL_SCREENS_DIR overrides it).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { endMemberSession, endStaffSession, memberSignIn, resolveTokens, staffSignIn, TARGET, useMemberSession } from './lib';

const OUT = process.env.CRAWL_SCREENS_DIR ?? fileURLToPath(new URL('../../../../docs/reports/phase-4/showcase-screens/', import.meta.url));

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Photos fade in from their blurhash; give the last ones a moment.
  await page.waitForTimeout(1500);
}

async function shoot(page: Page, file: string, url: string): Promise<void> {
  const response = await page.goto(`${TARGET.baseUrl}${url}`, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 0, `${url}`).toBeLessThan(400);
  await settle(page);
  await page.screenshot({ path: path.join(OUT, file) });
}

test('showcase screens for the client', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const member = await memberSignIn();
  const tokens = await resolveTokens(member.api);
  const vehicleId = tokens.values.myVehicleId;
  const slug = tokens.values.mySlug;
  expect(vehicleId, 'the showcase member has a build').toBeTruthy();

  const context = await browser.newContext({ ...test.info().project.use });
  await useMemberSession(context, member);
  const page = await context.newPage();
  await shoot(page, '1-home.png', '/app/');
  await shoot(page, '2-vehicle-page.png', `/v/${slug}`);
  await shoot(page, '3-garage.png', '/app/garage');
  await shoot(page, '4-qr.png', `/app/qr/${vehicleId}`);
  await shoot(page, '5-messages.png', '/app/messages');
  await context.close();
  expect(await endMemberSession(member)).toBeNull();

  const staff = await staffSignIn();
  const admin = await browser.newContext({ ...test.info().project.use });
  await admin.addCookies(staff.cookies);
  const adminPage = await admin.newPage();
  await shoot(adminPage, '6-admin-dashboard.png', '/admin');
  expect(await endStaffSession(staff, admin)).toBeNull();
  await admin.close();
});
