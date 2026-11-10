<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowDown, PhArrowUp, PhEye, PhInfo, PhMegaphone, PhPencilSimple, PhPlus, PhTrash, PhWarning } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, DateRangeField, Drawer, EmptyQueue, Field, IconButton, Input, RadioGroup, Skeleton, StatusPill, Switch, Textarea, type Tone } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import DraftBar from './Partials/DraftBar.vue';
import { useConfigDraft, type EditorProps } from './Partials/configDraft';
import { dayToInstant, instantToDay, scheduleOf, type Schedule } from './Partials/dates';
import type { Localized } from './Partials/home';

/**
 * ADM-30 Ankündigungen (06 §3, m3.5 §2): the banners on Start and in the web shell — title and text DE/EN, an optional button to an
 * internal path or an https address, the audience (everyone, new members ≤ 14 days, members with a vehicle), a schedule, whether it can
 * be closed (remembered per device), and the tone (warning only for real warnings, 03 §8). As the announcements draft.
 */
interface Announcement {
    id?: string;
    title: Localized;
    body: Localized;
    cta: { label: Localized | null; url: string } | null;
    audience: 'all' | 'new' | 'with_vehicles';
    starts_at: string | null;
    ends_at: string | null;
    dismissible: boolean;
    severity: 'info' | 'warning';
}

const props = defineProps<{ editor: EditorProps<{ items: Announcement[] }>; max: number }>();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));

const draft = useConfigDraft(() => props.editor, {
    save: routeOr('admin.content.announcements.draft.save', '/admin/content/announcements/draft'),
    discard: routeOr('admin.content.announcements.draft.discard', '/admin/content/announcements/draft'),
    publish: routeOr('admin.content.announcements.publish', '/admin/content/announcements/publish'),
});
const form = draft.form;
const items = computed(() => (pageState.value === 'empty' ? [] : form.value.items));
const tones: Record<Schedule, Tone> = { live: 'success', scheduled: 'info', ended: 'neutral' };

function move(index: number, by: number): void {
    const list = form.value.items;
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    const [item] = list.splice(index, 1);
    if (item) list.splice(target, 0, item);
}

// Drawer on a flat copy.
interface Edit {
    title_de: string;
    title_en: string;
    body_de: string;
    body_en: string;
    cta: boolean;
    cta_de: string;
    cta_en: string;
    cta_url: string;
    audience: Announcement['audience'];
    from: string;
    to: string;
    dismissible: boolean;
    severity: Announcement['severity'];
}
const edit = reactive<Edit>({ title_de: '', title_en: '', body_de: '', body_en: '', cta: false, cta_de: '', cta_en: '', cta_url: '', audience: 'all', from: '', to: '', dismissible: true, severity: 'info' });
const editingIndex = ref<number | null>(null);
const drawerOpen = ref(false);
const errors = ref<Partial<Record<keyof Edit, string>>>({});
function open(index: number | null): void {
    const item = index === null ? null : form.value.items[index];
    Object.assign(edit, {
        title_de: item?.title.de ?? '',
        title_en: item?.title.en ?? '',
        body_de: item?.body.de ?? '',
        body_en: item?.body.en ?? '',
        cta: item?.cta != null,
        cta_de: item?.cta?.label?.de ?? '',
        cta_en: item?.cta?.label?.en ?? '',
        cta_url: item?.cta?.url ?? '',
        audience: item?.audience ?? 'all',
        from: instantToDay(item?.starts_at),
        to: instantToDay(item?.ends_at, true),
        dismissible: item?.dismissible ?? true,
        severity: item?.severity ?? 'info',
    });
    editingIndex.value = index;
    errors.value = {};
    drawerOpen.value = true;
}
// QA overlays: an existing banner (read-only while the draft is someone else's, DQ-624), a new one only where the draft is editable.
if (qaDialog() === 'edit') open(props.editor.payload.items.length > 0 ? 0 : null);
if (qaDialog() === 'new' && !draft.readOnly.value) open(null);

const optional = (text: string): string | null => (text.trim() === '' ? null : text.trim());
function apply(): void {
    const next: Partial<Record<keyof Edit, string>> = {};
    if (edit.title_de.trim() === '') next.title_de = trans('content.announcements.title_required');
    if (edit.body_de.trim() === '') next.body_de = trans('content.announcements.body_required');
    if (edit.cta && edit.cta_de.trim() === '') next.cta_de = trans('content.announcements.cta_label_required');
    if (edit.cta && !/^(\/(?!\/)\S*|https:\/\/\S+)$/.test(edit.cta_url.trim())) next.cta_url = trans('content.announcements.cta_url_hint');
    if (edit.from !== '' && edit.to !== '' && edit.to < edit.from) next.to = trans('content.announcements.ends_before_start');
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    const previous = editingIndex.value === null ? undefined : form.value.items[editingIndex.value];
    const value: Announcement = {
        ...(previous?.id ? { id: previous.id } : {}),
        title: { de: edit.title_de.trim(), en: optional(edit.title_en) },
        body: { de: edit.body_de.trim(), en: optional(edit.body_en) },
        cta: edit.cta ? { label: { de: edit.cta_de.trim(), en: optional(edit.cta_en) }, url: edit.cta_url.trim() } : null,
        audience: edit.audience,
        starts_at: dayToInstant(edit.from),
        ends_at: dayToInstant(edit.to, true),
        dismissible: edit.dismissible,
        severity: edit.severity,
    };
    if (editingIndex.value === null) form.value.items.push(value);
    else form.value.items[editingIndex.value] = value;
    drawerOpen.value = false;
}

const audienceOptions = computed(() => (['all', 'new', 'with_vehicles'] as const).map((value) => ({ value, label: trans(`content.announcements.audiences.${value}`), hint: trans(`content.announcements.audiences.${value}_hint`) })));
const audienceModel = computed({ get: () => edit.audience, set: (value: string | undefined) => (edit.audience = (value ?? 'all') as Edit['audience']) });
const severityOptions = computed(() => (['info', 'warning'] as const).map((value) => ({ value, label: trans(`content.announcements.severities.${value}`), hint: trans(`content.announcements.severities.${value}_hint`) })));
const severityModel = computed({ get: () => edit.severity, set: (value: string | undefined) => (edit.severity = value === 'warning' ? 'warning' : 'info') });
function scheduleText(item: Announcement): string {
    if (item.starts_at === null && item.ends_at === null) return trans('content.announcements.always');
    return trans('content.announcements.window', { from: item.starts_at ? formatDate(item.starts_at) : '…', to: item.ends_at ? formatDate(new Date(Date.parse(item.ends_at) - 1)) : '…' });
}
</script>

<template>
    <Head :title="trans('content.announcements.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-30" :data-qa-state="pageState">
        <PageHeader :title="trans('content.announcements.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.announcements.intro')">
            <template v-if="!draft.readOnly.value && pageState !== 'loading' && pageState !== 'error'" #actions>
                <Button size="sm" variant="secondary" :icon="PhPlus" :disabled="form.items.length >= max" data-testid="ADM-30.new" @click="open(null)">{{ trans('content.announcements.new') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('content.announcements.error')" :body="trans('ui.state.error_body')" test-id="ADM-30.error" @retry="router.reload()" />
        <template v-else-if="pageState === 'loading'">
            <Skeleton class="h-64 w-full rounded-sm" />
            <!-- DQ-622: the cards' own parts: the banner as members see it and the five facts in their 320 column. -->
            <div class="flex flex-col gap-12" aria-hidden="true">
                <div v-for="n in 3" :key="n" class="flex flex-wrap items-start gap-16 rounded-sm border border-line p-16">
                    <div class="flex min-w-280 flex-1 flex-col gap-8 rounded-sm border border-line px-12 py-12"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-3/4" /><Skeleton shape="text" class="w-120" /></div>
                    <div class="flex w-320 shrink-0 flex-col gap-4">
                        <span v-for="r in 5" :key="r" class="flex h-20 items-center gap-12"><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-160" /></span>
                    </div>
                    <span class="flex items-center gap-4"><Skeleton v-for="b in draft.readOnly.value ? 1 : 4" :key="b" class="size-32" /></span>
                </div>
            </div>
        </template>
        <template v-else>
            <DraftBar :editor="editor" :draft="draft" test-id="ADM-30" />
            <EmptyQueue v-if="items.length === 0" variant="first" :icon="PhMegaphone" :title="trans('content.announcements.empty_title')" :body="trans('content.announcements.empty_body')" data-testid="ADM-30.empty" />
            <ol v-else class="flex flex-col gap-12" :aria-label="trans('content.announcements.title')">
                <li v-for="(item, index) in items" :key="item.id ?? `new-${index}`" class="flex flex-wrap items-start gap-16 rounded-sm border border-line bg-surface p-16" data-testid="ADM-30.item">
                    <div class="flex min-w-280 flex-1 items-start gap-12 rounded-sm border px-12 py-12" :class="item.severity === 'warning' ? 'border-warning' : 'border-line'">
                        <component :is="item.severity === 'warning' ? PhWarning : PhInfo" :size="20" class="mt-2 shrink-0" :class="item.severity === 'warning' ? 'text-warning' : 'text-info'" aria-hidden="true" />
                        <div class="flex min-w-0 flex-1 flex-col gap-4">
                            <p class="text-label text-ink">{{ item.title.de }}</p>
                            <p class="text-supporting text-ink-2">{{ item.body.de }}</p>
                            <p v-if="item.cta" class="text-label-s text-ink underline">{{ item.cta.label?.de }}</p>
                            <p v-if="!item.title.en" class="text-helper text-ink-3">{{ trans('content.announcements.no_english') }}</p>
                        </div>
                    </div>
                    <!-- DQ-624: a fixed-width facts column, so every card's facts start at the same edge. -->
                    <dl class="flex w-320 shrink-0 flex-col gap-4 text-supporting">
                        <div class="flex gap-12"><dt class="w-120 shrink-0 text-ink-3">{{ trans('content.announcements.status') }}</dt><dd><StatusPill :tone="tones[scheduleOf(item.starts_at, item.ends_at)]" :label="trans(`content.schedule.${scheduleOf(item.starts_at, item.ends_at)}`)" /></dd></div>
                        <div class="flex gap-12"><dt class="w-120 shrink-0 text-ink-3">{{ trans('content.announcements.schedule') }}</dt><dd class="tabular-nums text-ink">{{ scheduleText(item) }}</dd></div>
                        <div class="flex gap-12"><dt class="w-120 shrink-0 text-ink-3">{{ trans('content.announcements.audience') }}</dt><dd class="text-ink">{{ trans(`content.announcements.audiences.${item.audience}`) }}</dd></div>
                        <div class="flex gap-12"><dt class="w-120 shrink-0 text-ink-3">{{ trans('content.announcements.closing') }}</dt><dd class="text-ink">{{ item.dismissible ? trans('content.announcements.dismissible_yes') : trans('content.announcements.dismissible_no') }}</dd></div>
                        <div v-if="item.cta" class="flex gap-12"><dt class="w-120 shrink-0 text-ink-3">{{ trans('content.announcements.target') }}</dt><dd class="min-w-0 break-all text-ink">{{ item.cta.url }}</dd></div>
                    </dl>
                    <span v-if="draft.readOnly.value" class="flex items-center gap-4">
                        <IconButton :icon="PhEye" size="sm" :label="trans('content.announcements.view', { title: item.title.de })" data-testid="ADM-30.view" @click="open(index)" />
                    </span>
                    <span v-else class="flex items-center gap-4">
                        <IconButton :icon="PhArrowUp" size="sm" :label="trans('content.move_up')" :disabled="index === 0" @click="move(index, -1)" />
                        <IconButton :icon="PhArrowDown" size="sm" :label="trans('content.move_down')" :disabled="index === items.length - 1" @click="move(index, 1)" />
                        <IconButton :icon="PhPencilSimple" size="sm" :label="trans('content.announcements.edit', { title: item.title.de })" data-testid="ADM-30.edit" @click="open(index)" />
                        <IconButton :icon="PhTrash" size="sm" variant="ghost" class="hover:text-danger" :label="trans('content.announcements.remove', { title: item.title.de })" @click="form.items.splice(index, 1)" />
                    </span>
                    <p v-if="draft.errorAt(`items.${index}`)" class="w-full text-helper text-danger" role="alert">{{ draft.errorAt(`items.${index}`) }}</p>
                </li>
            </ol>
            <p class="text-helper text-ink-3">{{ trans('content.announcements.limit', { count: formatNumber(form.items.length), max: formatNumber(max) }) }}</p>
        </template>

        <Drawer
            v-model:open="drawerOpen"
            :title="draft.readOnly.value ? trans('content.announcements.view_title') : editingIndex === null ? trans('content.announcements.new') : trans('content.announcements.edit_title')"
            :description="draft.readOnly.value ? trans('content.announcements.view_body') : undefined"
            size="lg"
            test-id="ADM-30.drawer"
        >
            <form id="adm30-form" novalidate @submit.prevent="apply">
                <!-- DQ-624: someone else's draft is shown, never edited: every control is disabled. -->
                <fieldset class="flex flex-col gap-16" :disabled="draft.readOnly.value">
                <div class="grid grid-cols-2 gap-12">
                    <Field :label="trans('content.fields.title_de')" :error="errors.title_de" required><Input v-model="edit.title_de" maxlength="80" data-testid="ADM-30.form.title" /></Field>
                    <Field :label="trans('content.fields.title_en')" optional><Input v-model="edit.title_en" maxlength="80" /></Field>
                    <Field :label="trans('content.fields.body_de')" :error="errors.body_de" required><Textarea v-model="edit.body_de" :rows="3" :maxlength="280" show-count data-testid="ADM-30.form.body" /></Field>
                    <Field :label="trans('content.fields.body_en')" optional><Textarea v-model="edit.body_en" :rows="3" :maxlength="280" show-count /></Field>
                </div>
                <Switch v-model="edit.cta" :label="trans('content.announcements.cta')" />
                <div v-if="edit.cta" class="grid grid-cols-2 gap-12">
                    <Field :label="trans('content.announcements.cta_de')" :error="errors.cta_de" required><Input v-model="edit.cta_de" maxlength="30" /></Field>
                    <Field :label="trans('content.announcements.cta_en')" optional><Input v-model="edit.cta_en" maxlength="30" /></Field>
                    <div class="col-span-2">
                        <Field :label="trans('content.announcements.cta_url')" :hint="trans('content.announcements.cta_url_hint')" :error="errors.cta_url" required><Input v-model="edit.cta_url" maxlength="500" spellcheck="false" /></Field>
                    </div>
                </div>
                <RadioGroup v-model="audienceModel" :options="audienceOptions" :legend="trans('content.announcements.audience')" />
                <Field :label="trans('content.announcements.schedule')" :hint="trans('content.announcements.schedule_hint')" :error="errors.to" optional>
                    <DateRangeField v-model:from="edit.from" v-model:to="edit.to" test-id="ADM-30.form.range" />
                </Field>
                <Switch v-model="edit.dismissible" :label="trans('content.announcements.dismissible')" />
                <RadioGroup v-model="severityModel" :options="severityOptions" :legend="trans('content.announcements.severity')" />
                <Badge v-if="edit.severity === 'warning'" tone="warning" class="self-start">{{ trans('content.announcements.warning_note') }}</Badge>
                </fieldset>
            </form>
            <template #footer>
                <Button variant="ghost" @click="drawerOpen = false">{{ trans(draft.readOnly.value ? 'ui.actions.close' : 'ui.actions.cancel') }}</Button>
                <Button v-if="!draft.readOnly.value" type="submit" form="adm30-form" variant="primary" data-testid="ADM-30.form.apply">{{ trans('content.apply') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
