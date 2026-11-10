// BH-20: every action on WEB-02 ends somewhere real. Since PROF-02 exists in the app (M2.1, BL-6, ADR-176 f, contract §5), /u is
// linked like /v: Folgen, Nachricht and Anmelden open the sign-in and Registrieren the sign-up, each with next=/u/{name}, the way
// back to this member; "In der App öffnen" is back in the sticky bar beside Registrieren and opens PROF-02, never SYS-03.
// Reads demo data only: nothing is signed in or registered here, so it costs no sign-up limit and adds no account.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { R34 } from '../support/garage.mjs';

const MEMBER = 'lukas.sc';
const MEMBER_PAGE = `/u/${MEMBER}`;
const NEXT = `?next=${encodeURIComponent(MEMBER_PAGE)}`;
const id = (page: Page, testId: string): Locator => page.locator(`[data-testid="${testId}"]:visible`);
const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Follows a link on WEB-02 and asserts where it lands: the app's own screen with the way back, never SYS-03. */
async function follow(page: Page, link: Locator, expected: { path: string; root: string; search: string }): Promise<void> {
  await expect(link).toBeVisible();
  expect(new URL((await link.getAttribute('href')) ?? '', page.url()).search).toBe(expected.search);

  await link.click();
  await page.waitForURL(`**${expected.path}*`);
  expect(pathOf(page)).toBe(expected.path);
  await expect(page.locator(`[data-testid="${expected.root}"]`).first()).toBeVisible();
  await expect(page.locator('[data-testid^="SYS-03."]')).toHaveCount(0);
}

test.describe('WEB-02 actions (BH-20)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const actions: [string, string, { path: string; root: string; search: string }][] = [
    ['Folgen', 'WEB-02.follow', { path: '/app/sign-in', root: 'AUTH-03.root', search: NEXT }],
    ['Nachricht', 'WEB-02.message', { path: '/app/sign-in', root: 'AUTH-03.root', search: NEXT }],
    ['Anmelden', 'WEB.topBar.signIn', { path: '/app/sign-in', root: 'AUTH-03.root', search: NEXT }],
    ['Registrieren', 'WEB-01.register', { path: '/app/sign-up', root: 'AUTH-04.root', search: NEXT }],
    ['In der App öffnen', 'WEB-01.openInApp', { path: `/app${MEMBER_PAGE}`, root: 'PROF-02.root', search: '' }],
  ];

  for (const [name, testId, expected] of actions) {
    test(`${name} ends on a screen that exists`, async ({ page }) => {
      await page.goto(MEMBER_PAGE);
      await follow(page, id(page, testId), expected);
    });
  }

  test('the sticky bar shows "In der App öffnen" beside Registrieren, with the deep link to /u', async ({ page }) => {
    await page.goto(MEMBER_PAGE);

    const bar = id(page, 'WEB-01.stickyBar');
    await expect(bar).toBeVisible();
    const open = bar.locator('[data-testid="WEB-01.openInApp"]');
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute('href', new RegExp(`/app/u/${MEMBER.replace('.', '\\.')}$`));
    await expect(open).toHaveAttribute('data-deep-link', `speedclub://u/${MEMBER}`);
    await expect(bar.locator('[data-testid="WEB-01.register"]')).toBeVisible();
    const [openBox, registerBox] = await Promise.all([open.boundingBox(), id(page, 'WEB-01.register').boundingBox()]);
    expect(Math.abs((openBox?.y ?? 0) - (registerBox?.y ?? -100)), 'side by side').toBeLessThanOrEqual(1);
  });

  test('every link into the app on the page leads back to this member', async ({ page }) => {
    await page.goto(MEMBER_PAGE);
    const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    const next = hrefs.filter((href) => href.includes('next='));

    expect(next.length).toBeGreaterThanOrEqual(4);
    for (const href of next) expect(new URL(href, page.url()).searchParams.get('next'), href).toBe(MEMBER_PAGE);
    expect(hrefs.filter((href) => href.includes('/app/u/'))).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`/app/u/${MEMBER.replace('.', '\\.')}$`))]));
  });

  test('/v keeps its links: the app, and sign-up and sign-in that come back', async ({ page }) => {
    await page.goto(`/v/${R34.slug}`);

    await expect(id(page, 'WEB-01.openInApp')).toHaveAttribute('href', new RegExp(`/app/v/${R34.slug}$`));
    await expect(id(page, 'WEB-01.register')).toHaveAttribute('href', new RegExp(`/app/sign-up\\?next=%2Fv%2F${R34.slug}$`));
    await expect(id(page, 'VEH-01.ownerRow.follow')).toHaveAttribute('href', new RegExp(`/app/sign-in\\?next=%2Fv%2F${R34.slug}$`));
  });
});
