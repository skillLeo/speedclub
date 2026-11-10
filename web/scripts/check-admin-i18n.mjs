#!/usr/bin/env node
/**
 * ADR-213 gate for the admin strings (lang/admin/{de,en}/<module>.json):
 *  1. every module file exists in both locales, and every key exists in both (no key in one locale only);
 *  2. no value is empty, every value is a string (nested objects allowed);
 *  3. every literal key the admin code uses (trans('…'), t('…'), $t('…'), registry labels, server flash keys) exists in both
 *     locales, including keys of a module whose file is missing altogether (the .gitignore of M3.1 hid auth.json and nothing failed);
 *  4. placeholders (:name) match between the locales;
 *  5. literal keys in the branches of a conditional (`c ? 'ui.a' : 'ui.b'`, also nested) or behind a fallback (`x ?? 'ui.a'`, `x || 'ui.a'`)
 *     exist in both locales when their first segment is a module (DQ-667: `trans(refused ? 'ui.actions.close' : …)` slipped through).
 * Exit 1 with a list of problems, 0 when clean. Every run first proves (and `--self-test` alone shows) on throw-away fixtures that a missing module file, a key missing
 * in one locale and a missing flash key fail, and that a complete tree passes.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['de', 'en'];

function walk(dir, exts, out = []) {
    let entries = [];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, exts, out);
        else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(path);
    }
    return out;
}

/**
 * @param {string} web the web/ root to check
 * @returns {{problems: string[], keys: number, modules: number, used: number}}
 */
export function check(web) {
    const langRoot = join(web, 'lang', 'admin');
    const problems = [];

    function flatten(tree, prefix, into, file) {
        for (const [key, value] of Object.entries(tree)) {
            const path = `${prefix}.${key}`;
            if (typeof value === 'string') {
                if (value.trim() === '') problems.push(`${file}: empty value for ${path}`);
                into.set(path, value);
            } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                flatten(value, path, into, file);
            } else {
                problems.push(`${file}: ${path} must be a string or an object`);
            }
        }
    }

    const messages = Object.fromEntries(LOCALES.map((locale) => [locale, new Map()]));
    const modules = new Set();

    for (const locale of LOCALES) {
        const dir = join(langRoot, locale);
        let files = [];
        try {
            files = readdirSync(dir).filter((f) => f.endsWith('.json'));
        } catch {
            problems.push(`missing directory lang/admin/${locale}`);
        }
        for (const file of files) {
            const module = file.replace(/\.json$/, '');
            modules.add(module);
            const path = join(dir, file);
            try {
                flatten(JSON.parse(readFileSync(path, 'utf8')), module, messages[locale], relative(web, path));
            } catch (error) {
                problems.push(`${relative(web, path)}: invalid JSON (${error.message})`);
            }
        }
    }

    for (const module of modules) {
        for (const locale of LOCALES) {
            try {
                statSync(join(langRoot, locale, `${module}.json`));
            } catch {
                problems.push(`lang/admin/${locale}/${module}.json is missing (exists in another locale)`);
            }
        }
    }

    const [first, ...others] = LOCALES;
    for (const other of others) {
        for (const key of messages[first].keys()) if (!messages[other].has(key)) problems.push(`${key}: missing in ${other}`);
        for (const key of messages[other].keys()) if (!messages[first].has(key)) problems.push(`${key}: missing in ${first}`);
    }

    const placeholders = (text) => [...text.matchAll(/:([a-z_]+)/g)].map((m) => m[1]).sort().join(',');
    for (const [key, de] of messages[first]) {
        for (const other of others) {
            const value = messages[other].get(key);
            if (value !== undefined && placeholders(de) !== placeholders(value)) problems.push(`${key}: placeholders differ between ${first} and ${other}`);
        }
    }

    // ---- keys used by the code --------------------------------------------------------------------------------------------
    // A literal in a translate call is always a key, whatever its module: so a key of a module without any file is caught too.
    const anyKey = `([a-z][a-z0-9_-]*\\.[a-z0-9_]+(?:\\.[a-z0-9_]+)*)`;
    const call = new RegExp(`(?:\\b(?:trans|wTrans|transChoice|wTransChoice|flashText|t)|\\$t)\\(\\s*['"]${anyKey}['"]`, 'g');
    // Registry/preset fields that hold keys (label: 'shell.nav.audit', name: …, empty: …) count when their first segment is a module:
    // one with a file, one the code translates elsewhere, or one a modules/*.ts registers (`key: 'catalog'`).
    const field = new RegExp(`\\b(?:label|empty|name)\\s*:\\s*['"]${anyKey}['"]`, 'g');

    // Permission atoms (audit.view, audit.export …) look like keys: they are not strings to translate.
    let seeder = '';
    try {
        seeder = readFileSync(join(web, 'database', 'seeders', 'StaffSeeder.php'), 'utf8');
    } catch {
        seeder = '';
    }
    const atoms = new Set([...seeder.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]));

    const sources = walk(join(web, 'resources', 'js', 'admin'), ['.vue', '.ts']);
    const texts = sources.map((file) => [file, readFileSync(file, 'utf8')]);
    const known = new Set(modules);
    for (const [file, text] of texts) {
        for (const match of text.matchAll(call)) known.add(match[1].split('.')[0]);
        if (/[\\/]modules[\\/][^\\/]+\.ts$/.test(file)) for (const match of text.matchAll(/\bkey:\s*'([a-z][a-z0-9_-]*)'\s*,\s*\n\s*nav:/g)) known.add(match[1]);
    }

    // On the server only the flash messages are admin keys: ->with('success'|'error', '<key>').
    const serverFlash = /->with\(\s*'(?:success|error)'\s*,\s*'([a-z_]+\.[a-z0-9_.]+)'\s*\)/g;
    const serverSources = [...walk(join(web, 'app', 'Http', 'Controllers', 'Admin'), ['.php']), ...walk(join(web, 'app', 'Actions', 'Admin'), ['.php'])];

    let used = 0;
    const need = (where, verb, key) => {
        used += 1;
        for (const locale of LOCALES) {
            if (!messages[locale].has(key)) {
                const module = key.split('.')[0];
                const missingFile = !modules.has(module) ? ` (lang/admin/${locale}/${module}.json does not exist)` : '';
                problems.push(`${where}: ${verb} ${key}, missing in ${locale}${missingFile}`);
            }
        }
    };

    for (const file of serverSources) {
        for (const match of readFileSync(file, 'utf8').matchAll(serverFlash)) need(relative(web, file), 'flashes', match[1]);
    }

    for (const [file, text] of texts) {
        for (const match of text.matchAll(call)) {
            if (atoms.has(match[1])) continue;
            need(relative(web, file), 'uses', match[1]);
        }
        for (const match of text.matchAll(field)) {
            const key = match[1];
            if (atoms.has(key) || !known.has(key.split('.')[0])) continue;
            need(relative(web, file), 'uses', key);
        }
    }

    for (const [file, text] of texts) {
        for (const key of conditionalKeys(text)) {
            if (atoms.has(key) || !known.has(key.split('.')[0])) continue;
            need(relative(web, file), 'uses (conditional)', key);
        }
    }

    return { problems: [...new Set(problems)].sort(), keys: messages[first].size, modules: modules.size, used };
}

/**
 * Single-quoted key literals that are a branch of a conditional expression or the fallback of `??` / `||`. The consequent is the literal
 * right after a `?` (not `?.` or `??`); the alternate is a literal right after a `:` whose colon pairs with a `?` of the same expression,
 * found by walking back at bracket depth 0 (an object key `label: 'x'` hits `{` or `,` first and is not a conditional).
 * @param {string} text
 * @returns {string[]}
 */
export function conditionalKeys(text) {
    const out = [];
    const literal = /'([a-z][a-z0-9_-]*\.[a-z0-9_]+(?:\.[a-z0-9_]+)*)'/g;
    const prevIndex = (i) => {
        let j = i - 1;
        while (j >= 0 && /\s/.test(text[j])) j -= 1;
        return j;
    };
    const isQuestion = (j) => text[j] === '?' && text[j + 1] !== '.' && text[j + 1] !== '?' && text[j - 1] !== '?';
    /** Walk back from the colon at `c`: true when it closes a conditional of the same expression. */
    const colonOfConditional = (c) => {
        let depth = 0;
        let pending = 0;
        for (let j = c - 1, steps = 0; j >= 0 && steps < 600; j -= 1, steps += 1) {
            const ch = text[j];
            if (ch === "'") {
                // skip the single-quoted string backwards
                j -= 1;
                while (j >= 0 && !(text[j] === "'" && text[j - 1] !== '\\')) j -= 1;
                continue;
            }
            if (ch === ')' || ch === ']' || ch === '}') depth += 1;
            else if (ch === '(' || ch === '[' || ch === '{') {
                if (depth === 0) return false;
                depth -= 1;
            } else if (depth === 0) {
                if (ch === ',' || ch === ';' || ch === '"' || ch === '`') return false;
                if (ch === ':' && text[j - 1] !== ':' && text[j + 1] !== ':') pending += 1;
                else if (isQuestion(j)) {
                    if (pending === 0) return true;
                    pending -= 1;
                }
            }
        }
        return false;
    };
    for (const match of text.matchAll(literal)) {
        const before = prevIndex(match.index);
        if (before < 0) continue;
        const ch = text[before];
        if (isQuestion(before)) out.push(match[1]);
        else if (ch === ':' && colonOfConditional(before)) out.push(match[1]);
        else if ((ch === '?' && text[before - 1] === '?') || (ch === '|' && text[before - 1] === '|')) out.push(match[1]);
    }
    return out;
}

/** Fixtures: a complete tree passes; a missing module file, a one-locale key and a missing flash key each fail. */
function selfTest(quiet = false) {
    const cases = [];
    const tree = (name, files) => {
        const root = mkdtempSync(join(tmpdir(), `admin-i18n-${name}-`));
        for (const [path, content] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), content);
        }
        return root;
    };
    const page = "<script setup lang=\"ts\">\nconst a = trans('auth.login.title');\nconst b = trans('ui.ok');\n</script>\n";
    const lang = (locale, module, value) => [`lang/admin/${locale}/${module}.json`, JSON.stringify(value)];
    const base = { ...Object.fromEntries([lang('de', 'ui', { ok: 'OK' }), lang('en', 'ui', { ok: 'OK' })]), 'resources/js/admin/Pages/P.vue': page };
    const complete = { ...base, ...Object.fromEntries([lang('de', 'auth', { login: { title: 'Anmelden' } }), lang('en', 'auth', { login: { title: 'Sign in' } })]) };

    cases.push(['complete tree passes', complete, (p) => p.length === 0]);
    cases.push(['missing module file in both locales fails', base, (p) => p.some((x) => x.includes('uses auth.login.title, missing in de') && x.includes('does not exist'))]);
    cases.push([
        'module file missing in one locale fails',
        { ...base, ...Object.fromEntries([lang('de', 'auth', { login: { title: 'Anmelden' } })]) },
        (p) => p.some((x) => x.includes('lang/admin/en/auth.json is missing')) && p.some((x) => x.includes('uses auth.login.title, missing in en')),
    ]);
    cases.push([
        'key missing in one locale fails',
        { ...complete, ...Object.fromEntries([lang('en', 'auth', { login: {} })]) },
        (p) => p.some((x) => x.includes('auth.login.title: missing in en')),
    ]);
    cases.push([
        'missing flash key fails',
        { ...complete, 'app/Http/Controllers/Admin/X.php': "<?php return back()->with('success', 'gone.flash.saved');\n" },
        (p) => p.some((x) => x.includes('flashes gone.flash.saved, missing in de')),
    ]);
    cases.push([
        '$t() and t() keys of a missing module fail',
        { ...complete, 'resources/js/admin/Pages/Q.vue': "<template><p>{{ $t('nope.title') }}</p></template>\n<script setup lang=\"ts\">\nconst c = t('also.missing');\n</script>\n" },
        (p) => p.some((x) => x.includes('uses nope.title, missing in de')) && p.some((x) => x.includes('uses also.missing, missing in en')),
    ]);
    // DQ-667: keys in the branches of a conditional, in a template and in a script, nested and as a fallback.
    const conditional =
        "<template><Button>{{ trans(refused ? 'ui.gone' : 'ui.ok') }}</Button><X :label=\"a ? 'ui.ok' : (b ? 'ui.nested' : 'ui.ok')\" /></template>\n" +
        "<script setup lang=\"ts\">\nconst k = props.readOnly\n    ? 'ui.script_branch'\n    : 'ui.ok';\nconst f = props.label ?? 'ui.fallback';\nconst o = { tone: 'ui.ok', label: x?.y };\n</script>\n";
    cases.push([
        'keys in conditional branches and fallbacks fail when missing',
        { ...complete, 'resources/js/admin/Pages/R.vue': conditional },
        (p) =>
            ['ui.gone', 'ui.nested', 'ui.script_branch', 'ui.fallback'].every((key) => p.some((x) => x.includes(`uses (conditional) ${key}, missing in de`))) &&
            !p.some((x) => x.includes('ui.ok,')),
    ]);
    cases.push([
        'object values and comparisons are not conditional keys',
        {
            ...complete,
            'resources/js/admin/Pages/S.ts': "const a = { status: 'ui.missing_object' };\nconst b = x === 'ui.missing_cmp' ? 1 : 2;\nconst c = f(y, 'ui.missing_arg');\n",
        },
        (p) => p.length === 0,
    ]);

    let failed = 0;
    for (const [name, files, expectation] of cases) {
        const root = tree(name.replace(/[^a-z]+/g, '-'), files);
        try {
            const { problems } = check(root);
            const ok = expectation(problems);
            if (!ok) failed += 1;
            if (!quiet || !ok) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got: ${JSON.stringify(problems)}`}`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }
    if (failed > 0) {
        console.error(`check-admin-i18n --self-test: ${failed} of ${cases.length} cases failed`);
        process.exit(1);
    }
    if (!quiet) console.log(`check-admin-i18n --self-test: ${cases.length} cases passed`);
    return cases.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    if (process.argv.includes('--self-test')) {
        selfTest();
    } else {
        // The gate proves on fixtures first that it fails where it must (a missing module file above all), then checks the tree.
        const proven = selfTest(true);
        const web = join(dirname(fileURLToPath(import.meta.url)), '..');
        const { problems, keys, modules, used } = check(web);
        if (problems.length > 0) {
            console.error(`check-admin-i18n: ${problems.length} problem(s)`);
            for (const problem of problems) console.error(`  - ${problem}`);
            process.exit(1);
        }
        console.log(`check-admin-i18n: ${keys} keys in ${modules} modules × ${LOCALES.length} locales, ${used} literal uses checked (self-test: ${proven} cases).`);
    }
}
