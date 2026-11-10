<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhArrowsMerge, PhDownloadSimple, PhFunnel, PhPlus, PhTextAa } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Drawer, EmptyQueue, Field, Input, Select, StatusPill, type SelectOption } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import EntryDialogs from './Partials/EntryDialogs.vue';
import EntryMenu from './Partials/EntryMenu.vue';
import { entryPill, useEntryDialogs, type CatalogEntry } from './shared';

/**
 * ADM-16 part brands (06 §3 Catalogue, m3.3-contract §2): name, slug, category hint, aliases, usage and the brand a merged one went
 * into. catalog.manage: Neu, Bearbeiten (aliases as chips), Zusammenführen, Löschen when unused, and "Normalisieren": spellings that are
 * equal after folding case, diacritics and punctuation ("Akrapovic" → "Akrapovič"), each a merge into the suggested survivor.
 */
interface BrandRow extends CatalogEntry {
    category_hint: string | null;
    category: string | null;
    aliases: string[];
    usage: number;
}
interface SuggestionBrand {
    id: number;
    name: string;
    slug: string;
    usage: number;
}
interface Suggestion {
    key: string;
    survivor: SuggestionBrand;
    duplicates: SuggestionBrand[];
}

const props = defineProps<{ rows: Paginated<BrandRow>; query: TableQuery; views: SavedView[]; categories: SelectOption[]; suggestions: Suggestion[] }>();

const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage'));
const suggestions = computed(() => (state.value === 'empty' ? [] : props.suggestions));

const columns = computed<TableColumn[]>(() => [
    { key: 'name', label: trans('catalog.columns.brand'), sort: 'name', grow: true, min: 200, hideable: false },
    { key: 'category', label: trans('catalog.columns.category'), min: 120 },
    { key: 'aliases', label: trans('catalog.columns.aliases'), min: 200 },
    { key: 'usage', label: trans('catalog.columns.usage'), sort: 'usage', numeric: true },
    { key: 'status', label: trans('catalog.columns.status'), min: 120 },
    ...(manage.value ? [{ key: 'actions', label: trans('catalog.columns.actions'), srOnlyLabel: true, hideable: false } satisfies TableColumn] : []),
]);
const presets: PresetView[] = [
    { key: 'unused', name: 'catalog.presets.most_used', query: { sort: '-usage' } },
    { key: 'merged', name: 'catalog.presets.merged_brands', query: { filter: { status: 'merged' } } },
];

const filters = reactive({ q: '', category: '', status: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', category: filter.category ?? '', status: filter.status ?? '' }),
    { immediate: true },
);
const ANY = '*';
const categoryModel = computed({ get: () => filters.category || undefined, set: (v: string | undefined) => (filters.category = v === undefined || v === ANY ? '' : v) });
const categoryOptions = computed<SelectOption[]>(() => [{ value: ANY, label: trans('catalog.filters.any') }, ...props.categories]);
const statusModel = computed({ get: () => filters.status || undefined, set: (v: string | undefined) => (filters.status = v === undefined || v === ANY ? '' : v) });
const statusOptions = computed<SelectOption[]>(() => [
    { value: ANY, label: trans('catalog.filters.status_default') },
    { value: 'merged', label: trans('catalog.status.merged') },
]);

const dialogs = useEntryDialogs();
const normaliseOpen = ref(false);
const asEntry = (brand: SuggestionBrand): CatalogEntry => ({ id: brand.id, name: brand.name, slug: brand.slug, merged_into: null, usage: brand.usage });
function mergeSuggestion(duplicate: SuggestionBrand, survivor: SuggestionBrand): void {
    normaliseOpen.value = false;
    dialogs.show('merge', asEntry(duplicate), survivor.id);
}

const exportUrl = routeOr('admin.catalog.export', '/admin/catalog/export/brands.csv', { kind: 'brands' });
const dialog = qaDialog();
// QA overlays: ?brand=<slug> picks the row (DQ-594: a brand with alias chips), else the first one that is not merged.
const wanted = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('brand');
const first = (wanted === null ? undefined : props.rows.data.find((row) => row.slug === wanted && row.merged_into === null)) ?? props.rows.data.find((row) => row.merged_into === null) ?? null;
// The ⌘K entry "Dubletten normalisieren" opens the drawer with ?normalise=1 (in production too); the QA overlays use ?dialog=.
const wantsNormalise = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('normalise') === '1';
if (dialog === 'normalise' || wantsNormalise) normaliseOpen.value = true;
else if (dialog === 'new') dialogs.show('create');
else if (first !== null && (dialog === 'edit' || dialog === 'delete')) dialogs.show(dialog, first);
else if (dialog === 'merge') {
    const s = props.suggestions[0];
    if (s?.duplicates[0]) dialogs.show('merge', asEntry(s.duplicates[0]), s.survivor.id);
}
</script>

<template>
    <Head :title="trans('catalog.brands.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-16" :data-qa-state="state">
        <PageHeader :title="trans('catalog.brands.title')" :crumbs="[{ label: trans('shell.groups.catalog') }]" :description="trans('catalog.brands.intro')">
            <template #actions>
                <Button v-if="can('lists.export')" size="sm" variant="secondary" :icon="PhDownloadSimple" :href="exportUrl" external data-testid="ADM-16.export">{{ trans('catalog.actions.export_brands') }}</Button>
                <Button v-if="manage" size="sm" variant="secondary" :icon="PhTextAa" data-testid="ADM-16.normalise" @click="normaliseOpen = true">
                    {{ trans('catalog.brands.normalise') }}
                    <span class="text-caption text-ink-3 tabular-nums">{{ formatNumber(suggestions.length) }}</span>
                </Button>
                <Button v-if="manage" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-16.new" @click="dialogs.show('create')">{{ trans('catalog.actions.new_brand') }}</Button>
            </template>
        </PageHeader>

        <DataTable
            :id="'catalog-brands'"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'suggestions']"
            :caption="trans('catalog.brands.caption')"
            :empty-title="trans('catalog.brands.empty_title')"
            :empty-body="trans('catalog.brands.empty_body')"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-16.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('catalog.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0">
                        <Field :label="trans('catalog.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('catalog.filters.q_brand')" data-testid="ADM-16.filter.q" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('catalog.filters.category')"><Select v-model="categoryModel" :options="categoryOptions" size="sm" :placeholder="trans('catalog.filters.any')" data-testid="ADM-16.filter.category" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('catalog.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('catalog.filters.status_default')" data-testid="ADM-16.filter.status" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0">{{ trans('catalog.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-name="{ row }">
                <NameCell :name="row.name" :caption="row.slug" />
            </template>
            <template #cell-category="{ row }">
                <span class="whitespace-nowrap text-ink-2">{{ row.category ?? '–' }}</span>
            </template>
            <template #cell-aliases="{ row }">
                <span v-if="row.aliases.length > 0" class="flex min-w-0 items-center gap-4" :title="row.aliases.join(', ')">
                    <Badge v-for="alias in row.aliases.slice(0, 2)" :key="alias" tone="neutral">{{ alias }}</Badge>
                    <span v-if="row.aliases.length > 2" class="whitespace-nowrap text-caption text-ink-3 tabular-nums">{{ trans('catalog.brands.more_aliases', { count: formatNumber(row.aliases.length - 2) }) }}</span>
                </span>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-usage="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.usage) }}</span>
            </template>
            <template #cell-status="{ row }">
                <span class="flex min-w-0 items-center gap-8">
                    <StatusPill v-bind="entryPill({ active: true, merged_into: row.merged_into })" />
                    <span v-if="row.merged_into" class="whitespace-nowrap text-caption text-ink-3">{{ trans('catalog.status.merged_into', { name: row.merged_into.name }) }}</span>
                </span>
            </template>
            <template #cell-actions="{ row }">
                <EntryMenu level="brand" :entry="row" :dialogs="dialogs" test-id="ADM-16.row" />
            </template>
        </DataTable>

        <Drawer v-model:open="normaliseOpen" :title="trans('catalog.normalise.title')" :description="trans('catalog.normalise.body')" size="lg" test-id="ADM-16.normalise-drawer">
            <EmptyQueue v-if="suggestions.length === 0" variant="clear" :title="trans('catalog.normalise.empty_title')" :body="trans('catalog.normalise.empty_body')" data-testid="ADM-16.normalise-empty" />
            <ul v-else class="flex flex-col gap-16" data-testid="ADM-16.suggestions">
                <li v-for="s in suggestions" :key="s.key" class="flex flex-col rounded-sm border border-line">
                    <div class="flex items-center justify-between gap-12 bg-raised px-16 py-12">
                        <span class="flex min-w-0 flex-col">
                            <span class="text-caption text-ink-3">{{ trans('catalog.normalise.survivor') }}</span>
                            <span class="truncate text-label-s text-ink">{{ s.survivor.name }}</span>
                        </span>
                        <span class="whitespace-nowrap text-supporting text-ink-2 tabular-nums">{{ transChoice('catalog.normalise.usage', s.survivor.usage, { count: formatNumber(s.survivor.usage) }) }}</span>
                    </div>
                    <div v-for="d in s.duplicates" :key="d.id" class="flex min-h-48 items-center justify-between gap-12 border-t border-line-subtle px-16 py-8">
                        <span class="flex min-w-0 flex-col">
                            <span class="truncate text-supporting text-ink">{{ d.name }}</span>
                            <span class="text-caption text-ink-3 tabular-nums">{{ transChoice('catalog.normalise.usage', d.usage, { count: formatNumber(d.usage) }) }}</span>
                        </span>
                        <Button v-if="manage" size="sm" variant="secondary" :icon="PhArrowsMerge" :data-testid="`ADM-16.suggestion.${d.id}`" @click="mergeSuggestion(d, s.survivor)">
                            {{ trans('catalog.normalise.merge_into', { name: s.survivor.name }) }}
                        </Button>
                    </div>
                </li>
            </ul>
        </Drawer>

        <EntryDialogs :dialogs="dialogs" level="brand" :categories="categories" test-id="ADM-16" />
    </div>
</template>
