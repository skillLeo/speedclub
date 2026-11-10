<script setup lang="ts">
import { PhCircleNotch } from '@phosphor-icons/vue';

defineOptions({ name: 'UiSpinner' });

withDefaults(defineProps<{ size?: 16 | 20 | 24 }>(), { size: 16 });
</script>

<template>
    <PhCircleNotch :size="size" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
</template>
