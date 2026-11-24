// A7 Admin publish (10_CLIENT_ROUND_1 §9, M5.1, ADR-507), on Chromium and WebKit. The client's "cannot publish features" as a flow: the
// Owner (`owner`, signed in here over HTTP in a session of its own, so its password confirmations never touch the shared session)
//
// 1. ADM-36: switches a member flag on in this environment behind the password dialog → "Flag geändert." → GET /api/v1/app-config
//    answers the flag on with a new ETag at once (AppConfig flushed); a change only to another environment's column says that nothing
//    changes here ("geplanter Stand") and app-config stays as it is; the flag goes back off.
// 2. ADM-28: publishes a branding change (the default theme) with a reason → app-config carries it with a new ETag. Before that, a
//    publish answered with an error on a payload field (what the publish re-validation reports when, say, an asset went away after the
//    draft was saved; the answer is stubbed in the browser, nothing reaches the server) shows that message inside the publish dialog
//    (SF-6 of the M5.1 review: before M5.1 the dialog showed only `refused`/`reason` and stayed silent).
// 2b. ADM-28 with uploaded brand images (the client's report of 2026-11-19, "Veröffentlichen" and nothing happens): the logo set and a
//    Welcome photo uploaded through the picker and saved; a publish whose connection drops, and one the host answers with an empty
//    503 instead of the app (both stubbed in the browser), say so inside the publish dialog; the next "Veröffentlichen" publishes.
// 3. ADM-37: asks to switch maintenance on → the four-eyes request waits: "Wartet auf Freigabe durch eine zweite Person" naming who can
//    approve it (the run's admin and Owner fixtures can), no "Selbst freigeben" while a second person exists, and a direct POST of the
//    Owner-Override is refused by the server (back to the page with the reason as a form error, SF-4; the request still waits);
//    ADM-43 "Von mir" names the approvers too. The request is withdrawn and the draft
//    discarded, so maintenance never goes live for the other specs.
// 4. The password dialog of a session that has ended says so and offers the sign-in (before M5.1 it said "Das Passwort stimmt nicht.").
//
// The Owner-Override when nobody else can approve is proved by tests/Feature/Admin/M51/AdminPublishTest (server, mail, audit); in this
// run the admin fixtures can always approve, which is exactly the case where the override must stay closed (step 3).
//
// Shared state and cleanup: each part runs under a cross-project lock (the two browser projects would otherwise race on one flag, one
// branding and one remote-config draft). The flag's `rules` and `updated_at` are put back as they were (ADM-36 shows the date), the
// branding versions go with support/backend.php remove-branding-fixture exactly as in A3 (the seeded draft parked and restored).
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { BrowserContext, Page } from '@playwright/test';
import { admin, confirmPassword, confirmPasswordDirectly, DESKTOP, holdFourEyes, pageProps, realClock, staffContext, toast, withFlowLock, xsrfOf } from '../support/admin-flow';
import { brandingState, parkBrandingDraft, removeFixtureBranding } from '../support/backend.mjs';
import { expect, test } from '../support/fixtures';
import { id, open } from '../support/flow';
import { BASE_URL } from '../support/qa.mjs';
import { staffRun, staffSession } from '../support/staff.mjs';

const run = promisify(execFile);
const ARTISAN = fileURLToPath(new URL('../../../artisan', import.meta.url));
/** A brand file or seed photo of design/ (the client's logo set, A3's night photo). */
const DESIGN = (path: string): string => fileURLToPath(new URL(`../../../../design/${path}`, import.meta.url));
/** A member flag no other spec reads (ADR-445/450: replies in messages), off in every environment. */
const FLAG = 'msg_replies';

type Environment = 'local' | 'staging' | 'production';
type FlagRow = { id: number; key: string; enabled: boolean; environments: Record<Environment, boolean>; pending: boolean };
type FlagsProps = { flags: FlagRow[]; environment: Environment };
type AppConfigBody = { data: { flags: Record<string, boolean>; branding: { default_theme: string }; maintenance: { enabled: boolean } } };
type EditorProps = {
  editor: {
    draft: { revision: number; mine: boolean } | null;
    approval: { id: string; approvers: string[]; approvers_total: number; override: boolean } | null;
    payload: { default_theme?: string; maintenance?: { enabled: boolean } };
  };
};
type ApprovalRow = { id: string; action: string; status: string; mine: boolean; waiting: { approvers: string[]; approvers_total: number; override: boolean } | null };

async function appConfig(context: BrowserContext): Promise<{ etag: string | null; body: AppConfigBody }> {
  const response = await context.request.get('/api/v1/app-config', { headers: { Accept: 'application/json' } });
  expect(response.status()).toBe(200);
  return { etag: response.headers().etag ?? null, body: (await response.json()) as AppConfigBody };
}

/**
 * The flag's stored `rules` and `updated_at` before the test, and putting them back after it: a change through the admin rewrites both
 * (the ADM-36 picture shows the date). Local server only, one row by key; nothing else is written. (A candidate for support/backend.php.)
 */
async function flagRow(action: 'read' | 'restore', snapshot = ''): Promise<string> {
  if (!['localhost', '127.0.0.1'].includes(new URL(BASE_URL).hostname)) throw new Error('A7 writes the flag row back only on a local server');
  const code =
    action === 'read'
      ? `echo json_encode(DB::table('feature_flags')->where('key', '${FLAG}')->first(['enabled', 'rules', 'updated_at']));`
      : `$s = json_decode(base64_decode('${Buffer.from(snapshot).toString('base64')}'), true); DB::table('feature_flags')->where('key', '${FLAG}')->update(['enabled' => $s['enabled'], 'rules' => $s['rules'], 'updated_at' => $s['updated_at']]); app(App\\Services\\AppConfig\\AppConfig::class)->flush(); echo 'ok';`;
  const { stdout } = await run(process.env.SPEEDCLUB_PHP ?? 'php', [ARTISAN, 'tinker', `--execute=${code}`], { timeout: 60_000 });
  return stdout.trim().split('\n').pop() ?? '';
}

/** ADR-215: the password dialog when the confirmation of this session is older than 5 minutes, else the action runs at once. */
async function passwordIfAsked(page: Page, done: ReturnType<typeof id>): Promise<void> {
  const asked = id(page, 'shell.password');
  await expect(asked.or(done).first()).toBeVisible();
  if (await asked.isVisible()) await confirmPassword(page);
}

/** ADM-36: the drawer of FLAG, one environment switch flipped, saved (ADR-540: no reason). */
async function flipFlag(page: Page, environment: Environment): Promise<void> {
  const row = page.locator('[data-testid="ADM-36.row"]').filter({ has: page.locator('.sc-key', { hasText: new RegExp(`^${FLAG.replace('.', '\\.')}$`) }) });
  await row.locator('[data-testid="ADM-36.edit"]').click();
  await expect(id(page, 'ADM-36.drawer')).toBeVisible();
  await id(page, `ADM-36.form.${environment}`).click();
  await id(page, 'ADM-36.form.save').click();
}

test.describe('A7 admin publish', () => {
  // ADR-540: four-eyes is off by default; this spec proves the engine with it switched on (support/admin-flow holdFourEyes).
  let releaseFourEyes: (() => Promise<void>) | null = null;
  test.beforeEach(async () => {
    releaseFourEyes = await holdFourEyes(true);
  });
  test.afterEach(async () => {
    await releaseFourEyes?.();
    releaseFourEyes = null;
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test('ADM-36: the Owner switches a member flag on → app-config answers it at once (new ETag); another environment only plans', async ({ page, context, browserName }) => {
    test.setTimeout(600_000);
    await staffContext(context, 'owner');
    await withFlowLock('a7-flag', 300_000, async () => {
      const snapshot = await flagRow('read');
      expect(JSON.parse(snapshot).enabled, `${FLAG} is off before the test`).toBeFalsy();
      try {
        const { environment } = await pageProps<FlagsProps>(context, '/admin/config/flags');
        const before = await appConfig(context);
        expect(before.body.data.flags[FLAG]).toBe(false);

        await test.step('another environment only: saved as the planned state, nothing changes here', async () => {
          const elsewhere: Environment = environment === 'production' ? 'staging' : 'production';
          await open(page, '/admin/config/flags', { now: await realClock(page) });
          const row = page.locator('[data-testid="ADM-36.row"]').filter({ has: page.locator('.sc-key', { hasText: FLAG }) });
          await row.locator('[data-testid="ADM-36.edit"]').click();
          await id(page, `ADM-36.form.${elsewhere}`).click();
          await expect(id(page, 'ADM-36.elsewhere')).toBeVisible();
          await id(page, 'ADM-36.form.save').click();
          const planned = toast(page, admin('config', 'flash.flag_planned'));
          await passwordIfAsked(page, planned);
          await expect(planned).toBeVisible();
          expect((await appConfig(context)).body.data.flags[FLAG], 'a planned state changes nothing here').toBe(false);
        });

        await test.step('this environment: on behind the password dialog, app-config answers it with a new ETag', async () => {
          await open(page, '/admin/config/flags', { now: await realClock(page) });
          await flipFlag(page, environment);
          const changed = toast(page, admin('config', 'flash.flag_changed'));
          await passwordIfAsked(page, changed);
          await expect(changed).toBeVisible();
          await expect(id(page, 'ADM-36.drawer')).toHaveCount(0);
          const after = await appConfig(context);
          expect(after.body.data.flags[FLAG], 'the member app reads the flag on').toBe(true);
          expect(after.etag).not.toBe(before.etag);
          const flag = (await pageProps<FlagsProps>(context, '/admin/config/flags')).flags.find((f) => f.key === FLAG);
          expect(flag?.enabled).toBe(true);
        });

        await test.step('and off again', async () => {
          await open(page, '/admin/config/flags', { now: await realClock(page) });
          await flipFlag(page, environment);
          await expect(toast(page, admin('config', 'flash.flag_changed'))).toBeVisible();
          expect((await appConfig(context)).body.data.flags[FLAG]).toBe(false);
        });
      } finally {
        expect(await flagRow('restore', snapshot)).toBe('ok');
      }
    });
  });

  test('ADM-28: the Owner publishes a branding change with a reason → app-config carries it (new ETag)', async ({ page, context, browserName }) => {
    test.setTimeout(900_000);
    await staffContext(context, 'owner');
    await withFlowLock('branding', 420_000, async () => {
      await removeFixtureBranding();
      const staffDraft = (await brandingState()).staff_draft;
      const { parked } = await parkBrandingDraft();
      expect(parked?.sha256 ?? null).toBe(staffDraft?.sha256 ?? null);
      try {
        const before = await appConfig(context);
        const theme = before.body.data.branding.default_theme === 'light' ? 'black' : 'light';

        await open(page, '/admin/brand', { now: await realClock(page) });
        await expect(id(page, 'ADM-28.draft-bar')).toBeVisible();
        await page.locator(`[data-testid="ADM-28.theme"] [role="radio"][id$="-${theme}"]`).click();
        await id(page, 'ADM-28.save').click();
        await expect(toast(page, admin('config', 'flash.draft_saved'))).toBeVisible();

        await id(page, 'ADM-28.publish').click();

        await test.step('a payload error of the publish shows inside the publish dialog (stubbed answer, nothing published)', async () => {
          const message = 'Diese Datei gibt es nicht mehr.';
          // The page the server would answer after its redirect back, with an error on a payload field (og_default) instead of
          // `refused`/`reason`: built from the real page props of this session, only `errors` is set.
          await page.route('**/admin/brand/publish', async (route) => {
            const version = route.request().headers()['x-inertia-version'] ?? '';
            const current = await context.request.get('/admin/brand', { headers: { 'X-Inertia': 'true', 'X-Inertia-Version': version, 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, application/xhtml+xml' } });
            const inertiaPage = (await current.json()) as { props: Record<string, unknown> };
            inertiaPage.props.errors = { og_default: message };
            await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'X-Inertia': 'true', Vary: 'X-Inertia' }, body: JSON.stringify(inertiaPage) });
          });
          try {
            await id(page, 'ADM-28.publish-dialog.confirm').click();
            const shown = id(page, 'ADM-28.publish-dialog').getByRole('alert').filter({ hasText: message });
            await passwordIfAsked(page, shown);
            await expect(shown).toContainText(admin('config', 'draft.payload_error', { message }));
            await expect(id(page, 'ADM-28.publish-dialog')).toBeVisible();
          } finally {
            await page.unroute('**/admin/brand/publish');
          }
          expect((await appConfig(context)).body.data.branding.default_theme, 'nothing was published').toBe(before.body.data.branding.default_theme);
        });

        await id(page, 'ADM-28.publish-dialog.confirm').click();
        const published = toast(page, admin('config', 'flash.published'));
        await passwordIfAsked(page, published);
        await expect(published).toBeVisible();
        expect((await pageProps<EditorProps>(context, '/admin/brand')).editor.draft).toBeNull();

        const after = await appConfig(context);
        expect(after.body.data.branding.default_theme, 'the member app reads the published branding').toBe(theme);
        expect(after.etag).not.toBe(before.etag);
      } finally {
        await removeFixtureBranding();
      }
      expect((await brandingState()).staff_draft?.parked ?? false, 'the seeded draft is back').toBe(false);
    });
  });

  test('ADM-28 with uploaded brand images: "Veröffentlichen" always answers (dropped connection, host error page) and then publishes', async ({ page, context, browserName, expectFailedResponses }) => {
    // The client's report of 2026-11-19 (staging, Owner, branding draft with freshly uploaded logos): "Veröffentlichen" and nothing
    // happens. A publish that got no answer from the app ended without a word; both answers below are stubbed in the browser for the
    // publish request only (nothing reaches the server), then the real publish goes through.
    test.setTimeout(900_000);
    const PUBLISH = '**/admin/brand/publish';
    expectFailedResponses([
      { status: 'network', url: /\/admin\/brand\/publish$/ },
      { status: 503, url: /\/admin\/brand\/publish$/ },
    ]);
    await staffContext(context, 'owner');
    await withFlowLock('branding', 420_000, async () => {
      await removeFixtureBranding();
      const staffDraft = (await brandingState()).staff_draft;
      const { parked } = await parkBrandingDraft();
      expect(parked?.sha256 ?? null).toBe(staffDraft?.sha256 ?? null);
      try {
        const before = await appConfig(context);
        const liveBefore = (await brandingState()).live;

        await test.step('the logo set and a Welcome photo uploaded through the picker, the draft saved', async () => {
          await open(page, '/admin/brand', { now: await realClock(page) });
          await expect(id(page, 'ADM-28.draft-bar')).toBeVisible();
          const uploads: [string, string][] = [
            ['ADM-28.logo.wordmark_white.choose', 'brand/logo-wide-white.png'],
            ['ADM-28.logo.wordmark_black.choose', 'brand/logo-wide-black.png'],
            ['ADM-28.logo.square.choose', 'brand/logo-square-on-texture.jpg'],
            ['ADM-28.logo.app_mark.choose', 'brand/logo-square-on-texture.jpg'],
            // Passes the contrast rule at every focal point (A3).
            ['ADM-28.hero.welcome.choose', 'seed-photos/nissan-r35-01.jpg'],
          ];
          for (const [choose, file] of uploads) {
            await id(page, choose).click();
            const picker = id(page, 'ADM-28.picker');
            await expect(picker).toBeVisible();
            await page.locator('[data-testid="ADM-28.picker.file"]').setInputFiles(DESIGN(file));
            await id(page, 'ADM-28.picker.submit').click();
            await expect(picker).toBeHidden({ timeout: 30_000 });
          }
          await expect(id(page, 'ADM-28.hero.welcome.contrast')).toContainText(admin('brand', 'contrast.passes'));
          await id(page, 'ADM-28.save').click();
          await expect(toast(page, admin('config', 'flash.draft_saved'))).toBeVisible();
          const saved = await pageProps<EditorProps & { editor: { payload: { logos?: Record<string, string | null> } } }>(context, '/admin/brand');
          expect(saved.editor.draft?.mine).toBe(true);
          expect(Object.values(saved.editor.payload.logos ?? {}).filter(Boolean), 'all four logos are in the draft').toHaveLength(4);
        });

        await id(page, 'ADM-28.publish').click();
        const dialog = id(page, 'ADM-28.publish-dialog');
        await expect(dialog).toBeVisible();

        await test.step('the connection drops on the publish: the dialog says so (before: nothing happened)', async () => {
          await page.route(PUBLISH, (route) => route.abort('failed'));
          try {
            await id(page, 'ADM-28.publish-dialog.confirm').click();
            const said = dialog.getByRole('alert').filter({ hasText: admin('config', 'draft.connection_lost') });
            await passwordIfAsked(page, said);
            await expect(said).toBeVisible();
            await expect(id(page, 'ADM-28.publish-dialog.confirm')).toBeEnabled();
          } finally {
            await page.unroute(PUBLISH);
          }
        });

        await test.step('the host answers an empty 503 instead of the app: said in the dialog, no raw error modal over it', async () => {
          await page.route(PUBLISH, (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '' }));
          try {
            await id(page, 'ADM-28.publish-dialog.confirm').click();
            await expect(dialog.getByRole('alert').filter({ hasText: admin('ui', 'state.server_error') })).toBeVisible();
            await expect(page.locator('dialog#inertia-error-dialog')).toHaveCount(0);
          } finally {
            await page.unroute(PUBLISH);
          }
          expect((await brandingState()).live, 'nothing was published').toBe(liveBefore);
        });

        await test.step('"Veröffentlichen" again: published, the dialog closes, the app reads the new branding', async () => {
          await id(page, 'ADM-28.publish-dialog.confirm').click();
          const published = toast(page, admin('config', 'flash.published'));
          await passwordIfAsked(page, published);
          await expect(published).toBeVisible();
          await expect(dialog).toHaveCount(0);
          expect((await pageProps<EditorProps>(context, '/admin/brand')).editor.draft).toBeNull();
          expect((await appConfig(context)).etag, 'a new ETag for the published branding').not.toBe(before.etag);
        });
      } finally {
        await removeFixtureBranding();
      }
      expect((await brandingState()).staff_draft?.parked ?? false, 'the seeded draft is back').toBe(false);
    });
  });

  test('ADM-37: maintenance on waits for a second person, names who can approve; the Owner-Override stays closed on the server', async ({ page, context, browserName }) => {
    test.setTimeout(600_000);
    await staffContext(context, 'owner');
    await withFlowLock('a7-remote-config', 300_000, async () => {
      let approvalId: string | null = null;
      try {
        await open(page, '/admin/config/remote', { now: await realClock(page) });
        await expect(id(page, 'ADM-37.draft-bar')).toBeVisible();
        const start = await pageProps<EditorProps>(context, '/admin/config/remote');
        expect(start.editor.draft, 'no remote-config draft is left by another run').toBeNull();

        await test.step('the request: maintenance on with its text, saved, "Freigabe anfragen" with a reason', async () => {
          await id(page, 'ADM-37.maintenance.switch').click();
          await id(page, 'ADM-37.maintenance.de').fill('Wir bauen kurz um und sind gleich wieder da.');
          await id(page, 'ADM-37.save').click();
          const saved = toast(page, admin('config', 'flash.draft_saved'));
          await passwordIfAsked(page, saved);
          await expect(saved).toBeVisible();
          await id(page, 'ADM-37.publish').click();
          await expect(id(page, 'ADM-37.publish-dialog.four-eyes')).toBeVisible();
          await id(page, 'ADM-37.publish-dialog.confirm').click();
          await expect(id(page, 'shell.approval')).toBeVisible();
        });

        await test.step('"Wartet auf Freigabe durch eine zweite Person", with the names; no override while someone can approve', async () => {
          await expect(id(page, 'shell.approval.waiting')).toContainText(admin('ui', 'approval.waiting'));
          await expect(id(page, 'shell.approval.approvers')).toBeVisible();
          await expect(id(page, 'shell.approval.override')).toHaveCount(0);
          const props = await pageProps<EditorProps>(context, '/admin/config/remote');
          approvalId = props.editor.approval?.id ?? null;
          expect(approvalId).not.toBeNull();
          expect(props.editor.approval?.approvers_total ?? 0, 'the run has admins and Owners who can approve').toBeGreaterThan(0);
          expect(props.editor.approval?.override).toBe(false);
          expect((await appConfig(context)).body.data.maintenance.enabled, 'nothing went live').toBe(false);

          await open(page, '/admin/config/remote', { now: await realClock(page) });
          await expect(id(page, 'ADM-37.approval.waiting')).toBeVisible();
          await expect(id(page, 'ADM-37.approval.approvers')).toBeVisible();
          await expect(id(page, 'ADM-37.approval.override')).toHaveCount(0);

          const mine = (await pageProps<{ requests: ApprovalRow[] }>(context, '/admin/team/approvals?tab=mine')).requests.find((r) => r.id === approvalId);
          expect(mine?.waiting?.approvers_total ?? 0).toBeGreaterThan(0);
          expect(mine?.waiting?.override).toBe(false);
          await open(page, '/admin/team/approvals?tab=mine', { now: await realClock(page) });
          await expect(page.locator('[data-testid="ADM-43.approvers"]:visible').first()).toBeVisible();
          await expect(id(page, 'ADM-43.override')).toHaveCount(0);
        });

        await test.step('a direct Owner-Override POST is refused while a second person can approve, nothing goes live', async () => {
          await confirmPasswordDirectly(context);
          const response = await context.request.post(`/admin/team/approvals/${approvalId}/override`, {
            headers: { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(context), Referer: `${BASE_URL}/admin/config/remote` },
            data: { reason: 'Ich warte nicht auf die zweite Person.' },
            maxRedirects: 0,
          });
          // SF-4: a refusal of the moment goes back to the page with its reason as a form error (shown in the dialog), not the 403 page.
          expect(response.status()).toBe(303);
          const still = (await pageProps<{ requests: ApprovalRow[] }>(context, '/admin/team/approvals?tab=mine')).requests.find((r) => r.id === approvalId);
          expect(still?.status, 'the request still waits').toBe('pending');
          expect((await appConfig(context)).body.data.maintenance.enabled).toBe(false);
        });
      } finally {
        // Withdraw the request and discard the draft: maintenance never goes live for the other specs.
        const headers = { Accept: 'text/html', 'X-XSRF-TOKEN': await xsrfOf(context) };
        if (approvalId !== null) await context.request.post(`/admin/team/approvals/${approvalId}/cancel`, { headers, maxRedirects: 0 });
        await confirmPasswordDirectly(context);
        await context.request.delete('/admin/config/remote/draft', { headers: { ...headers, 'X-XSRF-TOKEN': await xsrfOf(context) }, maxRedirects: 0 });
        expect((await pageProps<EditorProps>(context, '/admin/config/remote')).editor.draft, 'the draft is gone').toBeNull();
      }
    });
  });

  test('the password dialog of an ended session says so and offers the sign-in (not "Das Passwort stimmt nicht")', async ({ browser }) => {
    // The shared Owner session in a context of its own; its cookie is then dropped in this context only, which is what the browser of a
    // session that ended on the server sends. The server's session itself is never touched (no sign-in, no sign-out, no confirmation),
    // and no extra sign-in counts against the two-factor limiter (5 a minute per account).
    const own = await browser.newContext({ baseURL: BASE_URL, viewport: DESKTOP });
    try {
      await own.addCookies(await staffSession('staff-owner'));
      const page = await own.newPage();
      await open(page, '/admin/config/flags', { now: await realClock(page) });
      await expect(id(page, 'ADM-36.table')).toBeVisible();
      // The session ends on the server's side (30 idle minutes, a sign-out elsewhere): its cookie no longer names a session.
      await own.clearCookies({ name: 'sc_staff_session' });
      await page.locator('[data-testid="ADM-36.edit"]:visible').first().click();
      await id(page, 'ADM-36.form.production').click();
      await id(page, 'ADM-36.form.save').click();
      await expect(id(page, 'shell.password')).toBeVisible();
      const run = await staffRun();
      await id(page, 'shell.password.input').fill(run.password);
      await id(page, 'shell.password.submit').click();
      await expect(id(page, 'shell.password')).toContainText(admin('shell', 'password.session_expired'));
      await expect(id(page, 'shell.password')).not.toContainText(admin('shell', 'password.failed'));
      await expect(id(page, 'shell.password.login')).toBeVisible();
    } finally {
      await own.close();
    }
  });
});
