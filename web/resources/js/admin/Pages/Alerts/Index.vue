<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhDownloadSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import Badge from '../../Components/ui/Badge.vue';
import Button from '../../Components/ui/Button.vue';
import EmptyQueue from '../../Components/ui/EmptyQueue.vue';
import Skeleton from '../../Components/ui/Skeleton.vue';
import Spinner from '../../Components/ui/Spinner.vue';
import StatusPill from '../../Components/ui/StatusPill.vue';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { flashText } from '../../lib/i18n';
import { hasRoute, routeOr } from '../../lib/routes';

/** ADM-08 staff alerts: approvals waiting for me, cases assigned to me, system warnings. Sections follow the staff member's atoms. */
interface Approval {
    id: string;
    action: string;
    title: string;
    subject_label: string | null;
    requested_by: string;
    reason: string;
    expires_at: string;
}
interface AssignedCase {
    id: string;
    target_type: string;
    status: string;
    priority: number;
    report_count: number;
    created_at: string | null;
}
interface Warning {
    key: string;
    tone: 'warning' | 'danger';
    since: string | null;
    atom: string;
}

interface Running {
    id: string;
    action: string;
    title: string;
    subject_label: string | null;
    started_at: string | null;
    mine: boolean;
}

interface Download {
    id: string;
    action: string;
    title: string;
    url: string;
    until: string;
}

const props = defineProps<{
    approvals: Approval[];
    downloads: Download[];
    running?: Running[];
    cases: AssignedCase[];
    warnings: Warning[];
    sections: { approvals: boolean; cases: boolean; warnings: boolean };
}>();

const state = usePageState();
const empty = computed(() => state.value === 'empty');
const visible = computed(() => Object.values(props.sections).some(Boolean) || props.downloads.length > 0 || (props.running ?? []).length > 0);
const running = computed(() => (empty.value ? [] : (props.running ?? [])));
const downloads = computed(() => (empty.value ? [] : props.downloads));
const approvals = computed(() => (empty.value ? [] : props.approvals));
const cases = computed(() => (empty.value ? [] : props.cases));
const warnings = computed(() => (empty.value ? [] : props.warnings));

const approvalsHref = hasRoute('admin.team.approvals') ? routeOr('admin.team.approvals', '/admin/team/approvals') : null;
const caseHref = (id: string): string | null => (hasRoute('admin.moderation.cases.show') ? routeOr('admin.moderation.cases.show', '/admin', { case: id }) : null);
const warningHref = (warning: Warning): string | null => {
    if (warning.key === 'audit_chain_broken') return hasRoute('admin.audit.index') ? routeOr('admin.audit.index', '/admin/audit') : null;
    if (warning.key === 'failed_jobs') return hasRoute('admin.system.jobs') ? routeOr('admin.system.jobs', '/admin') : null;
    return hasRoute('admin.system.health') ? routeOr('admin.system.health', '/admin') : null;
};
</script>

<template>
    <Head :title="trans('alerts.title')" />
    <div class="flex max-w-960 flex-col gap-32" data-testid="ADM-08" :data-qa-state="state">
        <PageHeader :title="trans('alerts.title')" :crumbs="[{ label: trans('shell.groups.overview') }]" :description="trans('alerts.intro')" />

        <div v-if="state === 'loading'" class="flex flex-col gap-24" aria-busy="true">
            <div v-for="n in 3" :key="n" class="flex flex-col gap-8">
                <Skeleton shape="text" class="w-160" />
                <Skeleton class="h-56 w-full" />
            </div>
        </div>
        <StateBlock v-else-if="state === 'error'" kind="error" :title="trans('ui.state.error_title')" :body="trans('ui.state.error_body')" @retry="router.reload()" />
        <EmptyQueue v-else-if="!visible" variant="quiet" :title="trans('alerts.none_title')" :body="trans('alerts.none_body')" data-testid="ADM-08.none" />

        <template v-else>
            <!-- my approved exports -->
            <section v-if="downloads.length > 0" aria-labelledby="alerts-downloads" class="flex flex-col gap-12" data-testid="ADM-08.downloads">
                <h2 id="alerts-downloads" class="text-headline text-ink">{{ trans('alerts.downloads.title') }}</h2>
                <ul class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="item in downloads" :key="item.id" class="flex flex-wrap items-center gap-12 border-b border-line-subtle px-12 py-8 last:border-b-0">
                        <span class="min-w-0 flex-1 text-admin-base text-ink">{{ flashText(item.title, trans) }}</span>
                        <span class="text-caption text-ink-3">{{ trans('alerts.downloads.until', { time: formatDateTime(item.until) }) }}</span>
                        <Button size="sm" :icon="PhDownloadSimple" :href="item.url" external :data-testid="`ADM-08.download`">{{ trans('alerts.downloads.download') }}</Button>
                    </li>
                </ul>
            </section>

            <!-- approved requests still running (status executing, ADR-229) -->
            <section v-if="running.length > 0" aria-labelledby="alerts-running" class="flex flex-col gap-12" data-testid="ADM-08.running">
                <h2 id="alerts-running" class="flex items-baseline gap-8 text-headline text-ink">
                    {{ trans('alerts.running.title') }}<span class="text-caption text-ink-3 tabular-nums">{{ formatNumber(running.length) }}</span>
                </h2>
                <ul class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="item in running" :key="item.id" class="flex flex-wrap items-center gap-12 border-b border-line-subtle px-12 py-8 last:border-b-0" data-testid="ADM-08.running-item">
                        <Spinner :size="16" aria-hidden="true" /><span class="sr-only">{{ trans('alerts.running.busy') }}</span>
                        <span class="min-w-0 flex-1 text-admin-base text-ink">{{ flashText(item.title, trans) }}<template v-if="item.subject_label">{{ ` · ${item.subject_label}` }}</template></span>
                        <span class="text-caption text-ink-3 tabular-nums">{{ trans(item.mine ? 'alerts.running.mine' : 'alerts.running.approved', { time: formatDateTime(item.started_at) }) }}</span>
                    </li>
                </ul>
            </section>

            <!-- approvals -->
            <section v-if="sections.approvals" aria-labelledby="alerts-approvals" class="flex flex-col gap-12" data-testid="ADM-08.approvals">
                <div class="flex items-baseline justify-between gap-12">
                    <h2 id="alerts-approvals" class="flex items-baseline gap-8 text-headline text-ink">
                        {{ trans('alerts.approvals.title') }}<span v-if="approvals.length > 0" class="text-caption text-ink-3 tabular-nums">{{ formatNumber(approvals.length) }}</span>
                    </h2>
                    <Link v-if="approvalsHref" :href="approvalsHref" :class="[focusRing, 'inline-flex h-32 items-center rounded-xs text-admin-base-strong text-ink-2 hover:text-ink']">{{ trans('alerts.approvals.queue') }}</Link>
                </div>
                <EmptyQueue v-if="approvals.length === 0" variant="clear" :title="trans('alerts.approvals.empty')" compact />
                <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="item in approvals" :key="item.id" class="flex flex-col gap-4 border-b border-line-subtle px-12 py-12 last:border-b-0">
                        <div class="flex flex-wrap items-baseline justify-between gap-8">
                            <p class="text-admin-base-strong text-ink">{{ flashText(item.title, trans) }}</p>
                            <p class="text-caption text-ink-3">{{ trans('alerts.approvals.expires', { time: formatDateTime(item.expires_at) }) }}</p>
                        </div>
                        <p class="text-admin-base text-ink-2">{{ trans('alerts.approvals.by', { name: item.requested_by }) }}<template v-if="item.subject_label"> · {{ item.subject_label }}</template></p>
                        <p class="text-admin-base text-ink-3">{{ item.reason }}</p>
                    </li>
                </ul>
            </section>

            <!-- assigned cases -->
            <section v-if="sections.cases" aria-labelledby="alerts-cases" class="flex flex-col gap-12" data-testid="ADM-08.cases">
                <h2 id="alerts-cases" class="flex items-baseline gap-8 text-headline text-ink">
                    {{ trans('alerts.cases.title') }}<span v-if="cases.length > 0" class="text-caption text-ink-3 tabular-nums">{{ formatNumber(cases.length) }}</span>
                </h2>
                <EmptyQueue v-if="cases.length === 0" variant="clear" :title="trans('alerts.cases.empty')" compact />
                <ul v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="item in cases" :key="item.id" class="border-b border-line-subtle last:border-b-0">
                        <component :is="caseHref(item.id) ? Link : 'div'" :href="caseHref(item.id) ?? undefined" :class="[caseHref(item.id) ? `${focusRing} hover:bg-hover` : '', 'flex h-40 items-center gap-12 px-12']">
                            <StatusPill :tone="item.status === 'new' ? 'info' : 'warning'" :label="trans(`alerts.cases.status_${item.status}`)" />
                            <span class="min-w-0 flex-1 truncate text-admin-base text-ink">{{ trans(`alerts.cases.target_${item.target_type}`) }}</span>
                            <Badge tnum>{{ trans('alerts.cases.reports', { count: formatNumber(item.report_count) }) }}</Badge>
                            <span class="w-120 text-right text-caption text-ink-3">{{ formatRelative(item.created_at) }}</span>
                        </component>
                    </li>
                </ul>
            </section>

            <!-- system warnings -->
            <section v-if="sections.warnings" aria-labelledby="alerts-warnings" class="flex flex-col gap-12" data-testid="ADM-08.warnings">
                <h2 id="alerts-warnings" class="text-headline text-ink">{{ trans('alerts.warnings.title') }}</h2>
                <EmptyQueue v-if="warnings.length === 0" variant="clear" :title="trans('alerts.warnings.empty')" compact />
                <ul v-else class="flex flex-col gap-8">
                    <li v-for="item in warnings" :key="item.key">
                        <StateBlock :kind="item.tone === 'danger' ? 'error' : 'partial'" :title="trans(`alerts.warnings.${item.key}`)" :body="item.since ? trans('alerts.warnings.since', { time: formatDateTime(item.since) }) : undefined" :retryable="false">
                            <Link v-if="warningHref(item)" :href="warningHref(item) ?? ''" :class="[focusRing, 'inline-flex h-32 items-center self-start rounded-xs text-admin-base-strong text-ink-2 underline underline-offset-4 hover:text-ink']">{{ trans('alerts.warnings.open') }}</Link>
                        </StateBlock>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>
