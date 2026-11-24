import { tileNameSize, tileNameText, tileTextWidth, wordmarkScale } from '@/features/dex/components/DexTile';
import { tileWidth } from '@/features/dex/layout';
import { keepNameTogether } from '@/lib/format';
import { layout, space, typeScale, typography } from '@/theme';
import { estimatedTitleLines } from '@/ui/displayTitleLayout';

/** DEX-01 on a 393 phone: two cards to a row inside the page gutters. */
const PHONE_TILE = tileWidth(393 - 2 * layout.gutter.phone, 2);
const PHONE_TEXT = tileTextWidth(PHONE_TILE, false);
const MAX_LINES = typeScale.displayWordmark.maxLines;

const linesAt = (name: string, fontSize: number) => estimatedTitleLines(name, fontSize, PHONE_TEXT).lines;

describe('DexTile name: the full wordmark while it fits two lines, else its shrink pair, never truncated (ADR-515)', () => {
  it('has a token shrink pair below the full size', () => {
    expect(typeScale.displayWordmark.minSize).toBeLessThan(typography.displayWordmark.fontSize);
    expect(typeScale.displayWordmark.minLineHeight).toBeLessThan(typography.displayWordmark.lineHeight);
  });

  it('draws the role at the font scale, capped like the role', () => {
    expect(wordmarkScale(1)).toBe(1);
    expect(wordmarkScale(2)).toBe(typeScale.displayWordmark.maxFontScale);
    expect(wordmarkScale(0.85)).toBe(0.85);
  });

  it('keeps the full size for a name that fits two lines', () => {
    expect(tileNameSize(keepNameTogether('Supra A80'), PHONE_TEXT, 2)).toBe('full');
    expect(tileNameSize(keepNameTogether('RS 3 Sportback 8Y'), PHONE_TEXT, 1)).toBe('full');
  });

  it('takes the shrink pair for the RS 3 Sportback 8Y of the gift run at 200 % (3 lines at the full size)', () => {
    const name = keepNameTogether('RS 3 Sportback 8Y');
    const scale = wordmarkScale(2);
    expect(linesAt(name, typography.displayWordmark.fontSize * scale)).toBeGreaterThan(MAX_LINES);
    expect(tileNameSize(name, PHONE_TEXT, 2)).toBe('shrunk');
  });

  it('takes the shrink pair when a word is wider than the line (the screen would break inside it)', () => {
    expect(tileNameSize('Sportback', space[48], 1)).toBe('shrunk');
  });

  it('keeps the full size before the grid knows its width', () => {
    expect(tileNameSize('RS 3 Sportback 8Y', 0, 2)).toBe('full');
  });

  it('R4DQ-56: binds the trailing code to the word before it, so "Skyline GT-R R34" never ends on "R34" alone (ADR-426 c)', () => {
    const { text, size } = tileNameText('Skyline GT-R R34', PHONE_TEXT, 1);
    expect(text.endsWith('GT-\u2060R\u00a0R34')).toBe(true);
    expect(size).toBe('full');
    // A code too long to count as one stays breakable; the size is decided on the bound text.
    expect(tileNameText('911 Carrera S 992', PHONE_TEXT, 1).text).toContain('S\u00a0992');
    expect(tileNameText('RS 3 Sportback 8Y', PHONE_TEXT, 2).size).toBe('shrunk');
  });
});
