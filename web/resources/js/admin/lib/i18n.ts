/**
 * Admin strings (ADR-213): one JSON file per module and locale in lang/admin/{de,en}/<module>.json, nested; the key of a string is
 * "<module>.<path>", e.g. lang/admin/de/shell.json { "nav": { "search": "Suche" } } → trans('shell.nav.search').
 */
type Tree = { [key: string]: string | Tree };

const files = import.meta.glob<{ default: Tree }>('../../../../lang/admin/*/*.json', { eager: true });

function flatten(tree: Tree, prefix: string, into: Record<string, string>): void {
    for (const [key, value] of Object.entries(tree)) {
        const path = `${prefix}.${key}`;
        if (typeof value === 'string') into[path] = value;
        else flatten(value, path, into);
    }
}

const cache = new Map<string, Record<string, string>>();

export function adminMessages(locale: string): Record<string, string> {
    const hit = cache.get(locale);
    if (hit !== undefined) return hit;
    const messages: Record<string, string> = {};
    for (const [path, file] of Object.entries(files)) {
        const match = /lang\/admin\/([a-z]{2})\/([a-z0-9_-]+)\.json$/.exec(path);
        if (match === null || match[1] !== locale || match[2] === undefined) continue;
        flatten(file.default, match[2], messages);
    }
    cache.set(locale, messages);
    return messages;
}

/** A server flash value is an admin i18n key when one exists, else shown as sent. */
export function flashText(value: string, translate: (key: string) => string): string {
    return /^[a-z_]+\.[a-z0-9_.]+$/.test(value) ? translate(value) : value;
}
