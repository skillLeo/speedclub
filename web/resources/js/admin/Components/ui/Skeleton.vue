<script setup lang="ts">
defineOptions({ name: 'UiSkeleton' });

/** A grey block with the geometry of what loads. Size it with utility classes (h-*, w-*). Pulse is off with reduced motion and ?qaMotion=off. */
withDefaults(defineProps<{ shape?: 'block' | 'text' | 'circle' }>(), { shape: 'block' });
</script>

<template>
    <span
        aria-hidden="true"
        class="sc-skeleton block bg-skeleton"
        :class="shape === 'circle' ? 'rounded-full' : shape === 'text' ? 'h-12 rounded-xs' : 'rounded-sm'"
    />
</template>
