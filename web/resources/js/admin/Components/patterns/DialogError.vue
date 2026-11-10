<script setup lang="ts">
import { PhWarningCircle } from '@phosphor-icons/vue';

/**
 * The server error of a dialog or drawer, next to its buttons (a long sheet never hides it below the fold), as RestrictDialog shows it.
 * Put it first in the `#footer` slot; it takes the full footer width.
 */
defineProps<{ message: string | null; testId?: string }>();
</script>

<template>
    <p v-if="message" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-supporting text-ink" role="alert" :data-testid="testId">
        <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ message }}
    </p>
</template>
