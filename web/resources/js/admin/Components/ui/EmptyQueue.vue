<script setup lang="ts">
import { PhCheck, PhTray } from '@phosphor-icons/vue';
import type { Component } from 'vue';

/**
 * Queue-zero frames (04 §5 "3 queue-zero frames"): `clear` = worked through (say when it was last cleared), `quiet` = nothing arrived
 * in this period (say which period), `first` = the platform has no data of this kind yet (say what fills it). The caller's title and
 * body carry that content; the icon only supports it.
 * A whole empty section or page gets the hairline dashed frame. `compact` is the line inside a card or section: no frame (DQ-504).
 */
withDefaults(defineProps<{ variant?: 'clear' | 'quiet' | 'first'; title: string; body?: string; compact?: boolean; icon?: Component }>(), {
    variant: 'clear',
    body: undefined,
    compact: false,
    icon: undefined,
});

// `quiet` defaults to the neutral tray; callers pass the icon that says what is missing (magnifying glass for no results, flag for
// reports, seal for approvals: DQ-544).
const icons = { clear: PhCheck, quiet: PhTray, first: PhTray } as const;
</script>

<template>
    <div v-if="compact" class="flex items-start gap-8" :data-empty="variant">
        <component :is="icon ?? icons[variant]" :size="16" class="mt-2 shrink-0" :class="variant === 'clear' ? 'text-success' : 'text-ink-3'" aria-hidden="true" />
        <div class="flex min-w-0 flex-col gap-2">
            <p class="text-admin-base text-ink-2">{{ title }}</p>
            <p v-if="body" class="text-caption text-ink-3">{{ body }}</p>
            <div v-if="$slots.default" class="mt-8"><slot /></div>
        </div>
    </div>
    <div v-else class="flex items-start gap-12 rounded-sm border border-dashed border-line px-16 py-24" :data-empty="variant">
        <component :is="icon ?? icons[variant]" :size="20" class="mt-2 shrink-0" :class="variant === 'clear' ? 'text-success' : 'text-ink-3'" aria-hidden="true" />
        <div class="flex min-w-0 flex-col gap-4">
            <p class="text-admin-base-strong text-ink">{{ title }}</p>
            <p v-if="body" class="text-admin-base text-ink-2">{{ body }}</p>
            <div v-if="$slots.default" class="mt-8"><slot /></div>
        </div>
    </div>
</template>
