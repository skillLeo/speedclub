<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { useAdminAction } from '../decisions/action';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import { routeOr } from '../../lib/routes';

/**
 * ADR-507 Owner-Override ⚿: the requesting Owner executes their own four-eyes request because nobody else can approve it. It goes into
 * the audit log and the mail to every Owner (ADR-540: no reason any more); the password dialog comes first when the confirmation is stale.
 * The server decides whether the override is allowed (a second approver closes it); its refusal shows inside the dialog.
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ approvalId: string; title: string; testId: string }>();
const emit = defineEmits<{ done: [] }>();
const action = useAdminAction();

function confirm(): void {
    action.run('post', routeOr('admin.team.approvals.override', `/admin/team/approvals/${props.approvalId}/override`, { approval: props.approvalId }), {}, {
        sensitive: true,
        onSuccess: () => {
            open.value = false;
            emit('done');
        },
    });
}
</script>

<template>
    <ConfirmDialog
        v-model:open="open"
        :title="trans('ui.approval.override_title')"
        :body="trans('ui.approval.override_body', { title })"
        :confirm-label="trans('ui.approval.override_confirm')"
        tone="danger"
        :processing="action.processing.value"
        :error="action.error.value"
        :test-id="testId"
        @confirm="confirm"
    />
</template>
