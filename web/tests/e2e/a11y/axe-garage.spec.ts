// Axe on the M1.6 and M1.7 screens, no serious or critical issue on the whole page: GAR-01…12 with the wizard steps, VEH-01…05,
// QR-01…04, the in-app resolver and the three WEB-06 states, in the three themes on a phone and in carbon on desktop, plus
// the overlays a member opens there (draft sheet, category sheet, download sheet, reissue dialog, discard guard, viewer).
// Owner screens as lukas.sc (read only), public ones as a guest. Chromium only (playwright.config.ts).
import type { BrowserContext } from '@playwright/test';
import { applyAuth } from '../support/auth.mjs';
import { assertNoSeriousAxeViolations } from '../support/a11y.mjs';
import { expect, test } from '../support/fixtures';
import { demoIds, QR_STATES, R34, type DemoIds } from '../support/garage.mjs';
import { THEMES } from '../support/tokens.mjs';

/** `expected`: the 4xx the page or its API answers by design, which the browser logs as a failed resource. */
type Screen = { name: string; path: (ids: DemoIds) => string; auth: string; ready: string; expected?: { status: number; url: RegExp } };

const V = `/app/v/${R34.slug}`;
const SCREENS: Screen[] = [
  { name: 'GAR-01 garage', path: () => '/app/garage', auth: 'member', ready: 'GAR-01.list' },
  { name: 'GAR-01 empty', path: () => '/app/garage', auth: 'member-empty', ready: 'GAR-01.empty' },
  { name: 'GAR-01 guest', path: () => '/app/garage', auth: 'guest', ready: 'GAR-01.guest' },
  { name: 'GAR-02 owner vehicle', path: (d) => `/app/garage/${d.r34}`, auth: 'member', ready: 'GAR-02.title' },
  { name: 'GAR-03 step 1 new', path: () => '/app/add-vehicle/new/vehicle', auth: 'member-empty', ready: 'GAR-03.make' },
  { name: 'GAR-03 step 2', path: (d) => `/app/add-vehicle/${d.draft}/specs`, auth: 'member', ready: 'GAR-03.engineCode' },
  { name: 'GAR-03 step 3', path: (d) => `/app/add-vehicle/${d.draft}/photos`, auth: 'member', ready: 'GAR-03.photos.add' },
  { name: 'GAR-03 step 4', path: (d) => `/app/add-vehicle/${d.draft}/review`, auth: 'member', ready: 'GAR-03.review.card' },
  { name: 'GAR-04 published', path: (d) => `/app/published/${d.r34}`, auth: 'member', ready: 'GAR-04.qr' },
  { name: 'GAR-05 basics', path: (d) => `/app/garage/${d.r34}/basics`, auth: 'member', ready: 'GAR-05.make' },
  { name: 'GAR-06 specs', path: (d) => `/app/garage/${d.r34}/specs`, auth: 'member', ready: 'GAR-06.engineCode' },
  { name: 'GAR-07 photos', path: (d) => `/app/garage/${d.r34}/photos`, auth: 'member', ready: 'GAR-07.photos' },
  { name: 'GAR-08 photo', path: (d) => `/app/garage/${d.r34}/photos/${d.r34Photo}`, auth: 'member', ready: 'GAR-08.stage' },
  { name: 'GAR-09 mods', path: (d) => `/app/garage/${d.r34}/mods`, auth: 'member', ready: 'GAR-09.list' },
  { name: 'GAR-10 mod', path: (d) => `/app/garage/${d.r34}/mods/${d.r34Mod}`, auth: 'member', ready: 'GAR-10.preview' },
  { name: 'GAR-11 history', path: (d) => `/app/garage/${d.r34}/history`, auth: 'member', ready: 'GAR-11.list' },
  { name: 'GAR-12 visibility', path: (d) => `/app/garage/${d.r34}/visibility`, auth: 'member', ready: 'GAR-12.choice' },
  { name: 'VEH-01 vehicle', path: () => V, auth: 'guest', ready: 'VEH-01.title' },
  { name: 'VEH-01 unavailable', path: () => '/app/v/toyota-gr86-zn8-6g12gv4h', auth: 'guest', ready: 'VEH-01.unavailable', expected: { status: 404, url: /\/api\/v1\/public\/vehicles\/toyota-gr86-zn8-6g12gv4h/ } },
  { name: 'VEH-02 mod', path: (d) => `${V}/mods/${d.r34Mod}`, auth: 'guest', ready: 'VEH-02.title' },
  { name: 'VEH-03 gallery', path: () => `${V}/gallery`, auth: 'guest', ready: 'VEH-03.count' },
  { name: 'VEH-04 viewer', path: () => `/app/viewer?slug=${R34.slug}&index=1`, auth: 'guest', ready: 'VEH-04.viewer.counter' },
  { name: 'VEH-05 update', path: (d) => `${V}/updates/${d.r34Update}`, auth: 'guest', ready: 'VEH-05.title' },
  { name: 'QR-01 codes', path: () => '/app/profile/qr', auth: 'member', ready: 'QR-01.list' },
  { name: 'QR-02 detail', path: (d) => `/app/qr/${d.r34}`, auth: 'member', ready: 'QR-02.card' },
  { name: 'QR-03 placement', path: (d) => `/app/qr/${d.r34}/placement`, auth: 'member', ready: 'QR-03.diagram' },
  { name: 'QR-04 preview', path: (d) => `/app/qr/${d.r34}/preview`, auth: 'member', ready: 'QR-04.card' },
  { name: 'QR-RESOLVE revoked', path: () => `/app/c/${QR_STATES.revoked.code}`, auth: 'guest', ready: 'QR-RESOLVE.state.revoked' },
  { name: 'WEB-06 revoked', path: () => `/C/${QR_STATES.revoked.code}`, auth: 'guest', ready: 'WEB-06.root', expected: { status: 410, url: /\/C\/APPY9FZ9/ } },
  { name: 'WEB-06 private', path: () => `/C/${QR_STATES.private.code}`, auth: 'guest', ready: 'WEB-06.root', expected: { status: 404, url: /\/C\/5A7XE8ET/ } },
  { name: 'WEB-06 not found', path: () => `/C/${QR_STATES.notFound.code}`, auth: 'guest', ready: 'WEB-06.root', expected: { status: 404, url: /\/C\/ZZZZZZZZ/ } },
];

const CELLS = [...THEMES.map((theme) => ({ theme, width: 390, height: 844 })), { theme: 'carbon', width: 1280, height: 800 }];

async function signIn(context: BrowserContext, auth: string): Promise<void> {
  if (auth !== 'guest') await applyAuth(context, auth);
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    for (const { theme, width, height } of CELLS) {
      test(`${theme} at ${width}`, async ({ page, context, qaGoto, byTestId, expectFailedResponses }) => {
        if (screen.expected) expectFailedResponses([screen.expected]);
        await signIn(context, screen.auth);
        await page.setViewportSize({ width, height });
        await qaGoto(screen.path(await demoIds()), { theme });
        await expect(byTestId(screen.ready)).toBeVisible();
        await assertNoSeriousAxeViolations(page);
      });
    }
  });
}

test.describe('open overlays', () => {
  test('GAR-01 with the draft sheet', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    const { draft } = await demoIds();
    await qaGoto('/app/garage');
    await byTestId(`GAR-01.draft.${draft}.more`).click();
    await expect(byTestId('GAR-01.draftSheet')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });

  test('GAR-03 step 1 with its inline errors', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member-empty');
    await qaGoto('/app/add-vehicle/new/vehicle');
    await byTestId('GAR-03.vehicle.cta.primary').click();
    await expect(byTestId('GAR-03.make.error')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });

  test('GAR-03 with the make sheet', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member-empty');
    await qaGoto('/app/add-vehicle/new/vehicle');
    await byTestId('GAR-03.make').click();
    await expect(byTestId('GAR-03.makeSheet')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });

  test('GAR-09 with the category sheet', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    await qaGoto(`/app/garage/${r34}/mods`);
    await byTestId('GAR-09.add').click();
    await expect(byTestId('GAR-09.categories')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });

  test('GAR-05 with the discard guard', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    await qaGoto(`/app/garage/${r34}`);
    await byTestId('GAR-02.tool.edit').click();
    await byTestId('GAR-02.editSheet.basics').click();
    await page.getByTestId('GAR-05.nickname').fill('Godzilla');
    await byTestId('GAR-05.header.back').click();
    await expect(byTestId('GAR-05.discard')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await byTestId('GAR-05.discard.discard').click();
    await expect(byTestId('GAR-02.root')).toBeVisible();
  });

  test('QR-02 with the download sheet, then the reissue dialog', async ({ page, context, qaGoto, byTestId }) => {
    await applyAuth(context, 'member');
    const { r34 } = await demoIds();
    await qaGoto(`/app/qr/${r34}`);
    await byTestId('QR-02.download').click();
    await expect(byTestId('QR-02.downloadSheet')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="QR-02.downloadSheet"]:visible')).toHaveCount(0);
    await byTestId('QR-02.reissue').click();
    await expect(byTestId('QR-02.reissueDialog')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
    await byTestId('QR-02.reissueCancel').click();
  });

  test('VEH-01 with the viewer open over it', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(V);
    await byTestId('VEH-01.hero.0').click();
    await expect(byTestId('VEH-04.viewer')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });

  test('VEH-01 with the auth sheet of Folgen', async ({ page, qaGoto, byTestId }) => {
    await qaGoto(V);
    await byTestId('VEH-01.ownerRow.follow').click();
    await expect(byTestId('shell.authRequired')).toBeVisible();
    await assertNoSeriousAxeViolations(page);
  });
});
