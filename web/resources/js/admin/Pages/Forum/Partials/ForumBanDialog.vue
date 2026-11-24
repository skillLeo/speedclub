<script setup lang="ts">
import { PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { applyTemplate, emptyStatement, statementErrors, statementPayload, untilFrom, type Duration } from '../../../Components/decisions/statement';
import StatementFields from '../../../Components/decisions/StatementFields.vue';
import { Button, DateRangeField, Dialog, Field, Select } from '../../../Components/ui';
import { formatDateTime } from '../../../lib/format';

/**
 * "Forum-Sperre" (10 §7.3, m5.8-contract D3): a DSA restriction of type forum for the author: the duration (1/7/30 days, up to a date or
 * none), and the statement of reasons the member reads (push + e-mail, appealable). Not four-eyes (06 §2 lists
 * the suspension only). Emits the payload; the pane posts it.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        username: string;
        /** The forum restriction in force (ISO end, or null for none / without end). */
        restricted?: boolean;
        restrictedUntil?: string | null;
        preset?: { duration?: Duration; template?: string } | null;
        processing?: boolean;
        error?: string | null;
        testId: string;
    }>(),
    { restricted: false, restrictedUntil: null, preset: null, processing: false, error: null },
);
const emit = defineEmits<{ submit: [payload: Record<string, string | null>] }>();

const form = reactive<{ duration: Duration; day: string }>({ duration: '7', day: '' });
const statement = ref(emptyStatement());
const errors = ref<Partial<Record<string, string>>>({});

watch(
    open,
    (value) => {
        if (!value) return;
        form.duration = props.preset?.duration ?? '7';
        form.day = '';
        statement.value = emptyStatement();
        errors.value = {};
        if (props.preset?.template) applyTemplate(statement.value, props.preset.template, 'post');
    },
    { immediate: true },
);

const durations = computed(() => (['1', '7', '30', 'date', 'none'] as const).map((value) => ({ value, label: trans(`decisions.durations.${value}`) })));
const durationModel = computed({ get: () => form.duration, set: (value: string | undefined) => (form.duration = (value ?? '7') as Duration) });
const current = computed(() => {
    if (!props.restricted) return null;
    return props.restrictedUntil ? trans('forum.ban.current_until', { date: formatDateTime(props.restrictedUntil) }) : trans('forum.ban.current_open');
});

function submit(): void {
    const next: Partial<Record<string, string>> = { ...statementErrors(statement.value) };
    const until = untilFrom(form.duration, form.day);
    if (form.duration === 'date' && until === null) next.until = trans('decisions.errors.date');
    if (until !== null && Date.parse(until) <= Date.now()) next.until = trans('decisions.errors.date_past');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    emit('submit', { until, ...statementPayload(statement.value) });
}
</script>

<template>
    <Dialog v-model:open="open" :title="trans('forum.ban.title', { username })" :description="trans('forum.ban.description')" size="lg" :dismissible="!processing" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <p v-if="current" class="text-admin-base text-ink-2" role="status" :data-testid="`${testId}.current`">{{ current }}</p>
            <div class="flex flex-wrap items-start gap-12">
                <div class="w-200">
                    <Field :label="trans('decisions.duration')">
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
            <StatementFields v-model="statement" subject="post" :errors="errors" :test-id="`${testId}.statement`" />
        </form>
        <template #footer>
            <p v-if="error" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-admin-base text-ink" role="alert">
                <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ error }}
            </p>
            <Button variant="ghost" :disabled="processing" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" variant="danger" :loading="processing" :data-testid="`${testId}.confirm`">{{ trans('forum.ban.submit') }}</Button>
        </template>
    </Dialog>
</template>
