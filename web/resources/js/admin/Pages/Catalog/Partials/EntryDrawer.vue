<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { Button, Drawer, Field, Input, Select, Switch, Textarea, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { fetchImpact, entryUrl, useCatalogWrite, type CatalogEntry, type CatalogLevel } from '../shared';
import FormError from './FormError.vue';
import AliasChips from './AliasChips.vue';

/**
 * ADM-14 / ADM-16 "Neu" and "Bearbeiten" (m3.3-contract §2, catalog.manage): the fields of the level. The slug follows the name until
 * someone types one; once anything points at the entry it is locked (the drawer asks the server, CatalogReferences). Reason optional.
 * Field errors and refusals (slug taken, slug locked) come back at their field.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{ level: CatalogLevel; entry: CatalogEntry | null; parent?: { make_id?: number; model_id?: number }; parentName?: string | null; categories?: SelectOption[]; testId: string }>(),
    { parent: () => ({}), parentName: null, categories: () => [] },
);

interface Form {
    name: string;
    slug: string;
    country: string;
    is_popular: boolean;
    sort: string;
    active: boolean;
    year_from: string;
    year_to: string;
    category_hint: string;
    aliases: string[];
    reason: string;
}
const blank = (): Form => ({ name: '', slug: '', country: '', is_popular: false, sort: '', active: true, year_from: '', year_to: '', category_hint: '', aliases: [], reason: '' });
const form = reactive<Form>(blank());
const write = useCatalogWrite();
const slugLocked = ref(false);
const failed = qaDialogFailed();
const editing = computed(() => props.entry !== null);

watch(
    open,
    (value) => {
        if (!value) return;
        write.reset();
        slugLocked.value = false;
        const e = props.entry;
        Object.assign(
            form,
            e === null
                ? blank()
                : {
                      ...blank(),
                      name: e.name,
                      slug: e.slug,
                      country: e.country ?? '',
                      is_popular: e.is_popular ?? false,
                      sort: e.sort === undefined ? '' : String(e.sort),
                      year_from: e.year_from ? String(e.year_from) : '',
                      year_to: e.year_to ? String(e.year_to) : '',
                      category_hint: e.category_hint ?? '',
                      aliases: [...(e.aliases ?? [])],
                  },
        );
        if (e !== null) {
            fetchImpact(props.level, e.id)
                .then((impact) => (slugLocked.value = impact.slug_locked))
                .catch(() => (slugLocked.value = true));
        }
    },
    { immediate: true },
);

const title = computed(() => trans(`catalog.drawer.${editing.value ? 'edit' : 'new'}.${props.level}`, { parent: props.parentName ?? '' }));
// Reka's SelectItem refuses an empty value (it means "cleared"): "Ohne Kategorie" is a sentinel that stores as no category.
const NONE = '*none';
const categoryModel = computed({ get: () => form.category_hint || NONE, set: (v: string | undefined) => (form.category_hint = v === undefined || v === NONE ? '' : v) });
const categoryOptions = computed<SelectOption[]>(() => [{ value: NONE, label: trans('catalog.brands.no_category') }, ...props.categories]);

const int = (value: string): number | null => (value.trim() === '' ? null : Number.parseInt(value, 10));

function payload(): Record<string, unknown> {
    const data: Record<string, unknown> = { name: form.name.trim(), reason: form.reason.trim() || null };
    const e = props.entry;
    if (form.slug.trim() !== '' && form.slug.trim() !== e?.slug) data.slug = form.slug.trim();
    if (props.level === 'make') Object.assign(data, { country: form.country.trim() || null, is_popular: form.is_popular, ...(form.sort.trim() !== '' ? { sort: int(form.sort) } : {}) });
    if (props.level === 'generation') Object.assign(data, { year_from: int(form.year_from), year_to: int(form.year_to) });
    if (props.level === 'brand') Object.assign(data, { category_hint: form.category_hint || null, aliases: form.aliases });
    if (!editing.value) {
        if (props.level !== 'brand') data.active = form.active;
        if (props.level === 'model') data.make_id = props.parent.make_id;
        if (props.level === 'generation') data.model_id = props.parent.model_id;
    }
    return data;
}

function save(): void {
    if (form.name.trim() === '') {
        write.errors.value = { name: trans('catalog.errors.name') };
        return;
    }
    write.run(editing.value ? 'patch' : 'post', entryUrl(props.level, props.entry?.id), payload(), { onSuccess: () => (open.value = false) });
}

const errorOf = (key: string): string | null => write.errors.value[key] ?? null;
const formError = computed(() => (failed ? trans('ui.state.server_error') : (write.errors.value.refused ?? write.errors.value.reason ?? null)));
const formId = computed(() => `${props.testId}-form`);
</script>

<template>
    <Drawer v-model:open="open" :title="title" :description="trans(`catalog.drawer.body.${level}`)" :dismissible="!write.processing.value" :test-id="testId">
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="save">
            <FormError :message="formError" :test-id="`${testId}.error`" />
            <Field :label="trans('catalog.fields.name')" :error="errorOf('name')" required>
                <Input v-model="form.name" :maxlength="level === 'brand' ? 120 : 100" autocomplete="off" :data-testid="`${testId}.name`" />
            </Field>
            <Field
                :label="trans('catalog.fields.slug')"
                :hint="slugLocked ? trans('catalog.fields.slug_locked') : editing ? trans('catalog.fields.slug_edit_hint') : trans('catalog.fields.slug_hint')"
                :error="errorOf('slug')"
                optional
            >
                <Input v-model="form.slug" :maxlength="level === 'brand' ? 140 : 120" :disabled="slugLocked" spellcheck="false" autocomplete="off" class="sc-key" :data-testid="`${testId}.slug`" />
            </Field>

            <template v-if="level === 'make'">
                <div class="flex flex-wrap gap-12">
                    <div class="w-160">
                        <Field :label="trans('catalog.fields.country')" :hint="trans('catalog.fields.country_hint')" :error="errorOf('country')" optional>
                            <Input v-model="form.country" maxlength="2" autocomplete="off" class="uppercase" :data-testid="`${testId}.country`" />
                        </Field>
                    </div>
                    <div class="w-160">
                        <Field :label="trans('catalog.fields.sort')" :hint="trans('catalog.fields.sort_hint')" :error="errorOf('sort')" optional>
                            <Input v-model="form.sort" inputmode="numeric" maxlength="7" tnum />
                        </Field>
                    </div>
                </div>
                <Switch v-model="form.is_popular" :label="trans('catalog.fields.popular')" :data-testid="`${testId}.popular`" />
            </template>

            <div v-if="level === 'generation'" class="flex flex-wrap gap-12">
                <div class="w-160">
                    <Field :label="trans('catalog.fields.year_from')" :error="errorOf('year_from')" optional><Input v-model="form.year_from" inputmode="numeric" maxlength="4" tnum :data-testid="`${testId}.year_from`" /></Field>
                </div>
                <div class="w-160">
                    <Field :label="trans('catalog.fields.year_to')" :error="errorOf('year_to')" optional><Input v-model="form.year_to" inputmode="numeric" maxlength="4" tnum :data-testid="`${testId}.year_to`" /></Field>
                </div>
            </div>

            <template v-if="level === 'brand'">
                <Field :label="trans('catalog.fields.category_hint')" :hint="trans('catalog.fields.category_hint_hint')" :error="errorOf('category_hint')" optional>
                    <Select v-model="categoryModel" :options="categoryOptions" :data-testid="`${testId}.category`" />
                </Field>
                <AliasChips v-model="form.aliases" :error="errorOf('aliases') ?? errorOf('aliases.0')" :test-id="`${testId}.aliases`" />
            </template>

            <Switch v-if="!editing && level !== 'brand'" v-model="form.active" :label="trans('catalog.fields.active')" />

            <Field :label="trans('catalog.fields.reason')" :hint="trans('catalog.fields.reason_optional_hint')" :error="errorOf('reason')" optional>
                <Textarea v-model="form.reason" :rows="2" :maxlength="1000" :data-testid="`${testId}.reason`" />
            </Field>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="write.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="formId" variant="primary" :loading="write.processing.value" :data-testid="`${testId}.save`">{{ trans(editing ? 'catalog.actions.save' : 'catalog.actions.create') }}</Button>
        </template>
    </Drawer>
</template>
