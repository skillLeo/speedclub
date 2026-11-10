#!/usr/bin/env node
/**
 * SPEED CLUB: custom automotive icon build + source gate.
 *
 * Source:  design/icons/auto/<name>.svg and <name>-fill.svg (hand-authored, 256 grid)
 * Outputs: mobile/src/ui/icons/auto/<PascalName>.tsx, types.ts, index.ts       (react-native-svg)
 *          web/resources/js/shared/icons/auto/<PascalName>.vue, index.ts       (Vue 3)
 *          web/resources/views/components/icons/auto-sprite.blade.php          (<symbol> sprite)
 *
 * Usage:   node design/scripts/build-icons.mjs                    # validate + generate
 *          node design/scripts/build-icons.mjs --check            # CI/verify: fail if a source breaks the rules or outputs are stale
 *          node design/scripts/build-icons.mjs --out-root <dir>   # write into another root (testing)
 *
 * Exit codes: 0 ok · 1 invalid source · 2 stale/missing/orphaned outputs (--check)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const outRootIdx = args.indexOf('--out-root');
const repoRoot = resolve(here, '..', '..');
const outRoot = outRootIdx >= 0 ? resolve(args[outRootIdx + 1]) : repoRoot;
const srcDir = join(repoRoot, 'design', 'icons', 'auto');

/** The glyph set is a contract (docs/03_DESIGN_SYSTEM.md §6): order here is the order in every output. */
const NAMES = [
  'wheel',
  'tyre',
  'coilover',
  'air-suspension',
  'exhaust',
  'turbo',
  'intake',
  'engine',
  'ecu-chip',
  'brake-disc',
  'wing',
  'seat',
  'light',
  'audio',
  'gearbox',
  'drivetrain',
];

const VIEWBOX = '0 0 256 256';
const STROKE_WIDTH = '16';
const LIVE_MIN = 24;
const LIVE_MAX = 232;
const LIVE_TOLERANCE = 1;

const GEOMETRY = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
};
const REQUIRED_ROOT = {
  regular: {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: VIEWBOX,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': STROKE_WIDTH,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  },
  fill: {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: VIEWBOX,
    fill: 'currentColor',
  },
};

/* ---------------------------------------------------------------- parsing */
const pascal = (name) => name.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const camelAttr = (attr) => attr.replace(/-(\w)/g, (_, c) => c.toUpperCase());

function parseAttrs(text, errors, where) {
  const attrs = {};
  const rest = text.replace(/([\w:-]+)="([^"]*)"/g, (_, key, value) => {
    if (key in attrs) errors.push(`${where}: duplicate attribute ${key}`);
    attrs[key] = value;
    return '';
  });
  if (rest.trim() !== '') errors.push(`${where}: cannot parse attributes "${rest.trim()}"`);
  return attrs;
}

/** Controlled SVG subset: one root <svg> with flat, self-closed children. Anything else is a rule break. */
function parseSvg(text, file, errors) {
  const match = text.trim().match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!match) {
    errors.push(`${file}: expected a single root <svg> element`);
    return null;
  }
  const root = parseAttrs(match[1], errors, `${file} <svg>`);
  const children = [];
  const rest = match[2].replace(/<([a-zA-Z]+)\b([^<>]*?)\/>/g, (_, tag, attrText) => {
    children.push({ tag, attrs: parseAttrs(attrText, errors, `${file} <${tag}>`) });
    return '';
  });
  if (rest.trim() !== '') {
    errors.push(`${file}: unsupported content "${rest.trim().slice(0, 60)}" (no groups, text, comments or nested elements)`);
  }
  return { root, children };
}

/* ---------------------------------------------------------------- geometry bounds */
const nums = (s) => (s.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function arcPoints(x0, y0, rxIn, ryIn, large, sweep, x1, y1) {
  // SVG 1.1 appendix F.6.5: endpoint to centre parameterisation (no x-axis rotation is used in this set).
  if (rxIn === 0 || ryIn === 0) return [[x1, y1]];
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const scale = Math.max(1, Math.sqrt((dx * dx) / (rxIn * rxIn) + (dy * dy) / (ryIn * ryIn)));
  const rx = rxIn * scale;
  const ry = ryIn * scale;
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1)));
  const cx = k * ((rx * dy) / ry) + (x0 + x1) / 2;
  const cy = k * (-(ry * dx) / rx) + (y0 + y1) / 2;
  const a0 = Math.atan2((y0 - cy) / ry, (x0 - cx) / rx);
  let delta = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx) - a0;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  const pts = [];
  for (let i = 1; i <= 48; i++) {
    const a = a0 + (delta * i) / 48;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** Tokenises arc flags correctly: they may be written without separators. */
function pathPoints(d, where, errors) {
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9,.\-eE\s]+$/.test(d)) {
    errors.push(`${where}: path data contains invalid characters`);
    return [];
  }
  const pts = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cpx = 0;
  let cpy = 0;
  let prev = '';
  const bez = (fn) => {
    for (let i = 1; i <= 16; i++) pts.push(fn(i / 16));
  };
  for (const [, letter, body] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const CMD = letter.toUpperCase();
    const rel = letter !== CMD;
    const count = ARG_COUNT[CMD];
    if (count === undefined) {
      errors.push(`${where}: unknown path command ${letter}`);
      continue;
    }
    const v = nums(body);
    if (CMD === 'Z') {
      x = sx;
      y = sy;
      prev = CMD;
      continue;
    }
    if (v.length === 0 || v.length % count !== 0) {
      errors.push(`${where}: path command ${letter} has ${v.length} arguments`);
      continue;
    }
    for (let i = 0; i < v.length; i += count) {
      const a = v.slice(i, i + count);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let nx = x;
      let ny = y;
      if (CMD === 'M' || CMD === 'L' || CMD === 'T') {
        nx = a[0] + ox;
        ny = a[1] + oy;
        if (CMD === 'M' && i === 0) {
          sx = nx;
          sy = ny;
        }
        pts.push([nx, ny]);
      } else if (CMD === 'H') {
        nx = a[0] + ox;
        pts.push([nx, ny]);
      } else if (CMD === 'V') {
        ny = a[0] + oy;
        pts.push([nx, ny]);
      } else if (CMD === 'C' || CMD === 'S') {
        const smooth = prev === 'C' || prev === 'S';
        const c1 = CMD === 'C' ? [a[0] + ox, a[1] + oy] : smooth ? [2 * x - cpx, 2 * y - cpy] : [x, y];
        const rest = CMD === 'C' ? a.slice(2) : a;
        const c2 = [rest[0] + ox, rest[1] + oy];
        nx = rest[2] + ox;
        ny = rest[3] + oy;
        const [x0, y0] = [x, y];
        const [ex, ey] = [nx, ny];
        bez((t) => {
          const m = 1 - t;
          return [
            m * m * m * x0 + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * ex,
            m * m * m * y0 + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * ey,
          ];
        });
        cpx = c2[0];
        cpy = c2[1];
      } else if (CMD === 'Q') {
        const c = [a[0] + ox, a[1] + oy];
        nx = a[2] + ox;
        ny = a[3] + oy;
        const [x0, y0] = [x, y];
        const [ex, ey] = [nx, ny];
        bez((t) => {
          const m = 1 - t;
          return [m * m * x0 + 2 * m * t * c[0] + t * t * ex, m * m * y0 + 2 * m * t * c[1] + t * t * ey];
        });
      } else if (CMD === 'A') {
        if (a[2] !== 0) errors.push(`${where}: arc x-axis rotation is not allowed`);
        nx = a[5] + ox;
        ny = a[6] + oy;
        pts.push(...arcPoints(x, y, a[0], a[1], a[3], a[4], nx, ny));
      }
      x = nx;
      y = ny;
      prev = CMD;
    }
  }
  return pts;
}

function elementPoints({ tag, attrs }, where, errors) {
  const num = (k, fallback = 0) => {
    if (attrs[k] === undefined) return fallback;
    const value = Number(attrs[k]);
    if (Number.isNaN(value)) errors.push(`${where}: ${k}="${attrs[k]}" is not a number`);
    return value;
  };
  if (tag === 'path') return pathPoints(attrs.d ?? '', where, errors);
  if (tag === 'circle') {
    const [cx, cy, r] = [num('cx'), num('cy'), num('r')];
    return [[cx - r, cy - r], [cx + r, cy + r]];
  }
  if (tag === 'rect') {
    const [x, y] = [num('x'), num('y')];
    return [[x, y], [x + num('width'), y + num('height')]];
  }
  if (tag === 'line') return [[num('x1'), num('y1')], [num('x2'), num('y2')]];
  if (tag === 'polyline') {
    const v = nums(attrs.points ?? '');
    const pts = [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
    return pts;
  }
  return [];
}

/* ---------------------------------------------------------------- source gate */
function validate(file, weight, parsed, errors) {
  const required = REQUIRED_ROOT[weight];
  for (const [key, value] of Object.entries(required)) {
    if (parsed.root[key] !== value) {
      errors.push(`${file}: <svg ${key}> must be "${value}", found ${parsed.root[key] === undefined ? 'nothing' : `"${parsed.root[key]}"`}`);
    }
  }
  for (const key of Object.keys(parsed.root)) {
    if (!(key in required)) errors.push(`${file}: <svg> attribute ${key} is not allowed`);
  }
  if (parsed.children.length === 0) errors.push(`${file}: no drawing elements`);

  const pad = weight === 'regular' ? Number(STROKE_WIDTH) / 2 : 0;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  parsed.children.forEach((el, index) => {
    const where = `${file} <${el.tag}> #${index + 1}`;
    const geometry = GEOMETRY[el.tag];
    if (!geometry) {
      errors.push(`${where}: element not allowed (use ${Object.keys(GEOMETRY).join(', ')})`);
      return;
    }
    for (const [key, value] of Object.entries(el.attrs)) {
      if (geometry.includes(key)) continue;
      if (weight === 'fill' && key === 'fill-rule' && value === 'evenodd') continue;
      errors.push(`${where}: attribute ${key}="${value}" is not allowed (no transforms, ids, styles, colours or per-element paint)`);
    }
    for (const key of el.tag === 'rect' ? ['x', 'y', 'width', 'height'] : geometry.filter((k) => k !== 'rx' && k !== 'ry')) {
      if (el.attrs[key] === undefined) errors.push(`${where}: missing ${key}`);
    }
    for (const [x, y] of elementPoints(el, where, errors)) {
      minX = Math.min(minX, x - pad);
      minY = Math.min(minY, y - pad);
      maxX = Math.max(maxX, x + pad);
      maxY = Math.max(maxY, y + pad);
    }
  });
  if (
    parsed.children.length > 0 &&
    (minX < LIVE_MIN - LIVE_TOLERANCE || minY < LIVE_MIN - LIVE_TOLERANCE || maxX > LIVE_MAX + LIVE_TOLERANCE || maxY > LIVE_MAX + LIVE_TOLERANCE)
  ) {
    const b = [minX, minY, maxX, maxY].map((v) => Math.round(v * 10) / 10).join(', ');
    errors.push(`${file}: drawing bounds [${b}] leave the live area ${LIVE_MIN}..${LIVE_MAX}`);
  }
}

function loadSources(errors) {
  const icons = [];
  const expected = new Set(NAMES.flatMap((n) => [`${n}.svg`, `${n}-fill.svg`]));
  for (const file of existsSync(srcDir) ? readdirSync(srcDir) : []) {
    if (file.endsWith('.svg') && !expected.has(file)) errors.push(`${file}: not part of the glyph set`);
  }
  for (const name of NAMES) {
    const icon = { name, component: pascal(name) };
    for (const [weight, file] of [['regular', `${name}.svg`], ['fill', `${name}-fill.svg`]]) {
      const path = join(srcDir, file);
      if (!existsSync(path)) {
        errors.push(`${file}: missing`);
        continue;
      }
      const text = readFileSync(path, 'utf8');
      const colour = text.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
      if (colour) errors.push(`${file}: raw colour ${colour[0]}`);
      const parsed = parseSvg(text, file, errors);
      if (parsed) {
        validate(file, weight, parsed, errors);
        icon[weight] = parsed.children;
      }
    }
    icons.push(icon);
  }
  return icons;
}

/* ---------------------------------------------------------------- generators */
const NOTICE = 'AUTO-GENERATED by design/scripts/build-icons.mjs from design/icons/auto/*.svg. DO NOT EDIT BY HAND.';
const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)$/;
const RN_TAG = { path: 'Path', circle: 'Circle', rect: 'Rect', line: 'Line', polyline: 'Polyline' };

const rnElement = ({ tag, attrs }) => {
  const props = Object.entries(attrs).map(([key, value]) => {
    const prop = camelAttr(key);
    return NUMERIC.test(value) ? `${prop}={${value}}` : `${prop}="${value}"`;
  });
  return `<${RN_TAG[tag]} ${props.join(' ')} />`;
};
const htmlElement = ({ tag, attrs }) =>
  `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')} />`;

function rnComponent(icon) {
  const tags = [...new Set([...icon.regular, ...icon.fill].map((el) => RN_TAG[el.tag]))].sort();
  const body = (els) => els.map((el) => `      ${rnElement(el)}`).join('\n');
  const fillBody = (els) => els.map((el) => `        ${rnElement(el)}`).join('\n');
  return `/* ${NOTICE} */
import Svg, { ${tags.join(', ')} } from 'react-native-svg';

import type { AutoIconProps } from './types';

export function ${icon.component}({ size = 24, color, weight = 'regular', testID }: AutoIconProps) {
  if (weight === 'fill') {
    return (
      <Svg width={size} height={size} viewBox="${VIEWBOX}" fill={color} testID={testID}>
${fillBody(icon.fill)}
      </Svg>
    );
  }
  return (
    <Svg
      width={size}
      height={size}
      viewBox="${VIEWBOX}"
      fill="none"
      stroke={color}
      strokeWidth={${STROKE_WIDTH}}
      strokeLinecap="round"
      strokeLinejoin="round"
      testID={testID}
    >
${body(icon.regular)}
    </Svg>
  );
}
`;
}

const rnTypes = () => `/* ${NOTICE} */
export type AutoIconSize = 16 | 20 | 24 | 48;
export type AutoIconWeight = 'regular' | 'fill';

export interface AutoIconProps {
  size?: AutoIconSize;
  /** Theme colour of the accompanying text, from \`useTheme()\`. */
  color: string;
  weight?: AutoIconWeight;
  testID?: string;
}
`;

const mapKey = (name) => (name.includes('-') ? `'${name}'` : name);

function rnIndex(icons) {
  return `/* ${NOTICE} */
import type { ComponentType } from 'react';

${icons.map((i) => `import { ${i.component} } from './${i.component}';`).join('\n')}
import type { AutoIconProps } from './types';

export type { AutoIconProps, AutoIconSize, AutoIconWeight } from './types';
export { ${icons.map((i) => i.component).join(', ')} };

export type AutoIconName =
${icons.map((i) => `  | '${i.name}'`).join('\n')};

export const autoIcons: Record<AutoIconName, ComponentType<AutoIconProps>> = {
${icons.map((i) => `  ${mapKey(i.name)}: ${i.component},`).join('\n')}
};
`;
}

function vueComponent(icon) {
  const body = (els) => els.map((el) => `    ${htmlElement(el)}`).join('\n');
  return `<!-- ${NOTICE} -->
<script setup lang="ts">
withDefaults(defineProps<{ size?: 16 | 20 | 24 | 48; weight?: 'regular' | 'fill' }>(), {
  size: 24,
  weight: 'regular',
});
</script>

<template>
  <svg
    v-if="weight === 'fill'"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="${VIEWBOX}"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
${body(icon.fill)}
  </svg>
  <svg
    v-else
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="${VIEWBOX}"
    fill="none"
    stroke="currentColor"
    stroke-width="${STROKE_WIDTH}"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
${body(icon.regular)}
  </svg>
</template>
`;
}

function vueIndex(icons) {
  return `/* ${NOTICE} */
${icons.map((i) => `import ${i.component} from './${i.component}.vue';`).join('\n')}

export { ${icons.map((i) => i.component).join(', ')} };

export type AutoIconName =
${icons.map((i) => `  | '${i.name}'`).join('\n')};

export const autoIcons = {
${icons.map((i) => `  ${mapKey(i.name)}: ${i.component},`).join('\n')}
} satisfies Record<AutoIconName, unknown>;
`;
}

function bladeSprite(icons) {
  const symbol = (id, attrs, els) =>
    `  <symbol id="${id}" viewBox="${VIEWBOX}" ${attrs}>\n${els.map((el) => `    ${htmlElement(el)}`).join('\n')}\n  </symbol>`;
  const regular = `fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
  const symbols = icons.flatMap((i) => [
    symbol(`auto-${i.name}`, regular, i.regular),
    symbol(`auto-${i.name}-fill`, 'fill="currentColor"', i.fill),
  ]);
  return `{{-- ${NOTICE} Usage: <svg width="20" height="20" aria-hidden="true"><use href="#auto-wheel"/></svg> --}}
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">
${symbols.join('\n')}
</svg>
`;
}

/* ---------------------------------------------------------------- run */
const errors = [];
const icons = loadSources(errors);
if (errors.length > 0) {
  console.error(`✖ Icon sources break the rules (${errors.length}):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const mobileDir = join('mobile', 'src', 'ui', 'icons', 'auto');
const vueDir = join('web', 'resources', 'js', 'shared', 'icons', 'auto');
const bladeFile = join('web', 'resources', 'views', 'components', 'icons', 'auto-sprite.blade.php');

const outputs = new Map();
for (const icon of icons) {
  outputs.set(join(mobileDir, `${icon.component}.tsx`), rnComponent(icon));
  outputs.set(join(vueDir, `${icon.component}.vue`), vueComponent(icon));
}
outputs.set(join(mobileDir, 'types.ts'), rnTypes());
outputs.set(join(mobileDir, 'index.ts'), rnIndex(icons));
outputs.set(join(vueDir, 'index.ts'), vueIndex(icons));
outputs.set(bladeFile, bladeSprite(icons));

/** Files in the generated directories that no glyph produces any more. */
const orphans = [mobileDir, vueDir].flatMap((dir) => {
  const abs = join(outRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).map((f) => join(dir, f)).filter((f) => !outputs.has(f));
});

if (CHECK) {
  const problems = [];
  for (const [rel, content] of outputs) {
    const abs = join(outRoot, rel);
    if (!existsSync(abs)) problems.push(`missing ${rel}`);
    else if (readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') !== content) problems.push(`stale ${rel}`);
  }
  for (const rel of orphans) problems.push(`orphaned ${rel}`);
  if (problems.length > 0) {
    console.error(`✖ Icon outputs out of date (${problems.length}); run: node design/scripts/build-icons.mjs`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(2);
  }
  console.log(`✔ Icons up to date: ${icons.length} glyphs, ${outputs.size} outputs.`);
} else {
  for (const [rel, content] of outputs) {
    const abs = join(outRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const rel of orphans) rmSync(join(outRoot, rel));
  console.log(`✔ Icons generated: ${icons.length} glyphs, ${outputs.size} outputs.`);
}
