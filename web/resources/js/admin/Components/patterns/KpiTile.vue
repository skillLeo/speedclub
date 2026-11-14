<script setup lang="ts">
import { PhArrowDownRight, PhArrowRight, PhArrowUpRight } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Skeleton from '../ui/Skeleton.vue';
import { formatDecimal, formatNumber, formatPercent } from '../../lib/format';
import Sparkline from './Sparkline.vue';

/**
 * KPI tile (03 §14, 09 §10.2): Archivo Condensed number, caption label, period delta, 14-day sparkline. No icon, no gradient.
 * `previous` = value of the previous period of the same length; null hides the delta (e.g. no history yet). `display` replaces the
 * plain number (a duration, a share); a null `value` with `empty` shows that text instead of a zero that reads like a measurement.
 *
 * DQ-1195: the delta is neutral ink with a direction arrow, never green/red as good/bad (red is for destructive and critical only).
 * A count on a small base (previous < 20, or 0) shows the absolute change ("+7"), not "+700 %"; a share shows percentage points.
 */
const props = withDefaults(
    defineProps<{
        label: string;
        value: number | null;
        previous?: number | null;
        series?: (number | null)[];
        period?: string;
        display?: string;
        empty?: string;
        /** How the value is measured: a count, a duration in minutes, a share 0–1. */
        unit?: 'count' | 'minutes' | 'percent';
        loading?: boolean;
        testId?: string;
    }>(),
    { previous: null, series: () => [], period: undefined, display: undefined, empty: undefined, unit: 'count', loading: false, testId: undefined },
);

/** Below this previous value a relative change says more about the base than about the trend. */
const SMALL_BASE = 20;

const delta = computed<{ direction: 'up' | 'down' | 'flat'; text: string } | null>(() => {
    const { value, previous } = props;
    if (value === null || previous === null) return null;
    const diff = value - previous;
    const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    if (props.unit === 'percent') return { direction, text: trans('ui.kpi.points', { value: `${sign}${formatDecimal(Math.abs(diff) * 100)}` }) };
    if (props.unit === 'count' && Math.abs(previous) < SMALL_BASE) return { direction, text: `${sign}${formatNumber(Math.abs(diff))}` };
    if (previous === 0) return null;
    return { direction, text: formatPercent(diff / previous) };
});
const arrow = computed(() => (delta.value?.direction === 'up' ? PhArrowUpRight : delta.value?.direction === 'down' ? PhArrowDownRight : PhArrowRight));
const noData = computed(() => props.value === null && props.empty !== undefined);
</script>

<template>
    <div class="flex min-w-0 flex-col gap-8 bg-surface px-16 py-16" :data-testid="testId">
        <p class="truncate text-caption text-ink-2" :title="label">{{ label }}</p>
        <!-- The loading tile has the ready tile's lines: number, sparkline and, with a `period`, its caption line (DQ-533). -->
        <template v-if="loading">
            <span class="flex h-40 items-center desktop:h-48"><Skeleton class="h-28 w-80" /></span>
            <Skeleton class="h-32 w-full" />
            <span v-if="period" class="flex h-16 items-center"><Skeleton shape="text" class="w-120" /></span>
        </template>
        <template v-else>
            <div class="flex items-baseline gap-8">
                <p v-if="noData" class="font-numeral text-hero-numeral-s text-ink-3 tabular-nums" aria-hidden="true">–</p>
                <p v-else class="font-numeral text-hero-numeral-s text-ink tabular-nums">{{ display ?? formatNumber(value) }}</p>
                <p v-if="delta !== null" class="flex items-center gap-2 text-caption text-ink-2 tabular-nums" :data-delta="delta.direction">
                    <component :is="arrow" :size="16" class="shrink-0 self-center" aria-hidden="true" />
                    <span class="sr-only">{{ trans('ui.kpi.delta') }}{{ trans(`ui.kpi.${delta.direction}`) }} </span>{{ delta.text }}
                </p>
            </div>
            <Sparkline :values="series" />
            <p v-if="noData" class="text-caption text-ink-2" :data-testid="testId ? `${testId}.empty` : undefined">{{ empty }}</p>
            <p v-else-if="period" class="text-caption text-ink-3">{{ period }}</p>
        </template>
    </div>
</template>
