// Contact sheet: a labelled thumbnail grid per route, the first thing design QA reviews.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { compareCellNames } from './matrix.mjs';

const THUMB = { width: 280, height: 360 };
const LABEL_HEIGHT = 44;
const GAP = 16;
const HEADER = 56;
const COLUMNS = 6;
// Review tooling, not product UI: the sheet stays neutral under any theme being reviewed.
const INK = { sheet: '#2a2a2e', cell: '#3a3a40', text: '#f5f5f3', dim: '#b8b8be', high: '#ff6b6b', medium: '#e0a43a', ok: '#3fb27f' };

const escapeXml = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textSvg = (/** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ inner) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${inner}</svg>`);

/**
 * @param {string} name
 * @param {{high?:number,medium?:number,baseline?:string,failed?:boolean}|undefined} info
 */
function labelFor(name, info) {
  const [, size = '', theme = '', locale = '', ...rest] = name.split('__');
  const line1 = `${size} ${theme} ${locale}${rest.length ? ` ${rest.join(' ')}` : ''}`;
  const parts = [];
  if (info?.failed) parts.push(`<tspan fill="${INK.high}">CAPTURE FAILED</tspan>`);
  if (info?.high) parts.push(`<tspan fill="${INK.high}">High ${info.high}</tspan>`);
  if (info?.medium) parts.push(`<tspan fill="${INK.medium}">Medium ${info.medium}</tspan>`);
  if (info?.baseline === 'mismatch') parts.push(`<tspan fill="${INK.high}">BASELINE DIFF</tspan>`);
  if (!parts.length) parts.push(`<tspan fill="${INK.ok}">audit clean</tspan>`);
  return textSvg(
    THUMB.width,
    LABEL_HEIGHT,
    `<text x="0" y="16" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="${INK.text}">${escapeXml(line1)}</text>` +
      `<text x="0" y="36" font-family="Arial, sans-serif" font-size="13">${parts.join(`<tspan fill="${INK.dim}"> · </tspan>`)}</text>`,
  );
}

/**
 * Builds the sheet from all screenshots of the route in the folder.
 * @param {{dir:string,routeId:string,info?:Record<string,{high?:number,medium?:number,baseline?:string,failed?:boolean}>,notes?:string}} args
 * @returns {Promise<{file:string,count:number}|null>}
 */
export async function buildContactSheet({ dir, routeId, info = {}, notes = '' }) {
  const prefix = `${routeId}__`;
  const names = (await readdir(dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
    .map((f) => f.slice(0, -4))
    .sort(compareCellNames);
  if (names.length === 0) return null;

  const columns = Math.min(COLUMNS, names.length);
  const rows = Math.ceil(names.length / columns);
  const cellW = THUMB.width;
  const cellH = THUMB.height + LABEL_HEIGHT;
  const width = Math.max(columns * cellW + (columns + 1) * GAP, 640);
  const height = HEADER + rows * cellH + (rows + 1) * GAP;

  const composites = await Promise.all(
    names.map(async (name, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const left = GAP + col * (cellW + GAP);
      const top = HEADER + GAP + row * (cellH + GAP);
      const thumb = await sharp(await readFile(join(dir, `${name}.png`)))
        .resize({ ...THUMB, fit: 'contain', position: 'top', background: INK.cell })
        .png()
        .toBuffer();
      return [
        { input: thumb, left, top },
        { input: labelFor(name, info[name]), left, top: top + THUMB.height + 4 },
      ];
    }),
  );

  const header = textSvg(
    width,
    HEADER,
    `<text x="${GAP}" y="28" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${INK.text}">${escapeXml(routeId)}</text>` +
      `<text x="${GAP}" y="48" font-family="Arial, sans-serif" font-size="13" fill="${INK.dim}">${names.length} screenshots${notes ? ` · ${escapeXml(notes)}` : ''}</text>`,
  );
  const file = join(dir, 'contact', `${routeId}.png`);
  await sharp({ create: { width, height, channels: 3, background: INK.sheet } })
    .composite([{ input: header, left: 0, top: 0 }, ...composites.flat()])
    .png({ compressionLevel: 6 })
    .toFile(file);
  return { file, count: names.length };
}
