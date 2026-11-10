<script setup lang="ts">
import { PhArrowsMerge, PhDotsThree, PhPencilSimple, PhPower, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { Button, DropdownMenu, type MenuEntry } from '../../../Components/ui';
import type { CatalogEntry, CatalogLevel, EntryDialogsController } from '../shared';

/**
 * Header actions of a make or model page (catalog.manage, DQ-530): Bearbeiten as a secondary button, the rest in "Weitere Aktionen"
 * with Löschen last in red text; the page's own primary action (add a model or generation) sits next to it.
 */
const props = defineProps<{ level: CatalogLevel; entry: CatalogEntry; dialogs: EntryDialogsController; testId: string }>();

const more = computed<MenuEntry[]>(() => [
    { key: 'active', label: trans(props.entry.active === false ? 'catalog.actions.activate' : 'catalog.actions.deactivate'), icon: PhPower, onSelect: () => props.dialogs.show('active', props.entry), testId: `${props.testId}.active` },
    { key: 'merge', label: trans('catalog.actions.merge'), icon: PhArrowsMerge, onSelect: () => props.dialogs.show('merge', props.entry), testId: `${props.testId}.merge` },
    { key: 'delete', label: trans('catalog.actions.delete'), icon: PhTrash, danger: true, separated: true, onSelect: () => props.dialogs.show('delete', props.entry), testId: `${props.testId}.delete` },
]);
</script>

<template>
    <Button size="sm" variant="secondary" :icon="PhPencilSimple" :data-testid="`${testId}.edit`" @click="dialogs.show('edit', entry)">{{ trans('catalog.actions.edit') }}</Button>
    <DropdownMenu :items="more" :label="trans('catalog.actions.more')">
        <template #trigger>
            <Button size="sm" variant="secondary" :icon="PhDotsThree" :data-testid="`${testId}.more`">{{ trans('catalog.actions.more') }}</Button>
        </template>
    </DropdownMenu>
</template>
