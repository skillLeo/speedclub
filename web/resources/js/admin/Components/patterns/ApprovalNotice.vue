<script setup lang="ts">
import { PhSealCheck, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import Button from '../ui/Button.vue';
import IconButton from '../ui/IconButton.vue';
import { formatDateTime } from '../../lib/format';
import { flashText } from '../../lib/i18n';
import { hasRoute, routeOr } from '../../lib/routes';
import type { ApprovalFlash } from '../../types/inertia';

/**
 * Four-eyes notice (06 §5, ADR-214). `approval` set: a request was created, here is what happens next. Without it (`preview`): this
 * action will need a second staff member's approval.
 */
withDefaults(defineProps<{ approval?: ApprovalFlash | null; dismissible?: boolean; testId?: string }>(), { approval: null, dismissible: false, testId: 'approval-notice' });
const emit = defineEmits<{ dismiss: [] }>();
const queue = hasRoute('admin.team.approvals') ? routeOr('admin.team.approvals', '/admin/team/approvals') : null;
</script>

<template>
    <div class="flex items-start gap-12 rounded-sm border border-line bg-raised px-16 py-12" role="status" :data-testid="testId">
        <PhSealCheck :size="20" class="mt-2 shrink-0 text-info" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 flex-col gap-4">
            <template v-if="approval">
                <p class="text-label-s text-ink">{{ trans(approval.existing ? 'ui.approval.already' : 'ui.approval.requested', { title: flashText(approval.title, trans) }) }}</p>
                <p class="text-supporting text-ink-2">{{ trans('ui.approval.next', { until: formatDateTime(approval.expires_at) }) }}</p>
            </template>
            <template v-else>
                <p class="text-label-s text-ink">{{ trans('ui.approval.preview_title') }}</p>
                <p class="text-supporting text-ink-2">{{ trans('ui.approval.preview_body') }}</p>
            </template>
        </div>
        <Button v-if="approval && queue" size="sm" variant="secondary" :href="queue">{{ trans('ui.approval.open_queue') }}</Button>
        <IconButton v-if="dismissible" :icon="PhX" :label="trans('ui.dialog.close')" @click="emit('dismiss')" />
    </div>
</template>
