<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhChatsTeardrop, PhCheckCircle, PhFunnel, PhLockSimple, PhPushPin, PhTreeStructure, PhX } from '@phosphor-icons/vue';
import { useMediaQuery } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Combobox, ConfirmDialog, Field, Input, Select, Skeleton, StatusPill, Tabs, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { useSplitQueue } from '../../composables/splitQueue';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute } from '../../lib/routes';
import type { Paginated, SavedView, TableQuery } from '../../types/table';
import ThreadPane from './Partials/ThreadPane.vue';
import {
    caseHref,
    caseTones,
    categoriesUrl,
    categoryLabel,
    categoryOptions,
    minutesSince,
    overdue,
    queueUrl,
    threadTones,
    useForumDecisions,
    waitingText,
    type CategoryOption,
    type DecidedPost,
    type ForumPostItem,
    type ForumSelected,
    type ForumTab,
    type PendingRow,
    type ReportedRow,
    type ThreadRow,
} from './shared';

/**
 * ADM-68 Forum-Moderation (10 §7.3, 09 §10.2 SplitQueue, m5.8-contract §6): Vormoderation (posts of accounts younger than 3 days or
 * without a verified address, oldest first: the SLA order) · Gemeldet (open DSA cases of forum posts, keyword hits of ADM-23 included;
 * decided on ADM-21) · Themen (every thread, filters) · Entfernt. From 1280 px a row opens its thread in the right pane (`?item=` the
 * post, `?thread=` the thread) with one-key decisions (a = Freigeben, r = Ablehnen with the reason the author reads, j/k) and the auto-
 * advance to the next post; a pre-moderation decision is final (no undo route). Below 1280 the pane stacks under the list. Every write
 * posts the version shown (ADR-439) and needs a recent password (⚿). None is four-eyes (06 §2). Staff without moderation.decide read only.
 */
type Row = PendingRow | ReportedRow | ThreadRow;
const props = defineProps<{
    rows: Paginated<Row>;
    query: TableQuery;
    views: SavedView[];
    tab: ForumTab;
    counts?: { pending: number; reported: number };
    canDecide: boolean;
    canBan: boolean;
    canManageCategories: boolean;
    categories?: CategoryOption[];
    selected?: ForumSelected | null;
    decided?: DecidedPost | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const desktop = useMediaQuery('(min-width: 1280px)');
const mayDecide = computed(() => props.canDecide && can('moderation.decide'));
const mayBan = computed(() => props.canBan && can('members.restrict'));
const categories = computed(() => props.categories ?? []);

const asPending = (row: Row): PendingRow => row as PendingRow;
const asReported = (row: Row): ReportedRow => row as ReportedRow;
const asThread = (row: Row): ThreadRow => row as ThreadRow;

// ---- tabs ------------------------------------------------------------------------------------------------------------------
const tabs = computed<TabItem[]>(() =>
    (['pending', 'reported', 'threads', 'removed'] as const).map((value) => ({
        value,
        label: trans(`forum.tabs.${value}`),
        count: value === 'pending' || value === 'reported' ? (state.value === 'empty' ? 0 : (props.counts?.[value] ?? null)) : null,
    })),
);
const tabModel = computed({
    get: () => props.tab,
    set: (tab: string) => router.get(queueUrl(), tab === 'pending' ? {} : { tab }, { preserveState: false }),
});
const pending = computed(() => props.tab === 'pending');
const reported = computed(() => props.tab === 'reported');
const threadTab = computed(() => props.tab === 'threads' || props.tab === 'removed');

// ---- SplitQueue: the item param is the post (pending, reported) or the thread (threads, removed) ----------------------------------
const param = computed(() => (threadTab.value ? 'thread' : 'item'));
const rowId = (row: Row): string => (reported.value ? asReported(row).post_id : (row as PendingRow | ThreadRow).id);
const queueRows = computed(() => props.rows.data.map((row) => ({ id: rowId(row) })));
const sel = computed(() => props.selected ?? null);

const decisions = useForumDecisions();
const rejectOpen = ref(false);
const rejectTarget = ref<ForumPostItem | null>(null);

/** The pending post the keys decide: the opened item when it waits, else the first waiting post of the thread. */
const focusPost = computed<ForumPostItem | null>(() => {
    const s = sel.value;
    if (s === null) return null;
    const waiting = s.posts.filter((p) => p.status === 'pending' && !p.deleted);
    return waiting.find((p) => p.id === s.item) ?? waiting[0] ?? null;
});

const queue = useSplitQueue<{ id: string }, DecidedPost>({
    param: param.value,
    url: queueUrl,
    rows: () => queueRows.value,
    selected: () => {
        const s = props.selected;
        if (s === undefined || s === null) return s;
        return { id: threadTab.value ? s.thread.id : (s.item ?? s.thread.id) };
    },
    decided: () => props.decided,
    undoable: [],
    advance: () => pending.value,
    enabled: desktop,
    autoSelect: () => pending.value,
    onApprove: () => {
        if (focusPost.value) approve(focusPost.value);
    },
    onReject: () => {
        if (focusPost.value) askReject(focusPost.value);
    },
    onUndo: () => undefined,
});
const { selectedId, paneOpen, split, select } = queue;
const rowHref = (row: Row): string => queue.paneHref(rowId(row));

function approve(post: ForumPostItem): void {
    if (!mayDecide.value || decisions.processing.value) return;
    decisions.post(post, 'approve', {}, queue.advanceFrom(selectedId.value ?? post.id));
}
function askReject(post: ForumPostItem): void {
    if (!mayDecide.value) return;
    rejectTarget.value = post;
    rejectOpen.value = true;
}
function reject(reason: string | null): void {
    const post = rejectTarget.value;
    if (post === null) return;
    const advance = queue.advanceFrom(selectedId.value ?? post.id);
    decisions.post(post, 'reject', { reason }, () => {
        rejectOpen.value = false;
        advance();
    });
}
watch(decisions.conflict, (conflict) => {
    if (conflict) rejectOpen.value = false;
});
// QA cell: ?dialog=reject opens the reason dialog of the focused post.
watch(
    focusPost,
    (post) => {
        if (post && qaDialog() === 'reject' && !rejectOpen.value && rejectTarget.value === null) askReject(post);
    },
    { immediate: true },
);

// ---- columns ---------------------------------------------------------------------------------------------------------------
const columns = computed<TableColumn[]>(() => {
    if (pending.value) {
        return split.value
            ? [
                  { key: 'waiting', label: trans('forum.columns.waiting'), sort: 'created_at', numeric: true, min: 80, hideable: false },
                  { key: 'post', label: trans('forum.columns.post'), grow: true, hideable: false },
              ]
            : [
                  { key: 'waiting', label: trans('forum.columns.waiting'), sort: 'created_at', numeric: true, min: 80, hideable: false },
                  { key: 'post', label: trans('forum.columns.post'), grow: true, hideable: false },
                  { key: 'author', label: trans('forum.columns.author'), min: 160 },
                  { key: 'reason', label: trans('forum.columns.reason'), min: 120 },
                  { key: 'photos', label: trans('forum.columns.photos'), numeric: true, min: 80 },
              ];
    }
    if (reported.value) {
        return split.value
            ? [
                  { key: 'priority', label: trans('forum.columns.priority'), sort: 'priority', numeric: true, min: 80, hideable: false },
                  { key: 'post', label: trans('forum.columns.post'), grow: true, hideable: false },
              ]
            : [
                  { key: 'priority', label: trans('forum.columns.priority'), sort: 'priority', numeric: true, min: 80, hideable: false },
                  { key: 'post', label: trans('forum.columns.post'), grow: true, hideable: false },
                  { key: 'reports', label: trans('forum.columns.reports'), numeric: true, min: 80 },
                  { key: 'case_status', label: trans('forum.columns.status'), min: 120 },
                  { key: 'opened_at', label: trans('forum.columns.opened'), sort: 'created_at', min: 120 },
                  { key: 'case', label: trans('forum.columns.case'), srOnlyLabel: true, hideable: false, min: 120 },
              ];
    }
    return split.value
        ? [
              { key: 'thread', label: trans('forum.columns.thread'), grow: true, hideable: false },
              { key: 'replies', label: trans('forum.columns.replies'), sort: 'replies_count', numeric: true, min: 80 },
          ]
        : [
              { key: 'thread', label: trans('forum.columns.thread'), grow: true, hideable: false },
              { key: 'author', label: trans('forum.columns.author'), min: 160 },
              { key: 'flags', label: trans('forum.columns.flags'), min: 120 },
              { key: 'status', label: trans('forum.columns.status'), min: 120, defaultHidden: props.tab === 'removed' },
              { key: 'replies', label: trans('forum.columns.replies'), sort: 'replies_count', numeric: true, min: 80 },
              { key: 'last_activity_at', label: trans('forum.columns.activity'), sort: 'last_activity_at', min: 120 },
          ];
});

// ---- filters (Themen, Entfernt) ---------------------------------------------------------------------------------------------
const ANY = '*';
const filters = reactive({ q: '', category: '', status: '', pinned: '', locked: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.q = filter.q ?? '';
        filters.category = filter.category ?? '';
        filters.status = filter.status ?? '';
        filters.pinned = filter.pinned ?? '';
        filters.locked = filter.locked ?? '';
    },
    { immediate: true },
);
const optionModel = (key: 'category' | 'status' | 'pinned' | 'locked') =>
    computed({ get: () => filters[key] || undefined, set: (v: string | undefined) => (filters[key] = v === undefined || v === ANY ? '' : v) });
const categoryModel = optionModel('category');
const statusModel = optionModel('status');
const pinnedModel = optionModel('pinned');
const lockedModel = optionModel('locked');
const anyOption = computed(() => ({ value: ANY, label: trans('forum.filters.any') }));
const categoryFilterOptions = computed(() => [anyOption.value, ...categoryOptions(categories.value)]);
const statusOptions = computed(() => [anyOption.value, ...(['published', 'pending', 'rejected', 'removed', 'merged'] as const).map((v) => ({ value: v, label: trans(`forum.status.thread.${v}`) }))]);
const yesNo = computed(() => [anyOption.value, { value: '1', label: trans('forum.filters.yes') }, { value: '0', label: trans('forum.filters.no') }]);

// ---- captions + states -------------------------------------------------------------------------------------------------------
const reasonText = (row: PendingRow): string => (row.author?.reason ? trans(`forum.reason.${row.author.reason}`) : trans('forum.reason.other'));
function pendingCaption(row: PendingRow): string {
    return [trans(`forum.kind.${row.kind}`), row.thread.category?.name ?? null, split.value && row.author ? `@${row.author.username ?? '–'}` : null, split.value ? reasonText(row) : null].filter(Boolean).join(' · ');
}
function threadCaption(row: ThreadRow): string {
    return [row.category ? categoryLabel(categories.value, row.category.id) || row.category.name : null, split.value && row.author ? `@${row.author.username ?? '–'}` : null, split.value ? formatDate(row.last_activity_at) : null, row.is_sample ? trans('forum.sample') : null]
        .filter(Boolean)
        .join(' · ');
}
function reportedCaption(row: ReportedRow): string {
    return [trans(`forum.kind.${row.kind}`), split.value ? trans('forum.reports', { count: formatNumber(row.reports) }) : null].filter(Boolean).join(' · ');
}
const suggestions = computed(() => (threadTab.value ? props.rows.data.map(asThread).filter((r) => r.status === 'published').map((r) => ({ id: r.id, title: r.title })) : []));

const paneState = computed(() => (state.value === 'loading' ? 'loading' : state.value === 'error' ? 'error' : 'ready'));
const forcedTable = computed(() => (state.value === 'loading' || state.value === 'error' || state.value === 'empty' ? state.value : undefined));
// Reported rows are keyed by their post: the pane (`?item=`) marks the row it shows.
const tableKey = computed(() => (reported.value ? 'post_id' : 'id'));
</script>

<template>
    <Head :title="trans('forum.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-68" :data-qa-state="state">
        <PageHeader :title="trans('forum.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('forum.intro')">
            <template v-if="canManageCategories && hasRoute('admin.forum.categories.index')" #actions>
                <Button size="sm" variant="secondary" :icon="PhTreeStructure" :href="categoriesUrl()" data-testid="ADM-68.categories">{{ trans('forum.categories.link') }}</Button>
            </template>
        </PageHeader>

        <div class="flex flex-col gap-12">
            <Tabs v-model="tabModel" :items="tabs" :label="trans('forum.tabs.label')" :panels="false" data-testid="ADM-68.tabs" />
            <p v-if="!mayDecide" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-68.view-only">
                <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('forum.view_only') }}
            </p>
            <p v-else-if="reported" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-68.reported-note">
                <PhChatsTeardrop :size="16" class="shrink-0" aria-hidden="true" />{{ trans('forum.reported_note') }}
            </p>
            <p v-else-if="desktop && !paneOpen && state === 'ready' && rows.data.length > 0" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-68.none">
                <PhChatsTeardrop :size="16" class="shrink-0" aria-hidden="true" />{{ trans(pending ? 'forum.pane.select_pending' : 'forum.pane.select_thread') }}
            </p>
        </div>

        <div class="flex flex-col gap-24 desktop:flex-row desktop:items-start">
            <div class="min-w-0" :class="split ? 'desktop:w-400 desktop:shrink-0 wide:w-480' : 'grow'">
                <DataTable
                    :id="`forum-${tab}`"
                    :key="`${tab}-${split ? 'split' : 'full'}`"
                    :narrow="split"
                    :columns="columns"
                    :rows="rows"
                    :row-key="tableKey"
                    :query="query"
                    :views="views"
                    :only="['rows', 'query', 'views', 'counts']"
                    :caption="trans(`forum.caption.${tab}`)"
                    :empty-title="trans(`forum.empty.${tab}_title`)"
                    :empty-body="trans(`forum.empty.${tab}_body`)"
                    :row-href="rowHref"
                    :current-row-id="split ? selectedId : null"
                    :force-state="forcedTable"
                    test-id="ADM-68.table"
                >
                    <template v-if="threadTab" #filters="{ apply, loading }">
                        <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('forum.filters.label')" @submit.prevent="apply({ ...filters })">
                            <div class="min-w-200 grow-2 basis-0">
                                <Field :label="trans('forum.filters.q')">
                                    <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('forum.filters.q_placeholder')" data-testid="ADM-68.filter.q" />
                                </Field>
                            </div>
                            <div class="min-w-200 grow basis-0">
                                <Field :label="trans('forum.filters.category')">
                                    <Combobox v-model="categoryModel" :options="categoryFilterOptions" size="sm" :placeholder="trans('forum.filters.any')" data-testid="ADM-68.filter.category" />
                                </Field>
                            </div>
                            <div v-if="tab === 'threads'" class="min-w-140 grow basis-0">
                                <Field :label="trans('forum.filters.status')"><Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('forum.filters.any')" data-testid="ADM-68.filter.status" /></Field>
                            </div>
                            <div class="min-w-120 grow basis-0">
                                <Field :label="trans('forum.filters.pinned')"><Select v-model="pinnedModel" :options="yesNo" size="sm" :placeholder="trans('forum.filters.any')" data-testid="ADM-68.filter.pinned" /></Field>
                            </div>
                            <div class="min-w-120 grow basis-0">
                                <Field :label="trans('forum.filters.locked')"><Select v-model="lockedModel" :options="yesNo" size="sm" :placeholder="trans('forum.filters.any')" data-testid="ADM-68.filter.locked" /></Field>
                            </div>
                            <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-68.filter.apply">{{ trans('forum.filters.apply') }}</Button>
                        </form>
                    </template>

                    <!-- Vormoderation -->
                    <template #cell-waiting="{ row }">
                        <span
                            class="block whitespace-nowrap text-right tabular-nums"
                            :class="overdue(minutesSince(asPending(row).created_at)) ? 'text-warning' : 'text-ink'"
                            :title="trans('forum.waiting.label', { date: formatDateTime(asPending(row).created_at) })"
                        >
                            {{ waitingText(minutesSince(asPending(row).created_at)) }}
                        </span>
                    </template>
                    <template #cell-post="{ row }">
                        <Link
                            :href="rowHref(row)"
                            :aria-current="rowId(row) === selectedId ? 'true' : undefined"
                            :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']"
                            data-testid="ADM-68.open"
                        >
                            <template v-if="pending">
                                <span class="line-clamp-2 text-admin-base group-hover/name:underline" :class="rowId(row) === selectedId ? 'text-admin-base-strong text-ink' : 'text-ink'" :title="asPending(row).thread.title">{{ asPending(row).thread.title }}</span>
                                <span v-if="asPending(row).kind === 'reply' && !split" class="line-clamp-1 text-caption text-ink-2" :title="asPending(row).excerpt">{{ asPending(row).excerpt }}</span>
                                <span class="truncate text-caption text-ink-3" :title="pendingCaption(asPending(row))">{{ pendingCaption(asPending(row)) }}</span>
                            </template>
                            <template v-else>
                                <span class="line-clamp-2 text-admin-base group-hover/name:underline" :class="rowId(row) === selectedId ? 'text-admin-base-strong text-ink' : 'text-ink'" :title="asReported(row).thread?.title ?? trans('forum.gone_thread')">{{ asReported(row).thread?.title ?? trans('forum.gone_thread') }}</span>
                                <span class="truncate text-caption text-ink-3 tabular-nums" :title="reportedCaption(asReported(row))">{{ reportedCaption(asReported(row)) }}</span>
                            </template>
                        </Link>
                    </template>
                    <template #cell-author="{ row }">
                        <span class="flex min-w-0 flex-col">
                            <span class="sc-key truncate text-admin-base text-ink" :title="(row as PendingRow | ThreadRow).author?.username ?? undefined">{{ (row as PendingRow | ThreadRow).author ? `@${(row as PendingRow | ThreadRow).author!.username ?? '–'}` : trans('forum.pane.deleted_author') }}</span>
                            <span v-if="pending && asPending(row).author" class="truncate text-caption text-ink-3 tabular-nums">{{ trans('forum.pane.joined', { date: formatDate(asPending(row).author!.joined_at) }) }}</span>
                        </span>
                    </template>
                    <template #cell-reason="{ row }">
                        <StatusPill :tone="asPending(row).author?.reason ? 'warning' : 'neutral'" :label="reasonText(asPending(row))" />
                    </template>
                    <template #cell-photos="{ row }">
                        <span class="block text-right tabular-nums" :class="asPending(row).photos_count > 0 ? 'text-ink' : 'text-ink-3'">{{ formatNumber(asPending(row).photos_count) }}</span>
                    </template>

                    <!-- Gemeldet -->
                    <template #cell-priority="{ row }">
                        <span class="block text-right text-ink tabular-nums">{{ formatNumber(asReported(row).priority) }}</span>
                    </template>
                    <template #cell-reports="{ row }">
                        <span class="block text-right text-ink tabular-nums">{{ formatNumber(asReported(row).reports) }}</span>
                    </template>
                    <template #cell-case_status="{ row }">
                        <StatusPill :tone="caseTones[asReported(row).status]" :label="trans(`forum.case_status.${asReported(row).status}`)" />
                    </template>
                    <template #cell-opened_at="{ row }">
                        <time :datetime="asReported(row).opened_at ?? undefined" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDateTime(asReported(row).opened_at) }}</time>
                    </template>
                    <template #cell-case="{ row }">
                        <Link :href="caseHref(asReported(row).case_id)" :class="[focusRing, 'inline-flex min-h-32 items-center whitespace-nowrap rounded-xs text-admin-base-strong text-ink hover:underline']" data-testid="ADM-68.case">
                            {{ trans('forum.pane.case_decide') }}
                        </Link>
                    </template>

                    <!-- Themen, Entfernt -->
                    <template #cell-thread="{ row }">
                        <Link
                            :href="rowHref(row)"
                            :aria-current="rowId(row) === selectedId ? 'true' : undefined"
                            :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']"
                            data-testid="ADM-68.open"
                        >
                            <span class="flex min-w-0 items-center gap-4">
                                <PhPushPin v-if="asThread(row).is_pinned" :size="16" class="shrink-0 text-ink-2" role="img" :aria-label="trans('forum.flags.pinned')" />
                                <span class="line-clamp-2 text-admin-base group-hover/name:underline" :class="rowId(row) === selectedId ? 'text-admin-base-strong text-ink' : 'text-ink'" :title="asThread(row).title">{{ asThread(row).title }}</span>
                            </span>
                            <span class="truncate text-caption text-ink-3 tabular-nums" :title="threadCaption(asThread(row))">{{ threadCaption(asThread(row)) }}</span>
                        </Link>
                    </template>
                    <template #cell-flags="{ row }">
                        <span class="flex flex-wrap items-center gap-4">
                            <Badge v-if="asThread(row).is_pinned"><PhPushPin :size="16" aria-hidden="true" />{{ trans('forum.flags.pinned') }}</Badge>
                            <Badge v-if="asThread(row).is_locked"><PhLockSimple :size="16" aria-hidden="true" />{{ trans('forum.flags.locked') }}</Badge>
                            <Badge v-if="asThread(row).is_solved" tone="success"><PhCheckCircle :size="16" aria-hidden="true" />{{ trans('forum.flags.solved') }}</Badge>
                            <Badge v-if="asThread(row).is_sample">{{ trans('forum.sample') }}</Badge>
                            <span v-if="!asThread(row).is_pinned && !asThread(row).is_locked && !asThread(row).is_solved && !asThread(row).is_sample" class="text-ink-3">–</span>
                        </span>
                    </template>
                    <template #cell-status="{ row }">
                        <StatusPill :tone="threadTones[asThread(row).status]" :label="trans(`forum.status.thread.${asThread(row).status}`)" />
                    </template>
                    <template #cell-replies="{ row }">
                        <span class="block text-right text-ink tabular-nums">{{ formatNumber(asThread(row).replies_count) }}</span>
                    </template>
                    <template #cell-last_activity_at="{ row }">
                        <time :datetime="asThread(row).last_activity_at ?? undefined" :title="formatDateTime(asThread(row).last_activity_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(asThread(row).last_activity_at) }}</time>
                    </template>
                </DataTable>
            </div>

            <!-- The SplitQueue pane: beside the list from 1280 px, under it below. -->
            <section
                v-if="paneOpen"
                class="flex min-w-0 grow flex-col gap-20 rounded-sm border border-line-subtle bg-surface px-20 py-20"
                :aria-label="trans('forum.pane.label')"
                :aria-busy="paneState === 'loading' || undefined"
                data-testid="ADM-68.pane"
            >
                <div v-if="paneState === 'loading'" class="flex flex-col gap-16" aria-hidden="true" data-testid="ADM-68.pane.loading">
                    <Skeleton shape="text" class="h-24 w-320" />
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="h-48 w-full" />
                    <Skeleton shape="text" class="w-full" />
                    <Skeleton shape="text" class="w-3/4" />
                    <Skeleton shape="text" class="w-full" />
                </div>
                <StateBlock v-else-if="paneState === 'error'" kind="error" :title="trans('forum.pane.error')" :body="trans('ui.state.error_body')" test-id="ADM-68.pane.error" @retry="decisions.reload(['selected'])" />
                <StateBlock v-else-if="sel === null" kind="partial" :title="trans('forum.pane.gone')" :retryable="false" test-id="ADM-68.pane.gone">
                    <div class="mt-8"><Button size="sm" variant="secondary" :icon="PhX" @click="select(null)">{{ trans('ui.actions.close') }}</Button></div>
                </StateBlock>
                <ThreadPane
                    v-else
                    :key="sel.thread.id"
                    :selected="sel"
                    :categories="categories"
                    :suggestions="suggestions"
                    :may-decide="mayDecide"
                    :may-ban="mayBan"
                    :focus-post-id="focusPost?.id ?? null"
                    :decision="{ processing: decisions.processing.value, conflict: decisions.conflict.value, error: decisions.error.value }"
                    test-id="ADM-68.pane"
                    @approve="approve"
                    @reject="askReject"
                    @reload="decisions.reload(['selected', 'rows', 'counts'])"
                    @close="select(null)"
                />
            </section>
        </div>

        <ConfirmDialog
            v-model:open="rejectOpen"
            :title="trans(rejectTarget?.is_opening ? 'forum.reject_dialog.title_thread' : 'forum.reject_dialog.title_reply', { username: rejectTarget?.author?.username ?? '–' })"
            :body="trans('forum.reject_dialog.body')"
            :confirm-label="trans('forum.actions.reject')"
            :reason-label="trans('forum.reject_dialog.reason')"
            :reason-hint="trans('forum.reject_dialog.reason_hint')"
            reason
            reason-first
            :processing="decisions.processing.value === 'reject'"
            :error="decisions.error.value"
            test-id="ADM-68.reject-dialog"
            @confirm="reject"
        />
    </div>
</template>
