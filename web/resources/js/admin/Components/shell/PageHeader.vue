<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { PhCaretRight } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import Skeleton from '../ui/Skeleton.vue';
import { focusRing } from '../ui/styles';

export interface Crumb {
    label: string;
    href?: string;
}

/**
 * Page header (03 §14): breadcrumb in caption, title in title.m, actions right. Slots: badge (next to the title), meta, actions.
 * `loading`: the title line is a skeleton of the same height (the crumbs and the slots stay), for record pages that load (DQ-533).
 */
withDefaults(defineProps<{ title: string; crumbs?: Crumb[]; description?: string; loading?: boolean; actionsBelow?: boolean }>(), {
    crumbs: () => [],
    description: undefined,
    loading: false,
    actionsBelow: false,
});
</script>

<template>
    <header class="flex flex-wrap items-end justify-between gap-16">
        <div class="flex min-w-0 flex-col gap-4">
            <nav v-if="crumbs.length > 0" :aria-label="trans('shell.breadcrumb')">
                <ol class="flex flex-wrap items-center gap-4 text-caption text-ink-3">
                    <li v-for="(crumb, index) in crumbs" :key="index" class="flex items-center gap-4">
                        <PhCaretRight v-if="index > 0" :size="16" aria-hidden="true" />
                        <Link v-if="crumb.href" :href="crumb.href" :class="[focusRing, '-my-8 inline-flex min-h-32 min-w-32 items-center justify-center rounded-xs hover:text-ink']">{{ crumb.label }}</Link>
                        <span v-else>{{ crumb.label }}</span>
                    </li>
                </ol>
            </nav>
            <div class="flex flex-wrap items-center gap-12">
                <span v-if="loading" class="flex h-28 items-center" aria-hidden="true"><Skeleton class="h-24 w-240" /></span>
                <h1 v-else class="text-title-m text-ink" data-page-title>{{ title }}</h1>
                <slot name="badge" />
            </div>
            <p v-if="description" class="max-w-720 text-supporting text-ink-2">{{ description }}</p>
            <div v-if="$slots.meta" class="mt-4"><slot name="meta" /></div>
            <!-- DQ-555: a record with many actions puts them on their own row, in the skeleton as in the ready header, so nothing jumps. -->
            <div v-if="actionsBelow && $slots.actions" class="mt-8 flex flex-wrap items-center gap-8"><slot name="actions" /></div>
        </div>
        <div v-if="!actionsBelow && $slots.actions" class="flex flex-wrap items-center gap-8"><slot name="actions" /></div>
    </header>
</template>
