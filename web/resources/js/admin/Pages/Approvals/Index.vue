<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhCheck, PhDownloadSimple, PhProhibit, PhSealCheck, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import DiffViewer from '../../Components/patterns/DiffViewer.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Dialog, EmptyQueue, Field, Select, Skeleton, StatusPill, Tabs, Textarea, type TabItem, type Tone } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-43 approvals queue (06 §3 Team, ADR-214): Für mich (what I may approve) · Von mir (what I asked for, with the download of an
 * approved export) · Alle (Owner and Admin). Each request shows its summary as a diff (labels and values from approvals.json), the
 * reason and the countdown. Approve (comment optional) and deny (comment required) behind a recent password; the requester withdraws.
 * Approve runs the action through Approvals::approve() on the server; nothing executes here.
 */
type Tab = 'for_me' | 'mine' | 'all';
interface Line {
    label: string;
    before: string | null;
    after: string | null;
}
interface Request {
    id: string;
    action: string;
    title: string;
    subject_label: string | null;
    lines: Line[];
    reason: string;
    requested_by: string | null;
    mine: boolean;
    status: 'pending' | 'executing' | 'executed' | 'failed' | 'denied' | 'expired' | 'cancelled';
    created_at: string | null;
    expires_at: string;
    /** Seconds left on the server's clock (the authority on expiry; a skewed or frozen browser clock never moves it). */
    expires_in?: number;
    decided_by: string | null;
    decided_at: string | null;
    decision_comment: string | null;
    result: { done: number | null; failed: number | null; error: string | null; failed_rows?: { id: string; label: string; code: string | null }[] };
    can_decide: boolean;
    can_cancel: boolean;
    download: string | null;
}

const props = defineProps<{ tab: Tab; status: string | null; canDecide: boolean; canSeeAll: boolean; requests: Request[]; counts: Record<Tab, number> }>();

const loading = ref(false);
const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : 'ready'));
const list = computed(() => (state.value === 'empty' ? [] : props.requests));

// Counts of what is pending ("Für mich 2 · Von mir 1", DQ-542); a forced empty state counts nothing (DQ-548).
const count = (tab: Tab): number | null => (state.value === 'empty' ? null : props.counts[tab] || null);
const tabs = computed<TabItem[]>(() => [
    ...(props.canDecide ? [{ value: 'for_me', label: trans('approvals.tabs.for_me'), count: count('for_me') }] : []),
    { value: 'mine', label: trans('approvals.tabs.mine'), count: count('mine') },
    ...(props.canSeeAll ? [{ value: 'all', label: trans('approvals.tabs.all'), count: count('all') }] : []),
]);
function visit(data: Record<string, string>): void {
    router.get(routeOr('admin.team.approvals', '/admin/team/approvals'), data, {
        only: ['tab', 'status', 'requests', 'counts'],
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onStart: () => {
            loading.value = true;
            failed.value = false;
        },
        onFinish: () => (loading.value = false),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
const tabModel = computed({ get: () => props.tab, set: (tab: string) => visit({ tab }) });
const ANY = '*';
const statusOptions = computed(() => [{ value: ANY, label: trans('approvals.filters.any') }, ...(['pending', 'executing', 'executed', 'failed', 'denied', 'expired', 'cancelled'] as const).map((v) => ({ value: v, label: trans(`approvals.status.${v}`) }))]);
const statusModel = computed({
    get: () => props.status ?? undefined,
    set: (value: string | undefined) => visit({ tab: props.tab, ...(value === undefined || value === ANY ? {} : { status: value }) }),
});

// ---- presentation ---------------------------------------------------------------------------------------------------------
function translated(key: string, fallback: string): string {
    const text = trans(key);
    return text === key ? fallback : text;
}
const title = (r: Request) => translated(r.title, r.action);
function one(raw: string): string {
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return formatDateTime(raw);
    return translated(`approvals.values.${raw.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`, raw);
}
/** A value of a summary line; a list ("id, username, email") is translated item by item, so no column key shows raw. */
function value(raw: string | null): string {
    if (raw === null || raw === '') return '–';
    const whole = one(raw);
    if (whole !== raw || !raw.includes(', ')) return whole;
    return raw.split(', ').map(one).join(', ');
}
function diff(r: Request): { before: Record<string, string>; after: Record<string, string> } {
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (const line of r.lines) {
        const label = translated(line.label, line.label);
        if (line.before !== null) before[label] = value(line.before);
        if (line.after !== null || line.before !== null) after[label] = value(line.after);
    }
    return { before, after };
}
const tones: Record<Request['status'], Tone> = { pending: 'info', executing: 'warning', executed: 'success', failed: 'danger', denied: 'warning', expired: 'neutral', cancelled: 'neutral' };
// The countdown counts from the server's answer: the time left when the page loaded, minus the time the page has been open.
const loadedAt = ref(Date.now());
const tick = ref(Date.now());
let timer: number | undefined;
onMounted(() => (timer = window.setInterval(() => (tick.value = Date.now()), 60_000)));
onBeforeUnmount(() => window.clearInterval(timer));
watch(
    () => props.requests,
    () => {
        loadedAt.value = Date.now();
        tick.value = loadedAt.value;
    },
);
function countdown(r: Request): string {
    const left = r.expires_in ?? Math.round((Date.parse(r.expires_at) - Date.now()) / 1000);
    const ms = left * 1000 - (tick.value - loadedAt.value);
    if (ms <= 0) return trans('approvals.expired_now');
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return trans('approvals.expires_in', { hours: formatNumber(hours), minutes: formatNumber(minutes) });
}

// ---- decisions ------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const target = ref<Request | null>(null);
const decideOpen = ref(false);
const decision = ref<'approve' | 'deny'>('approve');
const comment = ref('');
const commentError = ref<string | null>(null);
const cancelOpen = ref(false);
watch(decideOpen, (open) => {
    if (open) {
        comment.value = '';
        commentError.value = null;
    }
});
function openDecide(r: Request, kind: 'approve' | 'deny'): void {
    target.value = r;
    decision.value = kind;
    action.reset();
    decideOpen.value = true;
}
function submitDecision(): void {
    if (!target.value) return;
    const length = comment.value.trim().length;
    if ((decision.value === 'deny' && length < 3) || length > 1000 || (length > 0 && length < 3)) {
        commentError.value = trans(decision.value === 'deny' ? 'approvals.errors.comment_required' : 'approvals.errors.comment_length');
        return;
    }
    commentError.value = null;
    action.run('post', routeOr(`admin.team.approvals.${decision.value}`, `/admin/team/approvals/${target.value.id}/${decision.value}`, { approval: target.value.id }), { comment: comment.value.trim() }, { sensitive: true, onSuccess: () => (decideOpen.value = false) });
}
function openCancel(r: Request): void {
    target.value = r;
    action.reset();
    cancelOpen.value = true;
}
function submitCancel(): void {
    if (!target.value) return;
    action.run('post', routeOr('admin.team.approvals.cancel', `/admin/team/approvals/${target.value.id}/cancel`, { approval: target.value.id }), {}, { onSuccess: () => (cancelOpen.value = false) });
}
const emptyKey = computed(() => props.tab);
const emptyIcon = computed(() => (props.tab === 'for_me' ? undefined : PhSealCheck));
</script>

<template>
    <Head :title="trans('approvals.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-43" :data-qa-state="state">
        <PageHeader :title="trans('approvals.title')" :crumbs="[{ label: trans('shell.groups.team') }]" :description="trans('approvals.intro')" />

        <!-- Tabs on their own line, the toolbar row under them on every tab (its height reserved), so nothing moves between tabs (DQ-542). -->
        <div class="flex flex-col gap-12">
            <Tabs v-model="tabModel" :items="tabs" :label="trans('approvals.tabs.label')" :panels="false" />
            <div class="flex min-h-32 flex-wrap items-center justify-between gap-12" data-testid="ADM-43.toolbar">
                <p class="text-admin-base text-ink-2">{{ trans(`approvals.toolbar.${tab}`) }}</p>
                <div v-if="tab !== 'for_me'" class="flex items-center gap-8">
                    <span class="text-admin-base text-ink-2" aria-hidden="true">{{ trans('approvals.filters.status') }}</span>
                    <div class="w-200">
                        <Select v-model="statusModel" :options="statusOptions" size="sm" :placeholder="trans('approvals.filters.any')" :aria-label="trans('approvals.filters.status')" data-testid="ADM-43.filter.status" />
                    </div>
                </div>
            </div>
        </div>

        <div v-if="state === 'loading' || loading" class="flex flex-col gap-12" aria-busy="true" data-testid="ADM-43.loading">
            <div v-for="n in 3" :key="n" class="flex flex-col gap-12 rounded-sm border border-line-subtle bg-surface px-16 py-16">
                <div class="flex justify-between gap-12"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-120" /></div>
                <Skeleton shape="text" class="w-320" />
                <Skeleton class="h-64 w-full" />
            </div>
        </div>
        <StateBlock v-else-if="state === 'error'" kind="error" :title="trans('approvals.error')" :body="trans('ui.state.error_body')" test-id="ADM-43.error" @retry="visit({ tab })" />
        <EmptyQueue v-else-if="list.length === 0" :variant="tab === 'for_me' ? 'clear' : 'quiet'" :icon="emptyIcon" :title="trans(`approvals.empty.${emptyKey}_title`)" :body="trans(`approvals.empty.${emptyKey}_body`)" data-testid="ADM-43.empty" />

        <ul v-else class="flex flex-col gap-12" data-testid="ADM-43.list">
            <li v-for="r in list" :key="r.id" class="flex flex-col gap-12 rounded-sm border border-line-subtle bg-surface px-16 py-16" data-testid="ADM-43.request" :data-action="r.action">
                <div class="flex flex-wrap items-start justify-between gap-12">
                    <div class="flex min-w-0 flex-col gap-4">
                        <h2 class="flex flex-wrap items-center gap-8 text-headline text-ink">
                            {{ title(r) }}
                            <span v-if="r.subject_label" class="sc-key text-admin-base text-ink-2">{{ r.subject_label }}</span>
                        </h2>
                        <p class="text-admin-base text-ink-2 tabular-nums">
                            {{ trans('approvals.requested', { name: r.requested_by ?? '–', time: formatDateTime(r.created_at) }) }}
                        </p>
                    </div>
                    <div class="flex flex-col items-end gap-4">
                        <StatusPill :tone="tones[r.status]" :label="trans(`approvals.status.${r.status}`)" />
                        <p v-if="r.status === 'pending'" class="text-caption text-ink-2 tabular-nums" :title="formatDateTime(r.expires_at)" data-testid="ADM-43.countdown">{{ countdown(r) }}</p>
                        <p v-else-if="r.status === 'expired'" class="text-caption text-ink-3 tabular-nums" :title="formatDateTime(r.expires_at)">{{ trans('approvals.expired_on', { time: formatDateTime(r.expires_at) }) }}</p>
                        <p v-else-if="r.decided_at" class="text-caption text-ink-3 tabular-nums">{{ r.decided_by ? trans('approvals.decided', { name: r.decided_by, time: formatRelative(r.decided_at) }) : formatRelative(r.decided_at) }}</p>
                    </div>
                </div>

                <blockquote class="border-l-2 border-line pl-12 text-admin-base text-ink">{{ r.reason }}</blockquote>
                <DiffViewer v-if="r.lines.length > 0" :before="diff(r).before" :after="diff(r).after" :test-id="`ADM-43.diff`" />
                <p v-if="r.decision_comment" class="text-admin-base text-ink-2">{{ trans('approvals.comment', { comment: r.decision_comment }) }}</p>
                <p v-if="r.status === 'executed' && r.result.done !== null && !r.result.failed" class="text-admin-base text-ink-2 tabular-nums">{{ trans('approvals.result', { done: formatNumber(r.result.done), failed: formatNumber(0) }) }}</p>
                <!-- an executed bulk run where some records failed: the partial result with the records and why (04 §5 "bulk partial failure") -->
                <StateBlock
                    v-if="r.status === 'executed' && r.result.done !== null && (r.result.failed ?? 0) > 0"
                    kind="partial"
                    :title="trans('approvals.result', { done: formatNumber(r.result.done), failed: formatNumber(r.result.failed ?? 0) })"
                    :retryable="false"
                    test-id="ADM-43.partial"
                >
                    <ul v-if="r.result.failed_rows && r.result.failed_rows.length > 0" class="mt-4 flex flex-col">
                        <li v-for="row in r.result.failed_rows" :key="row.id" class="flex flex-wrap items-center gap-8 border-t border-line-subtle py-4 text-admin-base first:border-t-0">
                            <span class="sc-key text-ink">{{ row.label }}</span>
                            <span class="text-ink-2">{{ trans(`members.bulk.codes.${row.code ?? 'failed'}`) }}</span>
                        </li>
                    </ul>
                </StateBlock>
                <StateBlock v-if="r.status === 'failed'" kind="partial" :title="trans('approvals.failed_title')" :body="r.result.error ?? undefined" :retryable="false" />

                <div v-if="r.can_decide || r.can_cancel || r.download" class="flex flex-wrap items-center gap-8">
                    <Button v-if="r.can_decide" size="sm" variant="primary" :icon="PhCheck" data-testid="ADM-43.approve" @click="openDecide(r, 'approve')">{{ trans('approvals.actions.approve') }}</Button>
                    <Button v-if="r.can_decide" size="sm" variant="secondary" :icon="PhX" data-testid="ADM-43.deny" @click="openDecide(r, 'deny')">{{ trans('approvals.actions.deny') }}</Button>
                    <Button v-if="r.can_cancel" size="sm" variant="ghost" :icon="PhProhibit" data-testid="ADM-43.cancel" @click="openCancel(r)">{{ trans('approvals.actions.cancel') }}</Button>
                    <Button v-if="r.download" size="sm" variant="secondary" :icon="PhDownloadSimple" :href="r.download" external data-testid="ADM-43.download">{{ trans('approvals.actions.download') }}</Button>
                    <Badge v-if="r.mine && r.status === 'pending'" tone="neutral">{{ trans('approvals.yours') }}</Badge>
                </div>
            </li>
        </ul>

        <Dialog v-model:open="decideOpen" :title="trans(decision === 'approve' ? 'approvals.approve.title' : 'approvals.deny.title')" :description="target ? title(target) : undefined" test-id="ADM-43.decide">
            <form id="adm43-decide" class="flex flex-col gap-16" novalidate @submit.prevent="submitDecision">
                <p class="text-admin-base text-ink-2">{{ trans(decision === 'approve' ? 'approvals.approve.body' : 'approvals.deny.body') }}</p>
                <Field :label="trans('approvals.comment_label')" :hint="trans(decision === 'approve' ? 'approvals.comment_optional' : 'approvals.comment_required')" :error="commentError" :required="decision === 'deny'" :optional="decision === 'approve'">
                    <Textarea v-model="comment" :rows="3" :maxlength="1000" show-count data-testid="ADM-43.comment" />
                </Field>
                <p v-if="action.error.value" class="text-admin-base text-danger" role="alert">{{ action.error.value }}</p>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="decideOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm43-decide" :variant="decision === 'approve' ? 'primary' : 'danger'" :loading="action.processing.value" data-testid="ADM-43.decide.confirm">
                    {{ trans(decision === 'approve' ? 'approvals.actions.approve' : 'approvals.actions.deny') }}
                </Button>
            </template>
        </Dialog>

        <ConfirmDialog v-model:open="cancelOpen" :title="trans('approvals.cancel.title')" :body="trans('approvals.cancel.body')" :confirm-label="trans('approvals.actions.cancel')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-43.cancel-dialog" @confirm="submitCancel" />
    </div>
</template>
