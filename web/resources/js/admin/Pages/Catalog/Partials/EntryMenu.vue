<script setup lang="ts">
import { PhArrowsMerge, PhDotsThree, PhPencilSimple, PhPower, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { DropdownMenu, IconButton, type MenuEntry } from '../../../Components/ui';
import type { CatalogEntry, CatalogLevel, EntryDialogsController } from '../shared';

/**
 * The row actions of a catalogue entry (catalog.manage): Bearbeiten, Deaktivieren/Aktivieren (not for brands), Zusammenführen, Löschen
 * (last, red text, after a separator: DQ-530). A merged row is an alias and has no actions.
 */
const props = defineProps<{ level: CatalogLevel; entry: CatalogEntry; dialogs: EntryDialogsController; testId: string }>();

const items = computed<MenuEntry[]>(() => {
    const e = props.entry;
    return [
        { key: 'edit', label: trans('catalog.actions.edit'), icon: PhPencilSimple, onSelect: () => props.dialogs.show('edit', e), testId: `${props.testId}.edit` },
        ...(props.level === 'brand'
            ? []
            : [{ key: 'active', label: trans(e.active === false ? 'catalog.actions.activate' : 'catalog.actions.deactivate'), icon: PhPower, onSelect: () => props.dialogs.show('active', e), testId: `${props.testId}.active` }]),
        { key: 'merge', label: trans('catalog.actions.merge'), icon: PhArrowsMerge, onSelect: () => props.dialogs.show('merge', e), testId: `${props.testId}.merge` },
        { key: 'delete', label: trans('catalog.actions.delete'), icon: PhTrash, danger: true, separated: true, onSelect: () => props.dialogs.show('delete', e), testId: `${props.testId}.delete` },
    ];
});
</script>

<template>
    <DropdownMenu v-if="entry.merged_into === null" :items="items">
        <template #trigger>
            <IconButton :icon="PhDotsThree" :label="trans('catalog.actions.menu', { name: entry.name })" size="sm" :tooltip="false" :data-testid="`${testId}.menu`" />
        </template>
    </DropdownMenu>
</template>
