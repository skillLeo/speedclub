<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { ConfirmDialog, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { routeOr } from '../../../lib/routes';
import { useCatalogWrite, type CatalogLevel, type EntryDialogsController } from '../shared';
import DeleteDialog from './DeleteDialog.vue';
import EntryDrawer from './EntryDrawer.vue';
import MergeDialog from './MergeDialog.vue';

/**
 * Every entry dialog of a catalogue page in one place: the create/edit drawer, deactivate/activate (reason), merge and delete. The page
 * owns the controller (useEntryDialogs) and opens them from its header and row menus. Test ids: `<testId>.drawer`, `.active`, `.merge`,
 * `.delete`.
 */
const props = withDefaults(
    defineProps<{ dialogs: EntryDialogsController; level: CatalogLevel; parent?: { make_id?: number; model_id?: number }; parentName?: string | null; categories?: SelectOption[]; fromRecord?: boolean; testId: string }>(),
    { parent: () => ({}), parentName: null, categories: () => [], fromRecord: false },
);

const isOpen = (mode: string) =>
    computed({
        get: () => props.dialogs.mode.value === mode,
        set: (value: boolean) => {
            if (!value && props.dialogs.mode.value === mode) props.dialogs.close();
        },
    });
const drawerOpen = computed({
    get: () => props.dialogs.mode.value === 'create' || props.dialogs.mode.value === 'edit',
    set: (value: boolean) => {
        if (!value) props.dialogs.close();
    },
});
const activeOpen = isOpen('active');
const mergeOpen = isOpen('merge');
const deleteOpen = isOpen('delete');

const entry = computed(() => props.dialogs.entry.value);
const deactivating = computed(() => entry.value?.active !== false);
const write = useCatalogWrite();
const failed = qaDialogFailed();

function toggle(reason: string | null): void {
    const e = entry.value;
    if (e === null) return;
    const url = routeOr('admin.catalog.entries.active', `/admin/catalog/entries/${props.level}/${e.id}/active`, { level: props.level, id: e.id });
    write.run('post', url, { active: !deactivating.value, reason }, { onSuccess: () => props.dialogs.close() });
}
</script>

<template>
    <EntryDrawer
        v-model:open="drawerOpen"
        :level="level"
        :entry="dialogs.mode.value === 'edit' ? entry : null"
        :parent="parent"
        :parent-name="parentName"
        :categories="categories"
        :test-id="`${testId}.drawer`"
    />
    <ConfirmDialog
        v-model:open="activeOpen"
        :title="trans(deactivating ? 'catalog.active.deactivate_title' : 'catalog.active.activate_title', { name: entry?.name ?? '' })"
        :body="trans(deactivating ? `catalog.active.deactivate_body.${level}` : 'catalog.active.activate_body')"
        :confirm-label="trans(deactivating ? 'catalog.actions.deactivate' : 'catalog.actions.activate')"
        tone="neutral"
        reason
        :processing="write.processing.value"
        :error="failed ? trans('ui.state.server_error') : write.error.value"
        :test-id="`${testId}.active`"
        @confirm="toggle"
    />
    <MergeDialog v-model:open="mergeOpen" :level="level" :entry="entry" :preset-target="dialogs.presetTarget.value" :test-id="`${testId}.merge`" />
    <DeleteDialog
        v-model:open="deleteOpen"
        :level="level"
        :entry="entry"
        :from-record="fromRecord"
        :test-id="`${testId}.delete`"
        @deactivate="dialogs.show('active', entry)"
        @merge="dialogs.show('merge', entry)"
    />
</template>
