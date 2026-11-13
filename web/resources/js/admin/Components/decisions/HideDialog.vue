<script setup lang="ts">
import { PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import ApprovalNotice from '../patterns/ApprovalNotice.vue';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Textarea from '../ui/Textarea.vue';
import { applyTemplate, emptyStatement, statementErrors, statementPayload } from './statement';
import StatementFields from './StatementFields.vue';

/**
 * A removal decision on content (hide a vehicle or photo, delete a vehicle, ADR-225): the statement of reasons the owner reads, a
 * reason for the audit log and, for an irreversible removal (`typed`), the typed confirmation word. Emits the payload; the page posts it.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        title: string;
        description?: string;
        subject: 'vehicle' | 'photo';
        confirmLabel: string;
        typed?: boolean;
        fourEyes?: boolean;
        /** Values the dialog opens with (the QA overlay cells, `?dialog=`); every field stays editable. */
        preset?: { template?: string; reason?: string } | null;
        processing?: boolean;
        error?: string | null;
        testId: string;
    }>(),
    { description: undefined, typed: false, fourEyes: false, preset: null, processing: false, error: null },
);
const emit = defineEmits<{ submit: [payload: Record<string, string | null>] }>();

const statement = ref(emptyStatement());
const reason = ref('');
const typedValue = ref('');
const errors = ref<Partial<Record<string, string>>>({});
const word = computed(() => trans('ui.confirm.typed_word'));

watch(open, (value) => {
    if (!value) return;
    statement.value = emptyStatement();
    reason.value = '';
    typedValue.value = '';
    errors.value = {};
    if (props.preset?.template) applyTemplate(statement.value, props.preset.template, props.subject);
    if (props.preset?.reason) reason.value = props.preset.reason;
});

function submit(): void {
    const next: Partial<Record<string, string>> = { ...statementErrors(statement.value) };
    const length = reason.value.trim().length;
    if (length < 10 || length > 1000) next.reason = trans('ui.confirm.reason_length');
    if (props.typed && typedValue.value.trim() !== word.value) next.typed = trans('decisions.errors.typed', { word: word.value });
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    emit('submit', { ...statementPayload(statement.value), reason: reason.value.trim(), ...(props.typed ? { confirm: word.value } : {}) });
}
</script>

<template>
    <Dialog v-model:open="open" :title="title" :description="description" size="lg" :role="typed ? 'alertdialog' : 'dialog'" :dismissible="!processing" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <ApprovalNotice v-if="fourEyes" :test-id="`${testId}.four-eyes`" />
            <StatementFields v-model="statement" :subject="subject" :errors="errors" :test-id="`${testId}.statement`" />
            <Field :label="trans('ui.confirm.reason')" :hint="trans('decisions.reason_hint')" :error="errors.reason" required>
                <Textarea v-model="reason" :rows="3" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
            </Field>
            <Field v-if="typed" :label="trans('ui.confirm.typed_label', { word })" :error="errors.typed" required>
                <Input v-model="typedValue" autocomplete="off" spellcheck="false" :data-testid="`${testId}.typed`" />
            </Field>
        </form>
        <template #footer>
            <!-- The server error sits next to the buttons, so a long sheet never hides it below the fold. -->
            <p v-if="error" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-admin-base text-ink" role="alert">
                <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ error }}
            </p>
            <Button variant="ghost" :disabled="processing" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" variant="danger" :loading="processing" :data-testid="`${testId}.confirm`">{{ confirmLabel }}</Button>
        </template>
    </Dialog>
</template>
