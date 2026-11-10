// DQ-501: a forced state that looks exactly like the route's default is a state the page did not render. `data-qa-state` only says
// what the page claims; the picture says what it drew. Every non-default state cell (loading, empty, error, offline, restricted and
// named states) is compared with the default cell of the same route at the same viewport, theme, locale, font scale and zoom; within
// the baseline tolerance it is a High `state-not-rendered`. Member and admin routes alike.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_DIFF_PIXEL_RATIO, comparePng } from '../support/image-diff.mjs';

export const STATE_NOT_RENDERED = 'state-not-rendered';

/**
 * The default cell's name of a state cell: the same name without its trailing `__<state>`.
 * @param {{name:string, state?:string}} cell
 * @returns {string|null} null for a default cell
 */
export function defaultCellOf(cell) {
  const state = cell.state ?? 'default';
  if (state === 'default' || !cell.name.endsWith(`__${state}`)) return null;
  return cell.name.slice(0, -`__${state}`.length);
}

/**
 * Compares every captured state cell with its default cell (the PNG in `dir`, from this run or, on --resume, the earlier one).
 * A state cell whose default was not captured is not compared.
 * @param {{name:string, state?:string, failed?:boolean}[]} results
 * @param {string} dir
 * @returns {Promise<{name:string, defaultName:string, ratio:number}[]>} the states that did not render
 */
export async function findUnrenderedStates(results, dir) {
  /** @type {{name:string, defaultName:string, ratio:number}[]} */
  const found = [];
  const failed = new Set(results.filter((r) => r.failed).map((r) => r.name));
  for (const cell of results) {
    if (cell.failed) continue;
    const defaultName = defaultCellOf(cell);
    if (defaultName === null || failed.has(defaultName)) continue;
    const statePng = join(dir, `${cell.name}.png`);
    const defaultPng = join(dir, `${defaultName}.png`);
    if (!existsSync(statePng) || !existsSync(defaultPng)) continue;
    const result = comparePng(await readFile(defaultPng), await readFile(statePng), { writeDiff: false });
    if (result.sameSize && result.ratio <= MAX_DIFF_PIXEL_RATIO) found.push({ name: cell.name, defaultName, ratio: result.ratio });
  }
  return found;
}
