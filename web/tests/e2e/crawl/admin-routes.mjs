#!/usr/bin/env node
// Writes admin-routes.json next to this file: every GET route under /admin, from `php artisan route:list` of the local checkout, so the
// showcase crawl knows the admin pages on a host without artisan (staging). Run it again whenever routes/admin/*.php changes:
//
//   node web/tests/e2e/crawl/admin-routes.mjs          (writes)
//   node web/tests/e2e/crawl/admin-routes.mjs --check  (exit 1 when the fixture is out of date)
//
// Which of these routes are pages and which are JSON, file or flow endpoints is decided in crawl/lib.ts (ADMIN_NOT_PAGES), not here.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./admin-routes.json', import.meta.url));
const PERMISSION = /Authorize:([a-z0-9_.]+)/;

const raw = execFileSync(process.env.SPEEDCLUB_PHP ?? 'php', ['artisan', 'route:list', '--path=admin', '--method=GET', '--json'], {
  cwd: WEB,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
/** @type {{uri:string,name:string|null,method:string,middleware:string[]}[]} */
const list = JSON.parse(raw);
const routes = list
  .filter((r) => r.method.split('|').includes('GET'))
  .map((r) => ({
    uri: `/${r.uri.replace(/^\/+/, '')}`,
    name: r.name ?? null,
    permissions: (r.middleware ?? []).map((m) => PERMISSION.exec(m)?.[1]).filter((p) => p !== undefined),
  }))
  .sort((a, b) => a.uri.localeCompare(b.uri));
const text = `${JSON.stringify({ source: 'php artisan route:list --path=admin --method=GET --json', routes }, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    // Missing counts as out of date.
  }
  if (current !== text) {
    console.error('admin-routes.json is out of date: run node web/tests/e2e/crawl/admin-routes.mjs');
    process.exit(1);
  }
  console.log(`admin-routes.json is up to date (${routes.length} GET routes).`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT} (${routes.length} GET routes)`);
}
