#!/usr/bin/env node
// Promotes reviewed screenshots of a visual run into the baselines, byte for byte, instead of capturing them again with
// --update-baselines (a new capture is a new picture nobody has reviewed). The runner itself compares and writes baselines from
// the same report PNG (run.mjs: handleBaseline(readFile(pngPath))), so a promoted file is exactly what that run would have written.
//
//   node tests/e2e/visual/promote-baselines.mjs --approval=FILE.json            (dry run: checks everything, writes nothing)
//   node tests/e2e/visual/promote-baselines.mjs --approval=FILE.json --write    (copies the approved cells)
//   options: --baselines=DIR (default tests/e2e/__screenshots__, and tests/e2e/__screenshots__/p4 for the cells of the p4 tier, whose
//            names carry a device; --baselines puts every approved cell there)  --routes-file=FILE.json (other registry, for the self-test)
//
// Approval file (paths relative to the repo root or absolute; `from` is the folder holding the run's summary.json):
//   { "approvals": [
//       { "from": "docs/reports/visual/<run>/phase-2", "cells": ["SET-06__360x780__light__de", ...] },
//       { "from": "docs/reports/visual/<run>/phase-2", "routes": ["SET-16-decisions"] }      <- every cell of the route in that run
//   ] }
//
// A cell is refused (and then nothing at all is written) when:
//   - its route is unknown, or the run did not capture it (missing from summary.json, or no PNG);
//   - the shot failed, has a High or Medium DOM-audit violation, or the export changed during the run;
//   - the PNG is not 1x (its width differs from the cell's viewport width: e.g. a --device-scale=2 preview);
//   - the route is `hostDependent` and the run's origin is not SPEEDCLUB_BASELINE_URL (default http://localhost:8080);
//   - the same cell is approved twice, or a route entry matches no cell.
// A cell of a `volatile` route outside its fixture states (ADR-223: live activity, never compared) is skipped, never written, and
// listed as skipped; it is no problem, so a route entry may name such a route and still promote its fixture states.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { isVolatileCell } from './matrix.mjs';
import { P4_DEVICE_IDS } from './p4-devices.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_BASELINES = fileURLToPath(new URL('../__screenshots__/', import.meta.url));
/** The baselines of the p4 tier (docs/09_PREMIUM_2_0.md §14.1), apart from the module and phase ones (same default as run.mjs). */
export const DEFAULT_P4_BASELINES = join(DEFAULT_BASELINES, 'p4');

/** The origin whose host the hostDependent baselines show (same default as run.mjs). */
export function baselineOrigin(env = process.env) {
  return new URL(env.SPEEDCLUB_BASELINE_URL ?? 'http://localhost:8080').origin;
}

/**
 * @param {string} name cell name `<route>__<w>x<h>__<theme>__<locale>[__<p4 device>][__fsN][__zoomN][__state]`
 * @returns {{routeId: string, width: number, height: number, zoom: number, state: string, device?: string} | null} `device` only for a
 *   p4 cell
 */
export function parseCell(name) {
  const match = /^(.+?)__(\d+)x(\d+)__[a-z]+__[a-z]{2}((?:__.+)?)$/.exec(name);
  if (!match || !match[1]) return null;
  const parts = (match[4] ?? '').split('__').filter(Boolean);
  const device = parts.find((p) => P4_DEVICE_IDS.includes(p));
  const rest = parts.filter((p) => p !== device);
  const zoom = Number(rest.find((p) => /^zoom\d+$/.test(p))?.slice(4) ?? 1);
  const state = rest.find((p) => !/^(fs|zoom)\d+$/.test(p)) ?? 'default';
  return { routeId: match[1], width: Number(match[2]), height: Number(match[3]), zoom, state, ...(device === undefined ? {} : { device }) };
}

/**
 * The baseline folder of an approved cell when no --baselines is given: p4 cells (named with a device) into the p4 baselines,
 * every other cell into the module/phase baselines as before.
 * @param {string} name
 * @param {{baselines?: string|null, p4Baselines?: string}} [o]
 */
export function baselineDirOf(name, { baselines = null, p4Baselines = DEFAULT_P4_BASELINES } = {}) {
  if (baselines) return baselines;
  return parseCell(name)?.device === undefined ? DEFAULT_BASELINES : p4Baselines;
}

/**
 * Checks an approval against the runs' summaries and the registry. Reads, never writes.
 * @param {{approvals: Array<{from: string, cells?: string[], routes?: string[]}>}} approval
 * @param {{routes: Array<{id: string, hostDependent?: boolean, volatile?: boolean}>, origin: string, root?: string}} o
 * @returns {Promise<{cells: Array<{name: string, source: string, from: string, routeId: string}>, problems: string[], skipped: string[]}>}
 */
export async function planPromotion(approval, { routes, origin, root = REPO_ROOT }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} volatile cells (ADR-223), never baselines */
  const skipped = [];
  /** @type {Map<string, {name: string, source: string, from: string, routeId: string}>} */
  const chosen = new Map();
  const byId = new Map(routes.map((r) => [r.id, r]));
  if (!approval || !Array.isArray(approval.approvals) || approval.approvals.length === 0) {
    return { cells: [], problems: ['The approval has no "approvals" entries'], skipped };
  }

  for (const [index, entry] of approval.approvals.entries()) {
    const label = `approvals[${index}]`;
    if (!entry || typeof entry.from !== 'string') {
      problems.push(`${label}: "from" (the folder with the run's summary.json) is missing`);
      continue;
    }
    const from = isAbsolute(entry.from) ? entry.from : resolve(root, entry.from);
    const summaryFile = join(from, 'summary.json');
    if (!existsSync(summaryFile)) {
      problems.push(`${label}: no summary.json in ${from}`);
      continue;
    }
    const summary = JSON.parse(await readFile(summaryFile, 'utf8'));
    const shots = new Map((summary.shots ?? []).map((/** @type {any} */ s) => [s.name, s]));
    let runOrigin = null;
    try {
      runOrigin = new URL(summary.baseUrl).origin;
    } catch {
      problems.push(`${label}: summary.json of ${from} has no valid baseUrl`);
    }
    if (summary.exportChangedDuringRun) problems.push(`${label}: the export changed during the run in ${from}; capture again`);

    const cells = Array.isArray(entry.cells) ? [...entry.cells] : [];
    for (const routeId of Array.isArray(entry.routes) ? entry.routes : []) {
      const ofRoute = [...shots.keys()].filter((name) => parseCell(name)?.routeId === routeId);
      if (ofRoute.length === 0) problems.push(`${label}: route ${routeId} has no cell in ${from}`);
      cells.push(...ofRoute);
    }
    if (cells.length === 0) problems.push(`${label}: approves no cell`);

    for (const name of cells) {
      const cell = parseCell(name);
      if (!cell) {
        problems.push(`${name}: not a cell name`);
        continue;
      }
      const route = byId.get(cell.routeId);
      if (!route) {
        problems.push(`${name}: route ${cell.routeId} is not in the registry`);
        continue;
      }
      if (isVolatileCell(route, cell)) {
        if (!skipped.includes(name)) skipped.push(name);
        continue;
      }
      const shot = shots.get(name);
      const source = join(from, `${name}.png`);
      if (!shot || !existsSync(source)) {
        problems.push(`${name}: not captured in ${from}`);
        continue;
      }
      if (shot.failed) problems.push(`${name}: the capture failed in ${from}`);
      if (shot.high > 0 || shot.medium > 0) problems.push(`${name}: ${shot.high} High / ${shot.medium} Medium DOM-audit violations in ${from}`);
      if (route.hostDependent === true && runOrigin !== origin) {
        problems.push(`${name}: ${cell.routeId} shows the server's host; its run was on ${runOrigin}, baselines come only from ${origin}`);
      }
      const { width } = await sharp(source).metadata();
      // A zoom cell (ADR-212) is named after its window; its CSS viewport, and so its 1x picture, is the window divided by the zoom.
      const expectedWidth = cell.width / cell.zoom;
      if (width !== expectedWidth) problems.push(`${name}: the PNG is ${width} px wide, not the 1x viewport width ${expectedWidth} px`);
      const earlier = chosen.get(name);
      if (earlier) {
        problems.push(`${name}: approved twice (${earlier.from} and ${from})`);
        continue;
      }
      chosen.set(name, { name, source, from, routeId: cell.routeId });
    }
  }
  return { cells: [...chosen.values()], problems, skipped };
}

/**
 * Copies the planned cells. Callers write only when planPromotion found no problem.
 * @param {Array<{name: string, source: string}>} cells
 * @param {string} baselines
 * @returns {Promise<{replaced: string[], added: string[]}>}
 */
export async function promote(cells, baselines) {
  await mkdir(baselines, { recursive: true });
  /** @type {string[]} */
  const replaced = [];
  /** @type {string[]} */
  const added = [];
  for (const cell of cells) {
    const target = join(baselines, `${cell.name}.png`);
    (existsSync(target) ? replaced : added).push(cell.name);
    await copyFile(cell.source, target);
  }
  return { replaced, added };
}

async function main() {
  const { values } = parseArgs({
    options: {
      approval: { type: 'string' },
      write: { type: 'boolean', default: false },
      baselines: { type: 'string' },
      'routes-file': { type: 'string' },
    },
  });
  if (!values.approval) throw new Error('--approval=FILE.json is required');
  const approval = JSON.parse(await readFile(resolve(values.approval), 'utf8'));
  const routes = values['routes-file']
    ? JSON.parse(await readFile(resolve(values['routes-file']), 'utf8'))
    : (await import('./routes.mjs')).routes;
  const origin = baselineOrigin();
  const given = values.baselines ? resolve(values.baselines) : null;
  const dirOf = (/** @type {string} */ name) => baselineDirOf(name, { baselines: given });

  const { cells, problems, skipped } = await planPromotion(approval, { routes, origin });
  if (skipped.length) console.log(`Skipped ${skipped.length} volatile cell(s) (ADR-223, never baselines): ${skipped.join(', ')}`);
  if (problems.length) {
    console.error(`Refused: ${problems.length} problem(s), nothing written.`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const existing = cells.filter((c) => existsSync(join(dirOf(c.name), `${c.name}.png`))).length;
  console.log(`${cells.length} approved cell(s) of ${new Set(cells.map((c) => c.routeId)).size} route(s): ${existing} replace a baseline, ${cells.length - existing} new. Baseline host ${origin}.`);
  if (!values.write) {
    for (const cell of cells) console.log(`  ${cell.name}  <-  ${cell.from}`);
    console.log('Dry run: nothing written. Add --write to copy them.');
    return;
  }
  // One folder per tier when --baselines is not given (p4 cells apart, baselineDirOf); a single folder otherwise, as before.
  for (const baselines of [...new Set(cells.map((c) => dirOf(c.name)))]) {
    const { replaced, added } = await promote(cells.filter((c) => dirOf(c.name) === baselines), baselines);
    console.log(`Wrote ${replaced.length + added.length} baseline(s) to ${baselines}: ${replaced.length} replaced, ${added.length} new.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
