<script setup lang="ts">
import { PhCaretLeft, PhCaretRight } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import IconButton from './IconButton.vue';
import Select from './Select.vue';
import Skeleton from './Skeleton.vue';
import { formatNumber } from '../../lib/format';
import type { PageMeta } from '../../types/table';

defineOptions({ name: 'UiPagination' });

const props = withDefaults(
    defineProps<{
        meta: PageMeta;
        perPageOptions?: number[];
        disabled?: boolean;
        /** While the rows load: the range and the page are skeleton lines, never the counts of the rows shown before (DQ-700). */
        pending?: boolean;
        testId?: string;
    }>(),
    {
        perPageOptions: () => [25, 50, 100],
        disabled: false,
        pending: false,
        testId: undefined,
    },
);
const emit = defineEmits<{ page: [page: number]; 'per-page': [perPage: number] }>();

const perPage = computed({
    get: () => String(props.meta.per_page),
    set: (value: string | undefined) => emit('per-page', Number(value ?? props.meta.per_page)),
});
const options = computed(() => props.perPageOptions.map((n) => ({ value: String(n), label: String(n) })));
</script>

<template>
    <nav class="flex flex-wrap items-center justify-between gap-12 text-supporting text-ink-2" :aria-label="trans('ui.pagination.label')" :data-testid="testId">
        <p class="tabular-nums" aria-live="polite">
            <Skeleton v-if="pending" shape="text" class="w-160" />
            <template v-else>{{ meta.total === 0 ? trans('ui.pagination.none') : trans('ui.pagination.range', { from: formatNumber(meta.from), to: formatNumber(meta.to), total: formatNumber(meta.total) }) }}</template>
        </p>
        <div class="flex flex-wrap items-center gap-8">
            <span class="text-caption text-ink-3">{{ trans('ui.pagination.per_page') }}</span>
            <div class="w-80"><Select v-model="perPage" :options="options" size="sm" :disabled="disabled" :aria-label="trans('ui.pagination.per_page')" /></div>
            <Skeleton v-if="pending" shape="text" class="mx-8 w-80" />
            <span v-else class="px-8 tabular-nums">{{ trans('ui.pagination.page', { page: formatNumber(meta.current_page), last: formatNumber(Math.max(meta.last_page, 1)) }) }}</span>
            <IconButton :icon="PhCaretLeft" :label="trans('ui.pagination.previous')" variant="secondary" :disabled="disabled || meta.current_page <= 1" @click="emit('page', meta.current_page - 1)" />
            <IconButton :icon="PhCaretRight" :label="trans('ui.pagination.next')" variant="secondary" :disabled="disabled || meta.current_page >= meta.last_page" @click="emit('page', meta.current_page + 1)" />
        </div>
    </nav>
</template>
