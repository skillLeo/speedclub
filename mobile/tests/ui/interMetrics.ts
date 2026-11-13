/**
 * Advance widths of the shipped Inter faces, read from the font files themselves (hmtx through cmap), so a test can count the
 * lines a string takes at a width. Unkerned, as the display-title and spec-strip estimates are: kerning in Inter only tightens.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Face = { width: (text: string, fontSize: number) => number };

const FONT_DIR = join(__dirname, '../../assets/fonts');
const faces = new Map<string, Face>();

function load(file: string): Face {
  const buffer = readFileSync(join(FONT_DIR, file));
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tables: Record<string, number> = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    const entry = 12 + i * 16;
    tables[buffer.toString('ascii', entry, entry + 4)] = view.getUint32(entry + 8);
  }
  const table = (tag: string) => {
    const offset = tables[tag];
    if (offset === undefined) throw new Error(`${file}: no ${tag} table`);
    return offset;
  };
  const unitsPerEm = view.getUint16(table('head') + 18);
  const metrics = view.getUint16(table('hhea') + 34);
  const hmtx = table('hmtx');
  const advance = (glyph: number) => view.getUint16(hmtx + 4 * Math.min(glyph, metrics - 1));
  // cmap format 4 (Windows BMP), enough for German text.
  const cmap = table('cmap');
  let subtable = -1;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const platform = view.getUint16(cmap + 4 + i * 8);
    const encoding = view.getUint16(cmap + 6 + i * 8);
    const offset = cmap + view.getUint32(cmap + 8 + i * 8);
    if (platform === 3 && encoding === 1 && view.getUint16(offset) === 4) subtable = offset;
  }
  if (subtable < 0) throw new Error(`${file}: no cmap format 4`);
  const segments = view.getUint16(subtable + 6) / 2;
  const ends = subtable + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  const glyphOf = (code: number): number => {
    for (let i = 0; i < segments; i++) {
      if (code > view.getUint16(ends + i * 2)) continue;
      const start = view.getUint16(starts + i * 2);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + i * 2);
      const range = view.getUint16(ranges + i * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const glyph = view.getUint16(ranges + i * 2 + range + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  return {
    width: (text, fontSize) => [...text].reduce((sum, char) => sum + (advance(glyphOf(char.codePointAt(0) ?? 0)) / unitsPerEm) * fontSize, 0),
  };
}

/** The face of a native font family name ("Inter-Regular"), as the type tokens name it. */
export function interFace(family: string): Face {
  let face = faces.get(family);
  if (!face) {
    face = load(`${family}.ttf`);
    faces.set(family, face);
  }
  return face;
}

/** Lines a text takes when it wraps greedily at its plain spaces (a no-break space keeps its words together). */
export function lineCount(text: string, face: Face, fontSize: number, width: number): number {
  const words = text.split(' ');
  const space = face.width(' ', fontSize);
  let lines = 1;
  let line = 0;
  for (const word of words) {
    const w = face.width(word, fontSize);
    if (line === 0) line = w;
    else if (line + space + w <= width) line += space + w;
    else {
      lines += 1;
      line = w;
    }
  }
  return lines;
}
