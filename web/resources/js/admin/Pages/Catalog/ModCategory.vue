<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhArchive, PhArrowCounterClockwise, PhArrowDown, PhArrowUp, PhDotsThree, PhListNumbers, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import DialogError from '../../Components/patterns/DialogError.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import { Badge, Button, ConfirmDialog, Dialog, DropdownMenu, EmptyQueue, Field, IconButton, Skeleton, StatusPill, Textarea, type MenuEntry, type TabItem } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import CategoryDrawer, { type CategoryRow } from './Partials/CategoryDrawer.vue';
import FieldDrawer from './Partials/FieldDrawer.vue';
import FormPreview from './Partials/FormPreview.vue';
import SchemaHistory from './Partials/SchemaHistory.vue';
import { constraintText, fieldLabel, type SchemaField, type SchemaVersion } from './Partials/schema';
import { useCatalogWrite } from './shared';

/**
 * ADM-15 a mod category (06 §3 Catalogue, m3.3 §1/§2): tab Felder (the field schema with type, constraints, required, the read-only
 * Discover flags, how many modifications hold data in each field and its state; catalog.manage: add, edit, order, archive / restore,
 * delete without data), tab Vorschau (the member form as it is now) and tab Versionen (each schema change with who, when, why and the
 * diff). Every field change asks for a reason and writes one version.
 */
const props = defineProps<{ category: CategoryRow; fields: SchemaField[]; versions: SchemaVersion[]; types: string[] }>();

const state = usePageState();
const failed = qaDialogFailed();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage'));
const fieldList = computed(() => (state.value === 'empty' ? [] : props.fields));
const versionList = computed(() => (state.value === 'empty' ? [] : props.versions));

const TABS = ['fields', 'preview', 'history'] as const;
type Tab = (typeof TABS)[number];
const initial = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab');
const tab = ref<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : 'fields');
watch(tab, (value) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value === 'fields') url.searchParams.delete('tab');
    else url.searchParams.set('tab', value);
    window.history.replaceState(window.history.state, '', url);
});
const tabs = computed<TabItem[]>(() => [
    { value: 'fields', label: trans('catalog.category.tabs.fields'), count: fieldList.value.filter((f) => f.archived_at === null).length },
    { value: 'preview', label: trans('catalog.category.tabs.preview') },
    { value: 'history', label: trans('catalog.category.tabs.history'), count: versionList.value.length },
]);

const name = computed(() => props.category.name.de ?? props.category.key);
const crumbs = computed(() => [{ label: trans('shell.groups.catalog') }, { label: trans('catalog.categories.title'), href: routeOr('admin.catalog.categories', '/admin/catalog/mod-categories') }]);
const meta = computed(() =>
    [props.category.name.en, props.category.key, transChoice('catalog.category.mods', props.category.mods, { count: formatNumber(props.category.mods) }), trans('catalog.category.sort', { sort: String(props.category.sort) })]
        .filter(Boolean)
        .join(' · '),
);

// ---- category and field dialogs --------------------------------------------------------------------------------------
const categoryOpen = ref(false);
const fieldOpen = ref(false);
const editingField = ref<SchemaField | null>(null);
function editField(field: SchemaField | null): void {
    editingField.value = field;
    fieldOpen.value = true;
}

const write = useCatalogWrite();
const archiveOpen = ref(false);
const deleteOpen = ref(false);
const target = ref<SchemaField | null>(null);
function askArchive(field: SchemaField): void {
    target.value = field;
    write.reset();
    archiveOpen.value = true;
}
function askDelete(field: SchemaField): void {
    target.value = field;
    write.reset();
    deleteOpen.value = true;
}
function archive(reason: string | null): void {
    const f = target.value;
    if (f === null) return;
    write.run('post', routeOr('admin.catalog.fields.archive', `/admin/catalog/mod-fields/${f.id}/archive`, { field: f.id }), { archived: f.archived_at === null, reason }, { onSuccess: () => (archiveOpen.value = false) });
}
function destroy(reason: string | null): void {
    const f = target.value;
    if (f === null) return;
    write.run('delete', routeOr('admin.catalog.fields.destroy', `/admin/catalog/mod-fields/${f.id}`, { field: f.id }), { reason }, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}

function fieldMenu(field: SchemaField): MenuEntry[] {
    const archived = field.archived_at !== null;
    const hasData = (field.data ?? 0) > 0;
    return [
        { key: 'edit', label: trans('catalog.actions.edit'), icon: PhPencilSimple, onSelect: () => editField(field), testId: 'ADM-15-category.field.edit' },
        { key: 'archive', label: trans(archived ? 'catalog.field.restore' : 'catalog.field.archive'), icon: archived ? PhArrowCounterClockwise : PhArchive, onSelect: () => askArchive(field), testId: 'ADM-15-category.field.archive' },
        {
            key: 'delete',
            label: trans('catalog.actions.delete'),
            caption: hasData ? transChoice('catalog.field.delete_has_data', field.data ?? 0, { count: formatNumber(field.data ?? 0) }) : undefined,
            icon: PhTrash,
            danger: true,
            separated: true,
            disabled: hasData,
            onSelect: () => askDelete(field),
            testId: 'ADM-15-category.field.delete',
        },
    ];
}

// ---- order -------------------------------------------------------------------------------------------------------------
const ordering = ref(false);
const order = ref<SchemaField[]>([]);
const orderReasonOpen = ref(false);
const orderReason = ref('');
const orderReasonError = ref<string | null>(null);
function startOrder(): void {
    order.value = [...props.fields];
    ordering.value = true;
}
function move(index: number, by: -1 | 1): void {
    const next = [...order.value];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + by, 0, item);
    order.value = next;
}
const orderChanged = computed(() => order.value.map((f) => f.id).join(',') !== props.fields.map((f) => f.id).join(','));
function saveOrder(): void {
    const length = orderReason.value.trim().length;
    if (length < 10 || length > 1000) {
        orderReasonError.value = trans('ui.confirm.reason_length');
        return;
    }
    orderReasonError.value = null;
    write.run(
        'post',
        routeOr('admin.catalog.fields.reorder', `/admin/catalog/mod-categories/${props.category.id}/fields/order`, { category: props.category.id }),
        { ids: order.value.map((f) => f.id), reason: orderReason.value.trim() },
        {
            onSuccess: () => {
                orderReasonOpen.value = false;
                ordering.value = false;
            },
        },
    );
}
const rows = computed(() => (ordering.value ? order.value : fieldList.value));

// QA overlays (?dialog=): the first field with data in the editor (key and type locked), a new field, archive, the category drawer.
const dialog = qaDialog();
const withData = props.fields.find((f) => f.type === 'number' && (f.data ?? 0) > 0) ?? props.fields.find((f) => (f.data ?? 0) > 0) ?? props.fields[0] ?? null;
if (dialog === 'field') editField(withData);
else if (dialog === 'new-field') editField(null);
else if (dialog === 'archive' && withData) askArchive(withData);
else if (dialog === 'category') categoryOpen.value = true;
else if (dialog === 'order') {
    startOrder();
    move(0, 1);
    orderReasonOpen.value = true;
}
</script>

<template>
    <Head :title="name" />
    <div :data-qa-state="state" data-testid="ADM-15-category-page">
        <RecordLayout
            v-model:tab="tab"
            :title="name"
            :crumbs="crumbs"
            :status="{ tone: category.active ? 'success' : 'neutral', label: trans(category.active ? 'catalog.status.active' : 'catalog.status.inactive') }"
            :tabs="tabs"
            :tabs-label="trans('catalog.category.tabs.label')"
            :loading="state === 'loading'"
            :loading-actions="2" loading-meta="line"
            aside-hidden
            test-id="ADM-15-category"
        >
            <template #meta>
                <p class="text-admin-base text-ink-2 tabular-nums" data-testid="ADM-15-category.meta">{{ meta }}</p>
            </template>
            <template v-if="manage" #actions>
                <Button size="sm" variant="secondary" :icon="PhPencilSimple" data-testid="ADM-15-category.edit" @click="categoryOpen = true">{{ trans('catalog.category.edit') }}</Button>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-15-category.new-field" @click="editField(null)">{{ trans('catalog.field.new') }}</Button>
            </template>
            <template #loading>
                <div class="flex flex-col rounded-sm border border-line" aria-hidden="true">
                    <div class="flex h-40 items-center gap-16 border-b border-line px-12"><Skeleton shape="text" class="w-120" /><span class="grow" /><Skeleton shape="text" class="w-80" /></div>
                    <div v-for="n in 6" :key="n" class="flex h-40 items-center gap-16 border-b border-line-subtle px-12 last:border-b-0">
                        <Skeleton shape="text" class="w-24" /><Skeleton shape="text" class="w-200" /><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-120" /><span class="grow" /><Skeleton shape="text" class="w-48" /><Skeleton shape="text" class="w-80" />
                    </div>
                </div>
            </template>

            <template #fields>
                <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.category.error')" :body="trans('catalog.error_body')" test-id="ADM-15-category.error" />
                <EmptyQueue v-else-if="rows.length === 0" variant="first" :title="trans('catalog.category.empty_title')" :body="trans('catalog.category.empty_body')" data-testid="ADM-15-category.empty">
                    <Button v-if="manage" size="sm" variant="secondary" :icon="PhPlus" @click="editField(null)">{{ trans('catalog.field.new') }}</Button>
                </EmptyQueue>
                <div v-else class="flex flex-col gap-12">
                    <div v-if="manage" class="flex min-h-32 flex-wrap items-center justify-between gap-8" data-testid="ADM-15-category.toolbar">
                        <p class="text-admin-base text-ink-2">{{ trans(ordering ? 'catalog.order.active' : 'catalog.order.hint') }}</p>
                        <span v-if="ordering" class="flex items-center gap-8">
                            <Button size="sm" variant="ghost" @click="ordering = false">{{ trans('ui.actions.cancel') }}</Button>
                            <Button size="sm" variant="primary" :disabled="!orderChanged" data-testid="ADM-15-category.order-save" @click="orderReasonOpen = true">{{ trans('catalog.order.save') }}</Button>
                        </span>
                        <Button v-else size="sm" variant="secondary" :icon="PhListNumbers" data-testid="ADM-15-category.order" @click="startOrder">{{ trans('catalog.order.start') }}</Button>
                    </div>
                    <ScrollRegion :label="trans('catalog.category.fields_caption', { name })" test-id="ADM-15-category.fields">
                        <table class="w-full text-admin-base">
                            <caption class="sr-only">{{ trans('catalog.category.fields_caption', { name }) }}</caption>
                            <thead>
                                <tr class="h-40 border-b border-line text-left text-admin-base-strong text-ink-2">
                                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.position') }}</th>
                                    <th scope="col" class="px-12">{{ trans('catalog.columns.field') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.type') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.constraints') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.required') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12" :title="trans('catalog.field.discover_body')">{{ trans('catalog.columns.discover') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('catalog.columns.data') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('catalog.columns.status') }}</th>
                                    <th v-if="manage" scope="col" class="w-px px-12"><span class="sr-only">{{ trans('catalog.columns.actions') }}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(f, index) in rows" :key="f.id" class="h-40 border-b border-line-subtle last:border-b-0" :class="f.archived_at ? 'text-ink-3' : ''" data-testid="ADM-15-category.field">
                                    <td class="px-12 text-right text-ink-3 tabular-nums">{{ index + 1 }}</td>
                                    <td class="px-12"><NameCell :name="fieldLabel(f)" :caption="f.key" /></td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ trans(`catalog.field_types.${f.type}`) }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ constraintText(f) }}</td>
                                    <td class="whitespace-nowrap px-12">
                                        <span v-if="f.required" class="text-ink">{{ trans('catalog.field.required_short') }}</span>
                                        <span v-else class="text-ink-3">{{ trans('catalog.field.optional_short') }}</span>
                                    </td>
                                    <td class="whitespace-nowrap px-12">
                                        <span class="flex items-center gap-4">
                                            <Badge v-if="f.searchable" tone="neutral">{{ trans('catalog.field.searchable') }}</Badge>
                                            <Badge v-if="f.facet" tone="neutral">{{ trans('catalog.field.facet') }}</Badge>
                                            <span v-if="!f.searchable && !f.facet" class="text-ink-3">–</span>
                                        </span>
                                    </td>
                                    <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(f.data ?? 0) }}</td>
                                    <td class="px-12"><StatusPill :tone="f.archived_at ? 'neutral' : 'success'" :label="trans(f.archived_at ? 'catalog.field.archived' : 'catalog.field.live')" /></td>
                                    <td v-if="manage" class="px-12">
                                        <span v-if="ordering" class="flex items-center gap-4">
                                            <IconButton :icon="PhArrowUp" :label="trans('catalog.order.up', { label: fieldLabel(f) })" size="xs" :disabled="index === 0" @click="move(index, -1)" />
                                            <IconButton :icon="PhArrowDown" :label="trans('catalog.order.down', { label: fieldLabel(f) })" size="xs" :disabled="index === rows.length - 1" @click="move(index, 1)" />
                                        </span>
                                        <DropdownMenu v-else :items="fieldMenu(f)">
                                            <template #trigger>
                                                <IconButton :icon="PhDotsThree" :label="trans('catalog.actions.menu', { name: fieldLabel(f) })" size="sm" :tooltip="false" data-testid="ADM-15-category.field.menu" />
                                            </template>
                                        </DropdownMenu>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </ScrollRegion>
                </div>
            </template>

            <template #preview>
                <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.category.error')" :body="trans('catalog.error_body')" />
                <FormPreview v-else :fields="fieldList" :category-key="category.key" :category-name="category.name" test-id="ADM-15-category.preview" />
            </template>

            <template #history>
                <StateBlock v-if="state === 'error'" kind="error" :title="trans('catalog.category.error')" :body="trans('catalog.error_body')" />
                <SchemaHistory v-else :versions="versionList" test-id="ADM-15-category.history" />
            </template>
        </RecordLayout>

        <CategoryDrawer v-model:open="categoryOpen" :category="category" test-id="ADM-15-category.drawer" />
        <FieldDrawer v-model:open="fieldOpen" :category-id="category.id" :field="editingField" :types="types" test-id="ADM-15-category.field-drawer" />
        <ConfirmDialog
            v-model:open="archiveOpen"
            :title="trans(target?.archived_at ? 'catalog.field.restore_title' : 'catalog.field.archive_title', { label: target ? fieldLabel(target) : '' })"
            :body="trans(target?.archived_at ? 'catalog.field.restore_body' : 'catalog.field.archive_body', { count: formatNumber(target?.data ?? 0) })"
            :confirm-label="trans(target?.archived_at ? 'catalog.field.restore' : 'catalog.field.archive')"
            tone="neutral"
            reason
            :processing="write.processing.value"
            :error="failed ? trans('ui.state.server_error') : write.error.value"
            test-id="ADM-15-category.archive"
            @confirm="archive"
        />
        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('catalog.field.delete_title', { label: target ? fieldLabel(target) : '' })"
            :body="trans('catalog.field.delete_body')"
            :confirm-label="trans('catalog.actions.delete')"
            typed
            reason
            :processing="write.processing.value"
            :error="failed ? trans('ui.state.server_error') : write.error.value"
            test-id="ADM-15-category.delete"
            @confirm="destroy"
        />
        <Dialog v-model:open="orderReasonOpen" :title="trans('catalog.order.title')" :description="trans('catalog.order.body')" size="sm" :dismissible="!write.processing.value" test-id="ADM-15-category.order-dialog">
            <form id="adm15-order" class="flex flex-col gap-16" novalidate @submit.prevent="saveOrder">
                <ol class="flex flex-col text-admin-base text-ink-2">
                    <li v-for="(f, index) in order" :key="f.id" class="flex min-h-32 items-center gap-8 tabular-nums">
                        <span class="w-24 shrink-0 text-right text-ink-3">{{ index + 1 }}</span>
                        <span class="truncate text-ink">{{ fieldLabel(f) }}</span>
                        <span class="sc-key truncate text-caption text-ink-3">{{ f.key }}</span>
                    </li>
                </ol>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="orderReasonError ?? write.errors.value.reason ?? null" required>
                    <Textarea v-model="orderReason" :rows="2" :maxlength="1000" show-count />
                </Field>
            </form>
            <template #footer>
                <DialogError :message="failed ? trans('ui.state.server_error') : (write.errors.value.refused ?? null)" />
                <Button variant="ghost" :disabled="write.processing.value" data-dialog-cancel @click="orderReasonOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm15-order" variant="primary" :loading="write.processing.value">{{ trans('catalog.order.save') }}</Button>
            </template>
        </Dialog>
    </div>
</template>
