/** Server-driven table props (m3.1 contract §0 "Tables"); produced by App\Http\Controllers\Admin\Support\TableProps. */
export interface PageMeta {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
}

export interface Paginated<T> {
    data: T[];
    meta: PageMeta;
}

export interface TableQuery {
    filter: Record<string, string>;
    sort: string | null;
    per_page: number;
}

export interface SavedView {
    id: string;
    name: string;
    query: Partial<TableQuery> & { columns?: string[] };
}

/** A preset view defined in the page code (not stored). `name` is an i18n key. */
export interface PresetView {
    key: string;
    name: string;
    query: Partial<TableQuery>;
}

/** Per-record result of a bulk action (contract §0 "Bulk"). `code` is an i18n key suffix for failures. */
export interface BulkResult {
    id: string;
    ok: boolean;
    code: string | null;
}
