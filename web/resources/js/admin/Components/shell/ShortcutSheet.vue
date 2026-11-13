<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Dialog from '../ui/Dialog.vue';
import Kbd from '../ui/Kbd.vue';
import type { GoTarget } from '../../composables/shortcuts';

/** The `?` cheat sheet (09 §10.2): every shortcut of the shell, the lists and the queues; "g" targets only where this staff member may go. */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ targets: GoTarget[]; palette: string }>();

const groups = computed(() => [
    {
        key: 'go',
        title: trans('shell.shortcuts.go'),
        rows: [
            ...props.targets.map((t) => ({ keys: ['g', t.key], label: trans(t.label) })),
            { keys: [props.palette], label: trans('shell.shortcuts.palette') },
            { keys: ['?'], label: trans('shell.shortcuts.sheet') },
        ],
    },
    {
        key: 'lists',
        title: trans('shell.shortcuts.lists'),
        rows: [
            { keys: ['j', 'k'], label: trans('shell.shortcuts.rows') },
            { keys: ['x'], label: trans('shell.shortcuts.select') },
            { keys: ['e'], label: trans('shell.shortcuts.open') },
            { keys: ['/'], label: trans('shell.shortcuts.filter') },
        ],
    },
    {
        key: 'queues',
        title: trans('shell.shortcuts.queues'),
        rows: [
            { keys: ['a'], label: trans('shell.shortcuts.approve') },
            { keys: ['r'], label: trans('shell.shortcuts.reject') },
            { keys: ['u'], label: trans('shell.shortcuts.undo') },
        ],
    },
]);
</script>

<template>
    <Dialog v-model:open="open" :title="trans('shell.shortcuts.title')" :description="trans('shell.shortcuts.body')" size="md" test-id="shell.shortcuts">
        <div class="grid grid-cols-1 gap-24 tablet:grid-cols-2">
            <section v-for="group in groups" :key="group.key" class="flex flex-col gap-8" :class="group.key === 'go' ? 'tablet:row-span-2' : ''">
                <h3 class="text-caption text-ink-3">{{ group.title }}</h3>
                <dl class="flex flex-col">
                    <div v-for="row in group.rows" :key="row.label" class="flex min-h-32 items-center justify-between gap-12 border-t border-line-subtle first:border-t-0">
                        <dt class="text-admin-base text-ink">{{ row.label }}</dt>
                        <dd class="flex shrink-0 items-center gap-4">
                            <template v-for="(k, index) in row.keys" :key="k">
                                <span v-if="index > 0" class="text-caption text-ink-3">{{ group.key === 'go' && row.keys.length === 2 ? trans('shell.shortcuts.then') : '/' }}</span>
                                <Kbd>{{ k }}</Kbd>
                            </template>
                        </dd>
                    </div>
                </dl>
            </section>
        </div>
    </Dialog>
</template>
