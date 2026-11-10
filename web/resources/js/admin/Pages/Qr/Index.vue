<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhFunnel } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Field, Input, QrCodeText, Select, StatusPill, Tooltip } from '../../Components/ui';
import NameCell from '../../Components/data-table/NameCell.vue';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';

/** ADM-18 QR registry (06 §3 QR): code, status, vehicle, owner, created, scans of the last 7 and 30 days (daily counts only). */
interface QrRow {
    id: string;
    code: string;
    display_code: string;
    status: 'active' | 'revoked';
    revoked_reason: string | null;
    vehicle: { id: string; title: string; deleted: boolean } | null;
    owner: { id: string; username: string | null } | null;
    created_at: string | null;
    scans_7: number;
    scans_30: number;
}

const props = defineProps<{ rows: Paginated<QrRow>; query: TableQuery; views: SavedView[] }>();
const state = usePageState();

// Content-sized columns (DQ-526/527): the code never breaks (min 96), the vehicle takes the rest, the rest shrinks to its content.
const columns = computed<TableColumn[]>(() => [
    { key: 'code', label: trans('qr.columns.code'), sort: 'code', min: 96, hideable: false },
    { key: 'status', label: trans('qr.columns.status') },
    { key: 'vehicle', label: trans('qr.columns.vehicle'), grow: true, min: 200 },
    { key: 'owner', label: trans('qr.columns.owner'), min: 120 },
    { key: 'created_at', label: trans('qr.columns.created'), sort: 'created_at', min: 96 },
    { key: 'scans_7', label: trans('qr.columns.scans_7'), sort: 'scans_7', numeric: true },
    { key: 'scans_30', label: trans('qr.columns.scans_30'), sort: 'scans_30', numeric: true },
]);
const presets: PresetView[] = [
    { key: 'active', name: 'qr.presets.active', query: { filter: { status: 'active' } } },
    { key: 'revoked', name: 'qr.presets.revoked', query: { filter: { status: 'revoked' } } },
    { key: 'top', name: 'qr.presets.top', query: { filter: {}, sort: '-scans_30' } },
];

const filters = reactive({ q: '', status: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.q = filter.q ?? '';
        filters.status = filter.status ?? '';
    },
    { immediate: true },
);
const ANY = '*';
const statusModel = computed({
    get: () => (filters.status === '' ? undefined : filters.status),
    set: (value: string | undefined) => (filters.status = value === undefined || value === ANY ? '' : value),
});
const statusOptions = computed(() => [{ value: ANY, label: trans('qr.filters.any') }, ...(['active', 'revoked'] as const).map((v) => ({ value: v, label: trans(`qr.status.${v}`) }))]);

const showHref = (row: QrRow) => routeOr('admin.qr.show', `/admin/qr/${row.id}`, { qr: row.id });
const vehicleHref = (id: string) => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });
const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
</script>

<template>
    <Head :title="trans('qr.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-18" :data-qa-state="state">
        <PageHeader :title="trans('qr.title')" :crumbs="[{ label: trans('shell.groups.qr') }]" :description="trans('qr.intro')" />

        <DataTable
            id="qr"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('qr.caption')"
            :empty-title="trans('qr.empty_title')"
            :empty-body="trans('qr.empty_body')"
            :row-href="showHref"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-18.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('qr.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="w-240">
                        <Field :label="trans('qr.filters.q')">
                            <Input v-model="filters.q" size="sm" maxlength="12" :placeholder="trans('qr.filters.q_placeholder')" tnum data-testid="ADM-18.filter.q" />
                        </Field>
                    </div>
                    <div class="w-200">
                        <Field :label="trans('qr.filters.status')">
                            <Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('qr.filters.any')" data-testid="ADM-18.filter.status" />
                        </Field>
                    </div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" data-testid="ADM-18.filter.apply">{{ trans('qr.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-code="{ row }">
                <QrCodeText :code="row.code" :href="showHref(row)" test-id="ADM-18.open" />
            </template>
            <template #cell-status="{ row }">
                <!-- The revoke reason is the pill's tooltip (and on ADM-19), not a cut-off line beside it (DQ-526). -->
                <Tooltip v-if="row.revoked_reason" :content="trans('qr.revoked_because', { reason: trans(`qr.reasons.${row.revoked_reason}`) })">
                    <span tabindex="0" :class="[focusRing, 'inline-flex h-24 items-center rounded-xs']" :aria-label="`${trans(`qr.status.${row.status}`)}: ${trans(`qr.reasons.${row.revoked_reason}`)}`">
                        <StatusPill :tone="row.status === 'active' ? 'success' : 'neutral'" :label="trans(`qr.status.${row.status}`)" />
                    </span>
                </Tooltip>
                <StatusPill v-else :tone="row.status === 'active' ? 'success' : 'neutral'" :label="trans(`qr.status.${row.status}`)" />
            </template>
            <template #cell-vehicle="{ row }">
                <NameCell v-if="row.vehicle && !row.vehicle.deleted" :name="row.vehicle.title" :href="vehicleHref(row.vehicle.id)" />
                <span v-else class="text-ink-3">{{ row.vehicle ? trans('qr.vehicle_deleted') : trans('qr.no_vehicle') }}</span>
            </template>
            <template #cell-owner="{ row }">
                <Link v-if="row.owner" :href="memberHref(row.owner.id)" :title="row.owner.username ? `@${row.owner.username}` : undefined" :class="[focusRing, 'sc-key flex h-32 min-w-0 items-center rounded-xs text-ink-2 hover:text-ink hover:underline']"><span class="truncate">{{ row.owner.username ? `@${row.owner.username}` : '–' }}</span></Link>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" :title="formatDateTime(row.created_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
            </template>
            <template #cell-scans_7="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.scans_7) }}</span>
            </template>
            <template #cell-scans_30="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.scans_30) }}</span>
            </template>
        </DataTable>
    </div>
</template>
