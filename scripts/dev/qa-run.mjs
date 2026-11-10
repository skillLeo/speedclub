#!/usr/bin/env node
/**
 * Runs one QA command at a time across all agents and terminals.
 *
 *   node scripts/dev/qa-run.mjs npm --prefix mobile run export:web
 *   node scripts/dev/qa-run.mjs npm --prefix web run visual -- --tier=module --routes=VEH-01 --phase=1
 *   node scripts/dev/qa-run.mjs npm --prefix web run e2e
 *
 * export:web replaces web/public/app, so an export during a Playwright run invalidates that run. This
 * wrapper waits for a lock, also waits for such processes started without it, then runs the command with
 * inherited output and returns its exit code. A lock counts as abandoned when its holder is gone, or after 6 hours.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lockDir = join(root, 'docs', 'reports', 'logs', '.qa-lock');
const breakGuard = `${lockDir}.breaking`;
// For a holder that is still alive. A phase-tier run on a loaded machine can take hours, and a waiter that barges in invalidates it.
const STALE_MS = 6 * 60 * 60 * 1000;
const BREAK_GUARD_STALE_MS = 60 * 1000;
const POLL_MS = 15 * 1000;

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('usage: node scripts/dev/qa-run.mjs <command...>');
  process.exit(2);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A QA command line. Only node processes count, and never another qa-run: a waiting qa-run runs nothing yet, and a shell whose
// command string names qa-run (its own parent included) is not a QA run. Counting either deadlocked the lock holder.
const QA_COMMAND = /playwright(\.cmd)?.* test|visual\/run\.mjs|export-web\.mjs|lhci/;
const QA_RUN = /qa-run\.mjs/;
// A per-repository scratch folder carries the repo's path with dashes.
const OUR_SCRATCHPAD = root.replace(/[\\/:]/g, '-');

/**
 * A QA process counts only when it positively belongs here: its command line names this repo or its scratchpad, or it runs
 * inside this repo. Another project's Playwright, wherever it lives (~/rimify for one), used to hold every QA run here for as
 * long as it lasted.
 * @param {string} pid
 * @param {string} commandLine
 */
function belongsHere(pid, commandLine) {
  if (commandLine.includes(root) || commandLine.includes(OUR_SCRATCHPAD)) return true;
  // `node tests/e2e/visual/run.mjs` names no folder, so ask where it runs.
  const answer = spawnSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const folder = (answer.stdout ?? '')
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  return folder !== undefined && (folder === root || folder.startsWith(`${root}/`) || folder.includes(OUR_SCRATCHPAD));
}

function foreignQaProcesses() {
  if (process.platform !== 'win32') {
    const result = spawnSync('ps', ['-Ao', 'pid=,comm='], { encoding: 'utf8' });
    const nodePids = new Set(
      (result.stdout ?? '')
        .split('\n')
        .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
        .filter((m) => m && /(^|\/)node$/.test(m[2]))
        .map((m) => m[1]),
    );
    const commands = spawnSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' });
    return (commands.stdout ?? '')
      .split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m) => m && nodePids.has(m[1]) && Number(m[1]) !== process.pid)
      .filter((m) => QA_COMMAND.test(m[2]) && !QA_RUN.test(m[2]) && belongsHere(m[1], m[2])).length;
  }
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'playwright(.cmd)?.* test|visual/run\\.mjs|export-web\\.mjs|lhci' " +
    "-and $_.CommandLine -notmatch 'qa-run\\.mjs' " +
    "-and $_.CommandLine -notmatch 'htdocs[\\\\/](?!speedclub)|c--xampp-htdocs-(?!speedclub)' -and $_.ProcessId -ne " +
    process.pid +
    " } | Measure-Object | ForEach-Object { $_.Count }";
  const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return Number.parseInt((result.stdout ?? '').trim(), 10) || 0;
}

/** The holder has gone, or the lock has stood longer than any real run. */
function isAbandoned() {
  if (Date.now() - statSync(lockDir).mtimeMs > STALE_MS) return true;
  try {
    const holder = Number.parseInt(readFileSync(join(lockDir, 'owner.txt'), 'utf8'), 10);
    if (Number.isNaN(holder)) return false;
    process.kill(holder, 0);
    return false;
  } catch (error) {
    // No owner.txt means a holder is between mkdir and write. EPERM means the process is there.
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'ESRCH';
  }
}

/**
 * One waiter at a time may look and remove, or a second one would remove the lock the first has just taken.
 * @returns {boolean} whether the lock is gone now
 */
function breakIfAbandoned() {
  try {
    if (Date.now() - statSync(breakGuard).mtimeMs > BREAK_GUARD_STALE_MS) rmSync(breakGuard, { recursive: true, force: true });
  } catch {
    // No guard, the normal case.
  }
  try {
    mkdirSync(breakGuard);
  } catch {
    return false;
  }
  try {
    if (!isAbandoned()) return false;
    rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    // The lock went away by itself.
    return true;
  } finally {
    rmSync(breakGuard, { recursive: true, force: true });
  }
}

function acquire() {
  let announced = false;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.txt'), `${process.pid} ${command.join(' ')}\n`);
      return;
    } catch {
      if (breakIfAbandoned()) continue;
      if (!announced) {
        console.log('[qa-run] another QA command is running, waiting for the lock');
        announced = true;
      }
      sleep(POLL_MS);
    }
  }
}

mkdirSync(dirname(lockDir), { recursive: true });
acquire();
const release = () => rmSync(lockDir, { recursive: true, force: true });
process.on('SIGINT', () => {
  release();
  process.exit(130);
});
process.on('SIGTERM', () => {
  release();
  process.exit(143);
});

let waited = false;
while (foreignQaProcesses() > 0) {
  if (!waited) {
    console.log('[qa-run] waiting for a QA process that was started without the lock');
    waited = true;
  }
  sleep(POLL_MS);
}

// shell: true is needed for npm.cmd on Windows, and it joins arguments unquoted.
const line = command.map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(' ');
const result = spawnSync(line, { cwd: root, stdio: 'inherit', shell: true });
release();
process.exit(result.status ?? 1);
