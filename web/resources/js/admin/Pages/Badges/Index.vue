<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhEyeSlash, PhFunnel, PhLockSimple, PhPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Field, Input, Select, StatusPill, type SelectOption } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import { badgeHref, createHref, ruleSummary, type BadgeRow, type DexSetInfo } from './shared';

/**
 * ADM-63 "Abzeichen" (M5.9d admin, m5.9d contract §2, ADR-513): every badge in app order with its rule, category, tier, hidden, status,
 * how many members earned it and its order; filters Suche · Kategorie · Stufe · Versteckt · Status and saved views. content.view reads;
 * "Neues Abzeichen" and the record's writes need content.edit. Rows open the badge (form, preview, activity).
 */
const props = defineProps<{ rows: Paginated<BadgeRow>; query: TableQuery; views: SavedView[]; canEdit?: boolean; anyBadges?: boolean; sets?: DexSetInfo[] }>();

const { can } = usePermissions();
const state = usePageState();
const mayEdit = computed(() => props.canEdit === true && can('content.edit'));

const columns = computed<TableColumn[]>(() => [
    { key: 'name', label: trans('gift.badges.columns.name'), sort: 'key', grow: true, min: 200, hideable: false },
    { key: 'rule', label: trans('gift.badges.columns.rule'), min: 200 },
    { key: 'category', label: trans('gift.badges.columns.category') },
    { key: 'tier', label: trans('gift.badges.columns.tier') },
    { key: 'active', label: trans('gift.badges.columns.active') },
    { key: 'earned', label: trans('gift.badges.columns.earned'), sort: 'earned', numeric: true },
    { key: 'sort', label: trans('gift.badges.columns.sort'), sort: 'sort', numeric: true },
]);
const presets: PresetView[] = [
    { key: 'inactive', name: 'gift.badges.presets.inactive', query: { filter: { active: 'no' } } },
    { key: 'hidden', name: 'gift.badges.presets.hidden', query: { filter: { hidden: 'yes' } } },
];

const CATEGORIES = ['garage', 'mods', 'spotting', 'sets', 'treffen', 'forum', 'sticker', 'founding', 'community'];
const TIERS = ['bronze', 'silver', 'gold'];
const tierTone = { bronze: 'neutral', silver: 'info', gold: 'warning' } as const;

const filters = reactive({ q: '', category: '', tier: '', hidden: '', active: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', category: filter.category ?? '', tier: filter.tier ?? '', hidden: filter.hidden ?? '', active: filter.active ?? '' }),
    { immediate: true },
);
const ANY = '*';
const pick = (key: 'category' | 'tier' | 'hidden' | 'active') => computed({ get: () => filters[key] || undefined, set: (v: string | undefined) => (filters[key] = v === undefined || v === ANY ? '' : v) });
const categoryModel = pick('category');
const tierModel = pick('tier');
const hiddenModel = pick('hidden');
const activeModel = pick('active');
const any: SelectOption = { value: ANY, label: trans('gift.badges.filters.any') };
const categoryOptions = computed<SelectOption[]>(() => [any, ...CATEGORIES.map((c) => ({ value: c, label: trans(`gift.badges.categories.${c}`) }))]);
const tierOptions = computed<SelectOption[]>(() => [any, ...TIERS.map((t) => ({ value: t, label: trans(`gift.badges.tiers.${t}`) }))]);
const yesNo = computed<SelectOption[]>(() => [any, { value: 'yes', label: trans('gift.badges.filters.yes') }, { value: 'no', label: trans('gift.badges.filters.no') }]);
const activeOptions = computed<SelectOption[]>(() => [any, { value: 'yes', label: trans('gift.badges.status.active') }, { value: 'no', label: trans('gift.badges.status.inactive') }]);
function applied(): Record<string, string> {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}
</script>

<template>
    <Head :title="trans('gift.badges.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-63" :data-qa-state="state">
        <PageHeader :title="trans('gift.badges.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('gift.badges.intro')">
            <template v-if="mayEdit" #actions>
                <Button :href="createHref()" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-63.new">{{ trans('gift.badges.new') }}</Button>
            </template>
        </PageHeader>
        <p v-if="!mayEdit" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-63.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('gift.badges.view_only') }}</p>

        <DataTable
            id="badges"
            row-keys
            row-key="key"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'anyBadges', 'sets']"
            :caption="trans('gift.badges.caption')"
            :empty-title="trans('gift.badges.empty_title')"
            :empty-body="trans('gift.badges.empty_body')"
            :row-href="(row) => badgeHref(row.key)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-63.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('gift.badges.filters.label')" @submit.prevent="apply(applied())">
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('gift.badges.filters.q')"><Input v-model="filters.q" size="sm" maxlength="80" :placeholder="trans('gift.badges.filters.q_placeholder')" data-testid="ADM-63.filter.q" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('gift.badges.filters.category')"><Select v-model="categoryModel" :options="categoryOptions" size="sm" :placeholder="trans('gift.badges.filters.any')" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('gift.badges.filters.tier')"><Select v-model="tierModel" :options="tierOptions" size="sm" :placeholder="trans('gift.badges.filters.any')" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('gift.badges.filters.hidden')"><Select v-model="hiddenModel" :options="yesNo" size="sm" :placeholder="trans('gift.badges.filters.any')" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('gift.badges.filters.active')"><Select v-model="activeModel" :options="activeOptions" size="sm" :placeholder="trans('gift.badges.filters.any')" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-63.filter.apply">{{ trans('gift.badges.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-name="{ row }">
                <Link :href="badgeHref(row.key)" :class="[focusRing, 'flex min-h-32 min-w-0 items-center gap-8 rounded-xs hover:underline']" data-testid="ADM-63.open">
                    <NameCell :name="row.name" :caption="row.key" />
                    <PhEyeSlash v-if="row.hidden" :size="16" class="shrink-0 text-ink-3" :aria-label="trans('gift.badges.hidden_yes')" />
                </Link>
            </template>
            <template #cell-rule="{ row }">
                <span class="block text-ink-2">{{ ruleSummary(row.rule, sets ?? []) }}</span>
            </template>
            <template #cell-category="{ row }">
                <span class="whitespace-nowrap text-ink-2">{{ trans(`gift.badges.categories.${row.category}`) }}</span>
            </template>
            <template #cell-tier="{ row }">
                <Badge :tone="tierTone[row.tier as keyof typeof tierTone] ?? 'neutral'">{{ trans(`gift.badges.tiers.${row.tier}`) }}</Badge>
            </template>
            <template #cell-active="{ row }">
                <StatusPill :tone="row.active ? 'success' : 'neutral'" :label="trans(row.active ? 'gift.badges.status.active' : 'gift.badges.status.inactive')" />
            </template>
            <template #cell-earned="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.earned) }}</span>
            </template>
            <template #cell-sort="{ row }">
                <span class="block text-right text-ink-2 tabular-nums">{{ formatNumber(row.sort) }}</span>
            </template>
        </DataTable>
    </div>
</template>
