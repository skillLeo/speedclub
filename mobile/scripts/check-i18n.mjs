#!/usr/bin/env node
/**
 * SPEED CLUB i18n gate (07_QA_AND_RELEASE.md §1). Exit 0 only when:
 *   1. every namespace exists in de and en, with identical key sets and matching {{interpolations}};
 *   2. no user-visible string is hard-coded in src/app, src/features or src/ui.
 *
 * Hard-coded means: JSX text with letters, or a string literal in a user-facing prop.
 * The development-only gallery (src/features/gallery) is exempt because its labels name components.
 * A single line may opt out with the comment  i18n-ignore  (for data like "@username" samples).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'src', 'i18n', 'locales');
const scanDirs = ['src/app', 'src/features', 'src/ui'].map((d) => join(root, d));
const exempt = [join(root, 'src', 'features', 'gallery')];

const USER_FACING_PROPS = new Set([
  'title', 'subtitle', 'label', 'helper', 'error', 'placeholder', 'description', 'message', 'eyebrow', 'hint',
  'accessibilityLabel', 'accessibilityHint', 'headerTitle', 'tabBarLabel', 'confirmLabel', 'cancelLabel', 'actionLabel',
]);

const problems = [];

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

const interpolations = (s) => [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(',');

function checkLocales() {
  const de = new Set(readdirSync(join(localesDir, 'de')).filter((f) => f.endsWith('.json')));
  const en = new Set(readdirSync(join(localesDir, 'en')).filter((f) => f.endsWith('.json')));
  for (const f of de) if (!en.has(f)) problems.push(`locale: en/${f} is missing`);
  for (const f of en) if (!de.has(f)) problems.push(`locale: de/${f} is missing`);
  for (const f of de) {
    if (!en.has(f)) continue;
    const a = flatten(JSON.parse(readFileSync(join(localesDir, 'de', f), 'utf8')));
    const b = flatten(JSON.parse(readFileSync(join(localesDir, 'en', f), 'utf8')));
    for (const k of Object.keys(a)) if (!(k in b)) problems.push(`locale: en/${f} lacks key "${k}"`);
    for (const k of Object.keys(b)) if (!(k in a)) problems.push(`locale: de/${f} lacks key "${k}"`);
    for (const k of Object.keys(a)) {
      if (k in b && interpolations(a[k]) !== interpolations(b[k])) {
        problems.push(`locale: ${f} "${k}" has different {{interpolations}} in de and en`);
      }
      if (a[k].trim() === '') problems.push(`locale: de/${f} "${k}" is empty`);
    }
  }
}

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (exempt.some((e) => p.startsWith(e))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const hasLetters = (s) => /\p{L}{2,}/u.test(s);

function scanFile(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split(/\r?\n/);
  const report = (node, what) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    const here = lines[line] ?? '';
    const above = lines[line - 1] ?? '';
    if (here.includes('i18n-ignore') || above.includes('i18n-ignore')) return;
    problems.push(`hard-coded: ${relative(root, file)}:${line + 1} ${what}`);
  };
  const visit = (node) => {
    if (ts.isJsxText(node) && hasLetters(node.getText())) {
      report(node, `JSX text "${node.getText().trim().slice(0, 40)}"`);
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression)
      && !ts.isJsxAttribute(node.parent) && hasLetters(node.expression.text)) {
      report(node, `JSX string "${node.expression.text.slice(0, 40)}"`);
    }
    if (ts.isJsxAttribute(node) && USER_FACING_PROPS.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isStringLiteral(init)
        ? init
        : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression) ? init.expression : null;
      if (literal && hasLetters(literal.text)) report(node, `${node.name.getText()}="${literal.text.slice(0, 40)}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

checkLocales();
for (const dir of scanDirs) for (const file of walk(dir)) scanFile(file);

if (problems.length) {
  console.error(`✖ i18n gate failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('✔ i18n gate passed (de/en keys identical, no hard-coded UI strings)');
