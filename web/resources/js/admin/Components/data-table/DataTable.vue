<script setup lang="ts" generic="Row extends object">
import { router } from '@inertiajs/vue3';
import { PhArrowDown, PhArrowUp, PhArrowsDownUp, PhArrowsHorizontal, PhCaretDown, PhColumns, PhDownloadSimple, PhFunnelSimpleX, PhMagnifyingGlass } from '@phosphor-icons/vue';
import { columnVisibilityFeature, rowSelectionFeature, tableFeatures, useTable, type ColumnVisibilityState, type RowSelectionState, type Updater } from '@tanstack/vue-table';
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator } from 'reka-ui';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { PhCheck } from '@phosphor-icons/vue';
import Button from '../ui/Button.vue';
import Checkbox from '../ui/Checkbox.vue';
import DropdownMenu, { type MenuEntry } from '../ui/DropdownMenu.vue';
import EmptyQueue from '../ui/EmptyQueue.vue';
import Pagination from '../ui/Pagination.vue';
import Skeleton from '../ui/Skeleton.vue';
import { focusRing, menuItem } from '../ui/styles';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { qaState } from '../../lib/qa';
import { qaDialog } from '../../composables/qaDialog';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import SavedViews from './SavedViews.vue';
import StateBlock from '../patterns/StateBlock.vue';
import { columnMins, headerWidth, isFluid, loadHiddenColumns, saveHiddenColumns, skeletonBar, type BulkAction, type TableColumn } from './table';

/**
 * Server-driven table (03 §14, 06 §5): sort/filter/page through Inertia partial reloads of `only`, 40 px rows, hairline grid,
 * sticky header, column chooser (localStorage per table), saved views, selection + bulk bar, CSV export behind permission,
 * and the states loading / empty / no results / error. Filter controls go in the `filters` slot and call `apply()`.
 */
const props = withDefaults(
    defineProps<{
        /** Table key: localStorage columns and saved views (admin_saved_views.table_key). */
        id: string;
        columns: TableColumn[];
        rows: Paginated<Row>;
        query: TableQuery;
        views?: SavedView[];
        presets?: PresetView[];
        /** Props reloaded on a table visit. */
        only?: string[];
        caption: string;
        rowKey?: string;
        selectable?: boolean;
        bulkActions?: BulkAction[];
        /** Export URL without query; the current filter and sort are appended. Shown only with `exportAtom`. */
        exportUrl?: string;
        exportAtom?: string;
        /** Four-eyes export: emits `export` instead of following the link. */
        exportRequest?: boolean;
        /** Label of the plain CSV export (default "Exportieren"; inside the export menu "CSV, Adressen maskiert"). */
        exportLabel?: string;
        /**
         * More exports of the same list (e.g. a four-eyes PII export, DQ-539): with entries, the export becomes one "Exportieren"
         * menu, the plain CSV first (when `exportAtom` allows it), then these entries (each with its own caption).
         */
        exportEntries?: MenuEntry[];
        /** Row ids selected on mount (the QA overlay cells, `?dialog=`). */
        initialSelection?: string[];
        emptyTitle: string;
        emptyBody?: string;
        /** Row click target (keyboard: the first cell holds the link). */
        rowHref?: (row: Row) => string | null;
        /** Rows emit `open` on click (e.g. to open a drawer). */
        clickableRows?: boolean;
        /** Forces a state (gallery, ?qaState= handled by the page). */
        forceState?: 'loading' | 'error' | 'empty';
        /** A narrow list beside a detail pane (DQ-598): no 960 px minimum, the columns fit the column. */
        narrow?: boolean;
        testId: string;
    }>(),
    {
        views: () => [],
        presets: () => [],
        only: () => ['rows', 'query', 'views'],
        rowKey: 'id',
        selectable: false,
        bulkActions: () => [],
        exportUrl: undefined,
        exportAtom: undefined,
        exportRequest: false,
        exportLabel: undefined,
        exportEntries: () => [],
        initialSelection: () => [],
        emptyBody: undefined,
        rowHref: undefined,
        clickableRows: false,
        forceState: undefined,
        narrow: false,
    },
);

const emit = defineEmits<{ bulk: [action: string, ids: string[]]; export: [query: TableQuery]; open: [row: Row] }>();

defineSlots<
    {
        filters?: (props: { query: TableQuery; apply: (filter: Record<string, string>) => void; loading: boolean }) => unknown;
        actions?: () => unknown;
        empty?: () => unknown;
    } & Record<`cell-${string}`, (props: { row: Row; value: unknown }) => unknown>
>();

const { can } = usePermissions();
const loading = ref(false);
const failed = ref(false);
// With `?dialog=` a forced state is the overlay's, not the table's (qaDialog).
const forced = computed(() => props.forceState ?? (qaDialog() === null ? qaState() : null));

// ---- server visits ------------------------------------------------------------------------------------------------------
function visit(next: Partial<TableQuery> & { page?: number }): void {
    const query = { ...props.query, ...next };
    const params: Record<string, unknown> = {
        filter: Object.keys(query.filter).length > 0 ? query.filter : undefined,
        sort: query.sort ?? undefined,
        per_page: query.per_page !== 25 ? query.per_page : undefined,
        page: next.page !== undefined && next.page > 1 ? next.page : undefined,
    };
    router.get(window.location.pathname, params as never, {
        only: props.only,
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onStart: () => {
            loading.value = true;
            failed.value = false;
        },
        onFinish: () => {
            loading.value = false;
        },
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}

function apply(filter: Record<string, string>): void {
    const clean = Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== '' && value !== undefined));
    visit({ filter: clean, page: 1 });
}

function toggleSort(column: TableColumn): void {
    const key = column.sort ?? column.key;
    const current = props.query.sort;
    const next = current === key ? `-${key}` : current === `-${key}` ? null : key;
    visit({ sort: next, page: 1 });
}

function sortState(column: TableColumn): 'ascending' | 'descending' | 'none' {
    const key = column.sort ?? column.key;
    if (props.query.sort === key) return 'ascending';
    if (props.query.sort === `-${key}`) return 'descending';
    return 'none';
}

function applyView(query: Partial<TableQuery>): void {
    visit({ filter: query.filter ?? {}, sort: query.sort ?? null, per_page: query.per_page ?? 25, page: 1 });
}

const hasFilters = computed(() => Object.keys(props.query.filter).length > 0);

// ---- columns and selection (TanStack) ---------------------------------------------------------------------------------
const features = tableFeatures({ rowSelectionFeature, columnVisibilityFeature });
const initialHidden = loadHiddenColumns(props.id) ?? props.columns.filter((c) => c.defaultHidden).map((c) => c.key);
const columnVisibility = ref<ColumnVisibilityState>(Object.fromEntries(initialHidden.map((key) => [key, false])));
const rowSelection = ref<RowSelectionState>(Object.fromEntries(props.initialSelection.map((id) => [id, true])));
const fluid = computed(() => isFluid(props.columns));

const tableColumns = props.columns.map((column) => ({
    id: column.key,
    accessorFn: (row: Row) => (row as Record<string, unknown>)[column.key],
    header: column.label,
    enableHiding: column.hideable !== false,
}));

const resolve = <T,>(updater: Updater<T>, previous: T): T => (typeof updater === 'function' ? (updater as (old: T) => T)(previous) : updater);

const table = useTable({
    features,
    columns: tableColumns,
    data: computed(() => props.rows.data),
    getRowId: (row: Row) => String((row as Record<string, unknown>)[props.rowKey]),
    enableRowSelection: props.selectable,
    state: computed(() => ({ columnVisibility: columnVisibility.value, rowSelection: rowSelection.value })),
    onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) => {
        columnVisibility.value = resolve(updater, columnVisibility.value);
        saveHiddenColumns(props.id, Object.entries(columnVisibility.value).filter(([, visible]) => !visible).map(([key]) => key));
    },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
        rowSelection.value = resolve(updater, rowSelection.value);
    },
});

const visibleColumns = computed(() => props.columns.filter((c) => columnVisibility.value[c.key] !== false));
const hideableColumns = computed(() => props.columns.filter((c) => c.hideable !== false));
const selectedIds = computed(() => Object.keys(rowSelection.value));
const allSelected = computed<boolean | 'indeterminate'>(() => {
    const count = selectedIds.value.length;
    if (count === 0) return false;
    return count === props.rows.data.length ? true : 'indeterminate';
});

// A new page or filter clears the selection: ids of rows no longer shown must not stay selected.
watch(
    () => props.rows,
    () => {
        rowSelection.value = {};
    },
);

function toggleAll(value: boolean | 'indeterminate'): void {
    table.toggleAllPageRowsSelected(value === true);
}

const availableBulk = computed(() => props.bulkActions.filter((a) => can(a.atom)));

// ---- export -------------------------------------------------------------------------------------------------------------
const exportHref = computed(() => {
    if (props.exportUrl === undefined) return undefined;
    const params = new URLSearchParams();
    Object.entries(props.query.filter).forEach(([key, value]) => params.set(`filter[${key}]`, value));
    if (props.query.sort) params.set('sort', props.query.sort);
    const qs = params.toString();
    return qs === '' ? props.exportUrl : `${props.exportUrl}?${qs}`;
});
const showExport = computed(() => (props.exportUrl !== undefined || props.exportRequest) && props.exportAtom !== undefined && can(props.exportAtom));
const exportMenu = computed<MenuEntry[]>(() => {
    if (props.exportEntries.length === 0) return [];
    const plain: MenuEntry[] = !showExport.value
        ? []
        : [
              {
                  key: 'csv',
                  label: props.exportLabel ?? trans('ui.table.export_csv'),
                  icon: PhDownloadSimple,
                  testId: `${props.testId}.export`,
                  ...(props.exportRequest ? { onSelect: () => emit('export', props.query) } : { href: exportHref.value, external: true }),
              },
          ];
    return [...plain, ...props.exportEntries];
});

// ---- states -------------------------------------------------------------------------------------------------------------
const view = computed<'loading' | 'error' | 'empty' | 'no-results' | 'rows'>(() => {
    if (forced.value === 'loading') return 'loading';
    if (forced.value === 'error' || failed.value) return 'error';
    if (forced.value === 'empty') return 'empty';
    if (props.rows.data.length === 0) return hasFilters.value ? 'no-results' : 'empty';
    return 'rows';
});

const skeletonRows = computed(() => Math.min(props.query.per_page, 10));

function cellValue(row: Row, key: string): unknown {
    return (row as Record<string, unknown>)[key];
}

function display(value: unknown): string {
    if (value === null || value === undefined || value === '') return '–';
    if (typeof value === 'number') return formatNumber(value);
    return typeof value === 'string' ? value : JSON.stringify(value);
}

// ---- horizontal overflow (DQ-553) ---------------------------------------------------------------------------------------
const scroller = ref<HTMLElement | null>(null);
const wider = ref(false);
const atEnd = ref(true);
function measureScroll(): void {
    const el = scroller.value;
    if (!el) return;
    wider.value = el.scrollWidth > el.clientWidth + 1;
    atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
}
useResizeObserver(scroller, measureScroll);
watch([() => props.rows, () => columnVisibility.value], () => void nextTick(measureScroll), { deep: true });

function onRowClick(row: Row, event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('a,button,input,label,[role="checkbox"]')) return;
    const href = props.rowHref?.(row);
    if (href) router.visit(href);
    else if (props.clickableRows) emit('open', row);
}
</script>

<template>
    <section class="flex min-w-0 flex-col gap-12" :data-testid="testId" :data-table-state="view" :aria-busy="loading || view === 'loading'">
        <!-- filters -->
        <div v-if="$slots.filters" class="flex min-w-0 flex-wrap items-end gap-8">
            <slot name="filters" :query="query" :apply="apply" :loading="loading" />
        </div>

        <!-- toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-8">
            <p class="text-supporting text-ink-2 tabular-nums" aria-live="polite" :data-testid="`${testId}.count`">
                <template v-if="view === 'rows'">{{ transChoice('ui.table.count', rows.meta.total, { count: formatNumber(rows.meta.total) }) }}</template>
            </p>
            <div class="flex flex-wrap items-center gap-8">
                <slot name="actions" />
                <SavedViews :table="id" :views="views" :presets="presets" :query="query" :test-id="`${testId}.views`" @apply="applyView" />
                <DropdownMenu :label="trans('ui.table.columns')">
                    <template #trigger>
                        <Button size="sm" variant="secondary" :icon="PhColumns" :data-testid="`${testId}.columns`">{{ trans('ui.table.columns') }}</Button>
                    </template>
                    <DropdownMenuCheckboxItem
                        v-for="column in hideableColumns"
                        :key="column.key"
                        :model-value="columnVisibility[column.key] !== false"
                        :class="[menuItem, 'relative pl-32']"
                        @update:model-value="(v: boolean) => table.getColumn(column.key)?.toggleVisibility(v)"
                        @select="(e: Event) => e.preventDefault()"
                    >
                        <DropdownMenuItemIndicator class="absolute left-8"><PhCheck :size="16" aria-hidden="true" /></DropdownMenuItemIndicator>
                        {{ column.label }}
                    </DropdownMenuCheckboxItem>
                </DropdownMenu>
                <DropdownMenu v-if="exportMenu.length > 0" :items="exportMenu">
                    <template #trigger>
                        <Button size="sm" variant="secondary" :icon="PhDownloadSimple" :icon-right="PhCaretDown" :data-testid="`${testId}.export-menu`">{{ trans('ui.table.export_menu') }}</Button>
                    </template>
                </DropdownMenu>
                <template v-else-if="showExport">
                    <Button v-if="exportRequest" size="sm" variant="secondary" :icon="PhDownloadSimple" :data-testid="`${testId}.export`" @click="emit('export', query)">
                        {{ exportLabel ?? trans('ui.table.export') }}
                    </Button>
                    <Button v-else size="sm" variant="secondary" :icon="PhDownloadSimple" :href="exportHref" external :data-testid="`${testId}.export`">
                        {{ exportLabel ?? trans('ui.table.export') }}
                    </Button>
                </template>
            </div>
        </div>

        <!-- bulk bar -->
        <div
            v-if="selectable && selectedIds.length > 0"
            class="flex flex-wrap items-center gap-12 rounded-sm border border-line bg-raised px-12 py-8"
            role="region"
            :aria-label="trans('ui.table.bulk.region')"
            :data-testid="`${testId}.bulk`"
        >
            <p class="text-label-s text-ink tabular-nums">{{ trans('ui.table.bulk.selected', { count: formatNumber(selectedIds.length) }) }}</p>
            <p v-if="selectedIds.length > 100" class="text-helper text-warning">{{ trans('ui.table.bulk.four_eyes') }}</p>
            <div class="flex flex-1 flex-wrap items-center justify-end gap-8">
                <Button
                    v-for="action in availableBulk"
                    :key="action.key"
                    size="sm"
                    :variant="action.danger ? 'destructive' : 'secondary'"
                    :icon="action.icon"
                    :data-testid="`${testId}.bulk.${action.key}`"
                    @click="emit('bulk', action.key, selectedIds)"
                >
                    {{ action.label }}
                </Button>
                <Button size="sm" variant="ghost" @click="rowSelection = {}">{{ trans('ui.table.bulk.clear') }}</Button>
            </div>
        </div>

        <!-- states -->
        <StateBlock v-if="view === 'error'" kind="error" :title="trans('ui.state.error_title')" :body="trans('ui.state.error_body')" :test-id="`${testId}.error`" @retry="visit({})" />
        <EmptyQueue v-else-if="view === 'empty'" variant="first" :title="emptyTitle" :body="emptyBody" :data-testid="`${testId}.empty`">
            <slot name="empty" />
        </EmptyQueue>
        <EmptyQueue v-else-if="view === 'no-results'" variant="quiet" :icon="PhMagnifyingGlass" :title="trans('ui.table.no_results_title')" :body="trans('ui.table.no_results_body')" :data-testid="`${testId}.no-results`">
            <Button size="sm" variant="secondary" :icon="PhFunnelSimpleX" @click="apply({})">{{ trans('ui.table.reset_filters') }}</Button>
        </EmptyQueue>

        <!-- table -->
        <div v-else class="relative min-w-0">
        <div ref="scroller" class="relative min-w-0 overflow-auto rounded-sm border border-line-subtle bg-surface" :class="loading ? 'opacity-60' : ''" :data-scrollable="wider || undefined" @scroll.passive="measureScroll">
            <div v-if="loading" class="sc-progress absolute inset-x-0 top-0 z-20 h-2 bg-accent" aria-hidden="true" />
            <table class="w-full border-collapse text-supporting" :class="[fluid ? 'table-auto' : 'table-fixed', narrow ? '' : 'min-w-960']">
                <caption class="sr-only">{{ caption }}</caption>
                <thead class="sticky top-0 z-10 bg-surface">
                    <tr class="h-40 border-b border-line">
                        <th v-if="selectable" scope="col" class="w-48 px-12 text-left">
                            <Checkbox
                                :model-value="allSelected"
                                :aria-label="trans('ui.table.select_page')"
                                :disabled="view === 'loading'"
                                @update:model-value="toggleAll"
                            />
                        </th>
                        <th
                            v-for="column in visibleColumns"
                            :key="column.key"
                            scope="col"
                            :aria-sort="column.sort !== undefined ? sortState(column) : undefined"
                            :class="[headerWidth(column, fluid), 'px-12 text-caption whitespace-nowrap text-ink-2', column.numeric || column.align === 'right' ? 'text-right' : 'text-left']"
                        >
                            <span v-if="fluid && column.min !== undefined" :class="['block h-0', columnMins[column.min]]" aria-hidden="true" />
                            <button
                                v-if="column.sort !== undefined"
                                type="button"
                                :class="[focusRing, 'inline-flex h-24 items-center gap-4 rounded-xs hover:text-ink', column.numeric || column.align === 'right' ? 'flex-row-reverse' : '']"
                                :data-testid="`${testId}.sort.${column.key}`"
                                @click="toggleSort(column)"
                            >
                                <span>{{ column.label }}</span>
                                <PhArrowUp v-if="sortState(column) === 'ascending'" :size="16" aria-hidden="true" />
                                <PhArrowDown v-else-if="sortState(column) === 'descending'" :size="16" aria-hidden="true" />
                                <PhArrowsDownUp v-else :size="16" class="text-ink-3" aria-hidden="true" />
                            </button>
                            <span v-else :class="column.srOnlyLabel ? 'sr-only' : ''">{{ column.label }}</span>
                        </th>
                    </tr>
                </thead>
                <tbody v-if="view === 'loading'">
                    <tr v-for="n in skeletonRows" :key="n" class="h-40 border-b border-line-subtle last:border-b-0">
                        <td v-if="selectable" class="px-12"><Skeleton class="size-16" /></td>
                        <td v-for="column in visibleColumns" :key="column.key" class="px-12">
                            <Skeleton :shape="skeletonBar(column).shape" :class="skeletonBar(column).class" />
                        </td>
                    </tr>
                </tbody>
                <tbody v-else>
                    <tr
                        v-for="row in table.getRowModel().rows"
                        :key="row.id"
                        class="h-40 border-b border-line-subtle last:border-b-0 hover:bg-hover"
                        :class="[row.getIsSelected() ? 'bg-selected' : '', rowHref || clickableRows ? 'cursor-pointer' : '']"
                        :data-testid="`${testId}.row`"
                        :data-row-id="row.id"
                        @click="onRowClick(row.original, $event)"
                    >
                        <td v-if="selectable" class="px-12">
                            <Checkbox :model-value="row.getIsSelected()" :aria-label="trans('ui.table.select_row')" @update:model-value="(v) => row.toggleSelected(v === true)" />
                        </td>
                        <td
                            v-for="column in visibleColumns"
                            :key="column.key"
                            :class="[
                                'px-12 align-middle',
                                fluid && !column.grow && !column.wrap ? 'whitespace-nowrap' : 'overflow-hidden',
                                column.numeric || column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                            ]"
                        >
                            <slot :name="`cell-${column.key}`" :row="row.original" :value="cellValue(row.original, column.key)">
                                <span :class="['block text-ink', fluid ? (column.grow || column.wrap ? 'line-clamp-2' : '') : 'truncate']" :title="display(cellValue(row.original, column.key))">{{ display(cellValue(row.original, column.key)) }}</span>
                            </slot>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
            <!-- DQ-553/535: content wider than the frame says so: the right edge fades out while there is more to scroll, and a hint line names it. -->
            <div v-if="wider && !atEnd" class="pointer-events-none absolute inset-y-px right-px w-32 rounded-r-sm" :style="{ background: 'linear-gradient(to left, var(--color-surface), transparent)' }" aria-hidden="true" data-scroll-edge />
        </div>
        <p v-if="view === 'rows' && wider && !atEnd" class="-mt-4 flex items-center gap-4 text-caption text-ink-3" aria-hidden="true" :data-testid="`${testId}.scroll-hint`">
            <PhArrowsHorizontal :size="16" />{{ trans('ui.table.scroll_hint') }}
        </p>

        <Pagination
            v-if="view === 'rows' || view === 'loading'"
            :meta="rows.meta"
            :disabled="loading || view === 'loading'"
            :pending="view === 'loading'"
            :test-id="`${testId}.pagination`"
            @page="(page) => visit({ page })"
            @per-page="(per_page) => visit({ per_page, page: 1 })"
        />
    </section>
</template>
