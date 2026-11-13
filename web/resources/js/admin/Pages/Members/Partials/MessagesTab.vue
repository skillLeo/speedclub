<script setup lang="ts">
import { PhLockSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { formatNumber, formatPercent } from '../../../lib/format';
import type { MessageMetadata } from '../types';

/** ADM-10 "Nachrichten-Metadaten" (`members.message_metadata`): counts only, never a message, partner or preview. Opening it is audited. */
defineProps<{ metadata: MessageMetadata }>();
const KEYS = ['conversations', 'requests_sent_7_days', 'requests_sent_30_days', 'requests_accepted_30_days', 'blocks_given', 'blocks_received'] as const;
</script>

<template>
    <div class="flex flex-col gap-16" data-testid="ADM-10.messages">
        <p class="flex items-start gap-8 text-admin-base text-ink-2">
            <PhLockSimple :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />{{ trans('members.messages.note') }}
        </p>
        <!-- Seven numbers in rows of four (4 + 3), the open cell filled with the surface, values at the foot of each tile (DQ-534). -->
        <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-4" data-qa-exempt="hairline">
            <div v-for="key in KEYS" :key="key" class="flex flex-col justify-between gap-4 bg-surface px-16 py-12">
                <dt class="text-caption text-ink-2">{{ trans(`members.messages.${key}`) }}</dt>
                <dd class="t-title-2 text-ink tabular-nums">{{ formatNumber(metadata[key]) }}</dd>
            </div>
            <div class="flex flex-col justify-between gap-4 bg-surface px-16 py-12">
                <dt class="text-caption text-ink-2">{{ trans('members.messages.accepted_rate_30_days') }}</dt>
                <dd class="t-title-2 text-ink tabular-nums">{{ metadata.accepted_rate_30_days === null ? '–' : formatPercent(metadata.accepted_rate_30_days).replace('+', '') }}</dd>
            </div>
            <div class="hidden bg-surface tablet:block" aria-hidden="true" />
        </dl>
    </div>
</template>
