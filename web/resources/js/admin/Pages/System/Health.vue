<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowRight, PhArrowsClockwise, PhCheckCircle } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, EmptyQueue, Skeleton, StatusPill, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-48 system health (spatie/laravel-health, 06 §3 System): the last stored run with its time, each check's status and short result
 * (database, cache, queue and its backlog, failed jobs, scheduler heartbeat, disk, storage link, GD WebP, PHP and extensions, mail,
 * Pusher, AI provider, last backup, audit chain). The summary line counts them; what needs attention comes first with its reason in German
 * and a "was tun" link, then what is not set up (as on ADM-50), then the passed checks as a compact list. "Jetzt prüfen" runs them now.
 */
interface Reason {
    key: string;
    count?: number;
    params?: Record<string, string | number>;
}
interface Check {
    name: string;
    label: string;
    status: string;
    reason: Reason | null;
    todo: { target: 'jobs' | 'integrations' | 'audit'; href: string } | null;
}
interface Report {
    finished_at: string | null;
    status: 'ok' | 'warning' | 'failed' | 'unknown';
    counts?: { failed: number; warning: number; ok: number; not_configured: number };
    checks: Check[];
}
const props = defineProps<{ report: Report }>();

const running = ref(false);
const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : 'ready'));
const empty = computed(() => state.value === 'empty' || props.report.checks.length === 0);
const tones: Record<string, Tone> = { ok: 'success', warning: 'warning', failed: 'danger', crashed: 'danger', skipped: 'neutral', not_configured: 'neutral', unknown: 'neutral' };
const RANK: Record<string, number> = { failed: 0, crashed: 0, warning: 1, not_configured: 2 };
// DQ-638: errors, then warnings, then what is not set up, each with its reason and a "was tun" link; the checks in order as a compact list.
const open = computed(() => props.report.checks.filter((c) => c.status in RANK).sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3)));
const fine = computed(() => props.report.checks.filter((c) => !(c.status in RANK)));
const summary = computed(() => {
    const counts = props.report.counts;
    if (!counts) return [];
    return (['failed', 'warning', 'ok', 'not_configured'] as const)
        .filter((key) => counts[key] > 0)
        .map((key) => ({ key, text: transChoice(`system.health.counts.${key}`, counts[key], { count: formatNumber(counts[key]) }) }));
});
const summaryTone: Record<string, string> = { failed: 'text-danger', warning: 'text-warning', ok: '', not_configured: '' };

function checkLabel(check: Check): string {
    const key = `system.health.checks.${check.name}`;
    const text = trans(key);
    return text === key ? check.label : text;
}
/** The reason in the admin's words (DQ-620): numbers formatted, dates in the admin's format. */
function reasonText(reason: Reason | null): string {
    if (reason === null) return '–';
    const params = Object.fromEntries(
        Object.entries(reason.params ?? {}).map(([name, value]) => [name, typeof value === 'number' ? formatNumber(value) : name === 'date' && value !== '' ? formatDateTime(value) : value]),
    );
    const key = `system.health.reasons.${reason.key}`;
    return reason.count === undefined ? trans(key, params) : transChoice(key, reason.count, { ...params, count: formatNumber(reason.count) });
}
function run(): void {
    router.post(routeOr('admin.system.health.run', '/admin/system/health/run'), {}, {
        preserveScroll: true,
        onStart: () => (running.value = true),
        onFinish: () => (running.value = false),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
</script>

<template>
    <Head :title="trans('system.health.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-48" :data-qa-state="state">
        <PageHeader :title="trans('system.health.title')" :crumbs="[{ label: trans('shell.groups.system') }]" :description="trans('system.health.intro')">
            <template v-if="!empty && state !== 'loading' && state !== 'error'" #badge>
                <StatusPill :tone="tones[report.status] ?? 'neutral'" :label="trans(`system.status.${report.status}`)" data-testid="ADM-48.status" />
            </template>
            <template #meta>
                <p class="flex flex-wrap gap-x-16 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-48.meta">
                    <span>{{ report.finished_at && !empty ? trans('system.health.last', { date: formatDateTime(report.finished_at) }) : trans('system.status.unknown') }}</span>
                    <span v-if="!empty && state === 'ready' && summary.length > 0" class="flex flex-wrap gap-x-8" data-testid="ADM-48.summary">
                        <template v-for="(part, i) in summary" :key="part.key"><span v-if="i > 0" aria-hidden="true">·</span><span :class="summaryTone[part.key]">{{ part.text }}</span></template>
                    </span>
                </p>
            </template>
            <template #actions>
                <Button size="sm" variant="primary" :icon="PhArrowsClockwise" :loading="running" :disabled="state === 'loading'" data-testid="ADM-48.run" @click="run()">{{ trans('system.health.run') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('system.health.error')" :body="trans('ui.state.error_body')" test-id="ADM-48.error" @retry="router.reload()" />
        <div v-else-if="state === 'loading'" class="flex flex-col gap-24" aria-busy="true" data-testid="ADM-48.loading">
            <div class="flex flex-col gap-12">
                <Skeleton shape="text" class="h-20 w-200" />
                <div class="flex flex-col rounded-sm border border-line-subtle">
                    <div class="flex h-40 items-center gap-24 border-b border-line px-12"><Skeleton shape="text" class="w-120" /><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-120" /></div>
                    <div v-for="n in 5" :key="n" class="flex h-40 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0"><Skeleton shape="text" class="w-160" /><Skeleton class="h-20 w-96" /><Skeleton shape="text" class="w-240" /></div>
                </div>
            </div>
            <div class="flex flex-col gap-12">
                <Skeleton shape="text" class="h-20 w-120" />
                <div class="grid grid-cols-1 gap-8 tablet:grid-cols-2 wide:grid-cols-3">
                    <div v-for="n in 9" :key="n" class="flex min-h-40 flex-col gap-4 rounded-sm border border-line-subtle px-12 py-8"><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-120" /></div>
                </div>
            </div>
        </div>
        <EmptyQueue v-else-if="empty" variant="first" :title="trans('system.health.never_title')" :body="trans('system.health.never_body')" data-testid="ADM-48.empty" />
        <div v-else class="flex flex-col gap-24" data-testid="ADM-48.checks">
            <section class="flex flex-col gap-12" aria-labelledby="adm48-open" data-testid="ADM-48.open">
                <h2 id="adm48-open" class="text-headline text-ink">{{ trans('system.health.problems_title') }}</h2>
                <p v-if="open.length === 0" class="text-admin-base text-ink-2">{{ trans('system.health.nothing_open') }}</p>
                <ScrollRegion v-else :label="trans('system.health.caption')">
                    <table class="w-full border-collapse text-admin-base">
                        <caption class="sr-only">{{ trans('system.health.caption') }}</caption>
                        <thead class="bg-surface text-left text-admin-base-strong text-ink-2">
                            <tr class="h-40 border-b border-line">
                                <th scope="col" class="px-12">{{ trans('system.health.columns.check') }}</th>
                                <th scope="col" class="px-12">{{ trans('system.health.columns.status') }}</th>
                                <th scope="col" class="px-12">{{ trans('system.health.columns.result') }}</th>
                                <th scope="col" class="px-12"><span class="sr-only">{{ trans('system.health.columns.todo') }}</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="check in open" :key="check.name" class="h-40 border-b border-line-subtle last:border-b-0" :data-testid="`ADM-48.check.${check.name}`">
                                <th scope="row" class="whitespace-nowrap px-12 text-left font-normal text-ink">{{ checkLabel(check) }}</th>
                                <td class="px-12"><StatusPill :tone="tones[check.status] ?? 'neutral'" :label="trans(`system.status.${check.status}`)" /></td>
                                <td class="px-12 py-8 text-ink-2 tabular-nums">{{ reasonText(check.reason) }}</td>
                                <td class="whitespace-nowrap px-12 py-4 text-right">
                                    <Link v-if="check.todo" :href="check.todo.href" :class="[focusRing, 'inline-flex h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']" :data-testid="`ADM-48.todo.${check.name}`">
                                        {{ trans(`system.health.todo_targets.${check.todo.target}`) }}<PhArrowRight :size="16" aria-hidden="true" />
                                    </Link>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </ScrollRegion>
            </section>
            <section v-if="fine.length > 0" class="flex flex-col gap-12" aria-labelledby="adm48-ok" data-testid="ADM-48.ok">
                <h2 id="adm48-ok" class="text-headline text-ink">{{ trans('system.health.ok_title') }}</h2>
                <ul class="grid grid-cols-1 gap-8 tablet:grid-cols-2 wide:grid-cols-3" :aria-label="trans('system.health.ok_list')">
                    <li v-for="check in fine" :key="check.name" class="flex min-h-40 items-start gap-8 rounded-sm border border-line-subtle bg-surface px-12 py-8" :data-testid="`ADM-48.check.${check.name}`">
                        <PhCheckCircle :size="16" class="mt-2 shrink-0 text-success" role="img" :aria-label="trans(`system.status.${check.status}`)" />
                        <span class="flex min-w-0 flex-col">
                            <span class="text-admin-base-strong text-ink">{{ checkLabel(check) }}</span>
                            <span v-if="check.reason" class="text-caption text-ink-3 tabular-nums">{{ reasonText(check.reason) }}</span>
                        </span>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
