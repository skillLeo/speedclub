import { readFileSync } from 'fs';
import { join } from 'path';

import { estimatedWidth, WORDMARK_EM, WORDMARK_FALLBACK_EM } from '@/features/widget/metrics';

/** The advance of each character in a TrueType file: cmap (format 12, else 4) → glyph id → hmtx, over unitsPerEm. */
function advances(file: string): (char: string) => number | null {
  const buf = readFileSync(file);
  const count = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < count; i++) tables[buf.toString('ascii', 12 + i * 16, 16 + i * 16)] = buf.readUInt32BE(20 + i * 16);
  const head = tables.head!;
  const hhea = tables.hhea!;
  const hmtx = tables.hmtx!;
  const cmap = tables.cmap!;
  const upem = buf.readUInt16BE(head + 18);
  const metrics = buf.readUInt16BE(hhea + 34);
  let sub = -1;
  let format = 0;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const platform = buf.readUInt16BE(cmap + 4 + i * 8);
    const encoding = buf.readUInt16BE(cmap + 6 + i * 8);
    const offset = cmap + buf.readUInt32BE(cmap + 8 + i * 8);
    const f = buf.readUInt16BE(offset);
    if (platform === 3 && encoding === 10 && f === 12) {
      sub = offset;
      format = 12;
    } else if (platform === 3 && encoding === 1 && f === 4 && format !== 12) {
      sub = offset;
      format = 4;
    }
  }
  const glyph = (cp: number): number => {
    if (format === 12) {
      for (let i = 0; i < buf.readUInt32BE(sub + 12); i++) {
        const o = sub + 16 + i * 12;
        if (cp >= buf.readUInt32BE(o) && cp <= buf.readUInt32BE(o + 4)) return buf.readUInt32BE(o + 8) + cp - buf.readUInt32BE(o);
      }
      return 0;
    }
    const segX2 = buf.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      if (cp > buf.readUInt16BE(ends + 2 * i)) continue;
      const start = buf.readUInt16BE(starts + 2 * i);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltas + 2 * i);
      const range = buf.readUInt16BE(ranges + 2 * i);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + 2 * i + range + 2 * (cp - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  return (char) => {
    const id = glyph(char.codePointAt(0) ?? 0);
    return id ? Math.ceil((buf.readUInt16BE(hmtx + 4 * Math.min(id, metrics - 1)) / upem) * 1000) / 1000 : null;
  };
}

const FONT = join(__dirname, '../../assets/fonts/ArchivoSemiExpanded-SemiBold.ttf');

describe('widget text metrics', () => {
  it('holds the advances of the shipped Archivo SemiExpanded SemiBold', () => {
    const read = advances(FONT);
    for (const [char, em] of Object.entries(WORDMARK_EM)) expect([char, read(char)]).toEqual([char, em]);
    expect(WORDMARK_FALLBACK_EM).toBe(Math.max(...Object.entries(WORDMARK_EM).filter(([c]) => /^\p{L}$/u.test(c)).map(([, em]) => em)));
  });

  it('reads Inter like the spec strip table (the same reader, checked on a face with a known table)', () => {
    const read = advances(join(__dirname, '../../assets/fonts/Inter-Medium.ttf'));
    expect(read('W')).toBe(1.003);
    expect(read('ß')).toBe(0.63);
  });

  it('errs wide: the estimate is never narrower than the plain advances', () => {
    const plain = [...'Skyline GT-R R34'].reduce((sum, char) => sum + (WORDMARK_EM[char] ?? 0), 0) * 17;
    expect(estimatedWidth('Skyline GT-R R34', 'wordmark', 17, 0)).toBeGreaterThan(plain);
    expect(estimatedWidth('', 'wordmark', 17, 0)).toBe(0);
    expect(estimatedWidth('Nichts fällig', 'medium', 14, 0)).toBeGreaterThan(0);
  });
});
