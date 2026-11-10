import type { Component } from 'vue';

/**
 * Admin module registry. Each module adds ONE file `modules/<module>.ts` with `export default defineModule({...})`; the shell collects them
 * with import.meta.glob, so parallel workstreams never edit a shared file. Navigation groups and their order are fixed here (03 §14).
 * An entry is shown only when its route exists in this build (Ziggy) and the staff member holds its atom.
 */
export const NAV_GROUPS = [
    'overview',
    'members',
    'vehicles_media',
    'catalog',
    'qr',
    'moderation',
    'support',
    'brand_content',
    'configuration',
    'team',
    'audit_privacy',
    'system',
    'settings',
] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

export type CountKey = 'approvals_for_me' | 'alerts';

export interface NavItem {
    /** Ziggy route name, e.g. 'admin.audit.index'. */
    route: string;
    /** i18n key of the label. */
    label: string;
    icon: Component;
    /** Atom (or any of several atoms) needed to see the entry. Omit for every staff member. */
    atom?: string | string[];
    /** Ziggy pattern that marks the entry active, e.g. 'admin.members.*'. Defaults to `route`. */
    match?: string;
    /** Shell count shown as a badge. */
    badge?: CountKey;
    /** Position inside the group (ascending). */
    order?: number;
    /** data-testid suffix: the link gets `shell.nav.<testId>`. */
    testId: string;
    /** Extra words the ⌘K palette matches (i18n keys not needed: plain search words in both languages). */
    keywords?: string[];
}

export interface PaletteEntry {
    key: string;
    /** i18n key */
    label: string;
    route: string;
    params?: Record<string, string>;
    atom?: string | string[];
    icon?: Component;
    keywords?: string[];
}

/** A work-queue tile of ADM-06. The server sends `{count, status?, since?}` under `key` (DashboardData::queues). */
export interface QueueTile {
    key: string;
    /** i18n keys */
    label: string;
    empty: string;
    atom: string | string[];
    /** Where the tile links once that module exists. */
    route?: string;
    params?: Record<string, string>;
    order: number;
    testId: string;
}

export interface AdminModule {
    key: string;
    nav?: { group: NavGroup; items: NavItem[] }[];
    palette?: PaletteEntry[];
    queues?: QueueTile[];
}

export function defineModule(module: AdminModule): AdminModule {
    return module;
}

const files = import.meta.glob<{ default: AdminModule }>(['./*.ts', '!./registry.ts'], { eager: true });

export const modules: AdminModule[] = Object.values(files)
    .map((file) => file.default)
    .sort((a, b) => a.key.localeCompare(b.key));

export type Can = (atom: string | string[] | undefined) => boolean;

export interface NavSection {
    group: NavGroup;
    items: NavItem[];
}

export function navigation(can: Can, exists: (route: string) => boolean): NavSection[] {
    return NAV_GROUPS.map((group) => ({
        group,
        items: modules
            .flatMap((module) => module.nav ?? [])
            .filter((section) => section.group === group)
            .flatMap((section) => section.items)
            .filter((item) => exists(item.route) && can(item.atom))
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    })).filter((section) => section.items.length > 0);
}

export function paletteEntries(can: Can, exists: (route: string) => boolean): (PaletteEntry & { group: NavGroup | null })[] {
    const fromNav = navigation(can, exists).flatMap((section) =>
        section.items.map((item) => ({ key: `nav:${item.route}`, label: item.label, route: item.route, icon: item.icon, keywords: item.keywords, group: section.group })),
    );
    const extra = modules
        .flatMap((module) => module.palette ?? [])
        .filter((entry) => exists(entry.route) && can(entry.atom))
        .map((entry) => ({ ...entry, group: null }));
    return [...fromNav, ...extra];
}

export function queueTiles(can: Can): QueueTile[] {
    return modules
        .flatMap((module) => module.queues ?? [])
        .filter((tile) => can(tile.atom))
        .sort((a, b) => a.order - b.order);
}
