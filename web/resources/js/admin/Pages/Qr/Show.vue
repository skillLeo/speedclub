<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhProhibit } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ChartCard from '../../Components/patterns/ChartCard.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import ActivityTimeline, { type TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Button, ConfirmDialog, QrCodeText, SegmentedControl, Skeleton, StatusPill } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDate, formatDateTime, formatDayShort, formatNumber, formatQrCode } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';

/**
 * ADM-19 QR detail (06 §3 QR): daily scans of the last 30 or 90 days (counts only), the code's history (created, revoked, reissued, by
 * whom), the vehicle's other codes, and Sperren / Neu ausgeben (qr.revoke, reason, recent password; the owner is mailed).
 */
interface Qr {
    id: string;
    code: string;
    display_code: string;
    status: 'active' | 'revoked';
    revoked_reason: string | null;
    revoked_at: string | null;
    created_at: string | null;
    vehicle: { id: string; title: string; status: string; deleted: boolean } | null;
    owner: { id: string; username: string | null } | null;
    can_reissue: boolean;
}
interface HistoryItem {
    kind: 'created' | 'revoked' | 'revoked_by_staff' | 'reissued_by_staff' | 'issued_by_staff' | 'other';
    at: string | null;
    actor: string | null;
    reason: string | null;
    code: string | null;
}

const props = defineProps<{
    qr: Qr;
    days: 30 | 90;
    scans: { series: { date: string; value: number }[]; total: number };
    history: HistoryItem[];
    siblings: { id: string; display_code: string; status: string; created_at: string | null }[];
    activity: { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null }[];
}>();

const { can } = usePermissions();
const chartLoading = ref(false);
const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : 'ready'));

const range = computed({
    get: () => String(props.days),
    set: (value: string) => {
        router.get(window.location.pathname, value === '90' ? { days: 90 } : {}, {
            only: ['days', 'scans'],
            preserveState: true,
            preserveScroll: true,
            replace: true,
            onStart: () => (chartLoading.value = true),
            onFinish: () => (chartLoading.value = false),
            onNetworkError: () => {
                failed.value = true;
                return false;
            },
        });
    },
});
const ranges = computed(() => [
    { value: '30', label: trans('qr.detail.days_30') },
    { value: '90', label: trans('qr.detail.days_90') },
]);
// The forced empty state is the real zero state: axes and "Kein Scan in den letzten 30 Tagen" (DQ-547), not a frame without axes.
const chartState = computed(() => (state.value === 'loading' || chartLoading.value ? 'loading' : props.scans.series.length === 0 ? 'empty' : 'ready'));
const code = computed(() => formatQrCode(props.qr.code));
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));

const action = useAdminAction();
const revokeOpen = ref(false);
const reissueOpen = ref(false);
const url = (name: 'revoke' | 'reissue') => routeOr(`admin.qr.${name}`, `/admin/qr/${props.qr.id}/${name}`, { qr: props.qr.id });
function run(name: 'revoke' | 'reissue', reason: string | null): void {
    action.run('post', url(name), { reason: reason ?? '' }, { sensitive: true, onSuccess: () => ((name === 'revoke' ? revokeOpen : reissueOpen).value = false) });
}
const vehicleHref = (id: string) => routeOr('admin.vehicles.show', `/admin/vehicles/${id}`, { vehicle: id });
const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
const qrHref = (id: string) => routeOr('admin.qr.show', `/admin/qr/${id}`, { qr: id });

// ---- QA overlays (?dialog=revoke|reissue, non-production, DQ-529) -------------------------------------------------------------
const qaOverlay = qaDialog();
onMounted(async () => {
    if (qaOverlay === 'revoke' && props.qr.status === 'active') revokeOpen.value = true;
    else if (qaOverlay === 'reissue' && props.qr.can_reissue) reissueOpen.value = true;
    else return;
    await nextTick();
    if (qaDialogFailed()) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="code" />
    <div class="flex flex-col gap-24" data-testid="ADM-19" :data-qa-state="state">
        <PageHeader :title="code" :crumbs="[{ label: trans('shell.groups.qr') }, { label: trans('qr.title'), href: routeOr('admin.qr.index', '/admin/qr') }]">
            <template #badge>
                <StatusPill :tone="qr.status === 'active' ? 'success' : 'neutral'" :label="trans(`qr.status.${qr.status}`)" data-testid="ADM-19.status" />
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-8 text-supporting text-ink-2 tabular-nums">
                    <Link v-if="qr.vehicle && !qr.vehicle.deleted" :href="vehicleHref(qr.vehicle.id)" :class="[focusRing, 'inline-flex h-32 items-center rounded-xs text-ink hover:underline']">{{ qr.vehicle.title }}</Link>
                    <span v-else>{{ trans('qr.no_vehicle') }}</span>
                    <template v-if="qr.owner">
                        <span>·</span>
                        <Link :href="memberHref(qr.owner.id)" :class="[focusRing, 'sc-key inline-flex h-32 items-center rounded-xs hover:underline']">{{ qr.owner.username ? `@${qr.owner.username}` : '–' }}</Link>
                    </template>
                    <span>·</span>
                    <span>{{ trans('qr.detail.created', { date: formatDateTime(qr.created_at) }) }}</span>
                    <template v-if="qr.revoked_at">
                        <span>·</span>
                        <span>{{ trans('qr.detail.revoked', { date: formatDateTime(qr.revoked_at), reason: qr.revoked_reason ? trans(`qr.reasons.${qr.revoked_reason}`) : '–' }) }}</span>
                    </template>
                </p>
            </template>
            <template v-if="can('qr.revoke')" #actions>
                <Button v-if="qr.can_reissue" size="sm" variant="primary" :icon="PhArrowsClockwise" data-testid="ADM-19.reissue" @click="(action.reset(), (reissueOpen = true))">{{ trans('qr.actions.reissue') }}</Button>
                <Button v-if="qr.status === 'active'" size="sm" variant="destructive" :icon="PhProhibit" data-testid="ADM-19.revoke" @click="(action.reset(), (revokeOpen = true))">{{ trans('qr.actions.revoke') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('qr.detail.error')" :body="trans('ui.state.error_body')" test-id="ADM-19.error" @retry="router.reload()" />

        <div v-else class="flex min-w-0 flex-col gap-32 desktop:flex-row">
            <div class="flex min-w-0 flex-1 flex-col gap-24">
                <div class="flex flex-wrap items-center justify-between gap-12">
                    <p class="text-supporting text-ink-2 tabular-nums" aria-live="polite">
                        <template v-if="chartState === 'loading'">{{ trans('qr.detail.loading') }}</template>
                        <template v-else>{{ trans('qr.detail.total', { count: formatNumber(state === 'empty' ? 0 : scans.total), days: formatNumber(days) }) }}</template>
                    </p>
                    <SegmentedControl v-model="range" :label="trans('qr.detail.range')" :options="ranges" :disabled="chartLoading" data-testid="ADM-19.range" />
                </div>
                <ChartCard
                    type="line"
                    :title="trans('qr.detail.chart_title', { days: formatNumber(days) })"
                    :description="trans('qr.detail.chart_body', { days: formatNumber(days) })"
                    :labels="scans.series.map((d) => formatDayShort(d.date))"
                    :series="[{ key: 'scans', label: trans('qr.detail.series'), values: state === 'empty' ? scans.series.map(() => 0) : scans.series.map((d) => d.value), accent: true }]"
                    :state="chartState"
                    :zero-text="trans('qr.detail.zero', { days: formatNumber(days) })"
                    test-id="ADM-19.chart"
                />

                <section class="flex flex-col gap-12" :aria-label="trans('qr.detail.history')" data-testid="ADM-19.history">
                    <h2 class="text-title-s text-ink">{{ trans('qr.detail.history') }}</h2>
                    <div v-if="state === 'loading'" class="flex flex-col gap-8" aria-busy="true">
                        <Skeleton v-for="n in 3" :key="n" class="h-40 w-full" />
                    </div>
                    <ol v-else class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                        <li v-for="(item, index) in history" :key="index" class="flex flex-wrap items-center gap-12 border-b border-line-subtle px-12 py-8 text-supporting last:border-b-0">
                            <span class="w-160 shrink-0 text-ink-2 tabular-nums">{{ formatDateTime(item.at) }}</span>
                            <span class="min-w-0 flex-1 text-ink">{{ trans(`qr.history.${item.kind}`, { code: item.code ? formatQrCode(item.code) : '' }) }}</span>
                            <span class="sc-key text-ink-2">{{ item.actor ?? (item.kind === 'created' ? trans('qr.history.owner_or_system') : trans('audit.actor.system')) }}</span>
                            <span v-if="item.reason" class="basis-full text-helper text-ink-3">{{ item.kind === 'revoked' ? trans(`qr.reasons.${item.reason}`) : item.reason }}</span>
                        </li>
                    </ol>
                </section>

                <section v-if="siblings.length > 0" class="flex flex-col gap-12" :aria-label="trans('qr.detail.siblings')" data-testid="ADM-19.siblings">
                    <h2 class="text-title-s text-ink">{{ trans('qr.detail.siblings') }}</h2>
                    <ul class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                        <li v-for="item in siblings" :key="item.id" class="flex h-40 items-center gap-12 border-b border-line-subtle px-12 text-supporting last:border-b-0">
                            <QrCodeText :code="item.display_code" :href="qrHref(item.id)" />
                            <StatusPill :tone="item.status === 'active' ? 'success' : 'neutral'" :label="trans(`qr.status.${item.status}`)" />
                            <span class="ml-auto text-ink-3 tabular-nums">{{ formatDate(item.created_at) }}</span>
                        </li>
                    </ul>
                </section>
            </div>
            <aside class="min-w-0 shrink-0 desktop:w-280 desktop:border-l desktop:border-line-subtle desktop:pl-24 wide:w-320">
                <ActivityTimeline :entries="activity" :state="state === 'loading' ? 'loading' : 'ready'" test-id="ADM-19.activity" />
            </aside>
        </div>

        <ConfirmDialog v-model:open="revokeOpen" :title="trans('qr.revoke.title', { code })" :body="trans('qr.revoke.body')" :confirm-label="trans('qr.actions.revoke')" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-19.revoke-dialog" @confirm="(r: string | null) => run('revoke', r)" />
        <ConfirmDialog v-model:open="reissueOpen" :title="trans('qr.reissue.title')" :body="trans('qr.reissue.body')" :confirm-label="trans('qr.actions.reissue')" tone="neutral" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-19.reissue-dialog" @confirm="(r: string | null) => run('reissue', r)" />
    </div>
</template>
