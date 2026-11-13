<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhCheck, PhFunnel, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import { Button, ConfirmDialog, Field, Input, SegmentedControl, StatusPill, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { Paginated, SavedView, TableQuery } from '../../types/table';
import AcceptDrawer, { type RequestRow as AcceptRow } from './Partials/AcceptDrawer.vue';
import VehicleCatalogHeader from './Partials/VehicleCatalogHeader.vue';
import { useCatalogWrite } from './shared';

/**
 * ADM-14 tab Anfragen (06 §3 Catalogue, m3.3-contract §2): what members typed under "Nicht gefunden?", oldest open first; Übernehmen
 * (pick or create the entry, relink the car, the member is told in-app "Dein Fahrzeug ist jetzt im Katalog") and Ablehnen (the reason is
 * shown to the member). Closed requests keep who resolved them and when.
 */
interface RequestRow extends AcceptRow {
    status: 'pending' | 'approved' | 'rejected';
    vehicle: { id: string; title: string; in_catalog: boolean; deleted: boolean } | null;
    rejection_reason: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string | null;
}

const props = defineProps<{ rows: Paginated<RequestRow>; query: TableQuery; views: SavedView[]; counts?: { makes: number; requests: number } }>();

const state = usePageState();
const { can } = usePermissions();
const manage = computed(() => can('catalog.manage'));
const counts = computed(() => (state.value === 'empty' ? { makes: props.counts?.makes ?? 0, requests: 0 } : (props.counts ?? null)));
const status = computed(() => props.query.filter.status ?? 'pending');
const open = computed(() => status.value === 'pending');

// DQ-587/607: the Fahrzeug column only while a row of this page has a car (a request made before saving one has none); on the closed
// filters "Erledigt" takes the room, so the reason the member read wraps to two lines instead of being cut.
const anyVehicle = computed(() => props.rows.data.some((row) => row.vehicle !== null));
const columns = computed<TableColumn[]>(() => [
    open.value
        ? { key: 'requested', label: trans('catalog.columns.requested'), grow: true, min: 200, hideable: false }
        : { key: 'requested', label: trans('catalog.columns.requested'), wrap: true, min: 200, hideable: false },
    { key: 'member', label: trans('catalog.columns.member'), min: 120 },
    ...(anyVehicle.value ? [{ key: 'vehicle', label: trans('catalog.columns.vehicle'), min: 160 } satisfies TableColumn] : []),
    { key: 'created_at', label: trans('catalog.columns.created'), sort: 'created_at', min: 96 },
    ...(open.value
        ? []
        : [
              { key: 'status', label: trans('catalog.columns.status') } satisfies TableColumn,
              { key: 'resolved', label: trans('catalog.columns.resolved'), sort: 'resolved_at', grow: true, min: 280 } satisfies TableColumn,
          ]),
    ...(open.value && manage.value ? [{ key: 'actions', label: trans('catalog.columns.actions'), srOnlyLabel: true, hideable: false, skeleton: 'h-24 w-200' } satisfies TableColumn] : []),
]);

const filters = reactive({ q: '', status: 'pending' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', status: filter.status ?? 'pending' }),
    { immediate: true },
);
const statusOptions = computed(() => (['pending', 'approved', 'rejected'] as const).map((value) => ({ value, label: trans(`catalog.requests.status.${value}`) })));
const pills: Record<RequestRow['status'], Tone> = { pending: 'warning', approved: 'success', rejected: 'neutral' };
const filterOf = (): Record<string, string> => ({ q: filters.q, status: filters.status === 'pending' ? '' : filters.status });

const asked = (row: RequestRow): string => [row.make_text, row.model_text].filter(Boolean).join(' ') || trans('catalog.requests.nothing');
const memberHref = (id: string): string => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
const vehicleHref = (id: string): string => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });

// ---- accept / reject ----------------------------------------------------------------------------------------------------
const current = ref<RequestRow | null>(null);
const acceptOpen = ref(false);
const rejectOpen = ref(false);
const write = useCatalogWrite();
const failed = qaDialogFailed();
function accept(row: RequestRow): void {
    current.value = row;
    acceptOpen.value = true;
}
function reject(row: RequestRow): void {
    current.value = row;
    write.reset();
    rejectOpen.value = true;
}
function sendReject(reason: string | null): void {
    const row = current.value;
    if (row === null) return;
    write.run('post', routeOr('admin.catalog.vehicles.requests.reject', `/admin/catalog/requests/${row.id}/reject`, { catalogRequest: row.id }), { reason }, { onSuccess: () => (rejectOpen.value = false) });
}

const dialog = qaDialog();
// QA overlays: ?request=<id> picks the request (DQ-594), else the oldest open one.
const wanted = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('request');
const first = (wanted === null ? undefined : props.rows.data.find((row) => row.id === wanted && row.status === 'pending')) ?? props.rows.data.find((row) => row.status === 'pending') ?? null;
if (first !== null && dialog === 'accept') accept(first);
if (first !== null && dialog === 'reject') reject(first);
</script>

<template>
    <Head :title="trans('catalog.requests.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-14-requests" :data-qa-state="state">
        <VehicleCatalogHeader tab="requests" :counts="counts" />

        <DataTable
            :id="'catalog-requests'"
            :key="`${status}-${anyVehicle}`"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :only="['rows', 'query', 'views', 'counts']"
            :caption="trans('catalog.requests.caption')"
            :empty-title="trans(`catalog.requests.empty_title.${status}`)"
            :empty-body="trans(`catalog.requests.empty_body.${status}`)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-14-requests.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('catalog.filters.label')" @submit.prevent="apply(filterOf())">
                    <!-- DQ-591: the label as a Field label and the track as tall as the 32 px inputs of the row. -->
                    <div class="flex flex-col gap-4">
                        <span id="adm14-requests-status" class="text-admin-base-strong text-ink">{{ trans('catalog.filters.status') }}</span>
                        <SegmentedControl
                            v-model="filters.status"
                            class="self-start"
                            size="field-sm"
                            :options="statusOptions"
                            aria-labelledby="adm14-requests-status"
                            :label="trans('catalog.filters.status')"
                            data-testid="ADM-14-requests.filter.status"
                            @update:model-value="apply(filterOf())"
                        />
                    </div>
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('catalog.filters.q')"><Input v-model="filters.q" size="sm" maxlength="100" :placeholder="trans('catalog.filters.q_request')" data-testid="ADM-14-requests.filter.q" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0">{{ trans('catalog.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-requested="{ row }">
                <NameCell :name="asked(row)" :caption="row.generation_text" />
            </template>
            <template #cell-member="{ row }">
                <Link v-if="row.member" :href="memberHref(row.member.id)" :class="[focusRing, 'sc-key flex h-32 min-w-0 items-center rounded-xs text-ink-2 hover:text-ink hover:underline']">
                    <span class="truncate">{{ row.member.username ? `@${row.member.username}` : trans('catalog.requests.no_username') }}</span>
                </Link>
                <span v-else class="text-ink-3">{{ trans('catalog.requests.no_member') }}</span>
            </template>
            <template #cell-vehicle="{ row }">
                <Link v-if="row.vehicle && !row.vehicle.deleted" :href="vehicleHref(row.vehicle.id)" :class="[focusRing, 'flex h-32 min-w-0 items-center rounded-xs text-ink-2 hover:text-ink hover:underline']">
                    <span class="truncate">{{ row.vehicle.title || trans('catalog.requests.vehicle') }}</span>
                </Link>
                <span v-else-if="row.vehicle" class="text-ink-3">{{ trans('catalog.requests.vehicle_deleted') }}</span>
                <span v-else class="text-ink-3" :title="trans('catalog.requests.no_vehicle_hint')">{{ trans('catalog.requests.no_vehicle') }}</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" :title="formatDateTime(row.created_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
            </template>
            <template #cell-status="{ row }">
                <StatusPill :tone="pills[row.status]" :label="trans(`catalog.requests.status.${row.status}`)" />
            </template>
            <template #cell-resolved="{ row }">
                <span class="flex min-w-0 flex-col">
                    <span class="whitespace-nowrap text-admin-base text-ink-2 tabular-nums">{{ [row.resolved_by, formatDate(row.resolved_at)].filter(Boolean).join(' · ') }}</span>
                    <span v-if="row.rejection_reason" class="line-clamp-2 text-caption text-ink-3" :title="row.rejection_reason" data-testid="ADM-14-requests.reason">{{ row.rejection_reason }}</span>
                </span>
            </template>
            <template #cell-actions="{ row }">
                <span class="flex items-center justify-end gap-8">
                    <Button size="sm" variant="secondary" :icon="PhCheck" data-testid="ADM-14-requests.accept" @click="accept(row)">{{ trans('catalog.requests.accept') }}</Button>
                    <Button size="sm" variant="ghost" :icon="PhX" class="hover:text-danger!" data-testid="ADM-14-requests.reject" @click="reject(row)">{{ trans('catalog.requests.reject') }}</Button>
                </span>
            </template>
        </DataTable>

        <AcceptDrawer v-model:open="acceptOpen" :request="current" test-id="ADM-14-requests.accept-drawer" />
        <ConfirmDialog
            v-model:open="rejectOpen"
            :title="trans('catalog.requests.reject_title', { text: current ? asked(current) : '' })"
            :body="trans('catalog.requests.reject_body')"
            :confirm-label="trans('catalog.requests.reject')"
            reason
            reason-first
            :reason-max="500"
            :reason-hint="trans('catalog.requests.reject_hint')"
            :reason-label="trans('catalog.requests.reject_reason')"
            :processing="write.processing.value"
            :error="failed ? trans('ui.state.server_error') : write.error.value"
            test-id="ADM-14-requests.reject-dialog"
            @confirm="sendReject"
        />
    </div>
</template>
