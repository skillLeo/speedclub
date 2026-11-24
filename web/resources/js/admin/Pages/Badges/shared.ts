import { trans } from 'laravel-vue-i18n';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/** ADM-63 "Abzeichen" (M5.9d admin): shapes of App\Http\Controllers\Admin\Badges\* and the URLs of its routes. */
export interface BadgeRule {
    metric: string;
    gte?: number;
    eq?: true;
    set?: string;
}

export interface BadgeRow {
    key: string;
    name: string;
    category: string;
    tier: string;
    hidden: boolean;
    active: boolean;
    sort: number;
    earned: number;
    rule: BadgeRule;
}

export interface BadgeDetail {
    key: string;
    name_de: string;
    name_en: string;
    description_de: string;
    description_en: string;
    hint_de: string | null;
    hint_en: string | null;
    rule: BadgeRule;
    hidden: boolean;
    tier: string;
    category: string;
    sort: number;
    active: boolean;
    earned: number;
}

export interface MetricInfo {
    key: string;
    boolean: boolean;
    parameter: string | null;
}

export interface DexSetInfo {
    key: string;
    name: string;
}

export const badgeHref = (key: string): string => routeOr('admin.badges.show', `/admin/content/badges/${key}`, { badge: key });
export const badgeUrl = (name: 'update' | 'active' | 'apply', key: string): string =>
    routeOr(`admin.badges.${name}`, `/admin/content/badges/${key}${name === 'update' ? '' : `/${name}`}`, { badge: key });
export const indexHref = (): string => routeOr('admin.badges.index', '/admin/content/badges');
export const createHref = (): string => routeOr('admin.badges.create', '/admin/content/badges/new');
export const storeUrl = (): string => routeOr('admin.badges.store', '/admin/content/badges');
export const previewUrl = (): string => routeOr('admin.badges.preview', '/admin/content/badges/preview');

export const metricLabel = (metric: string): string => trans(`gift.badges.metrics.${metric}`);

/** One line for a rule: "Gespottete Autos: mindestens 25", "Aktiver Sticker am Auto", "Dex-Set „JDM-Legenden“ komplett". */
export function ruleSummary(rule: BadgeRule, sets: DexSetInfo[] = []): string {
    if (rule.set !== undefined) return trans('gift.badges.rule.summary_set', { set: sets.find((s) => s.key === rule.set)?.name ?? rule.set });
    if (rule.gte !== undefined) return trans('gift.badges.rule.summary_gte', { metric: metricLabel(rule.metric), value: formatNumber(rule.gte) });
    return trans('gift.badges.rule.summary_eq', { metric: metricLabel(rule.metric) });
}

/** "Würde heute N Mitglieder erhalten". */
export function previewText(count: number): string {
    return count === 1 ? trans('gift.badges.rule.preview_one') : trans('gift.badges.rule.preview', { count: formatNumber(count) });
}

/** The rule as preview query parameters (GET admin.badges.preview). */
export function previewQuery(rule: BadgeRule): Record<string, string> {
    return {
        metric: rule.metric,
        ...(rule.gte !== undefined ? { gte: String(rule.gte) } : {}),
        ...(rule.eq === true ? { eq: 'true' } : {}),
        ...(rule.set !== undefined ? { set: rule.set } : {}),
    };
}
