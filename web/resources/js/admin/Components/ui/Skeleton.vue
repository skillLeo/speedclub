<script setup lang="ts">
defineOptions({ name: 'UiSkeleton' });

/** A grey block with the geometry of what loads, in a static tone (no pulse, 09 §5). Size it with utility classes (h-*, w-*). */
withDefaults(defineProps<{ shape?: 'block' | 'text' | 'circle' }>(), { shape: 'block' });
</script>

<template>
    <span
        aria-hidden="true"
        class="block bg-skeleton"
        :class="shape === 'circle' ? 'rounded-full' : shape === 'text' ? 'h-12 rounded-xs' : 'rounded-sm'"
    />
</template>
