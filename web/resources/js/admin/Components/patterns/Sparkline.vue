<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SparkLine' });

/**
 * 14-day trend line of a KpiTile (03 §14). SVG in currentColor; decorative, the tile states the number. A null is a day without a
 * value (no decision that day, before the first snapshot): it is left out, never drawn as a zero; fewer than two values draw the
 * dashed "no trend" line.
 */
const props = withDefaults(defineProps<{ values: (number | null)[]; accent?: boolean }>(), { accent: false });

const W = 112;
const H = 32;
const points = computed(() => {
    const all = props.values;
    const known = all.map((value, index) => ({ value, index })).filter((point): point is { value: number; index: number } => point.value !== null);
    if (known.length < 2) return '';
    const max = Math.max(...known.map((point) => point.value));
    const min = Math.min(...known.map((point) => point.value));
    const span = max - min || 1;
    return known
        .map(({ value, index }) => {
            const x = (index / (all.length - 1)) * W;
            const y = H - 2 - ((value - min) / span) * (H - 4);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
});
</script>

<template>
    <svg :viewBox="`0 0 ${W} ${H}`" class="h-32 w-full" :class="accent ? 'text-accent' : 'text-ink-3'" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <polyline v-if="points" :points="points" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        <line v-else x1="0" :y1="H / 2" :x2="W" :y2="H / 2" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" />
    </svg>
</template>
