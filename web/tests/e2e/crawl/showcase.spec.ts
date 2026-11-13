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
//   One device: add --project=iphone15pro | desktop1440 | desktop1440-webkit. One role: add --grep=@member (or @guest, @admin).
//   Environment: CRAWL_MEMBER_EMAIL (default sebastian.demo@speedclub.test), CRAWL_STAFF_EMAIL (default admin.demo@speedclub.test),
//   CRAWL_TARGET (report name; default local / staging / the host), CRAWL_WORKERS (default 2), CRAWL_QA_NOW (browser clock; default
//   QA_NOW locally, the real clock elsewhere), CRAWL_STAFF_FIXTURE=off (local: no e2e Owner fixture). After a change of
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
  GUEST_PAGES,
  guardContext,
  linkMatches,
  MEMBER_PAGES,
  memberEmail,
  memberSignIn,
  newState,
  REQUIRED_TOKENS,
  resolveTokens,
  staffEmail,
  staffSignIn,
  TARGET,
  uncoveredRegistryIds,
  useMemberSession,
  visit,
  type CrawlState,
  type Part,
  type PageSpec,
  type Role,
  type Tokens,
} from './lib';
import { PARTS_DIR } from './setup';
import { uriToRegex } from '../visual/rate-budget.mjs';

const deviceOf = (info: TestInfo) => String((info.project.metadata as { device?: string }).device ?? info.project.name);
const isMobile = (info: TestInfo) => (info.project.metadata as { mobile?: boolean }).mobile === true;

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

  test('guest @guest', async ({ context }, testInfo) => {
    await crawl('guest', context, testInfo);
  });

  test('member @member', async ({ context }, testInfo) => {
    await crawl('member', context, testInfo);
  });

  test('admin @admin @desktop-only', async ({ context }, testInfo) => {
    await crawl('admin', context, testInfo);
  });
});

async function crawl(role: Role, context: BrowserContext, testInfo: TestInfo): Promise<void> {
  const started = Date.now();
  const device = deviceOf(testInfo);
  const state = newState(role, device);
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
      memberEmail: memberEmail(),
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

/** Guest and member: the pages of the role, filled with the ids of the showcase member's data. */
async function crawlMember(role: 'guest' | 'member', context: BrowserContext, state: CrawlState, testInfo: TestInfo, notes: string[]): Promise<void> {
  // The guest crawls the showcase member's public pages, so the member signs in once over HTTP to say which they are, and out again.
  const session = await memberSignIn();
  let tokens: Tokens;
  try {
    tokens = await resolveTokens(session.api);
    if (role === 'member') await useMemberSession(context, session);
  } catch (error) {
    await endMemberSession(session);
    throw error;
  }
  if (role === 'guest') {
    const problem = await endMemberSession(session);
    if (problem) notes.push(`guest: ending the token session: ${problem}`);
  }
  notes.push(`ids read through the API as ${memberEmail()}: ${Object.keys(tokens.values).sort().join(', ')}`);

  if (role === 'member') {
    for (const key of REQUIRED_TOKENS) {
      const why = tokens.missing[key];
      if (why) state.findings.push({ type: 'missing-data', page: '-', path: '-', detail: `${key}: ${why}` });
    }
    for (const [key, why] of Object.entries(tokens.missing)) if (key.startsWith('GET ')) state.findings.push({ type: 'missing-data', page: '-', path: key, detail: why });
  }

  const pages = role === 'guest' ? GUEST_PAGES : MEMBER_PAGES;
  try {
    for (const spec of pages) await visitSpec(context, state, spec, tokens, testInfo);
  } finally {
    if (role === 'member') {
      const problem = await endMemberSession(session);
      if (problem) state.findings.push({ type: 'crawl-error', page: '-', path: '/api/v1/auth/logout', detail: problem });
    }
  }

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
    preferred = ['myUsername', 'myVehicleId', 'myCode'].map((k) => tokens.values[k]).filter((v): v is string => v !== undefined);
  } finally {
    const problem = await endMemberSession(member);
    if (problem) notes.push(`admin: ending the token session: ${problem}`);
  }
  const session = await staffSignIn();
  await context.addCookies(session.cookies);
  const memberQuery = memberEmail().split('@')[0]!;
  const plan = adminPlan(memberQuery.split('.')[0]!);
  const noTokens: Tokens = { values: {}, missing: {}, qr: [] };
  try {
    for (const spec of plan.statics) await visitSpec(context, state, spec, noTokens, testInfo);
    const staticRegexes = plan.statics.map((s) => uriToRegex(s.path.split('?')[0]!));
    const pending = [...plan.params];
    // A detail page can link to the next one (a make to its models), so look again after each round.
    for (let round = 0; round < 3 && pending.length; round++) {
      for (const item of [...pending]) {
        // The showcase member's own record first, else the first record linked.
        const candidates = [...state.links].map((l) => l.split('?')[0]!).filter((path) => linkMatches(path, item.regex, staticRegexes));
        const link = candidates.find((path) => preferred.some((p) => path.split('/').includes(p))) ?? candidates[0];
        if (!link) continue;
        pending.splice(pending.indexOf(item), 1);
        for (const { query, id } of item.variants) {
          const path = query ? `${link}?${query}` : link;
          await visit({ context, state, spec: { id, path, kind: 'admin', desktopOnly: true }, path });
        }
      }
    }
    for (const item of pending) {
      state.notVisited.push({ id: item.variants[0]?.id ?? item.route.uri, path: item.route.uri, reason: 'no crawled admin page links to such a record' });
    }
  } finally {
    const problem = await endStaffSession(session, context);
    if (problem) state.findings.push({ type: 'crawl-error', page: '-', path: '/admin/logout', detail: problem });
  }
  notes.push(`admin: ${plan.statics.length} static page(s) and ${plan.params.length} record route(s) of crawl/admin-routes.json (${plan.notPages.length} GET routes are no page)`);
}
