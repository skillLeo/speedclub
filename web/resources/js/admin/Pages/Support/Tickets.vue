<script setup lang="ts">
import { qaDialogFailed } from '../../composables/pageState';
import DialogError from '../../Components/patterns/DialogError.vue';
import { Head, router } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhFunnel, PhUserSwitch } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { BulkAction, TableColumn } from '../../Components/data-table/table';
import { useAdminAction } from '../../Components/decisions/action';
import { firstError } from '../../Components/decisions/statement';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Dialog, Drawer, Field, IconButton, Input, Select, StatusPill, Textarea } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { BulkResult, Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import { fromText, statusTones, ticketHref, type TicketAssigned, type TicketFrom, type TicketStatus } from './shared';

/**
 * ADM-25 support tickets (06 §3 Support, m3.4-contract §1/§2): subject, from (member or web contact; the address masked without
 * members.view_pii), category, status (offen · wartet · gelöst), assignee, last activity. Assignment drawer per row and bulk status
 * (more than 100 in 24 h → four-eyes) with the result panel.
 */
interface TicketRow {
    id: string;
    reference: string;
    subject: string;
    source: 'app' | 'web';
    from: TicketFrom;
    category: string;
    status: TicketStatus;
    assigned: TicketAssigned | null;
    messages: number;
    created_at: string | null;
    last_activity_at: string | null;
}
const props = defineProps<{
    rows: Paginated<TicketRow>;
    query: TableQuery;
    views: SavedView[];
    counts?: { open: number; pending: number; mine: number };
    staffOptions: { id: number; name: string }[];
    bulkResult?: { rows: BulkResult[]; labels: Record<string, string> } | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));

const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1440px)').matches;
const columns = computed<TableColumn[]>(() => [
    // DQ-563: the subject is the key column (min 260, two lines); below 1440 the category is its caption instead of a column.
    { key: 'subject', label: trans('support.tickets.columns.subject'), grow: true, min: 260, hideable: false },
    { key: 'from', label: trans('support.tickets.columns.from'), min: 150 },
    { key: 'category', label: trans('support.tickets.columns.category'), min: 96, defaultHidden: !wide },
    { key: 'status', label: trans('support.tickets.columns.status'), sort: 'status' },
    { key: 'assigned', label: trans('support.tickets.columns.assigned'), min: 120 },
    { key: 'last_activity_at', label: trans('support.tickets.columns.last_activity'), sort: 'last_activity_at', min: 96 },
    { key: 'messages', label: trans('support.tickets.columns.messages'), numeric: true, defaultHidden: true },
    { key: 'actions', label: trans('support.tickets.assign'), srOnlyLabel: true, width: 'xs', hideable: false },
]);
const presets: PresetView[] = [
    { key: 'active', name: 'support.tickets.presets.active', query: { filter: { status: 'active' } } },
    { key: 'mine', name: 'support.tickets.presets.mine', query: { filter: { assigned: 'me', status: 'active' } } },
    { key: 'unassigned', name: 'support.tickets.presets.unassigned', query: { filter: { assigned: 'none', status: 'active' } } },
];

// ---- filters --------------------------------------------------------------------------------------------------------------
const FILTER_KEYS = ['q', 'status', 'category', 'source', 'assigned'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const filters = reactive<Record<FilterKey, string>>(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<FilterKey, string>);
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
const categoryModel = selectModel('category');
const sourceModel = selectModel('source');
const assignedModel = selectModel('assigned');
const any = computed(() => ({ value: ANY, label: trans('support.tickets.filters.any') }));
const statusOptions = computed(() => [any.value, { value: 'active', label: trans('support.tickets.filters.status_active') }, ...(['open', 'pending', 'closed'] as const).map((v) => ({ value: v, label: trans(`support.status.${v}`) }))]);
const categoryOptions = computed(() => [any.value, ...(['account', 'vehicle', 'qr', 'messaging', 'safety', 'other'] as const).map((v) => ({ value: v, label: trans(`support.categories.${v}`) }))]);
const sourceOptions = computed(() => [any.value, ...(['app', 'web'] as const).map((v) => ({ value: v, label: trans(`support.tickets.sources.${v}`) }))]);
const assignedOptions = computed(() => [any.value, ...(['me', 'none'] as const).map((v) => ({ value: v, label: trans(`support.tickets.filters.assigned_${v}`) }))]);

// ---- assignment drawer ------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const assignOpen = ref(false);
const assignTicket = ref<TicketRow | null>(null);
const assignTo = ref<string | undefined>(undefined);
const NOBODY = 'none';
const staffSelect = computed(() => [{ value: NOBODY, label: trans('support.tickets.assign_none') }, ...props.staffOptions.map((s) => ({ value: String(s.id), label: s.name }))]);
function openAssign(row: TicketRow): void {
    assignTicket.value = row;
    assignTo.value = row.assigned ? String(row.assigned.id) : NOBODY;
    action.reset();
    assignOpen.value = true;
}
if (qaDialog() === 'assign' && props.rows.data[0]) openAssign(props.rows.data[0]);
function saveAssign(): void {
    if (!assignTicket.value) return;
    action.run('patch', routeOr('admin.support.tickets.update', `/admin/support/tickets/${assignTicket.value.id}`, { ticket: assignTicket.value.id }), { staff_id: assignTo.value === NOBODY || assignTo.value === undefined ? null : Number(assignTo.value) }, { onSuccess: () => (assignOpen.value = false) });
}

// ---- bulk status ------------------------------------------------------------------------------------------------------------
const bulkActions = computed<BulkAction[]>(() => [{ key: 'status', label: trans('support.tickets.bulk.status'), icon: PhArrowsClockwise, atom: 'support.reply' }]);
const bulkIds = ref<string[]>([]);
const bulkOpen = ref(false);
const bulkStatus = ref<string | undefined>('closed');
const bulkReason = ref('');
const bulkError = ref<string | null>(null);
const bulkProcessing = ref(false);
const bulkStatusOptions = computed(() => (['open', 'pending', 'closed'] as const).map((v) => ({ value: v, label: trans(`support.status.${v}`) })));
function onBulk(_action: string, ids: string[]): void {
    bulkIds.value = ids;
    bulkReason.value = '';
    bulkError.value = null;
    bulkOpen.value = true;
}
function submitBulk(): void {
    const length = bulkReason.value.trim().length;
    if (length < 10 || length > 1000) {
        bulkError.value = trans('ui.confirm.reason_length');
        return;
    }
    router.post(routeOr('admin.support.tickets.bulk', '/admin/support/tickets/bulk'), { action: 'status', status: bulkStatus.value, ids: bulkIds.value, reason: bulkReason.value.trim() } as never, {
        preserveScroll: true,
        preserveState: true,
        onStart: () => (bulkProcessing.value = true),
        onFinish: () => (bulkProcessing.value = false),
        onSuccess: () => (bulkOpen.value = false),
        onError: (errors) => (bulkError.value = firstError(errors)),
    });
}
const resultOpen = ref(false);
watch(
    () => props.bulkResult,
    (result) => (resultOpen.value = result !== null && result !== undefined),
    { immediate: true },
);
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Head :title="trans('support.tickets.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-25" :data-qa-state="pageState">
        <PageHeader :title="trans('support.tickets.title')" :crumbs="[{ label: trans('shell.groups.support') }]" :description="trans('support.tickets.intro')">
            <template v-if="counts" #meta>
                <p class="flex flex-wrap gap-x-16 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-25.counts">
                    <span>{{ `${trans('support.status.open')}: ${formatNumber(pageState === 'empty' ? 0 : counts.open)}` }}</span>
                    <span>{{ `${trans('support.status.pending')}: ${formatNumber(pageState === 'empty' ? 0 : counts.pending)}` }}</span>
                    <span>{{ `${trans('support.tickets.presets.mine')}: ${formatNumber(pageState === 'empty' ? 0 : counts.mine)}` }}</span>
                </p>
            </template>
        </PageHeader>

        <DataTable
            id="support-tickets"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'counts', 'bulkResult']"
            :caption="trans('support.tickets.caption')"
            :empty-title="trans('support.tickets.empty_title')"
            :empty-body="trans('support.tickets.empty_body')"
            :selectable="can('support.reply')"
            :bulk-actions="bulkActions"
            :row-href="(row: TicketRow) => ticketHref(row.id)"
            :force-state="pageState === 'loading' || pageState === 'error' || pageState === 'empty' ? pageState : undefined"
            test-id="ADM-25.table"
            @bulk="onBulk"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('support.tickets.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0"><Field :label="trans('support.tickets.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('support.tickets.filters.q_placeholder')" data-testid="ADM-25.filter.q" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('support.tickets.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('support.tickets.filters.any')" data-testid="ADM-25.filter.status" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('support.tickets.filters.category')"><Select v-model="categoryModel" :options="categoryOptions" size="sm" :placeholder="trans('support.tickets.filters.any')" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('support.tickets.filters.source')"><Select v-model="sourceModel" :options="sourceOptions" size="sm" :placeholder="trans('support.tickets.filters.any')" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('support.tickets.filters.assigned')"><Select v-model="assignedModel" :options="assignedOptions" size="sm" :placeholder="trans('support.tickets.filters.any')" /></Field></div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-25.filter.apply">{{ trans('support.tickets.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-subject="{ row }">
                <NameCell :name="row.subject" :caption="wide ? row.reference : `${row.reference} · ${trans(`support.categories.${row.category}`)}`" :href="ticketHref(row.id)" test-id="ADM-25.open" />
            </template>
            <template #cell-from="{ row }">
                <span class="flex flex-col">
                    <span class="sc-key whitespace-nowrap text-ink">{{ fromText(row.from) }}</span>
                    <span v-if="row.from.kind === 'web' && row.from.email" class="sc-key whitespace-nowrap text-caption text-ink-3">{{ row.from.email }}</span>
                </span>
            </template>
            <template #cell-category="{ row }"><span class="whitespace-nowrap text-ink-2">{{ trans(`support.categories.${row.category}`) }}</span></template>
            <template #cell-status="{ row }"><StatusPill :tone="statusTones[row.status]" :label="trans(`support.status.${row.status}`)" /></template>
            <template #cell-assigned="{ row }"><span class="whitespace-nowrap text-ink-2">{{ row.assigned ? (row.assigned.me ? trans('moderation.reports.you') : row.assigned.name) : '–' }}</span></template>
            <template #cell-last_activity_at="{ row }">
                <time :datetime="row.last_activity_at ?? undefined" :title="formatDateTime(row.last_activity_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.last_activity_at) }}</time>
            </template>
            <template #cell-messages="{ row }"><span class="block text-right text-ink tabular-nums">{{ formatNumber(row.messages) }}</span></template>
            <template #cell-actions="{ row }">
                <IconButton v-if="can('support.reply')" :icon="PhUserSwitch" :label="trans('support.tickets.assign_title', { reference: row.reference })" size="sm" data-testid="ADM-25.assign" @click.stop.prevent="openAssign(row)" />
            </template>
        </DataTable>

        <Drawer v-model:open="assignOpen" :title="trans('support.tickets.assign_title', { reference: assignTicket?.reference ?? '' })" :dismissible="!action.processing.value" test-id="ADM-25.assign-drawer">
            <div class="flex flex-col gap-16">
                <StateBlock v-if="serverError" kind="error" :title="trans('ui.state.error_title')" :body="serverError" :retryable="false" test-id="ADM-25.assign.error" />
                <Field :label="trans('support.tickets.assign_staff')"><Select v-model="assignTo" :options="staffSelect" data-testid="ADM-25.assign.staff" /></Field>
            </div>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="assignOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" data-testid="ADM-25.assign.save" @click="saveAssign()">{{ trans('support.tickets.assign_submit') }}</Button>
            </template>
        </Drawer>

        <Dialog v-model:open="bulkOpen" :title="trans('support.tickets.bulk.title', { count: formatNumber(bulkIds.length) })" :description="trans('support.tickets.bulk.body')" :dismissible="!bulkProcessing" test-id="ADM-25.bulk-dialog">
            <div class="flex flex-col gap-16">
                <ApprovalNotice v-if="bulkIds.length > 100" test-id="ADM-25.bulk.four-eyes" />
                <Field :label="trans('support.tickets.bulk.to')"><Select v-model="bulkStatus" :options="bulkStatusOptions" data-testid="ADM-25.bulk.status" /></Field>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('decisions.reason_hint')" required><Textarea v-model="bulkReason" :rows="2" :maxlength="1000" show-count data-testid="ADM-25.bulk.reason" /></Field>
            </div>
            <template #footer>
                <DialogError :message="bulkError" />
                <Button variant="ghost" :disabled="bulkProcessing" data-dialog-cancel @click="bulkOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="bulkProcessing" data-testid="ADM-25.bulk.submit" @click="submitBulk()">{{ trans('support.tickets.bulk.submit') }}</Button>
            </template>
        </Dialog>

        <BulkResultPanel
            v-if="bulkResult"
            v-model:open="resultOpen"
            :results="bulkResult.rows"
            :title="trans('support.tickets.bulk.result')"
            :label="(id: string) => bulkResult?.labels[id] ?? id"
            :reason="(code: string | null) => trans(`support.tickets.bulk.codes.${code ?? 'failed'}`)"
            test-id="ADM-25.bulk-result"
        />
    </div>
</template>
