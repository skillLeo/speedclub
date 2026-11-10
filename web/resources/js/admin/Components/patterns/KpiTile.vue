<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Skeleton from '../ui/Skeleton.vue';
import { formatNumber, formatPercent } from '../../lib/format';
import Sparkline from './Sparkline.vue';

/**
 * KPI tile (03 §14): display.m number, caption label, delta in status colour, 14-day sparkline. No icon, no gradient.
 * `previous` = value of the previous period of the same length; null hides the delta (e.g. no history yet).
 */
const props = withDefaults(defineProps<{ label: string; value: number | null; previous?: number | null; series?: number[]; period?: string; loading?: boolean; testId?: string }>(), {
    previous: null,
    series: () => [],
    period: undefined,
    loading: false,
    testId: undefined,
});

const delta = computed(() => {
    if (props.value === null || props.previous === null || props.previous === 0) return null;
    return (props.value - props.previous) / props.previous;
});
const deltaTone = computed(() => (delta.value === null || delta.value === 0 ? 'text-ink-3' : delta.value > 0 ? 'text-success' : 'text-danger'));
</script>

<template>
    <div class="flex min-w-0 flex-col gap-8 bg-surface px-16 py-16" :data-testid="testId">
        <p class="truncate text-caption text-ink-2">{{ label }}</p>
        <!-- The loading tile has the ready tile's lines: number, sparkline and, with a `period`, its caption line (DQ-533). -->
        <template v-if="loading">
            <Skeleton class="h-28 w-80" />
            <Skeleton class="h-32 w-full" />
            <span v-if="period" class="flex h-16 items-center"><Skeleton shape="text" class="w-120" /></span>
        </template>
        <template v-else>
            <div class="flex items-baseline gap-8">
                <p class="font-display text-display-m text-ink tabular-nums">{{ formatNumber(value) }}</p>
                <p v-if="delta !== null" class="text-caption tabular-nums" :class="deltaTone">
                    <span class="sr-only">{{ trans('ui.kpi.delta') }}</span>{{ formatPercent(delta) }}
                </p>
            </div>
            <Sparkline :values="series" />
            <p v-if="period" class="text-caption text-ink-3">{{ period }}</p>
        </template>
    </div>
</template>
