<script setup lang="ts">
/**
 * Renders its slot in a fixed theme (tokens follow [data-theme] on any element): the gallery shows Carbon and Hell side by side,
 * ADM-34 previews drafts per theme.
 */
defineProps<{ theme: 'carbon' | 'black' | 'light'; label: string }>();
</script>

<template>
    <section :data-theme="theme" class="flex min-w-0 flex-col gap-16 rounded-md border border-line-subtle bg-canvas px-16 py-16 text-ink" :aria-label="label">
        <p class="text-caption text-ink-3">{{ label }}</p>
        <slot />
    </section>
</template>
