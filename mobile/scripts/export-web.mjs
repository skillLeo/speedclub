#!/usr/bin/env node
/**
 * Builds the member web app and copies it to web/public/app, where Laravel serves it (ADR-004).
 * EXPO_PUBLIC_APP_ENV defaults to "local" so the QA overrides stay available for the visual matrix.
 *
 *   node scripts/export-web.mjs [--out=<dir>]
 *   --out: copy the export to <dir> instead of web/public/app (relative paths resolve against the current directory).
 *
 * scripts/dev/package-web.mjs runs it with EXPO_PUBLIC_APP_ENV=production and --out=<its stage folder>, which compiles
 * those overrides out and never touches web/public/app. mobile/dist is shared by every export: run it through
 * scripts/dev/qa-run.mjs.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import preloadFonts from './preload-fonts.js';
import stripQa from './strip-qa.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='));
const outValue = outArg ? outArg.slice('--out='.length) : '';
if (outArg && outValue === '') {
  console.error('✖ --out needs a directory: --out=<dir>');
  process.exit(2);
}
const target = outValue ? resolve(process.cwd(), outValue) : resolve(root, '..', 'web', 'public', 'app');

const env = {
  ...process.env,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV ?? 'local',
  EXPO_NO_TELEMETRY: '1',
};

rmSync(dist, { recursive: true, force: true });
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: true,
});
if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(join(dist, 'index.html'))) {
  console.error('✖ expo export finished without dist/index.html');
  process.exit(1);
}

const indexHtml = join(dist, 'index.html');
// 09 §4.2: preload the two faces above the fold of the first screen (preload-fonts.js says which and why). It fails the
// export when a face is missing from it, rather than ship an index.html that points at nothing.
try {
  writeFileSync(indexHtml, preloadFonts.preloadAboveTheFold(readFileSync(indexHtml, 'utf8'), dist));
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// The bundle compiles the QA overrides out by itself; the inline head script needs this step.
if (env.EXPO_PUBLIC_APP_ENV === 'production') {
  writeFileSync(indexHtml, stripQa.stripQaBlock(readFileSync(indexHtml, 'utf8')));
}

rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
console.log(`✔ member web copied to ${target}`);
