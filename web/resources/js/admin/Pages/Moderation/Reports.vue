<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowSquareOut, PhCheckCircle, PhFlag, PhFunnel, PhGavel, PhHandPointing, PhLockSimple, PhMagnifyingGlass, PhRobot, PhX } from '@phosphor-icons/vue';
import { useMediaQuery } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { BulkAction, TableColumn } from '../../Components/data-table/table';
import { firstError } from '../../Components/decisions/statement';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Field, Input, Select, Skeleton, StatusPill, Tabs, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { useSplitQueue } from '../../composables/splitQueue';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { overdue, waitingText } from '../../lib/sla';
import { usePermissions } from '../../lib/permissions';
import { motionOff } from '../../lib/qa';
import { routeOr } from '../../lib/routes';
import type { BulkResult, Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import CasePreview from './Partials/CasePreview.vue';
import DecisionComposer from './Partials/DecisionComposer.vue';
import PriorityCell from './Partials/PriorityCell.vue';
import {
    appealTones,
    caseHref,
    outcomeTones,
    priorityTooltip,
    reasonText,
    statusTones,
    targetText,
    type CaseRow,
    type ComposerOptions,
    type DecidedCase,
    type DecisionActionKey,
    type SelectedCase,
    type TakenCase,
    type TargetType,
} from './shared';

/**
 * ADM-20 moderation queue (06 §3 Moderation, m3.4-contract §2): Neu · In Prüfung · Entschieden · Einsprüche. Priority with its parts in the
 * tooltip, target by type and label (never message content), reason, reporters, first/last report, assignee, status, the [AI] slot
 * (only with ai.moderation_triage, label "KI-Vorschlag", a person decides). "Übernehmen" per row and bulk "Keine Maßnahme" for spam waves
 * (more than 100 in 24 h → four-eyes), with the per-record result panel.
 *
 * M4.17 SplitQueue (09 §10.2, composables/splitQueue.ts): from 1280 px a case opens in the right pane (`?case=`) with the target as
 * members see it, its reports and the decision. One-key decisions open the ADM-21 composer with every DSA step (statement of reasons,
 * password, four-eyes for a suspension): a = Inhalt entfernen, r = Keine Maßnahme; j/k move, u undoes "Übernehmen" for 5 s. A
 * decision itself has no undo: it reaches the member and the reporters at once and is corrected only by an appeal. After a decision
 * the next open case opens (auto-advance). Below 1280 a row opens ADM-21.
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
    selected?: SelectedCase | null;
    decided?: DecidedCase | null;
    taken?: TakenCase | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const appeals = computed(() => props.tab === 'appeals');
const open = computed(() => props.tab === 'new' || props.tab === 'in_review');
const desktop = useMediaQuery('(min-width: 1280px)');

// ---- SplitQueue -------------------------------------------------------------------------------------------------------------
const reportsUrl = (): string => routeOr('admin.moderation.reports', '/admin/moderation/reports');
const sel = computed(() => props.selected ?? null);
const selCase = computed(() => sel.value?.case ?? null);
const caseOpen = computed(() => selCase.value !== null && (selCase.value.status === 'new' || selCase.value.status === 'in_review'));
const mayDecide = computed(() => caseOpen.value && can('moderation.decide') && (!sel.value?.messageCase || can('moderation.messages')));
const composerOpen = ref(false);
const composerAction = ref<ComposerOptions['actions'][number] | null>(null);
let afterDecision: (() => void) | null = null;
const takenUndo = computed(() => (props.taken ? { id: props.taken.id, outcome: 'taken', reference: props.taken.reference } : null));

const queue = useSplitQueue<Row, { id: string; outcome: string; reference: string }>({
    param: 'case',
    url: reportsUrl,
    rows: () => (appeals.value ? [] : props.rows.data),
    selected: () => (props.selected ? { id: props.selected.case.id } : props.selected),
    decided: () => takenUndo.value,
    undoable: ['taken'],
    advance: () => open.value,
    enabled: computed(() => desktop.value && !appeals.value),
    only: ['selected', 'decided', 'taken'],
    onApprove: () => decide('remove_content'),
    onReject: () => decide('no_action'),
    onUndo: () => releaseTake(),
});
const { selectedId, paneOpen, lastDecided } = queue;
const split = computed(() => queue.split.value && !appeals.value);

/** `a` / `r` open the composer with their action; the "Maßnahme ergreifen" button opens it without one (DQ-1199). */
function decide(action: ComposerOptions['actions'][number] | null): void {
    if (!sel.value || !mayDecide.value || composerOpen.value) return;
    composerAction.value = action;
    // The next case is taken from the list as it is now; after the decision the decided case has left it.
    afterDecision = queue.advanceFrom(sel.value.case.id);
    composerOpen.value = true;
}
function onDecided(): void {
    afterDecision?.();
    afterDecision = null;
}
// QA cells ADM-20-pane-decide / -no-action (non-production): the composer over the pane, as `a` / `r` open it.
if (qaDialog() === 'decide' || qaDialog() === 'no-action') {
    const stop = watch(
        mayDecide,
        (allowed) => {
            if (!allowed) return;
            decide(qaDialog() === 'decide' ? null : 'no_action');
            queueMicrotask(() => stop());
        },
        { immediate: true },
    );
}
const paneTaking = ref(false);
function takeSelected(): void {
    if (!selCase.value) return;
    router.post(
        routeOr('admin.moderation.cases.assign', `/admin/moderation/cases/${selCase.value.id}/assign`, { case: selCase.value.id }),
        {},
        { preserveScroll: true, preserveState: true, onStart: () => (paneTaking.value = true), onFinish: () => (paneTaking.value = false) },
    );
}
const releasing = ref(false);
function releaseTake(): void {
    const taken = lastDecided.value;
    if (!taken || releasing.value) return;
    router.post(
        routeOr('admin.moderation.cases.release', `/admin/moderation/cases/${taken.id}/release`, { case: taken.id }),
        {},
        { preserveScroll: true, preserveState: true, onStart: () => (releasing.value = true), onFinish: () => (releasing.value = false), onSuccess: () => queue.clearUndo() },
    );
}
const paneState = computed(() => (state.value === 'loading' ? 'loading' : state.value === 'error' ? 'error' : 'ready'));

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
    // DQ-1193: the SLA timer of the open tabs (as ADM-53/55), sorted by the first report; it takes the first report's place there.
    ...(open.value ? [{ key: 'waiting', label: trans('moderation.reports.columns.waiting'), sort: 'created_at', numeric: true, min: 80 } satisfies TableColumn] : []),
    // DQ-703: on Entschieden the decision column (outcome and date) takes the place of the first report and of the status, which reads
    // "Entschieden" on every row there; both stay under Spalten. Otherwise the German table ran past 1440 px.
    { key: 'first_report_at', label: trans('moderation.reports.columns.first_report'), sort: 'created_at', min: 96, defaultHidden: !wide || props.tab === 'decided' || open.value },
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
// Beside the pane the list keeps the priority, the target and the SLA timer (DQ-1193); the full list has its own columns.
const narrowColumns = computed<TableColumn[]>(() => caseColumns.value.filter((column) => ['priority', 'target', 'waiting'].includes(column.key)));
const columns = computed(() => (appeals.value ? appealColumns.value : split.value ? narrowColumns.value : caseColumns.value));
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
const typeOptions = computed(() => [any.value, ...(['member', 'vehicle', 'photo', 'message', 'build_update', 'modification', 'comment', 'event', 'business', 'forum_post', 'crew'] as const).map((v) => ({ value: v, label: trans(`moderation.target_types.${v}`) }))]);
const reasonOptions = computed(() => [any.value, ...(['illegal', 'harassment', 'nudity', 'impersonation', 'spam', 'other'] as const).map((v) => ({ value: v, label: trans(`moderation.reasons.${v}`) }))]);
const assignedOptions = computed(() => [any.value, ...(['me', 'none', 'others'] as const).map((v) => ({ value: v, label: trans(`moderation.reports.filters.assigned_${v}`) }))]);
const sourceOptions = computed(() => [any.value, ...(['automated', 'web_form', 'staff'] as const).map((v) => ({ value: v, label: trans(`moderation.reports.filters.source_${v}`) }))]);
const appealStatusOptions = computed(() => [any.value, ...(['open', 'upheld', 'reversed'] as const).map((v) => ({ value: v, label: trans(`moderation.appeal_status.${v}`) }))]);
const roleOptions = computed(() => [any.value, ...(['affected', 'reporter'] as const).map((v) => ({ value: v, label: trans(`moderation.roles.${v}`) }))]);
/** Compact filters apply on change, after the select's model has taken the value. */
function applySoon(apply: (filter: Record<string, string>) => void): void {
    void nextTick(() => apply(filterPayload()));
}
function filterPayload(): Record<string, string> {
    const keys: FilterKey[] = appeals.value ? ['status', 'role'] : ['q', 'target_type', 'reason', 'assigned', 'source'];
    return Object.fromEntries(keys.map((k) => [k, filters[k]]));
}

// ---- rows -------------------------------------------------------------------------------------------------------------------
const asCase = (row: Row): CaseRow => row as CaseRow;
const asAppeal = (row: Row): AppealRow => row as AppealRow;
const rowHref = (row: Row): string | null => (appeals.value ? (asAppeal(row).case ? caseHref(asAppeal(row).case!.id) : null) : desktop.value ? queue.paneHref(row.id) : caseHref(row.id));

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
function confirmBulk(): void {
    router.post(routeOr('admin.moderation.reports.bulk', '/admin/moderation/reports/bulk'), { action: 'no_action', ids: bulkIds.value } as never, {
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
            <p v-if="desktop && !appeals && !paneOpen && state === 'ready' && rows.data.length > 0 && can('moderation.decide')" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-20.none">
                <PhFlag :size="16" class="shrink-0" aria-hidden="true" />{{ trans('moderation.pane.select_body') }}
            </p>
        </div>

        <div class="flex flex-col gap-24 desktop:flex-row desktop:items-start">
            <div class="min-w-0" :class="split ? 'desktop:w-400 desktop:shrink-0 wide:w-480' : 'grow'">
                <DataTable
                    :id="`moderation-${tab}`"
                    :key="`${tab}-${split ? 'split' : 'full'}`"
                    :narrow="split"
                    row-keys
                    :columns="columns"
                    :rows="rows"
                    :query="query"
                    :views="views"
                    :presets="presets"
                    :only="['rows', 'query', 'views', 'counts', 'bulkResult']"
                    :caption="trans('moderation.reports.caption')"
                    :empty-title="trans(`moderation.reports.empty.${emptyKey}_title`)"
                    :empty-body="trans(`moderation.reports.empty.${emptyKey}_body`)"
                    :selectable="!split && bulkActions.length > 0 && can('moderation.decide')"
                    :bulk-actions="bulkActions"
                    :row-href="rowHref"
                    :current-row-id="split ? selectedId : null"
                    :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
                    test-id="ADM-20.table"
                    @bulk="onBulk"
                >
                    <template #filters="{ apply, loading }">
                        <!-- DQ-1200: beside the pane (400–480 px) the filters are the search and one row of compact selects that apply on change,
                             so the queue starts high in the column; the full list keeps the labelled fields and Anwenden. -->
                        <form
                            v-if="split"
                            class="flex w-full flex-col gap-8"
                            :aria-label="trans('moderation.reports.filters.label')"
                            data-testid="ADM-20.filters-compact"
                            @submit.prevent="apply(filterPayload())"
                        >
                            <div class="flex items-center gap-8">
                                <Input v-model="filters.q" size="sm" type="search" maxlength="120" class="grow" :aria-label="trans('moderation.reports.filters.q')" :placeholder="trans('moderation.reports.filters.q_placeholder')" data-testid="ADM-20.filter.q" />
                                <Button type="submit" size="sm" variant="secondary" :icon="PhMagnifyingGlass" :loading="loading" class="shrink-0" data-testid="ADM-20.filter.apply">{{ trans('moderation.reports.filters.apply') }}</Button>
                            </div>
                            <div class="grid grid-cols-2 gap-8 wide:grid-cols-4">
                                <Select v-model="typeModel" :options="typeOptions" size="sm" :aria-label="trans('moderation.reports.filters.target_type')" :placeholder="`${trans('moderation.reports.filters.target_type')}: ${trans('moderation.reports.filters.any')}`" data-testid="ADM-20.filter.type" @update:model-value="applySoon(apply)" />
                                <Select v-model="reasonModel" :options="reasonOptions" size="sm" :aria-label="trans('moderation.reports.filters.reason')" :placeholder="`${trans('moderation.reports.filters.reason')}: ${trans('moderation.reports.filters.any')}`" data-testid="ADM-20.filter.reason" @update:model-value="applySoon(apply)" />
                                <Select v-model="assignedModel" :options="assignedOptions" size="sm" :aria-label="trans('moderation.reports.filters.assigned')" :placeholder="`${trans('moderation.reports.filters.assigned')}: ${trans('moderation.reports.filters.any')}`" data-testid="ADM-20.filter.assigned" @update:model-value="applySoon(apply)" />
                                <Select v-model="sourceModel" :options="sourceOptions" size="sm" :aria-label="trans('moderation.reports.filters.source')" :placeholder="`${trans('moderation.reports.filters.source')}: ${trans('moderation.reports.filters.any')}`" data-testid="ADM-20.filter.source" @update:model-value="applySoon(apply)" />
                            </div>
                        </form>
                        <!-- Without the pane the filters stay in one row from 1280 px. -->
                        <form v-else class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('moderation.reports.filters.label')" @submit.prevent="apply(filterPayload())">
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
                            <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-20.filter.apply">{{ trans('moderation.reports.filters.apply') }}</Button>
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
                            :caption="[trans(`moderation.target_types.${asCase(row).target_type}`), asCase(row).reference, split ? reasonText(asCase(row).reason) : null, asCase(row).automated ? trans('moderation.sources.automated') : null, asCase(row).web_form ? trans('moderation.sources.web_form') : null, asCase(row).origin === 'staff' ? trans('moderation.origin_staff') : null].filter(Boolean).join(' · ')"
                            :href="rowHref(row)"
                            :current="row.id === selectedId"
                            test-id="ADM-20.open"
                        >
                            <!-- 09 §10.2 row hover preview: what the 40 px row cannot show. Not beside the pane, which shows the case itself. -->
                            <template v-if="!split" #preview>
                                <div class="flex flex-col gap-8" data-testid="ADM-20.hover">
                                    <p class="text-admin-base-strong text-ink">{{ targetText(asCase(row).target_type, asCase(row).target_label) }}</p>
                                    <p class="text-admin-base text-ink-2">{{ reasonText(asCase(row).reason, asCase(row).sub_reason) }}</p>
                                    <dl class="grid grid-cols-2 gap-x-12 gap-y-4 text-caption tabular-nums">
                                        <dt class="text-ink-3">{{ trans('moderation.reports.columns.reporters') }}</dt>
                                        <dd class="text-right text-ink">{{ formatNumber(asCase(row).reporters) }}</dd>
                                        <dt class="text-ink-3">{{ trans('moderation.reports.columns.first_report') }}</dt>
                                        <dd class="text-right text-ink">{{ formatDateTime(asCase(row).first_report_at) }}</dd>
                                        <dt class="text-ink-3">{{ trans('moderation.reports.columns.priority') }}</dt>
                                        <dd class="text-right text-ink">{{ formatNumber(asCase(row).priority.total) }}</dd>
                                    </dl>
                                    <p class="text-caption text-ink-3">{{ priorityTooltip(asCase(row).priority) }}</p>
                                </div>
                            </template>
                        </NameCell>
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
                    <template #cell-waiting="{ row }">
                        <span
                            v-if="asCase(row).waiting_minutes !== null && asCase(row).waiting_minutes !== undefined"
                            class="block whitespace-nowrap text-right tabular-nums"
                            :class="overdue(asCase(row).waiting_minutes) ? 'text-warning' : 'text-ink'"
                            :title="trans('ui.waiting.label', { date: formatDateTime(asCase(row).first_report_at) })"
                            :data-overdue="overdue(asCase(row).waiting_minutes) || undefined"
                            data-testid="ADM-20.waiting"
                        >
                            {{ waitingText(asCase(row).waiting_minutes) }}
                        </span>
                        <span v-else class="block text-right text-ink-3">–</span>
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
            </div>

            <!-- The SplitQueue pane (09 §10.2): beside the list from 1280 px, under it below (200 % zoom). -->
            <section
                v-if="paneOpen && !appeals"
                class="flex min-w-0 grow flex-col gap-20 rounded-sm border border-line-subtle bg-surface px-20 py-20"
                :aria-label="trans('moderation.pane.label')"
                :aria-busy="paneState === 'loading' || undefined"
                data-testid="ADM-20.pane"
            >
                <div v-if="paneState === 'loading'" class="flex flex-col gap-16" aria-hidden="true" data-testid="ADM-20.pane.loading">
                    <Skeleton shape="text" class="h-24 w-320" />
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="aspect-4/3 w-240" />
                    <Skeleton shape="text" class="w-full" />
                    <Skeleton shape="text" class="w-3/4" />
                </div>
                <StateBlock v-else-if="paneState === 'error'" kind="error" :title="trans('moderation.case.error')" :body="trans('ui.state.error_body')" test-id="ADM-20.pane.error" @retry="router.reload({ only: ['selected'] })" />
                <StateBlock v-else-if="sel === null || selCase === null" kind="partial" :title="trans('moderation.pane.gone')" :retryable="false" test-id="ADM-20.pane.gone">
                    <div class="mt-8"><Button size="sm" variant="secondary" :icon="PhX" @click="queue.select(null)">{{ trans('ui.actions.close') }}</Button></div>
                </StateBlock>
                <template v-else>
                    <header class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="text-headline text-ink" data-testid="ADM-20.pane.title">{{ targetText(selCase.target_type, selCase.target_label) }}</h2>
                            <p class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums">
                                <StatusPill :tone="statusTones[selCase.status]" :label="trans(`moderation.status.${selCase.status}`)" data-testid="ADM-20.pane.status" />
                                <span class="sc-key">{{ trans('moderation.case.title', { reference: selCase.reference }) }}</span>
                                <span :title="priorityTooltip(selCase.priority)">{{ trans('moderation.priority.label', { total: formatNumber(selCase.priority.total) }) }}</span>
                                <span>{{ selCase.assigned ? trans('moderation.case.meta.assigned', { name: selCase.assigned.me ? trans('moderation.reports.you') : selCase.assigned.name }) : trans('moderation.case.meta.unassigned') }}</span>
                                <Badge v-if="selCase.automated_detection" tone="neutral">{{ trans('moderation.sources.automated') }}</Badge>
                                <Badge v-if="sel.ai" tone="info" tnum :title="sel.ai.summary ?? trans('moderation.case.ai_note')">{{ trans('moderation.case.ai', { score: formatNumber(Math.round(sel.ai.score * 100)) }) }}</Badge>
                            </p>
                        </div>
                        <Link :href="caseHref(selCase.id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']" data-testid="ADM-20.pane.open">
                            {{ trans('moderation.pane.open') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                        </Link>
                    </header>

                    <div v-if="mayDecide" class="flex flex-wrap items-center gap-8 border-y border-line-subtle py-12" data-testid="ADM-20.actions">
                        <Button size="sm" variant="primary" :icon="PhGavel" aria-keyshortcuts="a" data-testid="ADM-20.decide" @click="decide(null)">{{ trans('moderation.pane.decide') }}</Button>
                        <Button size="sm" variant="secondary" :icon="PhCheckCircle" aria-keyshortcuts="r" data-testid="ADM-20.no-action" @click="decide('no_action')">{{ trans('moderation.pane.no_action') }}</Button>
                        <Button v-if="!selCase.assigned?.me" size="sm" variant="ghost" :icon="PhHandPointing" :loading="paneTaking" data-testid="ADM-20.pane.take" @click="takeSelected()">{{ trans('moderation.reports.take') }}</Button>
                        <p class="ml-auto text-caption text-ink-3">{{ trans('moderation.pane.keys') }}</p>
                    </div>
                    <p v-else-if="caseOpen" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-20.pane.view-only">
                        <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('moderation.pane.view_only') }}
                    </p>
                    <p v-else-if="sel.decision" class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-20.pane.decision">
                        <StatusPill :tone="outcomeTones[sel.decision.action]" :label="trans(`moderation.outcomes.${sel.decision.action}`)" />
                        <span>{{ sel.decision.decided_by ? trans('moderation.case.decision.by', { name: sel.decision.decided_by.name, date: formatDateTime(sel.decision.decided_at) }) : trans('moderation.case.decision.by_system', { date: formatDateTime(sel.decision.decided_at) }) }}</span>
                    </p>

                    <section class="flex flex-col gap-12">
                        <h3 class="text-admin-base-strong text-ink">{{ trans('moderation.case.preview.title') }}</h3>
                        <CasePreview :key="selCase.id" :preview="sel.preview" :message-case="sel.messageCase" :case-id="selCase.id" test-id="ADM-20.pane" />
                    </section>

                    <section class="flex flex-col gap-8" data-testid="ADM-20.pane.reports">
                        <h3 class="text-admin-base-strong text-ink">{{ trans('moderation.case.reports.title') }}</h3>
                        <ul class="flex flex-col">
                            <li v-for="r in sel.reports" :key="r.id" class="flex flex-col gap-4 border-t border-line-subtle py-8 first:border-t-0 first:pt-0">
                                <p class="flex flex-wrap items-center gap-8 text-admin-base">
                                    <span class="text-ink">{{ reasonText(r.reason, r.sub_reason) }}</span>
                                    <Badge tone="neutral">{{ trans(`moderation.sources.${r.source}`) }}</Badge>
                                    <span class="text-caption text-ink-3 tabular-nums">{{ formatDateTime(r.created_at) }}</span>
                                </p>
                                <p v-if="r.details" class="line-clamp-3 max-w-720 whitespace-pre-line text-admin-base text-ink-2">{{ r.details }}</p>
                                <p v-else-if="r.details_withheld" class="text-caption text-ink-3">{{ trans('moderation.case.reports.details_withheld') }}</p>
                            </li>
                        </ul>
                        <p v-if="sel.reports.length === 0" class="text-admin-base text-ink-3">{{ trans('moderation.case.reports.none') }}</p>
                    </section>
                </template>
            </section>
        </div>

        <!-- 5-s undo of "Übernehmen" (09 §10.2). A decision has none: it reaches the member and the reporters at once. -->
        <div
            v-if="lastDecided"
            class="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-12 rounded-sm border border-line bg-raised px-16 py-8 shadow-e2"
            :class="motionOff() ? '' : 'transition-opacity duration-effect-default ease-effect-default'"
            role="status"
            data-testid="ADM-20.undo"
        >
            <span class="text-admin-base text-ink">{{ trans('moderation.pane.undo_taken', { reference: lastDecided.reference }) }}</span>
            <Button size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :loading="releasing" aria-keyshortcuts="u" data-testid="ADM-20.undo.button" @click="releaseTake()">
                {{ trans('moderation.pane.undo') }}
            </Button>
        </div>

        <!-- Stays mounted while it is open: the decision closes the case (mayDecide turns false) before the composer reports it. -->
        <DecisionComposer
            v-if="sel && selCase && (mayDecide || composerOpen)"
            :key="selCase.id"
            v-model:open="composerOpen"
            :case-id="selCase.id"
            :composer="sel.composer"
            :templates="sel.templates"
            :initial-action="composerAction"
            test-id="ADM-20.composer"
            @decided="onDecided"
        />

        <ConfirmDialog
            v-model:open="confirmOpen"
            :title="trans('moderation.reports.bulk.title', { count: formatNumber(bulkIds.length) })"
            :body="trans('moderation.reports.bulk.body')"
            :confirm-label="trans('moderation.reports.bulk.no_action')"
            tone="neutral"
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
