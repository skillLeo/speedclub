<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhFunnel, PhLockSimple, PhMoonStars, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { BulkAction, TableColumn } from '../../Components/data-table/table';
import { useAdminAction } from '../../Components/decisions/action';
import BulkResultPanel from '../../Components/patterns/BulkResultPanel.vue';
import VehicleThumb from '../../Components/patterns/VehicleThumb.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, DateRangeField, Field, IconButton, Input, Select, Tooltip, type SelectOption } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialog } from '../../composables/qaDialog';
import { usePageState } from '../../composables/pageState';
import { formatDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute } from '../../lib/routes';
import type { BulkResult, Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import { memberHref } from '../Moderation/shared';
import RemoveSpotDialog from './Partials/RemoveSpotDialog.vue';
import { activeSignals, bulkRemoveUrl, dexLabel, errorText, removeUrl, signalDetail, spotHref, type SignalRules, type SpotRow } from './shared';

/**
 * ADM-62 Spots (M5.9b admin, m5.9b contract §7): every STREET DEX spot, newest first — time, spotter, car with Dex number, city (never a
 * place), counted, night, source — with the abuse signals as badges (Serie, Gleiches Gerät, Städtesprung; computed on the server) and
 * the filters Zeitraum, Stadt, Auto, Spotter, Auffälligkeiten, Status plus saved views. "Spot entfernen" per row and for a selection
 * (a burst, ≤ 50), ⚿ recent password; moderation.decide. Without it (analyst): read-only.
 */
const props = defineProps<{
    rows: Paginated<SpotRow>;
    query: TableQuery;
    views: SavedView[];
    signals?: SignalRules;
    canRemove?: boolean;
    bulkMax?: number;
    anySpots?: boolean;
    bulkResult?: { rows: BulkResult[] } | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const mayRemove = computed(() => props.canRemove === true && can('moderation.decide'));
const rules = computed(() => props.signals ?? null);

const columns = computed<TableColumn[]>(() => [
    { key: 'spotted_at', label: trans('spots.columns.spotted_at'), sort: 'created_at', min: 150, hideable: false },
    { key: 'spotter', label: trans('spots.columns.spotter'), min: 120 },
    { key: 'car', label: trans('spots.columns.car'), grow: true, min: 160, hideable: false },
    { key: 'city', label: trans('spots.columns.city') },
    // Counted and night also stand under the time (captions), so the default set fits 1280 without scrolling; the columns stay choosable.
    { key: 'counted', label: trans('spots.columns.counted'), defaultHidden: true },
    { key: 'night', label: trans('spots.columns.night'), defaultHidden: true },
    { key: 'source', label: trans('spots.columns.source'), defaultHidden: true },
    { key: 'signals', label: trans('spots.columns.signals') },
    ...(mayRemove.value ? [{ key: 'actions', label: trans('spots.columns.actions'), srOnlyLabel: true, width: 'xs' as const }] : []),
]);
const presets: PresetView[] = [
    { key: 'signals', name: 'spots.presets.signals', query: { filter: { signal: 'any' } } },
    { key: 'bursts', name: 'spots.presets.bursts', query: { filter: { signal: 'burst' } } },
    { key: 'removed', name: 'spots.presets.removed', query: { filter: { status: 'removed' } } },
];

// ---- filters ------------------------------------------------------------------------------------------------------------------
const filters = reactive({ from: '', to: '', city: '', car: '', spotter: '', signal: '', status: '' });
watch(
    () => props.query.filter,
    (filter) =>
        Object.assign(filters, {
            from: filter.from ?? '',
            to: filter.to ?? '',
            city: filter.city ?? '',
            car: filter.car ?? '',
            spotter: filter.spotter ?? '',
            signal: filter.signal ?? '',
            status: filter.status ?? '',
        }),
    { immediate: true },
);
const ANY = '*';
const pick = (key: 'signal' | 'status') => computed({ get: () => filters[key] || undefined, set: (v: string | undefined) => (filters[key] = v === undefined || v === ANY ? '' : v) });
const signalModel = pick('signal');
const statusModel = pick('status');
const signalOptions = computed<SelectOption[]>(() => [
    { value: ANY, label: trans('spots.filters.any') },
    { value: 'any', label: trans('spots.filters.signals_only') },
    { value: 'burst', label: trans('spots.signal.burst') },
    { value: 'device', label: trans('spots.signal.device') },
    { value: 'hop', label: trans('spots.signal.hop') },
]);
const statusOptions = computed<SelectOption[]>(() => [
    { value: ANY, label: trans('spots.status.active') },
    { value: 'removed', label: trans('spots.status.removed') },
    { value: 'all', label: trans('spots.status.all') },
]);
function applied(): Record<string, string> {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}

// ---- remove (one row or a selection) -------------------------------------------------------------------------------------------
const bulkActions = computed<BulkAction[]>(() => [{ key: 'remove', label: trans('spots.actions.remove_selected'), icon: PhTrash, atom: 'moderation.decide', danger: true }]);
const action = useAdminAction();
const target = ref<string[]>([]);
const removeOpen = ref(false);
function openRemove(ids: string[]): void {
    target.value = ids;
    action.reset();
    removeOpen.value = true;
}
if (qaDialog() === 'remove' && props.rows.data[0]) openRemove([props.rows.data[0].id]);
function confirmRemove(): void {
    const ids = target.value;
    const one = ids.length === 1 ? ids[0] : undefined;
    if (one !== undefined) action.run('post', removeUrl(one), {}, { sensitive: true, onSuccess: () => (removeOpen.value = false) });
    else action.run('post', bulkRemoveUrl(), { ids }, { sensitive: true, onSuccess: () => (removeOpen.value = false) });
}
const resultOpen = ref(false);
watch(
    () => props.bulkResult,
    (result) => (resultOpen.value = result !== null && result !== undefined),
    { immediate: true },
);
const labelOf = (id: string): string => {
    const row = props.rows.data.find((r) => r.id === id);
    return row ? `${formatDateTime(row.spotted_at)} · ${row.vehicle.title}` : id;
};
/** Under the time: "Nachts", "Nicht gezählt", "Entfernt" (the night spot keeps its moon). */
function captionOf(row: SpotRow): string {
    return [row.night ? trans('spots.caption_night') : null, row.counted ? null : trans('spots.caption_not_counted'), row.removed_at ? trans('spots.removed_badge') : null].filter(Boolean).join(' · ');
}
const emptyBody = computed(() => trans(props.anySpots ? 'spots.empty_body_removed' : 'spots.empty_body'));
</script>

<template>
    <Head :title="trans('spots.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-62" :data-qa-state="state">
        <PageHeader :title="trans('spots.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('spots.intro')" />

        <div class="flex flex-col gap-8">
            <ul v-if="rules" class="flex flex-col gap-4 text-admin-base text-ink-2" data-testid="ADM-62.rules">
                <li class="flex items-baseline gap-8"><Badge tone="warning">{{ trans('spots.signal.burst') }}</Badge><span>{{ trans('spots.signal.burst_rule', { count: String(rules.burst.more_than), minutes: String(rules.burst.minutes) }) }}</span></li>
                <li class="flex items-baseline gap-8"><Badge tone="warning">{{ trans('spots.signal.hop') }}</Badge><span>{{ trans('spots.signal.hop_rule', { km: String(rules.hop.km), minutes: String(rules.hop.minutes) }) }}</span></li>
                <li class="flex items-baseline gap-8" data-testid="ADM-62.rules.device">
                    <Badge :tone="rules.device_available ? 'warning' : 'neutral'">{{ trans('spots.signal.device') }}</Badge>
                    <span>{{ trans(rules.device_available ? 'spots.signal.device_rule' : 'spots.signal.device_off') }}</span>
                </li>
            </ul>
            <p v-if="!mayRemove" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-62.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('spots.view_only') }}</p>
        </div>

        <DataTable
            id="spots"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'bulkResult', 'anySpots']"
            :caption="trans('spots.caption')"
            :empty-title="trans('spots.empty_title')"
            :empty-body="emptyBody"
            :selectable="mayRemove"
            :bulk-actions="bulkActions"
            :row-href="(row) => spotHref(row.id)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-62.table"
            @bulk="(_action, ids) => openRemove(ids)"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('spots.filters.label')" @submit.prevent="apply(applied())">
                    <div class="min-w-240 grow basis-0">
                        <Field :label="trans('spots.filters.period')"><DateRangeField v-model:from="filters.from" v-model:to="filters.to" size="sm" test-id="ADM-62.filter.period" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('spots.filters.city')"><Input v-model="filters.city" size="sm" maxlength="80" :placeholder="trans('spots.filters.city_placeholder')" data-testid="ADM-62.filter.city" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('spots.filters.car')"><Input v-model="filters.car" size="sm" maxlength="80" :placeholder="trans('spots.filters.car_placeholder')" data-testid="ADM-62.filter.car" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('spots.filters.spotter')"><Input v-model="filters.spotter" size="sm" maxlength="40" :placeholder="trans('spots.filters.spotter_placeholder')" data-testid="ADM-62.filter.spotter" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('spots.filters.signal')"><Select v-model="signalModel" :options="signalOptions" size="sm" :placeholder="trans('spots.filters.any')" data-testid="ADM-62.filter.signal" /></Field>
                    </div>
                    <div class="min-w-120 grow basis-0">
                        <Field :label="trans('spots.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('spots.status.active')" data-testid="ADM-62.filter.status" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-62.filter.apply">{{ trans('spots.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-spotted_at="{ row }">
                <Link :href="spotHref(row.id)" :class="[focusRing, 'flex min-h-32 flex-col justify-center rounded-xs hover:underline']" data-testid="ADM-62.open">
                    <time :datetime="row.spotted_at ?? undefined" class="whitespace-nowrap text-ink tabular-nums">{{ formatDateTime(row.spotted_at) }}</time>
                    <span v-if="captionOf(row)" class="flex items-center gap-4 whitespace-nowrap text-caption text-ink-3" data-testid="ADM-62.caption">
                        <PhMoonStars v-if="row.night" :size="16" aria-hidden="true" />{{ captionOf(row) }}
                    </span>
                </Link>
            </template>
            <template #cell-spotter="{ row }">
                <Link v-if="hasRoute('admin.members.show')" :href="memberHref(row.spotter.id)" :class="[focusRing, 'sc-key flex min-h-32 min-w-0 items-center rounded-xs text-ink hover:underline']"><span class="truncate">{{ `@${row.spotter.username ?? '–'}` }}</span></Link>
                <span v-else class="sc-key block truncate text-ink">{{ `@${row.spotter.username ?? '–'}` }}</span>
            </template>
            <template #cell-car="{ row }">
                <span class="flex min-w-0 items-center gap-12">
                    <VehicleThumb :src="row.vehicle.cover" :focus="row.vehicle.cover_focus" :placeholder="row.vehicle.cover_placeholder" />
                    <NameCell :name="row.vehicle.title" :caption="dexLabel(row.vehicle.dex_number)" />
                </span>
            </template>
            <template #cell-city="{ row }">
                <span class="block whitespace-nowrap" :class="row.city ? 'text-ink' : 'text-ink-3'">{{ row.city ?? trans('spots.no_city') }}</span>
            </template>
            <template #cell-counted="{ row }">
                <span class="block whitespace-nowrap" :class="row.counted ? 'text-ink-2' : 'text-warning'">{{ trans(row.counted ? 'spots.yes' : 'spots.no') }}</span>
            </template>
            <template #cell-night="{ row }">
                <span v-if="row.night" class="flex items-center gap-4 text-ink-2"><PhMoonStars :size="16" aria-hidden="true" />{{ trans('spots.yes') }}</span>
                <span v-else class="text-ink-3">{{ trans('spots.no') }}</span>
            </template>
            <template #cell-source="{ row }">
                <span class="text-ink-2">{{ trans(`spots.source.${row.source}`) }}</span>
            </template>
            <template #cell-signals="{ row }">
                <span v-if="activeSignals(row.signals).length > 0" class="flex items-center gap-4 whitespace-nowrap" data-testid="ADM-62.signals">
                    <Tooltip v-for="key in activeSignals(row.signals)" :key="key" :content="signalDetail(key, row.signals, rules)">
                        <span tabindex="0" :class="[focusRing, 'inline-flex min-h-32 items-center rounded-xs']" :aria-label="`${trans(`spots.signal.${key}`)}: ${signalDetail(key, row.signals, rules)}`" :data-testid="`ADM-62.signal.${key}`">
                            <Badge tone="warning">{{ trans(`spots.signal.${key}`) }}</Badge>
                        </span>
                    </Tooltip>
                </span>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-actions="{ row }">
                <IconButton
                    v-if="!row.removed_at"
                    :icon="PhTrash"
                    size="sm"
                    :label="trans('spots.actions.remove')"
                    :data-testid="'ADM-62.remove'"
                    @click="openRemove([row.id])"
                />
            </template>
        </DataTable>

        <RemoveSpotDialog
            v-model:open="removeOpen"
            :count="target.length"
            :max="bulkMax ?? 50"
            :processing="action.processing.value"
            :error="errorText(action.error.value ?? undefined)"
            test-id="ADM-62.remove-dialog"
            @confirm="confirmRemove"
        />
        <BulkResultPanel
            v-if="bulkResult"
            v-model:open="resultOpen"
            :results="bulkResult.rows"
            :title="trans('spots.bulk.result')"
            :label="labelOf"
            :reason="(code: string | null) => trans(`spots.bulk.codes.${code ?? 'failed'}`)"
            test-id="ADM-62.bulk-result"
        />
    </div>
</template>
