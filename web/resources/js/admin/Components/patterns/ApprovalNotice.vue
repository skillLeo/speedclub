<script setup lang="ts">
import { PhSealCheck, PhX } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import Button from '../ui/Button.vue';
import IconButton from '../ui/IconButton.vue';
import OwnerOverrideDialog from './OwnerOverrideDialog.vue';
import { formatDateTime } from '../../lib/format';
import { flashText } from '../../lib/i18n';
import { hasRoute, routeOr } from '../../lib/routes';
import type { ApprovalFlash } from '../../types/inertia';
import { useFourEyes } from '../../composables/fourEyes';

/**
 * Four-eyes notice (06 §5, ADR-214). `approval` set: a request was created (or waits already): "Wartet auf Freigabe durch eine zweite
 * Person", who can approve it (M5.1), and, when nobody else can and the viewer is the requesting Owner, "Selbst freigeben" (Owner-Override,
 * ADR-507). Without it (`preview`): this action will need a second staff member's approval. ADR-540: nothing at all while the governance
 * four-eyes switch is off (actions then run at once).
 */
const props = withDefaults(defineProps<{ approval?: ApprovalFlash | null; dismissible?: boolean; testId?: string }>(), { approval: null, dismissible: false, testId: 'approval-notice' });
const emit = defineEmits<{ dismiss: [] }>();
const queue = hasRoute('admin.team.approvals') ? routeOr('admin.team.approvals', '/admin/team/approvals') : null;
const overrideOpen = ref(false);
const fourEyesOn = useFourEyes();

const known = computed(() => props.approval?.approvers !== undefined);
const names = computed(() => {
    const list = props.approval?.approvers ?? [];
    const total = props.approval?.approvers_total ?? list.length;
    const more = total - list.length;
    return more > 0 ? trans('ui.approval.approvers_more', { names: list.join(', '), count: String(more) }) : list.join(', ');
});
</script>

<template>
    <div v-if="fourEyesOn" class="flex items-start gap-12 rounded-sm border border-line bg-raised px-16 py-12" role="status" :data-testid="testId">
        <PhSealCheck :size="20" class="mt-2 shrink-0 text-info" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 flex-col gap-4">
            <template v-if="approval">
                <p class="text-admin-base-strong text-ink">{{ trans(approval.existing ? 'ui.approval.already' : 'ui.approval.requested', { title: flashText(approval.title, trans) }) }}</p>
                <p class="text-admin-base text-ink-2" :data-testid="`${testId}.waiting`">{{ trans('ui.approval.waiting') }} {{ trans('ui.approval.next', { until: formatDateTime(approval.expires_at) }) }}</p>
                <template v-if="known">
                    <p v-if="(approval.approvers_total ?? 0) > 0" class="text-admin-base text-ink-2" :data-testid="`${testId}.approvers`">
                        <!-- SEC-P5-06: the names only reach the requester and staff who decide approvals; everyone else reads the count -->
                        {{
                            (approval.approvers ?? []).length > 0
                                ? transChoice('ui.approval.approvers', approval.approvers_total ?? 0, { names })
                                : transChoice('ui.approval.approvers_count', approval.approvers_total ?? 0, { count: String(approval.approvers_total ?? 0) })
                        }}
                    </p>
                    <p v-else class="text-admin-base text-warning" :data-testid="`${testId}.nobody`">
                        {{ approval.override ? trans('ui.approval.nobody_override') : trans('ui.approval.nobody') }}
                    </p>
                </template>
            </template>
            <template v-else>
                <p class="text-admin-base-strong text-ink">{{ trans('ui.approval.preview_title') }}</p>
                <p class="text-admin-base text-ink-2">{{ trans('ui.approval.preview_body') }}</p>
            </template>
        </div>
        <div v-if="approval && (approval.override || queue)" class="flex flex-wrap items-center justify-end gap-8">
            <Button v-if="approval.override" size="sm" variant="secondary" :data-testid="`${testId}.override`" @click="overrideOpen = true">{{ trans('ui.approval.override') }}</Button>
            <Button v-if="queue" size="sm" variant="secondary" :href="queue">{{ trans('ui.approval.open_queue') }}</Button>
        </div>
        <IconButton v-if="dismissible" :icon="PhX" :label="trans('ui.dialog.close')" @click="emit('dismiss')" />
        <OwnerOverrideDialog v-if="approval?.override" v-model:open="overrideOpen" :approval-id="approval.id" :title="flashText(approval.title, trans)" :test-id="`${testId}.override-dialog`" @done="emit('dismiss')" />
    </div>
</template>
