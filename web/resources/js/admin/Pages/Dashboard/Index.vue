<script setup lang="ts">
import { Deferred, Head, Link, router, usePage } from '@inertiajs/vue3';
import { PhArrowRight, PhCheck } from '@phosphor-icons/vue';
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
import { formatDayShort, formatMonth, formatNumber, formatRelative } from '../../lib/format';
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

const KPI_ORDER = ['members_today', 'members_7d', 'members_30d', 'dau', 'wau', 'vehicles_published', 'qr_scans_7d', 'qr_registrations_7d', 'messages_7d'];
// Tiles whose number is a total over a period while the sparkline counts new ones per day (DQ-517).
const PER_DAY = ['members_7d', 'members_30d', 'vehicles_published'];
const kpiList = computed(() => [...(props.kpis ?? [])].sort((a, b) => KPI_ORDER.indexOf(a.key) - KPI_ORDER.indexOf(b.key)));

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
            <ul v-else class="grid grid-cols-1 gap-12 tablet:grid-cols-2 desktop:grid-cols-3">
                <li v-for="tile in tiles" :key="tile.key" class="flex min-h-120 flex-col gap-12 rounded-sm border border-line-subtle bg-surface px-16 py-16" :data-testid="`ADM-06.queue.${tile.testId}`">
                    <div class="flex items-start justify-between gap-12">
                        <h3 class="text-admin-base-strong text-ink-2">{{ trans(tile.label) }}</h3>
                        <Link
                            v-if="queueHref(tile) && !forcedLoading"
                            :href="queueHref(tile) ?? ''"
                            :class="[focusRing, '-my-8 -mr-8 inline-flex h-32 min-w-32 items-center gap-4 rounded-xs px-8 text-admin-base-strong text-ink-2 hover:bg-hover hover:text-ink']"
                            :aria-label="trans('dashboard.queues.open', { queue: trans(tile.label) })"
                        >
                            {{ trans('dashboard.queues.open_short') }}<PhArrowRight :size="16" aria-hidden="true" />
                        </Link>
                    </div>
                    <template v-if="forcedLoading">
                        <Skeleton class="h-28 w-64" />
                    </template>
                    <!-- queue zero on the same baseline as a count, no box (DQ-504) -->
                    <div v-else-if="isClear(queue(tile))" class="flex flex-col gap-4" data-queue="clear">
                        <p class="font-numeral text-hero-numeral-s text-ink-3 tabular-nums">{{ formatNumber(0) }}</p>
                        <p class="flex items-center gap-4 text-caption text-ink-2">
                            <PhCheck :size="16" class="shrink-0 text-success" aria-hidden="true" />
                            <span>{{ queue(tile).since ? trans('dashboard.queues.clear_since', { time: formatRelative(queue(tile).since) }) : trans('dashboard.queues.clear') }}</span>
                            <span class="sr-only">{{ trans(tile.empty) }}</span>
                        </p>
                    </div>
                    <div v-else-if="queue(tile).count === null" class="flex flex-col gap-4">
                        <p class="text-admin-base-strong" :class="queue(tile).status === 'danger' ? 'text-danger' : 'text-warning'">{{ trans('dashboard.queues.stale') }}</p>
                        <p v-if="queue(tile).since" class="text-caption text-ink-3">{{ trans('dashboard.queues.last', { time: formatRelative(queue(tile).since) }) }}</p>
                    </div>
                    <div v-else class="flex flex-col gap-4">
                        <p class="font-numeral text-hero-numeral-s tabular-nums" :class="queue(tile).status === 'danger' ? 'text-danger' : queue(tile).status === 'warning' ? 'text-warning' : 'text-ink'">
                            {{ formatNumber(queue(tile).count) }}
                        </p>
                        <p class="text-caption text-ink-2">
                            <template v-if="tile.key === 'queue'">{{ trans('dashboard.queues.waiting', { count: formatNumber(queue(tile).count) }) }}<template v-if="queue(tile).since"> · </template></template>
                            <template v-if="queue(tile).since">{{ trans('dashboard.queues.since', { time: formatRelative(queue(tile).since) }) }}</template>
                        </p>
                    </div>
                </li>
            </ul>
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
                    <KpiTile v-for="key in KPI_ORDER" :key="key" :label="trans(`dashboard.kpis.${key}`)" :value="null" :period="PER_DAY.includes(key) ? trans('dashboard.kpis.per_day') : undefined" loading />
                </div>
                <StateBlock v-else-if="forcedError" kind="error" :title="trans('dashboard.kpis.error')" :retryable="false" />
                <Deferred v-else data="kpis">
                    <template #fallback>
                        <div data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle tablet:grid-cols-3">
                            <KpiTile v-for="key in KPI_ORDER" :key="key" :label="trans(`dashboard.kpis.${key}`)" :value="null" :period="PER_DAY.includes(key) ? trans('dashboard.kpis.per_day') : undefined" loading />
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
                            :period="PER_DAY.includes(kpi.key) ? trans('dashboard.kpis.per_day') : undefined"
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
