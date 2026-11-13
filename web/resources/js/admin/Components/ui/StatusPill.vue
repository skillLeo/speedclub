<script setup lang="ts">
import type { Tone } from './Badge.vue';

/** Status of a record in tables and record headers: dot in the tone colour + label in ink. Never colour alone. */
withDefaults(defineProps<{ tone?: Tone; label: string }>(), { tone: 'neutral' });

const dots: Record<Tone, string> = {
    neutral: 'bg-ink-3',
    info: 'bg-info',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    accent: 'bg-accent',
};
</script>

<template>
    <span class="inline-flex h-20 items-center gap-4 whitespace-nowrap rounded-xs border border-line px-8 text-caption text-ink">
        <span class="size-8 shrink-0 rounded-full" :class="dots[tone]" aria-hidden="true" />
        {{ label }}
    </span>
</template>
