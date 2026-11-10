<script setup lang="ts">
import { PhArrowClockwise, PhLockKey, PhWarningCircle, PhWarning } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import Button from '../ui/Button.vue';

/**
 * Error, view-only and partial-failure blocks for pages and sections. `retry` shows the retry button.
 * kind: error (something failed, retry) · forbidden (no permission for this part) · partial (some parts failed, rest shown).
 */
withDefaults(defineProps<{ kind?: 'error' | 'forbidden' | 'partial'; title: string; body?: string; retryable?: boolean; testId?: string }>(), {
    kind: 'error',
    body: undefined,
    retryable: true,
    testId: undefined,
});
const emit = defineEmits<{ retry: [] }>();
const icons = { error: PhWarningCircle, forbidden: PhLockKey, partial: PhWarning } as const;
const tones = { error: 'text-danger', forbidden: 'text-ink-3', partial: 'text-warning' } as const;
</script>

<template>
    <!-- Narrower than 512 (container lg): the retry button goes under the text, so titles keep their width (DQ-503). -->
    <div class="@container rounded-sm border border-line px-16 py-16" :role="kind === 'forbidden' ? undefined : 'alert'" :data-testid="testId" :data-state-kind="kind">
        <div class="flex flex-col items-start gap-12 @lg:flex-row">
            <div class="flex min-w-0 flex-1 items-start gap-12">
                <component :is="icons[kind]" :size="20" class="mt-2 shrink-0" :class="tones[kind]" aria-hidden="true" />
                <div class="flex min-w-0 flex-1 flex-col gap-4">
                    <p class="text-label-s text-ink">{{ title }}</p>
                    <p v-if="body" class="text-supporting text-ink-2">{{ body }}</p>
                    <slot />
                </div>
            </div>
            <Button v-if="kind !== 'forbidden' && retryable" class="ml-32 @lg:ml-0" size="sm" variant="secondary" :icon="PhArrowClockwise" @click="emit('retry')">{{ trans('ui.state.retry') }}</Button>
        </div>
    </div>
</template>
