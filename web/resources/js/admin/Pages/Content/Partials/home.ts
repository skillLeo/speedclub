/** Shapes of ADM-29 (HomeController, App\Services\Config\Schemas\HomeCurationSchema). */
export interface VehicleSummary {
    id: string;
    title: string;
    owner: string | null;
    slug: string;
    thumb: string | null;
    reachable: boolean;
}

export interface Localized {
    de: string;
    en: string | null;
}

export interface Featured {
    vehicle_id: string;
    starts_at: string | null;
    ends_at: string | null;
}

export interface Collection {
    key: string;
    title: Localized;
    subtitle: Localized | null;
    mode: 'filter' | 'vehicles';
    filters: Record<string, unknown>;
    sort: string | null;
    vehicle_ids: string[];
    cover_vehicle_id: string | null;
    active: boolean;
}

export interface HomeCuration {
    featured: Featured[];
    collections: Collection[];
}

const NUMBERS = new Set(['year_min', 'year_max', 'power_min', 'power_max']);
const LISTS = new Set(['drivetrain', 'gearbox', 'fuel', 'wheel_diameter', 'wheel_brand', 'suspension_type', 'suspension_brand', 'exhaust_brand', 'mod_category']);

/** Discover's address parameters ("make=bmw&power_min=340&drivetrain[]=all") → the stored filters. */
export function parseFilters(query: string): Record<string, unknown> {
    const params = new URLSearchParams(query.trim().replace(/^.*\?/, ''));
    const out: Record<string, unknown> = {};
    for (const [rawKey, value] of params.entries()) {
        const key = rawKey.replace(/\[\]$/, '');
        if (value === '') continue;
        if (LISTS.has(key)) {
            const list = (out[key] as unknown[] | undefined) ?? [];
            for (const part of value.split(',')) if (part.trim() !== '') list.push(key === 'wheel_diameter' ? Number(part) : part.trim());
            out[key] = list;
        } else out[key] = NUMBERS.has(key) && /^\d+$/.test(value) ? Number(value) : value;
    }
    return out;
}

/** The stored filters → Discover's address parameters, for the editor. */
export function filtersText(filters: Record<string, unknown>): string {
    return Object.entries(filters)
        .map(([key, value]) => (Array.isArray(value) ? `${key}=${value.map(String).join(',')}` : `${key}=${String(value)}`))
        .join('&');
}

/**
 * DQ-641: the stored filters as readable chips ("Marke: bmw", "ab 340 PS", "Baujahr bis 2005"), so a pasted Discover link reads back
 * as what it matches. Values stay as Discover writes them (slugs), the key names are translated.
 */
export function filterChips(filters: Record<string, unknown>, t: (key: string, params?: Record<string, string>) => string): string[] {
    return Object.entries(filters).map(([key, value]) => {
        const text = Array.isArray(value) ? value.map(String).join(', ') : String(value);
        if (key === 'power_min' || key === 'power_max' || key === 'year_min' || key === 'year_max') return t(`content.home.filter_keys.${key}`, { value: text });
        const label = t(`content.home.filter_keys.${key}`);
        return label === `content.home.filter_keys.${key}` ? `${key}: ${text}` : `${label}: ${text}`;
    });
}
