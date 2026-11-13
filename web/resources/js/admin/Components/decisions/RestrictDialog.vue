<script setup lang="ts">
import { PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import ApprovalNotice from '../patterns/ApprovalNotice.vue';
import Button from '../ui/Button.vue';
import DateRangeField from '../ui/DateRangeField.vue';
import Dialog from '../ui/Dialog.vue';
import Field from '../ui/Field.vue';
import RadioGroup from '../ui/RadioGroup.vue';
import Select from '../ui/Select.vue';
import Textarea from '../ui/Textarea.vue';
import { formatNumber } from '../../lib/format';
import { applyTemplate, emptyStatement, statementErrors, statementPayload, untilFrom, type Duration } from './statement';
import StatementFields from './StatementFields.vue';

/**
 * "Einschränken / Sperren" (06 §3 Members): the measure (messaging, publishing or, with `canSuspend`, suspension), its duration
 * (1/7/30 days, a date or none), the statement of reasons from a template and a reason. A suspension is four-eyes (the notice says so);
 * a moderator suspends for at most `maxDays` days and never without an end (06 §2). Emits the payload; the page posts it.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        title: string;
        description?: string;
        canSuspend?: boolean;
        /** A bulk run above 100 records is four-eyes as well. */
        fourEyes?: boolean;
        maxDays?: number | null;
        /** Values the sheet opens with (the QA overlay cells, `?dialog=`); every field stays editable. */
        preset?: { measure?: 'messaging' | 'publishing' | 'suspension'; duration?: Duration; template?: string; reason?: string } | null;
        processing?: boolean;
        error?: string | null;
        testId: string;
    }>(),
    { description: undefined, canSuspend: false, fourEyes: false, maxDays: null, preset: null, processing: false, error: null },
);
const emit = defineEmits<{ submit: [payload: { measure: 'messaging' | 'publishing' | 'suspension'; until: string | null; reason: string } & Record<string, string | null>] }>();

interface Form {
    measure: 'messaging' | 'publishing' | 'suspension';
    duration: Duration;
    day: string;
    reason: string;
}
const form = reactive<Form>({ measure: 'messaging', duration: '7', day: '', reason: '' });
const statement = ref(emptyStatement());
const errors = ref<Partial<Record<string, string>>>({});

watch(open, (value) => {
    if (!value) return;
    form.measure = 'messaging';
    form.duration = '7';
    form.day = '';
    form.reason = '';
    statement.value = emptyStatement();
    errors.value = {};
    const preset = props.preset;
    if (preset) {
        if (preset.measure && (preset.measure !== 'suspension' || props.canSuspend)) form.measure = preset.measure;
        if (preset.duration) form.duration = preset.duration;
        if (preset.template) applyTemplate(statement.value, preset.template, 'member');
        if (preset.reason) form.reason = preset.reason;
    }
});

const measures = computed(() =>
    (['messaging', 'publishing', ...(props.canSuspend ? (['suspension'] as const) : [])] as const).map((v) => ({
        value: v,
        label: trans(`decisions.measures.${v}`),
        hint: trans(`decisions.measures.${v}_hint`),
    })),
);
const limited = computed(() => form.measure === 'suspension' && props.maxDays !== null);
const durations = computed(() =>
    (['1', '7', '30', 'date', 'none'] as const)
        .filter((v) => !(limited.value && v === 'none'))
        .map((v) => ({ value: v, label: trans(`decisions.durations.${v}`) })),
);
const MEASURES: Form['measure'][] = ['messaging', 'publishing', 'suspension'];
const measureModel = computed({ get: () => form.measure, set: (v: string | undefined) => (form.measure = MEASURES.find((m) => m === v) ?? 'messaging') });
const durationModel = computed({ get: () => form.duration, set: (v: string | undefined) => (form.duration = (v ?? '7') as Duration) });
watch(limited, (value) => {
    if (value && form.duration === 'none') form.duration = '30';
});
const suspension = computed(() => form.measure === 'suspension');

function submit(): void {
    const next: Partial<Record<string, string>> = { ...statementErrors(statement.value) };
    const reason = form.reason.trim().length;
    if (reason < 10 || reason > 1000) next.reason = trans('ui.confirm.reason_length');
    const until = untilFrom(form.duration, form.day);
    if (form.duration === 'date' && until === null) next.until = trans('decisions.errors.date');
    if (until !== null && Date.parse(until) <= Date.now()) next.until = trans('decisions.errors.date_past');
    if (limited.value && props.maxDays !== null && (until === null || Date.parse(until) > Date.now() + (props.maxDays + 1) * 86_400_000)) {
        next.until = trans('decisions.errors.max_days', { days: formatNumber(props.maxDays) });
    }
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    emit('submit', { measure: form.measure, until, ...statementPayload(statement.value), reason: form.reason.trim() });
}
</script>

<template>
    <Dialog v-model:open="open" :title="title" :description="description" size="lg" :dismissible="!processing" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <RadioGroup v-model="measureModel" :legend="trans('decisions.measure')" :options="measures" :data-testid="`${testId}.measure`" />
            <ApprovalNotice v-if="suspension || fourEyes" :test-id="`${testId}.four-eyes`" />
            <div class="flex flex-wrap items-start gap-12">
                <div class="w-200">
                    <Field :label="trans('decisions.duration')" :hint="limited ? trans('decisions.max_days_hint', { days: formatNumber(maxDays) }) : undefined">
                        <Select v-model="durationModel" :options="durations" :data-testid="`${testId}.duration`" />
                    </Field>
                </div>
                <div v-if="form.duration === 'date'" class="w-160">
                    <Field :label="trans('decisions.until')" :error="errors.until" required>
                        <DateRangeField v-model:from="form.day" single :test-id="`${testId}.until`" />
                    </Field>
                </div>
            </div>
            <p v-if="errors.until && form.duration !== 'date'" class="text-admin-base text-danger" role="alert">{{ errors.until }}</p>
            <StatementFields v-model="statement" subject="member" :errors="errors" :test-id="`${testId}.statement`" />
            <Field :label="trans('ui.confirm.reason')" :hint="trans('decisions.reason_hint')" :error="errors.reason" required>
                <Textarea v-model="form.reason" :rows="3" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
            </Field>
        </form>
        <template #footer>
            <!-- The server error sits next to the buttons, so a long sheet never hides it below the fold. -->
            <p v-if="error" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-admin-base text-ink" role="alert">
                <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ error }}
            </p>
            <Button variant="ghost" :disabled="processing" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" variant="danger" :loading="processing" :data-testid="`${testId}.confirm`">
                {{ suspension ? trans('decisions.submit_suspend') : trans('decisions.submit_restrict') }}
            </Button>
        </template>
    </Dialog>
</template>
