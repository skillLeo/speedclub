<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhFunnel, PhUsersThree } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Field, Input, Select, StatusPill } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { hasRoute, routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import { showUrl, stateLabel, stateTone, type CrewRow } from './shared';

/**
 * ADM-80 Crews (R4-2.3, contract-crews.md §8): every crew, deleted ones included. Search by name or slug, status filter (aktiv ·
 * ausgeblendet · vom Team gelöscht · vom Gründer gelöscht), sorted by newest or name, never by size. The member count is a plain fact
 * for staff. A row opens ADM-81. moderation.decide (the atom of the crew Staff actions) for the whole module.
 */
const props = defineProps<{ rows: Paginated<CrewRow>; query: TableQuery; views: SavedView[] }>();

const state = usePageState();

const columns = computed<TableColumn[]>(() => [
    { key: 'logo', label: trans('crews.columns.logo'), srOnlyLabel: true },
    { key: 'name', label: trans('crews.columns.name'), sort: 'name', grow: true, min: 200, hideable: false },
    // R4DQ-22: the status right after the crew, so it never needs a sideways scroll at 1280; the join mode sits in the name line.
    { key: 'state', label: trans('crews.columns.state') },
    { key: 'founder', label: trans('crews.columns.founder'), min: 120 },
    { key: 'bundesland', label: trans('crews.columns.bundesland') },
    { key: 'members', label: trans('crews.columns.members'), numeric: true },
    { key: 'created_at', label: trans('crews.columns.created'), sort: 'created_at', min: 96 },
]);

const presets: PresetView[] = [
    { key: 'hidden', name: 'crews.presets.hidden', query: { filter: { status: 'hidden' } } },
    { key: 'removed', name: 'crews.presets.removed', query: { filter: { status: 'removed' } } },
];

// ---- filters --------------------------------------------------------------------------------------------------------------
const KEYS = ['q', 'status'] as const;
type Key = (typeof KEYS)[number];
const filters = reactive<Record<Key, string>>({ q: '', status: '' });
watch(
    () => props.query.filter,
    (filter) => KEYS.forEach((key) => (filters[key] = filter[key] ?? '')),
    { immediate: true },
);
const ANY = '*';
const statusModel = computed({
    get: () => (filters.status === '' ? undefined : filters.status),
    set: (value: string | undefined) => (filters.status = value === undefined || value === ANY ? '' : value),
});
const statusOptions = computed(() => [
    { value: ANY, label: trans('crews.filters.any') },
    ...(['active', 'hidden', 'removed', 'deleted', 'ended'] as const).map((value) => ({ value, label: stateLabel(value) })),
]);

const memberHref = (id: string): string | null => (hasRoute('admin.members.show') ? routeOr('admin.members.show', `/admin/members/${id}`, { member: id }) : null);
const rowHref = (row: CrewRow): string => showUrl(row.id);
const joinModeLabel = (row: CrewRow): string => trans(`crews.join_modes.${row.join_mode}`);
</script>

<template>
    <Head :title="trans('crews.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-80" :data-qa-state="state">
        <PageHeader :title="trans('crews.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('crews.intro')" />

        <DataTable
            id="crews"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('crews.caption')"
            :empty-title="trans('crews.empty_title')"
            :empty-body="trans('crews.empty_body')"
            :row-href="rowHref"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-80.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('crews.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0">
                        <Field :label="trans('crews.filters.q')">
                            <Input v-model="filters.q" size="sm" maxlength="60" :placeholder="trans('crews.filters.q_placeholder')" data-testid="ADM-80.filter.q" />
                        </Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('crews.filters.status')">
                            <Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('crews.filters.any')" data-testid="ADM-80.filter.status" />
                        </Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-80.filter.apply">{{ trans('crews.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-logo="{ row }">
                <img v-if="row.logo" :src="row.logo" alt="" class="size-32 rounded-sm object-cover" />
                <span v-else class="flex size-32 items-center justify-center rounded-sm border border-line-subtle text-ink-3" aria-hidden="true"><PhUsersThree :size="16" /></span>
            </template>
            <template #cell-name="{ row }">
                <span class="flex min-w-0 items-center gap-8">
                    <!-- R4DQ-22: line 2 is the join mode; the slug joins it from 1440 only (the title keeps it at every width). -->
                    <Link :href="rowHref(row)" :title="`${row.name} · ${joinModeLabel(row)} · /crews/${row.slug}`" :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']" data-testid="ADM-80.open">
                        <span class="line-clamp-2 text-admin-base text-ink group-hover/name:underline">{{ row.name }}</span>
                        <span class="truncate text-caption text-ink-3">
                            <span data-testid="ADM-80.joinMode">{{ joinModeLabel(row) }}</span>
                            <span class="hidden wide:inline">{{ ` · /crews/${row.slug}` }}</span>
                        </span>
                    </Link>
                    <Badge v-if="row.is_sample">{{ trans('crews.sample') }}</Badge>
                </span>
            </template>
            <template #cell-founder="{ row }">
                <component :is="memberHref(row.founder.id) ? Link : 'span'" v-if="row.founder" :href="memberHref(row.founder.id) ?? undefined" :class="[focusRing, 'sc-key flex h-32 min-w-0 items-center rounded-xs text-ink-2 hover:text-ink hover:underline']">
                    <span class="truncate">{{ row.founder.username ? `@${row.founder.username}` : '–' }}</span>
                </component>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-bundesland="{ row }">
                <span :class="row.bundesland ? 'text-ink-2' : 'text-ink-3'">{{ row.bundesland ?? '–' }}</span>
            </template>
            <template #cell-members="{ row }">
                <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.members) }}</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" :title="formatDateTime(row.created_at)" class="block truncate text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</time>
            </template>
            <template #cell-state="{ row }">
                <StatusPill :tone="stateTone[row.state]" :label="stateLabel(row.state)" data-testid="ADM-80.state" />
            </template>
        </DataTable>
    </div>
</template>
