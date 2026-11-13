<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref } from 'vue';
import { EmptyQueue, Field, Input, SegmentedControl, Select, Switch, type SelectOption } from '../../../Components/ui';
import { formLayout, unitOf, type LayoutRow } from './formLayout';
import type { SchemaField } from './schema';

/**
 * ADM-15 preview of the member form for the category (m3.3-contract §2, DQ-588): the fields a member is offered now (archived ones are
 * not), laid out as the app lays them out (formLayout = GAR-10's modLayout: FELGEN / REIFEN, front and rear side by side, the rear
 * diameter once Mischbereifung is on), in their language, with the app's units (″, J) and placeholders, as controls to try out.
 * Nothing is saved.
 */
const props = defineProps<{ fields: SchemaField[]; categoryKey: string; categoryName: { de?: string; en?: string }; testId: string }>();

const locale = ref<'de' | 'en'>('de');
const localeModel = computed({ get: () => locale.value, set: (v: string) => (locale.value = v === 'en' ? 'en' : 'de') });
const live = computed(() => props.fields.filter((f) => f.archived_at === null).sort((a, b) => a.sort - b.sort || a.id - b.id));
const values = reactive<Record<string, string>>({});
const flags = reactive<Record<string, boolean>>({});
const groups = computed(() => formLayout(props.categoryKey, live.value, flags.staggered === true));

const label = (f: SchemaField): string => (locale.value === 'en' ? f.label.en : f.label.de) ?? f.key;
const options = (f: SchemaField): SelectOption[] =>
    Array.isArray(f.options) ? f.options.map((o) => ({ value: o.value, label: (locale.value === 'en' ? o.label.en : o.label.de) ?? o.value })) : [];

/** A number as the app writes it: the locale's decimal mark, a real minus sign (DQ-605). */
function number(value: number): string {
    return new Intl.NumberFormat(locale.value === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 2 }).format(value).replace('-', '−');
}

/** The app's placeholders: "13 bis 24" for a range, "z. B. 5×114,3" for the bolt pattern, the schema's example for text. */
function placeholder(f: SchemaField): string | undefined {
    const t = (key: string, params: Record<string, string> = {}): string => trans(`catalog.preview.${key}`, params);
    if (f.key === 'bolt_pattern') return locale.value === 'en' ? t('bolt_pattern_en') : t('bolt_pattern');
    if (f.type === 'number' && f.min !== null && f.max !== null) return t(locale.value === 'en' ? 'range_en' : 'range', { min: number(f.min), max: number(f.max) });
    if (f.type === 'text' && f.options !== null && !Array.isArray(f.options) && f.options.example) return t(locale.value === 'en' ? 'example_en' : 'example', { example: f.options.example });
    if (f.type === 'brand') return t(locale.value === 'en' ? 'brand_en' : 'brand');
    return undefined;
}

const cells = (row: LayoutRow): SchemaField[] => (row.kind === 'pair' ? [...row.fields] : [row.field]);
</script>

<template>
    <div class="flex flex-col gap-16" :data-testid="testId">
        <div class="flex flex-wrap items-center justify-between gap-12">
            <p class="max-w-560 text-admin-base text-ink-2">{{ trans('catalog.preview.intro') }}</p>
            <SegmentedControl v-model="localeModel" class="self-start" :options="[{ value: 'de', label: trans('catalog.preview.de') }, { value: 'en', label: trans('catalog.preview.en') }]" :label="trans('catalog.preview.language')" />
        </div>
        <EmptyQueue v-if="live.length === 0" variant="first" :title="trans('catalog.preview.empty_title')" :body="trans('catalog.preview.empty_body')" />
        <div v-else class="flex max-w-560 flex-col gap-24 rounded-sm border border-line px-24 py-24" :lang="locale">
            <p class="text-headline text-ink">{{ (locale === 'en' ? categoryName.en : categoryName.de) ?? '' }}</p>
            <section v-for="group in groups" :key="group.key" class="flex flex-col gap-16" :aria-label="trans(`catalog.preview.groups.${group.key}_${locale}`)" :data-testid="`${testId}.group.${group.key}`">
                <h3 class="text-caption text-ink-3 uppercase">{{ trans(`catalog.preview.groups.${group.key}_${locale}`) }}</h3>
                <template v-for="row in group.rows" :key="cells(row)[0]?.key">
                    <Switch v-if="row.kind === 'switch'" v-model="flags[row.field.key]" :label="label(row.field)" :data-testid="`${testId}.${row.field.key}`" />
                    <div v-else :class="row.kind === 'pair' ? 'grid grid-cols-2 gap-12' : 'flex flex-col'" :data-testid="row.kind === 'pair' ? `${testId}.pair.${row.fields[0].key}` : undefined">
                        <Field v-for="f in cells(row)" :key="f.key" :label="label(f)" :required="f.required">
                            <Select v-if="f.type === 'select'" :model-value="values[f.key] || undefined" :options="options(f)" :placeholder="trans(locale === 'en' ? 'catalog.preview.choose_en' : 'catalog.preview.choose')" :data-testid="`${testId}.${f.key}`" @update:model-value="(v: string | undefined) => (values[f.key] = v ?? '')" />
                            <Input v-else v-model="values[f.key]" :inputmode="f.type === 'number' ? 'decimal' : undefined" :tnum="f.type === 'number'" :placeholder="placeholder(f)" :data-testid="`${testId}.${f.key}`">
                                <template v-if="unitOf(f)" #trailing><span class="pr-8 text-admin-base text-ink-3">{{ unitOf(f) }}</span></template>
                            </Input>
                        </Field>
                    </div>
                </template>
            </section>
        </div>
    </div>
</template>
