<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhFunnel, PhShieldCheck } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import DiffViewer from '../../Components/patterns/DiffViewer.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import Button from '../../Components/ui/Button.vue';
import Combobox from '../../Components/ui/Combobox.vue';
import ConfirmDialog from '../../Components/ui/ConfirmDialog.vue';
import Drawer from '../../Components/ui/Drawer.vue';
import Field from '../../Components/ui/Field.vue';
import DateRangeField from '../../Components/ui/DateRangeField.vue';
import Input from '../../Components/ui/Input.vue';
import RadioGroup from '../../Components/ui/RadioGroup.vue';
import Select from '../../Components/ui/Select.vue';
import Skeleton from '../../Components/ui/Skeleton.vue';
import StatusPill from '../../Components/ui/StatusPill.vue';
import { usePageState } from '../../composables/pageState';
import { actionLabel } from '../../lib/audit';
import { formatDateTime, formatNumber, formatTime } from '../../lib/format';
import { requestJson } from '../../lib/http';
import { routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';

/**
 * ADM-44 audit log (06 §3 Audit & privacy): filters actor, action, target and date range; event drawer with the before/after diff;
 * chain status of the last audit:verify; export only as a four-eyes request (audit.export).
 */
interface AuditRow {
    id: number;
    occurred_at: string;
    actor: { type: 'staff' | 'member' | 'system'; id: string | null; label: string | null };
    action: string;
    target: { type: string; id: string | null } | null;
    reason: string | null;
    has_diff: boolean;
}
interface AuditEventDetail extends AuditRow {
    before: unknown;
    after: unknown;
    request_id: string | null;
    hash: string;
    missing: false;
}

const props = defineProps<{
    rows: Paginated<AuditRow>;
    query: TableQuery;
    views: SavedView[];
    chain: { intact: boolean; checked: number; broken_at: number | null; verified_at: string | null } | null;
    actors: { value: string; label: string }[];
    targetTypes: string[];
    selected?: AuditEventDetail | { id: number; missing: true } | null;
    canExport: boolean;
}>();

const state = usePageState();

const columns = computed<TableColumn[]>(() => [
    // Content-sized (DQ-526): the action label is never cut (min 220), who and the time shrink to their content, the reason takes the rest.
    { key: 'occurred_at', label: trans('audit.columns.occurred_at'), sort: 'occurred_at', min: 120, hideable: false },
    { key: 'actor', label: trans('audit.columns.actor'), min: 96 },
    { key: 'action', label: trans('audit.columns.action'), sort: 'action', min: 220, hideable: false },
    { key: 'target', label: trans('audit.columns.target'), min: 120 },
    { key: 'reason', label: trans('audit.columns.reason'), grow: true, min: 160 },
    { key: 'id', label: trans('audit.columns.id'), numeric: true, defaultHidden: true },
]);

const presets: PresetView[] = [
    { key: 'staff', name: 'audit.presets.staff', query: { filter: { actor: 'staff' } } },
    { key: 'approvals', name: 'audit.presets.approvals', query: { filter: { action: 'approval.' } } },
    { key: 'security', name: 'audit.presets.security', query: { filter: { action: 'staff.' } } },
];

// ---- filters --------------------------------------------------------------------------------------------------------------
const filters = reactive({ actor: '', action: '', target_type: '', target_id: '', from: '', to: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.actor = filter.actor ?? '';
        filters.action = filter.action ?? '';
        filters.target_type = filter.target_type ?? '';
        filters.target_id = filter.target_id ?? '';
        filters.from = filter.from ?? '';
        filters.to = filter.to ?? '';
    },
    { immediate: true },
);

const actorOptions = computed(() => [
    { value: 'system', label: trans('audit.actor.system') },
    { value: 'member', label: trans('audit.actor.any_member') },
    { value: 'staff', label: trans('audit.actor.any_staff') },
    ...props.actors,
]);
const actorModel = computed({
    get: () => (filters.actor === '' ? undefined : filters.actor),
    set: (value: string | undefined) => (filters.actor = value ?? ''),
});
// Reka's Select has no empty-string item: "any" stands for no filter.
const ANY = '*';
const targetOptions = computed(() => [{ value: ANY, label: trans('audit.filters.any_target') }, ...props.targetTypes.map((type) => ({ value: type, label: targetName(type) }))]);
// "Alle" shows as the placeholder, like the Combobox next to it (DQ-509): one look for "no filter".
const targetModel = computed({
    get: () => (filters.target_type === '' ? undefined : filters.target_type),
    set: (value: string | undefined) => (filters.target_type = value === undefined || value === ANY ? '' : value),
});

function translated(key: string, fallback: string): string {
    const text = trans(key);
    return text === key ? fallback : text;
}
/** DQ-553: a ULID shows its last 8 characters ("Fall CEJCECAT"), the full id stays in the title and the drawer; short ids stay whole. */
function shortId(id: string | null): string {
    if (id === null) return '';
    return id.length > 12 ? id.slice(-8).toUpperCase() : id;
}

function targetName(type: string): string {
    return translated(`audit.targets.${type}`, type);
}
function actorLabel(row: AuditRow): string {
    if (row.actor.type === 'system') return trans('audit.actor.system');
    return row.actor.label ?? `${trans(`audit.actor.${row.actor.type}`)} ${row.actor.id ?? ''}`.trim();
}

// ---- event drawer ---------------------------------------------------------------------------------------------------------
const drawerOpen = ref(props.selected !== undefined && props.selected !== null);
const loadingEvent = ref(false);
const eventFailed = ref(false);
const detail = computed(() => (props.selected && !props.selected.missing ? props.selected : null));

function openEvent(row: AuditRow): void {
    drawerOpen.value = true;
    eventFailed.value = false;
    router.reload({
        data: { event: row.id },
        only: ['selected'],
        onStart: () => (loadingEvent.value = true),
        onFinish: () => (loadingEvent.value = false),
        onNetworkError: () => {
            eventFailed.value = true;
            return false;
        },
    });
}

watch(drawerOpen, (open) => {
    if (open) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('event')) return;
    url.searchParams.delete('event');
    router.get(url.pathname + url.search, {}, { only: ['selected'], preserveState: true, preserveScroll: true, replace: true });
});

// ---- hash check of this page (09 §10.2) ------------------------------------------------------------------------------------
interface PageCheck {
    checked: number;
    missing: number;
    intact: boolean;
    broken: number[];
    checked_at: string;
}
const pageCheck = ref<PageCheck | null>(null);
const pageCheckState = ref<'idle' | 'checking' | 'failed'>('idle');
watch(
    () => props.rows,
    () => {
        pageCheck.value = null;
        pageCheckState.value = 'idle';
    },
);
async function checkPage(): Promise<void> {
    const ids = props.rows.data.map((row) => row.id);
    if (ids.length === 0) return;
    pageCheckState.value = 'checking';
    try {
        pageCheck.value = await requestJson<PageCheck>('get', routeOr('admin.audit.verify-page', '/admin/audit/verify-page'), { ids: ids.join(',') });
        pageCheckState.value = 'idle';
    } catch {
        pageCheckState.value = 'failed';
    }
}

// ---- export (four-eyes) ---------------------------------------------------------------------------------------------------
const exportOpen = ref(false);
const formats = [
    { value: 'csv', label: 'CSV' },
    { value: 'jsonl', label: 'JSONL' },
];
const exportFormat = ref<string | undefined>('csv');
const exporting = ref(false);
const exportError = ref<string | null>(null);

function requestExport(reason: string | null): void {
    router.post(
        routeOr('admin.audit.export', '/admin/audit/export'),
        { format: exportFormat.value ?? 'csv', reason: reason ?? '', filter: props.query.filter },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => {
                exporting.value = true;
                exportError.value = null;
            },
            onFinish: () => (exporting.value = false),
            onSuccess: () => (exportOpen.value = false),
            onError: (errors) => {
                exportError.value = errors.reason ?? errors.format ?? errors.filter ?? trans('ui.state.error_title');
            },
        },
    );
}
</script>

<template>
    <Head :title="trans('audit.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-44" :data-qa-state="state">
        <PageHeader :title="trans('audit.title')" :crumbs="[{ label: trans('shell.groups.audit_privacy') }]" :description="trans('audit.intro')">
            <template #badge>
                <StatusPill v-if="chain && chain.intact" tone="success" :label="trans('audit.chain.intact', { time: formatTime(chain.verified_at) })" :title="formatDateTime(chain.verified_at)" data-testid="ADM-44.chain" />
                <StatusPill v-else-if="chain" tone="danger" :label="trans('audit.chain.broken', { id: formatNumber(chain.broken_at) })" data-testid="ADM-44.chain" />
                <StatusPill v-else tone="warning" :label="trans('audit.chain.unknown')" data-testid="ADM-44.chain" />
            </template>
        </PageHeader>

        <StateBlock
            v-if="chain && !chain.intact"
            kind="error"
            :title="trans('audit.chain.broken_title')"
            :body="trans('audit.chain.broken_body', { id: formatNumber(chain.broken_at), checked: formatNumber(chain.checked) })"
            :retryable="false"
            test-id="ADM-44.chain-broken"
        />

        <DataTable
            id="audit"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('audit.caption')"
            :empty-title="trans('audit.empty_title')"
            :empty-body="trans('audit.empty_body')"
            export-atom="audit.export"
            export-request
            clickable-rows
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-44.table"
            @open="openEvent"
            @export="exportOpen = true"
        >
            <template #actions>
                <span v-if="pageCheck" class="flex items-center text-admin-base tabular-nums" :class="pageCheck.intact ? 'text-success' : 'text-danger'" role="status" data-testid="ADM-44.page-check.result">
                    {{ pageCheck.intact ? trans('audit.page_check.intact', { count: formatNumber(pageCheck.checked) }) : trans('audit.page_check.broken', { ids: pageCheck.broken.map((id) => formatNumber(id)).join(', ') || '–' }) }}
                </span>
                <span v-else-if="pageCheckState === 'failed'" class="text-admin-base text-danger" role="alert">{{ trans('audit.page_check.failed') }}</span>
                <Button size="sm" variant="secondary" :icon="PhShieldCheck" :loading="pageCheckState === 'checking'" data-testid="ADM-44.page-check" @click="checkPage">{{ trans('audit.page_check.action') }}</Button>
            </template>
            <template #filters="{ apply, loading }">
                <!-- One row (DQ-509): Wer · Aktion · Ziel (type + id) · Zeitraum · Anwenden. -->
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('audit.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-140 grow basis-0">
                        <Field :label="trans('audit.filters.actor')">
                            <Combobox v-model="actorModel" :options="actorOptions" size="sm" :placeholder="trans('audit.filters.any_actor')" data-testid="ADM-44.filter.actor" />
                        </Field>
                    </div>
                    <div class="min-w-140 grow basis-0">
                        <Field :label="trans('audit.filters.action')">
                            <Input v-model="filters.action" size="sm" maxlength="100" :placeholder="trans('audit.filters.action_placeholder')" data-testid="ADM-44.filter.action" />
                        </Field>
                    </div>
                    <fieldset class="min-w-240 grow-2 basis-0">
                        <legend class="mb-4 text-admin-base-strong text-ink">{{ trans('audit.filters.target') }}</legend>
                        <div class="flex gap-4">
                            <div class="w-1/2 min-w-0">
                                <Select v-model="targetModel" :options="targetOptions" size="sm" :placeholder="trans('audit.filters.any_target')" :aria-label="trans('audit.filters.target_type')" data-testid="ADM-44.filter.target-type" />
                            </div>
                            <div class="w-1/2 min-w-0">
                                <Input v-model="filters.target_id" size="sm" maxlength="26" :placeholder="trans('audit.filters.target_id')" :aria-label="trans('audit.filters.target_id')" data-testid="ADM-44.filter.target-id" />
                            </div>
                        </div>
                    </fieldset>
                    <div class="w-256 shrink-0">
                        <Field :label="trans('audit.filters.period')">
                            <DateRangeField v-model:from="filters.from" v-model:to="filters.to" size="sm" test-id="ADM-44.filter.period" />
                        </Field>
                    </div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-44.filter.apply">{{ trans('audit.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-occurred_at="{ row }">
                <time :datetime="row.occurred_at" class="block truncate text-ink tabular-nums" :title="formatDateTime(row.occurred_at)">{{ formatDateTime(row.occurred_at) }}</time>
            </template>
            <template #cell-actor="{ row }">
                <span class="block truncate" :class="row.actor.type === 'system' ? 'text-ink-3' : 'text-ink'" :title="actorLabel(row)">{{ actorLabel(row) }}</span>
            </template>
            <template #cell-action="{ row }">
                <button
                    type="button"
                    class="flex h-32 w-full min-w-0 items-center rounded-xs text-left text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    :title="row.action"
                    :aria-label="`${actionLabel(row.action)} (${row.action})`"
                    data-testid="ADM-44.open"
                    @click="openEvent(row)"
                >
                    <span class="truncate">{{ actionLabel(row.action) }}</span>
                </button>
            </template>
            <template #cell-target="{ row }">
                <span v-if="row.target" class="block whitespace-nowrap text-ink-2" :title="`${targetName(row.target.type)} ${row.target.id ?? ''}`.trim()">{{ targetName(row.target.type) }} <span class="sc-key text-ink-2 tabular-nums">{{ shortId(row.target.id) }}</span></span>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-reason="{ row }">
                <span class="line-clamp-2 text-ink-2" :title="row.reason ?? undefined">{{ row.reason ?? '–' }}</span>
            </template>
        </DataTable>

        <!-- event drawer -->
        <Drawer v-model:open="drawerOpen" :title="detail ? actionLabel(detail.action) : trans('audit.event.title')" :description="detail ? `${formatDateTime(detail.occurred_at)} · ${trans('audit.event.key', { key: detail.action })}` : undefined" size="lg" test-id="ADM-44.drawer">
            <div v-if="loadingEvent" class="flex flex-col gap-12" aria-busy="true">
                <Skeleton v-for="n in 5" :key="n" shape="text" class="w-3/4" />
                <Skeleton class="h-160 w-full" />
            </div>
            <StateBlock v-else-if="eventFailed" kind="error" :title="trans('audit.event.failed')" :retryable="false" />
            <StateBlock v-else-if="selected && selected.missing" kind="error" :title="trans('audit.event.missing')" :retryable="false" />
            <div v-else-if="detail" class="flex flex-col gap-24" data-testid="ADM-44.event">
                <dl class="grid grid-cols-1 gap-x-24 gap-y-12 tablet:grid-cols-2">
                    <div class="flex flex-col gap-2">
                        <dt class="text-caption text-ink-3">{{ trans('audit.columns.actor') }}</dt>
                        <dd class="text-admin-base text-ink">{{ actorLabel(detail) }}</dd>
                    </div>
                    <div class="flex flex-col gap-2">
                        <dt class="text-caption text-ink-3">{{ trans('audit.columns.target') }}</dt>
                        <dd class="text-admin-base text-ink">{{ detail.target ? `${targetName(detail.target.type)} ${detail.target.id ?? ''}` : '–' }}</dd>
                    </div>
                    <div class="flex flex-col gap-2 tablet:col-span-2">
                        <dt class="text-caption text-ink-3">{{ trans('audit.columns.reason') }}</dt>
                        <dd class="text-admin-base text-ink">{{ detail.reason ?? '–' }}</dd>
                    </div>
                    <div class="flex flex-col gap-2">
                        <dt class="text-caption text-ink-3">{{ trans('audit.event.request') }}</dt>
                        <dd class="break-all text-admin-base text-ink-2 tabular-nums">{{ detail.request_id ?? '–' }}</dd>
                    </div>
                    <div class="flex flex-col gap-2">
                        <dt class="text-caption text-ink-3">{{ trans('audit.event.hash') }}</dt>
                        <dd class="break-all text-admin-base text-ink-2 tabular-nums">{{ detail.hash }}</dd>
                    </div>
                </dl>
                <section class="flex flex-col gap-8" :aria-label="trans('audit.event.diff')">
                    <h3 class="text-admin-base-strong text-ink">{{ trans('audit.event.diff') }}</h3>
                    <DiffViewer :before="detail.before" :after="detail.after" test-id="ADM-44.diff" />
                </section>
                <p class="text-admin-base text-ink-3">{{ trans('audit.event.viewed_note') }}</p>
            </div>
        </Drawer>

        <!-- export request -->
        <ConfirmDialog
            v-if="canExport"
            v-model:open="exportOpen"
            :title="trans('audit.export.title')"
            :body="trans('audit.export.body', { count: formatNumber(rows.meta.total) })"
            :confirm-label="trans('audit.export.submit')"
            tone="neutral"
            reason
            four-eyes
            :processing="exporting"
            :error="exportError"
            test-id="ADM-44.export-dialog"
            @confirm="requestExport"
        >
            <RadioGroup v-model="exportFormat" :legend="trans('audit.export.format')" :options="formats" orientation="horizontal" data-testid="ADM-44.export-format" />
        </ConfirmDialog>
    </div>
</template>
