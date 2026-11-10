// A lock across the Playwright workers for what decides Start's Neue Builds: publishing a build. Start shows everyone's newest
// public builds, so a spec that must see its own build there (BH-37, flows/f2-add-vehicle.spec.ts) holds the lock from its publish
// until Start shows the card, and every other publish waits for it: buildVehicle (support/garage.mjs), direct publish calls and,
// through the fixtures' route, every publish a page sends. Owned per process (a worker runs one test at a time), so the holder's
// own publishes pass. Playwright's project dependencies and teardowns could not do this: both skip their tests once any test of
// the run failed (m28-te-r4-deps.log, m28-te-e2e-full-f5e90e5.log: "4 did not run").
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_URL } from './qa.mjs';

const DIR = join(tmpdir(), `speedclub-e2e-start-lock-${new URL(BASE_URL).port || 'default'}`);
const OWNER = join(DIR, 'owner');
const WAIT_MS = 100;
const TIMEOUT_MS = 120_000;
let depth = 0;

const alive = (/** @type {number} */ pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Takes the lock (or enters it again in this process). */
export async function acquireStartLock() {
  if (depth > 0) {
    depth++;
    return;
  }
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(DIR);
      writeFileSync(OWNER, String(process.pid));
      depth = 1;
      return;
    } catch {
      // Held: by a process that is gone (a crashed worker), or by a live one, which is waited for.
      let owner = NaN;
      try {
        owner = Number(readFileSync(OWNER, 'utf8'));
      } catch {
        // Between mkdir and the owner file: wait.
      }
      if (Number.isInteger(owner) && !alive(owner)) rmSync(DIR, { recursive: true, force: true });
      if (Date.now() > deadline) throw new Error(`The Start lock (${DIR}) was not free within ${TIMEOUT_MS} ms`);
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
  }
}

/** Gives the lock back (or leaves one level of it). */
export function releaseStartLock() {
  if (depth === 0) return;
  depth--;
  if (depth === 0) rmSync(DIR, { recursive: true, force: true });
}

/**
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withStartLock(work) {
  await acquireStartLock();
  try {
    return await work();
  } finally {
    releaseStartLock();
  }
}

/** Gives the lock back whatever the depth, for an afterEach: a test that failed while holding it must not stop the run. */
export function releaseStartLockFully() {
  if (depth === 0) return;
  depth = 0;
  rmSync(DIR, { recursive: true, force: true });
}
