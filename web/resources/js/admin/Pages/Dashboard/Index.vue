<script setup lang="ts">
import { Deferred, Head, Link, router, usePage } from '@inertiajs/vue3';
import { PhCaretRight, PhCheck } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import ChartCard from '../../Components/patterns/ChartCard.vue';
import KpiTile from '../../Components/patterns/KpiTile.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import EmptyQueue from '../../Components/ui/EmptyQueue.vue';
import Skeleton from '../../Components/ui/Skeleton.vue';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDayShort, formatDecimal, formatMonth, formatNumber, formatRelative, formatShare } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { queueTiles, type QueueTile } from '../../modules/registry';
import type { DashboardCharts, DsaFigure, Kpi, QueueValue } from '../../types/dashboard';

/**
 * ADM-06 (06 §3 Overview): work queues first, then KPI tiles, three charts and the DSA box. KPIs, charts and DSA arrive as deferred
 * props, each rescued on its own (partial failure shows in its section). First-run state while there are no members.
 */
const props = defineProps<{
    queues: Record<string, QueueValue>;
    firstRun: boolean;
    canAnalytics: boolean;
    kpis?: Kpi[];
    charts?: DashboardCharts | null;
    dsa?: DsaFigure | null;
}>();

const page = usePage();
const { can, canAny } = usePermissions();
// ?qaState=empty is the real empty dashboard: the first-run state (DQ-515).
const state = usePageState(() => (props.firstRun ? 'first-run' : 'ready'));
const showFirstRun = computed(() => state.value === 'first-run' || state.value === 'empty');
const forcedLoading = computed(() => state.value === 'loading');
const forcedEmpty = computed(() => state.value === 'empty');
const forcedError = computed(() => state.value === 'error');

// Only the queues the server sends, in every state: modules not built yet have none (DQ-505). Forced states replace values only.
const tiles = computed(() => queueTiles((atom) => (Array.isArray(atom) ? canAny(atom) : can(atom))).filter((tile) => props.queues[tile.key] !== undefined));

function queue(tile: QueueTile): QueueValue {
    return forcedEmpty.value ? { count: 0 } : (props.queues[tile.key] ?? { count: null });
}

function queueHref(tile: QueueTile): string | null {
    return tile.route !== undefined && hasRoute(tile.route) ? routeOr(tile.route, '/admin', tile.params) : null;
}

// 09 §10.2: six tiles at most, in this order.
const KPI_ORDER = ['members_7d', 'active_builds', 'qr_scans_7d', 'open_reports', 'median_decision', 'push_opt_in'];
// What the line shows where it is not the tile's own number per day (DQ-517).
const LINE: Record<string, string> = {
    members_7d: 'dashboard.kpis.per_day',
    active_builds: 'dashboard.kpis.line_active_builds',
    open_reports: 'dashboard.kpis.line_open_reports',
    median_decision: 'dashboard.kpis.line_median_decision',
    push_opt_in: 'dashboard.kpis.line_push_opt_in',
};
const period = (key: string): string | undefined => (LINE[key] ? trans(LINE[key]) : undefined);
const kpiList = computed(() => [...(props.kpis ?? [])].filter((kpi) => KPI_ORDER.includes(kpi.key)).sort((a, b) => KPI_ORDER.indexOf(a.key) - KPI_ORDER.indexOf(b.key)));

/** "45 Min.", "3,5 Std.", "2 Tg."; a share as "62,5 %". */
function display(kpi: Kpi): string | undefined {
    if (kpi.value === null || kpi.unit === 'count') return undefined;
    if (kpi.unit === 'percent') return formatShare(kpi.value);
    const minutes = kpi.value;
    if (minutes < 60) return trans('dashboard.kpis.minutes', { count: formatDecimal(minutes) });
    if (minutes < 48 * 60) return trans('dashboard.kpis.hours', { count: formatDecimal(minutes / 60) });
    return trans('dashboard.kpis.days', { count: formatDecimal(minutes / (24 * 60)) });
}
const emptyText = (key: string): string | undefined => (key === 'median_decision' || key === 'push_opt_in' ? trans(`dashboard.kpis.none_${key}`) : undefined);

const registrations = computed(() => props.charts?.registrations ?? []);
const funnel = computed(() => props.charts?.qr_funnel ?? []);
const makes = computed(() => props.charts?.top_makes ?? []);

function reload(only: string): void {
    router.reload({ only: [only] });
}

const greetingName = computed(() => page.props.staff?.name.split(' ')[0] ?? '');
const intro = computed(() => trans(props.canAnalytics ? 'dashboard.intro' : 'dashboard.intro_queues_only', { name: greetingName.value }));

function isClear(value: QueueValue): boolean {
    return (value.count === 0 || value.count === null) && (value.status ?? 'ok') === 'ok';
}

/** The count is ink; only a late queue (warning) or a broken one (danger) takes a state colour (DQ-1194). */
function countTone(tile: QueueTile): string {
    const status = queue(tile).status;
    return status === 'danger' ? 'text-danger' : status === 'warning' ? 'text-warning' : 'text-ink';
}
</script>

<template>
    <Head :title="trans('dashboard.title')" />
    <div class="flex flex-col gap-32" data-testid="ADM-06" :data-qa-state="state">
        <PageHeader :title="trans('dashboard.title')" :crumbs="[{ label: trans('shell.groups.overview') }]" :description="intro" />

        <!-- every source failed: one page-level retry (DQ-524) -->
        <StateBlock v-if="forcedError" kind="error" :title="trans('dashboard.error_all.title')" :body="trans('dashboard.error_all.body')" test-id="ADM-06.error" @retry="router.reload()" />

        <!-- 1 · queues -->
        <section aria-labelledby="dash-queues" class="flex flex-col gap-12" data-testid="ADM-06.queues">
            <h2 id="dash-queues" class="text-headline text-ink">{{ trans('dashboard.queues.title') }}</h2>
            <StateBlock v-if="forcedError" kind="error" :title="trans('dashboard.queues.error')" :retryable="false" />
            <EmptyQueue v-else-if="tiles.length === 0" variant="quiet" :title="trans('dashboard.queues.none_title')" :body="trans('dashboard.queues.none_body')" />
            <!-- DQ-1194: one compact table (count · oldest · link), so the six KPI tiles below are the page's only numeral heroes. Colour
                 only where a queue is late (warning) or broken (danger). -->
            <div v-else class="overflow-hidden rounded-sm border border-line-subtle bg-surface">
                <table class="w-full border-collapse text-admin-base">
                    <caption class="sr-only">{{ trans('dashboard.queues.title') }}</caption>
                    <thead>
                        <tr class="h-32 border-b border-line text-caption text-ink-2">
                            <th scope="col" class="px-16 text-left font-normal">{{ trans('dashboard.queues.col_queue') }}</th>
                            <th scope="col" class="w-96 px-12 text-right font-normal">{{ trans('dashboard.queues.col_open') }}</th>
                            <th scope="col" class="px-12 text-left font-normal">{{ trans('dashboard.queues.col_oldest') }}</th>
                            <th scope="col" class="w-48 px-12"><span class="sr-only">{{ trans('dashboard.queues.open_short') }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="tile in tiles"
                            :key="tile.key"
                            class="group/queue relative h-40 border-b border-line-subtle last:border-b-0"
                            :class="queueHref(tile) && !forcedLoading ? 'hover:bg-hover' : ''"
                            :data-testid="`ADM-06.queue.${tile.testId}`"
                            :data-queue="forcedLoading ? undefined : isClear(queue(tile)) ? 'clear' : (queue(tile).status ?? 'ok')"
                        >
                            <th scope="row" class="px-16 text-left font-normal">
                                <Link
                                    v-if="queueHref(tile) && !forcedLoading"
                                    :href="queueHref(tile) ?? ''"
                                    :class="[focusRing, 'inline-flex min-h-32 items-center rounded-xs text-ink after:absolute after:inset-0 group-hover/queue:underline']"
                                    :aria-label="trans('dashboard.queues.open', { queue: trans(tile.label) })"
                                    :data-testid="`ADM-06.queue.${tile.testId}.open`"
                                >
                                    {{ trans(tile.label) }}
                                </Link>
                                <span v-else class="text-ink">{{ trans(tile.label) }}</span>
                            </th>
                            <td class="px-12 text-right tabular-nums">
                                <Skeleton v-if="forcedLoading" shape="text" class="ml-auto w-32" />
                                <span v-else-if="queue(tile).count === null" class="text-ink-3">–</span>
                                <span v-else class="text-admin-base-strong" :class="countTone(tile)">{{ formatNumber(queue(tile).count) }}</span>
                            </td>
                            <td class="px-12 text-ink-2 tabular-nums">
                                <Skeleton v-if="forcedLoading" shape="text" class="w-120" />
                                <!-- queue zero: a quiet check, no number twice (DQ-504) -->
                                <span v-else-if="isClear(queue(tile))" class="flex items-center gap-4" data-queue-clear>
                                    <PhCheck :size="16" class="shrink-0 text-success" aria-hidden="true" />
                                    <span>{{ queue(tile).since ? trans('dashboard.queues.clear_since', { time: formatRelative(queue(tile).since) }) : trans('dashboard.queues.clear') }}</span>
                                    <span class="sr-only">{{ trans(tile.empty) }}</span>
                                </span>
                                <span v-else-if="queue(tile).count === null" :class="queue(tile).status === 'danger' ? 'text-danger' : 'text-warning'">
                                    {{ trans('dashboard.queues.stale') }}<template v-if="queue(tile).since"> · {{ trans('dashboard.queues.last', { time: formatRelative(queue(tile).since) }) }}</template>
                                </span>
                                <span v-else-if="queue(tile).since" :class="queue(tile).status === 'warning' ? 'text-warning' : ''">{{ trans('dashboard.queues.since', { time: formatRelative(queue(tile).since) }) }}</span>
                                <span v-else class="text-ink-3">–</span>
                            </td>
                            <td class="px-12 text-right text-ink-3">
                                <PhCaretRight v-if="queueHref(tile) && !forcedLoading" :size="16" class="ml-auto group-hover/queue:text-ink" aria-hidden="true" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- view-only: no analytics -->
        <StateBlock v-if="!canAnalytics" kind="forbidden" :title="trans('dashboard.analytics_forbidden.title')" :body="trans('dashboard.analytics_forbidden.body')" test-id="ADM-06.analytics-forbidden" />

        <!-- first run: one block instead of the KPI and chart empties (DQ-515) -->
        <EmptyQueue v-else-if="showFirstRun" variant="first" :title="trans('dashboard.first_run.title')" :body="trans('dashboard.first_run.body')" data-testid="ADM-06.first-run" />

        <template v-else>
            <!-- 2 · KPIs -->
            <section aria-labelledby="dash-kpis" class="flex flex-col gap-12" data-testid="ADM-06.kpis">
                <div class="flex flex-wrap items-baseline justify-between gap-8">
                    <h2 id="dash-kpis" class="text-headline text-ink">{{ trans('dashboard.kpis.title') }}</h2>
                    <p class="text-caption text-ink-3">{{ trans('dashboard.kpis.series') }}</p>
                </div>
                <div v-if="forcedLoading" data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-3">
                    <KpiTile v-for="key in KPI_ORDER" :key="key" :label="trans(`dashboard.kpis.${key}`)" :value="null" :period="period(key)" loading />
                </div>
                <StateBlock v-else-if="forcedError" kind="error" :title="trans('dashboard.kpis.error')" :retryable="false" />
                <Deferred v-else data="kpis">
                    <template #fallback>
                        <div data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-3">
                            <KpiTile v-for="key in KPI_ORDER" :key="key" :label="trans(`dashboard.kpis.${key}`)" :value="null" :period="period(key)" loading />
                        </div>
                    </template>
                    <template #rescue="{ reloading }">
                        <StateBlock kind="error" :title="trans('dashboard.kpis.error')" :body="reloading ? trans('ui.state.reloading') : undefined" test-id="ADM-06.kpis.error" @retry="reload('kpis')" />
                    </template>
                    <EmptyQueue v-if="kpiList.length === 0" variant="first" :title="trans('dashboard.kpis.empty_title')" :body="trans('dashboard.kpis.empty_body')" />
                    <div v-else data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-3">
                        <KpiTile
                            v-for="kpi in kpiList"
                            :key="kpi.key"
                            :label="trans(`dashboard.kpis.${kpi.key}`)"
                            :value="kpi.value"
                            :previous="kpi.previous"
                            :series="kpi.series"
                            :display="display(kpi)"
                            :empty="emptyText(kpi.key)"
                            :unit="kpi.unit"
                            :period="period(kpi.key)"
                            :test-id="`ADM-06.kpi.${kpi.key}`"
                        />
                    </div>
                </Deferred>
            </section>

            <!-- 3 · charts + 4 · DSA -->
            <section aria-labelledby="dash-charts" class="flex flex-col gap-12" data-testid="ADM-06.charts">
                <h2 id="dash-charts" class="text-headline text-ink">{{ trans('dashboard.charts.title') }}</h2>
                <div class="grid grid-cols-1 gap-16 desktop:grid-cols-2">
                    <template v-if="forcedLoading || forcedError">
                        <ChartCard
                            v-for="name in (['registrations', 'qr_funnel', 'top_makes'] as const)"
                            :key="name"
                            :title="trans(`dashboard.charts.${name}`)"
                            :description="trans(`dashboard.charts.${name}_body`)"
                            :labels="[]"
                            :series="[]"
                            :state="forcedLoading ? 'loading' : 'error'"
                            :retryable="false"
                        />
                    </template>
                    <Deferred v-else data="charts">
                        <template #fallback>
                            <ChartCard v-for="name in (['registrations', 'qr_funnel', 'top_makes'] as const)" :key="name" :title="trans(`dashboard.charts.${name}`)" :description="trans(`dashboard.charts.${name}_body`)" :labels="[]" :series="[]" state="loading" />
                        </template>
                        <template #rescue>
                            <StateBlock kind="error" :title="trans('dashboard.charts.error')" test-id="ADM-06.charts.error" @retry="reload('charts')" />
                        </template>
                        <ChartCard
                            :title="trans('dashboard.charts.registrations')"
                            :description="trans('dashboard.charts.registrations_body')"
                            :labels="registrations.map((d) => formatDayShort(d.date))"
                            :series="[{ key: 'registrations', label: trans('dashboard.charts.series_registrations'), values: registrations.map((d) => d.value), accent: true }]"
                            :state="registrations.length === 0 ? 'empty' : 'ready'"
                            :zero-text="trans('dashboard.charts.registrations_zero')"
                            test-id="ADM-06.chart.registrations"
                        />
                        <ChartCard
                            :title="trans('dashboard.charts.qr_funnel')"
                            :description="trans('dashboard.charts.qr_funnel_body')"
                            :labels="funnel.map((d) => formatDayShort(d.date))"
                            :series="[
                                { key: 'scans', label: trans('dashboard.charts.series_scans'), values: funnel.map((d) => d.scans) },
                                { key: 'registrations', label: trans('dashboard.charts.series_registrations'), values: funnel.map((d) => d.registrations), accent: true },
                            ]"
                            :state="funnel.length === 0 ? 'empty' : 'ready'"
                            :zero-text="trans('dashboard.charts.qr_funnel_zero')"
                            test-id="ADM-06.chart.qr-funnel"
                        />
                        <ChartCard
                            type="bar"
                            :title="trans('dashboard.charts.top_makes')"
                            :description="trans('dashboard.charts.top_makes_body')"
                            :labels="makes.map((d) => d.label)"
                            :series="[{ key: 'vehicles', label: trans('dashboard.charts.series_vehicles'), values: makes.map((d) => d.value) }]"
                            :state="makes.length === 0 ? 'empty' : 'ready'"
                            test-id="ADM-06.chart.top-makes"
                        />
                    </Deferred>
                    <!-- 4 · DSA -->
                    <section aria-labelledby="dash-dsa" class="flex min-w-0 flex-col gap-12 self-start rounded-sm border border-line-subtle bg-surface px-16 py-16" data-testid="ADM-06.dsa">
                        <h3 id="dash-dsa" class="text-headline text-ink">{{ trans('dashboard.dsa.title') }}</h3>
                        <p class="text-admin-base text-ink-2">{{ trans('dashboard.dsa.body') }}</p>
                        <Skeleton v-if="forcedLoading" class="h-28 w-120" />
                        <p v-else-if="forcedError" class="text-admin-base text-ink-2" role="alert">{{ trans('dashboard.dsa.error') }}</p>
                        <Deferred v-else data="dsa">
                            <template #fallback><Skeleton class="h-28 w-120" /></template>
                            <template #rescue>
                                <StateBlock kind="error" :title="trans('dashboard.dsa.error')" test-id="ADM-06.dsa.error" @retry="reload('dsa')" />
                            </template>
                            <p v-if="!dsa || dsa.average === null" class="text-admin-base text-ink-3">{{ trans('dashboard.dsa.empty') }}</p>
                            <div v-else class="flex flex-col gap-12">
                                <p class="font-numeral text-hero-numeral-s text-ink tabular-nums" data-testid="ADM-06.dsa.value">{{ formatNumber(dsa.average) }}</p>
                                <table class="w-full max-w-400 border-collapse text-admin-base">
                                    <caption class="sr-only">{{ trans('dashboard.dsa.months') }}</caption>
                                    <tbody>
                                        <tr v-for="month in dsa.months" :key="month.month" class="h-32 border-b border-line-subtle last:border-b-0">
                                            <th scope="row" class="text-left font-normal text-ink-2">{{ formatMonth(month.month) }}</th>
                                            <td class="text-right text-ink tabular-nums">{{ formatNumber(month.value) }}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </Deferred>
                    </section>
                </div>
            </section>
        </template>
    </div>
</template>
