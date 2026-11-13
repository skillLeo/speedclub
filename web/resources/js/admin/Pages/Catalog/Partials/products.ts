import { trans } from 'laravel-vue-i18n';
import type { Tone } from '../../../Components/ui';
import { routeOr } from '../../../lib/routes';

/** ADM-57 Teile & Produkte (ProductsController::row / ::show on the server). */
export interface ProductRow {
    id: string;
    slug: string;
    name: string;
    line: string | null;
    brand: { id: number; name: string; slug: string };
    category: string;
    status: 'active' | 'archived';
    merged: boolean;
    mods: number;
    has_affiliate: boolean;
    created_at: string | null;
}

/** Facts per language as the maker states them: {de: {label: value}} or the stored pairs {de: [[label, value]]}. */
export type AttributeSet = Partial<Record<'de' | 'en', Record<string, string> | [string, string][]>>;

export interface ProductDetail extends ProductRow {
    attributes: AttributeSet;
    url: string | null;
    affiliate_url: string | null;
    aliases: string[];
    merged_into: string | null;
    merged_into_name: string | null;
}

export interface CategoryOption {
    value: number;
    key: string;
    label: string;
}

export interface Pair {
    label: string;
    value: string;
}

export function attributePairs(set: AttributeSet | null | undefined, locale: 'de' | 'en'): Pair[] {
    const rows = set?.[locale];
    if (rows === undefined || rows === null) return [];
    const list: [unknown, unknown][] = Array.isArray(rows) ? rows.map((row) => [row[0], row[1]]) : Object.entries(rows);
    return list.filter((row): row is [string, string] => typeof row[0] === 'string' && typeof row[1] === 'string').map(([label, value]) => ({ label, value }));
}

export function productPill(product: Pick<ProductRow, 'status' | 'merged'>): { tone: Tone; label: string } {
    if (product.merged) return { tone: 'info', label: trans('catalog.status.merged') };
    if (product.status === 'archived') return { tone: 'neutral', label: trans('catalog.products.status.archived') };
    return { tone: 'success', label: trans('catalog.status.active') };
}

export const productsUrl = (): string => routeOr('admin.catalog.products.index', '/admin/catalog/products');
export const productHref = (id: string): string => routeOr('admin.catalog.products.show', `/admin/catalog/products/${id}`, { product: id });
export const productWriteUrl = (id?: string, action?: 'archive' | 'restore' | 'merge'): string => {
    if (id === undefined) return routeOr('admin.catalog.products.store', '/admin/catalog/products');
    if (action === undefined) return routeOr('admin.catalog.products.update', `/admin/catalog/products/${id}`, { product: id });
    return routeOr(`admin.catalog.products.${action}`, `/admin/catalog/products/${id}/${action}`, { product: id });
};
