<script setup lang="ts">
import { PhCheckCircle, PhInfo, PhWarning, PhWarningCircle } from '@phosphor-icons/vue';

/** Status line of the sign-in pages (success, warning, error, info). */
withDefaults(defineProps<{ tone: 'success' | 'warning' | 'error' | 'info'; text: string; testId?: string }>(), { testId: undefined });
const icons = { success: PhCheckCircle, warning: PhWarning, error: PhWarningCircle, info: PhInfo } as const;
const colors = { success: 'text-success', warning: 'text-warning', error: 'text-danger', info: 'text-info' } as const;
</script>

<template>
    <div class="flex items-start gap-12 rounded-sm border border-line bg-surface px-12 py-12" :role="tone === 'error' ? 'alert' : 'status'" :data-testid="testId">
        <component :is="icons[tone]" :size="20" class="shrink-0" :class="colors[tone]" aria-hidden="true" />
        <p class="text-supporting text-ink">{{ text }}</p>
    </div>
</template>
