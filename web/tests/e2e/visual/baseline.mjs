// Baseline handling of the visual matrix. Baselines are written only with --update-baselines.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { comparePng, MAX_DIFF_PIXEL_RATIO } from '../support/image-diff.mjs';

/**
 * @param {Buffer} png the new screenshot
 * @param {string} name file name without extension
 * @param {{baselines:string,updateBaselines:boolean,high:number,diffDir:string,hostLocked?:boolean,volatile?:boolean}} o
 *   hostLocked: the picture shows this server's host (a QR code of APP_URL) and the run is not on the baseline host, so it is
 *   neither compared with nor written as a baseline (`host`).
 *   volatile: the picture is live activity (ADR-223): never compared with nor written as a baseline, also with --update-baselines.
 * @returns {Promise<{status:'new'|'match'|'mismatch'|'updated'|'refused'|'host'|'volatile',ratio:number|null,sameSize?:boolean}>}
 */
export async function handleBaseline(png, name, { baselines, updateBaselines, high, diffDir, hostLocked = false, volatile = false }) {
  if (volatile) return { status: 'volatile', ratio: null };
  if (hostLocked) return { status: 'host', ratio: null };
  const file = join(baselines, `${name}.png`);
  if (updateBaselines) {
    // A broken page can never become the reference everything else is compared against.
    if (high > 0) return { status: 'refused', ratio: null };
    await mkdir(baselines, { recursive: true });
    await writeFile(file, png);
    return { status: 'updated', ratio: null };
  }
  if (!existsSync(file)) return { status: 'new', ratio: null };
  const result = comparePng(await readFile(file), png);
  if (result.sameSize && result.ratio <= MAX_DIFF_PIXEL_RATIO) return { status: 'match', ratio: result.ratio };
  if (result.diff) {
    await mkdir(diffDir, { recursive: true });
    await writeFile(join(diffDir, `${name}.png`), result.diff);
  }
  return { status: 'mismatch', ratio: result.ratio, sameSize: result.sameSize };
}
