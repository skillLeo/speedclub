<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowsDownUp, PhDotsThree, PhEye, PhEyeSlash, PhFunnel, PhImage, PhInfo, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import DataTable from '../../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../../Components/data-table/table';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import PageHeader from '../../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, DropdownMenu, Field, IconButton, Input, Select, StatusPill, toast, type MenuEntry, type SelectOption, type Tone } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { usePageState } from '../../../composables/pageState';
import { qaDialog } from '../../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { usePermissions } from '../../../lib/permissions';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../../types/table';
import { useLeaveGuard } from '../../Content/Partials/configDraft';
import ReorderList from '../Partials/ReorderList.vue';
import { bannersIndexHref, firstMessage, productActionUrl, productCreateHref, productHref, productReorderUrl, productUrl, type BuyState, type Option, type ProductRow, type StoreInfo } from '../shared';

/**
 * ADM-66 Shop-Produkte (10 §3, m5.5-contract §5.1): the catalogue of the app's Shop tab in shop order. Filters Suche (title/slug),
 * Kategorie, Sichtbar, Beispiel, Gelöscht; sorts Reihenfolge (default), Titel, Preis, Geändert. Row actions Anzeigen/Ausblenden (the
 * server refuses an incomplete product with the reason), Bearbeiten, Löschen ⚿ (soft, 30 days to restore) and Wiederherstellen.
 * "Reihenfolge ändern" works on the unfiltered list in shop order with every product on the page (drag or keyboard, then save).
 * The whole page needs shop.manage (route middleware), so there is no view-only variant; the shell shows 403 otherwise.
 */
const props = defineProps<{
    rows: Paginated<ProductRow>;
    query: TableQuery;
    views: SavedView[];
    categories: Option[];
    store: StoreInfo;
    flagOn: boolean;
    canManage: boolean;
}>();

const { can } = usePermissions();
const state = usePageState();
const mayManage = computed(() => props.canManage && can('shop.manage'));
const categoryLabel = (key: string): string => props.categories.find((c) => c.value === key)?.label ?? key;

const columns = computed<TableColumn[]>(() => [
    { key: 'image', label: trans('shop.products.columns.image'), srOnlyLabel: true, hideable: false, skeleton: 'h-32 w-24' },
    { key: 'title', label: trans('shop.products.columns.title'), sort: 'title', grow: true, min: 200, hideable: false },
    { key: 'category', label: trans('shop.products.columns.category') },
    { key: 'price_cents', label: trans('shop.products.columns.price'), sort: 'price_cents', numeric: true },
    { key: 'visible', label: trans('shop.products.columns.visible') },
    { key: 'buy_state', label: trans('shop.products.columns.buy'), min: 120 },
    { key: 'images_count', label: trans('shop.products.columns.images'), numeric: true },
    { key: 'variants_count', label: trans('shop.products.columns.variants'), numeric: true, defaultHidden: true },
    { key: 'sort', label: trans('shop.products.columns.sort'), sort: 'sort', numeric: true, defaultHidden: true },
    { key: 'updated_at', label: trans('shop.products.columns.updated_at'), sort: 'updated_at', min: 96 },
    ...(mayManage.value ? [{ key: 'actions', label: trans('shop.products.columns.actions'), srOnlyLabel: true, hideable: false, skeleton: 'h-24 w-64' } satisfies TableColumn] : []),
]);
const presets: PresetView[] = [
    { key: 'hidden', name: 'shop.products.presets.hidden', query: { filter: { visible: '0' } } },
    { key: 'visible', name: 'shop.products.presets.visible', query: { filter: { visible: '1' } } },
    { key: 'trashed', name: 'shop.products.presets.trashed', query: { filter: { trashed: 'only' }, sort: '-updated_at' } },
];

// ---- filters (contract §5.1: q, category, visible, sample, trashed) -------------------------------------------------------------
const filters = reactive({ q: '', category: '', visible: '', sample: '', trashed: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', category: filter.category ?? '', visible: filter.visible ?? '', sample: filter.sample ?? '', trashed: filter.trashed ?? '' }),
    { immediate: true },
);
// Reka's Select has no empty-string item: "any" stands for no filter.
const ANY = '*';
const pick = (key: 'category' | 'visible' | 'sample' | 'trashed') =>
    computed({ get: () => filters[key] || undefined, set: (value: string | undefined) => (filters[key] = value === undefined || value === ANY ? '' : value) });
const categoryModel = pick('category');
const visibleModel = pick('visible');
const sampleModel = pick('sample');
const trashedModel = pick('trashed');
const any = computed<SelectOption>(() => ({ value: ANY, label: trans('shop.products.filters.any') }));
const categoryOptions = computed<SelectOption[]>(() => [any.value, ...props.categories]);
const visibleOptions = computed<SelectOption[]>(() => [any.value, { value: '1', label: trans('shop.products.visibility.visible') }, { value: '0', label: trans('shop.products.visibility.hidden') }]);
const sampleOptions = computed<SelectOption[]>(() => [any.value, { value: '1', label: trans('shop.products.filters.sample_only') }, { value: '0', label: trans('shop.products.filters.sample_none') }]);
const trashedOptions = computed<SelectOption[]>(() => [{ value: ANY, label: trans('shop.products.filters.trashed_none') }, { value: 'only', label: trans('shop.products.filters.trashed_only') }]);
function applied(): Record<string, string> {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim() !== '').map(([key, value]) => [key, value.trim()]));
}

// ---- labels -------------------------------------------------------------------------------------------------------------
const buyTone: Record<BuyState, Tone> = { external: 'success', designer: 'info', not_configured: 'neutral' };
const buyLabel = (row: ProductRow): string => trans(`shop.products.buy.${row.buy_state}`);

// ---- row actions ------------------------------------------------------------------------------------------------------------
const busy = ref<string | null>(null);
function setVisible(row: ProductRow, visible: boolean): void {
    router.post(
        productActionUrl('visibility', row.id),
        { visible },
        {
            preserveScroll: true,
            preserveState: true,
            only: ['rows', 'flash'],
            onStart: () => (busy.value = row.id),
            onFinish: () => (busy.value = null),
            // 422 on `visible`: "Zum Anzeigen fehlt noch: ein Foto, …" (contract §1) → a toast with the reason and the way to fix it.
            onError: (errors) => toast('error', trans('shop.products.visibility.refused', { title: row.title }), firstMessage(errors) ?? undefined),
        },
    );
}

const action = useAdminAction();
const deleting = ref<ProductRow | null>(null);
const deleteOpen = ref(false);
function askDelete(row: ProductRow): void {
    action.reset();
    deleting.value = row;
    deleteOpen.value = true;
}
function destroy(): void {
    const row = deleting.value;
    if (row === null) return;
    action.run('delete', productUrl('destroy', row.id), {}, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}
function restore(row: ProductRow): void {
    router.post(productActionUrl('restore', row.id), {}, {
        preserveScroll: true,
        preserveState: true,
        onStart: () => (busy.value = row.id),
        onFinish: () => (busy.value = null),
        onError: (errors) => toast('error', trans('shop.products.restore_failed'), firstMessage(errors) ?? undefined),
    });
}
// QA cell: ?dialog=delete opens the delete confirmation for the first live product.
{
    const first = props.rows.data.find((row) => row.deleted_at === null);
    if (qaDialog() === 'delete' && first && mayManage.value) askDelete(first);
}

function menu(row: ProductRow): MenuEntry[] {
    if (row.deleted_at !== null) return [{ key: 'restore', label: trans('shop.products.actions.restore'), icon: PhArrowCounterClockwise, onSelect: () => restore(row), testId: 'ADM-66.restore' }];
    return [
        { key: 'edit', label: trans('shop.products.actions.edit'), icon: PhPencilSimple, href: productHref(row.id), testId: 'ADM-66.edit' },
        { key: 'delete', label: trans('shop.products.actions.delete'), icon: PhTrash, danger: true, separated: true, onSelect: () => askDelete(row), testId: 'ADM-66.delete' },
    ];
}

// ---- reorder (unfiltered, shop order, every product on this page) ----------------------------------------------------------
const reordering = ref(false);
const order = ref<ProductRow[]>([]);
const savingOrder = ref(false);
const orderError = ref<string | null>(null);
const unfiltered = computed(() => Object.keys(props.query.filter).length === 0 && (props.query.sort === null || props.query.sort === 'sort'));
const allOnPage = computed(() => props.rows.meta.total <= props.rows.data.length);
const canReorder = computed(() => mayManage.value && props.rows.meta.total > 1 && unfiltered.value && props.rows.meta.total <= 100);
const reorderHint = computed(() => {
    if (!unfiltered.value) return trans('shop.reorder.needs_unfiltered');
    if (props.rows.meta.total > 100) return trans('shop.reorder.too_many');
    return null;
});
const orderDirty = computed(() => reordering.value && order.value.map((row) => row.id).join() !== props.rows.data.map((row) => row.id).join());
const { guardOpen, leave, setGuard } = useLeaveGuard(orderDirty);

function startReorder(): void {
    orderError.value = null;
    if (allOnPage.value) {
        order.value = [...props.rows.data];
        reordering.value = true;
        return;
    }
    // Every product on one page first (≤ 100), so the order sent is the full set (contract §5: must match the set).
    router.get(window.location.pathname, { per_page: 100 } as never, {
        only: ['rows', 'query', 'views'],
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onSuccess: () => {
            order.value = [...props.rows.data];
            reordering.value = true;
        },
    });
}
function cancelReorder(): void {
    reordering.value = false;
    orderError.value = null;
}
function saveOrder(): void {
    router.post(
        productReorderUrl(),
        { ids: order.value.map((row) => row.id) },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                savingOrder.value = true;
                orderError.value = null;
            },
            onFinish: () => (savingOrder.value = false),
            onSuccess: () => (reordering.value = false),
            onError: (errors) => (orderError.value = firstMessage(errors) ?? trans('ui.state.server_error')),
        },
    );
}
if (qaDialog() === 'reorder' && canReorder.value && allOnPage.value) startReorder();
</script>

<template>
    <Head :title="trans('shop.products.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-66" :data-qa-state="state">
        <PageHeader :title="trans('shop.products.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('shop.products.intro')">
            <template v-if="mayManage" #actions>
                <Button size="sm" variant="ghost" :href="bannersIndexHref()" data-testid="ADM-66.banners">{{ trans('shop.products.to_banners') }}</Button>
                <Button
                    v-if="!reordering && rows.meta.total > 1"
                    size="sm"
                    variant="secondary"
                    :icon="PhArrowsDownUp"
                    :disabled="!canReorder"
                    :title="reorderHint ?? undefined"
                    data-testid="ADM-66.reorder"
                    @click="startReorder"
                >
                    {{ trans('shop.reorder.start') }}
                </Button>
                <Button :href="productCreateHref()" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-66.new">{{ trans('shop.products.new') }}</Button>
            </template>
        </PageHeader>

        <!-- Partial: the shop works, but something outside this page keeps products from the app (flag off, no store address). -->
        <ul v-if="!flagOn || !store.configured" class="flex flex-col gap-8" data-testid="ADM-66.notices">
            <li v-if="!flagOn" class="flex items-start gap-8 text-admin-base text-ink-2" data-testid="ADM-66.flag-off">
                <PhInfo :size="16" class="mt-2 shrink-0 text-info" aria-hidden="true" /><span>{{ trans('shop.notices.flag_off') }}</span>
            </li>
            <li v-if="!store.configured" class="flex items-start gap-8 text-admin-base text-ink-2" data-testid="ADM-66.store-missing">
                <PhInfo :size="16" class="mt-2 shrink-0 text-info" aria-hidden="true" /><span>{{ trans('shop.notices.store_missing') }}</span>
            </li>
        </ul>
        <p v-if="reorderHint && mayManage && rows.meta.total > 1 && !reordering" class="-mt-12 text-caption text-ink-3" data-testid="ADM-66.reorder-hint">{{ reorderHint }}</p>

        <!-- Reorder mode: the list in shop order, nothing else on the page changes until "Reihenfolge speichern". -->
        <section v-if="reordering" class="flex flex-col gap-16" aria-labelledby="adm66-reorder" data-testid="ADM-66.reorder-panel">
            <div class="flex flex-wrap items-start justify-between gap-12">
                <div class="flex flex-col gap-4">
                    <h2 id="adm66-reorder" class="text-headline text-ink">{{ trans('shop.reorder.title') }}</h2>
                    <p class="max-w-720 text-admin-base text-ink-2">{{ trans('shop.reorder.intro') }}</p>
                </div>
                <div class="flex gap-8">
                    <Button size="sm" variant="ghost" :disabled="savingOrder" data-testid="ADM-66.reorder.cancel" @click="cancelReorder">{{ trans('ui.actions.cancel') }}</Button>
                    <Button size="sm" variant="primary" :loading="savingOrder" :disabled="!orderDirty" data-testid="ADM-66.reorder.save" @click="saveOrder">{{ trans('shop.reorder.save') }}</Button>
                </div>
            </div>
            <StateBlock v-if="orderError" kind="error" :title="trans('shop.reorder.failed')" :body="orderError" :retryable="false" test-id="ADM-66.reorder.error" />
            <ReorderList v-model="order" :label="(row) => row.title" :list-label="trans('shop.reorder.list')" :disabled="savingOrder" test-id="ADM-66.reorder.list">
                <template #default="{ item, index }">
                    <span class="flex min-w-0 items-center gap-12">
                        <span class="w-24 shrink-0 text-right text-caption text-ink-3 tabular-nums">{{ formatNumber(index + 1) }}</span>
                        <img v-if="item.image" :src="item.image.url" alt="" width="32" height="40" class="aspect-4/5 h-40 shrink-0 rounded-xs bg-raised object-cover" loading="lazy" />
                        <span v-else class="flex aspect-4/5 h-40 shrink-0 items-center justify-center rounded-xs bg-raised text-ink-3"><PhImage :size="16" aria-hidden="true" /></span>
                        <span class="flex min-w-0 flex-col">
                            <span class="truncate text-admin-base text-ink">{{ item.title }}</span>
                            <span class="truncate text-caption text-ink-3 tabular-nums">{{ categoryLabel(item.category) }} · {{ item.price }}</span>
                        </span>
                        <StatusPill v-if="!item.visible" class="ml-auto shrink-0" :label="trans('shop.products.visibility.hidden')" />
                    </span>
                </template>
            </ReorderList>
        </section>

        <DataTable
            v-else
            id="shop-products"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('shop.products.caption')"
            :empty-title="trans('shop.products.empty_title')"
            :empty-body="trans('shop.products.empty_body')"
            :row-href="(row) => productHref(row.id)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-66.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('shop.products.filters.label')" @submit.prevent="apply(applied())">
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('shop.products.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('shop.products.filters.q_placeholder')" data-testid="ADM-66.filter.q" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('shop.products.filters.category')"><Select v-model="categoryModel" :options="categoryOptions" size="sm" :placeholder="trans('shop.products.filters.any')" data-testid="ADM-66.filter.category" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('shop.products.filters.visible')"><Select v-model="visibleModel" :options="visibleOptions" size="sm" :placeholder="trans('shop.products.filters.any')" data-testid="ADM-66.filter.visible" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('shop.products.filters.sample')"><Select v-model="sampleModel" :options="sampleOptions" size="sm" :placeholder="trans('shop.products.filters.any')" data-testid="ADM-66.filter.sample" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('shop.products.filters.trashed')"><Select v-model="trashedModel" :options="trashedOptions" size="sm" :placeholder="trans('shop.products.filters.trashed_none')" data-testid="ADM-66.filter.trashed" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-66.filter.apply">{{ trans('shop.products.filters.apply') }}</Button>
                </form>
            </template>

            <template #empty>
                <Button v-if="mayManage" size="sm" variant="secondary" :icon="PhPlus" :href="productCreateHref()" data-testid="ADM-66.empty.new">{{ trans('shop.products.new') }}</Button>
            </template>

            <template #cell-image="{ row }">
                <!-- max-w-none: the column is sized to its content (w-px), so the preflight's max-width: 100 % would shrink the photo to 0. -->
                <img v-if="row.image" :src="row.image.url" alt="" width="24" height="30" class="block aspect-4/5 h-32 max-w-none rounded-xs bg-raised object-cover" loading="lazy" />
                <span v-else class="inline-flex aspect-4/5 h-32 items-center justify-center rounded-xs bg-raised text-ink-3" :title="trans('shop.products.no_image')">
                    <PhImage :size="16" :aria-label="trans('shop.products.no_image')" />
                </span>
            </template>
            <template #cell-title="{ row }">
                <span class="flex min-w-0 items-center gap-8">
                    <Link :href="productHref(row.id)" :class="[focusRing, 'flex min-h-32 min-w-0 flex-col justify-center rounded-xs hover:underline']" :title="`${row.title} · ${row.slug}`" data-testid="ADM-66.open">
                        <span class="line-clamp-2 text-admin-base text-ink">{{ row.title }}</span>
                        <span class="sc-key truncate text-caption text-ink-3">{{ row.slug }}</span>
                    </Link>
                    <Badge v-if="row.is_sample" class="shrink-0">{{ trans('shop.sample') }}</Badge>
                </span>
            </template>
            <template #cell-category="{ row }">
                <span class="whitespace-nowrap text-ink-2">{{ categoryLabel(row.category) }}</span>
            </template>
            <template #cell-price_cents="{ row }">
                <span class="block whitespace-nowrap text-right text-ink tabular-nums">{{ row.price }}</span>
            </template>
            <template #cell-visible="{ row }">
                <StatusPill v-if="row.deleted_at" tone="danger" :label="trans('shop.products.visibility.deleted')" />
                <StatusPill v-else :tone="row.visible ? 'success' : 'neutral'" :label="trans(row.visible ? 'shop.products.visibility.visible' : 'shop.products.visibility.hidden')" />
            </template>
            <template #cell-buy_state="{ row }">
                <StatusPill :tone="buyTone[row.buy_state]" :label="buyLabel(row)" />
            </template>
            <template #cell-images_count="{ row }">
                <span class="block text-right tabular-nums" :class="row.images_count === 0 ? 'text-warning' : 'text-ink-2'">{{ formatNumber(row.images_count) }}</span>
            </template>
            <template #cell-variants_count="{ row }">
                <span class="block text-right text-ink-2 tabular-nums">{{ formatNumber(row.variants_count) }}</span>
            </template>
            <template #cell-sort="{ row }">
                <span class="block text-right text-ink-2 tabular-nums">{{ formatNumber(row.sort) }}</span>
            </template>
            <template #cell-updated_at="{ row }">
                <span class="flex min-w-0 flex-col">
                    <time :datetime="row.updated_at ?? undefined" :title="formatDateTime(row.updated_at)" class="truncate text-ink-2 tabular-nums">{{ formatDate(row.updated_at) }}</time>
                    <span v-if="row.updated_by" class="truncate text-caption text-ink-3">{{ row.updated_by }}</span>
                </span>
            </template>
            <template #cell-actions="{ row }">
                <span class="flex items-center justify-end gap-4">
                    <IconButton
                        v-if="row.deleted_at === null"
                        :icon="row.visible ? PhEyeSlash : PhEye"
                        size="sm"
                        :loading="busy === row.id"
                        :label="trans(row.visible ? 'shop.products.actions.hide_named' : 'shop.products.actions.show_named', { title: row.title })"
                        :data-testid="row.visible ? 'ADM-66.hide' : 'ADM-66.show'"
                        @click="setVisible(row, !row.visible)"
                    />
                    <DropdownMenu :items="menu(row)">
                        <template #trigger>
                            <IconButton :icon="PhDotsThree" size="sm" :label="trans('shop.products.actions.menu', { title: row.title })" :tooltip="false" data-testid="ADM-66.menu" />
                        </template>
                    </DropdownMenu>
                </span>
            </template>
        </DataTable>

        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('shop.products.delete.title', { title: deleting?.title ?? '' })"
            :body="trans('shop.products.delete.body')"
            :confirm-label="trans('shop.products.delete.confirm')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-66.delete-dialog"
            @confirm="destroy"
        />
        <ConfirmDialog
            :open="guardOpen"
            :title="trans('shop.reorder.discard_title')"
            :body="trans('shop.reorder.discard_body')"
            :confirm-label="trans('shop.reorder.discard')"
            tone="neutral"
            test-id="ADM-66.discard"
            @update:open="setGuard"
            @confirm="leave"
        />
    </div>
</template>
