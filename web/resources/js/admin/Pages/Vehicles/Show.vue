<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhDotsThree, PhEye, PhEyeSlash, PhImageBroken, PhPencilSimple, PhTrash, PhWarningCircle, PhWrench } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref, watch, type Component } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import HideDialog from '../../Components/decisions/HideDialog.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Button, Combobox, ConfirmDialog, Drawer, DropdownMenu, EmptyQueue, Field, Input, QrCodeText, Select, Skeleton, StatusPill, Textarea, type MenuEntry, type TabItem, type Tone } from '../../Components/ui';
import { autoIcons } from '../../../shared/icons/auto';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { recordPill } from '../../lib/vehicleStatus';

/**
 * ADM-12 vehicle record (06 §3 Vehicles & media, m3.2-contract §2): tabs Details · Fotos · Mods · QR · Verlauf · Meldungen (each read
 * when opened, ?tab=), activity from the audit log. Hide / unhide are DSA decisions the owner reads; edit relinks the catalogue; delete
 * records a removal decision first (ADR-225) and needs the typed confirmation. All behind a recent password.
 */
type Tab = 'details' | 'photos' | 'mods' | 'qr' | 'history' | 'reports';
interface Details {
    id: string;
    public_id: string;
    slug: string;
    title: string;
    make: string | null;
    model: string | null;
    generation: string | null;
    make_id: number | null;
    model_id: number | null;
    generation_id: number | null;
    make_text: string | null;
    model_text: string | null;
    model_year: number | null;
    nickname: string | null;
    color: string | null;
    description: string | null;
    status: string;
    visibility: string;
    deleted: boolean;
    hidden: boolean;
    hidden_since: string | null;
    cover: string | null;
    cover_focus?: string | null;
    cover_placeholder?: string | null;
    owner: { id: string; username: string | null; display_name: string | null } | null;
    public_url: string | null;
    published_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}
interface Photo {
    id: string;
    url: string | null;
    category: string | null;
    alt: string | null;
    status: string;
    moderation_status: string;
    reviewed_at: string | null;
    deleted: boolean;
    created_at: string | null;
}
interface Mod {
    id: string;
    title: string | null;
    category: string | null;
    category_icon?: string | null;
    brand: string | null;
    status: string | null;
    legal_status: string | null;
    installed_on: string | null;
}
interface Code {
    id: string;
    code: string;
    status: string;
    revoked_reason: string | null;
    revoked_at: string | null;
    created_at: string | null;
    scans_30: number;
}
interface HistoryItem {
    id: string;
    type: string;
    label: string | null;
    before: string | null;
    after: string | null;
    note: string | null;
    hidden: boolean;
    created_at: string | null;
}
interface CaseItem {
    case_id: string;
    origin: string;
    status: string;
    target_type: string;
    report_count: number;
    created_at: string | null;
    decision: { action: string; decided_at: string } | null;
}
interface Option {
    value: string;
    label: string;
}

const props = defineProps<{
    vehicle: Details;
    tab: Tab;
    photos?: Photo[];
    mods?: Mod[];
    qr?: Code[];
    history?: HistoryItem[];
    reports?: CaseItem[];
    activity: { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null }[];
    catalog?: { makes: Option[]; models: Option[]; generations: Option[] };
}>();

const { can } = usePermissions();
// DQ-560: the activity column is a summary; the whole history is in the audit log (audit.view).
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=vehicle&filter[target_id]=${props.vehicle.id}` : undefined));
const state = usePageState();

const tabs = computed<TabItem[]>(() => [
    { value: 'details', label: trans('vehicles.tabs.details') },
    { value: 'photos', label: trans('vehicles.tabs.photos') },
    { value: 'mods', label: trans('vehicles.tabs.mods') },
    { value: 'qr', label: trans('vehicles.tabs.qr') },
    { value: 'history', label: trans('vehicles.tabs.history') },
    { value: 'reports', label: trans('vehicles.tabs.reports') },
]);
const current = ref<Tab>(props.tab);
const tabLoading = ref(false);
const tabFailed = ref(false);
watch(
    () => props.tab,
    (tab) => (current.value = tab),
);
function loadTab(tab: Tab): void {
    tabFailed.value = false;
    router.get(window.location.pathname, tab === 'details' ? {} : { tab }, {
        only: tab === 'details' ? ['tab', 'vehicle'] : ['tab', tab],
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onStart: () => (tabLoading.value = true),
        onFinish: () => (tabLoading.value = false),
        onNetworkError: () => {
            tabFailed.value = true;
            return false;
        },
    });
}
const tabModel = computed({
    get: () => current.value,
    set: (tab: string) => {
        current.value = tab as Tab;
        loadTab(current.value);
    },
});
const panelReady = computed(() => {
    if (state.value === 'loading' || tabLoading.value) return false;
    return { details: true, photos: props.photos, mods: props.mods, qr: props.qr, history: props.history, reports: props.reports }[current.value] !== undefined;
});

// One status presentation with ADM-11 and ADM-10 (DQ-537).
const status = computed<{ tone: Tone; label: string }>(() => recordPill(props.vehicle));
// "Löschen" lives in "Weitere Aktionen" (DQ-530): the header reads neutral → destructive and hiding never looks worse than deleting.
const more = computed<MenuEntry[]>(() =>
    can('vehicles.delete') && !props.vehicle.deleted
        ? [{ key: 'delete', label: trans('vehicles.actions.delete'), icon: PhTrash, danger: true, testId: 'ADM-12.action.delete', onSelect: () => openDialog('delete') }]
        : [],
);
/** The category glyph of a mod (03 §6 map; "wrench" is Phosphor's). */
function modIcon(name: string | null | undefined): Component {
    if (name && name in autoIcons) return autoIcons[name as keyof typeof autoIcons];
    return PhWrench;
}
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
const url = (name: string, path: string) => routeOr(`admin.vehicles.${name}`, `/admin/vehicles/${props.vehicle.id}${path}`, { vehicle: props.vehicle.id });
const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
const qrHref = (id: string) => (hasRoute('admin.qr.show') ? routeOr('admin.qr.show', `/admin/qr/${id}`, { qr: id }) : null);
const caseHref = (id: string) => (hasRoute('admin.moderation.cases.show') ? routeOr('admin.moderation.cases.show', '/admin', { case: id }) : null);

// ---- actions ----------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const hideOpen = ref(false);
const unhideOpen = ref(false);
const deleteOpen = ref(false);
const editOpen = ref(false);
const unhideFacts = ref('');
const unhideError = ref<string | null>(null);

function openDialog(which: 'hide' | 'unhide' | 'delete' | 'edit'): void {
    action.reset();
    if (which === 'hide') hideOpen.value = true;
    if (which === 'unhide') {
        unhideFacts.value = '';
        unhideError.value = null;
        unhideOpen.value = true;
    }
    if (which === 'delete') deleteOpen.value = true;
    if (which === 'edit') editOpen.value = true;
}
function hide(payload: Record<string, string | null>): void {
    action.run('post', url('hide', '/hide'), payload, { sensitive: true, onSuccess: () => (hideOpen.value = false) });
}
function unhide(reason: string | null): void {
    const length = unhideFacts.value.trim().length;
    if (length < 10 || length > 5000) {
        unhideError.value = trans('decisions.errors.facts');
        return;
    }
    unhideError.value = null;
    action.run('post', url('unhide', '/unhide'), { facts: unhideFacts.value.trim(), reason: reason ?? '' }, { sensitive: true, onSuccess: () => (unhideOpen.value = false) });
}
function destroy(payload: Record<string, string | null>): void {
    action.run('delete', url('destroy', ''), payload, { sensitive: true, onSuccess: () => (deleteOpen.value = false) });
}

// edit drawer: catalogue relink and title fields
const edit = reactive({ make_id: '', model_id: '', generation_id: '', make_text: '', model_text: '', model_year: '', nickname: '', reason: '' });
const editErrors = ref<Record<string, string>>({});
const catalogLoading = ref(false);
function loadCatalog(data: Record<string, string> = {}): void {
    router.reload({ only: ['catalog'], data, onStart: () => (catalogLoading.value = true), onFinish: () => (catalogLoading.value = false) });
}
watch(editOpen, (value) => {
    if (!value) return;
    const v = props.vehicle;
    Object.assign(edit, {
        make_id: v.make_id === null ? '' : String(v.make_id),
        model_id: v.model_id === null ? '' : String(v.model_id),
        generation_id: v.generation_id === null ? '' : String(v.generation_id),
        make_text: v.make_text ?? '',
        model_text: v.model_text ?? '',
        model_year: v.model_year === null ? '' : String(v.model_year),
        nickname: v.nickname ?? '',
        reason: '',
    });
    editErrors.value = {};
    loadCatalog();
});
const makeModel = computed({
    get: () => (edit.make_id === '' ? undefined : edit.make_id),
    set: (value: string | undefined) => {
        edit.make_id = value ?? '';
        edit.model_id = '';
        edit.generation_id = '';
        if (value !== undefined) loadCatalog({ catalog_make: value });
    },
});
const modelModel = computed({
    get: () => (edit.model_id === '' ? undefined : edit.model_id),
    set: (value: string | undefined) => {
        edit.model_id = value ?? '';
        edit.generation_id = '';
        if (value !== undefined) loadCatalog({ catalog_make: edit.make_id, catalog_model: value });
    },
});
const generationModel = computed({
    get: () => (edit.generation_id === '' ? undefined : edit.generation_id),
    set: (value: string | undefined) => (edit.generation_id = value ?? ''),
});
function submitEdit(): void {
    const errors: Record<string, string> = {};
    const reason = edit.reason.trim().length;
    if (reason < 10 || reason > 1000) errors.reason = trans('ui.confirm.reason_length');
    if (edit.model_year !== '' && !/^\d{4}$/.test(edit.model_year)) errors.model_year = trans('vehicles.edit.year_invalid');
    editErrors.value = errors;
    if (Object.keys(errors).length > 0) return;
    const id = (value: string) => (value === '' ? null : Number(value));
    const text = (value: string) => (value.trim() === '' ? null : value.trim());
    action.run(
        'patch',
        url('update', ''),
        {
            make_id: id(edit.make_id),
            model_id: id(edit.model_id),
            generation_id: id(edit.generation_id),
            make_text: edit.make_id === '' ? text(edit.make_text) : null,
            model_text: edit.model_id === '' ? text(edit.model_text) : null,
            model_year: id(edit.model_year),
            nickname: text(edit.nickname),
            reason: edit.reason.trim(),
        },
        { sensitive: true, onSuccess: () => (editOpen.value = false) },
    );
}
// The cover crops around its focal point over its blurhash (DQ-536).
const coverStyle = computed(() => ({
    objectPosition: props.vehicle.cover_focus ?? undefined,
    backgroundImage: props.vehicle.cover_placeholder ? `url("${props.vehicle.cover_placeholder}")` : undefined,
}));
// ---- QA overlays (?dialog=hide|unhide|delete|edit, non-production, DQ-529) ----------------------------------------------------
const qaOverlay = qaDialog();
const hidePreset = qaOverlay === 'hide' ? { template: 'impersonation' } : null;
onMounted(async () => {
    if (qaOverlay !== 'hide' && qaOverlay !== 'unhide' && qaOverlay !== 'delete' && qaOverlay !== 'edit') return;
    openDialog(qaOverlay);
    await nextTick();
    if (qaDialogFailed()) action.error.value = trans('ui.state.server_error');
});
const photoTone = (photo: Photo): Tone => (photo.moderation_status === 'rejected' ? 'danger' : photo.reviewed_at ? 'success' : 'neutral');
</script>

<template>
    <Head :title="vehicle.title" />
    <div data-testid="ADM-12-page" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('vehicles.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-12" @retry="router.reload()" />

        <RecordLayout
            v-else
            v-model:tab="tabModel"
            :title="vehicle.title"
            :crumbs="[{ label: trans('shell.groups.vehicles_media') }, { label: trans('vehicles.title'), href: routeOr('admin.vehicles.index', '/admin/vehicles') }]"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('vehicles.tabs.label')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="state === 'loading'"
            test-id="ADM-12"
        >
            <template #meta>
                <p class="flex min-h-32 flex-wrap items-center gap-8 text-supporting text-ink-2 tabular-nums">
                    <Link v-if="vehicle.owner" :href="memberHref(vehicle.owner.id)" :class="[focusRing, 'sc-key inline-flex h-32 items-center rounded-xs text-ink hover:underline']">{{ vehicle.owner.username ? `@${vehicle.owner.username}` : '–' }}</Link>
                    <span>·</span>
                    <span class="sc-key">{{ vehicle.public_id }}</span>
                    <template v-if="vehicle.hidden_since">
                        <span>·</span>
                        <span>{{ trans('vehicles.record.hidden_since', { date: formatDateTime(vehicle.hidden_since) }) }}</span>
                    </template>
                </p>
            </template>
            <template #actions>
                <Button v-if="vehicle.public_url" size="sm" variant="ghost" :icon="PhArrowSquareOut" :href="vehicle.public_url" external data-testid="ADM-12.public">{{ trans('vehicles.actions.public') }}</Button>
                <Button v-if="can('vehicles.edit') && !vehicle.deleted" size="sm" variant="primary" :icon="PhPencilSimple" data-testid="ADM-12.action.edit" @click="openDialog('edit')">{{ trans('vehicles.actions.edit') }}</Button>
                <template v-if="can('vehicles.hide') && !vehicle.deleted">
                    <Button v-if="vehicle.hidden" size="sm" variant="secondary" :icon="PhEye" data-testid="ADM-12.action.unhide" @click="openDialog('unhide')">{{ trans('vehicles.actions.unhide') }}</Button>
                    <Button v-else size="sm" variant="destructive" :icon="PhEyeSlash" data-testid="ADM-12.action.hide" @click="openDialog('hide')">{{ trans('vehicles.actions.hide') }}</Button>
                </template>
                <DropdownMenu v-if="more.length > 0" :items="more" :label="trans('vehicles.actions.more')">
                    <template #trigger>
                        <Button size="sm" variant="secondary" :icon="PhDotsThree" data-testid="ADM-12.action.more">{{ trans('vehicles.actions.more') }}</Button>
                    </template>
                </DropdownMenu>
            </template>

            <template v-for="name in (['details', 'photos', 'mods', 'qr', 'history', 'reports'] as const)" :key="name" #[name]>
                <StateBlock v-if="tabFailed" kind="error" :title="trans('vehicles.record.tab_error')" @retry="loadTab(current)" />
                <div v-else-if="!panelReady" class="flex flex-col gap-12" aria-busy="true" :data-testid="`ADM-12.${name}.loading`">
                    <Skeleton shape="text" class="w-160" />
                    <Skeleton v-for="n in 4" :key="n" class="h-40 w-full" />
                </div>

                <!-- details -->
                <div v-else-if="name === 'details'" class="flex flex-col gap-24 tablet:flex-row" data-testid="ADM-12.details">
                    <div class="w-full shrink-0 tablet:w-240">
                        <img
                            v-if="vehicle.cover"
                            :src="vehicle.cover"
                            :alt="trans('vehicles.record.cover_alt', { title: vehicle.title })"
                            width="240"
                            height="180"
                            class="aspect-4/3 w-full rounded-sm bg-raised bg-cover object-cover"
                            :style="coverStyle"
                        />
                        <div v-else class="flex aspect-4/3 w-full items-center justify-center rounded-sm border border-line-subtle bg-surface text-ink-3">
                            <PhImageBroken :size="24" aria-hidden="true" />
                        </div>
                    </div>
                    <dl class="grid min-w-0 flex-1 grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2">
                        <div
v-for="item in [
                            ['make', vehicle.make ?? vehicle.make_text],
                            ['model', vehicle.model ?? vehicle.model_text],
                            ['generation', vehicle.generation],
                            ['year', vehicle.model_year],
                            ['nickname', vehicle.nickname],
                            ['color', vehicle.color],
                            ['slug', vehicle.slug],
                            ['published', vehicle.published_at ? formatDateTime(vehicle.published_at) : null],
                            ['created', formatDateTime(vehicle.created_at)],
                            ['updated', formatDateTime(vehicle.updated_at)],
                        ]" :key="String(item[0])" class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans(`vehicles.fields.${item[0]}`) }}</dt>
                            <dd class="sc-key text-supporting text-ink tabular-nums">{{ item[1] ?? '–' }}</dd>
                        </div>
                        <div class="flex flex-col gap-2 tablet:col-span-2">
                            <dt class="text-caption text-ink-3">{{ trans('vehicles.fields.description') }}</dt>
                            <dd class="max-w-720 text-supporting text-ink">{{ vehicle.description ?? '–' }}</dd>
                        </div>
                    </dl>
                </div>

                <!-- photos -->
                <template v-else-if="name === 'photos' && photos">
                    <EmptyQueue v-if="photos.length === 0" variant="first" :title="trans('vehicles.photos.empty')" data-testid="ADM-12.photos.empty" />
                    <ul v-else class="grid grid-cols-2 gap-12 tablet:grid-cols-3 wide:grid-cols-4" data-testid="ADM-12.photos">
                        <li v-for="photo in photos" :key="photo.id" class="flex flex-col gap-8">
                            <img v-if="photo.url && photo.moderation_status !== 'rejected'" :src="photo.url" :alt="photo.alt ?? trans('vehicles.photos.alt')" class="aspect-4/3 w-full rounded-sm object-cover" loading="lazy" />
                            <div v-else class="flex aspect-4/3 w-full items-center justify-center rounded-sm border border-line-subtle bg-surface text-ink-3">
                                <PhImageBroken :size="24" :aria-label="trans('vehicles.photos.removed')" />
                            </div>
                            <div class="flex flex-wrap items-center gap-8">
                                <StatusPill :tone="photoTone(photo)" :label="trans(photo.moderation_status === 'rejected' ? 'vehicles.photos.hidden' : photo.reviewed_at ? 'vehicles.photos.approved' : 'vehicles.photos.unreviewed')" />
                                <span class="text-caption text-ink-3 tabular-nums">{{ formatDate(photo.created_at) }}</span>
                            </div>
                        </li>
                    </ul>
                </template>

                <!-- mods -->
                <template v-else-if="name === 'mods' && mods">
                    <EmptyQueue v-if="mods.length === 0" variant="first" :title="trans('vehicles.mods.empty')" data-testid="ADM-12.mods.empty" />
                    <!-- Mod with its category (glyph + label) under the name, so no column wraps or is cut (DQ-535). -->
                    <ScrollRegion v-else :label="trans('vehicles.tabs.mods')" test-id="ADM-12.mods">
                        <table class="w-full border-collapse text-supporting">
                            <caption class="sr-only">{{ trans('vehicles.tabs.mods') }}</caption>
                            <thead>
                                <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                                    <th scope="col" class="px-12">{{ trans('vehicles.mods.title') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('vehicles.mods.brand') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('vehicles.mods.status') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('vehicles.mods.legal') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('vehicles.mods.installed') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="mod in mods" :key="mod.id" class="h-40 border-b border-line-subtle last:border-b-0">
                                    <td class="px-12 py-4">
                                        <span class="flex min-w-0 flex-col">
                                            <span class="text-ink">{{ mod.title ?? '–' }}</span>
                                            <span v-if="mod.category" class="flex items-center gap-4 text-caption text-ink-3">
                                                <component :is="modIcon(mod.category_icon)" :size="16" aria-hidden="true" />{{ mod.category }}
                                            </span>
                                        </span>
                                    </td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ mod.brand ?? '–' }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ mod.status ? trans(`vehicles.mods.status_${mod.status}`) : '–' }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ mod.legal_status ? trans(`vehicles.mods.legal_${mod.legal_status}`) : '–' }}</td>
                                    <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDate(mod.installed_on) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </ScrollRegion>
                </template>

                <!-- QR -->
                <template v-else-if="name === 'qr' && qr">
                    <EmptyQueue v-if="qr.length === 0" variant="first" :title="trans('vehicles.qr.empty')" :body="trans('vehicles.qr.empty_body')" data-testid="ADM-12.qr.empty" />
                    <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface" data-testid="ADM-12.qr">
                        <li v-for="code in qr" :key="code.id" class="flex h-40 items-center gap-12 border-b border-line-subtle px-12 text-supporting last:border-b-0">
                            <QrCodeText :code="code.code" :href="qrHref(code.id)" />
                            <StatusPill :tone="code.status === 'active' ? 'success' : 'neutral'" :label="trans(`qr.status.${code.status}`)" />
                            <span class="min-w-0 flex-1 truncate text-ink-2" :title="code.revoked_reason ? trans(`qr.reasons.${code.revoked_reason}`) : undefined">{{ code.revoked_reason ? trans(`qr.reasons.${code.revoked_reason}`) : '' }}</span>
                            <span class="text-ink-2 tabular-nums">{{ trans('vehicles.qr.scans', { count: formatNumber(code.scans_30) }) }}</span>
                            <span class="text-ink-3 tabular-nums">{{ formatDate(code.created_at) }}</span>
                        </li>
                    </ul>
                </template>

                <!-- history -->
                <template v-else-if="name === 'history' && history">
                    <EmptyQueue v-if="history.length === 0" variant="first" :title="trans('vehicles.history.empty')" data-testid="ADM-12.history.empty" />
                    <ol v-else class="flex flex-col gap-16" data-testid="ADM-12.history">
                        <li v-for="item in history" :key="item.id" class="flex flex-col gap-2 border-l border-line pl-12">
                            <span class="text-caption text-ink-3 tabular-nums">{{ formatDate(item.created_at) }}<template v-if="item.hidden"> · {{ trans('vehicles.history.hidden') }}</template></span>
                            <p class="text-supporting text-ink">{{ item.label ?? trans(`vehicles.history.type_${item.type}`) }}</p>
                            <p v-if="item.before || item.after" class="text-helper text-ink-2">{{ trans('vehicles.history.change', { before: item.before ?? '–', after: item.after ?? '–' }) }}</p>
                            <p v-if="item.note" class="text-helper text-ink-2">{{ item.note }}</p>
                        </li>
                    </ol>
                </template>

                <!-- reports -->
                <template v-else-if="name === 'reports' && reports">
                    <p v-if="reports.length === 0" class="text-supporting text-ink-2" data-testid="ADM-12.reports.empty">{{ trans('vehicles.reports.empty') }}</p>
                    <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface" data-testid="ADM-12.reports">
                        <li v-for="item in reports" :key="item.case_id" class="flex h-40 items-center gap-12 border-b border-line-subtle px-12 text-supporting last:border-b-0">
                            <component :is="caseHref(item.case_id) ? Link : 'span'" :href="caseHref(item.case_id) ?? undefined" :class="[caseHref(item.case_id) ? `${focusRing} underline underline-offset-4` : '', 'sc-key inline-flex h-32 items-center rounded-xs text-ink tabular-nums']">{{ item.case_id.slice(-8).toUpperCase() }}</component>
                            <StatusPill :tone="item.status === 'new' ? 'info' : item.status === 'in_review' ? 'warning' : 'neutral'" :label="trans(`members.reports.status_${item.status}`)" />
                            <span class="min-w-0 flex-1 truncate text-ink-2">{{ trans(`members.reports.type_${item.target_type}`) }} · {{ trans(`members.reports.origin_${item.origin}`) }}<template v-if="item.decision"> · {{ trans(`members.reports.action_${item.decision.action}`) }}</template></span>
                            <span class="text-ink-2 tabular-nums">{{ trans('vehicles.reports.count', { count: formatNumber(item.report_count) }) }}</span>
                            <span class="text-ink-3 tabular-nums">{{ formatDate(item.created_at) }}</span>
                        </li>
                    </ul>
                </template>
            </template>
        </RecordLayout>

        <HideDialog
            v-model:open="hideOpen"
            :preset="hidePreset"
            :title="trans('vehicles.hide.title')"
            :description="trans('vehicles.hide.body')"
            subject="vehicle"
            :confirm-label="trans('vehicles.actions.hide')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-12.hide"
            @submit="hide"
        />
        <HideDialog
            v-model:open="deleteOpen"
            :title="trans('vehicles.delete.title')"
            :description="trans('vehicles.delete.body')"
            subject="vehicle"
            typed
            :confirm-label="trans('vehicles.actions.delete')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-12.delete"
            @submit="destroy"
        />
        <ConfirmDialog
            v-model:open="unhideOpen"
            :title="trans('vehicles.unhide.title')"
            :body="trans('vehicles.unhide.body')"
            :confirm-label="trans('vehicles.actions.unhide')"
            tone="neutral"
            reason
            :processing="action.processing.value"
            :error="unhideError ?? action.error.value"
            test-id="ADM-12.unhide"
            @confirm="unhide"
        >
            <Field :label="trans('vehicles.unhide.facts')" :hint="trans('vehicles.unhide.facts_hint')" required>
                <Textarea v-model="unhideFacts" :rows="3" :maxlength="5000" data-testid="ADM-12.unhide.facts" />
            </Field>
        </ConfirmDialog>

        <Drawer v-model:open="editOpen" :title="trans('vehicles.edit.title')" :description="trans('vehicles.edit.body')" test-id="ADM-12.edit">
            <form id="adm12-edit" class="flex flex-col gap-16" novalidate @submit.prevent="submitEdit">
                <Field :label="trans('vehicles.fields.make')">
                    <Combobox v-model="makeModel" :options="catalog?.makes ?? []" :disabled="catalogLoading && !catalog" :placeholder="trans('vehicles.edit.choose')" data-testid="ADM-12.edit.make" />
                </Field>
                <Field v-if="edit.make_id === ''" :label="trans('vehicles.edit.make_text')" optional>
                    <Input v-model="edit.make_text" maxlength="100" />
                </Field>
                <Field :label="trans('vehicles.fields.model')">
                    <Combobox v-model="modelModel" :options="catalog?.models ?? []" :disabled="edit.make_id === '' || catalogLoading" :placeholder="trans('vehicles.edit.choose')" data-testid="ADM-12.edit.model" />
                </Field>
                <Field v-if="edit.model_id === ''" :label="trans('vehicles.edit.model_text')" optional>
                    <Input v-model="edit.model_text" maxlength="100" />
                </Field>
                <Field :label="trans('vehicles.fields.generation')" optional>
                    <Select v-model="generationModel" :options="catalog?.generations ?? []" :disabled="edit.model_id === '' || catalogLoading" :placeholder="trans('vehicles.edit.choose')" data-testid="ADM-12.edit.generation" />
                </Field>
                <div class="flex flex-wrap gap-12">
                    <div class="w-120">
                        <Field :label="trans('vehicles.fields.year')" :error="editErrors.model_year" optional>
                            <Input v-model="edit.model_year" inputmode="numeric" maxlength="4" tnum data-testid="ADM-12.edit.year" />
                        </Field>
                    </div>
                    <div class="min-w-200 flex-1">
                        <Field :label="trans('vehicles.fields.nickname')" optional>
                            <Input v-model="edit.nickname" maxlength="60" data-testid="ADM-12.edit.nickname" />
                        </Field>
                    </div>
                </div>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="editErrors.reason" required>
                    <Textarea v-model="edit.reason" :rows="3" :maxlength="1000" show-count data-testid="ADM-12.edit.reason" />
                </Field>
            </form>
            <template #footer>
                <p v-if="action.error.value" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-supporting text-ink" role="alert">
                    <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ action.error.value }}
                </p>
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="editOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm12-edit" variant="primary" :loading="action.processing.value" data-testid="ADM-12.edit.save">{{ trans('vehicles.edit.save') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
