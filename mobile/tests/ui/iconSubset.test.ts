/**
 * M5.12a (09 §12): src/ui/icons/phosphorSubset.tsx is generated from Phosphor's defs with only the regular and fill weights. It must be
 * what scripts/build-icon-subset.mjs writes for the names Icon.tsx imports, and it must not carry any other weight.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');

describe('the Phosphor subset', () => {
  it('is up to date with Icon.tsx and the installed Phosphor', () => {
    expect(() => execFileSync('node', ['scripts/build-icon-subset.mjs', '--check'], { cwd: root, stdio: 'pipe' })).not.toThrow();
  });

  it('holds the regular and fill weights only, one map per icon', () => {
    const source = readFileSync(join(root, 'src', 'ui', 'icons', 'phosphorSubset.tsx'), 'utf8');
    const weights = [...source.matchAll(/^ {2}\['(\w+)', /gm)].map((match) => match[1]);
    expect(new Set(weights)).toEqual(new Set(['regular', 'fill']));
    const icons = (source.match(/^export const \w+Icon: Glyph/gm) ?? []).length;
    expect(weights).toHaveLength(icons * 2);
    expect(source).not.toMatch(/from 'phosphor-react-native/);
  });
});
