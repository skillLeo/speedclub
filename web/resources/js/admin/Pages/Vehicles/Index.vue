<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhEyeSlash, PhFunnel } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { BulkAction, TableColumn } from '../../Components/data-table/table';
import { useAdminAction } from '../../Components/decisions/action';
import HideDialog from '../../Components/decisions/HideDialog.vue';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import VehicleThumb from '../../Components/patterns/VehicleThumb.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Combobox, DateRangeField, Field, Input, QrCodeText, Select, StatusPill } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import { moderationPill, visibilityPill } from '../../lib/vehicleStatus';
import { usePermissions } from '../../lib/permissions';
import type { BulkResult, Paginated, PresetView, SavedView, TableQuery } from '../../types/table';

/**
 * ADM-11 vehicles (06 §3 Vehicles & media, m3.2-contract §2): server table with filters (make, visibility, moderation status, reported,
 * QR, updated range), bulk hide with one statement of reasons (more than 100 → four-eyes) and the per-record result panel.
 */
interface VehicleRow {
    id: string;
    public_id: string;
    slug: string;
    make: string | null;
    title: string;
    nickname: string | null;
    model_year: number | null;
    owner: { id: string; username: string | null } | null;
    status: string;
    visibility: string;
    hidden: boolean;
    reported: boolean;
    cover: string | null;
    cover_focus?: string | null;
    cover_placeholder?: string | null;
    photos: number;
    mods: number;
    qr: string | null;
    updated_at: string | null;
}

const props = defineProps<{
    rows: Paginated<VehicleRow>;
    query: TableQuery;
    views: SavedView[];
    makes: { value: string; label: string }[];
    bulkResult?: { action: string; rows: BulkResult[]; labels: Record<string, string> } | null;
}>();

const state = usePageState();
const { can } = usePermissions();

// Content-sized columns (DQ-526): make and model take the rest and wrap to two lines with the nickname under them; the short columns
// shrink to their content; the moderation column (a pill only for exceptions, DQ-537) is hidden by default below 1440.
const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1440px)').matches;
const columns = computed<TableColumn[]>(() => [
    { key: 'cover', label: trans('vehicles.columns.cover'), srOnlyLabel: true },
    { key: 'title', label: trans('vehicles.columns.title'), grow: true, min: 200, hideable: false },
    { key: 'model_year', label: trans('vehicles.columns.year'), sort: 'model_year', numeric: true },
    { key: 'owner', label: trans('vehicles.columns.owner'), min: 120 },
    { key: 'visibility', label: trans('vehicles.columns.visibility') },
    { key: 'moderation', label: trans('vehicles.columns.moderation'), defaultHidden: !wide },
    { key: 'photos', label: trans('vehicles.columns.photos'), sort: 'photos_count', numeric: true },
    { key: 'mods', label: trans('vehicles.columns.mods'), sort: 'modifications_count', numeric: true },
    { key: 'qr', label: trans('vehicles.columns.qr'), min: 96 },
    { key: 'updated_at', label: trans('vehicles.columns.updated'), sort: 'updated_at', min: 96, defaultHidden: true },
]);

const presets: PresetView[] = [
    { key: 'hidden', name: 'vehicles.presets.hidden', query: { filter: { moderation: 'hidden' } } },
    { key: 'reported', name: 'vehicles.presets.reported', query: { filter: { reported: '1' } } },
    { key: 'no-qr', name: 'vehicles.presets.no_qr', query: { filter: { has_qr: '0' } } },
];

// ---- filters --------------------------------------------------------------------------------------------------------------
const KEYS = ['q', 'make', 'visibility', 'moderation', 'reported', 'has_qr', 'updated_from', 'updated_to'] as const;
type Key = (typeof KEYS)[number];
const filters = reactive<Record<Key, string>>(Object.fromEntries(KEYS.map((k) => [k, ''])) as Record<Key, string>);
watch(
    () => props.query.filter,
    (filter) => KEYS.forEach((key) => (filters[key] = filter[key] ?? '')),
    { immediate: true },
);
const ANY = '*';
const model = (key: Key) =>
    computed({
        get: () => (filters[key] === '' ? undefined : filters[key]),
        set: (value: string | undefined) => (filters[key] = value === undefined || value === ANY ? '' : value),
    });
const makeModel = model('make');
const visibilityModel = model('visibility');
const moderationModel = model('moderation');
const reportedModel = model('reported');
const qrModel = model('has_qr');
const any = computed(() => ({ value: ANY, label: trans('vehicles.filters.any') }));
const makeOptions = computed(() => [any.value, ...props.makes]);
const visibilityOptions = computed(() => [any.value, ...(['public', 'unlisted', 'private'] as const).map((v) => ({ value: v, label: trans(`vehicles.visibility.${v}`) }))]);
const moderationOptions = computed(() => [any.value, { value: 'visible', label: trans('vehicles.moderation.visible') }, { value: 'hidden', label: trans('vehicles.moderation.hidden') }]);
const reportedOptions = computed(() => [any.value, { value: '1', label: trans('vehicles.filters.reported_yes') }, { value: '0', label: trans('vehicles.filters.reported_no') }]);
const qrOptions = computed(() => [any.value, { value: '1', label: trans('vehicles.filters.qr_yes') }, { value: '0', label: trans('vehicles.filters.qr_no') }]);

const showHref = (row: VehicleRow): string => routeOr('admin.vehicles.show', `/admin/vehicles/${row.id}`, { vehicle: row.id });
const memberHref = (id: string): string => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });

// ---- bulk hide ----------------------------------------------------------------------------------------------------------------
const bulkActions = computed<BulkAction[]>(() => [{ key: 'hide', label: trans('vehicles.bulk.hide'), icon: PhEyeSlash, atom: 'vehicles.hide', danger: true }]);
const ids = ref<string[]>([]);
const hideOpen = ref(false);
const action = useAdminAction();
function onBulk(_action: string, selected: string[]): void {
    ids.value = selected;
    action.reset();
    hideOpen.value = true;
}
function submitHide(payload: Record<string, string | null>): void {
    action.run('post', routeOr('admin.vehicles.bulk-hide', '/admin/vehicles/bulk-hide'), { ...payload, ids: ids.value }, { sensitive: true, onSuccess: () => (hideOpen.value = false) });
}
const resultOpen = ref(false);
watch(
    () => props.bulkResult,
    (result) => (resultOpen.value = result !== null && result !== undefined),
    { immediate: true },
);
</script>

<template>
    <Head :title="trans('vehicles.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-11" :data-qa-state="state">
        <PageHeader :title="trans('vehicles.title')" :crumbs="[{ label: trans('shell.groups.vehicles_media') }]" :description="trans('vehicles.intro')" />

        <DataTable
            id="vehicles"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'bulkResult']"
            :caption="trans('vehicles.caption')"
            :empty-title="trans('vehicles.empty_title')"
            :empty-body="trans('vehicles.empty_body')"
            :selectable="can('vehicles.hide')"
            :bulk-actions="bulkActions"
            :row-href="showHref"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-11.table"
            @bulk="onBulk"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-col gap-8" :aria-label="trans('vehicles.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="flex flex-wrap items-end gap-8 desktop:flex-nowrap">
                        <div class="min-w-200 grow-2 basis-0">
                            <Field :label="trans('vehicles.filters.q')">
                                <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('vehicles.filters.q_placeholder')" data-testid="ADM-11.filter.q" />
                            </Field>
                        </div>
                        <div class="min-w-160 grow basis-0">
                            <Field :label="trans('vehicles.filters.make')">
                                <Combobox v-model="makeModel" :options="makeOptions" size="sm" :placeholder="trans('vehicles.filters.any')" data-testid="ADM-11.filter.make" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('vehicles.filters.visibility')">
                                <Select v-model="visibilityModel" :options="visibilityOptions" size="sm" :placeholder="trans('vehicles.filters.any')" data-testid="ADM-11.filter.visibility" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('vehicles.filters.moderation')">
                                <Select v-model="moderationModel" :options="moderationOptions" size="sm" :placeholder="trans('vehicles.filters.any')" data-testid="ADM-11.filter.moderation" />
                            </Field>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-end gap-8 desktop:flex-nowrap">
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('vehicles.filters.reported')">
                                <Select v-model="reportedModel" :options="reportedOptions" size="sm" :placeholder="trans('vehicles.filters.any')" data-testid="ADM-11.filter.reported" />
                            </Field>
                        </div>
                        <div class="min-w-140 grow basis-0">
                            <Field :label="trans('vehicles.filters.qr')">
                                <Select v-model="qrModel" :options="qrOptions" size="sm" :placeholder="trans('vehicles.filters.any')" data-testid="ADM-11.filter.qr" />
                            </Field>
                        </div>
                        <div class="w-256 shrink-0">
                            <Field :label="trans('vehicles.filters.updated')">
                                <DateRangeField v-model:from="filters.updated_from" v-model:to="filters.updated_to" size="sm" test-id="ADM-11.filter.updated" />
                            </Field>
                        </div>
                        <div class="grow" />
                        <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-11.filter.apply">{{ trans('vehicles.filters.apply') }}</Button>
                    </div>
                </form>
            </template>

            <template #cell-cover="{ row }">
                <VehicleThumb :src="row.cover" :focus="row.cover_focus" :placeholder="row.cover_placeholder" />
            </template>
            <template #cell-title="{ row }">
                <NameCell :name="[row.make, row.title].filter(Boolean).join(' ')" :caption="row.nickname ? trans('vehicles.nickname', { name: row.nickname }) : null" :href="showHref(row)" test-id="ADM-11.open" />
            </template>
            <template #cell-model_year="{ row }">
                <span class="block text-right text-ink-2 tabular-nums">{{ row.model_year ?? '–' }}</span>
            </template>
            <template #cell-owner="{ row }">
                <Link v-if="row.owner" :href="memberHref(row.owner.id)" :class="[focusRing, 'sc-key flex h-32 min-w-0 items-center rounded-xs text-ink-2 hover:text-ink hover:underline']" :title="row.owner.username ? `@${row.owner.username}` : undefined"><span class="truncate">{{ row.owner.username ? `@${row.owner.username}` : '–' }}</span></Link>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-visibility="{ row }">
                <StatusPill v-bind="visibilityPill(row)" />
            </template>
            <template #cell-moderation="{ row }">
                <StatusPill v-if="moderationPill(row)" v-bind="moderationPill(row) ?? { label: '' }" />
                <span v-else class="text-ink-3" :title="trans('vehicles.moderation.visible')">–</span>
            </template>
            <template #cell-photos="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.photos) }}</span>
            </template>
            <template #cell-mods="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.mods) }}</span>
            </template>
            <template #cell-qr="{ row }">
                <QrCodeText v-if="row.qr" :code="row.qr" muted />
                <span v-else class="text-ink-3">{{ trans('vehicles.qr.none') }}</span>
            </template>
            <template #cell-updated_at="{ row }">
                <time :datetime="row.updated_at ?? undefined" :title="formatDateTime(row.updated_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.updated_at) }}</time>
            </template>
        </DataTable>

        <HideDialog
            v-model:open="hideOpen"
            :title="trans('vehicles.bulk.hide_title', { count: formatNumber(ids.length) })"
            :description="trans('vehicles.bulk.hide_body')"
            subject="vehicle"
            :four-eyes="ids.length > 100"
            :processing="action.processing.value"
            :error="action.error.value"
            :confirm-label="trans('vehicles.bulk.hide')"
            test-id="ADM-11.bulk-hide"
            @submit="submitHide"
        />

        <BulkResultPanel
            v-if="bulkResult"
            v-model:open="resultOpen"
            :results="bulkResult.rows"
            :title="trans('vehicles.bulk.result')"
            :label="(id: string) => bulkResult?.labels[id] ?? id"
            :reason="(code: string | null) => trans(`members.bulk.codes.${code ?? 'failed'}`)"
            test-id="ADM-11.bulk-result"
        />
    </div>
</template>
