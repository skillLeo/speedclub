<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhCheckCircle, PhFunnel, PhHandPointing, PhRobot } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { BulkAction, TableColumn } from '../../Components/data-table/table';
import { firstError } from '../../Components/decisions/statement';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Field, Input, Select, StatusPill, Tabs, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { BulkResult, Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import PriorityCell from './Partials/PriorityCell.vue';
import { appealTones, caseHref, outcomeTones, reasonText, statusTones, type CaseRow, type DecisionActionKey, type TargetType } from './shared';

/**
 * ADM-20 moderation queue (06 §3 Moderation, m3.4-contract §2): Neu · In Prüfung · Entschieden · Einsprüche. Priority with its parts in the
 * tooltip, target by type and label (never message content), reason, reporters, first/last report, assignee, status, the [AI] slot
 * (only with ai.moderation_triage, label "KI-Vorschlag", a person decides). "Übernehmen" per row and bulk "Keine Maßnahme" for spam waves
 * (more than 100 in 24 h → four-eyes), with the per-record result panel.
 */
type Tab = 'new' | 'in_review' | 'decided' | 'appeals';
interface AppealRow {
    id: string;
    status: 'open' | 'upheld' | 'reversed';
    role: 'affected' | 'reporter';
    appellant: string | null;
    created_at: string;
    decided_at: string | null;
    decided_by: string | null;
    decision: { id: string; action: DecisionActionKey; decided_at: string; decided_by: string | null } | null;
    case: { id: string; reference: string; target_type: TargetType; target_label: string | null } | null;
    may_decide: boolean;
}
type Row = CaseRow | AppealRow;

const props = defineProps<{
    rows: Paginated<Row>;
    query: TableQuery;
    views: SavedView[];
    tab: Tab;
    counts?: Record<Tab, number>;
    aiTriage: boolean;
    bulkResult?: { rows: BulkResult[]; labels: Record<string, string> } | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const appeals = computed(() => props.tab === 'appeals');
const open = computed(() => props.tab === 'new' || props.tab === 'in_review');

const tabs = computed<TabItem[]>(() =>
    (['new', 'in_review', 'decided', 'appeals'] as const).map((value) => ({ value, label: trans(`moderation.reports.tabs.${value}`), count: state.value === 'empty' ? 0 : (props.counts?.[value] ?? null) })),
);
const tabModel = computed({
    get: () => props.tab,
    set: (tab: string) => router.get(routeOr('admin.moderation.reports', '/admin/moderation/reports'), tab === 'new' ? {} : { tab }, { preserveState: false, preserveScroll: false }),
});

const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1440px)').matches;
const caseColumns = computed<TableColumn[]>(() => [
    { key: 'priority', label: trans('moderation.reports.columns.priority'), sort: 'priority', numeric: true, min: 80, hideable: false },
    { key: 'target', label: trans('moderation.reports.columns.target'), grow: true, hideable: false },
    // DQ-553: the reason wraps to two lines at 240 and the first report hides below 1440, so Zuständig and Status stay in view at 1280.
    { key: 'reason', label: trans('moderation.reports.columns.reason'), width: 'lg', wrap: true },
    { key: 'reporters', label: trans('moderation.reports.columns.reporters'), sort: 'reporters', numeric: true, min: 80 },
    // DQ-703: on Entschieden the decision column (outcome and date) takes the place of the first report and of the status, which reads
    // "Entschieden" on every row there; both stay under Spalten. Otherwise the German table ran past 1440 px.
    { key: 'first_report_at', label: trans('moderation.reports.columns.first_report'), sort: 'created_at', min: 96, defaultHidden: !wide || props.tab === 'decided' },
    { key: 'last_report_at', label: trans('moderation.reports.columns.last_report'), sort: 'last_report_at', min: 96, defaultHidden: true },
    ...(props.tab === 'decided' ? [{ key: 'decision', label: trans('moderation.reports.columns.decision'), sort: 'decided_at', min: 160 } satisfies TableColumn] : []),
    { key: 'assigned', label: trans('moderation.reports.columns.assigned'), min: 120 },
    { key: 'status', label: trans('moderation.reports.columns.status'), defaultHidden: open.value || props.tab === 'decided' },
    ...(props.aiTriage ? [{ key: 'ai', label: trans('moderation.reports.columns.ai'), min: 200 } satisfies TableColumn] : []),
]);
const appealColumns = computed<TableColumn[]>(() => [
    { key: 'case', label: trans('moderation.reports.columns.case'), min: 96, hideable: false },
    { key: 'target', label: trans('moderation.reports.columns.target'), grow: true, hideable: false },
    { key: 'original', label: trans('moderation.reports.columns.original'), min: 160 },
    { key: 'role', label: trans('moderation.reports.columns.role'), min: 150 },
    { key: 'created_at', label: trans('moderation.reports.columns.filed'), sort: 'created_at', min: 96 },
    { key: 'status', label: trans('moderation.reports.columns.status') },
    { key: 'decider', label: trans('moderation.reports.columns.decider'), min: 120, defaultHidden: true },
]);
const columns = computed(() => (appeals.value ? appealColumns.value : caseColumns.value));
const APPEAL_PRESETS: PresetView[] = [{ key: 'open', name: 'moderation.appeal_status.open', query: { filter: { status: 'open' } } }];
const CASE_PRESETS: PresetView[] = [
    { key: 'mine', name: 'moderation.reports.filters.assigned_me', query: { filter: { assigned: 'me' } } },
    { key: 'automated', name: 'moderation.reports.filters.source_automated', query: { filter: { source: 'automated' } } },
];
const presets = computed<PresetView[]>(() => (appeals.value ? APPEAL_PRESETS : CASE_PRESETS));

// ---- filters --------------------------------------------------------------------------------------------------------------
const FILTER_KEYS = ['q', 'target_type', 'reason', 'assigned', 'source', 'status', 'role'] as const;
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
const typeModel = selectModel('target_type');
const reasonModel = selectModel('reason');
const assignedModel = selectModel('assigned');
const sourceModel = selectModel('source');
const statusModel = selectModel('status');
const roleModel = selectModel('role');
const any = computed(() => ({ value: ANY, label: trans('moderation.reports.filters.any') }));
const typeOptions = computed(() => [any.value, ...(['member', 'vehicle', 'photo', 'message', 'build_update', 'modification', 'comment', 'event'] as const).map((v) => ({ value: v, label: trans(`moderation.target_types.${v}`) }))]);
const reasonOptions = computed(() => [any.value, ...(['illegal', 'harassment', 'nudity', 'impersonation', 'spam', 'other'] as const).map((v) => ({ value: v, label: trans(`moderation.reasons.${v}`) }))]);
const assignedOptions = computed(() => [any.value, ...(['me', 'none', 'others'] as const).map((v) => ({ value: v, label: trans(`moderation.reports.filters.assigned_${v}`) }))]);
const sourceOptions = computed(() => [any.value, ...(['automated', 'web_form', 'staff'] as const).map((v) => ({ value: v, label: trans(`moderation.reports.filters.source_${v}`) }))]);
const appealStatusOptions = computed(() => [any.value, ...(['open', 'upheld', 'reversed'] as const).map((v) => ({ value: v, label: trans(`moderation.appeal_status.${v}`) }))]);
const roleOptions = computed(() => [any.value, ...(['affected', 'reporter'] as const).map((v) => ({ value: v, label: trans(`moderation.roles.${v}`) }))]);
function filterPayload(): Record<string, string> {
    const keys: FilterKey[] = appeals.value ? ['status', 'role'] : ['q', 'target_type', 'reason', 'assigned', 'source'];
    return Object.fromEntries(keys.map((k) => [k, filters[k]]));
}

// ---- rows -------------------------------------------------------------------------------------------------------------------
const asCase = (row: Row): CaseRow => row as CaseRow;
const asAppeal = (row: Row): AppealRow => row as AppealRow;
const rowHref = (row: Row): string | null => (appeals.value ? (asAppeal(row).case ? caseHref(asAppeal(row).case!.id) : null) : caseHref(row.id));

const taking = ref<string | null>(null);
function take(row: CaseRow): void {
    taking.value = row.id;
    router.post(routeOr('admin.moderation.cases.assign', `/admin/moderation/cases/${row.id}/assign`, { case: row.id }), {}, { preserveScroll: true, preserveState: true, onFinish: () => (taking.value = null) });
}

// ---- bulk -------------------------------------------------------------------------------------------------------------------
const bulkActions = computed<BulkAction[]>(() => (open.value ? [{ key: 'no_action', label: trans('moderation.reports.bulk.no_action'), icon: PhCheckCircle, atom: 'moderation.decide' }] : []));
const bulkIds = ref<string[]>([]);
const confirmOpen = ref(qaDialog() === 'bulk');
const processing = ref(false);
const bulkError = ref<string | null>(null);
function onBulk(_action: string, ids: string[]): void {
    bulkIds.value = ids;
    bulkError.value = null;
    confirmOpen.value = true;
}
function confirmBulk(reason: string | null): void {
    router.post(routeOr('admin.moderation.reports.bulk', '/admin/moderation/reports/bulk'), { action: 'no_action', ids: bulkIds.value, reason: reason ?? '' } as never, {
        preserveScroll: true,
        preserveState: true,
        onStart: () => {
            processing.value = true;
            bulkError.value = null;
        },
        onFinish: () => (processing.value = false),
        onSuccess: () => (confirmOpen.value = false),
        onError: (errors) => (bulkError.value = firstError(errors)),
    });
}
const resultOpen = ref(false);
watch(
    () => props.bulkResult,
    (result) => (resultOpen.value = result !== null && result !== undefined),
    { immediate: true },
);
const emptyKey = computed(() => props.tab);
</script>

<template>
    <Head :title="trans('moderation.reports.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-20" :data-qa-state="state">
        <PageHeader :title="trans('moderation.reports.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('moderation.reports.intro')" />

        <div class="flex flex-col gap-12">
            <Tabs v-model="tabModel" :items="tabs" :label="trans('moderation.reports.tabs.label')" :panels="false" data-testid="ADM-20.tabs" />
            <p class="flex min-h-32 items-center text-admin-base text-ink-2" data-testid="ADM-20.toolbar">{{ trans(`moderation.reports.toolbar.${tab}`) }}</p>
        </div>

        <DataTable
            :id="`moderation-${tab}`"
            :key="tab"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'counts', 'bulkResult']"
            :caption="trans('moderation.reports.caption')"
            :empty-title="trans(`moderation.reports.empty.${emptyKey}_title`)"
            :empty-body="trans(`moderation.reports.empty.${emptyKey}_body`)"
            :selectable="bulkActions.length > 0 && can('moderation.decide')"
            :bulk-actions="bulkActions"
            :row-href="rowHref"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-20.table"
            @bulk="onBulk"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('moderation.reports.filters.label')" @submit.prevent="apply(filterPayload())">
                    <template v-if="!appeals">
                        <div class="min-w-200 grow-2 basis-0">
                            <Field :label="trans('moderation.reports.filters.q')">
                                <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('moderation.reports.filters.q_placeholder')" data-testid="ADM-20.filter.q" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('moderation.reports.filters.target_type')"><Select v-model="typeModel" :options="typeOptions" size="sm" :placeholder="trans('moderation.reports.filters.any')" data-testid="ADM-20.filter.type" /></Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('moderation.reports.filters.reason')"><Select v-model="reasonModel" :options="reasonOptions" size="sm" :placeholder="trans('moderation.reports.filters.any')" data-testid="ADM-20.filter.reason" /></Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('moderation.reports.filters.assigned')"><Select v-model="assignedModel" :options="assignedOptions" size="sm" :placeholder="trans('moderation.reports.filters.any')" data-testid="ADM-20.filter.assigned" /></Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('moderation.reports.filters.source')"><Select v-model="sourceModel" :options="sourceOptions" size="sm" :placeholder="trans('moderation.reports.filters.any')" data-testid="ADM-20.filter.source" /></Field>
                        </div>
                    </template>
                    <template v-else>
                        <div class="w-200">
                            <Field :label="trans('moderation.reports.filters.status')"><Select v-model="statusModel" :options="appealStatusOptions" size="sm" :placeholder="trans('moderation.reports.filters.any')" data-testid="ADM-20.filter.status" /></Field>
                        </div>
                        <div class="w-200">
                            <Field :label="trans('moderation.reports.filters.role')"><Select v-model="roleModel" :options="roleOptions" size="sm" :placeholder="trans('moderation.reports.filters.any')" data-testid="ADM-20.filter.role" /></Field>
                        </div>
                        <div class="grow" />
                    </template>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-20.filter.apply">{{ trans('moderation.reports.filters.apply') }}</Button>
                </form>
            </template>

            <!-- cases -->
            <template #cell-priority="{ row }">
                <PriorityCell :priority="asCase(row).priority" test-id="ADM-20.priority" />
            </template>
            <template #cell-target="{ row }">
                <NameCell
                    v-if="!appeals"
                    :name="asCase(row).target_label || trans('moderation.unnamed')"
                    :caption="[trans(`moderation.target_types.${asCase(row).target_type}`), asCase(row).reference, asCase(row).automated ? trans('moderation.sources.automated') : null, asCase(row).web_form ? trans('moderation.sources.web_form') : null, asCase(row).origin === 'staff' ? trans('moderation.origin_staff') : null].filter(Boolean).join(' · ')"
                    :href="caseHref(row.id)"
                    test-id="ADM-20.open"
                />
                <NameCell
                    v-else-if="asAppeal(row).case"
                    :name="asAppeal(row).case!.target_label || trans('moderation.unnamed')"
                    :caption="[trans(`moderation.target_types.${asAppeal(row).case!.target_type}`), asAppeal(row).appellant ? `@${asAppeal(row).appellant}` : null].filter(Boolean).join(' · ')"
                    :href="caseHref(asAppeal(row).case!.id)"
                    test-id="ADM-20.open"
                />
            </template>
            <template #cell-reason="{ row }">
                <span class="flex min-w-0 flex-col" :title="reasonText(asCase(row).reason, asCase(row).sub_reason)">
                    <span class="line-clamp-2 text-ink-2">{{ reasonText(asCase(row).reason, asCase(row).sub_reason) }}</span>
                    <span v-if="asCase(row).other_reasons > 0" class="text-caption text-ink-3 tabular-nums">{{ trans('moderation.reports.more_reasons', { count: formatNumber(asCase(row).other_reasons) }) }}</span>
                </span>
            </template>
            <template #cell-reporters="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(asCase(row).reporters) }}</span>
            </template>
            <template #cell-first_report_at="{ row }">
                <time :datetime="asCase(row).first_report_at ?? undefined" :title="formatDateTime(asCase(row).first_report_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(asCase(row).first_report_at) }}</time>
            </template>
            <template #cell-last_report_at="{ row }">
                <time :datetime="asCase(row).last_report_at ?? undefined" :title="formatDateTime(asCase(row).last_report_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(asCase(row).last_report_at) }}</time>
            </template>
            <template #cell-decision="{ row }">
                <span v-if="asCase(row).decision" class="flex items-center gap-8 whitespace-nowrap">
                    <StatusPill :tone="outcomeTones[asCase(row).decision!.action]" :label="trans(`moderation.outcomes.${asCase(row).decision!.action}`)" />
                    <time class="text-caption text-ink-3 tabular-nums" :datetime="asCase(row).decision!.decided_at">{{ formatDate(asCase(row).decision!.decided_at) }}</time>
                </span>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-assigned="{ row }">
                <span v-if="asCase(row).assigned" class="block whitespace-nowrap text-ink-2">{{ asCase(row).assigned!.me ? trans('moderation.reports.you') : asCase(row).assigned!.name }}</span>
                <Button
                    v-else-if="open && can('moderation.decide')"
                    size="sm"
                    variant="ghost"
                    :icon="PhHandPointing"
                    :loading="taking === row.id"
                    data-testid="ADM-20.take"
                    @click.stop.prevent="take(asCase(row))"
                >
                    {{ trans('moderation.reports.take') }}
                </Button>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-status="{ row }">
                <StatusPill v-if="!appeals" :tone="statusTones[asCase(row).status]" :label="trans(`moderation.status.${asCase(row).status}`)" />
                <StatusPill v-else :tone="appealTones[asAppeal(row).status]" :label="trans(`moderation.appeal_status.${asAppeal(row).status}`)" />
            </template>
            <template #cell-ai="{ row }">
                <span v-if="asCase(row).ai_score !== null" class="flex min-w-0 items-center gap-8" :title="asCase(row).ai_summary ?? undefined">
                    <Badge tone="neutral" tnum><PhRobot :size="16" aria-hidden="true" />{{ formatNumber(Math.round((asCase(row).ai_score ?? 0) * 100)) }}</Badge>
                    <span class="truncate text-caption text-ink-2">{{ asCase(row).ai_summary }}</span>
                </span>
                <span v-else class="text-ink-3">–</span>
            </template>

            <!-- appeals -->
            <template #cell-case="{ row }">
                <Link v-if="asAppeal(row).case" :href="caseHref(asAppeal(row).case!.id)" :class="[focusRing, 'sc-key inline-flex h-32 items-center whitespace-nowrap rounded-xs text-ink tabular-nums hover:underline']">{{ asAppeal(row).case!.reference }}</Link>
            </template>
            <template #cell-original="{ row }">
                <span v-if="asAppeal(row).decision" class="flex flex-col items-start">
                    <StatusPill :tone="outcomeTones[asAppeal(row).decision!.action]" :label="trans(`moderation.outcomes.${asAppeal(row).decision!.action}`)" />
                </span>
            </template>
            <template #cell-role="{ row }">
                <span class="whitespace-nowrap text-ink-2">{{ trans(`moderation.roles.${asAppeal(row).role}`) }}</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="asAppeal(row).created_at" :title="formatDateTime(asAppeal(row).created_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(asAppeal(row).created_at) }}</time>
            </template>
            <template #cell-decider="{ row }">
                <span class="whitespace-nowrap text-ink-2">{{ asAppeal(row).decided_by ?? '–' }}</span>
            </template>
        </DataTable>

        <ConfirmDialog
            v-model:open="confirmOpen"
            :title="trans('moderation.reports.bulk.title', { count: formatNumber(bulkIds.length) })"
            :body="trans('moderation.reports.bulk.body')"
            :confirm-label="trans('moderation.reports.bulk.no_action')"
            tone="neutral"
            reason
            :four-eyes="bulkIds.length > 100"
            :processing="processing"
            :error="bulkError"
            test-id="ADM-20.bulk-confirm"
            @confirm="confirmBulk"
        />
        <BulkResultPanel
            v-if="bulkResult"
            v-model:open="resultOpen"
            :results="bulkResult.rows"
            :title="trans('moderation.reports.bulk.result')"
            :label="(id: string) => bulkResult?.labels[id] ?? id"
            :reason="(code: string | null) => trans(`moderation.reports.bulk.codes.${code ?? 'failed'}`)"
            test-id="ADM-20.bulk-result"
        />
    </div>
</template>
