// Vite build plugin: drops the design-token custom properties (--sc-*) that the public pages never read from the built public.css.
//
// tokens.generated.css carries every token of the app (motion springs, chat bubbles, tab bar, admin colours, z-indices …) in each of
// its theme blocks; the public pages read about 200 of 330. The public stylesheet is inlined into every page (App\Support\InlineAsset),
// so the unread ones cost about 9 KB of HTML (1.5 KB gzipped) and their parse on the critical path of the first paint (M5 gate, LCP).
//
// A token stays when the stylesheet reads it (var(--sc-…)), or when a source that writes CSS at runtime names it: the layout CSS of
// App\Support\SpecStripLayout and App\Support\DisplayTitleLayout, which builds names from a literal prefix, so any literal found in
// app/, resources/views or resources/js/public keeps every token it is a prefix of. Removal runs to a fixed point (a token read only
// by a removed one goes too); --tw-* and Tailwind's theme variables are left alone. The admin stylesheet is not touched.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const SOURCE_DIRS = ['app', 'resources/views', 'resources/js/public'];
const SOURCE_FILE = /\.(php|ts|js|mjs)$/;
// Reads the token source (tokens.generated.css) for e-mails and images, never the inlined stylesheet: its "--sc-color-" would keep every colour.
const NOT_RUNTIME_CSS = new Set(['app/Support/DesignTokens.php']);

/** @param {string} dir @returns {string[]} */
function files(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);

        return statSync(path).isDirectory() ? files(path) : SOURCE_FILE.test(name) ? [path] : [];
    });
}

/** @param {string} root @returns {string[]} every --sc-… literal in the sources that write CSS at runtime */
export function runtimeTokenLiterals(root) {
    const base = resolve(root);
    const found = new Set();

    for (const dir of SOURCE_DIRS) {
        for (const file of files(join(base, dir))) {
            if (NOT_RUNTIME_CSS.has(file.slice(base.length + 1).split(sep).join('/'))) continue;

            for (const match of readFileSync(file, 'utf8').matchAll(/--sc-[a-z0-9-]*[a-z0-9]/g)) found.add(match[0]);
        }
    }

    return [...found];
}

/**
 * Every `--sc-name:value` declaration of a minified stylesheet, with its span (the trailing `;` included, if any).
 * @param {string} css
 * @returns {{ name: string, start: number, end: number }[]}
 */
function declarations(css) {
    const out = [];
    const start = /[{;]--sc-[a-zA-Z0-9_-]+\s*:/g;
    let match;

    while ((match = start.exec(css)) !== null) {
        const from = match.index + 1;
        const name = css.slice(from, css.indexOf(':', from)).trim();
        let depth = 0;
        let quote = '';
        let i = match.index + match[0].length;

        for (; i < css.length; i++) {
            const c = css[i];

            if (quote) {
                if (c === '\\') i++;
                else if (c === quote) quote = '';
            } else if (c === '"' || c === "'") quote = c;
            else if (c === '(') depth++;
            else if (c === ')') depth--;
            else if (depth === 0 && (c === ';' || c === '}')) break;
        }

        out.push({ name, start: from, end: css[i] === ';' ? i + 1 : i });
        start.lastIndex = i;
    }

    return out;
}

/**
 * @param {string} css minified stylesheet
 * @param {string[]} literals names (or name prefixes) that runtime CSS uses
 * @returns {{ css: string, removed: string[] }}
 */
export function pruneTokens(css, literals) {
    const removed = new Set();
    let out = css;

    for (;;) {
        const read = new Set([...out.matchAll(/var\(\s*(--sc-[a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
        const unread = declarations(out).filter(
            ({ name }) => !read.has(name) && !literals.some((literal) => name === literal || name.startsWith(`${literal}-`)),
        );

        if (unread.length === 0) break;

        for (const { name, start, end } of unread.reverse()) {
            out = out.slice(0, start) + out.slice(end);
            removed.add(name);
        }

        // A declaration list may now end in `;}`, and a block may be empty.
        out = out.replace(/;}/g, '}');

        for (let before = ''; before !== out; ) {
            before = out;
            out = out.replace(/(^|[{}])[^{}@;]+\{\}/g, '$1').replace(/@(media|supports|layer)[^{}]*\{\}/g, '');
        }
    }

    return { css: out, removed: [...removed].sort() };
}

/** @param {{ root: string, entry: string }} options */
export default function pruneTokensPlugin({ root, entry }) {
    return {
        name: 'speedclub:prune-public-tokens',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const literals = runtimeTokenLiterals(root);

            for (const asset of Object.values(bundle)) {
                if (asset.type !== 'asset' || !asset.fileName.endsWith('.css') || !(asset.originalFileNames ?? []).includes(entry)) continue;

                const { css, removed } = pruneTokens(String(asset.source), literals);
                asset.source = css;
                this.info(`${entry}: ${removed.length} unread tokens dropped`);
            }
        },
    };
}
