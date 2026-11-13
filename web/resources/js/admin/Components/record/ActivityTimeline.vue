<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import Skeleton from '../ui/Skeleton.vue';
import { formatDateTime, formatRelative } from '../../lib/format';
import StateBlock from '../patterns/StateBlock.vue';

export interface TimelineEntry {
    id: string | number;
    occurred_at: string;
    /** Already translated: what happened. */
    label: string;
    actor: string | null;
    reason?: string | null;
}

/**
 * Right-hand activity of a record page, from the audit log for that record (03 §14). Newest first. A summary (DQ-560): consecutive
 * entries with the same label and actor collapse into one with "3×" (no reason of their own), at most 8 groups show, the rest behind
 * "N weitere anzeigen"; `moreHref` links the full audit log.
 */
const props = withDefaults(defineProps<{ entries: TimelineEntry[]; state?: 'ready' | 'loading' | 'error'; title?: string; moreHref?: string; testId?: string }>(), {
    state: 'ready',
    title: undefined,
    moreHref: undefined,
    testId: undefined,
});
const emit = defineEmits<{ retry: [] }>();

const LIMIT = 8;
interface Group extends TimelineEntry {
    count: number;
}
const groups = computed<Group[]>(() => {
    const out: Group[] = [];
    for (const entry of props.entries) {
        const last = out[out.length - 1];
        if (last && last.label === entry.label && last.actor === entry.actor && !last.reason && !entry.reason) last.count += 1;
        else out.push({ ...entry, count: 1 });
    }
    return out;
});
const expanded = ref(false);
const visible = computed(() => (expanded.value ? groups.value : groups.value.slice(0, LIMIT)));
const hidden = computed(() => groups.value.length - visible.value.length);
</script>

<template>
    <section class="flex flex-col gap-12" :aria-label="title ?? trans('ui.timeline.title')" :data-testid="testId">
        <h2 class="text-admin-base-strong text-ink">{{ title ?? trans('ui.timeline.title') }}</h2>
        <ol v-if="state === 'loading'" class="flex flex-col gap-16">
            <!-- The lines of a ready entry: time, what happened, who (DQ-533). -->
            <li v-for="n in 4" :key="n" class="flex flex-col gap-2 border-l border-line-subtle pl-12">
                <span class="flex h-16 items-center"><Skeleton shape="text" class="w-80" /></span>
                <span class="flex h-20 items-center"><Skeleton shape="text" class="w-160" /></span>
                <span class="flex h-18 items-center"><Skeleton shape="text" class="w-96" /></span>
            </li>
        </ol>
        <StateBlock v-else-if="state === 'error'" kind="error" :title="trans('ui.timeline.error')" @retry="emit('retry')" />
        <p v-else-if="entries.length === 0" class="text-admin-base text-ink-3">{{ trans('ui.timeline.empty') }}</p>
        <ol v-else class="flex flex-col gap-16">
            <li v-for="entry in visible" :key="entry.id" class="flex flex-col gap-2 border-l border-line pl-12">
                <time :datetime="entry.occurred_at" :title="formatDateTime(entry.occurred_at)" class="text-caption text-ink-3">{{ formatRelative(entry.occurred_at) }}</time>
                <p class="text-admin-base text-ink">
                    {{ entry.label }}<span v-if="entry.count > 1" class="text-ink-3 tabular-nums"> · {{ trans('ui.timeline.times', { count: String(entry.count) }) }}</span>
                </p>
                <p class="text-admin-base text-ink-2">{{ entry.actor ?? trans('ui.timeline.system') }}</p>
                <p v-if="entry.reason" class="text-admin-base text-ink-3">{{ entry.reason }}</p>
            </li>
        </ol>
        <button
            v-if="state === 'ready' && hidden > 0"
            type="button"
            class="inline-flex h-32 items-center self-start rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            :data-testid="testId ? `${testId}.expand` : undefined"
            @click="expanded = true"
        >
            {{ trans('ui.timeline.show_more', { count: String(hidden) }) }}
        </button>
        <a v-if="moreHref && state === 'ready' && entries.length > 0" :href="moreHref" class="inline-flex h-32 items-center self-start rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{{ trans('ui.timeline.more') }}</a>
    </section>
</template>
