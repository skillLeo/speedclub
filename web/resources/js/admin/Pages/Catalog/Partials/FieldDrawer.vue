<script setup lang="ts">
import { PhInfo, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { getActiveLanguage, trans, transChoice } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import { Button, Drawer, Field, IconButton, Input, Select, Switch, Textarea, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { formatNumber } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import FormError from './FormError.vue';
import { useCatalogWrite } from '../shared';
import { fieldLabel, type SchemaField } from './schema';

/**
 * ADM-15 field editor (m3.3 §1, catalog.manage; every save is one schema version with its reason): key, labels DE/EN, type (the five of
 * 02 §3.3: number, text, select, boolean, brand), unit, min/max/step (number), options with DE/EN labels (select), pattern and example
 * (text), required and sort. Once the field has data its key and type are fixed and narrowing is refused with the count of affected
 * modifications. `facet` and `searchable` are shown read-only (ADR-235: the Discover facet set is fixed in V1).
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ categoryId: number; field: SchemaField | null; types: string[]; testId: string }>();

interface Option {
    value: string;
    de: string;
    en: string;
}
const form = reactive({
    key: '',
    de: '',
    en: '',
    type: 'text',
    unit: '',
    min: '',
    max: '',
    step: '',
    options: [] as Option[],
    pattern: '',
    example: '',
    required: false,
    sort: '',
    reason: '',
});
const write = useCatalogWrite();
const failed = qaDialogFailed();
const editing = computed(() => props.field !== null);
const withData = computed(() => props.field?.data ?? 0);
const locked = computed(() => withData.value > 0);
const archived = computed(() => props.field?.archived_at !== null && props.field?.archived_at !== undefined);

// DQ-605: the locale's decimal mark in the inputs, without grouping, so the value reads back unchanged (decimal() takes both marks).
const num = (v: number | null | undefined): string => (v === null || v === undefined ? '' : getActiveLanguage() === 'en' ? String(v) : String(v).replace('.', ','));
watch(
    open,
    (value) => {
        if (!value) return;
        write.reset();
        const f = props.field;
        const options = Array.isArray(f?.options) ? (f.options as { value: string; label: { de?: string; en?: string } }[]) : [];
        const text = f !== null && !Array.isArray(f.options) && f.options !== null ? (f.options as { pattern?: string; example?: string }) : {};
        Object.assign(form, {
            key: f?.key ?? '',
            de: f?.label.de ?? '',
            en: f?.label.en ?? '',
            type: f?.type ?? 'text',
            unit: f?.unit ?? '',
            min: num(f?.min),
            max: num(f?.max),
            step: num(f?.step),
            options: options.map((o) => ({ value: o.value, de: o.label.de ?? '', en: o.label.en ?? '' })),
            pattern: text.pattern ?? '',
            example: text.example ?? '',
            required: f?.required ?? false,
            sort: f ? String(f.sort) : '',
            reason: '',
        });
    },
    { immediate: true },
);

const typeOptions = computed<SelectOption[]>(() => props.types.map((value) => ({ value, label: trans(`catalog.field_types.${value}`) })));
const typeModel = computed({ get: () => form.type, set: (v: string | undefined) => (form.type = v ?? 'text') });
watch(
    () => form.type,
    (type) => {
        if (type === 'select' && form.options.length === 0) form.options.push({ value: '', de: '', en: '' });
    },
);

const decimal = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));

function payload(): Record<string, unknown> {
    const data: Record<string, unknown> = {
        key: form.key.trim(),
        label: { de: form.de.trim(), en: form.en.trim() },
        type: form.type,
        unit: form.unit.trim() || null,
        required: archived.value ? false : form.required,
        reason: form.reason.trim(),
    };
    if (form.sort.trim() !== '') data.sort = Number.parseInt(form.sort, 10);
    if (form.type === 'number') Object.assign(data, { min: decimal(form.min), max: decimal(form.max), step: decimal(form.step) });
    if (form.type === 'select') data.options = form.options.map((o) => ({ value: o.value.trim(), label: { de: o.de.trim(), en: o.en.trim() } }));
    if (form.type === 'text') data.options = form.pattern.trim() === '' && form.example.trim() === '' ? null : { pattern: form.pattern.trim() || null, example: form.example.trim() || null };
    return data;
}

function save(): void {
    const f = props.field;
    const url =
        f === null
            ? routeOr('admin.catalog.fields.store', `/admin/catalog/mod-categories/${props.categoryId}/fields`, { category: props.categoryId })
            : routeOr('admin.catalog.fields.update', `/admin/catalog/mod-fields/${f.id}`, { field: f.id });
    write.run(f === null ? 'post' : 'patch', url, payload(), { onSuccess: () => (open.value = false) });
}

const err = (key: string): string | null => write.errors.value[key] ?? null;
const optionError = (index: number, part: 'value' | 'label.de' | 'label.en'): string | null => write.errors.value[`options.${index}.${part}`] ?? null;
const formError = computed(() => (failed ? trans('ui.state.server_error') : (write.errors.value.refused ?? write.errors.value.options ?? null)));
const formId = `${props.testId}-form`;
</script>

<template>
    <Drawer
        v-model:open="open"
        :title="editing && field ? trans('catalog.field.edit_title', { label: fieldLabel(field) }) : trans('catalog.field.new_title')"
        :description="locked ? transChoice('catalog.field.has_data', withData, { count: formatNumber(withData) }) : editing ? trans('catalog.field.no_data') : undefined"
        size="lg"
        :dismissible="!write.processing.value"
        :test-id="testId"
    >
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="save">
            <FormError :message="formError" :test-id="`${testId}.error`" />
            <div class="flex flex-wrap gap-12">
                <div class="min-w-200 grow basis-0">
                    <Field :label="trans('catalog.field.key')" :hint="locked ? trans('catalog.field.key_locked') : trans('catalog.field.key_hint')" :error="err('key')" required>
                        <Input v-model="form.key" maxlength="60" :disabled="locked" spellcheck="false" autocomplete="off" class="sc-key" :data-testid="`${testId}.key`" />
                    </Field>
                </div>
                <div class="w-200">
                    <Field :label="trans('catalog.field.type')" :hint="locked ? trans('catalog.field.type_locked') : undefined" :error="err('type')" required>
                        <Select v-model="typeModel" :options="typeOptions" :disabled="locked" :data-testid="`${testId}.type`" />
                    </Field>
                </div>
            </div>
            <div class="flex flex-wrap gap-12">
                <div class="min-w-200 grow basis-0">
                    <Field :label="trans('catalog.field.label_de')" :error="err('label.de') ?? err('label')" required><Input v-model="form.de" maxlength="80" :data-testid="`${testId}.label-de`" /></Field>
                </div>
                <div class="min-w-200 grow basis-0">
                    <Field :label="trans('catalog.field.label_en')" :error="err('label.en')" required><Input v-model="form.en" maxlength="80" :data-testid="`${testId}.label-en`" /></Field>
                </div>
            </div>

            <div v-if="form.type === 'number'" class="flex flex-wrap gap-12" :data-testid="`${testId}.number`">
                <div class="w-120"><Field :label="trans('catalog.field.unit')" :error="err('unit')" optional><Input v-model="form.unit" maxlength="20" :data-testid="`${testId}.unit`" /></Field></div>
                <div class="w-120"><Field :label="trans('catalog.field.min')" :error="err('min')" optional><Input v-model="form.min" inputmode="decimal" maxlength="12" tnum /></Field></div>
                <div class="w-120"><Field :label="trans('catalog.field.max')" :error="err('max')" optional><Input v-model="form.max" inputmode="decimal" maxlength="12" tnum /></Field></div>
                <div class="w-120"><Field :label="trans('catalog.field.step')" :error="err('step')" optional><Input v-model="form.step" inputmode="decimal" maxlength="12" tnum /></Field></div>
            </div>
            <div v-else-if="form.type === 'text'" class="flex flex-wrap gap-12">
                <div class="w-120"><Field :label="trans('catalog.field.unit')" :error="err('unit')" optional><Input v-model="form.unit" maxlength="20" /></Field></div>
                <div class="min-w-200 grow basis-0">
                    <Field :label="trans('catalog.field.pattern')" :hint="trans('catalog.field.pattern_hint')" :error="err('options.pattern')" optional><Input v-model="form.pattern" maxlength="200" spellcheck="false" class="sc-key" /></Field>
                </div>
                <div class="min-w-160 grow basis-0">
                    <Field :label="trans('catalog.field.example')" :error="err('options.example')" optional><Input v-model="form.example" maxlength="60" /></Field>
                </div>
            </div>

            <fieldset v-if="form.type === 'select'" class="flex flex-col gap-8" :data-testid="`${testId}.options`">
                <legend class="mb-4 text-admin-base-strong text-ink">{{ trans('catalog.field.options') }}</legend>
                <p class="text-admin-base text-ink-3">{{ locked ? trans('catalog.field.options_locked') : trans('catalog.field.options_hint') }}</p>
                <div class="flex items-center gap-8" aria-hidden="true">
                    <span class="w-120 shrink-0 text-caption text-ink-3">{{ trans('catalog.field.option_value') }}</span>
                    <span class="min-w-0 grow basis-0 text-caption text-ink-3">{{ trans('catalog.field.option_de') }}</span>
                    <span class="min-w-0 grow basis-0 text-caption text-ink-3">{{ trans('catalog.field.option_en') }}</span>
                    <span class="w-40 shrink-0" />
                </div>
                <div v-for="(option, index) in form.options" :key="index" class="flex items-start gap-8" :data-testid="`${testId}.option`">
                    <div class="w-120 shrink-0">
                        <Field :label="trans('catalog.field.option_value_n', { n: String(index + 1) })" hide-label :error="optionError(index, 'value')">
                            <Input v-model="option.value" maxlength="40" spellcheck="false" class="sc-key" />
                        </Field>
                    </div>
                    <div class="min-w-0 grow basis-0">
                        <Field :label="trans('catalog.field.option_de_n', { n: String(index + 1) })" hide-label :error="optionError(index, 'label.de')"><Input v-model="option.de" maxlength="80" /></Field>
                    </div>
                    <div class="min-w-0 grow basis-0">
                        <Field :label="trans('catalog.field.option_en_n', { n: String(index + 1) })" hide-label :error="optionError(index, 'label.en')"><Input v-model="option.en" maxlength="80" /></Field>
                    </div>
                    <IconButton :icon="PhTrash" :label="trans('catalog.field.option_remove', { n: String(index + 1) })" size="md" variant="destructive" :disabled="form.options.length <= 1" @click="form.options.splice(index, 1)" />
                </div>
                <div><Button size="sm" variant="secondary" :icon="PhPlus" :disabled="form.options.length >= 100" @click="form.options.push({ value: '', de: '', en: '' })">{{ trans('catalog.field.option_add') }}</Button></div>
            </fieldset>

            <div class="flex flex-wrap items-end gap-16">
                <div class="flex h-40 items-center"><Switch v-model="form.required" :disabled="archived" :label="trans('catalog.field.required')" :data-testid="`${testId}.required`" /></div>
                <div class="w-120"><Field :label="trans('catalog.fields.sort')" :error="err('sort')" optional><Input v-model="form.sort" inputmode="numeric" maxlength="6" tnum /></Field></div>
            </div>
            <p v-if="archived" class="text-admin-base text-ink-3">{{ trans('catalog.field.archived_required') }}</p>

            <section class="flex flex-col gap-8 rounded-sm border border-line-subtle px-16 py-12" :data-testid="`${testId}.discover`">
                <h3 class="flex items-center gap-8 text-admin-base-strong text-ink"><PhInfo :size="16" class="text-ink-3" aria-hidden="true" />{{ trans('catalog.field.discover_title') }}</h3>
                <dl class="flex flex-wrap gap-x-24 gap-y-4 text-admin-base">
                    <div class="flex gap-8"><dt class="text-ink-3">{{ trans('catalog.field.searchable') }}</dt><dd class="text-ink">{{ trans(field?.searchable ? 'catalog.field.yes' : 'catalog.field.no') }}</dd></div>
                    <div class="flex gap-8"><dt class="text-ink-3">{{ trans('catalog.field.facet') }}</dt><dd class="text-ink">{{ trans(field?.facet ? 'catalog.field.yes' : 'catalog.field.no') }}</dd></div>
                </dl>
                <p class="text-admin-base text-ink-3">{{ trans('catalog.field.discover_body') }}</p>
            </section>

            <Field :label="trans('catalog.fields.reason')" :hint="trans('catalog.field.reason_hint')" :error="err('reason')" required>
                <Textarea v-model="form.reason" :rows="2" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
            </Field>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="write.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="formId" variant="primary" :loading="write.processing.value" :data-testid="`${testId}.save`">{{ trans('catalog.field.save') }}</Button>
        </template>
    </Drawer>
</template>
