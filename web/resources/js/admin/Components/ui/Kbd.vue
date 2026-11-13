<script setup lang="ts">
defineOptions({ name: 'UiKbd' });
</script>

<template>
    <kbd class="inline-flex h-20 min-w-20 items-center justify-center rounded-xs border border-line bg-raised px-4 font-ui text-caption text-ink-2"><slot /></kbd>
</template>
