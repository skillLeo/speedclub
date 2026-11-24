#!/usr/bin/env node
/**
 * M5.12a (09 §12, ADR-473 "splitting the @/ui barrel"): rewrites `import { … } from '@/ui'` into imports from the primitives' own
 * modules (`@/ui/Button`, `@/ui/icons/Icon`, …), as src/ui/index.ts maps each name. Through the barrel every route chunk depended on
 * all ~150 primitives, so the member web's first screen downloaded and evaluated the image viewer, the composer, the range slider and
 * every other one; with direct imports each chunk holds what it uses.
 *
 *   node scripts/split-ui-imports.mjs [--check] [paths…]   default paths: src
 *
 * --check: exit 1 when a file still imports the barrel (tests/ui/uiBarrel.test.ts runs it). Tests may keep the barrel.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const barrelFile = join(root, 'src', 'ui', 'index.ts');

/** name exported by the barrel → { module: '@/ui/Button', imported: 'Button' } */
export function barrelMap(source) {
  const map = new Map();
  for (const match of source.matchAll(/^export (type )?\{([^}]*)\} from '\.\/([^']+)';$/gm)) {
    const typeOnly = Boolean(match[1]);
    for (const part of match[2].split(',').map((entry) => entry.trim()).filter(Boolean)) {
      const [imported, exported = imported] = part.split(/\s+as\s+/).map((entry) => entry.trim());
      map.set(exported, { module: `@/ui/${match[3]}`, imported, typeOnly });
    }
  }
  const rest = source.split('\n').filter((line) => line.trim() && !/^export (type )?\{[^}]*\} from '\.\/[^']+';$/.test(line));
  if (rest.length > 0) throw new Error(`src/ui/index.ts has lines this script does not understand:\n${rest.join('\n')}`);
  return map;
}

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@\/ui';\n?/g;

/** The file's source with every barrel import split per module, or null when it has none. */
export function rewrite(source, map, file = '') {
  if (!IMPORT.test(source)) return null;
  IMPORT.lastIndex = 0;
  return source.replace(IMPORT, (_all, wholeType, list) => {
    /** module → specifiers in source order */
    const byModule = new Map();
    for (const raw of list.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      const typeSpec = Boolean(wholeType) || raw.startsWith('type ');
      const spec = raw.replace(/^type\s+/, '');
      const [name, local = name] = spec.split(/\s+as\s+/).map((entry) => entry.trim());
      const target = map.get(name);
      if (!target) throw new Error(`${file}: '${name}' is not exported by src/ui/index.ts`);
      const text = `${typeSpec && !wholeType ? 'type ' : ''}${target.imported}${local !== target.imported ? ` as ${local}` : ''}`;
      if (!byModule.has(target.module)) byModule.set(target.module, []);
      byModule.get(target.module).push(text);
    }
    return [...byModule.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, specs]) => {
        const head = `import ${wholeType ? 'type ' : ''}{ `;
        const line = `${head}${specs.join(', ')} } from '${module}';`;
        return line.length <= 140 ? `${line}\n` : `import ${wholeType ? 'type ' : ''}{\n${specs.map((spec) => `  ${spec},`).join('\n')}\n} from '${module}';\n`;
      })
      .join('');
  });
}

function filesBelow(path) {
  if (statSync(path).isFile()) return /\.(ts|tsx)$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (name === 'node_modules' ? [] : filesBelow(join(path, name))));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const map = barrelMap(readFileSync(barrelFile, 'utf8'));
  const files = (paths.length ? paths : ['src']).flatMap((path) => filesBelow(resolve(root, path))).filter((file) => file !== barrelFile);
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const next = rewrite(source, map, relative(root, file));
    if (next === null) continue;
    offenders.push(relative(root, file));
    if (!check) writeFileSync(file, next);
  }
  if (check) {
    if (offenders.length > 0) {
      console.error(`✖ ${offenders.length} file(s) import the @/ui barrel; run node scripts/split-ui-imports.mjs:\n  ${offenders.join('\n  ')}`);
      process.exit(1);
    }
    console.log('✔ no @/ui barrel imports');
  } else {
    console.log(`✔ rewrote ${offenders.length} file(s)`);
  }
}
