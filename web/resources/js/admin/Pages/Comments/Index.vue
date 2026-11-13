<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhChatCircleText, PhFunnel, PhToggleLeft } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Field, Input, Select, StatusPill, type SelectOption, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDateTime, formatNumber } from '../../lib/format';
import { hasRoute, routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import { caseHref, memberHref } from '../Moderation/shared';

/**
 * ADM-60 Kommentare (09 §8.5, §10.3; M4.17): every comment under build updates, newest first, with author, reply or not, the build, its
 * open report case and status. Read-only: a comment is taken down through its DSA case on ADM-21, so a reported row links its case.
 * The `build_comments` flag is off at launch: the line above the table says whether members can comment and, for flags.manage, opens
 * the flag. moderation.view.
 */
type Status = 'visible' | 'removed' | 'deleted';
interface CommentRow {
    id: string;
    body: string;
    author: { id: string; username: string | null };
    reply: boolean;
    vehicle_id: string | null;
    status: Status;
    case_id: string | null;
    open_cases: number;
    created_at: string | null;
}
const props = defineProps<{ rows: Paginated<CommentRow>; query: TableQuery; views: SavedView[]; flag?: { enabled: boolean; canManage: boolean } }>();

const state = usePageState();
const tones: Record<Status, Tone> = { visible: 'success', removed: 'danger', deleted: 'neutral' };

const columns = computed<TableColumn[]>(() => [
    { key: 'body', label: trans('comments.columns.comment'), grow: true, min: 320, hideable: false, wrap: true },
    { key: 'author', label: trans('comments.columns.author'), min: 160 },
    { key: 'build', label: trans('comments.columns.build'), min: 120 },
    { key: 'case', label: trans('comments.columns.case'), min: 120 },
    { key: 'created_at', label: trans('comments.columns.created'), sort: 'created_at', min: 150 },
    { key: 'status', label: trans('comments.columns.status'), min: 120 },
]);
const presets: PresetView[] = [
    { key: 'reported', name: 'comments.presets.reported', query: { filter: { reported: '1' } } },
    { key: 'removed', name: 'comments.presets.removed', query: { filter: { status: 'removed' } } },
];

const filters = reactive({ q: '', status: '', reported: '' });
watch(
    () => props.query.filter,
    (filter) => Object.assign(filters, { q: filter.q ?? '', status: filter.status ?? '', reported: filter.reported ?? '' }),
    { immediate: true },
);
const ANY = '*';
const statusModel = computed({ get: () => filters.status || undefined, set: (v: string | undefined) => (filters.status = v === undefined || v === ANY ? '' : v) });
const reportedModel = computed({ get: () => filters.reported || undefined, set: (v: string | undefined) => (filters.reported = v === undefined || v === ANY ? '' : v) });
const statusOptions = computed<SelectOption[]>(() => [{ value: ANY, label: trans('comments.filters.any') }, ...(['visible', 'removed', 'deleted'] as const).map((v) => ({ value: v, label: trans(`comments.status.${v}`) }))]);
const reportedOptions = computed<SelectOption[]>(() => [
    { value: ANY, label: trans('comments.filters.any') },
    { value: '1', label: trans('comments.filters.reported_only') },
]);

const flagHref = computed(() => (props.flag?.canManage && hasRoute('admin.config.flags') ? `${routeOr('admin.config.flags', '/admin/config/flags')}?flag=build_comments` : null));
const vehicleHref = (id: string): string => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });
</script>

<template>
    <Head :title="trans('comments.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-60" :data-qa-state="state">
        <PageHeader :title="trans('comments.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('comments.intro')" />

        <p v-if="flag" class="flex min-h-32 flex-wrap items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-60.flag">
            <PhToggleLeft :size="16" class="shrink-0" aria-hidden="true" />
            <span>{{ trans(flag.enabled ? 'comments.flag.on' : 'comments.flag.off') }}</span>
            <Link v-if="flagHref" :href="flagHref" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']">
                {{ trans('comments.flag.open') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
            </Link>
        </p>

        <DataTable
            id="comments"
            row-keys
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :caption="trans('comments.caption')"
            :empty-title="trans('comments.empty_title')"
            :empty-body="trans(flag?.enabled ? 'comments.empty_body_on' : 'comments.empty_body_off')"
            :row-href="(row) => (row.case_id ? caseHref(row.case_id) : null)"
            :force-state="state === 'loading' || state === 'error' || state === 'empty' ? state : undefined"
            test-id="ADM-60.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('comments.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0">
                        <Field :label="trans('comments.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('comments.filters.q_placeholder')" data-testid="ADM-60.filter.q" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('comments.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('comments.filters.any')" data-testid="ADM-60.filter.status" /></Field>
                    </div>
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('comments.filters.reported')"><Select v-model="reportedModel" :options="reportedOptions" size="sm" :placeholder="trans('comments.filters.any')" data-testid="ADM-60.filter.reported" /></Field>
                    </div>
                    <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0">{{ trans('comments.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-body="{ row }">
                <span class="flex min-w-0 flex-col gap-2 py-4">
                    <span class="line-clamp-2 whitespace-pre-line text-admin-base" :class="row.status === 'visible' ? 'text-ink' : 'text-ink-3'">{{ row.body }}</span>
                    <span v-if="row.reply" class="flex items-center gap-4 text-caption text-ink-3"><PhChatCircleText :size="16" aria-hidden="true" />{{ trans('comments.reply') }}</span>
                </span>
            </template>
            <template #cell-author="{ row }">
                <Link v-if="hasRoute('admin.members.show')" :href="memberHref(row.author.id)" :class="[focusRing, 'sc-key block truncate rounded-xs text-ink hover:underline']">{{ `@${row.author.username ?? '–'}` }}</Link>
                <span v-else class="sc-key block truncate text-ink">{{ `@${row.author.username ?? '–'}` }}</span>
            </template>
            <template #cell-build="{ row }">
                <Link v-if="row.vehicle_id && hasRoute('admin.vehicles.show')" :href="vehicleHref(row.vehicle_id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-ink hover:underline']">
                    {{ trans('comments.open_build') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                </Link>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-case="{ row }">
                <Link v-if="row.case_id" :href="caseHref(row.case_id)" :class="[focusRing, 'inline-flex min-h-32 items-center rounded-xs text-ink hover:underline']" data-testid="ADM-60.case">
                    <Badge tone="warning" tnum>{{ trans('comments.reports', { count: formatNumber(row.open_cases) }) }}</Badge>
                </Link>
                <span v-else class="text-ink-3">–</span>
            </template>
            <template #cell-created_at="{ row }">
                <time :datetime="row.created_at ?? undefined" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDateTime(row.created_at) }}</time>
            </template>
            <template #cell-status="{ row }">
                <StatusPill :tone="tones[row.status]" :label="trans(`comments.status.${row.status}`)" />
            </template>
        </DataTable>
    </div>
</template>
