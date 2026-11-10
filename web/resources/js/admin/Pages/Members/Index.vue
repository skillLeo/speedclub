<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhDownloadSimple, PhFunnel, PhMinus, PhProhibit, PhSealCheck, PhShieldCheck, PhSignOut, PhTrash, PhUserCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { BulkAction, TableColumn } from '../../Components/data-table/table';
import type { MenuEntry } from '../../Components/ui/DropdownMenu.vue';
import RestrictDialog from '../../Components/decisions/RestrictDialog.vue';
import { firstError } from '../../Components/decisions/statement';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, DateRangeField, Field, Input, Select, StatusPill, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { usePermissions } from '../../lib/permissions';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { now } from '../../lib/qa';
import { routeOr } from '../../lib/routes';
import type { BulkResult, Paginated, PresetView, SavedView, TableQuery } from '../../types/table';

/**
 * ADM-09 members (06 §3 Members, m3.2-contract §2): server table with filters, the four preset views, CSV of the list, bulk restrict /
 * revoke sessions / export* / delete* (more than 100 → four-eyes) with the per-record result panel. The address is masked unless the
 * staff member holds members.view_pii (server).
 */
interface MemberRow {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar: string | null;
    email: string;
    status: 'active' | 'restricted' | 'suspended' | 'deactivated' | 'pending_deletion';
    restricted: string[];
    vehicles: number;
    followers: number;
    created_at: string | null;
    last_seen_at: string | null;
    two_factor: boolean;
    verified: boolean;
}

const props = defineProps<{
    rows: Paginated<MemberRow>;
    query: TableQuery;
    views: SavedView[];
    bulkResult?: { action: string; rows: BulkResult[]; labels: Record<string, string> } | null;
    piiVisible: boolean;
    listExportAvailable: boolean;
}>();

const state = usePageState();
const { can } = usePermissions();

// Content-sized columns (DQ-526): the name takes the rest, the masked address is never cut, the short columns shrink to their content.
const columns = computed<TableColumn[]>(() => [
    { key: 'avatar', label: trans('members.columns.avatar'), width: 'xs', srOnlyLabel: true },
    // @username with the display name next to it; the name also has a column of its own in the chooser.
    { key: 'username', label: trans('members.columns.username'), sort: 'username', grow: true, min: 200, hideable: false },
    { key: 'display_name', label: trans('members.columns.display_name'), min: 120, defaultHidden: true },
    { key: 'email', label: trans('members.columns.email'), min: 150 },
    { key: 'status', label: trans('members.columns.status') },
    { key: 'vehicles', label: trans('members.columns.vehicles'), sort: 'vehicles_count', numeric: true },
    { key: 'followers', label: trans('members.columns.followers'), sort: 'followers_count', numeric: true, defaultHidden: true },
    { key: 'created_at', label: trans('members.columns.created_at'), sort: 'created_at', min: 96 },
    { key: 'last_seen_at', label: trans('members.columns.last_seen_at'), sort: 'last_seen_at', min: 96 },
    { key: 'two_factor', label: trans('members.columns.two_factor'), width: 'xs' },
    { key: 'verified', label: trans('members.columns.verified'), width: 'xs', defaultHidden: true },
]);

// "Neu diese Woche" starts on this week's Monday (Berlin).
function mondayIso(): string {
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now()) + 'T12:00:00Z');
    const weekday = (today.getUTCDay() + 6) % 7;
    return new Date(today.getTime() - weekday * 86_400_000).toISOString().slice(0, 10);
}
const presets: PresetView[] = [
    { key: 'new', name: 'members.presets.new_week', query: { filter: { registered_from: mondayIso() }, sort: '-created_at' } },
    { key: 'restricted', name: 'members.presets.restricted', query: { filter: { restricted: 'any' } } },
    { key: 'reported', name: 'members.presets.reported', query: { filter: { reported: '1' } } },
    { key: 'no-vehicle', name: 'members.presets.no_vehicle', query: { filter: { has_vehicles: '0' } } },
];

// ---- filters --------------------------------------------------------------------------------------------------------------
const FILTER_KEYS = ['q', 'status', 'restricted', 'reported', 'verified', 'has_vehicles', 'registered_from', 'registered_to', 'active_from', 'active_to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const filters = reactive<Record<FilterKey, string>>(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<FilterKey, string>);
watch(
    () => props.query.filter,
    (filter) => FILTER_KEYS.forEach((key) => (filters[key] = filter[key] ?? '')),
    { immediate: true },
);
const ANY = '*';
function selectModel(key: FilterKey) {
    return computed({
        get: () => (filters[key] === '' ? undefined : filters[key]),
        set: (value: string | undefined) => (filters[key] = value === undefined || value === ANY ? '' : value),
    });
}
const statusModel = selectModel('status');
const restrictedModel = selectModel('restricted');
const reportedModel = selectModel('reported');
const verifiedModel = selectModel('verified');
const vehiclesModel = selectModel('has_vehicles');
const any = computed(() => ({ value: ANY, label: trans('members.filters.any') }));
const statusOptions = computed(() => [any.value, ...(['active', 'suspended', 'deactivated'] as const).map((v) => ({ value: v, label: trans(`members.status.${v}`) }))]);
const restrictedOptions = computed(() => [any.value, ...(['any', 'messaging', 'publishing', 'suspended'] as const).map((v) => ({ value: v, label: trans(`members.filters.restricted_${v}`) }))]);
const yesNo = (prefix: string) => computed(() => [any.value, { value: '1', label: trans(`${prefix}_yes`) }, { value: '0', label: trans(`${prefix}_no`) }]);
const reportedOptions = yesNo('members.filters.reported');
const verifiedOptions = yesNo('members.filters.verified');
const vehiclesOptions = yesNo('members.filters.vehicles');

// ---- cells ------------------------------------------------------------------------------------------------------------------
const tones: Record<MemberRow['status'], Tone> = { active: 'success', restricted: 'warning', suspended: 'danger', deactivated: 'neutral', pending_deletion: 'neutral' };
const showHref = (row: MemberRow): string => routeOr('admin.members.show', `/admin/members/${row.id}`, { member: row.id });

// ---- bulk -------------------------------------------------------------------------------------------------------------------
const bulkActions = computed<BulkAction[]>(() => [
    { key: 'restrict', label: trans('members.bulk.restrict'), icon: PhProhibit, atom: 'members.restrict' },
    { key: 'revoke_sessions', label: trans('members.bulk.revoke_sessions'), icon: PhSignOut, atom: 'members.revoke_sessions' },
    { key: 'export', label: trans('members.bulk.export'), icon: PhDownloadSimple, atom: 'members.export' },
    { key: 'delete', label: trans('members.bulk.delete'), icon: PhTrash, atom: 'members.delete', danger: true },
]);
// The analyst holds none of these: no checkboxes for a selection nothing can act on (DQ-540, 04 §5 "analyst read-only").
const canBulk = computed(() => bulkActions.value.some((action) => can(action.atom)));
const bulkAction = ref<string | null>(null);
const bulkIds = ref<string[]>([]);
const processing = ref(false);
const bulkError = ref<string | null>(null);
const confirmOpen = ref(false);
const restrictOpen = ref(false);

function onBulk(action: string, ids: string[]): void {
    bulkAction.value = action;
    bulkIds.value = ids;
    bulkError.value = null;
    if (action === 'restrict') restrictOpen.value = true;
    else confirmOpen.value = true;
}

function postBulk(data: Record<string, unknown>, done: () => void): void {
    router.post(routeOr('admin.members.bulk', '/admin/members/bulk'), { action: bulkAction.value, ids: bulkIds.value, ...data } as never, {
        preserveScroll: true,
        preserveState: true,
        onStart: () => {
            processing.value = true;
            bulkError.value = null;
        },
        onFinish: () => (processing.value = false),
        onSuccess: done,
        onError: (errors) => (bulkError.value = firstError(errors)),
    });
}

function confirmBulk(reason: string | null): void {
    postBulk({ reason: reason ?? '' }, () => (confirmOpen.value = false));
}

function submitRestrict(payload: Record<string, string | null>): void {
    const { measure, ...rest } = payload;
    postBulk({ ...rest, type: measure }, () => (restrictOpen.value = false));
}

// ---- CSV with addresses (four-eyes members.list_export, SEC-P3-03) -----------------------------------------------------------
const listExportOpen = ref(false);
// One "Exportieren" menu (DQ-539): the masked CSV (lists.export, ADR-232) and the four-eyes CSV with addresses.
const exportEntries = computed<MenuEntry[]>(() =>
    props.listExportAvailable
        ? [{ key: 'pii', label: trans('members.list_export.button'), caption: trans('members.list_export.caption'), icon: PhDownloadSimple, testId: 'ADM-09.list-export-open', onSelect: () => (listExportOpen.value = true) }]
        : [],
);
const listExportError = ref<string | null>(null);
const listExporting = ref(false);
function requestListExport(reason: string | null): void {
    router.post(routeOr('admin.members.list-export', '/admin/members/export-request'), { reason: reason ?? '', filter: props.query.filter, sort: props.query.sort } as never, {
        preserveScroll: true,
        preserveState: true,
        onStart: () => {
            listExporting.value = true;
            listExportError.value = null;
        },
        onFinish: () => (listExporting.value = false),
        onSuccess: () => (listExportOpen.value = false),
        onError: (errors) => (listExportError.value = firstError(errors)),
    });
}

const confirmTexts = computed(() => {
    const key = bulkAction.value ?? 'revoke_sessions';
    return {
        title: trans(`members.bulk.${key}_title`, { count: formatNumber(bulkIds.value.length) }),
        body: trans(`members.bulk.${key}_body`, { count: formatNumber(bulkIds.value.length) }),
        confirm: trans(`members.bulk.${key}`),
    };
});
const fourEyes = computed(() => bulkAction.value === 'export' || bulkAction.value === 'delete' || bulkIds.value.length > 100);

const resultOpen = ref(false);
watch(
    () => props.bulkResult,
    (result) => (resultOpen.value = result !== null && result !== undefined),
    { immediate: true },
);

// ---- QA overlays (?dialog=, non-production, DQ-529) ------------------------------------------------------------------------------
// bulk: three rows selected and the result panel of a run where one of them failed; list-export: the four-eyes export dialog.
const qaOverlay = qaDialog();
const qaSelection = qaOverlay === 'bulk' && canBulk.value ? props.rows.data.slice(0, 3).map((row) => row.id) : [];
const qaResult = computed(() => {
    if (qaOverlay !== 'bulk' || qaSelection.length === 0) return null;
    const rows = props.rows.data.slice(0, 3);
    return {
        action: 'revoke_sessions',
        rows: rows.map((row, index) => ({ id: row.id, ok: index !== 1, code: index === 1 ? 'not_possible' : null })),
        labels: Object.fromEntries(rows.map((row) => [row.id, row.username ? `@${row.username}` : trans('members.no_username')])),
    };
});
const shownResult = computed(() => props.bulkResult ?? qaResult.value);
onMounted(() => {
    if (qaOverlay === 'bulk' && qaResult.value) resultOpen.value = true;
    if (qaOverlay === 'list-export' && props.listExportAvailable) {
        listExportOpen.value = true;
        if (qaDialogFailed()) listExportError.value = trans('ui.state.server_error');
    }
});
</script>

<template>
    <Head :title="trans('members.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-09" :data-qa-state="state">
        <PageHeader :title="trans('members.title')" :crumbs="[{ label: trans('shell.groups.members') }]" :description="trans(piiVisible ? 'members.intro_pii' : 'members.intro')" />

        <DataTable
            id="members"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'bulkResult']"
            :caption="trans('members.caption')"
            :empty-title="trans('members.empty_title')"
            :empty-body="trans('members.empty_body')"
            :selectable="canBulk"
            :bulk-actions="bulkActions"
            :initial-selection="qaSelection"
            :export-url="routeOr('admin.members.export', '/admin/members/export.csv')"
            export-atom="lists.export"
            :export-entries="exportEntries"
            :row-href="showHref"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-09.table"
            @bulk="onBulk"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-col gap-8" :aria-label="trans('members.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="flex flex-wrap items-end gap-8 desktop:flex-nowrap">
                        <div class="min-w-200 grow-2 basis-0">
                            <Field :label="trans('members.filters.q')">
                                <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans(piiVisible ? 'members.filters.q_placeholder_pii' : 'members.filters.q_placeholder')" data-testid="ADM-09.filter.q" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('members.filters.status')">
                                <Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('members.filters.any')" data-testid="ADM-09.filter.status" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('members.filters.restricted')">
                                <Select v-model="restrictedModel" :options="restrictedOptions" size="sm" :placeholder="trans('members.filters.any')" data-testid="ADM-09.filter.restricted" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('members.filters.reported')">
                                <Select v-model="reportedModel" :options="reportedOptions" size="sm" :placeholder="trans('members.filters.any')" data-testid="ADM-09.filter.reported" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('members.filters.verified')">
                                <Select v-model="verifiedModel" :options="verifiedOptions" size="sm" :placeholder="trans('members.filters.any')" data-testid="ADM-09.filter.verified" />
                            </Field>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-end gap-8 desktop:flex-nowrap">
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('members.filters.vehicles')">
                                <Select v-model="vehiclesModel" :options="vehiclesOptions" size="sm" :placeholder="trans('members.filters.any')" data-testid="ADM-09.filter.vehicles" />
                            </Field>
                        </div>
                        <div class="w-256 shrink-0">
                            <Field :label="trans('members.filters.registered')">
                                <DateRangeField v-model:from="filters.registered_from" v-model:to="filters.registered_to" size="sm" test-id="ADM-09.filter.registered" />
                            </Field>
                        </div>
                        <div class="w-256 shrink-0">
                            <Field :label="trans('members.filters.active')">
                                <DateRangeField v-model:from="filters.active_from" v-model:to="filters.active_to" size="sm" test-id="ADM-09.filter.active" />
                            </Field>
                        </div>
                        <div class="grow" />
                        <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-09.filter.apply">{{ trans('members.filters.apply') }}</Button>
                    </div>
                </form>
            </template>

            <template #cell-avatar="{ row }">
                <img v-if="row.avatar" :src="row.avatar" alt="" class="size-24 rounded-full object-cover" loading="lazy" />
                <PhUserCircle v-else :size="24" class="text-ink-3" aria-hidden="true" />
            </template>
            <template #cell-username="{ row }">
                <Link
                    :href="showHref(row)"
                    :title="[row.username ? `@${row.username}` : trans('members.no_username'), row.display_name].filter(Boolean).join(' · ')"
                    :class="[focusRing, 'sc-key flex h-24 min-w-0 items-center gap-8 rounded-xs text-ink hover:underline']"
                    :data-testid="`ADM-09.open`"
                >
                    <span class="shrink-0">{{ row.username ? `@${row.username}` : trans('members.no_username') }}</span>
                    <span v-if="row.display_name" class="truncate text-ink-2">{{ row.display_name }}</span>
                </Link>
            </template>
            <template #cell-display_name="{ row }">
                <span class="block truncate text-ink-2" :title="row.display_name ?? undefined">{{ row.display_name ?? '–' }}</span>
            </template>
            <template #cell-email="{ row }">
                <span class="sc-key block truncate text-ink-2 tabular-nums" :title="row.email" data-testid="ADM-09.email">{{ row.email }}</span>
            </template>
            <template #cell-status="{ row }">
                <StatusPill :tone="tones[row.status]" :label="trans(`members.status.${row.status}`)" />
            </template>
            <template #cell-vehicles="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.vehicles) }}</span>
            </template>
            <template #cell-followers="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.followers) }}</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" :title="formatDateTime(row.created_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
            </template>
            <template #cell-last_seen_at="{ row }">
                <time :datetime="row.last_seen_at ?? undefined" :title="formatDateTime(row.last_seen_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.last_seen_at) }}</time>
            </template>
            <template #cell-two_factor="{ row }">
                <span class="flex h-24 items-center" :title="trans(row.two_factor ? 'members.two_factor_on' : 'members.two_factor_off')">
                    <PhShieldCheck v-if="row.two_factor" :size="16" class="text-ink" aria-hidden="true" />
                    <PhMinus v-else :size="16" class="text-ink-3" aria-hidden="true" />
                    <span class="sr-only">{{ trans(row.two_factor ? 'members.two_factor_on' : 'members.two_factor_off') }}</span>
                </span>
            </template>
            <template #cell-verified="{ row }">
                <span class="flex h-24 items-center" :title="trans(row.verified ? 'members.verified_yes' : 'members.verified_no')">
                    <PhSealCheck v-if="row.verified" :size="16" class="text-ink" aria-hidden="true" />
                    <PhMinus v-else :size="16" class="text-ink-3" aria-hidden="true" />
                    <span class="sr-only">{{ trans(row.verified ? 'members.verified_yes' : 'members.verified_no') }}</span>
                </span>
            </template>
        </DataTable>

        <!-- bulk: revoke sessions, export*, delete* -->
        <ConfirmDialog
            v-model:open="confirmOpen"
            :title="confirmTexts.title"
            :body="confirmTexts.body"
            :confirm-label="confirmTexts.confirm"
            :tone="bulkAction === 'delete' ? 'danger' : 'neutral'"
            :typed="bulkAction === 'delete'"
            reason
            :four-eyes="fourEyes"
            :processing="processing"
            :error="bulkError"
            test-id="ADM-09.bulk-confirm"
            @confirm="confirmBulk"
        />

        <!-- bulk: restrict (a decision per member, with one statement of reasons) -->
        <RestrictDialog
            v-model:open="restrictOpen"
            :title="trans('members.bulk.restrict_title', { count: formatNumber(bulkIds.length) })"
            :description="trans('members.bulk.restrict_body')"
            :four-eyes="bulkIds.length > 100"
            :processing="processing"
            :error="bulkError"
            test-id="ADM-09.bulk-restrict"
            @submit="submitRestrict"
        />

        <ConfirmDialog
            v-if="listExportAvailable"
            v-model:open="listExportOpen"
            :title="trans('members.list_export.title')"
            :body="trans('members.list_export.body', { count: formatNumber(rows.meta.total) })"
            :confirm-label="trans('members.list_export.submit')"
            tone="neutral"
            reason
            four-eyes
            :processing="listExporting"
            :error="listExportError"
            test-id="ADM-09.list-export"
            @confirm="requestListExport"
        />

        <BulkResultPanel
            v-if="shownResult"
            v-model:open="resultOpen"
            :results="shownResult.rows"
            :title="trans(`members.bulk.result_${shownResult.action}`)"
            :label="(id: string) => shownResult?.labels[id] ?? id"
            :reason="(code: string | null) => trans(`members.bulk.codes.${code ?? 'failed'}`)"
            test-id="ADM-09.bulk-result"
        />
    </div>
</template>
