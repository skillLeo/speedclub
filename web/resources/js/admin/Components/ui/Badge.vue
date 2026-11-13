<script setup lang="ts">
defineOptions({ name: 'UiBadge' });

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

/** Counts and tags: 4 px radius, badge type, outline in the tone colour (no filled colour blocks). */
withDefaults(defineProps<{ tone?: Tone; tnum?: boolean }>(), { tone: 'neutral', tnum: false });

const tones: Record<Tone, string> = {
    neutral: 'border-line-strong text-ink-2',
    info: 'border-info text-info',
    success: 'border-success text-success',
    warning: 'border-warning text-warning',
    danger: 'border-danger text-danger',
    accent: 'border-accent text-accent',
};
</script>

<template>
    <span class="inline-flex h-20 items-center gap-4 whitespace-nowrap rounded-xs border px-4 text-caption" :class="[tones[tone], tnum ? 'tabular-nums' : '']">
        <slot />
    </span>
</template>
