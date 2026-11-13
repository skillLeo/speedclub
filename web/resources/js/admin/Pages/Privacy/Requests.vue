<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhFunnel, PhPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, EmptyQueue, Field, Input, Select, Skeleton, StatusPill } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import CreateDrawer from './Partials/CreateDrawer.vue';
import { dueInfo, memberHref, requestHref, requesterText, statusTones, typeLabel, type RequestRow, type RequestType } from './shared';

/**
 * ADM-45 GDPR requests (06 §3 Audit & privacy, m3.6 §1, Art. 12 GDPR): type and article, requester (member or external, address masked),
 * received, due (≤ 7 days in amber, overdue in red, the extension marked), status, assignee; presets for open, due soon, overdue and mine.
 * Below, members' own SET-12 exports and SET-13 deletions as completed, read-only rows. The create drawer for privacy.process.
 */
interface SelfRow {
    kind: 'export' | 'erasure';
    member: { id: string; username: string | null } | null;
    requested_at: string;
    status: 'completed';
}
const props = defineProps<{
    rows: Paginated<RequestRow>;
    query: TableQuery;
    views: SavedView[];
    counts?: { open: number; due_soon: number; overdue: number };
    dueSoonDays: number;
    selfService?: SelfRow[];
    assignees: { id: number; name: string }[];
}>();

const { can } = usePermissions();
const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const zero = computed(() => pageState.value === 'empty');

const columns = computed<TableColumn[]>(() => [
    // DQ-616: all six columns fit the 968 px column at 1280; names may wrap, the extension sits on its own line, dates and pills size to content.
    { key: 'request', label: trans('privacy.requests.columns.request'), grow: true, min: 200, hideable: false },
    { key: 'requester', label: trans('privacy.requests.columns.requester') },
    { key: 'received_at', label: trans('privacy.requests.columns.received'), sort: 'received_at' },
    { key: 'due_at', label: trans('privacy.requests.columns.due'), sort: 'due_at' },
    { key: 'status', label: trans('privacy.requests.columns.status') },
    { key: 'assigned', label: trans('privacy.requests.columns.assigned'), min: 120 },
]);
const presets: PresetView[] = [
    { key: 'open', name: 'privacy.requests.presets.open', query: { filter: { status: 'open' } } },
    { key: 'due_soon', name: 'privacy.requests.presets.due_soon', query: { filter: { due: 'soon' } } },
    { key: 'overdue', name: 'privacy.requests.presets.overdue', query: { filter: { due: 'overdue' } } },
    { key: 'mine', name: 'privacy.requests.presets.mine', query: { filter: { assigned: 'me', status: 'open' } } },
];

// ---- filters ----------------------------------------------------------------------------------------------------------------
const FILTER_KEYS = ['q', 'status', 'type', 'due', 'assigned'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const filters = reactive<Record<FilterKey, string>>({ q: '', status: '', type: '', due: '', assigned: '' });
watch(
    () => props.query.filter,
    (filter) => FILTER_KEYS.forEach((key) => (filters[key] = filter[key] ?? '')),
    { immediate: true },
);
const ANY = '*';
function selectModel(key: FilterKey) {
    return computed({ get: () => (filters[key] === '' ? undefined : filters[key]), set: (v: string | undefined) => (filters[key] = v === undefined || v === ANY ? '' : v) });
}
const statusModel = selectModel('status');
const typeModel = selectModel('type');
const dueModel = selectModel('due');
const assignedModel = selectModel('assigned');
const any = computed(() => ({ value: ANY, label: trans('privacy.requests.filters.any') }));
const TYPES: RequestType[] = ['access', 'export', 'erasure', 'rectification', 'objection', 'restriction'];
const statusOptions = computed(() => [any.value, { value: 'open', label: trans('privacy.requests.filters.open') }, ...(['open', 'in_progress', 'waiting', 'completed', 'rejected'] as const).slice(1).map((v) => ({ value: v, label: trans(`privacy.status.${v}`) }))]);
const typeOptions = computed(() => [any.value, ...TYPES.map((v) => ({ value: v, label: typeLabel(v) }))]);
const dueOptions = computed(() => [any.value, { value: 'soon', label: trans('privacy.requests.filters.due_soon') }, { value: 'overdue', label: trans('privacy.requests.filters.overdue') }]);
const assignedOptions = computed(() => [any.value, { value: 'me', label: trans('privacy.requests.filters.me') }, { value: 'none', label: trans('privacy.requests.filters.none') }]);

function dueTone(row: RequestRow, plain: string): string {
    const tone = dueInfo(row).tone;
    return tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : plain;
}

const createOpen = ref(qaDialog() === 'create');
const selfRows = computed(() => (zero.value ? [] : (props.selfService ?? [])));
const count = (n: number | undefined) => formatNumber(zero.value ? 0 : (n ?? 0));
</script>

<template>
    <Head :title="trans('privacy.requests.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-45" :data-qa-state="pageState">
        <PageHeader :title="trans('privacy.requests.title')" :crumbs="[{ label: trans('shell.groups.audit_privacy') }]" :description="trans('privacy.requests.intro')">
            <template v-if="counts" #meta>
                <p class="flex flex-wrap gap-x-16 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-45.counts">
                    <span>{{ trans('privacy.requests.counts.open', { count: count(counts.open) }) }}</span>
                    <span :class="!zero && counts.due_soon > 0 ? 'text-warning' : ''">{{ trans('privacy.requests.counts.due_soon', { days: formatNumber(dueSoonDays), count: count(counts.due_soon) }) }}</span>
                    <span :class="!zero && counts.overdue > 0 ? 'text-danger' : ''">{{ trans('privacy.requests.counts.overdue', { count: count(counts.overdue) }) }}</span>
                </p>
            </template>
            <template v-if="can('privacy.process')" #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-45.create" @click="createOpen = true">{{ trans('privacy.requests.create') }}</Button>
            </template>
        </PageHeader>

        <DataTable
            id="privacy-requests"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'counts']"
            :caption="trans('privacy.requests.caption')"
            :empty-title="trans('privacy.requests.empty_title')"
            :empty-body="trans('privacy.requests.empty_body')"
            :row-href="(row: RequestRow) => requestHref(row.id)"
            :force-state="pageState === 'loading' || pageState === 'error' || pageState === 'empty' ? pageState : undefined"
            test-id="ADM-45.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('privacy.requests.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0"><Field :label="trans('privacy.requests.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('privacy.requests.filters.q_placeholder')" data-testid="ADM-45.filter.q" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('privacy.requests.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('privacy.requests.filters.any')" data-testid="ADM-45.filter.status" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('privacy.requests.filters.type')"><Select v-model="typeModel" :options="typeOptions" size="sm" :placeholder="trans('privacy.requests.filters.any')" /></Field></div>
                    <div class="min-w-120 grow basis-0"><Field :label="trans('privacy.requests.filters.due')"><Select v-model="dueModel" :options="dueOptions" size="sm" :placeholder="trans('privacy.requests.filters.any')" data-testid="ADM-45.filter.due" /></Field></div>
                    <div class="min-w-120 grow basis-0"><Field :label="trans('privacy.requests.filters.assigned')"><Select v-model="assignedModel" :options="assignedOptions" size="sm" :placeholder="trans('privacy.requests.filters.any')" /></Field></div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-45.filter.apply">{{ trans('privacy.requests.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-request="{ row }">
                <NameCell :name="typeLabel(row.type)" :caption="`${row.reference} · ${trans('privacy.article', { article: String(row.article) })}`" :href="requestHref(row.id)" test-id="ADM-45.open" />
            </template>
            <template #cell-requester="{ row }">
                <span class="flex flex-col">
                    <span :class="row.requester.kind === 'member' ? 'sc-key whitespace-nowrap text-ink' : 'text-ink'">{{ requesterText(row.requester) }}</span>
                    <span v-if="row.requester.kind === 'external' && row.requester.email" class="sc-key whitespace-nowrap text-caption text-ink-3">{{ row.requester.email }}</span>
                </span>
            </template>
            <template #cell-received_at="{ row }"><time :datetime="row.received_at" :title="formatDateTime(row.received_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.received_at) }}</time></template>
            <template #cell-due_at="{ row }">
                <span class="flex flex-col" :data-testid="`ADM-45.due.${row.reference}`">
                    <time :datetime="row.due_at" class="whitespace-nowrap tabular-nums" :class="dueTone(row, 'text-ink-2')">{{ formatDate(row.due_at) }}</time>
                    <span class="whitespace-nowrap text-caption tabular-nums" :class="dueTone(row, 'text-ink-3')">{{ dueInfo(row).text }}</span>
                    <span v-if="row.extended && row.due.state !== 'done'" class="whitespace-nowrap text-caption text-ink-3">{{ trans('privacy.due.extended') }}</span>
                </span>
            </template>
            <template #cell-status="{ row }"><StatusPill :tone="statusTones[row.status as RequestRow['status']]" :label="trans(`privacy.status.${row.status}`)" /></template>
            <template #cell-assigned="{ row }"><span class="whitespace-nowrap text-ink-2">{{ row.assigned ? (row.assigned.me ? trans('privacy.requests.you') : row.assigned.name) : '–' }}</span></template>
        </DataTable>

        <section class="flex flex-col gap-12" data-testid="ADM-45.self-service" :aria-labelledby="'adm45-self'">
            <div class="flex flex-col gap-4">
                <h2 id="adm45-self" class="text-headline text-ink">{{ trans('privacy.requests.self_title') }}</h2>
                <p class="max-w-720 text-admin-base text-ink-2">{{ trans('privacy.requests.self_body') }}</p>
            </div>
            <div v-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-hidden="true">
                <div v-for="n in 3" :key="n" class="flex h-40 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0"><Skeleton shape="text" class="w-120" /><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-120" /></div>
            </div>
            <EmptyQueue v-else-if="selfRows.length === 0 || pageState === 'error'" variant="quiet" compact :title="trans('privacy.requests.self_empty')" />
            <ScrollRegion v-else :label="trans('privacy.requests.self_caption')">
                <table class="w-full border-collapse text-admin-base">
                    <caption class="sr-only">{{ trans('privacy.requests.self_caption') }}</caption>
                    <thead class="bg-surface text-left text-admin-base-strong text-ink-2">
                        <tr class="h-40 border-b border-line">
                            <th scope="col" class="px-12">{{ trans('privacy.requests.self_columns.kind') }}</th>
                            <th scope="col" class="px-12">{{ trans('privacy.requests.self_columns.member') }}</th>
                            <th scope="col" class="px-12">{{ trans('privacy.requests.self_columns.at') }}</th>
                            <th scope="col" class="px-12">{{ trans('privacy.requests.self_columns.status') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(row, index) in selfRows" :key="index" class="h-40 border-b border-line-subtle last:border-b-0">
                            <td class="whitespace-nowrap px-12 text-ink">{{ trans(`privacy.requests.self_kind.${row.kind}`) }}</td>
                            <td class="whitespace-nowrap px-12">
                                <Link v-if="row.member && row.member.username" :href="memberHref(row.member.id)" :class="[focusRing, 'sc-key inline-flex h-32 items-center rounded-xs text-ink hover:underline']">{{ `@${row.member.username}` }}</Link>
                                <span v-else class="text-ink-3">{{ trans('privacy.requests.deleted_member') }}</span>
                            </td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(row.requested_at) }}</td>
                            <td class="px-12"><StatusPill tone="success" :label="trans('privacy.requests.self_done')" /></td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <CreateDrawer v-model:open="createOpen" :failed="failedDialog" :sample="qaDialog() === 'create'" />
    </div>
</template>
