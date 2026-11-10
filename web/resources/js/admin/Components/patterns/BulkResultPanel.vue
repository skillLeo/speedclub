<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Dialog from '../ui/Dialog.vue';
import Button from '../ui/Button.vue';
import { formatNumber } from '../../lib/format';
import type { BulkResult } from '../../types/table';
import StateBlock from './StateBlock.vue';

/**
 * Per-record result of a bulk action (06 §3 Members: "per-record result panel"; 04 §5 "bulk partial failure").
 * `label(id)` names a record, `reason(code)` explains a failure code (module strings).
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ results: BulkResult[]; title: string; label: (id: string) => string; reason: (code: string | null) => string; testId?: string }>();
const failed = computed(() => props.results.filter((r) => !r.ok));
const done = computed(() => props.results.length - failed.value.length);
</script>

<template>
    <Dialog v-model:open="open" :title="title" size="md" :test-id="testId">
        <div class="flex flex-col gap-16">
            <p class="text-supporting text-ink tabular-nums">{{ trans('ui.bulk.summary', { done: formatNumber(done), failed: formatNumber(failed.length) }) }}</p>
            <StateBlock v-if="failed.length > 0" kind="partial" :title="trans('ui.bulk.partial')" :retryable="false" />
            <table v-if="failed.length > 0" class="w-full border-collapse text-supporting">
                <thead>
                    <tr class="h-32 border-b border-line text-caption text-ink-2">
                        <th scope="col" class="pr-12 text-left">{{ trans('ui.bulk.record') }}</th>
                        <th scope="col" class="text-left">{{ trans('ui.bulk.reason') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in failed" :key="item.id" class="h-40 border-b border-line-subtle">
                        <td class="pr-12 text-ink">{{ label(item.id) }}</td>
                        <td class="text-ink-2">{{ reason(item.code) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <template #footer>
            <Button variant="primary" @click="open = false">{{ trans('ui.actions.done') }}</Button>
        </template>
    </Dialog>
</template>
