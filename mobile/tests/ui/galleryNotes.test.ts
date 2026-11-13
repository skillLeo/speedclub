/**
 * DQ-931: the gallery notes break like product copy: a label stays with its value, a figure with its unit, a day with its
 * month, a range with both ends, a code or model name in one piece, the "·" at the end of a line, and token names and colour
 * values never hyphenate (a colour value breaks only after its commas).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { noteParts, noteText } from '@/features/gallery/parts';

const NBSP = ' ';
const WJ = '⁠';
const ZWSP = '​';

describe('gallery notes (DQ-931)', () => {
  it('keeps labels with values and units, days with months, ranges and codes together', () => {
    expect(noteText('Steifigkeit 380 · Dämpfung 34 · Masse 1 · CSS 500 ms')).toBe(
      `Steifigkeit${NBSP}380${NBSP}· Dämpfung${NBSP}34${NBSP}· Masse${NBSP}1${NBSP}· CSS${NBSP}500${NBSP}ms`,
    );
    expect(noteText('am 14. Juni 2026 um 19:30 Uhr')).toContain(`14.${NBSP}Juni${NBSP}2026`);
    expect(noteText('am 14. Juni 2026 um 19:30 Uhr')).toContain(`19:30${NBSP}Uhr`);
    expect(noteText('0–100 in 3,9 s')).toBe(`0${WJ}–${WJ}100 in${NBSP}3,9${NBSP}s`);
    // The code stays whole and may move to the next line as one piece; it is never bound to "QR-Code" (r5 DEV-01 "QXM / B").
    expect(noteText('QR-Code 7H2K QXMB')).toBe(`QR-${WJ}Code 7H2K${NBSP}QXMB`);
    expect(noteText('die BBS LM frisch')).toContain(`BBS${NBSP}LM`);
    expect(noteText('max. 2 Zeilen, danach Schrift 24')).toBe(`max.${NBSP}2${NBSP}Zeilen, danach Schrift${NBSP}24`);
    // A line never starts with "·".
    expect(noteText('0 · 4 · 8')).not.toMatch(/ ·/);
  });

  it('sets token names, helpers and colour values as identifiers', () => {
    const parts = noteParts('Innen = außen − Abstand: concentric(20, 8) ergibt 12; gedrückt liegt state.pressedInverse darüber, rgba(245,245,243,0.05).');
    const identifiers = parts.filter((part) => part.identifier).map((part) => part.text);
    expect(identifiers).toEqual([`concentric(20,${NBSP}8)`, 'state.pressedInverse', `rgba(245,${ZWSP}245,${ZWSP}243,${ZWSP}0.05)`]);
    expect(noteParts('scrim.photoStart → scrim.photoEnd').filter((part) => part.identifier)).toHaveLength(2);
    // Nothing is lost.
    expect(parts.map((part) => part.text).join('').replace(/[ ]/g, ' ').replace(/[​⁠]/g, '').replace(/, (?=\d)/g, ',')).toBe(
      'Innen = außen − Abstand: concentric(20,8) ergibt 12; gedrückt liegt state.pressedInverse darüber, rgba(245,245,243,0.05).',
    );
  });

  it('writes no literal no-break space in the gallery sources (escapes only)', () => {
    const dir = join(__dirname, '../../src/features/gallery');
    const files = [...readdirSync(dir), ...readdirSync(join(dir, 'sections')).map((file) => join('sections', file))].filter((file) => /\.tsx?$/.test(file));
    for (const file of files) expect(readFileSync(join(dir, file), 'utf8')).not.toMatch(/[ ⁠​]/);
  });
});
