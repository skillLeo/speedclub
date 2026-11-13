<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhFileArrowUp, PhFunnel, PhPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Field, Input, Select, StatusPill, type SelectOption } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import ProductDrawer from './Partials/ProductDrawer.vue';
import { productHref, productPill, type CategoryOption, type ProductRow } from './Partials/products';

/**
 * ADM-57 Teile & Produkte (09 §8.9, §10.3; M4.14 backend): the parts catalogue members link their mods to. Filters: search (name,
 * line, brand), brand, category, status; sorts by name, usage (mods that link the part) and date. catalog.manage adds "Neues Teil"
 * (drawer); each part's record holds edit, archive/restore and merge. The CSV import is ADM-17's with the kind "Teile".
 */
const props = defineProps<{
    rows: Paginated<ProductRow>;
    query: TableQuery;
    views: SavedView[];
    brands: { value: number; label: string }[];
    categories: CategoryOption[];
    canManage: boolean;
    canImport: boolean;
    brandChoices?: { value: number; label: string }[];
}>();

const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => props.canManage && can('catalog.manage'));
const categoryLabel = (key: string): string => props.categories.find((c) => c.key === key)?.label ?? key;

const columns = computed<TableColumn[]>(() => [
    { key: 'name', label: trans('catalog.products.columns.product'), sort: 'name', grow: true, min: 240, hideable: false },
    { key: 'brand', label: trans('catalog.products.columns.brand'), min: 160 },
    { key: 'category', label: trans('catalog.products.columns.category'), min: 160 },
    { key: 'mods', label: trans('catalog.products.columns.mods'), sort: 'modifications_count', numeric: true, min: 96 },
    { key: 'created_at', label: trans('catalog.products.columns.created'), sort: 'created_at', min: 120, defaultHidden: true },
    { key: 'status', label: trans('catalog.products.columns.status'), min: 160 },
]);
const presets: PresetView[] = [
    { key: 'most_used', name: 'catalog.products.presets.most_used', query: { sort: '-modifications_count' } },
    { key: 'newest', name: 'catalog.products.presets.newest', query: { sort: '-created_at' } },
    { key: 'archived', name: 'catalog.products.presets.archived', query: { filter: { status: 'archived' } } },
];

const filters = reactive({ q: '', brand: '', category: '', status: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', brand: filter.brand ?? '', category: filter.category ?? '', status: filter.status ?? '' }),
    { immediate: true },
);
const ANY = '*';
const pick = (key: 'brand' | 'category' | 'status') =>
    computed({ get: () => filters[key] || undefined, set: (v: string | undefined) => (filters[key] = v === undefined || v === ANY ? '' : v) });
const brandModel = pick('brand');
const categoryModel = pick('category');
const statusModel = pick('status');
const any = computed<SelectOption>(() => ({ value: ANY, label: trans('catalog.filters.any') }));
const brandOptions = computed<SelectOption[]>(() => [any.value, ...props.brands.map((b) => ({ value: String(b.value), label: b.label }))]);
const categoryOptions = computed<SelectOption[]>(() => [any.value, ...props.categories.map((c) => ({ value: c.key, label: c.label }))]);
const statusOptions = computed<SelectOption[]>(() => [any.value, { value: 'active', label: trans('catalog.status.active') }, { value: 'archived', label: trans('catalog.products.status.archived') }]);

const drawer = ref(manage.value && qaDialog() === 'new');
const importHref = `${routeOr('admin.catalog.import', '/admin/catalog/import')}?kind=products`;
</script>

<template>
    <Head :title="trans('catalog.products.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-57" :data-qa-state="state">
        <PageHeader :title="trans('catalog.products.title')" :crumbs="[{ label: trans('shell.groups.catalog') }]" :description="trans('catalog.products.intro')">
            <template #actions>
                <Button v-if="canImport && can('catalog.import')" size="sm" variant="secondary" :icon="PhFileArrowUp" :href="importHref" data-testid="ADM-57.import">{{ trans('catalog.products.import') }}</Button>
                <Button v-if="manage" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-57.new" @click="drawer = true">{{ trans('catalog.products.new') }}</Button>
            </template>
        </PageHeader>

        <DataTable
            id="catalog-products"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views']"
            :caption="trans('catalog.products.caption')"
            :empty-title="trans('catalog.products.empty_title')"
            :empty-body="trans(manage ? 'catalog.products.empty_body_manage' : 'catalog.products.empty_body')"
            :row-href="(row) => productHref(row.id)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-57.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('catalog.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0">
                        <Field :label="trans('catalog.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('catalog.products.filters.q')" data-testid="ADM-57.filter.q" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('catalog.products.filters.brand')"><Select v-model="brandModel" :options="brandOptions" size="sm" :placeholder="trans('catalog.filters.any')" data-testid="ADM-57.filter.brand" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('catalog.filters.category')"><Select v-model="categoryModel" :options="categoryOptions" size="sm" :placeholder="trans('catalog.filters.any')" data-testid="ADM-57.filter.category" /></Field>
                    </div>
                    <div class="min-w-140 grow basis-0">
                        <Field :label="trans('catalog.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('catalog.filters.any')" data-testid="ADM-57.filter.status" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-57.filter.apply">{{ trans('catalog.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-name="{ row }">
                <Link :href="productHref(row.id)" :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']" data-testid="ADM-57.open">
                    <span class="truncate text-admin-base text-ink group-hover/name:underline">{{ row.name }}</span>
                    <span v-if="row.line" class="truncate text-caption text-ink-3">{{ row.line }}</span>
                </Link>
            </template>
            <template #cell-brand="{ row }">
                <span class="block truncate text-ink">{{ row.brand.name }}</span>
            </template>
            <template #cell-category="{ row }">
                <span class="block truncate text-ink-2">{{ categoryLabel(row.category) }}</span>
            </template>
            <template #cell-mods="{ row }">
                <span class="block text-right tabular-nums" :class="row.mods > 0 ? 'text-ink' : 'text-ink-3'">{{ formatNumber(row.mods) }}</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
            </template>
            <template #cell-status="{ row }">
                <span class="flex items-center gap-8">
                    <StatusPill v-bind="productPill(row)" />
                    <Badge v-if="row.has_affiliate" tone="neutral">{{ trans('catalog.products.affiliate_short') }}</Badge>
                </span>
            </template>
        </DataTable>

        <ProductDrawer v-if="manage" v-model:open="drawer" :product="null" :categories="categories" :brand-choices="brandChoices" test-id="ADM-57.drawer" />
    </div>
</template>
