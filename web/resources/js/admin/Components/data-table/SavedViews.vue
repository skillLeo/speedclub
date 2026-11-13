<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { PhBookmarkSimple, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import DropdownMenu, { type MenuEntry } from '../ui/DropdownMenu.vue';
import Field from '../ui/Field.vue';
import IconButton from '../ui/IconButton.vue';
import Input from '../ui/Input.vue';
import { routeOr } from '../../lib/routes';
import type { PresetView, SavedView, TableQuery } from '../../types/table';

/** Preset views (page code) and personal views (admin_saved_views) of one table. */
const props = defineProps<{ table: string; views: SavedView[]; presets: PresetView[]; query: TableQuery; testId: string }>();
const emit = defineEmits<{ apply: [query: Partial<TableQuery>] }>();

const manageOpen = ref(false);
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
    ...props.views.map((view, index) => ({
        key: `view-${view.id}`,
        label: view.name,
        onSelect: () => emit('apply', view.query),
        separated: index === 0 && props.presets.length > 0,
        testId: `${props.testId}.view`,
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
        { table: props.table, name: name.value.trim(), query: { filter: props.query.filter, sort: props.query.sort, per_page: props.query.per_page } },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (saving.value = true),
            onFinish: () => (saving.value = false),
            onSuccess: () => {
                name.value = '';
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
        <form class="flex items-end gap-8" novalidate @submit.prevent="save">
            <div class="flex-1">
                <Field :label="trans('ui.table.views.name')" :error="error">
                    <Input v-model="name" maxlength="80" autocomplete="off" :data-testid="`${testId}.name`" />
                </Field>
            </div>
            <Button type="submit" variant="primary" :loading="saving" :data-testid="`${testId}.save`">{{ trans('ui.table.views.save') }}</Button>
        </form>
        <ul v-if="views.length > 0" class="mt-16 flex flex-col border-t border-line-subtle">
            <li v-for="view in views" :key="view.id" class="flex h-40 items-center gap-8 border-b border-line-subtle">
                <span class="flex-1 truncate text-admin-base text-ink">{{ view.name }}</span>
                <IconButton :icon="PhTrash" :label="trans('ui.table.views.delete', { name: view.name })" variant="danger" :loading="deleting === view.id" @click="remove(view)" />
            </li>
        </ul>
        <p v-else class="mt-16 text-admin-base text-ink-3">{{ trans('ui.table.views.none') }}</p>
    </Dialog>
</template>
