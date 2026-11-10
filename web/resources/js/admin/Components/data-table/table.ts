import type { Component } from 'vue';

/** Column of a DataTable. Cells render the raw value unless the page fills the slot `cell-<key>`. */
export interface TableColumn {
    key: string;
    /** Already translated header label. */
    label: string;
    /** Server sort key (whitelisted in the controller), usually the same as `key`. */
    sort?: string;
    /** Numbers: right-aligned, tnum (03 §14). */
    numeric?: boolean;
    align?: 'left' | 'right';
    /** Fixed column width (xs 48, num 80 for short numbers and years, sm 120, md 160, lg 240, xl 320). Keep one column `auto`: it takes the rest. */
    width?: 'xs' | 'num' | 'sm' | 'md' | 'lg' | 'xl' | 'auto';
    /**
     * Content-sized columns (DQ-526). Once any column of a table sets `min` or `grow`, the table sizes its columns by content:
     * - `grow`: this column takes the remaining width; its default cell wraps to at most two lines (one `grow` column per table);
     * - `min`: the column is as wide as its content (never wrapped or cut) and at least this many px;
     * - neither: the column shrinks to its content (status pills, numbers, dates).
     * `width` keeps working as a fixed width in both modes.
     */
    min?: ColumnMin;
    grow?: boolean;
    /**
     * Content-sized tables: the cell may wrap to two lines instead of staying on one (DQ-553, a long reason like "Rechtswidrig · Illegale
     * Rennen (§ 315d StGB)"). Give it a `width` (e.g. `lg`) so it wraps there instead of pushing the last columns off the edge.
     */
    wrap?: boolean;
    /** false = always shown (e.g. the primary column). */
    hideable?: boolean;
    defaultHidden?: boolean;
    /** Header text visually hidden (e.g. an actions column); the label stays for screen readers. */
    srOnlyLabel?: boolean;
    /**
     * Classes of the loading bar in this column (DQ-593), e.g. `h-24 w-200` for two row buttons. Default: a 24 px square for a column
     * with a hidden header (the row menu, an icon button), a 48 px bar for numbers, three quarters of the column otherwise.
     */
    skeleton?: string;
}

/** The loading bar of a column: the same footprint as its content, so no header moves when the rows arrive (DQ-593). */
export function skeletonBar(column: TableColumn): { shape: 'block' | 'text'; class: string } {
    if (column.skeleton !== undefined) return { shape: 'block', class: column.skeleton };
    if (column.srOnlyLabel === true) return { shape: 'block', class: 'size-24' };
    return { shape: 'text', class: column.numeric ? 'ml-auto w-48' : 'w-3/4' };
}

export interface BulkAction {
    key: string;
    label: string;
    icon?: Component;
    danger?: boolean;
    /** Atom needed; hidden without it (UI hint, the server decides). */
    atom?: string;
}

export const columnWidths: Record<NonNullable<TableColumn['width']>, string> = {
    xs: 'w-48',
    num: 'w-80',
    sm: 'w-120',
    md: 'w-160',
    lg: 'w-240',
    xl: 'w-320',
    auto: '',
};

/** Minimum widths of content-sized columns (the classes must be literal for Tailwind). */
export const columnMins = {
    64: 'min-w-64',
    80: 'min-w-80',
    96: 'min-w-96',
    120: 'min-w-120',
    150: 'min-w-150',
    160: 'min-w-160',
    200: 'min-w-200',
    220: 'min-w-220',
    240: 'min-w-240',
    260: 'min-w-260',
    280: 'min-w-280',
    320: 'min-w-320',
} as const;
export type ColumnMin = keyof typeof columnMins;

/** Whether a table uses content-sized columns (`min`/`grow` on any column). */
export const isFluid = (columns: TableColumn[]): boolean => columns.some((c) => c.min !== undefined || c.grow === true);

/** Header cell width classes of a column. */
export function headerWidth(column: TableColumn, fluid: boolean): string {
    if (column.width !== undefined && column.width !== 'auto') return columnWidths[column.width];
    if (!fluid || column.grow === true) return '';
    // 1 px = "as narrow as the content allows"; the content never wraps, so the column is exactly its content (or `min`).
    return 'w-px';
}

const STORAGE = 'sc-admin-table:';

export function loadHiddenColumns(table: string): string[] | null {
    try {
        const raw = window.localStorage.getItem(`${STORAGE}${table}:hidden`);
        const parsed: unknown = raw === null ? null : JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
    } catch {
        return null;
    }
}

export function saveHiddenColumns(table: string, hidden: string[]): void {
    try {
        window.localStorage.setItem(`${STORAGE}${table}:hidden`, JSON.stringify(hidden));
    } catch {
        // Not persisted in private mode.
    }
}
