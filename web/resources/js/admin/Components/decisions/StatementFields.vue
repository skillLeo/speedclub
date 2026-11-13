<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';
import Textarea from '../ui/Textarea.vue';
import { applyTemplate, TEMPLATE_KEYS, type StatementForm } from './statement';

/**
 * The statement-of-reasons fields of every staff decision (restrict, suspend, hide a vehicle or photo, delete a vehicle): a template
 * to start from, then facts, ground, where it is written and the section, all editable. What the member reads on SAFE-01 and in the
 * mail. The hint says that no automated means were used and that the member is told how to appeal.
 */
const form = defineModel<StatementForm>({ required: true });
const props = withDefaults(defineProps<{ subject: 'member' | 'vehicle' | 'photo'; errors?: Partial<Record<string, string>>; testId: string }>(), { errors: () => ({}) });

const templates = computed(() => TEMPLATE_KEYS.map((key) => ({ value: key, label: trans(`decisions.templates.${key}.label`) })));
const documents = computed(() => (['community', 'terms', 'law'] as const).map((value) => ({ value, label: trans(`decisions.documents.${value}`) })));

const templateModel = computed({
    get: () => (form.value.template === '' ? undefined : form.value.template),
    set: (key: string | undefined) => {
        if (key !== undefined) applyTemplate(form.value, key, props.subject);
    },
});
const documentModel = computed({
    get: () => form.value.ground_document,
    set: (value: StatementForm['ground_document'] | undefined) => (form.value.ground_document = value ?? 'community'),
});
</script>

<template>
    <fieldset class="flex flex-col gap-16" :data-testid="testId">
        <legend class="mb-4 text-admin-base-strong text-ink">{{ trans('decisions.legend') }}</legend>
        <Field :label="trans('decisions.template')" :hint="trans('decisions.template_hint')" optional>
            <Select v-model="templateModel" :options="templates" :placeholder="trans('decisions.template_placeholder')" :data-testid="`${testId}.template`" />
        </Field>
        <Field :label="trans('decisions.facts')" :hint="trans('decisions.facts_hint')" :error="errors.facts" required>
            <Textarea v-model="form.facts" :rows="4" :maxlength="5000" :data-testid="`${testId}.facts`" />
        </Field>
        <Field :label="trans('decisions.ground')" :error="errors.ground" required>
            <Textarea v-model="form.ground" :rows="2" :maxlength="2000" :data-testid="`${testId}.ground`" />
        </Field>
        <div class="flex flex-wrap gap-12">
            <div class="min-w-160 grow basis-0">
                <Field :label="trans('decisions.document')" :error="errors.ground_document" required>
                    <Select v-model="documentModel" :options="documents" :data-testid="`${testId}.document`" />
                </Field>
            </div>
            <div class="w-120">
                <Field :label="trans('decisions.section')" :error="errors.ground_section" optional>
                    <Input v-model="form.ground_section" maxlength="100" :data-testid="`${testId}.section`" />
                </Field>
            </div>
        </div>
        <p class="text-admin-base text-ink-3">{{ trans('decisions.redress_note') }}</p>
    </fieldset>
</template>
