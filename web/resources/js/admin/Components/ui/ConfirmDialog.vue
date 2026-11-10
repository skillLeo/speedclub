<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import Button from './Button.vue';
import Dialog from './Dialog.vue';
import Field from './Field.vue';
import Input from './Input.vue';
import Textarea from './Textarea.vue';
import ApprovalNotice from '../patterns/ApprovalNotice.vue';
import { formatNumber } from '../../lib/format';

/**
 * Confirmation for destructive and high-risk actions (06 §5).
 * - `typed`: irreversible → the person types the confirm word ("LÖSCHEN" / "DELETE") first.
 * - `reason`: the spec says "with reason" → 10–1000 characters, emitted with `confirm`.
 * - `fourEyes`: the action only creates an approval request: the ApprovalNotice says what happens next (one design everywhere, DQ-632)
 *   and the confirm button says "Freigabe anfragen" in the neutral primary style; the red label stays for the approver's execution.
 * - `reasonMax` / `reasonHint`: a reason with a shorter limit (e.g. one the member reads, DQ-607); `reasonFirst` keeps the confirm
 *   disabled until the reason has the right length.
 * Extra fields (e.g. a format choice) go in the default slot, above the reason.
 * The parent runs the request on `confirm` and closes the dialog (or sets `error`) when it answers.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        title: string;
        body?: string;
        confirmLabel: string;
        tone?: 'danger' | 'neutral';
        typed?: boolean;
        reason?: boolean;
        reasonLabel?: string;
        reasonHint?: string;
        reasonMax?: number;
        reasonFirst?: boolean;
        fourEyes?: boolean;
        processing?: boolean;
        error?: string | null;
        testId?: string;
    }>(),
    { body: undefined, tone: 'danger', typed: false, reason: false, reasonLabel: undefined, reasonHint: undefined, reasonMax: 1000, reasonFirst: false, fourEyes: false, processing: false, error: null, testId: undefined },
);
const emit = defineEmits<{ confirm: [reason: string | null] }>();

const word = computed(() => trans('ui.confirm.typed_word'));
const typedValue = ref('');
const reasonValue = ref('');
const reasonError = ref<string | null>(null);

watch(open, (value) => {
    if (value) {
        typedValue.value = '';
        reasonValue.value = '';
        reasonError.value = null;
    }
});

const typedOk = computed(() => !props.typed || typedValue.value.trim() === word.value);
const reasonOk = computed(() => {
    const length = reasonValue.value.trim().length;
    return length >= 10 && length <= props.reasonMax;
});
const lengthMessage = computed(() => (props.reasonMax === 1000 ? trans('ui.confirm.reason_length') : trans('ui.confirm.reason_length_max', { max: formatNumber(props.reasonMax) })));

function submit(): void {
    if (props.reason && !reasonOk.value) {
        reasonError.value = lengthMessage.value;
        return;
    }
    reasonError.value = null;
    emit('confirm', props.reason ? reasonValue.value.trim() : null);
}
</script>

<template>
    <Dialog v-model:open="open" :title="title" :description="body" size="sm" role="alertdialog" :test-id="testId" :dismissible="!processing">
        <form :id="`${testId ?? 'confirm'}-form`" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <slot />
            <ApprovalNotice v-if="fourEyes" :test-id="testId ? `${testId}.four-eyes` : 'approval-notice'" />
            <Field v-if="reason" :label="reasonLabel ?? trans('ui.confirm.reason')" :hint="reasonHint ?? trans('ui.confirm.reason_hint')" :error="reasonError" required>
                <Textarea v-model="reasonValue" :rows="3" :maxlength="reasonMax" show-count :data-testid="testId ? `${testId}.reason` : undefined" />
            </Field>
            <Field v-if="typed" :label="trans('ui.confirm.typed_label', { word })">
                <Input v-model="typedValue" autocomplete="off" spellcheck="false" :data-testid="testId ? `${testId}.typed` : undefined" />
            </Field>
            <p v-if="error" class="text-helper text-danger" role="alert">{{ error }}</p>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="processing" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button
                type="submit"
                :form="`${testId ?? 'confirm'}-form`"
                :variant="tone === 'danger' && !fourEyes ? 'danger' : 'primary'"
                :disabled="!typedOk || (reason && reasonFirst && !reasonOk)"
                :loading="processing"
                :data-testid="testId ? `${testId}.confirm` : undefined"
            >
                {{ fourEyes ? trans('ui.confirm.request') : confirmLabel }}
            </Button>
        </template>
    </Dialog>
</template>
