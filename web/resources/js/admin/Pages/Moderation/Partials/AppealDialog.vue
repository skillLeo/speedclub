<script setup lang="ts">
import DialogError from '../../../Components/patterns/DialogError.vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import { statementErrors, untilFrom, type Duration } from '../../../Components/decisions/statement';
import { Button, Dialog, Field, Input, RadioGroup, Select, Textarea } from '../../../Components/ui';
import { routeOr } from '../../../lib/routes';
import { fillPlaceholders, type AppealItem, type ComposerOptions, type SorTemplate } from '../shared';

/**
 * Decide an internal complaint (Art. 20 DSA, m3.4-contract §1; `moderation.appeals`, recent password, reason): uphold or change the
 * decision, with the explanation the appellant reads. Changing it on an affected member's appeal lifts the measure; on a reporter's
 * appeal the staff member takes a measure now (remove content or restrict) with its statement of reasons. The server refuses the person
 * who took the decision; the page does not offer it to them.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ appeal: AppealItem | null; composer: ComposerOptions; templates: SorTemplate[]; testId: string; failed?: boolean }>(), { failed: false });

interface Form {
    outcome: 'upheld' | 'reversed';
    explanation: string;
    action: 'remove_content' | 'restrict';
    restriction: 'messaging' | 'publishing';
    duration: Duration;
    template: string;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string;
    reason: string;
}
const blank = (): Form => ({ outcome: 'upheld', explanation: '', action: 'remove_content', restriction: 'messaging', duration: '7', template: '', facts: '', ground: '', ground_document: 'community', ground_section: '', reason: '' });
const form = reactive<Form>(blank());
const errors = ref<Partial<Record<string, string>>>({});
const action = useAdminAction();
watch(open, (value) => {
    if (!value) return;
    Object.assign(form, blank());
    errors.value = {};
    action.reset();
});

const reporterAppeal = computed(() => props.appeal?.role === 'reporter');
const newMeasure = computed(() => form.outcome === 'reversed' && reporterAppeal.value);
const outcomeOptions = computed(() => [
    { value: 'upheld', label: trans('moderation.appeal.upheld'), hint: trans('moderation.appeal.upheld_hint') },
    { value: 'reversed', label: trans('moderation.appeal.reversed'), hint: trans(reporterAppeal.value ? 'moderation.appeal.reversed_hint_reporter' : 'moderation.appeal.reversed_hint_affected') },
]);
const measureOptions = computed(() =>
    (['remove_content', ...(props.composer.actions.includes('restrict') ? (['restrict'] as const) : [])] as const).map((value) => ({ value, label: trans(`moderation.composer.actions.${value}`), hint: trans(`moderation.composer.hints.${value}`) })),
);
const restrictionOptions = computed(() => (['messaging', 'publishing'] as const).map((value) => ({ value, label: trans(`decisions.measures.${value}`) })));
const durationOptions = computed(() => (['1', '7', '30', 'none'] as const).map((value) => ({ value, label: trans(`decisions.durations.${value}`) })));
const documentOptions = computed(() => (['community', 'terms', 'law'] as const).map((value) => ({ value, label: trans(`decisions.documents.${value}`) })));
const templateOptions = computed(() => [{ value: '-', label: trans('moderation.composer.template_none') }, ...props.templates.filter((t) => t.locale === props.composer.member_locale).map((t) => ({ value: t.id, label: t.label }))]);

const outcomeModel = computed({ get: () => form.outcome, set: (v: string | undefined) => (form.outcome = v === 'reversed' ? 'reversed' : 'upheld') });
const measureModel = computed({ get: () => form.action, set: (v: string | undefined) => (form.action = v === 'restrict' ? 'restrict' : 'remove_content') });
const restrictionModel = computed({ get: () => form.restriction, set: (v: string | undefined) => (form.restriction = v === 'publishing' ? 'publishing' : 'messaging') });
const durationModel = computed({ get: () => form.duration, set: (v: string | undefined) => (form.duration = (v ?? '7') as Duration) });
const documentModel = computed({ get: () => form.ground_document, set: (v: string | undefined) => (form.ground_document = (v ?? 'community') as Form['ground_document']) });
const templateModel = computed({
    get: () => (form.template === '' ? undefined : form.template),
    set: (id: string | undefined) => {
        form.template = id === undefined || id === '-' ? '' : id;
        const template = props.templates.find((t) => t.id === id);
        if (!template) return;
        form.facts = fillPlaceholders(template.facts, props.composer.placeholders);
        form.ground = fillPlaceholders(template.ground, props.composer.placeholders);
        form.ground_document = template.ground_document;
        form.ground_section = template.ground_section ?? '';
    },
});

function submit(): void {
    if (props.appeal === null) return;
    const next: Partial<Record<string, string>> = newMeasure.value ? { ...statementErrors({ template: '', facts: form.facts, ground: form.ground, ground_document: form.ground_document, ground_section: form.ground_section }) } : {};
    const explanation = form.explanation.trim().length;
    if (explanation < 10 || explanation > 5000) next.explanation = trans('decisions.errors.facts');
    const reason = form.reason.trim().length;
    if (reason < 10 || reason > 1000) next.reason = trans('ui.confirm.reason_length');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    const measure = newMeasure.value
        ? {
              action: form.action,
              restriction: form.action === 'restrict' ? form.restriction : null,
              until: form.action === 'restrict' ? untilFrom(form.duration, '') : null,
              facts: form.facts.trim(),
              ground: form.ground.trim(),
              ground_document: form.ground_document,
              ground_section: form.ground_section.trim() === '' ? null : form.ground_section.trim(),
          }
        : {};
    action.run(
        'post',
        routeOr('admin.moderation.appeals.decide', `/admin/moderation/appeals/${props.appeal.id}/decide`, { appeal: props.appeal.id }),
        { outcome: form.outcome, explanation: form.explanation.trim(), reason: form.reason.trim(), ...measure },
        { sensitive: true, onSuccess: () => (open.value = false) },
    );
}
const serverError = computed(() => (props.failed ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Dialog v-model:open="open" :title="trans('moderation.appeal.title')" size="lg" :dismissible="!action.processing.value" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <div v-if="appeal?.text" class="flex flex-col gap-4">
                <p class="text-label-s text-ink">{{ trans('moderation.appeal.text') }}</p>
                <blockquote class="border-l-2 border-line pl-12 text-supporting text-ink" :data-testid="`${testId}.text`">{{ appeal.text }}</blockquote>
            </div>
            <RadioGroup v-model="outcomeModel" :legend="trans('moderation.appeal.outcome')" :options="outcomeOptions" :data-testid="`${testId}.outcome`" />
            <Field :label="trans('moderation.appeal.explanation')" :hint="trans('moderation.appeal.explanation_hint')" :error="errors.explanation" required>
                <Textarea v-model="form.explanation" :rows="3" :maxlength="5000" show-count :data-testid="`${testId}.explanation`" />
            </Field>

            <fieldset v-if="newMeasure" class="flex flex-col gap-16" :data-testid="`${testId}.measure`">
                <legend class="mb-4 text-label-s text-ink">{{ trans('moderation.appeal.measure') }}</legend>
                <RadioGroup v-model="measureModel" :legend="trans('moderation.composer.action')" :options="measureOptions" />
                <div v-if="form.action === 'restrict'" class="flex flex-wrap gap-12">
                    <div class="min-w-160 grow basis-0"><Field :label="trans('moderation.composer.restriction')"><Select v-model="restrictionModel" :options="restrictionOptions" /></Field></div>
                    <div class="w-200"><Field :label="trans('decisions.duration')"><Select v-model="durationModel" :options="durationOptions" /></Field></div>
                </div>
                <Field :label="trans('moderation.composer.template')" optional><Select v-model="templateModel" :options="templateOptions" :placeholder="trans('decisions.template_placeholder')" /></Field>
                <Field :label="trans('decisions.facts')" :error="errors.facts" required><Textarea v-model="form.facts" :rows="3" :maxlength="5000" /></Field>
                <Field :label="trans('decisions.ground')" :error="errors.ground" required><Textarea v-model="form.ground" :rows="2" :maxlength="2000" /></Field>
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-160 grow basis-0"><Field :label="trans('decisions.document')" required><Select v-model="documentModel" :options="documentOptions" /></Field></div>
                    <div class="w-120"><Field :label="trans('decisions.section')" optional><Input v-model="form.ground_section" maxlength="100" /></Field></div>
                </div>
            </fieldset>

            <Field :label="trans('moderation.appeal.internal_reason')" :hint="trans('decisions.reason_hint')" :error="errors.reason" required>
                <Textarea v-model="form.reason" :rows="2" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
            </Field>
        </form>
        <template #footer>
            <DialogError :message="serverError" />
            <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" variant="primary" :loading="action.processing.value" :data-testid="`${testId}.submit`">{{ trans('moderation.appeal.submit') }}</Button>
        </template>
    </Dialog>
</template>
