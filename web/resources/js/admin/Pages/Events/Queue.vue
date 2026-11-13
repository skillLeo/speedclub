<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowSquareOut, PhArrowsClockwise, PhCalendarDots, PhCheck, PhFunnel, PhLockSimple, PhX } from '@phosphor-icons/vue';
import { useMediaQuery } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Field, Input, Select, Skeleton, StatusPill, Tabs, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { motionOff } from '../../lib/qa';
import type { Paginated, SavedView, TableQuery } from '../../types/table';
import EventDetails from './Partials/EventDetails.vue';
import { eventHref, organiserCaption, overdue, queueUrl, statusLabel, statusTones, useEventWrites, waitingText, type DecidedEvent, type EventDetail, type EventRow } from './shared';

/**
 * ADM-53 Treffen-Queue (09 §10.2 SplitQueue, §10.3; ADR-437/439): In Prüfung (oldest first, SLA timer) · Veröffentlicht · Abgelehnt ·
 * Abgesagt · Alle. From 1280 px an event opens in the right pane (`?event=`) with everything ADM-54 shows for the review, one-key decisions
 * (a = Freigeben, r = Ablehnen with the reason the organiser reads, j/k = next/previous, u = undo for 5 s), and auto-advance to the next
 * event. Below 1280 a row opens ADM-54. Every decision posts the version shown; a changed event shows "Inzwischen geändert" and reloads.
 * None of these decisions is on the four-eyes list (06 §2). Staff without moderation.decide see the queue read-only.
 */
type Tab = 'pending' | 'published' | 'rejected' | 'cancelled' | 'all';
const props = defineProps<{
    rows: Paginated<EventRow>;
    query: TableQuery;
    views: SavedView[];
    tab: Tab;
    counts?: { pending: number };
    canDecide: boolean;
    selected?: EventDetail | null;
    decided?: DecidedEvent | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const desktop = useMediaQuery('(min-width: 1280px)');
const mayDecide = computed(() => props.canDecide && can('moderation.decide'));

// ---- tabs, columns --------------------------------------------------------------------------------------------------------
const tabs = computed<TabItem[]>(() =>
    (['pending', 'published', 'rejected', 'cancelled', 'all'] as const).map((value) => ({
        value,
        label: trans(`events.tabs.${value}`),
        count: value === 'pending' ? (state.value === 'empty' ? 0 : (props.counts?.pending ?? null)) : null,
    })),
);
const tabModel = computed({
    get: () => props.tab,
    set: (tab: string) => router.get(queueUrl(), tab === 'pending' ? {} : { tab }, { preserveState: false }),
});

const sel = computed(() => props.selected ?? null);
// The page URL (reactive), so a pane closed or switched by a partial visit is seen at once; `sel` is null for an unknown id ("gone").
const page = usePage();
const selectedId = computed(() => sel.value?.id ?? new URLSearchParams(page.url.split('?')[1] ?? '').get('event'));
// An event named in the URL always opens the pane: beside the list from 1280 (the narrow list), under it below (200 % zoom).
const paneOpen = computed(() => selectedId.value !== null);
const split = computed(() => desktop.value && paneOpen.value);
const pending = computed(() => props.tab === 'pending');

const columns = computed<TableColumn[]>(() =>
    split.value
        ? [
              { key: 'waiting', label: trans('events.columns.waiting'), sort: 'submitted_at', numeric: true, min: 80, hideable: false },
              { key: 'event', label: trans('events.columns.event'), grow: true, hideable: false },
          ]
        : [
              { key: 'waiting', label: trans('events.columns.waiting'), sort: 'submitted_at', numeric: true, min: 80, hideable: false },
              { key: 'event', label: trans('events.columns.event'), grow: true, hideable: false },
              { key: 'starts_at', label: trans('events.columns.starts'), sort: 'starts_at', min: 120 },
              { key: 'organiser', label: trans('events.columns.organiser'), min: 160 },
              { key: 'location', label: trans('events.columns.location'), min: 120 },
              { key: 'going', label: trans('events.columns.going'), numeric: true, min: 80, defaultHidden: pending.value },
              { key: 'reports', label: trans('events.columns.reports'), numeric: true, min: 80 },
              { key: 'status', label: trans('events.columns.status'), defaultHidden: props.tab !== 'all' },
          ],
);

// ---- filters --------------------------------------------------------------------------------------------------------------
const filters = reactive({ q: '', type: '', location_visibility: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.q = filter.q ?? '';
        filters.type = filter.type ?? '';
        filters.location_visibility = filter.location_visibility ?? '';
    },
    { immediate: true },
);
const ANY = '*';
const typeModel = computed({ get: () => filters.type || undefined, set: (v: string | undefined) => (filters.type = v === undefined || v === ANY ? '' : v) });
const locationModel = computed({ get: () => filters.location_visibility || undefined, set: (v: string | undefined) => (filters.location_visibility = v === undefined || v === ANY ? '' : v) });
const typeOptions = computed(() => [{ value: ANY, label: trans('events.filters.any') }, ...(['meet', 'cruise', 'track_day', 'show'] as const).map((v) => ({ value: v, label: trans(`events.types.${v}`) }))]);
const locationOptions = computed(() => [{ value: ANY, label: trans('events.filters.any') }, ...(['public', 'after_rsvp'] as const).map((v) => ({ value: v, label: trans(`events.location.${v}`) }))]);

// ---- selection (SplitQueue) -------------------------------------------------------------------------------------------------
function paneHref(id: string): string {
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    params.set('event', id);
    return `${queueUrl()}?${params.toString()}`;
}
const rowHref = (row: EventRow): string => (desktop.value ? paneHref(row.id) : eventHref(row.id));
function select(id: string | null): void {
    const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
    if (id === null) delete params.event;
    else params.event = id;
    router.get(queueUrl(), params, { only: ['selected', 'decided'], preserveState: true, preserveScroll: true, replace: true });
}
function neighbour(step: 1 | -1): string | null {
    const list = props.rows.data;
    if (list.length === 0) return null;
    const index = list.findIndex((row) => row.id === selectedId.value);
    if (index === -1) return list[0]?.id ?? null;
    return list[index + step]?.id ?? null;
}

// ---- decisions ----------------------------------------------------------------------------------------------------------------
const writes = useEventWrites();
const rejectOpen = ref(qaDialog() === 'reject');
const lastDecided = ref<DecidedEvent | null>(null);
let undoTimer: number | undefined;
watch(
    () => props.decided,
    (decided) => {
        if (!decided || (decided.outcome !== 'approved' && decided.outcome !== 'rejected')) return;
        lastDecided.value = decided;
        window.clearTimeout(undoTimer);
        undoTimer = window.setTimeout(() => (lastDecided.value = null), 5000);
    },
    { immediate: true },
);

/** After a decision in the pending queue, the next event (or the one before the last) opens: auto-advance. */
function advanceFrom(id: string): () => void {
    const list = props.rows.data;
    const index = list.findIndex((row) => row.id === id);
    const next = list[index + 1]?.id ?? list[index - 1]?.id ?? null;
    return () => {
        if (pending.value) select(next);
    };
}
function approve(): void {
    if (!sel.value?.can.approve || !mayDecide.value || writes.processing.value) return;
    writes.post(sel.value, 'approve', {}, advanceFrom(sel.value.id));
}
function reject(reason: string | null): void {
    if (!sel.value) return;
    const advance = advanceFrom(sel.value.id);
    writes.post(sel.value, 'reject', { reason }, () => {
        rejectOpen.value = false;
        advance();
    });
}
function undo(): void {
    const decided = lastDecided.value;
    if (!decided || writes.processing.value) return;
    writes.post({ id: decided.id, version: decided.version }, 'reopen', {}, () => {
        lastDecided.value = null;
        select(decided.id);
    });
}
// A refused reject shows its message in the dialog; a conflict closes it, the pane says what happened.
watch(writes.conflict, (conflict) => {
    if (conflict) rejectOpen.value = false;
});

// ---- keyboard: j/k/a/r/u (09 §10.2), never while typing or with a dialog open --------------------------------------------------
function onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !desktop.value) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'j' || key === 'k') {
        const id = neighbour(key === 'j' ? 1 : -1);
        if (id !== null) select(id);
    } else if (key === 'a') approve();
    else if (key === 'r' && sel.value?.can.reject && mayDecide.value) rejectOpen.value = true;
    else if (key === 'u') undo();
    else return;
    event.preventDefault();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    window.clearTimeout(undoTimer);
});

const paneState = computed(() => (state.value === 'loading' ? 'loading' : state.value === 'error' ? 'error' : 'ready'));
const forcedTable = computed(() => (state.value === 'loading' || state.value === 'error' || state.value === 'empty' ? state.value : undefined));
const caption = (row: EventRow): string =>
    [trans(`events.types.${row.type}`), row.city, split.value ? formatDate(row.starts_at) : null, split.value && row.organiser.username ? `@${row.organiser.username}` : null, row.is_sample ? trans('events.detail.sample') : null]
        .filter(Boolean)
        .join(' · ');
</script>

<template>
    <Head :title="trans('events.queue_title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-53" :data-qa-state="state">
        <PageHeader :title="trans('events.title')" :crumbs="[{ label: trans('shell.groups.vehicles_media') }]" :description="trans('events.intro')" />

        <div class="flex flex-col gap-12">
            <Tabs v-model="tabModel" :items="tabs" :label="trans('events.tabs.label')" :panels="false" data-testid="ADM-53.tabs" />
            <p v-if="!mayDecide" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-53.view-only">
                <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('events.view_only') }}
            </p>
            <p v-else-if="desktop && !paneOpen && state === 'ready' && rows.data.length > 0" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-53.none">
                <PhCalendarDots :size="16" class="shrink-0" aria-hidden="true" />{{ trans('events.pane.select_body') }}
            </p>
        </div>

        <div class="flex flex-col gap-24 desktop:flex-row desktop:items-start">
            <div class="min-w-0" :class="split ? 'desktop:w-400 desktop:shrink-0 wide:w-480' : 'grow'">
                <DataTable
                    :id="`events-${tab}`"
                    :key="`${tab}-${split ? 'split' : 'full'}`"
                    :narrow="split"
                    :columns="columns"
                    :rows="rows"
                    :query="query"
                    :views="views"
                    :only="['rows', 'query', 'views', 'counts']"
                    :caption="trans('events.caption')"
                    :empty-title="trans(`events.empty.${tab}_title`)"
                    :empty-body="trans(`events.empty.${tab}_body`)"
                    :row-href="rowHref"
                    :force-state="forcedTable"
                    test-id="ADM-53.table"
                >
                    <template #filters="{ apply, loading }">
                        <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('events.filters.label')" @submit.prevent="apply({ ...filters })">
                            <div class="min-w-200 grow-2 basis-0">
                                <Field :label="trans('events.filters.q')">
                                    <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('events.filters.q_placeholder')" data-testid="ADM-53.filter.q" />
                                </Field>
                            </div>
                            <div class="min-w-140 grow basis-0">
                                <Field :label="trans('events.filters.type')"><Select v-model="typeModel" :options="typeOptions" size="sm" :placeholder="trans('events.filters.any')" data-testid="ADM-53.filter.type" /></Field>
                            </div>
                            <div class="min-w-140 grow basis-0">
                                <Field :label="trans('events.filters.location')"><Select v-model="locationModel" :options="locationOptions" size="sm" :placeholder="trans('events.filters.any')" data-testid="ADM-53.filter.location" /></Field>
                            </div>
                            <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-53.filter.apply">{{ trans('events.filters.apply') }}</Button>
                        </form>
                    </template>

                    <template #cell-waiting="{ row }">
                        <span v-if="row.waiting_minutes !== null" class="block whitespace-nowrap text-right tabular-nums" :class="overdue(row.waiting_minutes) ? 'text-warning' : 'text-ink'" :title="trans('events.waiting.label', { date: formatDateTime(row.submitted_at) })">
                            {{ waitingText(row.waiting_minutes) }}
                        </span>
                        <span v-else class="block text-right text-ink-3">–</span>
                    </template>
                    <template #cell-event="{ row }">
                        <Link
                            :href="rowHref(row)"
                            :aria-current="row.id === selectedId ? 'true' : undefined"
                            :title="`${row.title} · ${caption(row)}`"
                            :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']"
                            data-testid="ADM-53.open"
                        >
                            <span class="line-clamp-2 text-admin-base group-hover/name:underline" :class="row.id === selectedId ? 'text-admin-base-strong text-ink' : 'text-ink'">{{ row.title }}</span>
                            <span class="truncate text-caption text-ink-3 tabular-nums">{{ caption(row) }}</span>
                        </Link>
                    </template>
                    <template #cell-starts_at="{ row }">
                        <time :datetime="row.starts_at ?? undefined" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDateTime(row.starts_at) }}</time>
                    </template>
                    <template #cell-organiser="{ row }">
                        <span class="flex min-w-0 flex-col">
                            <span class="sc-key truncate text-admin-base text-ink">{{ `@${row.organiser.username ?? '–'}` }}</span>
                            <span class="truncate text-caption text-ink-3 tabular-nums">{{ organiserCaption(row) }}</span>
                        </span>
                    </template>
                    <template #cell-location="{ row }">
                        <span class="flex items-center gap-4 whitespace-nowrap text-ink-2">
                            <PhLockSimple v-if="row.location_visibility === 'after_rsvp'" :size="16" class="shrink-0" aria-hidden="true" />{{ trans(`events.location.${row.location_visibility}`) }}
                        </span>
                    </template>
                    <template #cell-going="{ row }">
                        <span class="block text-right text-ink tabular-nums">{{ formatNumber(row.going) }}</span>
                    </template>
                    <template #cell-reports="{ row }">
                        <span class="block text-right tabular-nums" :class="row.open_reports > 0 ? 'text-ink' : 'text-ink-3'">{{ formatNumber(row.open_reports) }}</span>
                    </template>
                    <template #cell-status="{ row }">
                        <StatusPill :tone="statusTones[row.status]" :label="statusLabel(row)" />
                    </template>
                </DataTable>
            </div>

            <!-- The SplitQueue pane: beside the list from 1280 px, under it below. -->
            <section
                v-if="paneOpen"
                class="flex min-w-0 grow flex-col gap-20 rounded-sm border border-line-subtle bg-surface px-20 py-20"
                :aria-label="trans('events.pane.label')"
                :aria-busy="paneState === 'loading' || undefined"
                data-testid="ADM-53.pane"
            >
                <div v-if="paneState === 'loading'" class="flex flex-col gap-16" aria-hidden="true" data-testid="ADM-53.pane.loading">
                    <Skeleton shape="text" class="h-24 w-320" />
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="aspect-video w-full max-w-480" />
                    <Skeleton shape="text" class="w-full" />
                    <Skeleton shape="text" class="w-3/4" />
                </div>
                <StateBlock v-else-if="paneState === 'error'" kind="error" :title="trans('events.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-53.pane.error" @retry="writes.reload(['selected'])" />
                <StateBlock v-else-if="sel === null" kind="partial" :title="trans('events.pane.gone')" :retryable="false" test-id="ADM-53.pane.gone">
                    <div class="mt-8"><Button size="sm" variant="secondary" :icon="PhX" @click="select(null)">{{ trans('ui.actions.close') }}</Button></div>
                </StateBlock>
                <template v-else>
                    <header class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="text-headline text-ink" data-testid="ADM-53.pane.title">{{ sel.title }}</h2>
                            <p class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums">
                                <StatusPill :tone="statusTones[sel.status]" :label="statusLabel(sel)" data-testid="ADM-53.pane.status" />
                                <span>{{ trans(`events.types.${sel.type}`) }}</span>
                                <span v-if="sel.waiting_minutes !== null" :class="overdue(sel.waiting_minutes) ? 'text-warning' : ''">{{ trans('events.waiting.label', { date: formatDateTime(sel.submitted_at) }) }}</span>
                                <Badge v-if="sel.is_sample" tone="neutral">{{ trans('events.detail.sample') }}</Badge>
                                <Badge v-if="sel.open_reports > 0" tone="warning" tnum>{{ trans('events.detail.reports') }} {{ formatNumber(sel.open_reports) }}</Badge>
                            </p>
                        </div>
                        <Link :href="eventHref(sel.id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']" data-testid="ADM-53.pane.open">
                            {{ trans('events.pane.open') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                        </Link>
                    </header>

                    <StateBlock v-if="writes.conflict.value" kind="partial" :title="trans('events.conflict.title')" :body="trans('events.conflict.changed')" :retryable="false" test-id="ADM-53.conflict">
                        <div class="mt-8">
                            <Button size="sm" variant="secondary" :icon="PhArrowsClockwise" data-testid="ADM-53.conflict.reload" @click="writes.reload(['selected', 'rows', 'counts'])">{{ trans('events.actions.reload') }}</Button>
                        </div>
                    </StateBlock>
                    <p v-else-if="writes.error.value" class="text-admin-base text-danger" role="alert" data-testid="ADM-53.pane.error-text">{{ writes.error.value }}</p>

                    <div v-if="mayDecide && (sel.can.approve || sel.can.reject)" class="flex flex-wrap items-center gap-8 border-y border-line-subtle py-12" data-testid="ADM-53.actions">
                        <Button v-if="sel.can.approve" size="sm" variant="primary" :icon="PhCheck" :loading="writes.processing.value === 'approve'" :disabled="writes.processing.value !== null || writes.conflict.value" aria-keyshortcuts="a" data-testid="ADM-53.approve" @click="approve()">
                            {{ trans('events.actions.approve') }}
                        </Button>
                        <Button v-if="sel.can.reject" size="sm" variant="destructive" :icon="PhX" :disabled="writes.processing.value !== null || writes.conflict.value" aria-keyshortcuts="r" data-testid="ADM-53.reject" @click="rejectOpen = true">
                            {{ trans('events.actions.reject') }}
                        </Button>
                        <p class="ml-auto text-caption text-ink-3">{{ trans('events.keys') }}</p>
                    </div>

                    <EventDetails :key="sel.id" :event="sel" compact test-id="ADM-53.detail" />
                </template>
            </section>
        </div>

        <!-- 5-s undo of the last decision (09 §10.2): reopen with the version the decision returned. -->
        <div
            v-if="lastDecided"
            class="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-12 rounded-sm border border-line bg-raised px-16 py-8 shadow-e2"
            :class="motionOff() ? '' : 'transition-opacity duration-effect-default ease-effect-default'"
            role="status"
            data-testid="ADM-53.undo"
        >
            <span class="text-admin-base text-ink">{{ trans(`events.undo.${lastDecided.outcome}`, { title: lastDecided.title }) }}</span>
            <Button size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :loading="writes.processing.value === 'reopen'" aria-keyshortcuts="u" data-testid="ADM-53.undo.button" @click="undo()">
                {{ trans('events.actions.undo') }}
            </Button>
        </div>

        <ConfirmDialog
            v-if="sel"
            v-model:open="rejectOpen"
            :title="trans('events.reject_dialog.title', { title: sel.title })"
            :body="trans('events.reject_dialog.body')"
            :confirm-label="trans('events.actions.reject')"
            :reason-label="trans('events.reject_dialog.reason')"
            reason
            reason-first
            :processing="writes.processing.value === 'reject'"
            :error="writes.error.value"
            test-id="ADM-53.reject-dialog"
            @confirm="reject"
        />
    </div>
</template>
