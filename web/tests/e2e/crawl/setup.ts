// Global setup and teardown of the showcase crawl (crawl.config.ts).
//
// Setup: proves the target answers, empties this target's result parts, and, on a local target without staff credentials in the
// environment, creates the one local staff fixture `owner` (support/staff.mjs, support/backend.php ensure-staff: a new password and a
// new TOTP secret in memory, handed to the workers through the environment like the e2e global setup does). Staging never gets there:
// it needs CRAWL_STAFF_PASSWORD and CRAWL_STAFF_TOTP_SECRET and has no database access.
// Teardown: removes that fixture again and merges the parts of all tests into docs/reports/phase-4/showcase-crawl-<target>.{json,md}.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from '@playwright/test';
import { ADMIN_NOT_PAGES, adminRoutes, cell, EXCLUDED, FINDING_TYPES, TARGET, type Part } from './lib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
export const PARTS_DIR = join(HERE, '..', 'test-results', 'crawl-parts', TARGET.name);
const REPORT_DIR = join(REPO, 'docs', 'reports', 'phase-4');

export default async function globalSetup(): Promise<() => Promise<void>> {
  const api = await request.newContext({ baseURL: TARGET.baseUrl });
  try {
    const app = await api.get('/app/', { timeout: 30_000 });
    if (app.status() !== 200) throw new Error(`GET ${TARGET.baseUrl}/app/ answered HTTP ${app.status()}`);
  } catch (error) {
    throw new Error(`The crawl target ${TARGET.baseUrl} is not usable: ${String(error).split('\n')[0]}`);
  } finally {
    await api.dispose();
  }
  rmSync(PARTS_DIR, { recursive: true, force: true });
  mkdirSync(PARTS_DIR, { recursive: true });

  let localFixture = false;
  if (!process.env.CRAWL_STAFF_PASSWORD && TARGET.local && process.env.CRAWL_STAFF_FIXTURE !== 'off') {
    // Local only: the seeded staff accounts have no TOTP enrolled, so the crawl signs in as the e2e Owner fixture instead.
    const { createStaffRun } = await import('../support/staff.mjs');
    const run = await createStaffRun(['owner']);
    const owner = run.accounts.owner;
    const secret = run.secrets.owner;
    if (!owner || !secret) throw new Error('backend.php ensure-staff did not create the owner fixture');
    process.env.CRAWL_STAFF_EMAIL = owner.email;
    process.env.CRAWL_STAFF_PASSWORD = run.password;
    process.env.CRAWL_STAFF_TOTP_SECRET = secret;
    localFixture = true;
    console.log(`[crawl] local staff fixture ${owner.email} (password and TOTP secret in memory only)`);
  }

  return async () => {
    if (localFixture) {
      const { deleteStaffFixtures } = await import('../support/backend.mjs');
      const removed = await deleteStaffFixtures();
      console.log(`[crawl] removed ${removed.deleted} staff fixture(s)`);
    }
    writeReport();
  };
}

function readParts(): Part[] {
  let files: string[] = [];
  try {
    files = readdirSync(PARTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(join(PARTS_DIR, f), 'utf8')) as Part).sort((a, b) => `${a.role}${a.device}`.localeCompare(`${b.role}${b.device}`));
}

const ROLE_ORDER = { guest: 0, member: 1, admin: 2 } as const;

export function writeReport(): void {
  const parts = readParts().sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.device.localeCompare(b.device));
  if (parts.length === 0) {
    console.log('[crawl] no results to report');
    return;
  }
  mkdirSync(REPORT_DIR, { recursive: true });
  const total = parts.reduce((n, p) => n + p.findings.length, 0);
  const json = {
    target: TARGET.name,
    baseUrl: TARGET.baseUrl,
    finishedAt: new Date().toISOString(),
    result: total === 0 ? 'pass' : 'fail',
    findings: total,
    runs: parts,
  };
  writeFileSync(join(REPORT_DIR, `showcase-crawl-${TARGET.name}.json`), `${JSON.stringify(json, null, 2)}\n`);

  const md: string[] = [];
  const first = parts[0]!;
  md.push(`# Showcase crawl: ${TARGET.name}`, '');
  md.push(`Base URL ${TARGET.baseUrl} · finished ${json.finishedAt} · member ${first.memberEmail ?? '-'} · staff ${parts.find((p) => p.staffEmail)?.staffEmail ?? '-'}`, '');
  md.push(`Spec: \`web/tests/e2e/crawl/showcase.spec.ts\` (run commands in its header). JSON: \`docs/reports/phase-4/showcase-crawl-${TARGET.name}.json\`.`, '');
  md.push(`**Result: ${total === 0 ? 'PASS' : 'FAIL'}** · ${total} finding(s) in ${parts.length} run(s).`, '');

  md.push('## Pages per role and device', '');
  md.push('| role | device | pages visited | pages with findings | findings | allowed empty | not visited | QR checks | image URLs checked | aborted by the page | duration |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of parts) {
    const withFindings = new Set(p.findings.map((f) => `${f.page}${f.path}`)).size;
    md.push(`| ${p.role} | ${p.device} | ${p.pages.length} | ${withFindings} | ${p.findings.length} | ${p.allowed.length} | ${p.notVisited.length} | ${p.qr.length} | ${p.imageUrlsChecked} | ${p.abortedRequests} | ${Math.round(p.durationMs / 1000)} s |`);
  }
  md.push('');

  md.push('## Failures by type', '');
  md.push(`| type | ${parts.map((p) => `${p.role} · ${p.device}`).join(' | ')} | total |`);
  md.push(`|---|${parts.map(() => '---').join('|')}|---|`);
  for (const type of FINDING_TYPES) {
    const counts = parts.map((p) => p.findings.filter((f) => f.type === type).length);
    const sum = counts.reduce((a, b) => a + b, 0);
    if (sum) md.push(`| ${type} | ${counts.join(' | ')} | ${sum} |`);
  }
  if (total === 0) md.push('| (none) | | |');
  md.push('');

  // The same finding on several devices or roles is one row.
  type Row = { type: string; page: string; path: string; detail: string; url: string; where: Set<string> };
  const rows = new Map<string, Row>();
  for (const p of parts) {
    for (const f of p.findings) {
      const key = [f.type, f.page, f.detail, f.url ?? ''].join('\u0000');
      const row = rows.get(key) ?? { type: f.type, page: f.page, path: f.path, detail: f.detail, url: f.url ?? '', where: new Set<string>() };
      row.where.add(`${p.role}/${p.device}`);
      rows.set(key, row);
    }
  }
  md.push(`## Findings (${rows.size} distinct)`, '');
  for (const type of FINDING_TYPES) {
    const ofType = [...rows.values()].filter((r) => r.type === type);
    if (!ofType.length) continue;
    md.push(`### ${type} (${ofType.length})`, '', '| page | path | role/device | detail | url |', '|---|---|---|---|---|');
    for (const r of ofType.sort((a, b) => a.page.localeCompare(b.page))) md.push(`| ${r.page} | ${cell(r.path)} | ${[...r.where].join(', ')} | ${cell(r.detail)} | ${cell(r.url)} |`);
    md.push('');
  }

  const allowed = new Map<string, { page: string; detail: string; reason: string; where: Set<string> }>();
  for (const p of parts) {
    for (const a of p.allowed) {
      const key = `${a.page}\u0000${a.detail}`;
      const row = allowed.get(key) ?? { page: a.page, detail: a.detail, reason: a.reason, where: new Set<string>() };
      row.where.add(`${p.role}/${p.device}`);
      allowed.set(key, row);
    }
  }
  md.push('## Allowed empty states (legitimately empty, with the reason)', '');
  if (allowed.size === 0) md.push('None.');
  else {
    md.push('| page | role/device | marker | reason |', '|---|---|---|---|');
    for (const a of allowed.values()) md.push(`| ${a.page} | ${[...a.where].join(', ')} | ${cell(a.detail)} | ${cell(a.reason)} |`);
  }
  md.push('');

  md.push('## Not visited', '');
  const nv = new Map<string, { id: string; path: string; reason: string; where: Set<string> }>();
  for (const p of parts) {
    for (const n of p.notVisited) {
      const key = `${n.id}\u0000${n.reason}`;
      const row = nv.get(key) ?? { ...n, where: new Set<string>() };
      row.where.add(`${p.role}/${p.device}`);
      nv.set(key, row);
    }
  }
  if (nv.size === 0) md.push('None.');
  else {
    md.push('| page | path | role/device | reason |', '|---|---|---|---|');
    for (const n of nv.values()) md.push(`| ${n.id} | ${cell(n.path)} | ${[...n.where].join(', ')} | ${cell(n.reason)} |`);
  }
  md.push('');

  md.push('## QR codes', '');
  const qr = parts.flatMap((p) => p.qr.map((q) => ({ ...q, where: `${p.role}/${p.device}` })));
  if (qr.length === 0) md.push('No QR code checked.');
  else {
    md.push('| code | request | result | run |', '|---|---|---|---|');
    for (const q of qr) md.push(`| ${q.code} | ${q.via} | ${cell(q.result)} | ${q.where} |`);
  }
  md.push('');

  md.push('## Notes', '');
  for (const note of [...new Set(parts.flatMap((p) => p.notes))]) md.push(`- ${note}`);
  md.push('');

  md.push('## Scope: registry routes not crawled, and admin routes that are no page', '');
  md.push('| route | reason |', '|---|---|');
  for (const [id, reason] of Object.entries(EXCLUDED)) md.push(`| ${id} | ${cell(reason)} |`);
  for (const route of adminRoutes()) {
    const rule = ADMIN_NOT_PAGES.find((r) => r.uri.test(route.uri));
    if (rule) md.push(`| ${route.uri} | ${cell(rule.reason)} |`);
  }
  md.push('');
  writeFileSync(join(REPORT_DIR, `showcase-crawl-${TARGET.name}.md`), `${md.join('\n')}\n`);
  console.log(`[crawl] report: docs/reports/phase-4/showcase-crawl-${TARGET.name}.md (${total} finding(s))`);
}
