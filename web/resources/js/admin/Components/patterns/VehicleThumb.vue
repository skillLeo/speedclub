<script setup lang="ts">
import { PhCar } from '@phosphor-icons/vue';
import { computed } from 'vue';

/**
 * A vehicle thumbnail in a 40 px list row (DQ-536): 32×24 (4:3, never square for a car, 03 §7), cropped around the photo's focal point,
 * the blurhash as the placeholder underneath while it loads, radius 4. Without a cover: the car glyph on the same footprint.
 */
const props = withDefaults(defineProps<{ src: string | null; focus?: string | null; placeholder?: string | null }>(), { focus: null, placeholder: null });
const ground = computed(() => (props.placeholder ? { backgroundImage: `url("${props.placeholder}")` } : undefined));
</script>

<template>
    <span class="relative block h-24 w-32 shrink-0 overflow-hidden rounded-xs bg-raised bg-cover bg-center" :style="ground">
        <img v-if="src" :src="src" alt="" width="32" height="24" loading="lazy" class="block h-24 w-32 object-cover" :style="focus ? { objectPosition: focus } : undefined" />
        <span v-else class="flex h-24 w-32 items-center justify-center text-ink-3"><PhCar :size="16" aria-hidden="true" /></span>
    </span>
</template>
