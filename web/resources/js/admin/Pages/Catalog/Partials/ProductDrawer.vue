<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { PhPlus, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { Button, Combobox, Drawer, Field, IconButton, Input, SegmentedControl, Select, Textarea, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { useCatalogWrite } from '../shared';
import AliasChips from './AliasChips.vue';
import FormError from './FormError.vue';
import { attributePairs, productWriteUrl, type CategoryOption, type Pair, type ProductDetail } from './products';

/**
 * ADM-57 "Neues Teil" and "Bearbeiten" (09 §8.9; catalog.manage): brand, category, name, product line, maker link, affiliate link
 * (members see it marked "Anzeige", UWG), other spellings, and the facts the maker states, per language (at most 12 each; 09 §8.9: no
 * invented specs). Reason optional (audit). The brand list loads when the drawer opens (`brandChoices`, every brand not merged).
 */
const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ product: ProductDetail | null; categories: CategoryOption[]; brandChoices?: { value: number; label: string }[]; testId: string }>();

const MAX_FACTS = 12;
interface Form {
    brand_id: string | undefined;
    category_id: string | undefined;
    name: string;
    line: string;
    url: string;
    affiliate_url: string;
    aliases: string[];
    facts: Record<'de' | 'en', Pair[]>;
    reason: string;
}
const blank = (): Form => ({ brand_id: undefined, category_id: undefined, name: '', line: '', url: '', affiliate_url: '', aliases: [], facts: { de: [], en: [] }, reason: '' });
const form = reactive<Form>(blank());
const write = useCatalogWrite();
const failed = qaDialogFailed();
const editing = computed(() => props.product !== null);
const brandsLoading = ref(false);
const factsLocale = ref<'de' | 'en'>('de');

watch(
    open,
    (value) => {
        if (!value) return;
        write.reset();
        factsLocale.value = 'de';
        const p = props.product;
        const category = p === null ? undefined : props.categories.find((c) => c.key === p.category);
        Object.assign(
            form,
            p === null
                ? blank()
                : {
                      ...blank(),
                      brand_id: String(p.brand.id),
                      category_id: category ? String(category.value) : undefined,
                      name: p.name,
                      line: p.line ?? '',
                      url: p.url ?? '',
                      affiliate_url: p.affiliate_url ?? '',
                      aliases: [...p.aliases],
                      facts: { de: attributePairs(p.attributes, 'de'), en: attributePairs(p.attributes, 'en') },
                  },
        );
        if (props.brandChoices === undefined) {
            router.reload({ only: ['brandChoices'], onStart: () => (brandsLoading.value = true), onFinish: () => (brandsLoading.value = false) });
        }
    },
    { immediate: true },
);

const brandOptions = computed<SelectOption[]>(() => {
    const list = (props.brandChoices ?? []).map((b) => ({ value: String(b.value), label: b.label }));
    // The current brand stays choosable while the full list loads.
    const p = props.product;
    if (p !== null && !list.some((b) => b.value === String(p.brand.id))) list.unshift({ value: String(p.brand.id), label: p.brand.name });
    return list;
});
const categoryOptions = computed<SelectOption[]>(() => props.categories.map((c) => ({ value: String(c.value), label: c.label })));
const localeOptions = computed(() => [
    { value: 'de', label: trans('catalog.products.facts.de') },
    { value: 'en', label: trans('catalog.products.facts.en') },
]);
const localeModel = computed({ get: () => factsLocale.value, set: (v: string) => (factsLocale.value = v === 'en' ? 'en' : 'de') });
const facts = computed(() => form.facts[factsLocale.value]);

function addFact(): void {
    if (facts.value.length < MAX_FACTS) facts.value.push({ label: '', value: '' });
}

function payload(): Record<string, unknown> {
    const table = (rows: Pair[]): Record<string, string> => Object.fromEntries(rows.map((r) => [r.label.trim(), r.value.trim()]).filter(([label, value]) => label !== '' && value !== ''));
    return {
        brand_id: form.brand_id === undefined ? null : Number(form.brand_id),
        category_id: form.category_id === undefined ? null : Number(form.category_id),
        name: form.name.trim(),
        line: form.line.trim() || null,
        url: form.url.trim() || null,
        affiliate_url: form.affiliate_url.trim() || null,
        aliases: form.aliases,
        attributes: { de: table(form.facts.de), en: table(form.facts.en) },
        reason: form.reason.trim() || null,
    };
}

function save(): void {
    const errors: Record<string, string> = {};
    if (form.brand_id === undefined) errors.brand_id = trans('catalog.products.errors.brand');
    if (form.category_id === undefined) errors.category_id = trans('catalog.products.errors.category');
    if (form.name.trim().length < 2) errors.name = trans('catalog.products.errors.name');
    if (Object.keys(errors).length > 0) {
        write.errors.value = errors;
        return;
    }
    write.run(editing.value ? 'patch' : 'post', productWriteUrl(props.product?.id), payload(), { onSuccess: () => (open.value = false) });
}

const errorOf = (key: string): string | null => write.errors.value[key] ?? null;
const factsError = computed(() => Object.entries(write.errors.value).find(([key]) => key.startsWith('attributes'))?.[1] ?? null);
const formError = computed(() => (failed ? trans('ui.state.server_error') : (write.errors.value.refused ?? write.errors.value.reason ?? null)));
const formId = computed(() => `${props.testId}-form`);
</script>

<template>
    <Drawer v-model:open="open" :title="trans(editing ? 'catalog.products.drawer.edit' : 'catalog.products.drawer.new')" :description="trans('catalog.products.drawer.body')" size="lg" :dismissible="!write.processing.value" :test-id="testId">
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="save">
            <FormError :message="formError" :test-id="`${testId}.error`" />
            <div class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                <Field :label="trans('catalog.products.fields.brand')" :hint="brandsLoading ? trans('catalog.products.fields.brand_loading') : undefined" :error="errorOf('brand_id')" required>
                    <Combobox v-model="form.brand_id" :options="brandOptions" :placeholder="trans('catalog.products.fields.brand_placeholder')" :data-testid="`${testId}.brand`" />
                </Field>
                <Field :label="trans('catalog.products.fields.category')" :error="errorOf('category_id')" required>
                    <Select v-model="form.category_id" :options="categoryOptions" :placeholder="trans('catalog.products.fields.category_placeholder')" :data-testid="`${testId}.category`" />
                </Field>
            </div>
            <Field :label="trans('catalog.products.fields.name')" :hint="trans('catalog.products.fields.name_hint')" :error="errorOf('name')" required>
                <Input v-model="form.name" maxlength="160" autocomplete="off" :data-testid="`${testId}.name`" />
            </Field>
            <Field :label="trans('catalog.products.fields.line')" :hint="trans('catalog.products.fields.line_hint')" :error="errorOf('line')" optional>
                <Input v-model="form.line" maxlength="120" autocomplete="off" :data-testid="`${testId}.line`" />
            </Field>
            <div class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                <Field :label="trans('catalog.products.fields.url')" :hint="trans('catalog.products.fields.url_hint')" :error="errorOf('url')" optional>
                    <Input v-model="form.url" type="url" inputmode="url" maxlength="500" spellcheck="false" autocomplete="off" :data-testid="`${testId}.url`" />
                </Field>
                <Field :label="trans('catalog.products.fields.affiliate_url')" :hint="trans('catalog.products.fields.affiliate_hint')" :error="errorOf('affiliate_url')" optional>
                    <Input v-model="form.affiliate_url" type="url" inputmode="url" maxlength="500" spellcheck="false" autocomplete="off" :data-testid="`${testId}.affiliate`" />
                </Field>
            </div>
            <AliasChips v-model="form.aliases" :error="errorOf('aliases') ?? errorOf('aliases.0')" :test-id="`${testId}.aliases`" />

            <fieldset class="flex flex-col gap-8">
                <legend class="mb-4 text-admin-base-strong text-ink">{{ trans('catalog.products.facts.title') }}</legend>
                <p class="text-caption text-ink-3">{{ trans('catalog.products.facts.hint') }}</p>
                <SegmentedControl v-model="localeModel" class="self-start" :options="localeOptions" :label="trans('catalog.products.facts.language')" :data-testid="`${testId}.facts-locale`" />
                <p v-if="factsError" class="text-admin-base text-danger" role="alert">{{ factsError }}</p>
                <ul class="flex flex-col gap-8" :data-testid="`${testId}.facts`">
                    <li v-for="(fact, index) in facts" :key="`${factsLocale}-${index}`" class="flex items-end gap-8">
                        <div class="min-w-0 grow basis-0">
                            <Field :label="trans('catalog.products.facts.label', { n: String(index + 1) })">
                                <Input v-model="fact.label" size="sm" maxlength="60" autocomplete="off" :placeholder="trans('catalog.products.facts.label_placeholder')" />
                            </Field>
                        </div>
                        <div class="min-w-0 grow-2 basis-0">
                            <Field :label="trans('catalog.products.facts.value', { n: String(index + 1) })">
                                <Input v-model="fact.value" size="sm" maxlength="120" autocomplete="off" :placeholder="trans('catalog.products.facts.value_placeholder')" />
                            </Field>
                        </div>
                        <IconButton :icon="PhX" size="sm" :label="trans('catalog.products.facts.remove', { n: String(index + 1) })" @click="facts.splice(index, 1)" />
                    </li>
                </ul>
                <Button v-if="facts.length < MAX_FACTS" type="button" size="sm" variant="secondary" :icon="PhPlus" class="self-start" :data-testid="`${testId}.facts-add`" @click="addFact">{{ trans('catalog.products.facts.add') }}</Button>
            </fieldset>

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
