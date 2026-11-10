<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhFunnel } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import { Badge, Button, Field, Input, Select, StatusPill } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import EntryDialogs from './Partials/EntryDialogs.vue';
import EntryMenu from './Partials/EntryMenu.vue';
import MergedLink from './Partials/MergedLink.vue';
import VehicleCatalogHeader from './Partials/VehicleCatalogHeader.vue';
import { entryPill, makeHref, useEntryDialogs, type CatalogEntry } from './shared';

/**
 * ADM-14 tab Marken (06 §3 Catalogue, m3.3-contract §2): makes with country, popular, models, vehicles and their state (active,
 * inactive, merged into); a make opens its models. catalog.manage: Neu, Bearbeiten, Deaktivieren, Zusammenführen, Löschen.
 */
interface MakeRow extends CatalogEntry {
    country: string | null;
    is_popular: boolean;
    sort: number;
    active: boolean;
    models: number;
    vehicles: number;
}

const props = defineProps<{ rows: Paginated<MakeRow>; query: TableQuery; views: SavedView[]; counts?: { makes: number; requests: number } }>();

const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage'));
const counts = computed(() => (state.value === 'empty' ? { makes: 0, requests: 0 } : (props.counts ?? null)));

const columns = computed<TableColumn[]>(() => [
    { key: 'name', label: trans('catalog.columns.make'), sort: 'name', grow: true, min: 200, hideable: false },
    { key: 'country', label: trans('catalog.columns.country'), sort: 'country' },
    // DQ-593: as wide as the "Beliebt" badge while loading too.
    { key: 'is_popular', label: trans('catalog.columns.popular'), min: 64 },
    { key: 'models', label: trans('catalog.columns.models'), sort: 'models', numeric: true },
    { key: 'vehicles', label: trans('catalog.columns.vehicles'), sort: 'vehicles', numeric: true },
    { key: 'sort', label: trans('catalog.columns.sort'), sort: 'sort', numeric: true, defaultHidden: true },
    { key: 'status', label: trans('catalog.columns.status'), min: 120 },
    ...(manage.value ? [{ key: 'actions', label: trans('catalog.columns.actions'), srOnlyLabel: true, hideable: false } satisfies TableColumn] : []),
]);

const presets: PresetView[] = [
    { key: 'popular', name: 'catalog.presets.popular', query: { filter: { popular: '1' }, sort: 'sort' } },
    { key: 'inactive', name: 'catalog.presets.inactive', query: { filter: { status: 'inactive' } } },
    { key: 'merged', name: 'catalog.presets.merged', query: { filter: { status: 'merged' } } },
];

const filters = reactive({ q: '', status: '', popular: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', status: filter.status ?? '', popular: filter.popular ?? '' }),
    { immediate: true },
);
const ANY = '*';
const statusModel = computed({ get: () => filters.status || undefined, set: (v: string | undefined) => (filters.status = v === undefined || v === ANY ? '' : v) });
const statusOptions = computed(() => [
    { value: ANY, label: trans('catalog.filters.status_default') },
    ...(['active', 'inactive', 'merged'] as const).map((value) => ({ value, label: trans(`catalog.status.${value}`) })),
]);
const popularModel = computed({ get: () => filters.popular || undefined, set: (v: string | undefined) => (filters.popular = v === undefined || v === ANY ? '' : v) });
const popularOptions = computed(() => [
    { value: ANY, label: trans('catalog.filters.any') },
    { value: '1', label: trans('catalog.filters.popular_yes') },
    { value: '0', label: trans('catalog.filters.popular_no') },
]);

const dialogs = useEntryDialogs();
const dialog = qaDialog();
// QA overlays (?dialog=): the first make of the page in each dialog, the new-make drawer.
const first = props.rows.data.find((row) => row.merged_into === null) ?? null;
if (dialog === 'new') dialogs.show('create');
else if (first !== null && (dialog === 'edit' || dialog === 'active' || dialog === 'merge' || dialog === 'delete')) dialogs.show(dialog, first);
</script>

<template>
    <Head :title="trans('catalog.vehicles.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-14" :data-qa-state="state">
        <VehicleCatalogHeader tab="makes" :counts="counts" @create="dialogs.show('create')" />

        <DataTable
            :id="'catalog-makes'"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'counts']"
            :caption="trans('catalog.makes.caption')"
            :empty-title="trans('catalog.makes.empty_title')"
            :empty-body="trans('catalog.makes.empty_body')"
            :row-href="(row: MakeRow) => makeHref(row.id)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-14.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('catalog.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0">
                        <Field :label="trans('catalog.filters.q')"><Input v-model="filters.q" size="sm" maxlength="100" :placeholder="trans('catalog.filters.q_make')" data-testid="ADM-14.filter.q" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('catalog.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('catalog.filters.status_default')" data-testid="ADM-14.filter.status" /></Field>
                    </div>
                    <div class="min-w-140 grow basis-0">
                        <Field :label="trans('catalog.filters.popular')"><Select v-model="popularModel" :options="popularOptions" size="sm" :placeholder="trans('catalog.filters.any')" data-testid="ADM-14.filter.popular" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-14.filter.apply">{{ trans('catalog.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-name="{ row }">
                <NameCell :name="row.name" :caption="row.slug" :href="makeHref(row.id)" test-id="ADM-14.open" />
            </template>
            <template #cell-country="{ row }">
                <span class="text-ink-2">{{ row.country ?? '–' }}</span>
            </template>
            <template #cell-is_popular="{ row }">
                <Badge v-if="row.is_popular" tone="neutral">{{ trans('catalog.makes.popular') }}</Badge>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-models="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.models) }}</span>
            </template>
            <template #cell-vehicles="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.vehicles) }}</span>
            </template>
            <template #cell-sort="{ row }">
                <span class="block text-right text-ink-2 tabular-nums">{{ row.sort }}</span>
            </template>
            <template #cell-status="{ row }">
                <span class="flex min-w-0 items-center gap-8">
                    <StatusPill v-bind="entryPill(row)" />
                    <MergedLink v-if="row.merged_into" :name="row.merged_into.name" :href="makeHref(row.merged_into.id)" />
                </span>
            </template>
            <template #cell-actions="{ row }">
                <EntryMenu level="make" :entry="row" :dialogs="dialogs" test-id="ADM-14.row" />
            </template>
        </DataTable>

        <EntryDialogs :dialogs="dialogs" level="make" test-id="ADM-14" />
    </div>
</template>
