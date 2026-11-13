<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Button, Combobox, Drawer, Field, Input, SegmentedControl, Skeleton, Textarea, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { requestJson } from '../../../lib/http';
import { routeOr } from '../../../lib/routes';
import { yearsText, useCatalogWrite } from '../shared';
import FormError from './FormError.vue';

/**
 * ADM-14 Anfragen "Übernehmen" (m3.3-contract §2, catalog.manage): per level the entry from the catalogue or a new one (prefilled from
 * what the member typed; a name that already exists, merged aliases included, picks that entry on the server instead of a duplicate).
 * The member's car is relinked while it still names the car in free text, and the member is told in-app.
 */
export interface RequestRow {
    id: string;
    make_text: string | null;
    model_text: string | null;
    generation_text: string | null;
    member: { id: string; username: string | null } | null;
}

interface Options {
    makes: { id: number; name: string; slug: string }[];
    models: { id: number; make_id: number; name: string; slug: string }[];
    generations: { id: number; model_id: number; name: string; year_from: number | null; year_to: number | null }[];
}

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ request: RequestRow | null; testId: string }>();

const options = ref<Options | null>(null);
const loadState = ref<'loading' | 'ready' | 'error'>('loading');
type Mode = 'pick' | 'new' | 'none';
interface AcceptForm {
    makeMode: Mode;
    makeId: string | undefined;
    makeName: string;
    country: string;
    modelMode: Mode;
    modelId: string | undefined;
    modelName: string;
    generationMode: Mode;
    generationId: string | undefined;
    generationName: string;
    yearFrom: string;
    yearTo: string;
    reason: string;
}
const form = reactive<AcceptForm>({
    makeMode: 'pick',
    makeId: undefined,
    makeName: '',
    country: '',
    modelMode: 'pick',
    modelId: undefined,
    modelName: '',
    generationMode: 'none',
    generationId: undefined,
    generationName: '',
    yearFrom: '',
    yearTo: '',
    reason: '',
});
const write = useCatalogWrite();
const failed = qaDialogFailed();

const fold = (text: string | null | undefined): string =>
    (text ?? '')
        .toLocaleLowerCase('de')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '');

function prefill(): void {
    const r = props.request;
    const o = options.value;
    if (r === null || o === null) return;
    const make = o.makes.find((m) => fold(m.name) === fold(r.make_text));
    Object.assign(form, { makeMode: make ? 'pick' : 'new', makeId: make ? String(make.id) : undefined, makeName: make ? '' : (r.make_text ?? ''), country: '' });
    const model = make ? o.models.find((m) => m.make_id === make.id && fold(m.name) === fold(r.model_text)) : undefined;
    const hasModel = (r.model_text ?? '').trim() !== '';
    Object.assign(form, { modelMode: model ? 'pick' : hasModel ? 'new' : 'none', modelId: model ? String(model.id) : undefined, modelName: model ? '' : (r.model_text ?? '') });
    const hasGeneration = (r.generation_text ?? '').trim() !== '';
    const generation = model ? o.generations.find((g) => g.model_id === model.id && fold(g.name) === fold(r.generation_text)) : undefined;
    Object.assign(form, {
        generationMode: generation ? 'pick' : hasGeneration ? 'new' : 'none',
        generationId: generation ? String(generation.id) : undefined,
        generationName: generation ? '' : (r.generation_text ?? ''),
        yearFrom: '',
        yearTo: '',
    });
}

async function load(): Promise<void> {
    loadState.value = 'loading';
    try {
        options.value = await requestJson<Options>('get', routeOr('admin.catalog.vehicles.requests.options', '/admin/catalog/requests/options'));
        loadState.value = 'ready';
        prefill();
    } catch {
        loadState.value = 'error';
    }
}

watch(
    open,
    (value) => {
        if (!value) return;
        write.reset();
        form.reason = '';
        if (options.value === null) void load();
        else prefill();
    },
    { immediate: true },
);

const modeOptions = (none: boolean) => [
    { value: 'pick', label: trans('catalog.accept.mode.pick') },
    { value: 'new', label: trans('catalog.accept.mode.new') },
    ...(none ? [{ value: 'none', label: trans('catalog.accept.mode.none') }] : []),
];
const makeOptions = computed<SelectOption[]>(() => (options.value?.makes ?? []).map((m) => ({ value: String(m.id), label: m.name })));
const modelOptions = computed<SelectOption[]>(() =>
    (options.value?.models ?? []).filter((m) => form.makeMode === 'pick' && String(m.make_id) === form.makeId).map((m) => ({ value: String(m.id), label: m.name })),
);
const generationOptions = computed<SelectOption[]>(() =>
    (options.value?.generations ?? [])
        .filter((g) => form.modelMode === 'pick' && String(g.model_id) === form.modelId)
        .map((g) => ({ value: String(g.id), label: `${g.name} · ${yearsText(g.year_from, g.year_to)}` })),
);
// A new make has no models yet, a new model no generations: those levels can only be new (or left out).
watch(
    () => form.makeMode,
    (mode) => {
        if (mode === 'new' && form.modelMode === 'pick') form.modelMode = 'new';
    },
);
watch(
    () => form.modelMode,
    (mode) => {
        if (mode !== 'pick' && form.generationMode === 'pick') form.generationMode = mode === 'none' ? 'none' : 'new';
        if (mode === 'none') form.generationMode = 'none';
    },
);
const modelModes = computed(() => (form.makeMode === 'new' ? modeOptions(true).filter((o) => o.value !== 'pick') : modeOptions(true)));
const generationModes = computed(() => (form.modelMode === 'none' ? [] : form.modelMode === 'new' ? modeOptions(true).filter((o) => o.value !== 'pick') : modeOptions(true)));

const int = (value: string): number | undefined => (value.trim() === '' ? undefined : Number.parseInt(value, 10));
const local = ref<Record<string, string>>({});

function submit(): void {
    const r = props.request;
    if (r === null) return;
    const next: Record<string, string> = {};
    if (form.makeMode === 'pick' && !form.makeId) next.make_id = trans('catalog.accept.errors.make');
    if (form.makeMode === 'new' && form.makeName.trim() === '') next.make_name = trans('catalog.accept.errors.make');
    if (form.modelMode === 'pick' && !form.modelId) next.model_id = trans('catalog.accept.errors.model');
    if (form.modelMode === 'new' && form.modelName.trim() === '') next.model_name = trans('catalog.accept.errors.model');
    if (form.generationMode === 'pick' && !form.generationId) next.generation_id = trans('catalog.accept.errors.generation');
    if (form.generationMode === 'new' && form.generationName.trim() === '') next.generation_name = trans('catalog.accept.errors.generation');
    local.value = next;
    if (Object.keys(next).length > 0) return;

    const data: Record<string, unknown> = { reason: form.reason.trim() || null };
    if (form.makeMode === 'pick') data.make_id = Number(form.makeId);
    else Object.assign(data, { make_name: form.makeName.trim(), country: form.country.trim() || null });
    if (form.modelMode === 'pick') data.model_id = Number(form.modelId);
    if (form.modelMode === 'new') data.model_name = form.modelName.trim();
    if (form.generationMode === 'pick') data.generation_id = Number(form.generationId);
    if (form.generationMode === 'new') Object.assign(data, { generation_name: form.generationName.trim(), year_from: int(form.yearFrom), year_to: int(form.yearTo) });
    const url = routeOr('admin.catalog.vehicles.requests.accept', `/admin/catalog/requests/${r.id}/accept`, { catalogRequest: r.id });
    write.run('post', url, data, { onSuccess: () => (open.value = false) });
}

const err = (key: string): string | null => local.value[key] ?? write.errors.value[key] ?? null;
const formError = computed(() => (failed ? trans('ui.state.server_error') : (write.errors.value.refused ?? null)));
const asked = computed(() => [props.request?.make_text, props.request?.model_text, props.request?.generation_text].filter(Boolean).join(' · '));
const formId = `${props.testId}-form`;
</script>

<template>
    <Drawer v-model:open="open" :title="trans('catalog.accept.title')" :description="trans('catalog.accept.body')" size="lg" :dismissible="!write.processing.value" :test-id="testId">
        <div v-if="loadState === 'loading'" class="flex flex-col gap-16" aria-busy="true" :data-testid="`${testId}.loading`">
            <Skeleton shape="text" class="w-320" />
            <div v-for="n in 3" :key="n" class="flex flex-col gap-8"><Skeleton shape="text" class="w-120" /><Skeleton class="h-32 w-240" /><Skeleton class="h-40 w-full" /></div>
        </div>
        <StateBlock v-else-if="loadState === 'error'" kind="error" :title="trans('catalog.accept.load_error')" :body="trans('catalog.error_body')" @retry="load" />
        <form v-else :id="formId" class="flex flex-col gap-24" novalidate @submit.prevent="submit">
            <FormError :message="formError" :test-id="`${testId}.error`" />
            <p class="rounded-sm border border-line-subtle px-12 py-8 text-admin-base text-ink-2" :data-testid="`${testId}.asked`">
                {{ trans('catalog.accept.asked', { text: asked, member: request?.member?.username ? `@${request.member.username}` : trans('catalog.requests.no_member') }) }}
            </p>

            <fieldset class="flex flex-col gap-12">
                <legend class="mb-8 text-admin-base-strong text-ink">{{ trans('catalog.accept.levels.make') }}</legend>
                <SegmentedControl v-model="form.makeMode" class="self-start" :options="modeOptions(false)" :label="trans('catalog.accept.levels.make')" />
                <Field v-if="form.makeMode === 'pick'" :label="trans('catalog.accept.pick.make')" :error="err('make_id')" required>
                    <Combobox v-model="form.makeId" :options="makeOptions" :placeholder="trans('catalog.accept.search')" :data-testid="`${testId}.make`" />
                </Field>
                <div v-else class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('catalog.accept.new.make')" :error="err('make_name')" required><Input v-model="form.makeName" maxlength="100" :data-testid="`${testId}.make-name`" /></Field>
                    </div>
                    <div class="w-160">
                        <Field :label="trans('catalog.fields.country')" :hint="trans('catalog.fields.country_hint')" :error="err('country')" optional><Input v-model="form.country" maxlength="2" class="uppercase" /></Field>
                    </div>
                </div>
            </fieldset>

            <fieldset class="flex flex-col gap-12">
                <legend class="mb-8 text-admin-base-strong text-ink">{{ trans('catalog.accept.levels.model') }}</legend>
                <SegmentedControl v-model="form.modelMode" class="self-start" :options="modelModes" :label="trans('catalog.accept.levels.model')" />
                <Field v-if="form.modelMode === 'pick'" :label="trans('catalog.accept.pick.model')" :error="err('model_id')" required>
                    <Combobox v-model="form.modelId" :options="modelOptions" :disabled="!form.makeId" :placeholder="trans('catalog.accept.search')" :data-testid="`${testId}.model`" />
                </Field>
                <Field v-else-if="form.modelMode === 'new'" :label="trans('catalog.accept.new.model')" :error="err('model_name')" required>
                    <Input v-model="form.modelName" maxlength="100" :data-testid="`${testId}.model-name`" />
                </Field>
                <p v-else class="text-admin-base text-ink-3">{{ trans('catalog.accept.none.model') }}</p>
            </fieldset>

            <fieldset v-if="form.modelMode !== 'none'" class="flex flex-col gap-12">
                <legend class="mb-8 text-admin-base-strong text-ink">{{ trans('catalog.accept.levels.generation') }}</legend>
                <SegmentedControl v-model="form.generationMode" class="self-start" :options="generationModes" :label="trans('catalog.accept.levels.generation')" />
                <Field v-if="form.generationMode === 'pick'" :label="trans('catalog.accept.pick.generation')" :error="err('generation_id')" required>
                    <Combobox v-model="form.generationId" :options="generationOptions" :disabled="!form.modelId" :placeholder="trans('catalog.accept.search')" />
                </Field>
                <div v-else-if="form.generationMode === 'new'" class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('catalog.accept.new.generation')" :error="err('generation_name')" required><Input v-model="form.generationName" maxlength="100" /></Field>
                    </div>
                    <div class="w-160">
                        <Field :label="trans('catalog.fields.year_from')" :error="err('year_from')" optional><Input v-model="form.yearFrom" inputmode="numeric" maxlength="4" tnum /></Field>
                    </div>
                    <div class="w-160">
                        <Field :label="trans('catalog.fields.year_to')" :error="err('year_to')" optional><Input v-model="form.yearTo" inputmode="numeric" maxlength="4" tnum /></Field>
                    </div>
                </div>
                <p v-else class="text-admin-base text-ink-3">{{ trans('catalog.accept.none.generation') }}</p>
            </fieldset>

            <p class="text-admin-base text-ink-2">{{ trans('catalog.accept.member_note') }}</p>
            <Field :label="trans('catalog.fields.reason')" :hint="trans('catalog.fields.reason_optional_hint')" :error="err('reason')" optional>
                <Textarea v-model="form.reason" :rows="2" :maxlength="1000" />
            </Field>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="write.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="formId" variant="primary" :disabled="loadState !== 'ready'" :loading="write.processing.value" :data-testid="`${testId}.confirm`">{{ trans('catalog.accept.confirm') }}</Button>
        </template>
    </Drawer>
</template>
