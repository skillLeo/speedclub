<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArchive, PhArrowCounterClockwise, PhArrowsClockwise, PhArrowsDownUp, PhCaretDown, PhCaretRight, PhDotsThree, PhLockSimple, PhPencilSimple, PhPlus, PhTrash, PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, Dialog, DropdownMenu, EmptyQueue, IconButton, Skeleton, StatusPill, type MenuEntry } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute } from '../../lib/routes';
import ReorderList from '../Shop/Partials/ReorderList.vue';
import CategoryDrawer from './Partials/CategoryDrawer.vue';
import { categoryRecordUrl, categoryUrl, queueUrl, type ForumCategoryRow } from './shared';

/**
 * ADM-69 Forum-Kategorien (10 §7.1, m5.8-contract §6): the tree members browse, in their order, with the thread count (admin only, never
 * in the member API). Staff with moderation.rules create, edit, reorder (per level), archive (hidden from members, threads stay
 * reachable) and delete an empty category. The categories per make (synced from the catalogue: "Marken abgleichen") and per Bundesland
 * are generated and read-only here; their groups fold away. Every write is ⚿; a note for the audit log is optional.
 */
const props = defineProps<{ categories: ForumCategoryRow[]; kinds: string[]; canManage: boolean }>();

const { can } = usePermissions();
const mayManage = computed(() => props.canManage && can('moderation.rules'));
const state = usePageState(() => (props.categories.length === 0 ? 'empty' : 'ready'));
const generated = (c: ForumCategoryRow): boolean => c.kind !== 'standard';
const name = (c: ForumCategoryRow): string => c.name_de;
const parents = computed(() => props.categories.filter((c) => !generated(c)).map((c) => ({ id: c.id, name: c.name_de })));
const totalThreads = computed(() => props.categories.reduce((sum, c) => sum + c.threads_count + (c.children ?? []).reduce((s, k) => s + k.threads_count, 0), 0));
const totalCategories = computed(() => props.categories.reduce((sum, c) => sum + 1 + (c.children ?? []).length, 0));

// ---- folding: groups of generated children start folded ------------------------------------------------------------------
const generatedGroup = (c: ForumCategoryRow): boolean => (c.children ?? []).length > 0 && (c.children ?? []).every(generated);
const unfolded = ref<Set<number>>(new Set());
const isOpen = (c: ForumCategoryRow): boolean => !generatedGroup(c) || unfolded.value.has(c.id);
function toggle(c: ForumCategoryRow): void {
    const next = new Set(unfolded.value);
    if (next.has(c.id)) next.delete(c.id);
    else next.add(c.id);
    unfolded.value = next;
}

// ---- drawer -----------------------------------------------------------------------------------------------------------------
const drawerOpen = ref(false);
const editing = ref<ForumCategoryRow | null>(null);
const editingParent = ref<number | null>(null);
function parentOf(c: ForumCategoryRow): number | null {
    return props.categories.find((p) => (p.children ?? []).some((k) => k.id === c.id))?.id ?? null;
}
function openNew(parentId: number | null = null): void {
    editing.value = null;
    editingParent.value = parentId;
    drawerOpen.value = true;
}
function openEdit(c: ForumCategoryRow): void {
    editing.value = c;
    editingParent.value = parentOf(c);
    drawerOpen.value = true;
}

// ---- archive, delete, sync, reorder ---------------------------------------------------------------------------------------
const action = useAdminAction();
const target = ref<ForumCategoryRow | null>(null);
const archiveOpen = ref(false);
const deleteOpen = ref(false);
const syncOpen = ref(false);
function askArchive(c: ForumCategoryRow): void {
    action.reset();
    target.value = c;
    archiveOpen.value = true;
}
function toggleActive(): void {
    const c = target.value;
    if (c === null) return;
    action.run('patch', categoryRecordUrl('update', c.id), { is_active: !c.is_active }, { sensitive: true, onSuccess: () => (archiveOpen.value = false) });
}
const deletable = (c: ForumCategoryRow): boolean => c.threads_count === 0 && (c.children ?? []).length === 0;
function askDelete(c: ForumCategoryRow): void {
    action.reset();
    target.value = c;
    deleteOpen.value = true;
}
function destroy(): void {
    const c = target.value;
    if (c === null) return;
    action.run('delete', categoryRecordUrl('destroy', c.id), {}, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}
function askSync(): void {
    action.reset();
    syncOpen.value = true;
}
function sync(): void {
    action.run('post', categoryUrl('sync'), {}, { sensitive: true, onSuccess: () => (syncOpen.value = false) });
}

const reorderOpen = ref(false);
const reorderParent = ref<ForumCategoryRow | null>(null);
const reorderItems = ref<{ id: string; name: string; caption: string }[]>([]);
const reorderBaseline = ref('');
function askReorder(parent: ForumCategoryRow | null): void {
    action.reset();
    reorderParent.value = parent;
    const level = parent === null ? props.categories : (parent.children ?? []);
    reorderItems.value = level.map((c) => ({ id: String(c.id), name: c.name_de, caption: c.is_active ? c.slug : `${c.slug} · ${trans('forum.categories.archived')}` }));
    reorderBaseline.value = reorderItems.value.map((i) => i.id).join(',');
    reorderOpen.value = true;
}
const reorderDirty = computed(() => reorderItems.value.map((i) => i.id).join(',') !== reorderBaseline.value);
function saveOrder(): void {
    action.run('post', categoryUrl('order'), { ids: reorderItems.value.map((i) => Number(i.id)) }, { sensitive: true, onSuccess: () => (reorderOpen.value = false) });
}

function menu(c: ForumCategoryRow, top: boolean): MenuEntry[] {
    const entries: MenuEntry[] = [];
    if (top && !generatedGroup(c)) entries.push({ key: 'child', label: trans('forum.categories.new_child'), icon: PhPlus, onSelect: () => openNew(c.id), testId: 'ADM-69.row.new-child' });
    if (top && (c.children ?? []).length > 1 && !generatedGroup(c)) entries.push({ key: 'order', label: trans('forum.categories.reorder_children'), icon: PhArrowsDownUp, onSelect: () => askReorder(c), testId: 'ADM-69.row.reorder' });
    entries.push({
        key: 'archive',
        label: trans(c.is_active ? 'forum.categories.archive' : 'forum.categories.restore'),
        icon: c.is_active ? PhArchive : PhArrowCounterClockwise,
        separated: entries.length > 0,
        onSelect: () => askArchive(c),
        testId: 'ADM-69.row.archive',
    });
    entries.push({
        key: 'delete',
        label: trans('forum.categories.delete'),
        caption: deletable(c) ? undefined : trans('forum.categories.delete_blocked'),
        icon: PhTrash,
        danger: true,
        disabled: !deletable(c),
        onSelect: () => askDelete(c),
        testId: 'ADM-69.row.delete',
    });
    return entries;
}

// QA cells: ?dialog=new · edit · reorder · archive · delete · sync.
{
    const dialog = qaDialog();
    const first = props.categories.find((c) => !generated(c));
    const empty = props.categories.flatMap((c) => [c, ...(c.children ?? [])]).find((c) => !generated(c) && deletable(c));
    if (mayManage.value) {
        if (dialog === 'new') openNew();
        else if (dialog === 'edit' && first) openEdit(first);
        else if (dialog === 'reorder') askReorder(null);
        else if (dialog === 'archive' && first) askArchive(first);
        else if (dialog === 'delete' && (empty ?? first)) askDelete((empty ?? first)!);
        else if (dialog === 'sync') askSync();
    }
}
</script>

<template>
    <Head :title="trans('forum.categories.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-69" :data-qa-state="state">
        <PageHeader
            :title="trans('forum.categories.title')"
            :crumbs="[{ label: trans('shell.groups.moderation') }, ...(hasRoute('admin.forum.queue') ? [{ label: trans('forum.title'), href: queueUrl() }] : [])]"
            :description="trans('forum.categories.intro')"
        >
            <template v-if="mayManage && state !== 'loading' && state !== 'error'" #actions>
                <Button size="sm" variant="ghost" :icon="PhArrowsClockwise" data-testid="ADM-69.sync" @click="askSync">{{ trans('forum.categories.sync') }}</Button>
                <Button v-if="categories.length > 1 && state === 'ready'" size="sm" variant="secondary" :icon="PhArrowsDownUp" data-testid="ADM-69.reorder" @click="askReorder(null)">{{ trans('forum.categories.reorder') }}</Button>
                <Button v-if="state === 'ready'" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-69.new" @click="openNew()">{{ trans('forum.categories.new') }}</Button>
            </template>
        </PageHeader>

        <p v-if="!mayManage" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-69.view-only">
            <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('forum.categories.view_only') }}
        </p>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('forum.categories.load_error')" :body="trans('ui.state.error_body')" test-id="ADM-69.error" @retry="router.reload()" />
        <div v-else-if="state === 'loading'" class="flex flex-col overflow-hidden rounded-sm border border-line" aria-busy="true" data-testid="ADM-69.loading">
            <div v-for="n in 8" :key="n" class="flex h-40 items-center gap-16 border-line-subtle px-12" :class="n > 1 ? 'border-t' : ''" aria-hidden="true">
                <Skeleton shape="text" :class="n % 3 === 0 ? 'ml-24 w-200' : 'w-240'" />
                <Skeleton shape="text" class="ml-auto w-80" />
                <Skeleton shape="text" class="w-48" />
                <Skeleton class="h-24 w-80" />
            </div>
        </div>
        <EmptyQueue v-else-if="state === 'empty'" variant="first" :title="trans('forum.categories.empty_title')" :body="trans('forum.categories.empty_body')" data-testid="ADM-69.empty">
            <Button v-if="mayManage" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-69.empty.new" @click="openNew()">{{ trans('forum.categories.new') }}</Button>
        </EmptyQueue>
        <template v-else>
            <p class="text-admin-base text-ink-2 tabular-nums" role="status" data-testid="ADM-69.summary">
                {{ trans('forum.categories.summary', { categories: formatNumber(totalCategories), threads: formatNumber(totalThreads) }) }}
            </p>
            <div :class="[focusRing, 'min-w-0 overflow-x-auto rounded-sm border border-line']" tabindex="0" :aria-label="trans('forum.categories.caption')">
                <table class="w-full border-collapse text-admin-base" data-testid="ADM-69.table">
                    <caption class="sr-only">{{ trans('forum.categories.caption') }}</caption>
                    <thead class="bg-surface text-left text-admin-base-strong text-ink-2">
                        <tr class="h-40 border-b border-line">
                            <th scope="col" class="px-12">{{ trans('forum.categories.columns.name') }}</th>
                            <th scope="col" class="w-160 px-12">{{ trans('forum.categories.columns.kind') }}</th>
                            <th scope="col" class="w-96 px-12 text-right">{{ trans('forum.categories.columns.threads') }}</th>
                            <th scope="col" class="w-120 px-12">{{ trans('forum.categories.columns.status') }}</th>
                            <th scope="col" class="w-160 px-12"><span class="sr-only">{{ trans('forum.categories.columns.actions') }}</span></th>
                        </tr>
                    </thead>
                    <tbody v-for="parent in categories" :key="parent.id" class="border-b border-line last:border-b-0" :data-testid="`ADM-69.group.${parent.slug}`">
                        <tr class="h-40 bg-surface" data-testid="ADM-69.row">
                            <th scope="row" class="px-12 py-4 text-left font-normal">
                                <span class="flex min-w-0 items-center gap-8">
                                    <button
                                        v-if="generatedGroup(parent)"
                                        type="button"
                                        :class="[focusRing, 'inline-flex size-32 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink']"
                                        :aria-expanded="isOpen(parent)"
                                        :aria-label="trans(isOpen(parent) ? 'forum.categories.fold' : 'forum.categories.unfold', { name: name(parent), count: formatNumber((parent.children ?? []).length) })"
                                        data-testid="ADM-69.row.toggle"
                                        @click="toggle(parent)"
                                    >
                                        <component :is="isOpen(parent) ? PhCaretDown : PhCaretRight" :size="16" aria-hidden="true" />
                                    </button>
                                    <span class="flex min-w-0 flex-col">
                                        <span class="break-words text-admin-base-strong text-ink">{{ name(parent) }}</span>
                                        <span class="break-words text-caption text-ink-3">{{ parent.name_en }} · <span class="sc-key">{{ parent.slug }}</span></span>
                                        <span v-if="generatedGroup(parent)" class="text-caption text-ink-3 tabular-nums">{{ trans('forum.categories.generated_children', { count: formatNumber((parent.children ?? []).length) }) }}</span>
                                    </span>
                                </span>
                            </th>
                            <td class="px-12 py-4">
                                <span class="text-ink-2">{{ trans(`forum.categories.kinds.${parent.kind}`) }}</span>
                            </td>
                            <td class="px-12 py-4 text-right text-ink tabular-nums">{{ formatNumber(parent.threads_count) }}</td>
                            <td class="px-12 py-4"><StatusPill :tone="parent.is_active ? 'success' : 'neutral'" :label="trans(parent.is_active ? 'forum.categories.active' : 'forum.categories.archived')" /></td>
                            <td class="px-12 py-4">
                                <span v-if="mayManage && !generated(parent)" class="flex items-center justify-end gap-4">
                                    <Button size="sm" variant="ghost" :icon="PhPencilSimple" :aria-label="trans('forum.categories.edit_named', { name: name(parent) })" data-testid="ADM-69.row.edit" @click="openEdit(parent)">{{ trans('forum.categories.edit') }}</Button>
                                    <DropdownMenu :items="menu(parent, true)" :label="trans('forum.categories.menu', { name: name(parent) })">
                                        <template #trigger>
                                            <IconButton :icon="PhDotsThree" size="sm" :label="trans('forum.categories.menu', { name: name(parent) })" data-testid="ADM-69.row.menu" />
                                        </template>
                                    </DropdownMenu>
                                </span>
                            </td>
                        </tr>
                        <template v-if="isOpen(parent)">
                            <tr v-for="child in parent.children ?? []" :key="child.id" class="h-40 border-t border-line-subtle" data-testid="ADM-69.row.child">
                                <th scope="row" class="py-4 pl-48 pr-12 text-left font-normal">
                                    <span class="flex min-w-0 flex-col">
                                        <span class="break-words text-admin-base text-ink">{{ name(child) }}</span>
                                        <span class="break-words text-caption text-ink-3">
                                            {{ child.name_en }} · <span class="sc-key">{{ child.slug }}</span>
                                            <template v-if="child.make"> · {{ trans('forum.categories.from_make', { make: child.make.name }) }}</template>
                                            <template v-if="child.bundesland"> · {{ child.bundesland }}</template>
                                        </span>
                                    </span>
                                </th>
                                <td class="px-12 py-4">
                                    <span class="flex items-center gap-4 text-ink-2">
                                        <PhLockSimple v-if="generated(child)" :size="16" class="shrink-0 text-ink-3" :aria-label="trans('forum.categories.read_only')" />{{ trans(`forum.categories.kinds.${child.kind}`) }}
                                    </span>
                                </td>
                                <td class="px-12 py-4 text-right text-ink tabular-nums">{{ formatNumber(child.threads_count) }}</td>
                                <td class="px-12 py-4"><StatusPill :tone="child.is_active ? 'success' : 'neutral'" :label="trans(child.is_active ? 'forum.categories.active' : 'forum.categories.archived')" /></td>
                                <td class="px-12 py-4">
                                    <span v-if="mayManage && !generated(child)" class="flex items-center justify-end gap-4">
                                        <Button size="sm" variant="ghost" :icon="PhPencilSimple" :aria-label="trans('forum.categories.edit_named', { name: name(child) })" data-testid="ADM-69.row.edit" @click="openEdit(child)">{{ trans('forum.categories.edit') }}</Button>
                                        <DropdownMenu :items="menu(child, false)" :label="trans('forum.categories.menu', { name: name(child) })">
                                            <template #trigger>
                                                <IconButton :icon="PhDotsThree" size="sm" :label="trans('forum.categories.menu', { name: name(child) })" data-testid="ADM-69.row.menu" />
                                            </template>
                                        </DropdownMenu>
                                    </span>
                                    <span v-else-if="generated(child)" class="block text-right text-caption text-ink-3">{{ trans('forum.categories.read_only') }}</span>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
            <p class="text-caption text-ink-3">{{ trans('forum.categories.generated_note') }}</p>
        </template>

        <CategoryDrawer
            v-model:open="drawerOpen"
            :category="editing"
            :parent-id="editingParent"
            :parents="parents"
            :has-children="(editing?.children ?? []).length > 0"
        />

        <Dialog v-model:open="reorderOpen" :title="reorderParent ? trans('forum.categories.reorder_children_title', { name: reorderParent.name_de }) : trans('forum.categories.reorder_title')" :description="trans('forum.categories.reorder_body')" :dismissible="!action.processing.value" test-id="ADM-69.reorder-dialog">
            <ReorderList v-model="reorderItems" :label="(item) => item.name" :list-label="trans('forum.categories.reorder_list')" :disabled="action.processing.value" test-id="ADM-69.reorder.list">
                <template #default="{ item }">
                    <span class="flex min-w-0 flex-col">
                        <span class="truncate text-admin-base text-ink">{{ item.name }}</span>
                        <span class="sc-key truncate text-caption text-ink-3">{{ item.caption }}</span>
                    </span>
                </template>
            </ReorderList>
            <template #footer>
                <p v-if="action.error.value" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-admin-base text-ink" role="alert">
                    <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ action.error.value }}
                </p>
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="reorderOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" :disabled="!reorderDirty" data-testid="ADM-69.reorder.save" @click="saveOrder">{{ trans('forum.categories.reorder_save') }}</Button>
            </template>
        </Dialog>

        <ConfirmDialog
            v-model:open="archiveOpen"
            :title="trans(target?.is_active ? 'forum.categories.archive_title' : 'forum.categories.restore_title', { name: target?.name_de ?? '' })"
            :body="trans(target?.is_active ? 'forum.categories.archive_body' : 'forum.categories.restore_body')"
            :confirm-label="trans(target?.is_active ? 'forum.categories.archive' : 'forum.categories.restore')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-69.archive-dialog"
            @confirm="toggleActive"
        />
        <ConfirmDialog
            v-model:open="deleteOpen"
            :title="trans('forum.categories.delete_title', { name: target?.name_de ?? '' })"
            :body="trans('forum.categories.delete_body')"
            :confirm-label="trans('forum.categories.delete')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-69.delete-dialog"
            @confirm="destroy"
        />
        <ConfirmDialog
            v-model:open="syncOpen"
            :title="trans('forum.categories.sync_title')"
            :body="trans('forum.categories.sync_body')"
            :confirm-label="trans('forum.categories.sync')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-69.sync-dialog"
            @confirm="sync"
        />
    </div>
</template>
