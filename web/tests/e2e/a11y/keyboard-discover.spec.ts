// Keyboard activation of the M2.3 Discover links (WCAG 2.1.1): a focused make tile, result card, model row, wheel-table build,
// "Ähnliche suchen" and the owner row of VEH-01 open their target with Enter, as a click does. These controls are links
// (role="link"); Chromium and WebKit, focus set directly, so WebKit's Option+Tab rule (README) does not apply.
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { demoIds, R34 } from '../support/garage.mjs';
import { qaUrl } from '../support/qa.mjs';

type Case = { name: string; open: (ids: Awaited<ReturnType<typeof demoIds>>) => string; control: string; target: RegExp };

const CASES: Case[] = [
  { name: 'a DISC-01 make tile opens DISC-03', open: () => '/app/discover', control: '[data-testid="DISC-01.makes.bmw"]', target: /^\/app\/discover\/make\/bmw$/ },
  {
    name: 'a DISC-02 result card opens VEH-01',
    open: () => '/app/discover/search?make=bmw&model=m4',
    control: '[data-testid^="DISC-02.vehicle."][data-testid$=".body"]',
    target: /^\/app\/v\/bmw-m4-/,
  },
  {
    name: 'a DISC-03 model row opens DISC-04',
    open: () => '/app/discover/make/bmw',
    control: '[data-testid="DISC-03.model.m4"] [role="link"], [data-testid="DISC-03.model.m4"][role="link"]',
    target: /^\/app\/discover\/model\/bmw--m4$/,
  },
  {
    name: 'a build of the DISC-04 wheel table opens VEH-01',
    open: () => '/app/discover/model/bmw--m3?segment=wheels',
    control: '[data-testid^="DISC-04.wheels."][data-testid$=".open"]',
    target: /^\/app\/v\/bmw-m3-/,
  },
  {
    name: 'VEH-02 "Ähnliche suchen" opens DISC-02',
    open: (ids) => `/app/v/${R34.slug}/mods/${ids.r34Mod}`,
    control: '[data-testid="VEH-02.searchSimilar"]',
    target: /^\/app\/discover\/search$/,
  },
  { name: 'the VEH-01 owner row opens PROF-02', open: () => `/app/v/${R34.slug}`, control: '[data-testid="VEH-01.ownerRow.identity"]', target: /^\/app\/u\/lukas\.sc$/ },
];

const pathOf = (page: Page): string => new URL(page.url()).pathname;

for (const { name, open, control, target } of CASES) {
  test(`Enter on ${name}`, async ({ page }) => {
    await page.goto(qaUrl(open(await demoIds())));
    const focusable = page.locator(`:is(${control}):visible`).first();
    await expect(focusable).toBeVisible();
    await focusable.focus();
    await expect(focusable).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => pathOf(page), { message: `Enter on ${control}` }).toMatch(target);
  });
}
