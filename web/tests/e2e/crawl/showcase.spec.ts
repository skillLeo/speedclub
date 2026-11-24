// Showcase crawl: proves the demo is clean for a client, as a guest, as the showcase member and as the showcase admin, on an iPhone 15
// Pro (WebKit) and at desktop 1440 (Chromium, and WebKit). Every page of the member app the role may see (the route registry,
// visual/routes.mjs, with the ids the seeded data exposes through the API), the public Blade pages, every admin page
// (crawl/admin-routes.json), and every QR code found. Findings are collected for a whole role × device run and fail it at the end with
// one table; the merged report goes to docs/reports/phase-4/showcase-crawl-<target>.{md,json}. Checks: lib.ts `visit`.
//
// Run from the repo root, always through the QA lock (it queues behind other e2e, visual and export runs). Secrets come from the
// environment only and are never printed:
//
//   Local (until DemoShowcaseSeeder is in: the DemoSeeder member lukas.sc; the local admin is the e2e Owner fixture, made and removed
//   by crawl/setup.ts because the seeded staff have no TOTP):
//     CRAWL_BASE_URL=http://localhost:8080 CRAWL_MEMBER_EMAIL=lukas.sc@speedclub.test \
//     CRAWL_MEMBER_PASSWORD="$(grep '^DEMO_MEMBER_PASSWORD=' web/.env | cut -d= -f2- | tr -d '"')" \
//     node scripts/dev/qa-run.mjs web/node_modules/.bin/playwright test --config=web/tests/e2e/crawl/crawl.config.ts
//
//   Local with the showcase accounts (sebastian.demo, admin.demo with an enrolled TOTP secret):
//     CRAWL_BASE_URL=http://localhost:8080 CRAWL_MEMBER_PASSWORD=… CRAWL_STAFF_PASSWORD=… CRAWL_STAFF_TOTP_SECRET=… \
//     node scripts/dev/qa-run.mjs web/node_modules/.bin/playwright test --config=web/tests/e2e/crawl/crawl.config.ts
//
//   Staging (no database access, no artisan: the admin routes come from crawl/admin-routes.json):
//     CRAWL_BASE_URL=https://coral-okapi-906483.hostingersite.com CRAWL_MEMBER_PASSWORD=… CRAWL_STAFF_PASSWORD=… \
//     CRAWL_STAFF_TOTP_SECRET=… node scripts/dev/qa-run.mjs web/node_modules/.bin/playwright test \
//     --config=web/tests/e2e/crawl/crawl.config.ts
//
//   One device: add --project=iphone15pro | pixel7 | desktop1440 | desktop1440-webkit. One role: add --grep=@member (or @guest,
//   @fresh, @admin). Locally the showcase member's password falls back to DEMO_MEMBER_PASSWORD of web/.env (never printed), and
//   crawl/setup.ts signs up a new, empty member for @fresh (CRAWL_FRESH=off: none; CRAWL_FRESH_EMAIL/CRAWL_FRESH_PASSWORD name one on
//   another host). CRAWL_REPORT_DIR (repo-relative) moves the merged report.
//   Environment: CRAWL_MEMBER_EMAIL (default sebastian.demo@speedclub.test), CRAWL_STAFF_EMAIL (default admin.demo@speedclub.test),
//   CRAWL_TARGET (report name; default local / staging / the host), CRAWL_WORKERS (default 2), CRAWL_QA_NOW (browser clock; default
//   QA_NOW locally, the real clock elsewhere), CRAWL_STAFF_FIXTURE=off (local: no e2e Owner fixture), CRAWL_STAFF_ROLE (default owner; another role expects 403 on Owner-only pages). After a change of
//   routes/admin/*.php: node web/tests/e2e/crawl/admin-routes.mjs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type TestInfo } from '@playwright/test';
import {
  adminPlan,
  checkQr,
  endMemberSession,
  endStaffSession,
  failureTable,
  fillPath,
  FRESH_PAGES,
  freshEmail,
  GUEST_PAGES,
  guardContext,
  inspectDom,
  inspectLayout,
  linkMatches,
  MEMBER_PAGES,
  memberEmail,
  memberSignIn,
  newState,
  personaEmail,
  queryTokenCandidates,
  REQUIRED_TOKENS,
  resolveTokens,
  staffEmail,
  staffSignIn,
  TARGET,
  translationKeys,
  uncoveredRegistryIds,
  useMemberSession,
  visit,
  type CrawlState,
  type Part,
  type PageSpec,
  type Role,
  type SafeArea,
  type Tokens,
} from './lib';
import { PARTS_DIR } from './setup';
import { uriToRegex } from '../visual/rate-budget.mjs';

const deviceOf = (info: TestInfo) => String((info.project.metadata as { device?: string }).device ?? info.project.name);
const isMobile = (info: TestInfo) => (info.project.metadata as { mobile?: boolean }).mobile === true;
const safeAreaOf = (info: TestInfo) => (info.project.metadata as { safeArea?: SafeArea }).safeArea ?? null;

test.describe('showcase crawl', () => {
  test('registry and admin route fixture are fully classified @meta', () => {
    // Every member-app and public route of the registry is crawled or excluded with a reason (lib.ts EXCLUDED).
    expect(uncoveredRegistryIds(), 'registry routes the crawl neither visits nor excludes').toEqual([]);
    // Locally the admin route fixture must match routes/admin/*.php; staging has no artisan.
    if (TARGET.local) {
      const check = spawnSync(process.execPath, [fileURLToPath(new URL('./admin-routes.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
      expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    }
  });

  test('an unhandled promise rejection is a page-error on this engine @meta', async ({ page }) => {
    // The crawl's page-error finding must cover `unhandledrejection` too (lib.ts visitOnce): proved here on every project's engine.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
    await page.setContent('<script>Promise.reject(new Error("crawl-probe-rejection")); (async () => { throw new TypeError("crawl-probe-async"); })();</script>');
    await expect.poll(() => errors.length, { timeout: 5_000 }).toBe(2);
    expect(errors.join(' | ')).toMatch(/crawl-probe-rejection.*crawl-probe-async|crawl-probe-async.*crawl-probe-rejection/);
  });

  test('the layout and raw-key checks find what they must @meta', async ({ page }) => {
    // A fixture page with one of each: a box wider than the viewport, a button under a floating `shell.tabbar` that nothing can scroll
    // out, a control in the top inset, a printed app key, and things that must stay quiet (a rail that scrolls sideways, a full-bleed
    // photo under the inset, "z.B." and a version number).
    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width">
      <body style="margin:0">
        <button data-testid="FIX.top" style="position:absolute;top:4px;left:200px;width:60px;height:44px">Zurück</button>
        <button data-testid="FIX.hero" style="display:block;width:100vw;height:300px">Foto</button>
        <div data-testid="FIX.rail" style="overflow-x:auto;overflow-y:hidden;width:100%"><div style="width:2000px;height:40px"></div></div>
        <p>z.B. Version 2.0.1</p><p data-testid="FIX.key">garage.title</p>
        <div data-testid="FIX.wide" style="width:2000px;height:10px"></div>
        <div style="position:fixed;left:0;right:0;bottom:0;height:64px;background:#000" data-testid="shell.tabbar"><button>Tab</button></div>
        <button data-testid="FIX.under" style="position:fixed;left:10px;bottom:10px;width:80px;height:44px;z-index:-1">Unter der Leiste</button>
      </body>`);
    const layout = await page.evaluate(inspectLayout, { phone: true, safeArea: { top: 59, bottom: 34 } });
    const dom = await page.evaluate(inspectDom);
    const types = layout.map((issue) => `${issue.type}: ${issue.detail}`);
    expect(types.some((t) => t.startsWith('horizontal-overflow: document')), types.join('\n')).toBe(true);
    expect(types.some((t) => t.startsWith('under-tab-bar') && t.includes('FIX.under')), types.join('\n')).toBe(true);
    expect(types.some((t) => t.startsWith('under-safe-area') && t.includes('FIX.top')), types.join('\n')).toBe(true);
    expect(types.filter((t) => t.includes('FIX.hero') || t.includes('FIX.rail'))).toEqual([]);
    const keys = translationKeys();
    expect(dom.keyCandidates.filter((c) => keys.has(c.text)).map((c) => c.text)).toEqual(['garage.title']);
  });

  test('guest @guest', async ({ context }, testInfo) => {
    await crawl('guest', context, testInfo);
  });

  test('member @member', async ({ context }, testInfo) => {
    await crawl('member', context, testInfo);
  });

  test('new member @fresh', async ({ context }, testInfo) => {
    test.skip(!freshEmail(), 'no new member for this run: crawl/setup.ts signs one up on a local target only (CRAWL_FRESH_EMAIL elsewhere)');
    await crawl('fresh', context, testInfo);
  });

  test('admin @admin @desktop-only', async ({ context }, testInfo) => {
    await crawl('admin', context, testInfo);
  });
});

async function crawl(role: Role, context: BrowserContext, testInfo: TestInfo): Promise<void> {
  const started = Date.now();
  const device = deviceOf(testInfo);
  const state = newState(role, device, { phone: isMobile(testInfo), safeArea: safeAreaOf(testInfo) });
  const notes: string[] = [];
  await guardContext(context, state);

  try {
    if (role === 'admin') await crawlAdmin(context, state, testInfo, notes);
    else await crawlMember(role, context, state, testInfo, notes);
  } finally {
    const part: Part = {
      target: TARGET.name,
      baseUrl: TARGET.baseUrl,
      role,
      device,
      project: testInfo.project.name,
      memberEmail: personaEmail(role),
      ...(role === 'admin' ? { staffEmail: staffEmail() } : {}),
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      pages: state.pages,
      findings: state.findings,
      allowed: state.allowed,
      notVisited: state.notVisited,
      qr: state.qr,
      imageUrlsChecked: state.imageStatus.size,
      abortedRequests: state.aborted,
      notes,
    };
    mkdirSync(PARTS_DIR, { recursive: true });
    writeFileSync(join(PARTS_DIR, `${role}--${testInfo.project.name}.json`), JSON.stringify(part, null, 2));
    await testInfo.attach('crawl.json', { body: JSON.stringify(part, null, 2), contentType: 'application/json' });
    console.log(`[crawl] ${role} × ${device}: ${state.pages.length} page(s), ${state.findings.length} finding(s), ${state.notVisited.length} not visited`);
    if (state.findings.length > 0) throw new Error(failureTable(part));
  }
}

/** Guest, member and new member: the pages of the role, filled with the ids of the data the role's account reads. */
async function crawlMember(role: 'guest' | 'member' | 'fresh', context: BrowserContext, state: CrawlState, testInfo: TestInfo, notes: string[]): Promise<void> {
  // The guest crawls the showcase member's public pages, so the member signs in once over HTTP to say which they are, and out again.
  const signedIn = role === 'fresh' ? 'fresh' : 'member';
  const session = await memberSignIn(signedIn);
  let tokens: Tokens;
  try {
    tokens = await resolveTokens(session.api);
    if (role !== 'guest') await useMemberSession(context, session);
  } catch (error) {
    await endMemberSession(session);
    throw error;
  }
  if (role === 'guest') {
    const problem = await endMemberSession(session);
    if (problem) notes.push(`guest: ending the token session: ${problem}`);
  }
  notes.push(`${role}: ids read through the API as ${personaEmail(signedIn)}: ${Object.keys(tokens.values).sort().join(', ')}`);

  if (role === 'member') {
    for (const key of REQUIRED_TOKENS) {
      const why = tokens.missing[key];
      if (why) state.findings.push({ type: 'missing-data', page: '-', path: '-', detail: `${key}: ${why}` });
    }
    for (const [key, why] of Object.entries(tokens.missing)) if (key.startsWith('GET ')) state.findings.push({ type: 'missing-data', page: '-', path: key, detail: why });
  }

  const pages = role === 'guest' ? GUEST_PAGES : role === 'fresh' ? FRESH_PAGES : MEMBER_PAGES;
  try {
    for (const spec of pages) {
      await visitSpec(context, state, spec, tokens, testInfo);
      // The new member closes the introduction as the app's close does (POST me/intro/seen, IntroScreen), so the next pages are what
      // a new member sees after it.
      if (role === 'fresh' && spec.id === 'CRAWL-INTRO-01-fresh') {
        const xsrf = decodeURIComponent((await session.api.storageState()).cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '');
        const seen = await session.api.post('/api/v1/me/intro/seen', { headers: { 'X-XSRF-TOKEN': xsrf } });
        if (![200, 204].includes(seen.status())) state.findings.push({ type: 'crawl-error', page: spec.id, path: '/api/v1/me/intro/seen', detail: `HTTP ${seen.status()}` });
      }
    }
  } finally {
    if (role !== 'guest') {
      const problem = await endMemberSession(session);
      if (problem) state.findings.push({ type: 'crawl-error', page: '-', path: '/api/v1/auth/logout', detail: problem });
    }
  }

  // The new member has no sticker of their own; codes other pages link to are checked in the guest and member runs.
  if (role === 'fresh') return;
  // Stickers: every code of the showcase member (the guest scans them, as a phone camera would) and every code a page links to.
  const known = new Map(tokens.qr.map((q) => [q.code.toUpperCase(), q]));
  const codes = role === 'guest' ? new Set([...known.keys(), ...state.codes]) : new Set([...state.codes].filter((c) => !known.has(c)));
  for (const code of codes) {
    const info = known.get(code);
    if (info && info.status === 'active' && info.visibility !== 'public') {
      state.qr.push({ code, via: '-', result: `not scanned: the vehicle is ${info.visibility ?? 'not public'} (a scan answers 404 by design)` });
      continue;
    }
    await checkQr(state, code, info?.slug ?? null, info?.status ?? null);
  }
}

async function visitSpec(context: BrowserContext, state: CrawlState, spec: PageSpec, tokens: Tokens, testInfo: TestInfo): Promise<void> {
  if (spec.desktopOnly && isMobile(testInfo)) return;
  const filled = fillPath(spec.path, tokens);
  if (!filled.path) {
    state.notVisited.push({ id: spec.id, path: spec.path, reason: filled.missing.map((k) => `${k}: ${tokens.missing[k] ?? 'not available'}`).join('; ') });
    return;
  }
  let expectFinalPath: RegExp | undefined;
  if (spec.expectFinalPath) {
    const template = spec.expectFinalPath.replace(/\{(\w+)\}/g, (_, key: string) => (tokens.values[key] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    expectFinalPath = new RegExp(template);
  }
  await visit({ context, state, spec, path: filled.path, ...(expectFinalPath ? { expectFinalPath } : {}) });
}

/** Admin: every page route of admin-routes.json; routes with parameters take the first link to them found on a crawled admin page. */
async function crawlAdmin(context: BrowserContext, state: CrawlState, testInfo: TestInfo, notes: string[]): Promise<void> {
  // The showcase member's records come first among the admin's detail pages (their member record, vehicle, QR code), so the admin
  // crawl looks at what the demo shows. One member sign-in over HTTP to name them, ended at once.
  const member = await memberSignIn();
  let preferred: string[] = [];
  try {
    const tokens = await resolveTokens(member.api);
    // The admin links a member by id (/admin/members/{id}): without myMemberId the first member linked anywhere (a DemoSeeder member)
    // stood in for the showcase member on every ADM-10 tab.
    preferred = ['myUsername', 'myMemberId', 'myVehicleId', 'myCode'].map((k) => tokens.values[k]).filter((v): v is string => v !== undefined);
  } finally {
    const problem = await endMemberSession(member);
    if (problem) notes.push(`admin: ending the token session: ${problem}`);
  }
  const session = await staffSignIn();
  await context.addCookies(session.cookies);
  const memberQuery = memberEmail().split('@')[0]!;
  const plan = adminPlan(memberQuery.split('.')[0]!);
  const noTokens: Tokens = { values: {}, missing: {}, qr: [] };
  // A record of the showcase member: its id is in the link, or the link was found on a page of one of their records (the QR record
  // linked from their vehicle's QR tab: the member API names no QR id).
  const mentions = (path: string) => preferred.some((p) => path.split(/[/?&=]/).includes(p));
  const isPreferred = (link: string) => mentions(link) || [...(state.linkFrom.get(link) ?? [])].some(mentions);
  try {
    // Static pages whose query holds a token (a queue's side pane, `?business={sampleBusiness}`) take it from a link found later.
    const tokenStatics = plan.statics.filter((s) => s.path.includes('{'));
    for (const spec of plan.statics) if (!tokenStatics.includes(spec)) await visitSpec(context, state, spec, noTokens, testInfo);
    const staticRegexes = plan.statics.map((s) => uriToRegex(s.path.split('?')[0]!));
    const pending = [...plan.params];
    const pendingStatics = [...tokenStatics];
    // A detail page can link to the next one (a make to its models, a vehicle to its QR code), so look again after each round. Round 0
    // takes only the showcase member's records, so that their record is not passed over for one linked earlier; later rounds take the
    // first record linked when the member has none.
    for (let round = 0; round < 4 && (pending.length || pendingStatics.length); round++) {
      for (const item of [...pending]) {
        const candidates = [...state.links].filter((l) => linkMatches(l.split('?')[0]!, item.regex, staticRegexes));
        const chosen = candidates.find((l) => mentions(l)) ?? candidates.find(isPreferred) ?? (round > 0 ? candidates[0] : undefined);
        if (!chosen) continue;
        const link = chosen.split('?')[0]!;
        pending.splice(pending.indexOf(item), 1);
        for (const { query, id } of item.variants) {
          const path = query ? `${link}?${query}` : link;
          await visit({ context, state, spec: { id, path, kind: 'admin', desktopOnly: true }, path });
        }
      }
      for (const spec of [...pendingStatics]) {
        const candidates = queryTokenCandidates(spec.path, state.links);
        const path = candidates.find((l) => mentions(l)) ?? candidates.find(isPreferred) ?? (round > 0 ? candidates[0] : undefined);
        if (!path) continue;
        pendingStatics.splice(pendingStatics.indexOf(spec), 1);
        await visit({ context, state, spec: { ...spec, path }, path });
      }
    }
    for (const item of pending) {
      state.notVisited.push({ id: item.variants[0]?.id ?? item.route.uri, path: item.route.uri, reason: 'no crawled admin page links to such a record' });
    }
    for (const spec of pendingStatics) {
      state.notVisited.push({ id: spec.id, path: spec.path, reason: 'no crawled admin page links to a record that fills its query' });
    }
  } finally {
    const problem = await endStaffSession(session, context);
    if (problem) state.findings.push({ type: 'crawl-error', page: '-', path: '/admin/logout', detail: problem });
  }
  notes.push(`admin: ${plan.statics.length} static page(s) and ${plan.params.length} record route(s) of crawl/admin-routes.json (${plan.notPages.length} GET routes are no page)`);
}
