<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowSquareOut, PhArrowsClockwise, PhCheck, PhFunnel, PhLockSimple, PhStorefront, PhX } from '@phosphor-icons/vue';
import { useMediaQuery } from '@vueuse/core';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import type { TableColumn } from '../../Components/data-table/table';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Field, Input, Select, Skeleton, StatusPill, Tabs, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { useSplitQueue } from '../../composables/splitQueue';
import { formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { motionOff } from '../../lib/qa';
import type { Paginated, SavedView, TableQuery } from '../../types/table';
import BusinessDetails from './Partials/BusinessDetails.vue';
import { BUSINESS_KINDS, businessHref, overdue, queueUrl, statusLabel, statusTones, useBusinessWrites, waitingText, type BusinessDetail, type BusinessRow, type DecidedBusiness } from './shared';

/**
 * ADM-55 Betriebs-Anträge (09 §8.10, §10.2 SplitQueue, §10.3; ADR-455): Anträge (oldest first, SLA timer) · Verifiziert · Abgelehnt ·
 * Gesperrt · Alle. From 1280 px a business opens in the right pane (`?business=`) with what staff check (Impressum, register,
 * document note, address, website), one-key decisions (a = Verifizieren, r = Ablehnen with the reason the applicant reads, j/k,
 * u = undo for 5 s) and auto-advance. Below 1280 a row opens ADM-56. Suspending is four-eyes and lives on ADM-56. Every decision posts
 * the version shown; a changed business shows "Inzwischen geändert". Staff without moderation.decide see the queue read-only.
 */
type Tab = 'applied' | 'verified' | 'rejected' | 'suspended' | 'all';
const props = defineProps<{
    rows: Paginated<BusinessRow>;
    query: TableQuery;
    views: SavedView[];
    tab: Tab;
    counts?: { applied: number };
    canDecide: boolean;
    selected?: BusinessDetail | null;
    decided?: DecidedBusiness | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const desktop = useMediaQuery('(min-width: 1280px)');
const mayDecide = computed(() => props.canDecide && can('moderation.decide'));
const applied = computed(() => props.tab === 'applied');

const tabs = computed<TabItem[]>(() =>
    (['applied', 'verified', 'rejected', 'suspended', 'all'] as const).map((value) => ({
        value,
        label: trans(`businesses.tabs.${value}`),
        count: value === 'applied' ? (state.value === 'empty' ? 0 : (props.counts?.applied ?? null)) : null,
    })),
);
const tabModel = computed({
    get: () => props.tab,
    set: (tab: string) => router.get(queueUrl(), tab === 'applied' ? {} : { tab }, { preserveState: false }),
});

// ---- decisions + SplitQueue -----------------------------------------------------------------------------------------------------
const sel = computed(() => props.selected ?? null);
const writes = useBusinessWrites();
const rejectOpen = ref(qaDialog() === 'reject');

const queue = useSplitQueue<BusinessRow, DecidedBusiness>({
    param: 'business',
    url: queueUrl,
    rows: () => props.rows.data,
    selected: () => props.selected,
    decided: () => props.decided,
    undoable: ['verified', 'rejected'],
    advance: () => applied.value,
    enabled: desktop,
    onApprove: () => verify(),
    onReject: () => {
        if (sel.value?.can.reject && mayDecide.value) rejectOpen.value = true;
    },
    onUndo: () => undo(),
});
const { selectedId, paneOpen, split, lastDecided } = queue;

function verify(): void {
    if (!sel.value?.can.verify || !mayDecide.value || writes.processing.value) return;
    writes.post(sel.value, 'verify', {}, queue.advanceFrom(sel.value.id));
}
function reject(reason: string | null): void {
    if (!sel.value) return;
    const advance = queue.advanceFrom(sel.value.id);
    writes.post(sel.value, 'reject', { reason }, () => {
        rejectOpen.value = false;
        advance();
    });
}
function undo(): void {
    const decided = lastDecided.value;
    if (!decided || writes.processing.value) return;
    writes.post({ id: decided.id, version: decided.version }, 'reopen', {}, () => {
        queue.clearUndo();
        queue.select(decided.id);
    });
}
watch(writes.conflict, (conflict) => {
    if (conflict) rejectOpen.value = false;
});

// ---- columns + filters ----------------------------------------------------------------------------------------------------------
const columns = computed<TableColumn[]>(() =>
    split.value
        ? [
              { key: 'waiting', label: trans('businesses.columns.waiting'), sort: 'submitted_at', numeric: true, min: 80, hideable: false },
              { key: 'business', label: trans('businesses.columns.business'), grow: true, hideable: false },
          ]
        : [
              { key: 'waiting', label: trans('businesses.columns.waiting'), sort: 'submitted_at', numeric: true, min: 80, hideable: false },
              { key: 'business', label: trans('businesses.columns.business'), sort: 'name', grow: true, hideable: false },
              { key: 'legal', label: trans('businesses.columns.legal'), min: 200 },
              { key: 'owner', label: trans('businesses.columns.owner'), min: 160 },
              { key: 'reports', label: trans('businesses.columns.reports'), numeric: true, min: 80 },
              { key: 'status', label: trans('businesses.columns.status'), defaultHidden: props.tab !== 'all' },
          ],
);

const filters = reactive({ q: '', kind: '' });
watch(
    () => props.query.filter,
    (filter) => {
        filters.q = filter.q ?? '';
        filters.kind = filter.kind ?? '';
    },
    { immediate: true },
);
const ANY = '*';
const kindModel = computed({ get: () => filters.kind || undefined, set: (v: string | undefined) => (filters.kind = v === undefined || v === ANY ? '' : v) });
const kindOptions = computed(() => [{ value: ANY, label: trans('businesses.filters.any') }, ...BUSINESS_KINDS.map((v) => ({ value: v, label: trans(`businesses.kinds.${v}`) }))]);

const rowHref = (row: BusinessRow): string => (desktop.value ? queue.paneHref(row.id) : businessHref(row.id));
const paneState = computed(() => (state.value === 'loading' ? 'loading' : state.value === 'error' ? 'error' : 'ready'));
const forcedTable = computed(() => (state.value === 'loading' || state.value === 'error' || state.value === 'empty' ? state.value : undefined));
// Beside the pane the list is narrow: kind and city only (the pane names the applicant); the full list has its own columns.
const caption = (row: BusinessRow): string => [trans(`businesses.kinds.${row.kind}`), row.city, row.is_sample ? trans('businesses.detail.sample') : null].filter(Boolean).join(' · ');
</script>

<template>
    <Head :title="trans('businesses.queue_title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-55" :data-qa-state="state">
        <PageHeader :title="trans('businesses.queue_title')" :crumbs="[{ label: trans('shell.groups.vehicles_media') }]" :description="trans('businesses.intro')" />

        <div class="flex flex-col gap-12">
            <Tabs v-model="tabModel" :items="tabs" :label="trans('businesses.tabs.label')" :panels="false" data-testid="ADM-55.tabs" />
            <p v-if="!mayDecide" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-55.view-only">
                <PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('businesses.view_only') }}
            </p>
            <p v-else-if="desktop && !paneOpen && state === 'ready' && rows.data.length > 0" class="flex min-h-32 items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-55.none">
                <PhStorefront :size="16" class="shrink-0" aria-hidden="true" />{{ trans('businesses.pane.select_body') }}
            </p>
        </div>

        <div class="flex flex-col gap-24 desktop:flex-row desktop:items-start">
            <div class="min-w-0" :class="split ? 'desktop:w-400 desktop:shrink-0 wide:w-480' : 'grow'">
                <DataTable
                    :id="`businesses-${tab}`"
                    :key="`${tab}-${split ? 'split' : 'full'}`"
                    :narrow="split"
                    :columns="columns"
                    :rows="rows"
                    :query="query"
                    :views="views"
                    :only="['rows', 'query', 'views', 'counts']"
                    :caption="trans('businesses.caption')"
                    :empty-title="trans(`businesses.empty.${tab}_title`)"
                    :empty-body="trans(`businesses.empty.${tab}_body`)"
                    :row-href="rowHref"
                    :force-state="forcedTable"
                    test-id="ADM-55.table"
                >
                    <template #filters="{ apply, loading }">
                        <form class="flex w-full flex-wrap items-end gap-8" :aria-label="trans('businesses.filters.label')" @submit.prevent="apply({ ...filters })">
                            <div class="min-w-200 grow-2 basis-0">
                                <Field :label="trans('businesses.filters.q')">
                                    <Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('businesses.filters.q_placeholder')" data-testid="ADM-55.filter.q" />
                                </Field>
                            </div>
                            <div class="min-w-140 grow basis-0">
                                <Field :label="trans('businesses.filters.kind')"><Select v-model="kindModel" :options="kindOptions" size="sm" :placeholder="trans('businesses.filters.any')" data-testid="ADM-55.filter.kind" /></Field>
                            </div>
                            <Button type="submit" size="sm" variant="secondary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-55.filter.apply">{{ trans('businesses.filters.apply') }}</Button>
                        </form>
                    </template>

                    <template #cell-waiting="{ row }">
                        <span v-if="row.waiting_minutes !== null" class="block whitespace-nowrap text-right tabular-nums" :class="overdue(row.waiting_minutes) ? 'text-warning' : 'text-ink'" :title="trans('businesses.waiting.label', { date: formatDateTime(row.submitted_at) })">
                            {{ waitingText(row.waiting_minutes) }}
                        </span>
                        <span v-else class="block text-right text-ink-3">–</span>
                    </template>
                    <template #cell-business="{ row }">
                        <Link
                            :href="rowHref(row)"
                            :aria-current="row.id === selectedId ? 'true' : undefined"
                            :title="`${row.name} · ${caption(row)}`"
                            :class="[focusRing, 'group/name flex min-h-32 min-w-0 flex-col justify-center rounded-xs']"
                            data-testid="ADM-55.open"
                        >
                            <span class="truncate text-admin-base group-hover/name:underline" :class="row.id === selectedId ? 'text-admin-base-strong text-ink' : 'text-ink'">{{ row.name }}</span>
                            <span class="truncate text-caption text-ink-3">{{ caption(row) }}</span>
                        </Link>
                    </template>
                    <template #cell-legal="{ row }">
                        <span class="flex min-w-0 flex-col">
                            <span class="truncate text-admin-base text-ink">{{ row.legal_name ?? '–' }}</span>
                            <span class="truncate text-caption text-ink-3">{{ trans(`businesses.legal_forms.${row.legal_form}`) }}</span>
                        </span>
                    </template>
                    <template #cell-owner="{ row }">
                        <span class="sc-key block truncate text-admin-base text-ink">{{ `@${row.owner.username ?? '–'}` }}</span>
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
                :aria-label="trans('businesses.pane.label')"
                :aria-busy="paneState === 'loading' || undefined"
                data-testid="ADM-55.pane"
            >
                <div v-if="paneState === 'loading'" class="flex flex-col gap-16" aria-hidden="true" data-testid="ADM-55.pane.loading">
                    <Skeleton shape="text" class="h-24 w-320" />
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="aspect-video w-full max-w-480" />
                    <Skeleton shape="text" class="w-full" />
                    <Skeleton shape="text" class="w-3/4" />
                </div>
                <StateBlock v-else-if="paneState === 'error'" kind="error" :title="trans('businesses.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-55.pane.error" @retry="writes.reload(['selected'])" />
                <StateBlock v-else-if="sel === null" kind="partial" :title="trans('businesses.pane.gone')" :retryable="false" test-id="ADM-55.pane.gone">
                    <div class="mt-8"><Button size="sm" variant="secondary" :icon="PhX" @click="queue.select(null)">{{ trans('ui.actions.close') }}</Button></div>
                </StateBlock>
                <template v-else>
                    <header class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="text-headline text-ink" data-testid="ADM-55.pane.title">{{ sel.name }}</h2>
                            <p class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums">
                                <StatusPill :tone="statusTones[sel.status]" :label="statusLabel(sel)" data-testid="ADM-55.pane.status" />
                                <span>{{ trans(`businesses.kinds.${sel.kind}`) }}</span>
                                <span v-if="sel.waiting_minutes !== null" :class="overdue(sel.waiting_minutes) ? 'text-warning' : ''">{{ trans('businesses.waiting.label', { date: formatDateTime(sel.submitted_at) }) }}</span>
                                <Badge v-if="sel.is_sample" tone="neutral">{{ trans('businesses.detail.sample') }}</Badge>
                                <Badge v-if="sel.open_reports > 0" tone="warning" tnum>{{ trans('businesses.detail.reports') }} {{ formatNumber(sel.open_reports) }}</Badge>
                            </p>
                        </div>
                        <Link :href="businessHref(sel.id)" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']" data-testid="ADM-55.pane.open">
                            {{ trans('businesses.pane.open') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                        </Link>
                    </header>

                    <StateBlock v-if="writes.conflict.value" kind="partial" :title="trans('businesses.conflict.title')" :body="trans('businesses.conflict.changed')" :retryable="false" test-id="ADM-55.conflict">
                        <div class="mt-8">
                            <Button size="sm" variant="secondary" :icon="PhArrowsClockwise" data-testid="ADM-55.conflict.reload" @click="writes.reload(['selected', 'rows', 'counts'])">{{ trans('businesses.actions.reload') }}</Button>
                        </div>
                    </StateBlock>
                    <p v-else-if="writes.error.value" class="text-admin-base text-danger" role="alert" data-testid="ADM-55.pane.error-text">{{ writes.error.value }}</p>

                    <div v-if="mayDecide && (sel.can.verify || sel.can.reject)" class="flex flex-wrap items-center gap-8 border-y border-line-subtle py-12" data-testid="ADM-55.actions">
                        <Button v-if="sel.can.verify" size="sm" variant="primary" :icon="PhCheck" :loading="writes.processing.value === 'verify'" :disabled="writes.processing.value !== null || writes.conflict.value" aria-keyshortcuts="a" data-testid="ADM-55.verify" @click="verify()">
                            {{ trans('businesses.actions.verify') }}
                        </Button>
                        <Button v-if="sel.can.reject" size="sm" variant="destructive" :icon="PhX" :disabled="writes.processing.value !== null || writes.conflict.value" aria-keyshortcuts="r" data-testid="ADM-55.reject" @click="rejectOpen = true">
                            {{ trans('businesses.actions.reject') }}
                        </Button>
                        <p class="ml-auto text-caption text-ink-3">{{ trans('businesses.keys') }}</p>
                    </div>

                    <BusinessDetails :key="sel.id" :business="sel" compact test-id="ADM-55.detail" />
                </template>
            </section>
        </div>

        <!-- 5-s undo of the last decision (09 §10.2): reopen with the version the decision returned. -->
        <div
            v-if="lastDecided"
            class="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-12 rounded-sm border border-line bg-raised px-16 py-8 shadow-e2"
            :class="motionOff() ? '' : 'transition-opacity duration-effect-default ease-effect-default'"
            role="status"
            data-testid="ADM-55.undo"
        >
            <span class="text-admin-base text-ink">{{ trans(`businesses.undo.${lastDecided.outcome}`, { name: lastDecided.name }) }}</span>
            <Button size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :loading="writes.processing.value === 'reopen'" aria-keyshortcuts="u" data-testid="ADM-55.undo.button" @click="undo()">
                {{ trans('businesses.actions.undo') }}
            </Button>
        </div>

        <ConfirmDialog
            v-if="sel"
            v-model:open="rejectOpen"
            :title="trans('businesses.reject_dialog.title', { name: sel.name })"
            :body="trans('businesses.reject_dialog.body')"
            :confirm-label="trans('businesses.actions.reject')"
            :reason-label="trans('businesses.reject_dialog.reason')"
            reason
            reason-first
            :processing="writes.processing.value === 'reject'"
            :error="writes.error.value"
            test-id="ADM-55.reject-dialog"
            @confirm="reject"
        />
    </div>
</template>
