<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhInfo, PhLockSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import ChartCard, { type ChartSeries } from '../../Components/patterns/ChartCard.vue';
import KpiTile from '../../Components/patterns/KpiTile.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { EmptyQueue, SegmentedControl, Skeleton } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { formatDate, formatDayShort, formatNumber } from '../../lib/format';

/**
 * ADM-70 Insights overview (10 §11, m5.7-contract §9): platform totals of the M5.7 engagement features for staff with content.view —
 * views per day by source and the raw sticker scans (7, 30 or 90 Europe/Berlin days), the weekly recaps by outcome, plan prompts and the
 * pushes the weekly engagement cap dropped in the last 7 days. Sums only: no member, no car, no name (10 §6.1); there is nothing to
 * click into. Read only, so no writes and no audit.
 */
type Source = 'app' | 'web' | 'sticker_scan' | 'shared_link';
interface Day {
    date: string;
    views_by_source: Record<Source, number>;
    sticker_scans: number;
}
interface Recap {
    week: string;
    sent: number;
    skipped: number;
    unreachable: number;
}
interface Overview {
    days: Day[];
    recaps: Recap[];
    plan_prompts: { last_7_days: number };
    engagement_cap: { pushes_dropped_last_7_days: number };
}

const props = defineProps<{
    period: number;
    periods: number[];
    overview: Overview;
    countingSince: string | null;
    flags: { insights: boolean; weekly_recap: boolean; build_prompts: boolean };
    capPerWeek: number;
}>();

const SOURCES: Source[] = ['app', 'web', 'sticker_scan', 'shared_link'];
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const dayViews = (day: Day): number => sum(SOURCES.map((source) => day.views_by_source[source]));

const totals = computed(() => ({
    views: sum(props.overview.days.map(dayViews)),
    scans: sum(props.overview.days.map((day) => day.sticker_scans)),
    bySource: SOURCES.map((source) => sum(props.overview.days.map((day) => day.views_by_source[source]))),
}));
const nothingYet = computed(
    () =>
        totals.value.views === 0 &&
        totals.value.scans === 0 &&
        props.overview.recaps.length === 0 &&
        props.overview.plan_prompts.last_7_days === 0 &&
        props.overview.engagement_cap.pushes_dropped_last_7_days === 0,
);
const state = usePageState(() => (nothingYet.value ? 'empty' : 'ready'));

// ---- period (7 / 30 / 90 days): a partial reload of the numbers ---------------------------------------------------------------
const switching = ref(false);
const failed = ref(false);
const periodOptions = computed(() => props.periods.map((days) => ({ value: String(days), label: trans('insights.period.days', { days: formatNumber(days) }) })));
const periodModel = computed({
    get: () => String(props.period),
    set: (value: string) => {
        const days = Number.parseInt(value, 10);
        if (!props.periods.includes(days) || days === props.period) return;
        router.get(window.location.pathname, days === 30 ? {} : { days }, {
            only: ['overview', 'period'],
            preserveState: true,
            preserveScroll: true,
            replace: true,
            onStart: () => {
                switching.value = true;
                failed.value = false;
            },
            onFinish: () => (switching.value = false),
            onError: () => (failed.value = true),
            onHttpException: () => {
                failed.value = true;
                return false;
            },
            onNetworkError: () => {
                failed.value = true;
                return false;
            },
        });
    },
});
const periodText = computed(() => trans('insights.period.last', { days: formatNumber(props.period) }));
const busy = computed(() => switching.value || state.value === 'loading');

// ---- charts ---------------------------------------------------------------------------------------------------------------------
const chartState = computed<'ready' | 'loading' | 'error'>(() => (busy.value ? 'loading' : failed.value ? 'error' : 'ready'));
const dayLabels = computed(() => props.overview.days.map((day) => formatDayShort(day.date)));
const daySeries = computed<ChartSeries[]>(() => [
    // Neutral series (DQ-P5-030): views and scans are peers here, red stays for destructive and critical states in the admin.
    { key: 'views', label: trans('insights.series.views'), values: props.overview.days.map(dayViews), tone: 'strong' },
    { key: 'sticker_scans', label: trans('insights.series.sticker_scans'), values: props.overview.days.map((day) => day.sticker_scans), tone: 'muted' },
]);
const sourceLabels = computed(() => SOURCES.map((source) => trans(`insights.sources.${source}`)));
const sourceSeries = computed<ChartSeries[]>(() => [{ key: 'views', label: trans('insights.series.views'), values: totals.value.bySource }]);

// ---- weekly recaps --------------------------------------------------------------------------------------------------------------
/** ISO week number of a Monday (Y-m-d). */
function isoWeek(monday: string): number {
    const date = new Date(`${monday}T12:00:00Z`);
    const thursday = new Date(date);
    thursday.setUTCDate(date.getUTCDate() + 3);
    const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
    return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000 - ((firstThursday.getUTCDay() + 6) % 7) / 7 + 3 / 7);
}
function weekLabel(monday: string): string {
    const sunday = new Date(`${monday}T12:00:00Z`);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return trans('insights.recaps.week', { week: formatNumber(isoWeek(monday)), from: formatDayShort(monday), to: formatDayShort(sunday) });
}
</script>

<template>
    <Head :title="trans('insights.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-70" :data-qa-state="state">
        <PageHeader :title="trans('insights.title')" :crumbs="[{ label: trans('shell.groups.overview') }]" :description="trans('insights.intro')">
            <template #actions>
                <SegmentedControl v-model="periodModel" :options="periodOptions" :label="trans('insights.period.label')" :disabled="busy" data-testid="ADM-70.period" />
            </template>
        </PageHeader>

        <ul class="flex flex-col gap-8" data-testid="ADM-70.notes">
            <li class="flex items-start gap-8 text-admin-base text-ink-2"><PhLockSimple :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />{{ trans('insights.privacy') }}</li>
            <li v-if="!flags.insights" class="flex items-start gap-8 text-admin-base text-ink-2" data-testid="ADM-70.flag-off">
                <PhInfo :size="16" class="mt-2 shrink-0 text-info" aria-hidden="true" />{{ trans('insights.flag_off') }}
            </li>
            <li v-else-if="countingSince" class="flex items-start gap-8 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-70.since">
                <PhInfo :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />{{ trans('insights.counting_since', { date: formatDate(countingSince) }) }}
            </li>
        </ul>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('insights.load_error')" :body="trans('ui.state.error_body')" test-id="ADM-70.error" @retry="router.reload()" />
        <EmptyQueue v-else-if="state === 'empty'" variant="first" :title="trans('insights.empty_title')" :body="trans(flags.insights ? 'insights.empty_body' : 'insights.empty_body_off')" data-testid="ADM-70.empty" />
        <template v-else>
            <section :aria-label="trans('insights.kpis')" data-testid="ADM-70.kpis">
                <div data-qa-exempt="hairline" class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line-subtle bg-line-subtle desktop:grid-cols-4">
                    <KpiTile :label="trans('insights.kpi.views')" :value="totals.views" :period="periodText" :loading="busy" test-id="ADM-70.kpi.views" />
                    <KpiTile :label="trans('insights.kpi.sticker_scans')" :value="totals.scans" :period="periodText" :loading="busy" test-id="ADM-70.kpi.scans" />
                    <KpiTile
                        :label="trans('insights.kpi.plan_prompts')"
                        :value="overview.plan_prompts.last_7_days"
                        :period="trans(flags.build_prompts ? 'insights.period.last_7' : 'insights.period.last_7_off')"
                        :loading="busy"
                        test-id="ADM-70.kpi.plan-prompts"
                    />
                    <KpiTile
                        :label="trans('insights.kpi.pushes_dropped')"
                        :value="overview.engagement_cap.pushes_dropped_last_7_days"
                        :period="trans('insights.period.cap', { max: formatNumber(capPerWeek) })"
                        :loading="busy"
                        test-id="ADM-70.kpi.pushes-dropped"
                    />
                </div>
            </section>

            <div class="grid grid-cols-1 gap-16 wide:grid-cols-3">
                <div class="min-w-0 wide:col-span-2">
                    <ChartCard
                        :title="trans('insights.charts.days')"
                        :description="trans('insights.charts.days_body')"
                        :labels="dayLabels"
                        :series="daySeries"
                        :state="chartState"
                        :zero-text="trans('insights.charts.days_zero')"
                        :retryable="false"
                        partial-last
                        test-id="ADM-70.chart.days"
                    />
                </div>
                <ChartCard
                    type="bar"
                    :title="trans('insights.charts.sources')"
                    :description="trans('insights.charts.sources_body', { days: formatNumber(period) })"
                    :labels="sourceLabels"
                    :series="sourceSeries"
                    :state="chartState === 'ready' && totals.views === 0 ? 'empty' : chartState"
                    :empty-title="trans('insights.charts.sources_none')"
                    :retryable="false"
                    test-id="ADM-70.chart.sources"
                />
            </div>
            <p v-if="failed" class="text-admin-base text-danger" role="alert" data-testid="ADM-70.period-error">{{ trans('insights.period.failed') }}</p>

            <section class="flex flex-col gap-12" aria-labelledby="adm70-recaps" data-testid="ADM-70.recaps">
                <div class="flex flex-col gap-4">
                    <h2 id="adm70-recaps" class="text-headline text-ink">{{ trans('insights.recaps.title') }}</h2>
                    <p class="max-w-720 text-admin-base text-ink-2">{{ trans(flags.weekly_recap ? 'insights.recaps.intro' : 'insights.recaps.intro_off') }}</p>
                </div>
                <div v-if="busy" class="flex flex-col gap-8 rounded-sm border border-line-subtle p-16" aria-hidden="true">
                    <Skeleton v-for="n in 3" :key="n" shape="text" class="w-full" />
                </div>
                <p v-else-if="overview.recaps.length === 0" class="rounded-sm border border-dashed border-line px-16 py-16 text-admin-base text-ink-2" data-testid="ADM-70.recaps.none">{{ trans('insights.recaps.none') }}</p>
                <div v-else class="overflow-x-auto rounded-sm border border-line-subtle">
                    <table class="w-full text-admin-table">
                        <caption class="sr-only">{{ trans('insights.recaps.caption') }}</caption>
                        <thead class="bg-raised text-ink-2">
                            <tr>
                                <th scope="col" class="h-40 px-12 text-left font-medium">{{ trans('insights.recaps.columns.week') }}</th>
                                <th scope="col" class="h-40 px-12 text-right font-medium">{{ trans('insights.recaps.columns.sent') }}</th>
                                <th scope="col" class="h-40 px-12 text-right font-medium">{{ trans('insights.recaps.columns.skipped') }}</th>
                                <th scope="col" class="h-40 px-12 text-right font-medium">{{ trans('insights.recaps.columns.unreachable') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="recap in overview.recaps" :key="recap.week" class="border-t border-line-subtle" data-testid="ADM-70.recaps.row">
                                <th scope="row" class="h-40 px-12 text-left font-normal text-ink tabular-nums">{{ weekLabel(recap.week) }}</th>
                                <td class="h-40 px-12 text-right text-ink tabular-nums">{{ formatNumber(recap.sent) }}</td>
                                <td class="h-40 px-12 text-right text-ink-2 tabular-nums">{{ formatNumber(recap.skipped) }}</td>
                                <td class="h-40 px-12 text-right text-ink-2 tabular-nums">{{ formatNumber(recap.unreachable) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="text-caption text-ink-3">{{ trans('insights.recaps.legend') }}</p>
            </section>
        </template>
    </div>
</template>
