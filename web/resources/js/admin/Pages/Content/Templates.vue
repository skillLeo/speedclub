<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhBell, PhEnvelopeSimple, PhFloppyDisk, PhLockSimple, PhPaperPlaneTilt } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, EmptyQueue, Field, SegmentedControl, Skeleton, Textarea } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { formatDate } from '../../lib/format';
import { requestJson } from '../../lib/http';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import { useLeaveGuard } from './Partials/configDraft';

/**
 * ADM-33 E-Mail- und Push-Vorlagen (06 §3, m3.5 §2): every text the platform sends, per language. Editable texts may use only the
 * variables of their default line (listed per field); an empty field falls back to the default. Sign-in, code, security and decision
 * texts are fixed by code, law or the DSA and only shown. The preview fills the variables with sample values; "Test an mich senden" ⚿
 * sends the (unsaved) text to the signed-in staff member's own address only.
 */
interface TemplateRow {
    key: string;
    channel: 'mail' | 'push';
    editable: boolean;
    customised: string[];
    updated_at: string | null;
}
interface TemplateField {
    name: string;
    default: string;
    saved: string | null;
    editable: boolean;
    variables: string[];
    plural: boolean;
}
interface Selected {
    key: string;
    locale: 'de' | 'en';
    fields: TemplateField[];
    rendered: Record<string, string>;
}

const props = defineProps<{ templates: TemplateRow[]; selected: Selected | null; samples: Record<string, string> }>();
const page = usePage();
const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const mayEdit = computed(() => can('content.edit'));

const groups = computed(() => (['mail', 'push'] as const).map((channel) => ({ channel, rows: props.templates.filter((row) => row.channel === channel) })));
const base = routeOr('admin.content.templates', '/admin/content/templates');
const href = (key: string, locale: string = props.selected?.locale ?? 'de') => `${base}?template=${encodeURIComponent(key)}&locale=${locale}`;
const nameOf = (key: string) => trans(`content.templates.names.${key.replace('.', '_')}`);
function fieldLabel(name: string): string {
    return name
        .split('.')
        .map((part) => {
            const key = `content.templates.fields.${part}`;
            const text = trans(key);
            return text === key ? part : text;
        })
        .join(' · ');
}

// The editor: one value per editable field ('' = the default text).
const values = reactive<Record<string, string>>({});
const baseline = ref('');
function load(): void {
    for (const key of Object.keys(values)) Reflect.deleteProperty(values, key);
    for (const field of props.selected?.fields ?? []) if (field.editable) values[field.name] = field.saved ?? '';
    baseline.value = JSON.stringify(values);
    rendered.value = props.selected?.rendered ?? {};
}
const rendered = ref<Record<string, string>>({});
watch(() => props.selected, load, { immediate: true });
const dirty = computed(() => JSON.stringify(values) !== baseline.value);
const { guardOpen, leave } = useLeaveGuard(dirty);
const editable = computed(() => mayEdit.value && props.templates.find((row) => row.key === props.selected?.key)?.editable === true);
const customised = computed(() => props.selected !== null && props.templates.find((row) => row.key === props.selected?.key)?.customised.includes(props.selected.locale) === true);

// The preview follows the unsaved text (debounced), rendered by the server with the sample values.
const previewing = ref(false);
const previewError = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
function fieldsPayload(): Record<string, string | null> {
    return Object.fromEntries(Object.entries(values).map(([name, text]) => [name, text.trim() === '' ? null : text]));
}
function preview(): void {
    if (!props.selected || !editable.value) return;
    previewing.value = true;
    requestJson<{ rendered: Record<string, string> }>('post', routeOr('admin.content.templates.preview', `/admin/content/templates/${props.selected.key}/${props.selected.locale}/preview`, { template: props.selected.key, locale: props.selected.locale }), { fields: fieldsPayload() })
        .then((answer) => {
            rendered.value = answer.rendered;
            previewError.value = null;
        })
        .catch(() => (previewError.value = trans('content.templates.preview_failed')))
        .finally(() => (previewing.value = false));
}
watch(values, () => {
    if (timer !== null) clearTimeout(timer);
    if (dirty.value) timer = setTimeout(preview, 400);
});
onBeforeUnmount(() => timer !== null && clearTimeout(timer));

const errors = ref<Record<string, string>>({});
const processing = ref<'save' | 'reset' | 'test' | null>(null);
function visit(kind: 'save' | 'reset' | 'test', method: 'put' | 'delete' | 'post', url: string, data: Record<string, unknown>, sensitive: boolean, done?: () => void): void {
    const go = (): void =>
        router.visit(url, {
            method,
            data: data as never,
            preserveScroll: true,
            preserveState: true,
            onStart: () => (processing.value = kind),
            onFinish: () => (processing.value = null),
            onError: (bag) => (errors.value = bag),
            onSuccess: (next) => {
                if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) return;
                errors.value = {};
                done?.();
            },
        });
    if (sensitive && !passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) confirmPasswordFirst(go);
    else go();
}
const target = computed(() => (props.selected ? { template: props.selected.key, locale: props.selected.locale } : null));
function save(): void {
    if (!target.value) return;
    visit('save', 'put', routeOr('admin.content.templates.save', `/admin/content/templates/${target.value.template}/${target.value.locale}`, target.value), { fields: fieldsPayload() }, false);
}
const resetOpen = ref(qaDialog() === 'reset');
function reset(): void {
    if (!target.value) return;
    visit('reset', 'delete', routeOr('admin.content.templates.reset', `/admin/content/templates/${target.value.template}/${target.value.locale}`, target.value), {}, false, () => (resetOpen.value = false));
}
const testOpen = ref(qaDialog() === 'test');
function test(): void {
    if (!target.value) return;
    visit('test', 'post', routeOr('admin.content.templates.test', `/admin/content/templates/${target.value.template}/${target.value.locale}/test`, target.value), dirty.value ? { fields: fieldsPayload() } : {}, true, () => (testOpen.value = false));
}
const fieldError = (name: string): string | null => errors.value[`fields.${name}`] ?? null;
const dialogError = computed(() => (failedDialog ? trans('ui.state.server_error') : (errors.value.refused ?? null)));
const localeModel = computed({
    get: () => props.selected?.locale ?? 'de',
    set: (value: string) => props.selected && router.visit(href(props.selected.key, value), { preserveScroll: true }),
});
const sampleList = computed(() => Object.entries(props.samples));

// DQ-629: fields ending in _no_action / _no_date are the alternative of their base field (the mail without a measure); the preview
// shows one variant.
const ALTERNATIVES = /_(no_action|no_date)$/;
const variant = ref<string>('measure');
const hasVariants = computed(() => (props.selected?.fields ?? []).some((f) => ALTERNATIVES.test(f.name)));
const variantOptions = computed(() => [
    { value: 'measure', label: trans('content.templates.variants.measure') },
    { value: 'none', label: trans('content.templates.variants.none') },
]);
const shownFields = computed(() => {
    const fields = props.selected?.fields ?? [];
    if (!hasVariants.value) return fields;
    const names = new Set(fields.map((f) => f.name));
    return fields.filter((f) => {
        const alternative = ALTERNATIVES.test(f.name);
        if (variant.value === 'none') return alternative || ![...names].some((n) => ALTERNATIVES.test(n) && n.replace(ALTERNATIVES, '') === f.name);
        return !alternative;
    });
});
</script>

<template>
    <Head :title="trans('content.templates.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-33" :data-qa-state="pageState">
        <PageHeader :title="trans('content.templates.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.templates.intro')" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('content.templates.error')" :body="trans('ui.state.error_body')" test-id="ADM-33.error" @retry="router.reload()" />
        <EmptyQueue v-else-if="pageState === 'empty'" variant="first" :icon="PhEnvelopeSimple" :title="trans('content.templates.empty_title')" :body="trans('content.templates.empty_body')" data-testid="ADM-33.empty" />
        <div v-else class="flex flex-col items-start gap-24 desktop:flex-row">
            <nav class="w-full shrink-0 desktop:w-280" :aria-label="trans('content.templates.list')" data-testid="ADM-33.list">
                <template v-if="pageState === 'loading'">
                    <div class="flex flex-col rounded-sm border border-line" aria-hidden="true">
                        <div v-for="n in 10" :key="n" class="flex h-48 items-center border-b border-line-subtle px-12 last:border-b-0"><Skeleton shape="text" class="w-200" /></div>
                    </div>
                </template>
                <div v-else class="flex flex-col gap-16">
                    <section v-for="group in groups" :key="group.channel" class="flex flex-col gap-8">
                        <h2 class="flex items-center gap-8 text-label-s text-ink-2">
                            <component :is="group.channel === 'mail' ? PhEnvelopeSimple : PhBell" :size="16" aria-hidden="true" />
                            {{ trans(`content.templates.channels.${group.channel}`) }}
                        </h2>
                        <ul class="flex flex-col rounded-sm border border-line">
                            <li v-for="row in group.rows" :key="row.key" class="border-b border-line-subtle last:border-b-0">
                                <Link
                                    :href="href(row.key)"
                                    :class="[focusRing, 'flex min-h-48 flex-col justify-center gap-2 px-12 py-4', selected?.key === row.key ? 'bg-selected' : 'hover:bg-hover']"
                                    :aria-current="selected?.key === row.key ? 'page' : undefined"
                                    data-testid="ADM-33.template"
                                >
                                    <span class="flex items-center gap-8 text-supporting text-ink">
                                        <PhLockSimple v-if="!row.editable" :size="16" class="shrink-0 text-ink-3" :aria-label="trans('content.templates.fixed')" />
                                        {{ nameOf(row.key) }}
                                    </span>
                                    <span class="text-helper text-ink-3">
                                        {{ !row.editable ? trans('content.templates.fixed') : row.customised.length > 0 ? trans('content.templates.customised', { locales: row.customised.map((l) => l.toUpperCase()).join(', '), date: formatDate(row.updated_at) }) : trans('content.templates.default') }}
                                    </span>
                                </Link>
                            </li>
                        </ul>
                    </section>
                </div>
            </nav>

            <div class="flex min-w-0 flex-1 flex-col gap-16">
                <template v-if="pageState === 'loading'">
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="h-320 w-full rounded-sm" />
                </template>
                <EmptyQueue v-else-if="!selected" variant="quiet" :icon="PhEnvelopeSimple" :title="trans('content.templates.choose_title')" :body="trans('content.templates.choose_body')" data-testid="ADM-33.choose" />
                <template v-else>
                    <div class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="text-title-s text-ink">{{ nameOf(selected.key) }}</h2>
                            <p class="text-supporting text-ink-2">{{ editable ? trans('content.templates.editable_hint') : trans('content.templates.fixed_hint') }}</p>
                        </div>
                        <SegmentedControl v-model="localeModel" :label="trans('content.templates.locale')" :options="[{ value: 'de', label: trans('content.locales.de') }, { value: 'en', label: trans('content.locales.en') }]" />
                    </div>

                    <div class="flex flex-col items-start gap-16 wide:flex-row">
                        <section class="flex w-full min-w-0 flex-1 flex-col gap-16 rounded-sm border border-line bg-surface p-16" :aria-label="trans('content.templates.fields_label')" data-testid="ADM-33.editor">
                            <div v-for="field in selected.fields" :key="field.name" class="flex flex-col gap-4" data-testid="ADM-33.field">
                                <template v-if="field.editable && editable">
                                    <Field :label="fieldLabel(field.name)" :hint="field.variables.length > 0 ? trans('content.templates.variables', { list: field.variables.map((v) => `:${v}`).join(', ') }) : trans('content.templates.no_variables')" :error="fieldError(field.name)" optional>
                                        <Textarea v-model="values[field.name]" :rows="field.name === 'subject' || field.default.length < 80 ? 2 : 4" :maxlength="field.name === 'subject' ? 200 : 2000" :placeholder="field.default" />
                                    </Field>
                                    <p v-if="field.plural" class="text-helper text-ink-3">{{ trans('content.templates.plural_hint') }}</p>
                                </template>
                                <template v-else>
                                    <p class="flex items-center gap-8 text-label-s text-ink">
                                        {{ fieldLabel(field.name) }}
                                        <Badge tone="neutral"><PhLockSimple :size="12" class="mr-4 inline" aria-hidden="true" />{{ trans('content.templates.fixed_field') }}</Badge>
                                    </p>
                                    <p class="whitespace-pre-line rounded-xs bg-raised px-12 py-8 text-supporting text-ink-2">{{ field.default }}</p>
                                </template>
                            </div>
                            <p v-if="errors.refused && !testOpen && !resetOpen" class="text-helper text-danger" role="alert">{{ errors.refused }}</p>
                            <div v-if="editable" class="flex flex-wrap items-center justify-end gap-8 border-t border-line-subtle pt-16">
                                <Button v-if="customised && !dirty" size="sm" variant="destructive" :icon="PhArrowCounterClockwise" data-testid="ADM-33.reset" @click="resetOpen = true">{{ trans('content.templates.reset') }}</Button>
                                <Button size="sm" variant="secondary" :icon="PhPaperPlaneTilt" data-testid="ADM-33.test" @click="testOpen = true">{{ trans('content.templates.test') }}</Button>
                                <Button size="sm" :variant="dirty ? 'primary' : 'secondary'" :icon="PhFloppyDisk" :disabled="!dirty" :loading="processing === 'save'" data-testid="ADM-33.save" @click="save">{{ trans('content.templates.save') }}</Button>
                            </div>
                        </section>

                        <aside class="flex w-full flex-col gap-12 wide:w-360" :aria-label="trans('content.templates.preview')" data-testid="ADM-33.preview">
                            <div class="flex flex-col gap-8 rounded-sm border border-line bg-surface p-16" :aria-busy="previewing">
                                <h3 class="text-label-s text-ink-2">{{ trans('content.templates.preview') }}</h3>
                                <!-- DQ-629: one outcome at a time, as a member gets it; never both variants stacked. -->
                                <SegmentedControl v-if="hasVariants" v-model="variant" class="self-start" :options="variantOptions" :label="trans('content.templates.variant')" data-testid="ADM-33.variant" />
                                <template v-for="field in shownFields" :key="field.name">
                                    <p v-if="rendered[field.name]" :class="field.name.endsWith('subject') || field.name.endsWith('heading') ? 'text-label text-ink' : 'text-supporting text-ink-2'">{{ rendered[field.name] }}</p>
                                </template>
                                <p v-if="previewError" class="text-helper text-danger" role="alert">{{ previewError }}</p>
                            </div>
                            <details class="rounded-sm border border-line px-16 py-12">
                                <summary :class="[focusRing, 'flex min-h-32 cursor-pointer items-center text-label-s text-ink-2']">{{ trans('content.templates.samples') }}</summary>
                                <dl class="mt-8 flex flex-col gap-4 text-helper">
                                    <div v-for="[name, value] in sampleList" :key="name" class="flex gap-8"><dt class="w-96 shrink-0 text-ink-3">:{{ name }}</dt><dd class="min-w-0 break-all text-ink-2">{{ value }}</dd></div>
                                </dl>
                            </details>
                        </aside>
                    </div>
                </template>
            </div>
        </div>

        <ConfirmDialog
            v-model:open="resetOpen"
            :title="trans('content.templates.reset_title')"
            :body="trans('content.templates.reset_body', { name: selected ? nameOf(selected.key) : '', locale: selected ? trans(`content.locales.${selected.locale}`) : '' })"
            :confirm-label="trans('content.templates.reset')"
            :processing="processing === 'reset'"
            :error="dialogError"
            test-id="ADM-33.reset-dialog"
            @confirm="reset"
        />
        <ConfirmDialog
            v-model:open="testOpen"
            :title="trans('content.templates.test_title')"
            :body="trans('content.templates.test_body', { email: page.props.staff?.email ?? '' })"
            :confirm-label="trans('content.templates.test_send')"
            tone="neutral"
            :processing="processing === 'test'"
            :error="dialogError"
            test-id="ADM-33.test-dialog"
            @confirm="test"
        />
        <ConfirmDialog v-model:open="guardOpen" :title="trans('config.draft.leave_title')" :body="trans('config.draft.leave_body')" :confirm-label="trans('config.draft.leave')" test-id="ADM-33.leave-dialog" @confirm="leave" />
    </div>
</template>
