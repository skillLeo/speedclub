// QA-C06 (QA H1): pushed screens without the tab bar end above the home indicator. MSG-03 (the recipient list), MSG-04 (a message
// request) and SET-13 (Konto löschen) ended 2 to 34 px inside the bottom safe area of an iPhone home-screen app. Chromium is the one
// engine that emulates env(safe-area-inset-*) (CDP Emulation.setSafeAreaInsetsOverride), so this runs on the Chromium project at the
// size of a phone with the iPhone 15 Pro insets (59 top, 34 bottom), with the crawl's own layout check (crawl/lib.ts inspectLayout).
import { expect, test } from '../support/fixtures';
import { DEMO_SHOWCASE, sessionOf, useSession } from '../support/auth.mjs';
import { memberApi } from '../support/garage.mjs';
import { id, open } from '../support/flow';
import { inspectLayout } from '../crawl/lib';

const SAFE = { top: 59, bottom: 34 };

test.use({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test.describe('QA-C06 the end of pushed screens clears the home indicator', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium emulates CSS safe-area insets');

  const pages: { route: string; path: () => Promise<string> }[] = [
    { route: 'SET-13', path: async () => '/app/settings/data/delete' },
    { route: 'MSG-03', path: async () => '/app/new-message' },
    {
      route: 'MSG-04',
      path: async () => {
        const api = await memberApi(await sessionOf(DEMO_SHOWCASE));
        try {
          const list = await api.get('conversations?folder=requests');
          const first = (list.body?.data ?? [])[0] as { id?: string } | undefined;
          if (!first?.id) throw new Error('sebastian.demo has no message request in the seed');
          return `/app/messages/requests/${first.id}`;
        } finally {
          await api.dispose();
        }
      },
    },
  ];

  for (const { route, path } of pages) {
    test(`${route}: nothing interactive in the bottom safe area at the end of the scroll`, async ({ page, context }) => {
      await useSession(context, await sessionOf(DEMO_SHOWCASE));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { ...SAFE, left: 0, right: 0 } } as never);
      await open(page, await path());
      await expect(id(page, `${route}.root`).first()).toBeVisible();
      // MSG-03 lists candidates once they load; MSG-04 its messages.
      if (route === 'MSG-03') await expect(page.locator('[data-testid^="MSG-03.candidate."]:visible').first()).toBeVisible();
      if (route === 'MSG-04') await expect(page.locator('[data-testid^="MSG-04.message."]:visible').first()).toBeVisible({ timeout: 30_000 });
      const issues = await page.evaluate(inspectLayout, { phone: true, safeArea: SAFE });
      expect(issues.filter((issue) => issue.type === 'under-safe-area')).toEqual([]);
    });
  }
});
