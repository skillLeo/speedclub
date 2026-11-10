// The matrix planner, QA URLs, the override contract, image diffing, baselines, contact sheets and
// the runner CLI. Chromium only: nothing here depends on the browser engine.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { expect, test } from '../support/fixtures';
import { MAX_DIFF_PIXEL_RATIO, comparePng } from '../support/image-diff.mjs';
import { announcementFixturePlan, reconsentFixturePlan } from '../support/backend.mjs';
import { STAFF_SESSION_COOKIE, sessionCookieExpiry } from '../support/staff.mjs';
import { QA_NOW, checkQaContract, qaUrl } from '../support/qa.mjs';
import { spacingScale, tokens, typePairs } from '../support/tokens.mjs';
import { handleBaseline } from '../visual/baseline.mjs';
import { buildContactSheet } from '../visual/contact-sheet.mjs';
import { cellName, interleaveByRoute, isExpectedStatus, isVolatileCell, pathTokens, planRoute, resolvePath, stagesOf, validateRoutes, type RouteDef } from '../visual/matrix.mjs';
import { PLAIN_LIMITER, RateBudget, buildLimits, uriToRegex } from '../visual/rate-budget.mjs';
import { routes } from '../visual/routes.mjs';
import { defaultCellOf, findUnrenderedStates } from '../visual/state-check.mjs';
import { baselineOrigin, parseCell, planPromotion, promote } from '../visual/promote-baselines.mjs';

const RUNNER = fileURLToPath(new URL('../visual/run.mjs', import.meta.url));
const PROMOTER = fileURLToPath(new URL('../visual/promote-baselines.mjs', import.meta.url));
const exec = promisify(execFile);

const member: RouteDef = {
  id: 'GAR-01',
  path: '/app/garage',
  phase: 1,
  auth: 'member',
  states: ['default', 'loading', 'empty', 'error', 'offline'],
  ready: '[data-testid="x"]',
};
const admin: RouteDef = { ...member, id: 'ADM-09', path: '/admin/members', states: ['default'] };

const png = (width: number, height: number, background: string): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();

test.describe('matrix planning, 07_QA section 3', () => {
  test('module tier is exactly the four combinations', () => {
    expect(planRoute(member, 'module').map((c) => c.name)).toEqual([
      'GAR-01__390x844__carbon__de',
      'GAR-01__360x780__light__de',
      'GAR-01__430x932__black__en',
      'GAR-01__1280x800__carbon__de',
    ]);
  });

  test('phase tier: 6 viewports x 3 themes x de, en at 390, fs2 at 390 carbon de, states at 390 carbon de', () => {
    const names = planRoute(member, 'phase').map((c) => c.name);
    expect(names.filter((n) => n.endsWith('__de'))).toHaveLength(18);
    expect(names.filter((n) => n.endsWith('__en'))).toEqual([
      'GAR-01__390x844__carbon__en',
      'GAR-01__390x844__black__en',
      'GAR-01__390x844__light__en',
    ]);
    expect(names).toContain('GAR-01__390x844__carbon__de__fs2');
    for (const state of ['loading', 'empty', 'error', 'offline']) {
      expect(names).toContain(`GAR-01__390x844__carbon__de__${state}`);
    }
    expect(names).toHaveLength(18 + 3 + 1 + 4);
    expect(new Set(names).size).toBe(names.length);
  });

  test('admin routes, ADR-212: phase tier 1280/1440 x carbon/light x de, 1440 carbon en, the zoom cell, states at 1280 carbon de', () => {
    const withStates: RouteDef = { ...admin, states: ['default', 'loading', 'error'] };
    const cells = planRoute(withStates, 'phase');
    expect(cells.map((c) => c.name)).toEqual([
      'ADM-09__1280x800__carbon__de',
      'ADM-09__1280x800__light__de',
      'ADM-09__1440x900__carbon__de',
      'ADM-09__1440x900__light__de',
      'ADM-09__1440x900__carbon__en',
      'ADM-09__1280x800__carbon__de__zoom2',
      'ADM-09__1280x800__carbon__de__loading',
      'ADM-09__1280x800__carbon__de__error',
    ]);
    // The 200 % cell is the 1280×800 window at half its CSS size.
    const zoom = cells.find((c) => c.name.endsWith('__zoom2'));
    expect(zoom).toMatchObject({ viewport: { width: 640, height: 400 }, zoom: 2, theme: 'carbon', locale: 'de', fontScale: 1, state: 'default' });
    expect(cells.some((c) => c.theme === 'black' || c.fontScale !== 1)).toBe(false);
  });

  test('admin routes, ADR-212: module tier 1280 carbon de, 1440 light de, 1440 carbon en, plus the states at 1280 carbon de', () => {
    expect(planRoute({ ...admin, states: ['default', 'empty'] }, 'module').map((c) => c.name)).toEqual([
      'ADM-09__1280x800__carbon__de',
      'ADM-09__1440x900__light__de',
      'ADM-09__1440x900__carbon__en',
      'ADM-09__1280x800__carbon__de__empty',
    ]);
    expect(planRoute(admin, 'module').every((c) => c.viewport.width >= 1280)).toBe(true);
  });

  test('volatile (ADR-223): every cell of the route except the fixture states loading, error and empty', () => {
    const route: RouteDef = { ...admin, volatile: true, states: ['default', 'loading', 'empty', 'error'] };
    const cells = planRoute(route, 'phase');
    expect(cells.filter((c) => isVolatileCell(route, c)).map((c) => c.name)).toEqual([
      'ADM-09__1280x800__carbon__de',
      'ADM-09__1280x800__light__de',
      'ADM-09__1440x900__carbon__de',
      'ADM-09__1440x900__light__de',
      'ADM-09__1440x900__carbon__en',
      'ADM-09__1280x800__carbon__de__zoom2',
    ]);
    expect(cells.some((c) => isVolatileCell(admin, c))).toBe(false);
    expect(validateRoutes([{ ...admin, volatile: 'yes' } as unknown as RouteDef])).toEqual(['ADM-09: volatile must be true or false']);
    // ADR-257: with liveChrome the forced states are volatile too; liveChrome alone means nothing and is refused.
    const chrome: RouteDef = { ...route, liveChrome: true };
    expect(planRoute(chrome, 'phase').filter((c) => !isVolatileCell(chrome, c))).toEqual([]);
    expect(validateRoutes([{ ...admin, liveChrome: true } as RouteDef])).toEqual(['ADM-09: liveChrome is only true, and only beside volatile']);
    expect(routes.filter((r) => (r as RouteDef).liveChrome === true).map((r) => r.id)).toEqual([
      'ADM-10-restrict', 'ADM-10-suspend', 'ADM-10-view-as', 'ADM-10-edit', 'ADM-10-email', 'ADM-09-export',
      'ADM-45-create', 'ADM-46-extend', 'ADM-48', 'ADM-49',
    ]);
    // The registry marks the live-activity pages and nothing else: the dashboard, alerts and audit log (M3.1), and since M3.2 the member
    // record (its activity column and Audit tab list this run's own sensitive-view events) and the approvals queue (the runs' requests),
    // and since M3.4 the case detail and messaging safety pages (ADR-241).
    expect(routes.filter((r) => (r as RouteDef).volatile === true).map((r) => r.id)).toEqual([
      'ADM-06', 'ADM-06-moderator', 'ADM-08', 'ADM-44', 'ADM-44-event',
      // ADR-256: the member list (live "Zuletzt aktiv", accounts the runs create) with its two dialogs further down.
      'ADM-09', 'ADM-09-analyst',
      'ADM-10', 'ADM-10-vehicles', 'ADM-10-security', 'ADM-10-reports', 'ADM-10-messages', 'ADM-10-audit', 'ADM-10-privacy', 'ADM-10-support', 'ADM-10-analyst',
      'ADM-43', 'ADM-43-mine', 'ADM-43-all',
      // ADR-241: the M3.2 record dialogs over ADM-10 and the M3.4 case pages ADM-21/22 (activity timelines and live evidence).
      'ADM-10-restrict', 'ADM-10-suspend', 'ADM-10-view-as', 'ADM-10-edit', 'ADM-10-email',
      'ADM-09-bulk', 'ADM-09-export',
      'ADM-21', 'ADM-21-reports', 'ADM-21-decision', 'ADM-21-analyst', 'ADM-21-composer-preview', 'ADM-21-composer', 'ADM-21-appeal',
      'ADM-22',
      // ADR-255: M3.5/M3.6 pages showing run-dependent data: the ADM-34 preview frames load the live app, ADM-46 counts every opening in
      // its activity, ADM-48/49 show the last health run and the queue's jobs, ADM-51 lists the staff member's own sessions.
      'ADM-34', 'ADM-34-black', 'ADM-34-light',
      // ADR-256: ADM-45's self-service rows come from the append-only audit log, the e2e run's included.
      'ADM-45', 'ADM-45-create',
      'ADM-46', 'ADM-46-reply', 'ADM-46-complete', 'ADM-46-extend',
      'ADM-48', 'ADM-49',
      'ADM-51', 'ADM-51-rotation', 'ADM-51-recovery',
    ]);
  });

  test('the admin gallery id ADM-DEV is valid, other ids without a number are not', () => {
    const base = { path: '/admin/dev/gallery', phase: 3, auth: 'staff-owner', states: ['default'], ready: 'x' };
    expect(validateRoutes([{ ...base, id: 'ADM-DEV' }, { ...base, id: 'ADM-DEV-palette' }])).toEqual([]);
    expect(validateRoutes([{ ...base, id: 'ADM-DEVX' }, { ...base, id: 'ADM-GALLERY' }])).toHaveLength(2);
    // The view-as tab (m3.2-contract §3): VIEWAS-<screen>, nothing looser.
    expect(validateRoutes([{ ...base, id: 'VIEWAS-HOME' }, { ...base, id: 'VIEWAS-SET-04' }])).toEqual([]);
    expect(validateRoutes([{ ...base, id: 'VIEWAS' }, { ...base, id: 'VIEWAS-' }, { ...base, id: 'VIEWASX-HOME' }])).toHaveLength(3);
  });

  test('CONSENT, the re-consent overlay, is a valid id on its own; nothing longer or looser is', () => {
    const base = { path: '/app/', phase: 3, auth: 'member', states: ['default'], ready: 'x' };
    expect(validateRoutes([{ ...base, id: 'CONSENT' }])).toEqual([]);
    expect(validateRoutes([{ ...base, id: 'CONSENTS' }, { ...base, id: 'CONSENT-x' }, { ...base, id: 'CONSENT-' }])).toHaveLength(3);
  });

  test('a stage fixture must be a known one, and its cells run after all others, one fixture at a time', () => {
    const base = { id: 'HOME-01-announcement-info', path: '/app/', phase: 3, auth: 'member', states: ['default'], ready: 'x' };
    expect(validateRoutes([{ ...base, fixture: 'announcement-info' }])).toEqual([]);
    expect(validateRoutes([{ ...base, fixture: 'announcements' }])).toEqual(['HOME-01-announcement-info: unknown stage fixture "announcements"']);
    const jobs = [
      { id: 'a1', fixture: 'reconsent' },
      { id: 'b1' },
      { id: 'c1', fixture: 'support-tickets' },
      { id: 'a2', fixture: 'reconsent' },
      { id: 'b2' },
      { id: 'c2', fixture: 'support-tickets' },
    ];
    expect(stagesOf(jobs, (j) => j.fixture).map((s) => [s.fixture, s.jobs.map((j) => j.id)])).toEqual([
      [null, ['b1', 'b2']],
      ['reconsent', ['a1', 'a2']],
      ['support-tickets', ['c1', 'c2']],
    ]);
    expect(stagesOf([{ id: 'a', fixture: 'reconsent' }], (j) => j.fixture).map((s) => s.fixture), 'no empty stage').toEqual(['reconsent']);
  });

  // The CONSENT stage fixture next to ADM-31's seeded Datenschutz draft "2" (BrandContentDemoSeeder): its versions go above every row of
  // the document, drafts included, so it never collides with or replaces a real row; it refuses what it cannot place. Pure: no row written.
  test('the reconsent fixture versions sit above every version of their document, the seeded draft included, and refuse what they cannot place', async () => {
    const at = '2026-10-30 12:00:00';
    const seeded = [
      { key: 'terms', locale: 'de', version: '1', published_at: at },
      { key: 'terms', locale: 'en', version: '1', published_at: at },
      { key: 'privacy', locale: 'de', version: '1', published_at: at },
      { key: 'privacy', locale: 'en', version: '1', published_at: at },
    ];
    const draft = { key: 'privacy', locale: 'de', version: '2', published_at: null };
    const fixtureRow = { key: 'terms', locale: 'de', version: '7', published_at: '2026-11-01 08:00:00', reason: 'QA-Fixture CONSENT (visual registry): wird nach der Aufnahme wieder entfernt' };

    expect(await reconsentFixturePlan(seeded), 'no draft').toEqual({ versions: { terms: '2', privacy: '2' }, accepted: { terms: '1', privacy: '1' } });
    expect(await reconsentFixturePlan([...seeded, draft]), 'above the seeded draft, in both locales').toEqual({
      versions: { terms: '2', privacy: '3' },
      accepted: { terms: '1', privacy: '1' },
    });
    expect(await reconsentFixturePlan([...seeded, draft, fixtureRow]), 'a fixture row left behind does not count').toEqual({
      versions: { terms: '2', privacy: '3' },
      accepted: { terms: '1', privacy: '1' },
    });
    const refusals: [string, object[], RegExp][] = [
      ['a version that is no whole number', [...seeded, { key: 'terms', locale: 'en', version: '1.1', published_at: null }], /terms \(en\) has the version "1.1"/],
      ['a text published at the fixture time', [...seeded, { key: 'privacy', locale: 'en', version: '2', published_at: '2026-11-01 08:00:00' }], /privacy \(en\) has a version published at or after/],
      ['a locale without a published text', seeded.filter((row) => !(row.key === 'terms' && row.locale === 'en')), /no published terms \(en\)/],
    ];
    for (const [what, rows, reason] of refusals) {
      const plan = await reconsentFixturePlan(rows as Parameters<typeof reconsentFixturePlan>[0]);
      expect('refused' in plan ? plan.refused : '', what).toMatch(reason);
    }
  });

  // HOME-01-announcement-*: the demo seed has a published announcements version and the content editor's draft (BrandContentDemoSeeder).
  // The fixture's version goes above both, so the draft keeps its number and stays the draft; the live one is the one it supersedes and
  // restores. Pure: no row written.
  test('the announcement fixture version sits above every version of the key, the staff draft included, and refuses two live ones', async () => {
    const seeded = [
      { version: 1, status: 'published' },
      { version: 2, status: 'draft' },
    ];
    expect(await announcementFixturePlan(seeded), 'beside the staff draft').toEqual({ version: 3, supersede: 1 });
    expect(await announcementFixturePlan([{ version: 1, status: 'superseded' }, { version: 2, status: 'published' }]), 'no draft').toEqual({ version: 3, supersede: 2 });
    expect(await announcementFixturePlan([{ version: 4, status: 'draft' }]), 'nothing live').toEqual({ version: 5, supersede: null });
    expect(await announcementFixturePlan([]), 'no row at all').toEqual({ version: 1, supersede: null });
    expect(await announcementFixturePlan([...seeded, { version: 9, status: 'published', fixture: true }]), 'a fixture row left behind does not count').toEqual({ version: 3, supersede: 1 });
    const two = await announcementFixturePlan([{ version: 1, status: 'published' }, { version: 3, status: 'published' }]);
    expect('refused' in two ? two.refused : '', 'two published versions').toMatch(/2 published versions \(v1, v3\)/);
  });

  // Verify of 2026-11-09, run 1: the runner handed the cookies of its first staff sign-in to every context it opened, also after their
  // 30 minutes (ADM-F1/F2 got the sign-in page). staffSession() renews a session whose cookie runs out within 5 minutes; this is the clock.
  test('the staff session cookie expiry is read from the session cookie only', () => {
    const at = Date.parse('2026-11-09T20:00:00Z') / 1000;
    const cookie = (name: string, expires: number) => ({ name, value: 'v', domain: 'localhost', path: '/admin', expires, httpOnly: true, secure: false, sameSite: 'Lax' as const });
    expect(sessionCookieExpiry([cookie('XSRF-TOKEN', at + 7200), cookie(STAFF_SESSION_COOKIE, at + 1800)])).toBe((at + 1800) * 1000);
    expect(sessionCookieExpiry([cookie(STAFF_SESSION_COOKIE, -1)]), 'a cookie without an expiry').toBe(Infinity);
    expect(sessionCookieExpiry([cookie('XSRF-TOKEN', at + 7200)]), 'no session cookie: renew').toBe(0);
  });

  test('a viewport restriction applies, and may not leave nothing', () => {
    const desktop = planRoute({ ...member, viewports: [1280] }, 'module');
    expect(desktop.map((c) => c.viewport.width)).toEqual([1280]);
    expect(() => planRoute({ ...member, viewports: [999] }, 'module')).toThrow(/nothing to capture/);
  });

  test('file names follow the documented pattern', () => {
    const viewport = { width: 390, height: 844 };
    expect(cellName('VEH-01', { viewport, theme: 'carbon', locale: 'de' })).toBe('VEH-01__390x844__carbon__de');
    expect(cellName('VEH-01', { viewport, theme: 'carbon', locale: 'de', fontScale: 2 })).toBe('VEH-01__390x844__carbon__de__fs2');
    expect(cellName('VEH-01', { viewport, theme: 'carbon', locale: 'de', state: 'error' })).toBe('VEH-01__390x844__carbon__de__error');
    expect(cellName('VEH-01', { viewport, theme: 'carbon', locale: 'de', fontScale: 2, state: 'empty' })).toBe(
      'VEH-01__390x844__carbon__de__fs2__empty',
    );
  });

  test('the committed route registry is valid', () => {
    expect(validateRoutes(routes as RouteDef[])).toEqual([]);
  });

  test('an expected status is a real HTTP status, and only that status passes', () => {
    expect(validateRoutes([{ ...member, expectStatus: 410 }])).toEqual([]);
    for (const expectStatus of [99, 600, 410.5]) {
      expect(validateRoutes([{ ...member, expectStatus }]).some((p) => /expectStatus/.test(p)), String(expectStatus)).toBe(true);
    }
    expect(isExpectedStatus(member, 200)).toBe(true);
    expect(isExpectedStatus(member, 302)).toBe(true);
    expect(isExpectedStatus(member, 404)).toBe(false);
    const revoked = { ...member, expectStatus: 410 };
    expect(isExpectedStatus(revoked, 410)).toBe(true);
    expect(isExpectedStatus(revoked, 200), 'a revoked code that suddenly answers 200 is a finding').toBe(false);
    expect(isExpectedStatus(revoked, 404)).toBe(false);
  });

  test('a bounded expanded capture: maxHeight only with capture expanded, and inside 1000 to the runner\'s ceiling', () => {
    expect(validateRoutes([{ ...member, capture: 'expanded', maxHeight: 6000 }])).toEqual([]);
    expect(validateRoutes([{ ...member, maxHeight: 6000 }]).some((p) => /maxHeight needs capture 'expanded'/.test(p))).toBe(true);
    for (const maxHeight of [999, 12001, 5000.5]) {
      expect(validateRoutes([{ ...member, capture: 'expanded', maxHeight }]).some((p) => /maxHeight must be/.test(p)), String(maxHeight)).toBe(true);
    }
  });

  test('a qaScroll=end cell is captured at the real viewport, never expanded (DQ-676)', () => {
    const end = { ...member, id: 'ADM-40-roles-end', path: '/admin/team/4?dialog=roles&qaScroll=end' };
    expect(validateRoutes([{ ...end, capture: 'viewport' }])).toEqual([]);
    expect(validateRoutes([{ ...end, capture: 'expanded' }]).some((p) => /qaScroll=end needs capture 'viewport'/.test(p))).toBe(true);
    expect(validateRoutes([{ ...member, capture: 'expanded' }]).some((p) => /qaScroll/.test(p))).toBe(false);
  });

  test('path tokens are filled with the ids of the run, and a missing one throws', () => {
    expect(pathTokens('/app/garage/{r34}/photos/{r34Photo}')).toEqual(['r34', 'r34Photo']);
    expect(pathTokens('/app/garage')).toEqual([]);
    expect(resolvePath('/app/garage/{r34}/mods/new?category=wheels_tires', { r34: '01abc' })).toBe('/app/garage/01abc/mods/new?category=wheels_tires');
    expect(() => resolvePath('/app/garage/{r34}', {})).toThrow(/No value for \{r34\}/);
  });

  test('registry validation finds mistakes', () => {
    const problems = validateRoutes([
      member,
      member,
      { ...member, id: 'bad id', path: 'no-slash', phase: 9, auth: 'root', states: ['loading'], ready: '' },
    ]);
    for (const expected of [/Duplicate/, /Invalid route id/, /path must start/, /phase must/, /unknown auth/, /states must include/, /ready/]) {
      expect(problems.some((p) => expected.test(p))).toBe(true);
    }
  });
});

test.describe('tokens are the source of the audit', () => {
  test('spacing scale and type pairs come from tokens.json', () => {
    expect(spacingScale()).toEqual(Object.values(tokens.space).map(Number).sort((a, b) => a - b));
    const body = tokens.typography.body;
    expect(typePairs(2).find((t) => t.name === 'body')).toMatchObject({ size: body.size * 2, lineHeight: body.lineHeight * 2 });
  });

  test('tab and badge are capped at their maxFontScale', () => {
    for (const name of ['tab', 'badge']) {
      const t = tokens.typography[name];
      expect(typePairs(2).find((p) => p.name === name)?.size).toBeCloseTo(t.size * t.maxFontScale);
      expect(typePairs(1.2).find((p) => p.name === name)?.size).toBeCloseTo(t.size * 1.2);
    }
  });
});

test.describe('QA URLs and the override contract', () => {
  test('all overrides end up in the query', () => {
    const url = new URL(qaUrl('/app/garage', { theme: 'light', locale: 'en', fontScale: 2, state: 'error' }), 'http://x');
    expect(url.pathname).toBe('/app/garage');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      qaTheme: 'light',
      qaLocale: 'en',
      qaFontScale: '2',
      qaState: 'error',
      qaMotion: 'off',
      qaNow: QA_NOW,
    });
  });

  test('defaults stay out of the query, motion and clock are always fixed', () => {
    const q = new URL(qaUrl('/app/?tab=1', { fontScale: 1, state: 'default' }), 'http://x').searchParams;
    expect(q.get('tab')).toBe('1');
    expect(q.has('qaFontScale')).toBe(false);
    expect(q.has('qaState')).toBe(false);
    expect(q.get('qaMotion')).toBe('off');
    expect(q.get('qaNow')).toBe(QA_NOW);
  });

  test('a page that reports the overrides passes, a page that ignores them does not', async ({ page }) => {
    const expected = { theme: 'light', locale: 'de', fontScale: 2, state: 'error' };
    await page.setContent('<!doctype html><html data-qa-theme="light" data-qa-locale="de" data-qa-font-scale="2" data-qa-state="error" data-qa-motion="off"><body></body></html>');
    expect(await checkQaContract(page, expected)).toEqual([]);

    await page.setContent('<!doctype html><html data-qa-theme="carbon" data-qa-locale="de"><body></body></html>');
    const issues = await checkQaContract(page, expected);
    expect(issues.some((i) => i.includes('theme') && i.includes('"carbon"'))).toBe(true);
    expect(issues.some((i) => i.includes('fontScale'))).toBe(true);
  });

  test('a fixed clock freezes Date for the page', async ({ page }) => {
    await page.goto('about:blank');
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => new Date().toISOString())).toBe(QA_NOW);
  });

  test('third-party requests are blocked and recorded', async ({ page, blockedRequests }) => {
    // A blank page: the CSP of the app would refuse this request before the harness sees it (SecurityHeaders, M1.4).
    await page.goto('about:blank');
    const status = await page.evaluate(() => fetch('https://example.org/track').then(
      () => 'reached',
      () => 'blocked',
    ));
    expect(status).toBe('blocked');
    expect(blockedRequests).toEqual(['https://example.org/track']);
    blockedRequests.length = 0;
  });
});

test.describe('baselines', () => {
  test('image diff: threshold of 0.002 and different sizes', async () => {
    expect(MAX_DIFF_PIXEL_RATIO).toBe(0.002);
    const a = await png(100, 100, '#000000');
    expect(comparePng(a, a).ratio).toBe(0);
    const b = await sharp(a).composite([{ input: await png(10, 10, '#ffffff'), left: 0, top: 0 }]).png().toBuffer();
    const small = comparePng(a, b);
    expect(small.ratio).toBeCloseTo(0.01, 3);
    expect(small.diff).not.toBeNull();
    const c = comparePng(a, await png(100, 200, '#000000'));
    expect(c.sameSize).toBe(false);
  });

  test('new, match, mismatch with diff image, refused and updated', async ({}, testInfo) => {
    const baselines = testInfo.outputPath('baselines');
    const diffDir = testInfo.outputPath('diff');
    const options = { baselines, diffDir, updateBaselines: false, high: 0 };
    const shot = await png(100, 100, '#000000');
    const name = 'GAR-01__390x844__carbon__de';

    expect((await handleBaseline(shot, name, options)).status).toBe('new');
    expect(existsSync(join(baselines, `${name}.png`)), 'a normal run writes no baselines').toBe(false);

    // A host-dependent picture away from the baseline host is never written, even with --update-baselines.
    expect((await handleBaseline(shot, name, { ...options, updateBaselines: true, hostLocked: true })).status).toBe('host');
    expect(existsSync(join(baselines, `${name}.png`)), 'a picture of another host is not a baseline').toBe(false);

    // ADR-223: a volatile picture (live activity) is neither compared nor written, even with --update-baselines.
    expect((await handleBaseline(shot, name, { ...options, updateBaselines: true, volatile: true })).status).toBe('volatile');
    expect(existsSync(join(baselines, `${name}.png`)), 'a volatile picture is not a baseline').toBe(false);

    expect((await handleBaseline(shot, name, { ...options, updateBaselines: true, high: 1 })).status).toBe('refused');
    expect(existsSync(join(baselines, `${name}.png`)), 'a page with High violations is not a baseline').toBe(false);

    expect((await handleBaseline(shot, name, { ...options, updateBaselines: true })).status).toBe('updated');
    expect(readFileSync(join(baselines, `${name}.png`)).equals(shot)).toBe(true);

    expect((await handleBaseline(shot, name, options)).status).toBe('match');

    // 2 x 2 of 100 x 100 = 0.0004: within 0.002
    const tiny = await sharp(shot).composite([{ input: await png(2, 2, '#ffffff'), left: 0, top: 0 }]).png().toBuffer();
    expect((await handleBaseline(tiny, name, options)).status).toBe('match');

    // 5 x 5 of 100 x 100 = 0.0025: above 0.002
    const changed = await sharp(shot).composite([{ input: await png(5, 5, '#ffffff'), left: 0, top: 0 }]).png().toBuffer();
    const result = await handleBaseline(changed, name, options);
    expect(result.status).toBe('mismatch');
    expect(result.ratio).toBeCloseTo(0.0025, 4);
    expect(existsSync(join(diffDir, `${name}.png`))).toBe(true);

    expect((await handleBaseline(await png(100, 101, '#000000'), name, options)).status).toBe('mismatch');
  });
});

test.describe('contact sheet', () => {
  test('a grid with one cell per screenshot of this route only', async ({}, testInfo) => {
    const dir = testInfo.outputPath('phase-1');
    mkdirSync(join(dir, 'contact'), { recursive: true });
    for (const [name, w, h] of [
      ['GAR-01__390x844__carbon__de', 390, 844],
      ['GAR-01__1280x800__light__de', 1280, 800],
      ['GAR-01__390x844__carbon__de__error', 390, 844],
      ['GAR-012__390x844__carbon__de', 390, 844],
    ] as const) {
      writeFileSync(join(dir, `${name}.png`), await png(w, h, '#336699'));
    }
    const result = await buildContactSheet({
      dir,
      routeId: 'GAR-01',
      info: { 'GAR-01__390x844__carbon__de': { high: 2, medium: 3 } },
    });
    expect(result?.count).toBe(3);
    const meta = await sharp(join(dir, 'contact', 'GAR-01.png')).metadata();
    expect(meta.width).toBeGreaterThan(800);
    expect(meta.height).toBeGreaterThan(400);
  });

  test('no screenshots, no sheet', async ({}, testInfo) => {
    const dir = testInfo.outputPath('empty');
    mkdirSync(join(dir, 'contact'), { recursive: true });
    expect(await buildContactSheet({ dir, routeId: 'GAR-01' })).toBeNull();
  });
});

test.describe('Lighthouse config', () => {
  const CONFIG = fileURLToPath(new URL('../lighthouse/lighthouserc.cjs', import.meta.url));
  const load = `console.log(JSON.stringify(require(${JSON.stringify(CONFIG)})))`;

  test('budgets of 05_ARCHITECTURE section 21 on the three public URLs', async () => {
    const { stdout } = await exec(process.execPath, ['-e', load], {
      env: { ...process.env, SPEEDCLUB_DEMO_SLUG: 'nissan-r34', SPEEDCLUB_DEMO_USERNAME: 'kenji.r34', SPEEDCLUB_BASE_URL: 'http://host:1' },
    });
    const { collect, assert } = JSON.parse(stdout).ci;
    expect(collect.url).toEqual(['http://host:1/', 'http://host:1/v/nissan-r34', 'http://host:1/u/kenji.r34']);
    // No preset: the Lighthouse default is the mobile profile.
    expect(collect.settings.preset).toBeUndefined();
    expect(existsSync(collect.chromePath)).toBe(true);
    expect(assert.assertions).toEqual({
      'categories:performance': ['error', { minScore: 0.9 }],
      'categories:accessibility': ['error', { minScore: 0.95 }],
      'categories:best-practices': ['error', { minScore: 0.95 }],
      'categories:seo': ['error', { minScore: 0.95 }],
      'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
      'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      'total-blocking-time': ['error', { maxNumericValue: 200 }],
    });
  });
});

test.describe('rate-limit pacing of the runner', () => {
  const routeList = [
    { uri: 'api/v1/app-config', method: 'GET|HEAD', middleware: ['api', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:public-read'] },
    {
      uri: 'api/v1/search',
      method: 'GET|HEAD',
      middleware: ['api', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:browse', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:search'],
    },
    { uri: 'api/v1/auth/me', method: 'GET|HEAD', middleware: ['api', 'member'] },
    { uri: 'C/{code}', method: 'GET|HEAD', middleware: ['web', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:qr'] },
  ];
  const config = {
    public_read: { max: 300, minutes: 1 },
    search: { max: 6, minutes: 1 },
    browse: { max: 300, minutes: 1 },
    qr: { max: 120, minutes: 1 },
    member_register: { max: 5, minutes: 60 },
  };

  test('cells of all routes in turn, each route in its own order', () => {
    const items = ['A1', 'A2', 'A3', 'B1', 'C1', 'C2'];
    expect(interleaveByRoute(items, (i) => i[0] as string)).toEqual(['A1', 'B1', 'C1', 'A2', 'C2', 'A3']);
  });

  test('route uris become path patterns', () => {
    expect(uriToRegex('api/v1/vehicles/{vehicle}').test('/api/v1/vehicles/01ABC')).toBe(true);
    expect(uriToRegex('api/v1/vehicles/{vehicle}').test('/api/v1/vehicles/01ABC/qr')).toBe(false);
    expect(uriToRegex('/').test('/')).toBe(true);
    expect(uriToRegex('u/{username}/{tab?}').test('/u/lukas.sc')).toBe(true);
  });

  test("limits come from the server's routes and config, only those of its routes", () => {
    const { limits } = buildLimits(routeList, config);
    expect(limits).toEqual({
      'public-read': { max: 300, windowMs: 60_000 },
      search: { max: 6, windowMs: 60_000 },
      browse: { max: 300, windowMs: 60_000 },
      qr: { max: 120, windowMs: 60_000 },
    });
    expect(() => buildLimits([{ uri: 'x', method: 'GET', middleware: ['x:ThrottleRequests:nope'] }], config)).toThrow(/nope/);
  });

  test('plain throttles (throttle:60,1) share one limiter with the smallest maximum and the longest window', () => {
    const list = [
      { uri: 'admin/search', method: 'GET|HEAD', middleware: ['web', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:60,1'] },
      { uri: 'admin/search/suggest', method: 'GET|HEAD', middleware: ['web', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:120,2'] },
    ];
    const { limits, routes: throttled } = buildLimits(list, config);
    expect(limits).toEqual({ [PLAIN_LIMITER]: { max: 60, windowMs: 120_000 } });
    expect(throttled.map((r) => r.limiters)).toEqual([[PLAIN_LIMITER], [PLAIN_LIMITER]]);
  });

  test('a cell waits until its limiter has room in the window, and a 429 blocks it for Retry-After', () => {
    let now = 0;
    const budget = new RateBudget(buildLimits(routeList, config), { now: () => now });
    expect(budget.limitersOf('GET', '/api/v1/search')).toEqual(['browse', 'search']);
    expect(budget.limitersOf('GET', '/api/v1/auth/me')).toEqual([]);

    // Learn that a cell of DISC-02 makes one search request.
    const learn = { routeId: 'DISC-02', counts: new Map<string, number>() };
    budget.record(learn, 'GET', '/api/v1/search');
    budget.release(learn);
    for (let i = 0; i < 5; i++) budget.record(null, 'GET', '/api/v1/search');
    expect(budget.used('search')).toBe(6);
    expect(budget.hasRoom('DISC-02')).toBe(false);
    expect(budget.hasRoom('OTHER-1')).toBe(false); // an unknown route reserves a first guess on every limiter
    now = 60_001;
    expect(budget.used('search')).toBe(0);
    expect(budget.hasRoom('DISC-02')).toBe(true);

    // The server's own count (an earlier run used the bucket) is a floor.
    budget.observe('GET', '/api/v1/search', 200, { 'x-ratelimit-limit': '6', 'x-ratelimit-remaining': '0' });
    expect(budget.hasRoom('DISC-02')).toBe(false);
    now += 60_001;
    expect(budget.hasRoom('DISC-02')).toBe(true);

    budget.observe('GET', '/api/v1/search', 429, { 'retry-after': '30' });
    expect(budget.hasRoom('DISC-02')).toBe(false);
    now += 30_001;
    expect(budget.hasRoom('DISC-02')).toBe(true);
  });

  test('cells still running keep their reservation', () => {
    const budget = new RateBudget(buildLimits(routeList, config), { now: () => 0 });
    const learn = { routeId: 'DISC-02', counts: new Map<string, number>() };
    budget.record(learn, 'GET', '/api/v1/search');
    budget.record(learn, 'GET', '/api/v1/search');
    budget.release(learn);
    // 2 used, 2 reserved by each of the two running cells: no room for a third.
    void budget.acquire('DISC-02');
    expect(budget.hasRoom('DISC-02')).toBe(true);
    void budget.acquire('DISC-02');
    expect(budget.hasRoom('DISC-02')).toBe(false);
  });

  test('a cell that once needed more than a limiter allows still gets room once the window is empty', () => {
    let now = 0;
    const budget = new RateBudget(buildLimits(routeList, config), { now: () => now });
    const learn = { routeId: 'DISC-02', counts: new Map<string, number>() };
    for (let i = 0; i < 9; i++) budget.record(learn, 'GET', '/api/v1/search'); // 9 > search max 6
    budget.release(learn);
    expect(budget.hasRoom('DISC-02')).toBe(false);
    now = 60_001;
    expect(budget.hasRoom('DISC-02')).toBe(true);
  });

  test('acquire gives up with the limiter in the message instead of waiting forever', async () => {
    let now = 0;
    const budget = new RateBudget(buildLimits(routeList, config), { now: () => now });
    const learn = { routeId: 'DISC-02', counts: new Map<string, number>() };
    budget.record(learn, 'GET', '/api/v1/search');
    budget.release(learn);
    // Once that hit has left the window, six running cells reserve all of search (max 6) and never finish. A seventh waits, and
    // the clock runs past two windows: the reservations never end, so it must give up rather than poll forever.
    now = 60_001;
    for (let i = 0; i < 6; i++) void budget.acquire('DISC-02');
    expect(budget.hasRoom('DISC-02')).toBe(false);
    const waiting = budget.acquire('DISC-02');
    now = 60_001 + 120_001;
    await expect(waiting).rejects.toThrow(/DISC-02 on search/);
  });

  // The clock is injected, the queue is polled on real timers: one poll is 50 ms (POLL_MS), so 150 ms of real time is a poll.
  const poll = () => new Promise((resolve) => setTimeout(resolve, 150));
  const watch = (promise: Promise<unknown>) => {
    const state: { started: boolean; error: Error | null } = { started: false, error: null };
    promise.then(
      () => {
        state.started = true;
      },
      (e: Error) => {
        state.error = e;
      },
    );
    return state;
  };
  /** A budget whose routes have learned their needs at 0 and whose window is empty again at T. */
  const T = 60_001;
  const learned = (clock: () => number, needs: Record<string, [string, number]>) => {
    const budget = new RateBudget(buildLimits(routeList, config), { now: clock });
    for (const [routeId, [path, n]] of Object.entries(needs)) {
      const learn = { routeId, counts: new Map<string, number>() };
      for (let i = 0; i < n; i++) budget.record(learn, 'GET', path);
      budget.release(learn);
    }
    return budget;
  };

  test('a 429 that arrives late blocks a waiter for its Retry-After, beyond two windows of its own start, without failing it', async () => {
    let now = 0;
    const budget = learned(() => now, { 'DISC-02': ['/api/v1/search', 1] });
    now = T;
    const running = await Promise.all(Array.from({ length: 6 }, () => budget.acquire('DISC-02')));
    const waiter = watch(budget.acquire('DISC-02'));
    await poll();
    expect(waiter).toEqual({ started: false, error: null });

    // 100 s later a cell of the run gets a 429 with Retry-After 60: search is blocked until T + 160 s.
    now = T + 100_000;
    budget.observe('GET', '/api/v1/search', 429, { 'retry-after': '60' });
    // Two windows after the waiter's start have passed, the block still runs: that is no deadlock.
    now = T + 130_000;
    await poll();
    expect(waiter).toEqual({ started: false, error: null });
    now = T + 150_000;
    for (const cell of running) budget.release(cell);
    await poll();
    expect(waiter, 'room on search, but Retry-After has not ended').toEqual({ started: false, error: null });
    now = T + 160_001;
    await poll();
    expect(waiter).toEqual({ started: true, error: null });
  });

  test('first come, first served: a large need starts before smaller needs that came later, and other limiters are not held up', async () => {
    let now = 0;
    const budget = learned(() => now, {
      BIG: ['/api/v1/search', 6],
      SMALL: ['/api/v1/search', 1],
      'QR-01': ['/C/abc', 1],
    });
    now = T;
    const small = await Promise.all(Array.from({ length: 3 }, () => budget.acquire('SMALL')));
    const order: string[] = [];
    const big = budget.acquire('BIG');
    void big.then(() => order.push('BIG'));
    const later = Array.from({ length: 2 }, (_, i) =>
      budget.acquire('SMALL').then((cell) => {
        order.push(`SMALL-${i}`);
        return cell;
      }),
    );
    // QR-01 needs nothing BIG waits for: the queue on search must not keep it waiting.
    const qr = watch(budget.acquire('QR-01'));
    await poll();
    expect(qr.started).toBe(true);
    expect(budget.hasRoom('SMALL'), 'search has room for a small cell').toBe(true);
    expect(order, 'but the small cells that came later wait behind BIG').toEqual([]);

    // The small cells end one by one: every gap would fit a later small cell, and BIG waits until it fits.
    for (const cell of small) {
      budget.release(cell);
      await poll();
    }
    expect(order).toEqual(['BIG']);
    budget.release(await big);
    const cells = await Promise.all(later);
    expect(order).toEqual(['BIG', 'SMALL-0', 'SMALL-1']);
    for (const cell of cells) budget.release(cell);
  });

  test('a real deadlock still fails, two windows after the budget last made progress, with the limiter and the wait in the message', async () => {
    let now = 0;
    const budget = learned(() => now, { 'DISC-02': ['/api/v1/search', 1], 'QR-01': ['/C/abc', 1] });
    now = T;
    for (let i = 0; i < 6; i++) void budget.acquire('DISC-02'); // never released
    const qr = await budget.acquire('QR-01');
    const waiting = budget.acquire('DISC-02');
    const waiter = watch(waiting);
    // A cell that ends is progress: the deadline starts again from T + 100 s.
    now = T + 100_000;
    budget.release(qr);
    now = T + 130_000;
    await poll();
    expect(waiter).toEqual({ started: false, error: null });
    now = T + 220_000;
    await poll();
    expect(waiter).toEqual({ started: false, error: null });
    now = T + 220_002;
    await expect(waiting).rejects.toThrow(/^Rate budget: no room for a cell of DISC-02 on search after 220 s$/);
  });

  test('a late 429 on a limiter only an older waiter needs does not fail the waiter queued behind it', async () => {
    let now = 0;
    const budget = learned(() => now, { HOLD: ['/C/abc', 120], READER: ['/api/v1/app-config', 1] });
    now = T;
    const hold = await budget.acquire('HOLD'); // all of qr
    const unseen = watch(budget.acquire('UNSEEN')); // a first guess on every limiter, so it waits for qr
    const reader = watch(budget.acquire('READER')); // public-read has room; UNSEEN waits for qr only, so it does not hold public-read
    await poll();
    expect([unseen, reader], 'a waiter held up on qr keeps nobody off public-read').toEqual([{ started: false, error: null }, { started: true, error: null }]);

    // Blocked until T + 160 s. Two windows after the last progress (T) pass while the block still runs: no deadlock.
    now = T + 100_000;
    budget.observe('GET', '/C/abc', 429, { 'retry-after': '60' });
    now = T + 125_000;
    await poll();
    expect(unseen).toEqual({ started: false, error: null });
    now = T + 150_000;
    budget.release(hold);
    await poll();
    expect(unseen, 'room on qr, but Retry-After has not ended').toEqual({ started: false, error: null });
    now = T + 160_001;
    await poll();
    expect(unseen).toEqual({ started: true, error: null });
  });

  test('a real deadlock fails the waiter it holds, and never holds up a waiter that has room', async () => {
    let now = 0;
    const budget = learned(() => now, { HOLD: ['/C/abc', 120], READER: ['/api/v1/app-config', 1] });
    now = T;
    await budget.acquire('HOLD'); // never released
    const stuck = budget.acquire('UNSEEN');
    const unseen = watch(stuck);
    const reader = watch(budget.acquire('READER'));
    await poll();
    // Head-of-line blocking was the stall of M2.8 round 3: the reader has room on public-read and starts at once.
    expect([unseen, reader]).toEqual([{ started: false, error: null }, { started: true, error: null }]);
    now = T + 120_000;
    await poll();
    expect(unseen).toEqual({ started: false, error: null });
    now = T + 120_001;
    await expect(stuck).rejects.toThrow(/^Rate budget: no room for a cell of UNSEEN on qr after 120 s$/);
  });

  test('a waiter held up on a day-long limiter fails twenty minutes after the last progress, not two days', async () => {
    let now = T;
    const list = [...routeList, { uri: 'api/v1/reports', method: 'POST', middleware: ['api', 'Illuminate\\Routing\\Middleware\\ThrottleRequests:reports'] }];
    const budget = new RateBudget(buildLimits(list, { ...config, reports: { max: 20, minutes: 1440 } }), { now: () => now });
    // The server says the day's reports are used up: no room on it for a day.
    budget.observe('POST', '/api/v1/reports', 201, { 'x-ratelimit-limit': '20', 'x-ratelimit-remaining': '0' });
    const stuck = budget.acquire('UNSEEN'); // a first guess on every limiter, the day-long one too
    const waiter = watch(stuck);
    now = T + 20 * 60_000;
    await poll();
    expect(waiter).toEqual({ started: false, error: null });
    now = T + 20 * 60_000 + 1;
    await expect(stuck).rejects.toThrow(/^Rate budget: no room for a cell of UNSEEN on reports after 1200 s$/);
  });

  const roomComingBack: [string, (budget: RateBudget) => void][] = [
    ['a hit leaving the window', (budget) => budget.record(null, 'GET', '/api/v1/search')],
    ["the server's count leaving its window", (budget) => budget.observe('GET', '/api/v1/search', 200, { 'x-ratelimit-limit': '6', 'x-ratelimit-remaining': '0' })],
  ];
  for (const [source, occupy] of roomComingBack) {
    test(`${source} is progress: the deadline starts again from there`, async () => {
      let now = 0;
      const budget = learned(() => now, { 'DISC-02': ['/api/v1/search', 1] });
      now = T;
      for (let i = 0; i < 6; i++) void budget.acquire('DISC-02'); // never released: they hold the room whatever leaves the window
      occupy(budget);
      const waiting = budget.acquire('DISC-02');
      const waiter = watch(waiting);
      now = T + 60_000; // it leaves the window here
      await poll();
      now = T + 121_000; // two windows after the last cell started: without the progress above, this is past the deadline
      await poll();
      expect(waiter).toEqual({ started: false, error: null });
      now = T + 180_000;
      await poll();
      expect(waiter).toEqual({ started: false, error: null });
      now = T + 180_001;
      await expect(waiting).rejects.toThrow(/^Rate budget: no room for a cell of DISC-02 on search after 180 s$/);
    });
  }

  test('an attempt that failed before any request leaves its route unknown: its next cell still waits for a block to end', async () => {
    let now = 0;
    const budget = new RateBudget(buildLimits(routeList, config), { now: () => now });
    budget.release(await budget.acquire('NEW-1'), { completed: false });
    budget.observe('GET', '/C/abc', 429, { 'retry-after': '30' });
    expect(budget.hasRoom('NEW-1'), 'a route not learned yet respects the block on every limiter').toBe(false);
    const behind = watch(budget.acquire('NEW-1'));
    await poll();
    expect(behind).toEqual({ started: false, error: null });
    now += 30_001;
    await poll();
    expect(behind).toEqual({ started: true, error: null });
  });

  test('what a failed attempt requested raises the need of its route, and only a completed one drops the first guess', async () => {
    let now = 0;
    const budget = new RateBudget(buildLimits(routeList, config), { now: () => now });
    const qrBlocked = () => budget.observe('GET', '/C/abc', 429, { 'retry-after': '30' });

    // Failed after one search request: search is known to be used, qr was not reached and keeps its first guess.
    const partial = await budget.acquire('NEW-2');
    budget.record(partial, 'GET', '/api/v1/search');
    budget.release(partial, { completed: false });
    qrBlocked();
    expect(budget.hasRoom('NEW-2')).toBe(false);
    now += 30_001;
    expect(budget.hasRoom('NEW-2')).toBe(true);

    // A failed attempt that made six requests: six of search count from now on, not the first guess of four.
    now += 60_001;
    const greedy = await budget.acquire('NEW-2');
    for (let i = 0; i < 6; i++) budget.record(greedy, 'GET', '/api/v1/search');
    budget.release(greedy, { completed: false });
    now += 60_001;
    budget.record(null, 'GET', '/api/v1/search'); // 1 of 6 used: room for the first guess, none for the six
    expect(budget.hasRoom('NEW-2')).toBe(false);

    // Completed with search only: qr is not its limiter, a block there is none of its business.
    now += 60_001;
    const done = await budget.acquire('NEW-2');
    budget.record(done, 'GET', '/api/v1/search');
    budget.release(done);
    now += 60_001;
    qrBlocked();
    expect(budget.hasRoom('NEW-2')).toBe(true);
  });
});

test.describe('runner CLI', () => {
  test('dry run lists the plan and leaves planned routes out', async ({}, testInfo) => {
    // Its own registry: which real routes are still planned changes with every module.
    const file = testInfo.outputPath('routes.json');
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'TEST-3', path: '/app/garage', phase: 1, auth: 'guest', states: ['default'], ready: '[data-testid="GAR-01.root"]' },
        { id: 'TEST-4', path: '/app/later', phase: 1, auth: 'guest', states: ['default'], ready: '[data-testid="x"]', status: 'planned' },
      ]),
    );
    const { stdout } = await exec(process.execPath, [RUNNER, '--tier=module', `--routes-file=${file}`, '--dry-run']);
    expect(stdout).toContain('TEST-3__390x844__carbon__de');
    expect(stdout).toContain('Planned, not run: TEST-4');
    expect(stdout).not.toContain('TEST-4__');
  });

  test('a phase run takes the routes of that phase and of every earlier one, and none of a later one', async ({}, testInfo) => {
    const file = testInfo.outputPath('routes.json');
    const route = (id: string, phase: number) => ({ id, path: '/app/garage', phase, auth: 'guest', states: ['default'], viewports: [390], ready: '[data-testid="x"]' });
    writeFileSync(file, JSON.stringify([route('TEST-6', 1), route('TEST-7', 2), route('TEST-8', 3)]));
    const { stdout } = await exec(process.execPath, [RUNNER, '--tier=phase', '--phase=2', `--routes-file=${file}`, '--dry-run']);
    expect(stdout).toContain('TEST-6__390x844__carbon__de');
    expect(stdout).toContain('TEST-7__390x844__carbon__de');
    expect(stdout).not.toContain('TEST-8__');
  });

  test('wrong usage exits 2', async () => {
    for (const args of [['--tier=everything'], ['--tier=phase'], ['--routes=NOPE-1', '--dry-run']]) {
      await expect(exec(process.execPath, [RUNNER, ...args])).rejects.toMatchObject({ code: 2 });
    }
  });

  test('device pixels above 1 need --out and never update baselines: wrong usage exits 2', async ({}, testInfo) => {
    const out = testInfo.outputPath('visual');
    for (const args of [['--device-scale=2'], ['--device-scale=2', '--update-baselines'], ['--device-scale=2', `--out=${out}`, '--update-baselines'], ['--device-scale=4', `--out=${out}`]]) {
      // --dry-run: should the check ever go, this fails at once instead of capturing every route into the default folder.
      await expect(exec(process.execPath, [RUNNER, '--tier=module', '--dry-run', ...args]), args.join(' ')).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining('--device-scale'),
      });
    }
    expect(existsSync(out), 'a usage error writes nothing').toBe(false);

    // The flag itself is allowed: with --out it plans like any run.
    const file = testInfo.outputPath('routes.json');
    writeFileSync(file, JSON.stringify([{ id: 'TEST-5', path: '/app/garage', phase: 1, auth: 'guest', states: ['default'], ready: '[data-testid="x"]' }]));
    const { stdout } = await exec(process.execPath, [RUNNER, '--tier=module', '--device-scale=2', `--out=${out}`, `--routes-file=${file}`, '--dry-run']);
    expect(stdout).toContain('TEST-5__390x844__carbon__de');
  });

  test('a real capture writes all reports, and the exit code agrees with the summary', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const out = testInfo.outputPath('visual');
    const baselines = testInfo.outputPath('baselines');
    const run = await exec(process.execPath, [RUNNER, '--tier=module', '--routes=GAR-01', '--workers=2', `--out=${out}`, `--baselines=${baselines}`]).then(
      () => 0,
      (e: { code: number }) => e.code,
    );
    const dir = join(out, 'phase-1');
    for (const name of ['GAR-01__390x844__carbon__de', 'GAR-01__360x780__light__de', 'GAR-01__430x932__black__en', 'GAR-01__1280x800__carbon__de']) {
      expect(existsSync(join(dir, `${name}.png`)), name).toBe(true);
      const audit = JSON.parse(readFileSync(join(dir, `${name}.audit.json`), 'utf8'));
      expect(audit.failed).toBe(false);
      expect(audit.high).toEqual(expect.any(Number));
    }
    expect(existsSync(join(dir, 'contact', 'GAR-01.png'))).toBe(true);
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary.totals.captured).toBe(4);
    expect(summary.totals.baselineNew).toBe(4);
    expect(summary.passed).toBe(run === 0);
    expect(existsSync(baselines), 'a normal run writes no baselines').toBe(false);
  });

  test('a route that does not render its screen fails instead of photographing a fallback', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const dir = testInfo.outputPath();
    const out = join(dir, 'visual');
    const file = join(dir, 'routes.json');
    writeFileSync(
      file,
      JSON.stringify([{ id: 'TEST-1', path: '/app/does-not-exist', phase: 1, auth: 'guest', states: ['default'], viewports: [390], ready: '[data-testid="never.renders"]' }]),
    );
    const code = await exec(process.execPath, [RUNNER, '--tier=module', `--routes-file=${file}`, '--ready-timeout=1500', '--workers=2', `--out=${out}`]).then(
      () => 0,
      (e: { code: number }) => e.code,
    );
    expect(code).toBe(1);
    const summary = JSON.parse(readFileSync(join(out, 'phase-1', 'summary.json'), 'utf8'));
    expect(summary.passed).toBe(false);
    expect(summary.totals.failed).toBe(1);
    expect(summary.failures[0].error).toContain('never.renders');
  });

  test('an enforced route whose page ignores the qa overrides fails with High violations, and cannot become a baseline', async ({}, testInfo) => {
    test.setTimeout(120_000);
    const dir = testInfo.outputPath();
    const out = join(dir, 'visual');
    const baselines = join(dir, 'baselines');
    const file = join(dir, 'routes.json');
    // No qaContract: false here. The health page of Laravel does not report overrides, as this test needs; the app does now.
    writeFileSync(
      file,
      JSON.stringify([{ id: 'TEST-2', path: '/up', phase: 1, auth: 'guest', states: ['default'], viewports: [390], ready: 'body' }]),
    );
    const code = await exec(process.execPath, [
      RUNNER,
      '--tier=module',
      `--routes-file=${file}`,
      '--update-baselines',
      '--workers=2',
      `--out=${out}`,
      `--baselines=${baselines}`,
    ]).then(
      () => 0,
      (e: { code: number }) => e.code,
    );
    expect(code).toBe(1);
    const audit = JSON.parse(readFileSync(join(out, 'phase-1', 'TEST-2__390x844__carbon__de.audit.json'), 'utf8'));
    expect(audit.violations.some((v: { check: string }) => v.check === 'qa-override')).toBe(true);
    expect(audit.baseline.status).toBe('refused');
    expect(existsSync(baselines)).toBe(false);
  });
});

// The runner end to end against a node:http stub: no app, no database, no artisan, not port 8080. The stub's screen reports the
// qa overrides it was given and is audit clean, so each test here fails or passes for the one thing it provokes.
test.describe('runner failure paths against a stub server', () => {
  test.describe.configure({ timeout: 180_000 });

  type Answer = { status: number; headers?: Record<string, string>; body?: string };
  type Answers = Record<string, (nth: number, url: URL) => Answer>;
  type Hit = { path: string; status: number; at: number };
  const CELL = 'STUB-1__390x844__carbon__de';
  const NO_LIMITS = { routes: [], config: {} };
  const callsApi = (path: string) => `<script>void fetch('${path}');</script>`;
  // Nothing but page.screenshot can end this hour-long animation, as it finishes finite animations (`animations: 'disabled'`).
  // The request is synchronous, so the frame of the screenshot waits for the answer and the 429 always comes before the picture.
  const callsApiDuringScreenshot = (path: string) =>
    `<style>body{animation:hold 3600s}@keyframes hold{from{opacity:1}to{opacity:1}}</style>` +
    `<script>addEventListener('animationend',()=>{const x=new XMLHttpRequest();x.open('GET','${path}',false);x.send();});</script>`;
  const screen = (url: URL, head = ''): Answer => {
    const q = url.searchParams;
    const qa = {
      theme: q.get('qaTheme'),
      locale: q.get('qaLocale'),
      'font-scale': q.get('qaFontScale') ?? '1',
      state: q.get('qaState') ?? 'default',
      motion: q.get('qaMotion'),
    };
    const attributes = Object.entries(qa).map(([name, value]) => `data-qa-${name}="${value}"`).join(' ');
    return { status: 200, body: `<!doctype html><html lang="de" ${attributes}><head><title>Stub</title>${head}</head><body style="margin:0;min-height:100vh"></body></html>` };
  };
  const route = (id: string, path: string) => ({ id, path, phase: 1, auth: 'guest', states: ['default'], viewports: [390], ready: 'body' });

  const runAgainstStub = async (
    testInfo: TestInfo,
    answers: Answers,
    {
      routes = [route('STUB-1', '/screen')] as object[],
      limits = NO_LIMITS as object,
      args = [] as string[],
      app = (_nth: number): Answer => ({ status: 200, body: '_expo/static/js/web/stub.js' }),
      exportChanged = false,
    } = {},
  ) => {
    const hits: Hit[] = [];
    const counts = new Map<string, number>();
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stub');
      const nth = (counts.get(url.pathname) ?? 0) + 1;
      counts.set(url.pathname, nth);
      // What appFingerprint reads at the start and the end of a run.
      const answer: Answer = url.pathname === '/app/' ? app(nth) : (answers[url.pathname]?.(nth, url) ?? { status: 404 });
      if (url.pathname !== '/app/') hits.push({ path: url.pathname, status: answer.status, at: Date.now() });
      res.writeHead(answer.status, { 'content-type': 'text/html; charset=utf-8', ...answer.headers });
      res.end(answer.body ?? '');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const out = testInfo.outputPath('visual');
    const baselines = testInfo.outputPath('baselines');
    const routesFile = testInfo.outputPath('routes.json');
    const limitsFile = testInfo.outputPath('limits.json');
    writeFileSync(routesFile, JSON.stringify(routes));
    writeFileSync(limitsFile, JSON.stringify(limits));
    const run = await exec(
      process.execPath,
      [RUNNER, '--tier=module', '--workers=1', `--routes-file=${routesFile}`, `--limits-file=${limitsFile}`, `--out=${out}`, `--baselines=${baselines}`, ...args],
      { env: { ...process.env, SPEEDCLUB_BASE_URL: base } },
    ).then(
      ({ stdout }) => ({ code: 0, output: stdout }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, output: `${e.stdout}\n${e.stderr}` }),
    );
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const dir = join(out, 'phase-1');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary.baseUrl, 'the run went to the stub').toBe(base);
    expect(summary.exportChangedDuringRun, 'whether the exit code is about the export').toBe(exportChanged);
    return {
      ...run,
      hits,
      hitsOf: (path: string) => hits.filter((h) => h.path === path),
      summary,
      baselines,
      audit: JSON.parse(readFileSync(join(dir, `${CELL}.audit.json`), 'utf8')),
      png: join(dir, `${CELL}.png`),
      contactSheet: join(dir, 'contact', 'STUB-1.png'),
    };
  };

  test('DQ-501: a state cell that looks like the default fails the run as High state-not-rendered, a drawn state passes', async ({}, testInfo) => {
    // `loading` reports its data-qa-state but draws the default; `error` draws a block of its own.
    const drawn = (url: URL) =>
      screen(url, url.searchParams.get('qaState') === 'error' ? `<style>body::before{content:'';display:block;height:200px;background:#7f7f7f}</style>` : '');
    const run = await runAgainstStub(testInfo, { '/screen': (_, url) => drawn(url) }, {
      routes: [{ ...route('STUB-1', '/screen'), states: ['default', 'loading', 'error'] }],
      args: ['--tier=phase', '--phase=1', '--fail-on=high'],
    });
    expect(run.code, run.output).toBe(1);
    const dir = join(testInfo.outputPath('visual'), 'phase-1');
    const audit = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.audit.json`), 'utf8'));
    expect(audit(`${CELL}__loading`).violations).toContainEqual(
      expect.objectContaining({ check: 'state-not-rendered', severity: 'High', message: expect.stringContaining(`looks like ${CELL}`) }),
    );
    expect(audit(`${CELL}__loading`).high).toBeGreaterThan(0);
    expect(audit(`${CELL}__error`).violations.map((v: { check: string }) => v.check)).not.toContain('state-not-rendered');
    expect(audit(CELL).violations.map((v: { check: string }) => v.check)).not.toContain('state-not-rendered');
    expect(run.summary.topFindings.map((f: { finding: string }) => f.finding).join('\n')).toContain('state-not-rendered');
  });

  test('DQ-501: defaultCellOf and findUnrenderedStates compare each state with its own default only', async ({}, testInfo) => {
    const dir = testInfo.outputPath('states');
    mkdirSync(dir, { recursive: true });
    const base = 'X-01__1280x800__carbon__de';
    const write = async (name: string, colour: string) => writeFileSync(join(dir, `${name}.png`), await png(40, 40, colour));
    await write(base, '#101010');
    await write(`${base}__loading`, '#101010');
    await write(`${base}__empty`, '#f0f0f0');
    await write(`${base}__zoom2`, '#101010');
    await write('X-01__1440x900__light__de__error', '#101010');
    expect(defaultCellOf({ name: `${base}__loading`, state: 'loading' })).toBe(base);
    expect(defaultCellOf({ name: base, state: 'default' })).toBeNull();
    expect(defaultCellOf({ name: `${base}__zoom2`, state: 'default' })).toBeNull();
    const found = await findUnrenderedStates(
      [
        { name: base, state: 'default' },
        { name: `${base}__loading`, state: 'loading' },
        { name: `${base}__empty`, state: 'empty' },
        { name: `${base}__zoom2`, state: 'default' },
        // Its default (1440 light) was not captured: nothing to compare with.
        { name: 'X-01__1440x900__light__de__error', state: 'error' },
      ],
      dir,
    );
    expect(found).toEqual([{ name: `${base}__loading`, defaultName: base, ratio: 0 }]);
    // A failed default is no reference.
    expect(await findUnrenderedStates([{ name: base, state: 'default', failed: true }, { name: `${base}__loading`, state: 'loading' }], dir)).toEqual([]);
  });

  test('a page that keeps polling stops when its cell is done, so the next cell gets the room it waits for', async ({}, testInfo) => {
    test.setTimeout(120_000);
    // Verify of 2026-11-08, run 2: pages left on MSG routes kept polling on `browse` while every worker waited for room on it.
    // Here STUB-1 polls the limited path three times a second (3 per 6 s allowed), and STUB-2 needs it once.
    const polling = (url: URL) => screen(url, `<script>void fetch('/api/limited');setInterval(()=>fetch('/api/limited'),300);</script>`);
    const run = await runAgainstStub(
      testInfo,
      { '/screen': (_, url) => polling(url), '/quiet': (_, url) => screen(url, callsApi('/api/limited')), '/api/limited': () => ({ status: 200, body: '{}' }) },
      {
        routes: [route('STUB-1', '/screen'), route('STUB-2', '/quiet')],
        limits: {
          routes: [{ uri: 'api/limited', method: 'GET|HEAD', middleware: ['ThrottleRequests:stub-limit'] }],
          config: { stub_limit: { max: 3, minutes: 0.1 } },
        },
        args: ['--idle-timeout=30000'],
      },
    );
    expect(run.code, run.output).toBe(0);
    expect(run.summary.totals).toMatchObject({ failed: 0 });
    expect(run.hitsOf('/quiet').length, 'every STUB-2 cell ran').toBeGreaterThan(0);
  });

  test('an attempt that hangs fails at the watchdog with the step it was in, and the retry gets a new browser', async ({}, testInfo) => {
    test.setTimeout(60_000);
    // The ready element never comes, and the ready wait alone would take ten minutes.
    const never = { ...route('STUB-1', '/screen'), ready: '#never' };
    const run = await runAgainstStub(testInfo, { '/screen': (_, url) => screen(url) }, { routes: [never], args: ['--ready-timeout=600000', '--cell-timeout=3000'] });
    expect(run.code, run.output).toBe(1);
    expect(run.audit).toMatchObject({ failed: true, attempts: 2 });
    expect(run.audit.error).toMatch(/^Watchdog: the attempt took over 3 s, stuck at "STUB-1__390x844__carbon__de · waiting for the ready element"/);
    expect(run.hitsOf('/screen'), 'each attempt loaded the page').toHaveLength(2);
    expect(run.output).toContain('FAILED STUB-1__390x844__carbon__de: Watchdog');
  });

  test('a run in which no cell finishes aborts at the idle guard with what every worker was doing', async ({}, testInfo) => {
    test.setTimeout(60_000);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stub');
      const answer = url.pathname === '/app/' ? { status: 200, body: 'stub' } : url.pathname === '/screen' ? screen(url) : { status: 404, body: '' };
      res.writeHead(answer.status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(answer.body ?? '');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const routesFile = testInfo.outputPath('routes.json');
    const limitsFile = testInfo.outputPath('limits.json');
    writeFileSync(routesFile, JSON.stringify([{ ...route('STUB-1', '/screen'), ready: '#never' }]));
    writeFileSync(limitsFile, JSON.stringify(NO_LIMITS));
    const started = Date.now();
    const run = await exec(
      process.execPath,
      [RUNNER, '--tier=module', '--workers=1', `--routes-file=${routesFile}`, `--limits-file=${limitsFile}`, `--out=${testInfo.outputPath('visual')}`,
        `--baselines=${testInfo.outputPath('baselines')}`, '--ready-timeout=600000', '--cell-timeout=600000', '--idle-timeout=3000'],
      { env: { ...process.env, SPEEDCLUB_BASE_URL: base } },
    ).then(
      ({ stdout }) => ({ code: 0, output: stdout }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, output: `${e.stdout}\n${e.stderr}` }),
    );
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    expect(run.code, run.output).toBe(2);
    expect(run.output).toMatch(/ABORTED: no cell finished for \d+ min \(0\/1 done\)\. In flight: worker 1: STUB-1__390x844__carbon__de · waiting for the ready element/);
    expect(Date.now() - started, 'long before the ten-minute ready wait').toBeLessThan(30_000);
  });

  test('control: a clean screen passes at the first attempt with its picture', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, { '/screen': (_, url) => screen(url) });
    expect(run.code, run.output).toBe(0);
    expect(run.audit).toMatchObject({ failed: false, attempts: 1, retryReason: null, high: 0, medium: 0 });
    expect(run.summary.passed).toBe(true);
    expect((await sharp(run.png).metadata()).width).toBe(390);
  });

  test('an API call answering 429 on every load fails the cell: exit 1, the 429 in the error, no picture on disk', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, {
      '/screen': (_, url) => screen(url, callsApi('/api/data')),
      '/api/data': () => ({ status: 429 }),
    });
    expect(run.code, run.output).toBe(1);
    expect(run.audit.failed).toBe(true);
    expect(run.audit.error).toContain('Rate limited by the server (429)');
    expect(run.audit.error).toContain('/api/data');
    expect(run.audit.attempts).toBe(2);
    expect(run.hitsOf('/screen')).toHaveLength(2);
    expect(existsSync(run.png), 'no picture of the error state').toBe(false);
    expect(existsSync(run.contactSheet), 'nothing for the contact sheet').toBe(false);
    expect(run.summary.passed).toBe(false);
    expect(run.summary.totals).toMatchObject({ planned: 1, captured: 0, failed: 1 });
    expect(run.summary.failures).toEqual([{ name: CELL, error: run.audit.error }]);
  });

  test('a page answering 429 itself on every load fails the cell the same way', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, { '/screen': () => ({ status: 429, body: 'Too Many Requests' }) });
    expect(run.code, run.output).toBe(1);
    expect(run.audit.failed).toBe(true);
    expect(run.audit.error).toMatch(/\b429\b/);
    expect(run.audit.attempts).toBe(2);
    expect(existsSync(run.png)).toBe(false);
    expect(run.summary.totals).toMatchObject({ captured: 0, failed: 1 });
  });

  test('a 429 that arrives only during the screenshot deletes the picture just taken and fails the cell', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, {
      '/screen': (_, url) => screen(url, callsApiDuringScreenshot('/api/late')),
      '/api/late': () => ({ status: 429 }),
    });
    expect(run.code, run.output).toBe(1);
    expect(run.hitsOf('/api/late'), 'once per attempt, from the screenshot').toHaveLength(2);
    expect(run.audit.failed).toBe(true);
    expect(run.audit.error).toContain('Rate limited by the server (429)');
    expect(run.audit.error).toContain('/api/late');
    expect(existsSync(run.png), 'the picture of the error state is gone').toBe(false);
    expect(existsSync(run.contactSheet)).toBe(false);
  });

  test('a step that throws after the picture leaves no picture of the failed cell', async ({}, testInfo) => {
    // A file where the baselines folder should be: writing the baseline throws right after the screenshot, on both attempts.
    const blocked = testInfo.outputPath('not-a-folder');
    writeFileSync(blocked, '');
    const run = await runAgainstStub(testInfo, { '/screen': (_, url) => screen(url) }, { args: ['--update-baselines', `--baselines=${blocked}`] });
    expect(run.code, run.output).toBe(1);
    expect(run.audit).toMatchObject({ failed: true, attempts: 2 });
    expect(existsSync(run.png), 'a failed cell keeps no picture').toBe(false);
    expect(existsSync(run.contactSheet)).toBe(false);
    expect(run.summary.totals).toMatchObject({ captured: 0, failed: 1 });
  });

  test('a server gone at the end of the run still leaves the summary, and the run is invalid', async ({}, testInfo) => {
    const run = await runAgainstStub(
      testInfo,
      { '/screen': (_, url) => screen(url) },
      { app: (nth) => (nth === 1 ? { status: 200, body: '_expo/static/js/web/stub.js' } : { status: 503 }), exportChanged: true },
    );
    expect(run.code, run.output).toBe(1);
    expect(run.output).toContain('INVALID RUN: the server did not answer');
    expect(run.summary.passed).toBe(false);
    expect(run.summary.totals).toMatchObject({ captured: 1, failed: 0 });
    expect(run.audit.failed).toBe(false);
    expect(existsSync(run.png), 'the cell itself was fine').toBe(true);
  });

  const firstLoadRefused: [string, Answers, string][] = [
    [
      'an API call',
      { '/screen': (_, url) => screen(url, callsApi('/api/data')), '/api/data': (nth) => ({ status: nth === 1 ? 429 : 200 }) },
      'Rate limited by the server (429)',
    ],
    ['the page itself', { '/screen': (nth, url) => (nth === 1 ? { status: 429 } : screen(url)) }, 'HTTP 429'],
  ];
  for (const [what, answers, reason] of firstLoadRefused) {
    test(`${what} answering 429 once and then 200: the retry passes, says why it retried, and the picture is there`, async ({}, testInfo) => {
      const run = await runAgainstStub(testInfo, answers);
      expect(run.code, run.output).toBe(0);
      expect(run.hitsOf('/screen')).toHaveLength(2);
      expect(run.audit).toMatchObject({ failed: false, attempts: 2, high: 0, medium: 0 });
      expect(run.audit.retryReason).toContain(reason);
      expect((await sharp(run.png).metadata()).width).toBe(390);
      expect(existsSync(run.contactSheet)).toBe(true);
      expect(run.summary.passed).toBe(true);
      expect(run.summary.totals).toMatchObject({ captured: 1, failed: 0, retried: 1 });
      expect(run.summary.retries).toEqual([{ name: CELL, firstError: run.audit.retryReason }]);
    });
  }

  const apiAnswers500: Answers = { '/screen': (_, url) => screen(url, callsApi('/api/data')), '/api/data': () => ({ status: 500 }) };

  // A plain run on purpose: nothing but the High finding can fail it, as the baseline is new and the cell was captured.
  test('an API call answering 500 is a server-error High finding, which alone fails the run', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, apiAnswers500);
    expect(run.code, run.output).toBe(1);
    expect(run.audit).toMatchObject({ failed: false, attempts: 1, high: 1, medium: 0 });
    expect(run.audit.violations).toEqual([expect.objectContaining({ check: 'server-error', severity: 'High', message: 'HTTP 500 GET /api/data' })]);
    expect(run.audit.baseline.status).toBe('new');
    expect(run.summary.passed).toBe(false);
    expect(run.summary.totals).toMatchObject({ captured: 1, failed: 0, high: 1, medium: 0, baselineMismatch: 0, baselineRefused: 0 });
  });

  test('a screen with that finding cannot become a baseline', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, apiAnswers500, { args: ['--update-baselines'] });
    expect(run.code, run.output).toBe(1);
    expect(run.audit.baseline.status).toBe('refused');
    expect(existsSync(run.baselines)).toBe(false);
  });

  test('a page answering 500 itself fails the cell before any picture', async ({}, testInfo) => {
    const run = await runAgainstStub(testInfo, { '/screen': () => ({ status: 500, body: 'Server Error' }) });
    expect(run.code, run.output).toBe(1);
    expect(run.audit.failed).toBe(true);
    expect(run.audit.error).toContain('HTTP 500');
    expect(run.audit.attempts).toBe(2);
    expect(existsSync(run.png)).toBe(false);
    expect(run.summary.totals).toMatchObject({ captured: 0, failed: 1 });
  });

  test('an attempt that failed says nothing about limiters it did not reach: the next cell of its route waits out a Retry-After', async ({}, testInfo) => {
    const RETRY_AFTER_MS = 5000;
    const run = await runAgainstStub(
      testInfo,
      {
        '/broken': () => ({ status: 500 }),
        '/screen': (_, url) => screen(url, callsApi('/api/limited')),
        '/api/limited': () => ({ status: 429, headers: { 'retry-after': String(RETRY_AFTER_MS / 1000) } }),
      },
      {
        // In turn: a cell of NEW-1 that fails before any request, the 429s of STUB-1, the second cell of NEW-1.
        routes: [{ ...route('NEW-1', '/broken'), viewports: [390, 360] }, route('STUB-1', '/screen')],
        limits: {
          routes: [{ uri: 'api/limited', method: 'GET|HEAD', middleware: ['ThrottleRequests:stub-limit'] }],
          config: { stub_limit: { max: 100, minutes: 1 } },
        },
      },
    );
    expect(run.code, run.output).toBe(1);
    const limited = run.hitsOf('/api/limited');
    const broken = run.hitsOf('/broken');
    expect(limited).toHaveLength(2);
    expect(broken).toHaveLength(4);
    const [first, last] = limited as [Hit, Hit];
    expect(last.at - first.at, 'the retry of the limited cell waits for Retry-After').toBeGreaterThanOrEqual(RETRY_AFTER_MS);
    const secondCell = broken[2] as Hit;
    expect(secondCell.at - last.at, 'NEW-1 has not completed a cell, so the block counts for it too').toBeGreaterThanOrEqual(RETRY_AFTER_MS);
  });
});

test.describe('promoting reviewed screenshots to baselines', () => {
  const HOST = 'http://localhost:8080';
  const registry = [
    { id: 'TEST-P1', hostDependent: false },
    { id: 'TEST-QR', hostDependent: true },
    { id: 'TEST-LIVE', volatile: true },
  ];
  type Shot = { name: string; failed?: boolean; high?: number; medium?: number; width?: number };

  /** A report folder as run.mjs leaves it: summary.json plus one PNG per shot. */
  async function run(dir: string, baseUrl: string, shots: Shot[], extra: Record<string, unknown> = {}): Promise<string> {
    mkdirSync(dir, { recursive: true });
    for (const shot of shots) {
      const cell = parseCell(shot.name);
      writeFileSync(join(dir, `${shot.name}.png`), await png(shot.width ?? cell?.width ?? 1, 4, '#102030'));
    }
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify({ baseUrl, exportChangedDuringRun: false, ...extra, shots: shots.map((s) => ({ name: s.name, failed: s.failed ?? false, high: s.high ?? 0, medium: s.medium ?? 0 })) }),
    );
    return dir;
  }

  test('the baseline host defaults to :8080 like the runner, and cell names parse', () => {
    expect(baselineOrigin({})).toBe(HOST);
    expect(baselineOrigin({ SPEEDCLUB_BASELINE_URL: 'https://staging.example.test/app' })).toBe('https://staging.example.test');
    expect(parseCell('DEV-01-overlays-dialog-long__1440x900__light__en__fs2__offline')).toEqual({ routeId: 'DEV-01-overlays-dialog-long', width: 1440, height: 900, zoom: 1, state: 'offline' });
    expect(parseCell('ADM-06__1280x800__carbon__de__zoom2')).toEqual({ routeId: 'ADM-06', width: 1280, height: 800, zoom: 2, state: 'default' });
    expect(parseCell('nope.png')).toBeNull();
  });

  test('copies exactly the approved cells byte for byte, a route entry takes all of its cells', async ({}, testInfo) => {
    const from = await run(testInfo.outputPath('r4'), 'http://localhost:8081', [
      { name: 'TEST-P1__390x844__carbon__de' },
      { name: 'TEST-P1__1280x800__light__en' },
      { name: 'TEST-P1__360x780__black__de' },
    ]);
    const baselines = testInfo.outputPath('baselines');
    const { cells, problems } = await planPromotion(
      { approvals: [{ from, cells: ['TEST-P1__390x844__carbon__de', 'TEST-P1__1280x800__light__en'] }] },
      { routes: registry, origin: HOST },
    );
    expect(problems).toEqual([]);
    expect(cells.map((c) => c.name)).toEqual(['TEST-P1__390x844__carbon__de', 'TEST-P1__1280x800__light__en']);
    mkdirSync(baselines, { recursive: true });
    writeFileSync(join(baselines, 'TEST-P1__390x844__carbon__de.png'), 'old');
    expect(await promote(cells, baselines)).toEqual({ replaced: ['TEST-P1__390x844__carbon__de'], added: ['TEST-P1__1280x800__light__en'] });
    for (const c of cells) expect(readFileSync(join(baselines, `${c.name}.png`)).equals(readFileSync(c.source)), c.name).toBe(true);
    expect(existsSync(join(baselines, 'TEST-P1__360x780__black__de.png')), 'an unlisted cell is never copied').toBe(false);

    const all = await planPromotion({ approvals: [{ from, routes: ['TEST-P1'] }] }, { routes: registry, origin: HOST });
    expect(all.problems).toEqual([]);
    expect(all.cells).toHaveLength(3);
  });

  test('volatile cells (ADR-223) are skipped, never written; the fixture states and a 1x zoom cell are promoted', async ({}, testInfo) => {
    const from = await run(testInfo.outputPath('live'), HOST, [
      { name: 'TEST-LIVE__1280x800__carbon__de' },
      { name: 'TEST-LIVE__1280x800__carbon__de__zoom2', width: 640 },
      { name: 'TEST-LIVE__1280x800__carbon__de__loading' },
      { name: 'TEST-LIVE__1280x800__carbon__de__empty' },
      { name: 'TEST-P1__1280x800__carbon__de__zoom2', width: 640 },
    ]);
    const plan = await planPromotion({ approvals: [{ from, routes: ['TEST-LIVE'], cells: ['TEST-P1__1280x800__carbon__de__zoom2'] }] }, { routes: registry, origin: HOST });
    expect(plan.problems).toEqual([]);
    expect(plan.skipped).toEqual(['TEST-LIVE__1280x800__carbon__de', 'TEST-LIVE__1280x800__carbon__de__zoom2']);
    expect(plan.cells.map((c) => c.name).sort()).toEqual([
      'TEST-LIVE__1280x800__carbon__de__empty',
      'TEST-LIVE__1280x800__carbon__de__loading',
      'TEST-P1__1280x800__carbon__de__zoom2',
    ]);
    // A zoom cell is 1x at its CSS width: a 1280 px picture of it is a 2x one.
    const wide = await run(testInfo.outputPath('wide'), HOST, [{ name: 'TEST-P1__1280x800__carbon__de__zoom2', width: 1280 }]);
    const refused = await planPromotion({ approvals: [{ from: wide, cells: ['TEST-P1__1280x800__carbon__de__zoom2'] }] }, { routes: registry, origin: HOST });
    expect(refused.problems).toEqual(['TEST-P1__1280x800__carbon__de__zoom2: the PNG is 1280 px wide, not the 1x viewport width 640 px']);
  });

  test('a host-dependent route is promoted only from a run on the baseline host', async ({}, testInfo) => {
    const qr = 'TEST-QR__390x844__carbon__de';
    const isolated = await run(testInfo.outputPath('8081'), 'http://localhost:8081', [{ name: qr }]);
    const host = await run(testInfo.outputPath('8080'), 'http://localhost:8080/', [{ name: qr }]);
    const refused = await planPromotion({ approvals: [{ from: isolated, cells: [qr] }] }, { routes: registry, origin: HOST });
    expect(refused.problems).toEqual([`${qr}: TEST-QR shows the server's host; its run was on http://localhost:8081, baselines come only from ${HOST}`]);
    const allowed = await planPromotion({ approvals: [{ from: host, routes: ['TEST-QR'] }] }, { routes: registry, origin: HOST });
    expect(allowed.problems).toEqual([]);
    expect(allowed.cells.map((c) => c.name)).toEqual([qr]);
  });

  test('refuses failed, violating, 2x, missing, unknown and twice-approved cells, and a run whose export changed', async ({}, testInfo) => {
    const from = await run(testInfo.outputPath('bad'), 'http://localhost:8081', [
      { name: 'TEST-P1__390x844__carbon__de', failed: true },
      { name: 'TEST-P1__430x932__carbon__de', high: 1 },
      { name: 'TEST-P1__768x1024__carbon__de', medium: 2 },
      { name: 'TEST-P1__1280x800__carbon__de', width: 2560 },
      { name: 'TEST-P1__1440x900__carbon__de' },
    ]);
    const changed = await run(testInfo.outputPath('changed'), 'http://localhost:8081', [{ name: 'TEST-P1__360x780__light__en' }], { exportChangedDuringRun: true });
    const { problems } = await planPromotion(
      {
        approvals: [
          { from, cells: ['TEST-P1__390x844__carbon__de', 'TEST-P1__430x932__carbon__de', 'TEST-P1__768x1024__carbon__de', 'TEST-P1__1280x800__carbon__de', 'TEST-P1__1440x900__carbon__de', 'TEST-P1__360x780__black__de', 'NOPE-1__390x844__carbon__de'] },
          { from, cells: ['TEST-P1__1440x900__carbon__de'], routes: ['TEST-QR'] },
          { from: changed, cells: ['TEST-P1__360x780__light__en'] },
        ],
      },
      { routes: registry, origin: HOST },
    );
    expect(problems).toEqual([
      `TEST-P1__390x844__carbon__de: the capture failed in ${from}`,
      `TEST-P1__430x932__carbon__de: 1 High / 0 Medium DOM-audit violations in ${from}`,
      `TEST-P1__768x1024__carbon__de: 0 High / 2 Medium DOM-audit violations in ${from}`,
      'TEST-P1__1280x800__carbon__de: the PNG is 2560 px wide, not the 1x viewport width 1280 px',
      `TEST-P1__360x780__black__de: not captured in ${from}`,
      'NOPE-1__390x844__carbon__de: route NOPE-1 is not in the registry',
      `approvals[1]: route TEST-QR has no cell in ${from}`,
      `TEST-P1__1440x900__carbon__de: approved twice (${from} and ${from})`,
      `approvals[2]: the export changed during the run in ${changed}; capture again`,
    ]);
  });

  test('the CLI is a dry run without --write and writes nothing at all when one cell is refused', async ({}, testInfo) => {
    const from = await run(testInfo.outputPath('cli'), 'http://localhost:8081', [{ name: 'TEST-P1__390x844__carbon__de' }, { name: 'TEST-QR__390x844__carbon__de' }]);
    const routesFile = testInfo.outputPath('routes.json');
    writeFileSync(routesFile, JSON.stringify(registry));
    const baselines = testInfo.outputPath('baselines');
    const approve = (cells: string[]) => {
      const file = testInfo.outputPath(`approval-${cells.length}.json`);
      writeFileSync(file, JSON.stringify({ approvals: [{ from, cells }] }));
      return file;
    };
    const env = { ...process.env, SPEEDCLUB_BASELINE_URL: HOST };
    const good = approve(['TEST-P1__390x844__carbon__de']);
    const dry = await exec(process.execPath, [PROMOTER, `--approval=${good}`, `--routes-file=${routesFile}`, `--baselines=${baselines}`], { env });
    expect(dry.stdout).toContain('Dry run: nothing written.');
    expect(existsSync(baselines)).toBe(false);

    const mixed = approve(['TEST-P1__390x844__carbon__de', 'TEST-QR__390x844__carbon__de']);
    await expect(exec(process.execPath, [PROMOTER, `--approval=${mixed}`, `--routes-file=${routesFile}`, `--baselines=${baselines}`, '--write'], { env })).rejects.toMatchObject({ code: 1 });
    expect(existsSync(baselines), 'one refused cell stops the whole promotion').toBe(false);

    const written = await exec(process.execPath, [PROMOTER, `--approval=${good}`, `--routes-file=${routesFile}`, `--baselines=${baselines}`, '--write'], { env });
    expect(written.stdout).toContain('Wrote 1 baseline(s)');
    expect(readFileSync(join(baselines, 'TEST-P1__390x844__carbon__de.png')).equals(readFileSync(join(from, 'TEST-P1__390x844__carbon__de.png')))).toBe(true);
  });
});
