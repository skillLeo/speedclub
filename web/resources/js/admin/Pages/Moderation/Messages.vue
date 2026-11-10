<script setup lang="ts">
import { qaDialogFailed } from '../../composables/pageState';
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhChatsCircle, PhGavel } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, EmptyQueue, StatusPill, Tabs, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { Paginated, SavedView, TableQuery } from '../../types/table';
import DecisionComposer from './Partials/DecisionComposer.vue';
import EvidencePanel from './Partials/EvidencePanel.vue';
import PriorityCell from './Partials/PriorityCell.vue';
import { caseHref, outcomeTones, reasonText, statusTones, type CaseRow, type CaseSummary, type ComposerOptions, type DecisionDetail, type ReportItem, type SorTemplate } from './shared';

/**
 * ADM-22 messaging safety (06 §3 Moderation, m3.4-contract §1/§2; moderation.messages): reported message cases only. The list names the
 * participants by username and the report reasons; the reported message and its stored context load only when a case is opened (one
 * audited request), and up to ±10 live messages only on a further request. Decide as on ADM-21 (moderation.decide).
 */
const props = defineProps<{
    rows: Paginated<CaseRow>;
    query: TableQuery;
    views: SavedView[];
    tab: 'open' | 'decided';
    counts?: { open: number; decided: number };
    selected: { case: CaseSummary; reports: ReportItem[]; decision: DecisionDetail | null; composer: ComposerOptions } | null;
    templates: SorTemplate[];
}>();

const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const url = routeOr('admin.moderation.messages', '/admin/moderation/messages');

const tabs = computed<TabItem[]>(() => (['open', 'decided'] as const).map((value) => ({ value, label: trans(`moderation.messages.tabs.${value}`), count: pageState.value === 'empty' ? 0 : (props.counts?.[value] ?? null) })));
const tabModel = computed({ get: () => props.tab, set: (tab: string) => router.get(url, tab === 'open' ? {} : { tab }, { preserveState: false }) });
// DQ-598: with a case open the list is 560 wide; it keeps what tells cases apart in one column ("@a → @b", reason · date) and the priority.
const split = computed(() => props.selected !== null);
const columns = computed<TableColumn[]>(() =>
    split.value
        ? [
              { key: 'priority', label: trans('moderation.messages.columns.priority'), sort: 'priority', numeric: true, min: 80, hideable: false },
              { key: 'target', label: trans('moderation.messages.columns.case'), grow: true, hideable: false },
          ]
        : [
              { key: 'priority', label: trans('moderation.messages.columns.priority'), sort: 'priority', numeric: true, min: 80, hideable: false },
              { key: 'target', label: trans('moderation.messages.columns.participants'), grow: true, hideable: false },
              { key: 'reason', label: trans('moderation.messages.columns.reason'), min: 120 },
              { key: 'first_report_at', label: trans('moderation.messages.columns.reported'), sort: 'created_at', min: 96 },
              { key: 'status', label: trans('moderation.messages.columns.status'), defaultHidden: props.tab === 'open' },
          ],
);
const participants = (row: CaseRow): string => {
    const reported = row.target_label?.replace(/^@/, '') ?? '';
    if (reported === '') return trans('moderation.unnamed');
    return row.reporter ? trans('moderation.messages.between', { reported, reporter: row.reporter }) : (row.target_label ?? reported);
};
const compactCaption = (row: CaseRow): string => [reasonText(row.reason, row.sub_reason), formatDate(row.first_report_at)].filter(Boolean).join(' · ');
const selectHref = (row: CaseRow): string => `${url}?${new URLSearchParams({ ...(props.tab === 'decided' ? { tab: 'decided' } : {}), case: row.id }).toString()}`;

const sel = computed(() => props.selected);
const reporter = computed(() => sel.value?.reports.find((r) => r.reporter !== null)?.reporter?.username ?? null);
const isOpen = computed(() => sel.value !== null && (sel.value.case.status === 'new' || sel.value.case.status === 'in_review'));
const canDecide = computed(() => isOpen.value && can('moderation.decide'));
const composerOpen = ref(qaDialog() === 'decide');
</script>

<template>
    <Head :title="trans('moderation.messages.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-22" :data-qa-state="pageState">
        <PageHeader :title="trans('moderation.messages.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('moderation.messages.intro')" />
        <Tabs v-model="tabModel" :items="tabs" :label="trans('moderation.messages.tabs.label')" :panels="false" />

        <div class="flex flex-col gap-24 wide:flex-row wide:items-start">
            <div class="min-w-0 wide:w-560 wide:shrink-0">
                <DataTable
                    :id="`moderation-messages-${tab}`"
                    :key="split ? 'split' : 'full'"
                    :narrow="split"
                    :columns="columns"
                    :rows="rows"
                    :query="query"
                    :views="views"
                    :only="['rows', 'query', 'views', 'counts']"
                    :caption="trans('moderation.messages.caption')"
                    :empty-title="trans(`moderation.messages.empty_${tab}_title`)"
                    :empty-body="trans(`moderation.messages.empty_${tab}_body`)"
                    :row-href="selectHref"
                    :force-state="pageState === 'loading' || pageState === 'error' || pageState === 'empty' ? pageState : undefined"
                    test-id="ADM-22.table"
                >
                    <template #cell-priority="{ row }"><PriorityCell :priority="row.priority" /></template>
                    <template #cell-target="{ row }">
                        <NameCell v-if="split" :name="participants(row)" :caption="compactCaption(row)" :href="selectHref(row)" test-id="ADM-22.open" />
                        <NameCell v-else :name="participants(row)" :caption="row.reference" :href="selectHref(row)" test-id="ADM-22.open" />
                    </template>
                    <template #cell-reason="{ row }"><span class="whitespace-nowrap text-ink-2">{{ reasonText(row.reason, row.sub_reason) }}</span></template>
                    <template #cell-first_report_at="{ row }">
                        <time :datetime="row.first_report_at ?? undefined" :title="formatDateTime(row.first_report_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.first_report_at) }}</time>
                    </template>
                    <template #cell-status="{ row }"><StatusPill :tone="statusTones[row.status]" :label="trans(`moderation.status.${row.status}`)" /></template>
                </DataTable>
            </div>

            <section v-if="sel !== null || (pageState === 'ready' && rows.data.length > 0)" class="flex min-w-0 grow flex-col gap-20" :class="sel === null ? '' : 'rounded-md border border-line-subtle bg-surface px-20 py-20'" :aria-label="trans('moderation.messages.title')" data-testid="ADM-22.detail">
                <EmptyQueue v-if="sel === null || pageState !== 'ready'" variant="quiet" :icon="PhChatsCircle" :title="trans('moderation.messages.select')" :body="trans('moderation.messages.select_body')" data-testid="ADM-22.none" />
                <template v-else>
                    <header class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="sc-key text-title-s text-ink" data-testid="ADM-22.participants">
                                {{ trans('moderation.messages.participants', { reported: (sel.case.target_label ?? '').replace(/^@/, '') || '–', reporter: reporter ?? '–' }) }}
                            </h2>
                            <p class="flex flex-wrap items-center gap-8 text-supporting text-ink-2 tabular-nums">
                                <StatusPill :tone="statusTones[sel.case.status]" :label="trans(`moderation.status.${sel.case.status}`)" />
                                <span>{{ trans('moderation.case.title', { reference: sel.case.reference }) }}</span>
                                <span v-if="reporter">{{ trans('moderation.messages.reported_by', { reporter }) }}</span>
                                <Badge v-for="r in sel.reports" :key="r.id" tone="neutral">{{ reasonText(r.reason, r.sub_reason) }}</Badge>
                            </p>
                        </div>
                        <div class="flex flex-wrap items-center gap-8">
                            <Link :href="caseHref(sel.case.id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-label-s text-ink hover:underline']">{{ trans('moderation.messages.open_case') }}<PhArrowSquareOut :size="16" aria-hidden="true" /></Link>
                            <Button v-if="canDecide" size="sm" variant="primary" :icon="PhGavel" data-testid="ADM-22.decide" @click="composerOpen = true">{{ trans('moderation.case.actions.decide') }}</Button>
                        </div>
                    </header>

                    <ul class="flex flex-col" data-testid="ADM-22.reports">
                        <li v-for="r in sel.reports" :key="r.id" class="flex flex-col gap-4 border-t border-line-subtle py-8 first:border-t-0 first:pt-0">
                            <p class="text-caption text-ink-3 tabular-nums">{{ [reasonText(r.reason, r.sub_reason), formatDateTime(r.created_at), r.reporter ? `@${r.reporter.username}` : null].filter(Boolean).join(' · ') }}</p>
                            <p v-if="r.details" class="whitespace-pre-line text-supporting text-ink">{{ r.details }}</p>
                        </li>
                    </ul>

                    <EvidencePanel :key="sel.case.id" :case-id="sel.case.id" target-type="message" :allowed="can('moderation.messages')" autoload test-id="ADM-22.evidence" />

                    <div v-if="sel.decision" class="flex flex-wrap items-center gap-8 border-t border-line-subtle pt-16" data-testid="ADM-22.decision">
                        <StatusPill :tone="outcomeTones[sel.decision.action]" :label="trans(`moderation.outcomes.${sel.decision.action}`)" />
                        <span class="text-supporting text-ink-2 tabular-nums">{{ sel.decision.decided_by ? trans('moderation.case.decision.by', { name: sel.decision.decided_by.name, date: formatDateTime(sel.decision.decided_at) }) : trans('moderation.case.decision.by_system', { date: formatDateTime(sel.decision.decided_at) }) }}</span>
                    </div>
                </template>
            </section>
        </div>

        <DecisionComposer v-if="sel && (canDecide || qaDialog() === 'decide')" v-model:open="composerOpen" :case-id="sel.case.id" :composer="sel.composer" :templates="templates" :failed="failedDialog" test-id="ADM-22.composer" />
    </div>
</template>
