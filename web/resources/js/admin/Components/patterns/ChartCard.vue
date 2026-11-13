<script setup lang="ts">
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    Filler,
    LinearScale,
    LineElement,
    PointElement,
    Tooltip,
    type ChartData,
    type ChartOptions,
} from "chart.js";
import { PhArrowClockwise, PhWarningCircle } from "@phosphor-icons/vue";
import { trans } from "laravel-vue-i18n";
import { computed, onMounted, ref } from "vue";
import { Bar, Line } from "vue-chartjs";
import Button from "../ui/Button.vue";
import Skeleton from "../ui/Skeleton.vue";
import { formatNumber } from "../../lib/format";
import { motionOff } from "../../lib/qa";
import { themeVersion } from "../../lib/theme";

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    Tooltip,
    Filler,
);

export interface ChartSeries {
    key: string;
    label: string;
    values: number[];
    /** The one accent series of the chart; the rest are monochrome (03 §14). */
    accent?: boolean;
}

/**
 * A chart that answers a question (the title is the question). Line or horizontal bar. Below the canvas a visually hidden table
 * carries the same numbers for screen readers. States: loading, empty, error (retry), all drawn inside the same plot area, so cards
 * in a row keep one geometry (DQ-504, DQ-506): the header always reserves its legend row and the plot is 240 high. A series of only
 * zeros is drawn in the tertiary tone with `zeroText` over it, never as an accent flat line.
 * Colours are read from the card's own element, so a ThemeFrame in another theme draws its own tokens (DQ-513).
 */
const props = withDefaults(
    defineProps<{
        title: string;
        description?: string;
        type?: "line" | "bar";
        labels: string[];
        series: ChartSeries[];
        state?: "ready" | "loading" | "empty" | "error";
        emptyTitle?: string;
        /** Shown over a chart whose values are all 0, e.g. "Keine Registrierungen in den letzten 30 Tagen". */
        zeroText?: string;
        /** false: the error state has no retry button (the page offers one retry for everything). */
        retryable?: boolean;
        testId?: string;
    }>(),
    {
        description: undefined,
        type: "line",
        state: "ready",
        emptyTitle: undefined,
        zeroText: undefined,
        retryable: true,
        testId: undefined,
    },
);
const emit = defineEmits<{ retry: [] }>();

const root = ref<HTMLElement | null>(null);
const mounted = ref(0);
onMounted(() => {
    mounted.value += 1;
    // Chart.js measures its axis labels on the canvas when it draws. A chart drawn while Inter still loads keeps the fallback's widths,
    // and its plot area sits a few px off (ADM-19 captures differed by that). Draw once more when the fonts are in.
    void document.fonts?.ready.then(() => (mounted.value += 1));
});

function token(name: string): string {
    const element = root.value ?? document.documentElement;
    return getComputedStyle(element).getPropertyValue(name).trim();
}

const allZero = computed(() => props.series.length > 0 && props.series.every((s) => s.values.every((v) => v === 0)));
const view = computed<"loading" | "error" | "empty" | "ready">(() => {
    if (props.state === "loading" || props.state === "error") return props.state;
    if (props.state === "empty" || props.labels.length === 0) return "empty";
    return "ready";
});

const colors = computed(() => {
    void themeVersion.value;
    void mounted.value;
    return {
        accent: token("--sc-color-accent-fg"),
        mono: [
            token("--sc-color-text-secondary"),
            token("--sc-color-text-tertiary"),
            token("--sc-color-border-strong"),
        ],
        tertiary: token("--sc-color-text-tertiary"),
        grid: token("--sc-color-border-subtle"),
        text: token("--sc-color-text-tertiary"),
        font: token("--sc-font-ui"),
        surface: token("--sc-color-bg-overlay"),
        ink: token("--sc-color-text-primary"),
        line: token("--sc-color-border-default"),
    };
});

function seriesColor(series: ChartSeries, index: number): string {
    if (allZero.value) return colors.value.tertiary;
    return series.accent
        ? colors.value.accent
        : (colors.value.mono[index % colors.value.mono.length] ??
              colors.value.text);
}

const lineData = computed<ChartData<"line">>(() => ({
    labels: props.labels,
    datasets: props.series.map((series, index) => ({
        label: series.label,
        data: series.values,
        borderColor: seriesColor(series, index),
        backgroundColor: seriesColor(series, index),
        borderWidth: series.accent ? 2 : 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0,
    })),
}));

const barData = computed<ChartData<"bar">>(() => ({
    labels: props.labels,
    datasets: props.series.map((series, index) => ({
        label: series.label,
        data: series.values,
        backgroundColor: seriesColor(series, index),
        borderRadius: 2,
        barThickness: 12,
    })),
}));

const options = computed(() => {
    const c = colors.value;
    const base = {
        responsive: true,
        maintainAspectRatio: false,
        animation: motionOff() ? (false as const) : { duration: 200 },
        interaction: { mode: "index" as const, intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: c.surface,
                titleColor: c.ink,
                bodyColor: c.ink,
                borderColor: c.line,
                borderWidth: 1,
                padding: 8,
                titleFont: { family: c.font, size: 12, weight: 600 },
                bodyFont: { family: c.font, size: 12 },
                callbacks: {
                    label: (item: {
                        dataset: { label?: string };
                        parsed: { x: number; y: number };
                    }) =>
                        `${item.dataset.label ?? ""}: ${formatNumber(props.type === "bar" ? item.parsed.x : item.parsed.y)}`,
                },
            },
        },
    };
    const ticks = { color: c.text, font: { family: c.font, size: 12 } };
    if (props.type === "bar") {
        return {
            ...base,
            indexAxis: "y" as const,
            scales: {
                x: {
                    grid: { color: c.grid },
                    border: { display: false },
                    ticks: { ...ticks, precision: 0 },
                    beginAtZero: true,
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks,
                },
            },
        } as ChartOptions<"bar">;
    }
    return {
        ...base,
        scales: {
            x: {
                grid: { display: false },
                border: { color: c.grid },
                ticks: { ...ticks, maxTicksLimit: 8, maxRotation: 0 },
            },
            y: {
                grid: { color: c.grid },
                border: { display: false },
                ticks: { ...ticks, precision: 0 },
                beginAtZero: true,
            },
        },
    } as ChartOptions<"line">;
});
</script>

<template>
    <figure
        ref="root"
        class="flex min-w-0 flex-col gap-16 rounded-sm border border-line-subtle bg-surface px-16 py-16"
        :data-testid="testId"
        :data-chart-state="view"
    >
        <figcaption class="flex flex-col gap-4">
            <h3 class="text-headline text-ink">{{ title }}</h3>
            <p v-if="description" class="text-admin-base text-ink-2">
                {{ description }}
            </p>
            <!-- The legend row is always reserved, so the plots of a row share their x-axis (DQ-506). -->
            <ul
                class="mt-4 flex min-h-20 flex-wrap items-center gap-16"
                :aria-label="trans('ui.chart.legend')"
                :aria-hidden="view !== 'ready' || undefined"
            >
                <template v-if="view === 'ready'">
                    <li
                        v-for="(item, index) in series"
                        :key="item.key"
                        class="flex items-center gap-8 text-caption text-ink-2"
                    >
                        <span
                            class="h-2 w-16 rounded-full"
                            :class="
                                allZero
                                    ? 'bg-ink-3'
                                    : item.accent
                                      ? 'bg-accent'
                                      : index === 0
                                        ? 'bg-ink-2'
                                        : 'bg-ink-3'
                            "
                            aria-hidden="true"
                        />
                        {{ item.label }}
                    </li>
                </template>
            </ul>
        </figcaption>
        <div v-if="view === 'loading'" class="mt-auto h-240" aria-busy="true">
            <Skeleton class="size-full" />
        </div>
        <div
            v-else-if="view === 'error'"
            class="mt-auto flex h-240 flex-col items-start gap-12 border-t border-line-subtle pt-16"
            role="alert"
            data-chart-message="error"
        >
            <p class="flex items-center gap-8 text-admin-base-strong text-ink">
                <PhWarningCircle :size="16" class="shrink-0 text-danger" aria-hidden="true" />{{ trans("ui.chart.error") }}
            </p>
            <Button v-if="retryable" size="sm" variant="secondary" :icon="PhArrowClockwise" @click="emit('retry')">{{ trans("ui.state.retry") }}</Button>
        </div>
        <div
            v-else-if="view === 'empty'"
            class="mt-auto flex h-240 flex-col items-start gap-4 border-t border-line-subtle pt-16"
            data-chart-message="empty"
        >
            <p class="text-admin-base-strong text-ink-2">{{ emptyTitle ?? trans("ui.chart.empty") }}</p>
        </div>
        <template v-else>
            <!-- mt-auto: a two-line description does not push this plot below its neighbour (DQ-506). -->
            <div class="relative mt-auto h-240" aria-hidden="true">
                <Bar
                    v-if="type === 'bar'"
                    :data="barData"
                    :options="options as ChartOptions<'bar'>"
                />
                <Line
                    v-else
                    :data="lineData"
                    :options="options as ChartOptions<'line'>"
                />
                <p
                    v-if="allZero && zeroText"
                    class="absolute left-48 top-16 max-w-320 rounded-xs bg-surface px-4 text-admin-base text-ink-2"
                    data-chart-message="zero"
                >
                    {{ zeroText }}
                </p>
            </div>
            <p v-if="allZero && zeroText" class="sr-only">{{ zeroText }}</p>
            <div class="sr-only">
                <table>
                    <caption>
                        {{
                            title
                        }}
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">{{ trans("ui.chart.label") }}</th>
                            <th
                                v-for="item in series"
                                :key="item.key"
                                scope="col"
                            >
                                {{ item.label }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(label, index) in labels" :key="label">
                            <th scope="row">{{ label }}</th>
                            <td v-for="item in series" :key="item.key">
                                {{ formatNumber(item.values[index] ?? null) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
    </figure>
</template>
