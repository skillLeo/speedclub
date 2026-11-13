import type { Component } from 'vue';

/**
 * Admin module registry. Each module adds ONE file `modules/<module>.ts` with `export default defineModule({...})`; the shell collects them
 * with import.meta.glob, so parallel workstreams never edit a shared file. An entry is shown only when its route exists in this build (Ziggy)
 * and the staff member holds its atom.
 *
 * Modules name one of the 13 functional groups of 03 §14 (`NavGroup`, also used by page crumbs); the sidebar shows them in the five
 * sections of 09 §10.1 (Community · Trust & Safety · Katalog · Plattform · Governance), each group in the section `SECTION_OF` names, in
 * the order of NAV_GROUPS and then the entry's `order`.
 */
export const NAV_GROUPS = [
    'members',
    'vehicles_media',
    'moderation',
    'support',
    'catalog',
    'qr',
    'overview',
    'brand_content',
    'configuration',
    'team',
    'audit_privacy',
    'system',
    'settings',
] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

export const NAV_SECTIONS = ['community', 'trust_safety', 'catalog', 'platform', 'governance'] as const;

export type NavSectionKey = (typeof NAV_SECTIONS)[number];

export const SECTION_OF: Record<NavGroup, NavSectionKey> = {
    members: 'community',
    vehicles_media: 'community',
    moderation: 'trust_safety',
    support: 'trust_safety',
    catalog: 'catalog',
    qr: 'catalog',
    overview: 'platform',
    brand_content: 'platform',
    configuration: 'platform',
    team: 'governance',
    audit_privacy: 'governance',
    system: 'governance',
    settings: 'governance',
};

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

/**
 * A ⌘K action (09 §10.2): pick a record, then its page opens with the action ready ("Mitglied sperren…" → the member's sheet on Sperren).
 * Nothing runs from the palette itself: the page's own checks (password, reason, four-eyes) stay in charge.
 */
export interface PaletteAction {
    key: string;
    /** i18n key, ending in "…" in both languages */
    label: string;
    /** What the second step searches: members through ADM-07, the rest through admin.palette.targets. */
    kind: 'member' | 'event' | 'business' | 'flag';
    atom: string | string[];
    /** The page the action opens; the entry is hidden while it is not registered. */
    route: string;
    /** For `member`: the record URL of a hit, with the action ready. */
    target?: (id: string) => string;
    icon?: Component;
    keywords?: string[];
}

export interface AdminModule {
    key: string;
    nav?: { group: NavGroup; items: NavItem[] }[];
    palette?: PaletteEntry[];
    actions?: PaletteAction[];
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
    group: NavSectionKey;
    items: NavItem[];
}

export function navigation(can: Can, exists: (route: string) => boolean): NavSection[] {
    const rank = (group: NavGroup, item: NavItem): number => NAV_GROUPS.indexOf(group) * 1000 + (item.order ?? 100);
    const entries = modules
        .flatMap((module) => module.nav ?? [])
        .flatMap((section) => section.items.map((item) => ({ group: section.group, item })))
        .filter(({ item }) => exists(item.route) && can(item.atom));
    return NAV_SECTIONS.map((section) => ({
        group: section,
        items: entries
            .filter(({ group }) => SECTION_OF[group] === section)
            .sort((a, b) => rank(a.group, a.item) - rank(b.group, b.item))
            .map(({ item }) => item),
    })).filter((section) => section.items.length > 0);
}

export function paletteEntries(can: Can, exists: (route: string) => boolean): (PaletteEntry & { group: NavSectionKey | null })[] {
    const fromNav = navigation(can, exists).flatMap((section) =>
        section.items.map((item) => ({ key: `nav:${item.route}`, label: item.label, route: item.route, icon: item.icon, keywords: item.keywords, group: section.group })),
    );
    const extra = modules
        .flatMap((module) => module.palette ?? [])
        .filter((entry) => exists(entry.route) && can(entry.atom))
        .map((entry) => ({ ...entry, group: null }));
    return [...fromNav, ...extra];
}

export function paletteActions(can: Can, exists: (route: string) => boolean): PaletteAction[] {
    return modules.flatMap((module) => module.actions ?? []).filter((action) => exists(action.route) && can(action.atom));
}

export function queueTiles(can: Can): QueueTile[] {
    return modules
        .flatMap((module) => module.queues ?? [])
        .filter((tile) => can(tile.atom))
        .sort((a, b) => a.order - b.order);
}
