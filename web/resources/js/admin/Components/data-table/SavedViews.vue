<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhBookmarkSimple, PhTrash, PhUsersThree } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Checkbox from '../ui/Checkbox.vue';
import Dialog from '../ui/Dialog.vue';
import DropdownMenu, { type MenuEntry } from '../ui/DropdownMenu.vue';
import Field from '../ui/Field.vue';
import IconButton from '../ui/IconButton.vue';
import Input from '../ui/Input.vue';
import { qaDialog } from '../../composables/qaDialog';
import { routeOr } from '../../lib/routes';
import type { PresetView, SavedView, TableQuery } from '../../types/table';

/**
 * Preset views (page code), the staff member's own views and the views colleagues shared with their role (admin_saved_views, 09 §10.2
 * "personal + shared"). Only the author changes or deletes a view; a shared one is marked with its role.
 */
const props = defineProps<{ table: string; views: SavedView[]; presets: PresetView[]; query: TableQuery; testId: string }>();
const emit = defineEmits<{ apply: [query: Partial<TableQuery>] }>();

const page = usePage();
const role = computed(() => page.props.staff?.roles[0] ?? null);
const roleLabel = (key: string | null): string => {
    if (key === null) return '';
    const label = trans(`team.roles_names.${key}`);
    return label === `team.roles_names.${key}` ? key : label;
};
const mine = computed(() => props.views.filter((view) => view.mine !== false));
const shared = computed(() => props.views.filter((view) => view.mine === false));

// QA cell `?dialog=views` (non-production): the manage dialog with its share option.
const manageOpen = ref(qaDialog() === 'views');
const share = ref(false);
const name = ref('');
const saving = ref(false);
const deleting = ref<string | null>(null);
const error = ref<string | null>(null);

const entries = computed<MenuEntry[]>(() => [
    ...props.presets.map((preset) => ({
        key: `preset-${preset.key}`,
        label: trans(preset.name),
        onSelect: () => emit('apply', preset.query),
        testId: `${props.testId}.preset.${preset.key}`,
    })),
    ...mine.value.map((view, index) => ({
        key: `view-${view.id}`,
        label: view.name,
        caption: view.shared_role ? trans('ui.table.views.shared_badge', { role: roleLabel(view.shared_role) }) : undefined,
        onSelect: () => emit('apply', view.query),
        separated: index === 0 && props.presets.length > 0,
        testId: `${props.testId}.view`,
    })),
    ...shared.value.map((view, index) => ({
        key: `shared-${view.id}`,
        label: view.name,
        caption: trans('ui.table.views.shared_by', { name: view.author ?? '–' }),
        icon: PhUsersThree,
        onSelect: () => emit('apply', view.query),
        separated: index === 0 && props.presets.length + mine.value.length > 0,
        testId: `${props.testId}.shared`,
    })),
    {
        key: 'manage',
        label: trans('ui.table.views.manage'),
        onSelect: () => {
            name.value = '';
            error.value = null;
            manageOpen.value = true;
        },
        separated: props.presets.length + props.views.length > 0,
        testId: `${props.testId}.manage`,
    },
]);

function save(): void {
    if (name.value.trim().length < 2) {
        error.value = trans('ui.table.views.name_short');
        return;
    }
    router.post(
        routeOr('admin.saved-views.store', '/admin/saved-views'),
        { table: props.table, name: name.value.trim(), shared: share.value && role.value !== null, query: { filter: props.query.filter, sort: props.query.sort, per_page: props.query.per_page } },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (saving.value = true),
            onFinish: () => (saving.value = false),
            onSuccess: () => {
                name.value = '';
                share.value = false;
                error.value = null;
            },
            onError: (errors) => {
                error.value = errors.name ?? errors.query ?? trans('ui.state.error_title');
            },
        },
    );
}

function remove(view: SavedView): void {
    router.delete(routeOr('admin.saved-views.destroy', `/admin/saved-views/${view.id}`, { view: view.id }), {
        preserveScroll: true,
        preserveState: true,
        onStart: () => (deleting.value = view.id),
        onFinish: () => (deleting.value = null),
    });
}
</script>

<template>
    <DropdownMenu :items="entries" :label="trans('ui.table.views.label')">
        <template #trigger>
            <Button size="sm" variant="secondary" :icon="PhBookmarkSimple" :data-testid="testId">{{ trans('ui.table.views.label') }}</Button>
        </template>
    </DropdownMenu>

    <Dialog v-model:open="manageOpen" :title="trans('ui.table.views.manage')" :description="trans('ui.table.views.manage_body')" size="sm" :test-id="`${testId}.dialog`">
        <form class="flex flex-col gap-8" novalidate @submit.prevent="save">
            <div class="flex items-end gap-8">
                <div class="flex-1">
                    <Field :label="trans('ui.table.views.name')" :error="error">
                        <Input v-model="name" maxlength="80" autocomplete="off" :data-testid="`${testId}.name`" />
                    </Field>
                </div>
                <Button type="submit" variant="primary" :loading="saving" :data-testid="`${testId}.save`">{{ trans('ui.table.views.save') }}</Button>
            </div>
            <div v-if="role" class="flex flex-col gap-2">
                <Checkbox v-model="share" :label="trans('ui.table.views.share')" :data-testid="`${testId}.share`" />
                <p class="text-caption text-ink-3">{{ trans('ui.table.views.share_hint', { role: roleLabel(role) }) }}</p>
            </div>
        </form>
        <h3 class="mt-16 text-caption text-ink-3">{{ trans('ui.table.views.mine_group') }}</h3>
        <ul v-if="mine.length > 0" class="mt-4 flex flex-col border-t border-line-subtle">
            <li v-for="view in mine" :key="view.id" class="flex h-40 items-center gap-8 border-b border-line-subtle">
                <span class="flex-1 truncate text-admin-base text-ink">{{ view.name }}</span>
                <Badge v-if="view.shared_role" tone="neutral">{{ trans('ui.table.views.shared_badge', { role: roleLabel(view.shared_role) }) }}</Badge>
                <IconButton :icon="PhTrash" :label="trans('ui.table.views.delete', { name: view.name })" variant="danger" :loading="deleting === view.id" @click="remove(view)" />
            </li>
        </ul>
        <p v-else class="mt-4 text-admin-base text-ink-3">{{ trans('ui.table.views.none') }}</p>
        <template v-if="role">
            <h3 class="mt-16 text-caption text-ink-3">{{ trans('ui.table.views.shared_group') }}</h3>
            <ul v-if="shared.length > 0" class="mt-4 flex flex-col border-t border-line-subtle" :data-testid="`${testId}.shared-list`">
                <li v-for="view in shared" :key="view.id" class="flex h-40 items-center gap-8 border-b border-line-subtle">
                    <span class="flex-1 truncate text-admin-base text-ink">{{ view.name }}</span>
                    <span class="truncate text-caption text-ink-3">{{ trans('ui.table.views.shared_by', { name: view.author ?? '–' }) }}</span>
                </li>
            </ul>
            <p v-else class="mt-4 text-admin-base text-ink-3">{{ trans('ui.table.views.none_shared') }}</p>
        </template>
    </Dialog>
</template>
