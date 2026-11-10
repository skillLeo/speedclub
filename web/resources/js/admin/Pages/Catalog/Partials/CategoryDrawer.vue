<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import { Button, Drawer, Field, Input, Switch, Textarea } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { routeOr } from '../../../lib/routes';
import FormError from './FormError.vue';
import { categoryGlyph, useCatalogWrite } from '../shared';

/**
 * ADM-15 category create / edit (catalog.manage): key (fixed once a modification uses the category), names DE/EN, icon, sort (also its
 * search bit: 1–63; a sort taken by another category swaps the two), active. Edits need a reason (they rebuild the search rows).
 */
export interface CategoryRow {
    id: number;
    key: string;
    name: { de?: string; en?: string };
    icon: string | null;
    sort: number;
    active: boolean;
    mods: number;
}

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ category: CategoryRow | null; testId: string }>();

const form = reactive({ key: '', de: '', en: '', icon: '', sort: '', active: true, reason: '' });
const write = useCatalogWrite();
const failed = qaDialogFailed();
const editing = computed(() => props.category !== null);
const keyLocked = computed(() => (props.category?.mods ?? 0) > 0);

watch(
    open,
    (value) => {
        if (!value) return;
        write.reset();
        const c = props.category;
        Object.assign(form, { key: c?.key ?? '', de: c?.name.de ?? '', en: c?.name.en ?? '', icon: c?.icon ?? '', sort: c ? String(c.sort) : '', active: c?.active ?? true, reason: '' });
    },
    { immediate: true },
);

function save(): void {
    const data: Record<string, unknown> = { name: { de: form.de.trim(), en: form.en.trim() }, icon: form.icon.trim() || null, active: form.active, reason: form.reason.trim() || null };
    if (!editing.value || (!keyLocked.value && form.key.trim() !== props.category?.key)) data.key = form.key.trim();
    if (form.sort.trim() !== '' && Number(form.sort) !== props.category?.sort) data.sort = Number.parseInt(form.sort, 10);
    const c = props.category;
    const url = c === null ? routeOr('admin.catalog.categories.store', '/admin/catalog/mod-categories') : routeOr('admin.catalog.categories.update', `/admin/catalog/mod-categories/${c.id}`, { category: c.id });
    write.run(c === null ? 'post' : 'patch', url, data, { onSuccess: () => (open.value = false) });
}

const err = (key: string): string | null => write.errors.value[key] ?? null;
const formError = computed(() => (failed ? trans('ui.state.server_error') : (write.errors.value.refused ?? null)));
const formId = `${props.testId}-form`;
</script>

<template>
    <Drawer v-model:open="open" :title="trans(editing ? 'catalog.category.edit_title' : 'catalog.category.new_title')" :dismissible="!write.processing.value" :test-id="testId">
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="save">
            <FormError :message="formError" :test-id="`${testId}.error`" />
            <Field :label="trans('catalog.category.key')" :hint="keyLocked ? trans('catalog.category.key_locked', { count: String(category?.mods ?? 0) }) : trans('catalog.category.key_hint')" :error="err('key')" required>
                <Input v-model="form.key" maxlength="40" :disabled="keyLocked" spellcheck="false" autocomplete="off" class="sc-key" :data-testid="`${testId}.key`" />
            </Field>
            <div class="flex flex-wrap gap-12">
                <div class="min-w-160 grow basis-0">
                    <Field :label="trans('catalog.category.name_de')" :error="err('name.de') ?? err('name')" required><Input v-model="form.de" maxlength="60" :data-testid="`${testId}.name-de`" /></Field>
                </div>
                <div class="min-w-160 grow basis-0">
                    <Field :label="trans('catalog.category.name_en')" :error="err('name.en')" required><Input v-model="form.en" maxlength="60" :data-testid="`${testId}.name-en`" /></Field>
                </div>
            </div>
            <div class="flex flex-wrap gap-12">
                <div class="min-w-160 grow basis-0">
                    <Field :label="trans('catalog.category.icon')" :hint="trans('catalog.category.icon_hint')" :error="err('icon')" optional>
                        <Input v-model="form.icon" maxlength="60" spellcheck="false" class="sc-key">
                            <!-- DQ-595: the glyph the key stands for, as members will see it. -->
                            <template #trailing><component :is="categoryGlyph(form.icon)" :size="20" class="mr-8 text-ink-2" aria-hidden="true" data-testid="ADM-15.drawer.icon-preview" /></template>
                        </Input>
                    </Field>
                </div>
                <div class="w-120">
                    <Field :label="trans('catalog.fields.sort')" :hint="trans('catalog.category.sort_hint')" :error="err('sort')" optional><Input v-model="form.sort" inputmode="numeric" maxlength="2" tnum /></Field>
                </div>
            </div>
            <Switch v-model="form.active" :label="trans('catalog.category.active')" />
            <Field
                :label="trans('catalog.fields.reason')"
                :hint="editing ? trans('ui.confirm.reason_hint') : trans('catalog.fields.reason_optional_hint')"
                :error="err('reason')"
                :required="editing"
                :optional="!editing"
            >
                <Textarea v-model="form.reason" :rows="2" :maxlength="1000" :data-testid="`${testId}.reason`" />
            </Field>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="write.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="formId" variant="primary" :loading="write.processing.value" :data-testid="`${testId}.save`">{{ trans(editing ? 'catalog.actions.save' : 'catalog.actions.create') }}</Button>
        </template>
    </Drawer>
</template>
