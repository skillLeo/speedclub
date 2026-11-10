// A3 Branding publish and rollback (02_PRODUCT_SPEC §4 A3, m3.5-contract §1, §2 ADM-28/34/35 and §4, 06_ADMIN_SPEC §1.5, ADR-129/151/152,
// ADR-215, ADR-236), on Chromium and WebKit. Staff: a content editor of its own per browser project (support/backend.php `a3-brand-*`,
// brand.manage), signed in here over HTTP in a session of its own (it confirms its password); the audit rows are read with the shared
// admin session (read only). Marke & Theme → a bright photo (bmw-e92-01) is uploaded and refused by the draft with the contrast message
// → a night photo (nissan-r35-01, passes the ADR-129/151 rule anywhere) with its focal point moved → saved → ADM-34: the frames (mobile
// and desktop × Carbon, Schwarz, Hell) load the app with the preview token, and the app-config they read carries the draft hero → publish
// with a reason behind the password dialog → the member web (/app Welcome, a guest context opened before the publish) shows the new hero
// after a forced refetch (a reload sends If-None-Match and gets the new ETag) → ADM-35: the new version against the one before → rollback
// on the earlier version in a fresh session (one click, a reason, the password) → the old hero is back → audit rows for both.
//
// The live branding is one value for every client, so the two projects never run this at the same time (withFlowLock). Cleanup, inside
// the lock and whatever the outcome: support/backend.php remove-branding-fixture deletes the versions the fixture made (the published one
// and the rollback copy), so the version live before the test is live again without a further copy and ADM-35 keeps its history, and
// the images the fixture uploaded, which no version names any more (the product never deletes brand assets, ADR-236 d; this is test data).
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Frame, Page, Response } from '@playwright/test';
import { admin, confirmPassword, DESKTOP, pageProps, realClock, serverLang, staffContext, toast, withFlowLock } from '../support/admin-flow';
import { applyAuth } from '../support/auth.mjs';
import { brandingState, parkBrandingDraft, removeFixtureBranding } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { browserOf, flowShot, id, open } from '../support/flow';
import { BASE_URL } from '../support/qa.mjs';
import { staffRun, staffSignIn } from '../support/staff.mjs';

const SEED = (name: string): string => fileURLToPath(new URL(`../../../../design/seed-photos/${name}`, import.meta.url));
/** Refused at every focal point: logo 3.1:1 over the 42 % shadow (HeroContrastBrandingTest). */
const BRIGHT = 'bmw-e92-01.jpg';
/** Passes at every focal point: logo 20:1, text ≥ 7.8:1. */
const NIGHT = 'nissan-r35-01.jpg';
const FOCAL = { x: 0.3, y: 0.6 };
const THEMES = ['carbon', 'black', 'light'] as const;

type Hero = { url: string; variants: { width: number; url: string }[]; focal_x: number; focal_y: number } | null;
type AppConfigBody = { data: { branding: { heroes: { welcome: Hero }; welcome_hero: string | null } } };
type BrandProps = {
  editor: { draft: { version: number; mine: boolean } | null; live: { version: number } | null; payload: { heroes: { welcome: { asset_id: string; focal_x: number; focal_y: number } | null } } };
  assets: { id: string; kind: string }[];
};
type AuditRow = { action: string; reason: string | null; actor: { label: string | null }; target: { type: string; id: string } | null };

const pathname = (url: string): string => new URL(url, BASE_URL).pathname;
/** Every URL of a hero (the original and its variants) as a path. */
const heroPaths = (hero: Hero): string[] => (hero ? [hero.url, ...hero.variants.map((v) => v.url)].map(pathname) : []);

/** The sources of FS-1's photo (expo-image renders <img> elements inside the testID's View). */
async function photoSources(page: Page): Promise<string[]> {
  return page.locator('[data-testid="AUTH-02.photo"]:visible img').evaluateAll((images) => images.map((img) => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src).filter(Boolean));
}

async function appConfig(context: BrowserContext, headers: Record<string, string> = {}): Promise<{ status: number; etag: string | null; body: AppConfigBody | null }> {
  const response = await context.request.get('/api/v1/app-config', { headers: { Accept: 'application/json', ...headers } });
  return { status: response.status(), etag: response.headers().etag ?? null, body: response.status() === 200 ? ((await response.json()) as AppConfigBody) : null };
}

/** Uploads a hero photo for the Welcome slot through the picker; the new upload is chosen at once (AssetPicker). */
async function uploadWelcomeHero(page: Page, photo: string): Promise<void> {
  await id(page, 'ADM-28.hero.welcome.choose').click();
  const picker = id(page, 'ADM-28.picker');
  await expect(picker).toBeVisible();
  await page.locator('[data-testid="ADM-28.picker.file"]').setInputFiles(SEED(photo));
  await id(page, 'ADM-28.picker.submit').click();
  await expect(picker).toBeHidden({ timeout: 30_000 });
  await expect(id(page, 'ADM-28.hero.welcome.focal')).toBeVisible();
}

test.describe('A3 branding publish and rollback', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('upload (refused and accepted) → focal point → ADM-34 preview × 3 themes → publish → member web → ADM-35 diff → rollback → audit', async ({ page, context, browser, browserName, pageErrors, blockedRequests }, testInfo) => {
    // The other project's run of this test may hold the lock for its whole length first.
    test.setTimeout(900_000);
    const label = `a3-brand-${browserName}`;

    await withFlowLock('branding', 420_000, async () => {
      // A staff member's branding draft (the content editor's of BrandContentDemoSeeder, DQ-612) is theirs: the engine keeps one draft
      // per key and refuses another's (draft_taken). A3 neither takes it over nor discards it: park-branding-draft moves the row aside
      // for the test (its key column only), and remove-branding-fixture puts it back, column for column, once A3's versions are gone.
      await removeFixtureBranding();
      const staffDraft = (await brandingState()).staff_draft;
      expect(staffDraft?.parked ?? false, 'no draft is left parked by an earlier run').toBe(false);
      const { parked } = await parkBrandingDraft();
      expect(parked?.sha256 ?? null).toBe(staffDraft?.sha256 ?? null);
      try {
        const before = await brandingState();
        expect(before.foreign_draft, 'with the staff draft parked, no draft of a real staff member is under the key').toBeNull();
        expect(before.live, 'a live branding version (DemoSeeder / first install)').not.toBeNull();
        const liveBefore = before.live as number;
        const member = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] });
        try {
          await test.step('the member web before: Welcome with the live hero, its app-config ETag', async () => {
            const live = await appConfig(member.context);
            expect(live.status).toBe(200);
            expect(live.etag).not.toBeNull();
            await open(member.page, '/app/welcome');
            await expect(id(member.page, 'AUTH-02.root')).toBeVisible();
            await expect.poll(() => photoSources(member.page)).not.toEqual([]);
          });
          const liveHero = (await appConfig(member.context)).body?.data.branding.heroes.welcome ?? null;
          const sourcesBefore = await photoSources(member.page);
          const etagBefore = (await appConfig(member.context)).etag;

          const editor = await staffContext(context, label);
          const now = await realClock(page);
          let newAsset = '';
          let draftVersion = 0;

          await test.step('ADM-28: a bright photo is refused by the draft with the contrast message', async () => {
            await open(page, '/admin/brand', { now });
            await expect(id(page, 'ADM-28.draft-bar')).toBeVisible();
            await uploadWelcomeHero(page, BRIGHT);
            const verdict = id(page, 'ADM-28.hero.welcome.contrast');
            await expect(verdict).toContainText(admin('brand', 'contrast.fails'));
            await id(page, 'ADM-28.save').click();
            // The server's refusal (BrandingSchema, ADR-236 b) under the slot: the ratio it measured and the 4,5:1 it needs.
            const refusal = id(page, 'ADM-28.hero.welcome').getByRole('alert');
            await expect(refusal).toContainText(serverLang('content', 'brand.hero_contrast').split('(')[0]?.trim() ?? '');
            await expect(refusal).toContainText(/nötig 4,5:1/);
            await expect(id(page, 'ADM-28.dirty')).toBeVisible();
            await flowShot(page, testInfo, 'ADM-28-heroRefused', { phase: 3 });
            const props = await pageProps<BrandProps>(context, '/admin/brand');
            expect(props.editor.draft, 'the refused draft was not saved').toBeNull();
          });

          await test.step('ADM-28: a night photo passes; the focal point moves; the draft is saved', async () => {
            // The measurement at the photo's first point is held back, so the move below aborts it in flight: the verdict must be the
            // latest one. Before the fix that abort settled late and showed "konnte nicht gemessen werden" (E2E run 3, WebKit).
            const contrastRoute = '**/admin/brand/assets/*/contrast?*';
            let held = 0;
            await page.route(contrastRoute, async (route) => {
              const url = new URL(route.request().url());
              const moved = Math.abs(Number(url.searchParams.get('focal_x')) - FOCAL.x) < 0.02 && Math.abs(Number(url.searchParams.get('focal_y')) - FOCAL.y) < 0.02;
              if (!moved) {
                held++;
                await new Promise((resolve) => setTimeout(resolve, 1500));
              }
              // An aborted request can no longer be continued.
              await route.continue().catch(() => undefined);
            });
            await uploadWelcomeHero(page, NIGHT);
            const focal = id(page, 'ADM-28.hero.welcome.focal');
            const box = await focal.boundingBox();
            if (!box) throw new Error('The focal point area has no box');
            // The verdict is measured again at the new point (HeroSlot, 250 ms after the move): saved only once it is in, as a person reads it.
            const measured = page.waitForResponse((r) => {
              const url = new URL(r.url());
              return url.pathname.endsWith('/contrast') && Math.abs(Number(url.searchParams.get('focal_x')) - FOCAL.x) < 0.02 && Math.abs(Number(url.searchParams.get('focal_y')) - FOCAL.y) < 0.02;
            });
            await focal.click({ position: { x: box.width * FOCAL.x, y: box.height * FOCAL.y } });
            await expect(focal).toHaveAttribute('aria-valuetext', admin('brand', 'focal.value', { x: String(FOCAL.x * 100), y: String(FOCAL.y * 100) }));
            const verdict = (await (await measured).json()) as { passes: boolean };
            expect(verdict.passes, 'the night photo passes at the moved focal point').toBe(true);
            await expect(id(page, 'ADM-28.hero.welcome.contrast')).toContainText(admin('brand', 'contrast.passes'));
            expect(held, 'the measurement at the first point was held back and overtaken').toBeGreaterThan(0);
            await page.unroute(contrastRoute);
            await id(page, 'ADM-28.save').click();
            await expect(toast(page, admin('config', 'flash.draft_saved'))).toBeVisible();
            await expect(id(page, 'ADM-28.dirty')).toHaveCount(0);
            const props = await pageProps<BrandProps>(context, '/admin/brand');
            expect(props.editor.draft?.mine).toBe(true);
            const welcome = props.editor.payload.heroes.welcome;
            if (!welcome) throw new Error('The saved draft has no Welcome hero');
            expect(welcome.focal_x).toBeCloseTo(FOCAL.x, 1);
            expect(welcome.focal_y).toBeCloseTo(FOCAL.y, 1);
            newAsset = welcome.asset_id;
            draftVersion = props.editor.draft?.version ?? 0;
            expect(draftVersion).toBeGreaterThan(liveBefore);
            await flowShot(page, testInfo, 'ADM-28-heroDraft', { phase: 3 });
          });

          let draftHero: Hero = null;
          await test.step('ADM-34: mobile and desktop frames × Carbon, Schwarz, Hell load the app with the draft', async () => {
            // The frames' app-config answers: which frame read which hero.
            const seen: { frame: Frame; hero: string[] }[] = [];
            const onResponse = (response: Response): void => {
              if (!response.url().includes('/api/v1/app-config') || response.status() !== 200 || !response.request().headers()['x-preview-token']) return;
              void response.json().then(
                (body: AppConfigBody) => seen.push({ frame: response.frame(), hero: heroPaths(body.data.branding.heroes.welcome) }),
                () => undefined,
              );
            };
            page.on('response', onResponse);
            try {
              await id(page, 'ADM-28.preview').click();
              await expect(id(page, 'ADM-34')).toBeVisible();
              await expect(id(page, 'ADM-34.token')).toContainText(admin('content', 'preview.with_drafts'));
              await expect(id(page, 'ADM-34.token')).toContainText(`${admin('content', 'versions.keys.branding')} v${draftVersion}`);
              // The token of this page: the draft hero as the preview API answers it, and not live.
              const { preview } = await pageProps<{ preview: { token: string } }>(context, '/admin/content/preview');
              draftHero = (await appConfig(context, { 'X-Preview-Token': preview.token })).body?.data.branding.heroes.welcome ?? null;
              expect(draftHero, 'the preview token answers the draft hero').not.toBeNull();
              expect(heroPaths(draftHero)).not.toEqual(heroPaths(liveHero));
              const expected = heroPaths(draftHero);

              for (const theme of THEMES) {
                await id(page, 'ADM-34.theme').locator(`[data-testid="segment.${theme}"]`).click();
                for (const frameName of ['mobile', 'desktop'] as const) {
                  const iframe = page.locator(`[data-testid="ADM-34.frame.${frameName}"] iframe`);
                  await iframe.scrollIntoViewIfNeeded();
                  // DQ-613: the frame asks for the theme with previewTheme, which the app honours only beside a valid preview token (qaTheme is a
                  // QA override that production builds ignore).
                  await expect(iframe).toHaveAttribute('src', new RegExp(`[?&]previewTheme=${theme}(&|$)`));
                  await expect(iframe).toHaveAttribute('src', /preview=/);
                  const frame = await (await iframe.elementHandle())?.contentFrame();
                  if (!frame) throw new Error(`No ${frameName} frame`);
                  await expect(frame.locator('html')).toHaveAttribute('data-qa-theme', theme, { timeout: 30_000 });
                  await expect
                    .poll(() => seen.some((s) => s.frame === frame && s.hero.length > 0 && s.hero.every((p) => expected.includes(p))), {
                      message: `the ${frameName} frame (${theme}) read the draft hero through the preview token`,
                      timeout: 30_000,
                    })
                    .toBe(true);
                }
                await flowShot(page, testInfo, `ADM-34-brandDraft-${theme}`, { phase: 3 });
              }
            } finally {
              page.off('response', onResponse);
            }

            // Opened with the token, Welcome shows the draft hero; without it, the live one (the preview never publishes).
            const { preview } = await pageProps<{ preview: { token: string } }>(context, '/admin/content/preview');
            const previewTab = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] });
            try {
              await open(previewTab.page, `/app/welcome?preview=${encodeURIComponent(preview.token)}`);
              await expect(id(previewTab.page, 'AUTH-02.root')).toBeVisible();
              const drafted = heroPaths(draftHero);
              await expect.poll(async () => (await photoSources(previewTab.page)).some((src) => drafted.includes(pathname(src)))).toBe(true);
            } finally {
              await previewTab.context.close();
            }
            expect(heroPaths((await appConfig(member.context)).body?.data.branding.heroes.welcome ?? null)).toEqual(heroPaths(liveHero));
          });
          const newPaths = heroPaths(draftHero);

          const publishReason = `A3 ${browserName}: neues Welcome-Foto zur Saisoneröffnung, R35 bei Nacht`;
          await test.step('publish with a reason behind the password dialog', async () => {
            await open(page, '/admin/brand', { now: new Date().toISOString() });
            await id(page, 'ADM-28.publish').click();
            const dialog = id(page, 'ADM-28.publish-dialog');
            await expect(dialog).toBeVisible();
            await id(page, 'ADM-28.publish-dialog.reason').fill(publishReason);
            await id(page, 'ADM-28.publish-dialog.confirm').click();
            await confirmPassword(page);
            await expect(toast(page, admin('config', 'flash.published'))).toBeVisible();
            const props = await pageProps<BrandProps>(context, '/admin/brand');
            expect(props.editor.draft).toBeNull();
            expect(props.editor.live?.version).toBe(draftVersion);
          });

          await test.step('the member web picks the new hero up with a forced refetch (new ETag)', async () => {
            const after = await appConfig(member.context, etagBefore ? { 'If-None-Match': etagBefore } : {});
            expect(after.status, 'the old ETag no longer matches').toBe(200);
            expect(after.etag).not.toBe(etagBefore);
            expect(heroPaths(after.body?.data.branding.heroes.welcome ?? null)).toEqual(newPaths);
            // The open Welcome tab: a reload starts the app from its cached config and refetches it (If-None-Match, ETag'd GET app-config).
            const refetched = member.page.waitForResponse((r) => r.url().includes('/api/v1/app-config') && r.request().method() === 'GET');
            await member.page.reload();
            expect((await refetched).status()).toBe(200);
            await expect(id(member.page, 'AUTH-02.root')).toBeVisible();
            await expect
              .poll(async () => (await photoSources(member.page)).some((src) => newPaths.includes(pathname(src))), { message: 'Welcome shows the published hero', timeout: 30_000 })
              .toBe(true);
            await flowShot(member.page, testInfo, 'AUTH-02-publishedHero', { phase: 3 });
          });

          await test.step('ADM-35: the new version against the one before', async () => {
            await open(page, `/admin/content/versions?key=branding&version=${draftVersion}`, { now: new Date().toISOString() });
            await expect(id(page, 'ADM-35.table')).toBeVisible();
            await expect(id(page, 'ADM-35.row')).toHaveCount(before.versions.length + 1);
            const detail = id(page, 'ADM-35.detail');
            await expect(detail).toContainText(admin('content', 'versions.compare', { version: String(draftVersion), previous: String(liveBefore) }));
            await expect(detail).toContainText(publishReason);
            const diff = id(page, 'ADM-35.diff');
            // DQ-626/DQ-668: in ADM-28's words, never schema keys or asset ids, and only what changed (the welcome photo); the
            // unchanged fields wait behind "Alle Felder anzeigen".
            await expect(diff.locator('[data-diff="changed"], [data-diff="added"]').filter({ hasText: admin('brand', 'heroes.welcome') })).toHaveCount(1);
            await expect(diff.locator('[data-diff="same"]')).toHaveCount(0);
            await expect(diff).not.toContainText('heroes.welcome.asset_id');
            await expect(diff).not.toContainText(newAsset);
            await id(page, 'ADM-35.diff.toggle').click();
            await expect(diff.locator('[data-diff="same"]').first()).toBeVisible();
            await id(page, 'ADM-35.diff.toggle').click();
            await flowShot(page, testInfo, 'ADM-35-brandPublished', { phase: 3 });
          });

          const rollbackReason = `A3 ${browserName}: Foto zurückgezogen, Rechte des Fotografen ungeklärt`;
          let rollbackVersion = 0;
          await test.step('rollback to the earlier version in a fresh session: one click, a reason, the password', async () => {
            const second = await browserOf(browser, null, { pageErrors, blockedRequests, expected: [] }, DESKTOP);
            try {
              // A new sign-in has no recent password confirmation (ADR-215), so the rollback must ask for it.
              await second.context.addCookies(await staffSignIn(await staffRun(), label));
              const rbNow = await realClock(second.page);
              await open(second.page, `/admin/content/versions?key=branding&version=${liveBefore}`, { now: rbNow });
              const rollback = id(second.page, 'ADM-35.rollback');
              await expect(rollback).toHaveText(admin('content', 'versions.rollback', { version: String(liveBefore) }));
              await rollback.click();
              await expect(id(second.page, 'ADM-35.rollback-dialog')).toBeVisible();
              await id(second.page, 'ADM-35.rollback-dialog.reason').fill(rollbackReason);
              await id(second.page, 'ADM-35.rollback-dialog.confirm').click();
              await confirmPassword(second.page);
              await expect(toast(second.page, admin('config', 'flash.rolled_back'))).toBeVisible();
              await expect(id(second.page, 'ADM-35.row')).toHaveCount(before.versions.length + 2);
              const props = await pageProps<{ versions: { version: number; status: string; reason: string | null }[] }>(second.context, '/admin/content/versions?key=branding');
              const newest = [...props.versions].sort((a, b) => b.version - a.version)[0];
              expect(newest?.status).toBe('published');
              expect(newest?.reason).toBe(`Rollback auf v${liveBefore}: ${rollbackReason}`);
              rollbackVersion = newest?.version ?? 0;
              await flowShot(second.page, testInfo, 'ADM-35-brandRolledBack', { phase: 3 });
            } finally {
              await second.context.close();
            }
          });

          await test.step('the old hero is back on the member web', async () => {
            expect(heroPaths((await appConfig(member.context)).body?.data.branding.heroes.welcome ?? null)).toEqual(heroPaths(liveHero));
            const refetched = member.page.waitForResponse((r) => r.url().includes('/api/v1/app-config') && r.request().method() === 'GET');
            await member.page.reload();
            expect((await refetched).status()).toBe(200);
            await expect(id(member.page, 'AUTH-02.root')).toBeVisible();
            await expect.poll(() => photoSources(member.page), { message: 'Welcome shows the hero of before the test', timeout: 30_000 }).toEqual(sourcesBefore);
          });

          await test.step('audit rows: config.published and config.rolled_back by the content editor, with their reasons', async () => {
            const reader = await browser.newContext({ baseURL: BASE_URL });
            try {
              await applyAuth(reader, 'staff-admin');
              const { rows } = await pageProps<{ rows: { data: AuditRow[] } }>(reader, '/admin/audit?filter[action]=config.&per_page=50');
              const published = rows.data.find((r) => r.action === 'config.published' && r.reason === publishReason);
              expect(published, 'config.published with the publish reason').toBeDefined();
              expect(published?.actor.label).toBe(editor.name);
              const rolledBack = rows.data.find((r) => r.action === 'config.rolled_back' && (r.reason ?? '').includes(rollbackReason));
              expect(rolledBack, 'config.rolled_back with the rollback reason').toBeDefined();
              expect(rolledBack?.actor.label).toBe(editor.name);
              expect(rollbackVersion).toBe(draftVersion + 1);
            } finally {
              await reader.close();
            }
          });
        } finally {
          await member.context.close();
          // Inside the lock: the other project's run must not see this one's versions.
          const removed = await removeFixtureBranding();
          const after = await brandingState();
          expect(after.live, `remove-branding-fixture ${JSON.stringify(removed)}: the version live before the test is live again`).toBe(liveBefore);
          expect(after.versions).toEqual(before.versions);
        }
      } finally {
        const removed = await removeFixtureBranding();
        expect((await brandingState()).staff_draft, `remove-branding-fixture ${JSON.stringify(removed)}: the staff draft is back, column for column`).toEqual(staffDraft);
      }
    });
  });
});
