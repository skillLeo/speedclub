<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SparkLine' });

/** 14-day trend line of a KpiTile (03 §14). SVG in currentColor; decorative, the tile states the number. */
const props = withDefaults(defineProps<{ values: number[]; accent?: boolean }>(), { accent: false });

const W = 112;
const H = 32;
const points = computed(() => {
    const values = props.values;
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    return values
        .map((value, index) => {
            const x = (index / (values.length - 1)) * W;
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
