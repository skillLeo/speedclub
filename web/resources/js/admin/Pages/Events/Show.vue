<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowsClockwise, PhCheck, PhLockSimple, PhProhibit, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Button, ConfirmDialog, EmptyQueue, Skeleton, StatusPill, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { caseHref, statusTones as caseTones } from '../Moderation/shared';
import EventDetails from './Partials/EventDetails.vue';
import { queueUrl, statusLabel, statusTones, useEventWrites, type EventAction, type EventDetail } from './shared';

/**
 * ADM-54 Treffen-Detail (09 §10.2 record page, §10.3; ADR-437/439): the event as staff review it (exact place included, its first view
 * a day audited), answers and organiser updates, reports about it, and the activity column from the audit log. Header actions by
 * state: Freigeben / Ablehnen (in review), Absagen (published, not over; the attendees read the reason), Zurück in die Prüfung (a staff
 * decision nobody answered yet). Each posts the version shown; "Inzwischen geändert" when the event changed meanwhile. Not on the
 * four-eyes list of 06 §2. Without moderation.decide: read-only.
 */
type Activity = { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null };
const props = defineProps<{ event: EventDetail; activity?: Activity[] }>();

const { can } = usePermissions();
const state = usePageState();
const e = computed(() => props.event);
const mayDecide = computed(() => can('moderation.decide'));

const tab = ref(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tab') ?? 'overview');
const tabs = computed<TabItem[]>(() => [
    { value: 'overview', label: trans('events.record.tabs.overview') },
    { value: 'answers', label: trans('events.record.tabs.answers'), count: e.value.updates.length },
    { value: 'reports', label: trans('events.record.tabs.reports'), count: e.value.cases.length },
]);
const crumbs = computed(() => [{ label: trans('shell.groups.vehicles_media') }, { label: trans('events.record.crumb'), href: queueUrl() }]);
const status = computed(() => ({ tone: statusTones[e.value.status], label: statusLabel(e.value) }));
const activity = computed<TimelineEntry[]>(() => (props.activity ?? []).map((a) => ({ id: a.id, occurred_at: a.occurred_at, label: actionLabel(a.action), actor: actorName(a), reason: a.reason })));
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=event&filter[target_id]=${e.value.id}` : undefined));

// ---- actions ----------------------------------------------------------------------------------------------------------------------
const writes = useEventWrites();
const dialog = ref<Exclude<EventAction, 'approve'> | null>((['reject', 'cancel', 'reopen'] as const).find((name) => qaDialog() === name) ?? null);
const dialogOpen = computed({ get: () => dialog.value !== null, set: (open: boolean) => (dialog.value = open ? dialog.value : null) });
function run(action: EventAction, reason: string | null = null): void {
    writes.post(e.value, action, reason === null ? {} : { reason }, () => (dialog.value = null));
}
const dialogCopy = computed(() => {
    const name = dialog.value ?? 'reject';
    return {
        title: trans(`events.${name}_dialog.title`, { title: e.value.title }),
        body: trans(`events.${name}_dialog.body`),
        reason: name === 'reopen' ? undefined : trans(`events.${name}_dialog.reason`),
        confirm: trans(`events.actions.${name}`),
    };
});
const anyAction = computed(() => mayDecide.value && (e.value.can.approve || e.value.can.reject || e.value.can.cancel || e.value.can.reopen));
</script>

<template>
    <Head :title="e.title" />
    <div data-testid="ADM-54-page" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('events.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-54.error" @retry="router.reload()" />
        <StateBlock v-if="writes.conflict.value" class="mb-24" kind="partial" :title="trans('events.conflict.title')" :body="trans('events.conflict.changed')" :retryable="false" test-id="ADM-54.conflict">
            <div class="mt-8"><Button size="sm" variant="secondary" :icon="PhArrowsClockwise" data-testid="ADM-54.conflict.reload" @click="writes.reload()">{{ trans('events.actions.reload') }}</Button></div>
        </StateBlock>
        <p v-else-if="writes.error.value && dialog === null && state !== 'error'" class="mb-24 text-admin-base text-danger" role="alert" data-testid="ADM-54.error-text">{{ writes.error.value }}</p>
        <RecordLayout
            v-if="state !== 'error'"
            v-model:tab="tab"
            :title="e.title"
            :crumbs="crumbs"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('events.record.tabs.label')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="state === 'loading'"
            :loading-actions="2"
            loading-meta="line"
            test-id="ADM-54"
        >
            <template #loading>
                <div class="flex flex-col gap-16 desktop:flex-row" aria-hidden="true">
                    <Skeleton class="aspect-video w-full desktop:w-320" />
                    <div class="flex grow flex-col gap-12"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /><Skeleton shape="text" class="w-full" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-54.meta">
                    <span>{{ trans(`events.types.${e.type}`) }}</span>
                    <span aria-hidden="true">·</span>
                    <time :datetime="e.starts_at ?? undefined">{{ formatDateTime(e.starts_at) }}</time>
                    <template v-if="e.city"><span aria-hidden="true">·</span><span>{{ e.city }}</span></template>
                    <template v-if="e.organiser.username"><span aria-hidden="true">·</span><span class="sc-key">{{ `@${e.organiser.username}` }}</span></template>
                </p>
            </template>
            <template #actions>
                <template v-if="anyAction">
                    <Button v-if="e.can.approve" variant="primary" size="sm" :icon="PhCheck" :loading="writes.processing.value === 'approve'" :disabled="writes.processing.value !== null || writes.conflict.value" data-testid="ADM-54.approve" @click="run('approve')">
                        {{ trans('events.actions.approve') }}
                    </Button>
                    <Button v-if="e.can.reject" variant="destructive" size="sm" :icon="PhX" :disabled="writes.processing.value !== null || writes.conflict.value" data-testid="ADM-54.reject" @click="dialog = 'reject'">{{ trans('events.actions.reject') }}</Button>
                    <Button v-if="e.can.cancel" variant="destructive" size="sm" :icon="PhProhibit" :disabled="writes.processing.value !== null || writes.conflict.value" data-testid="ADM-54.cancel" @click="dialog = 'cancel'">{{ trans('events.actions.cancel') }}</Button>
                    <Button v-if="e.can.reopen" variant="secondary" size="sm" :icon="PhArrowCounterClockwise" :disabled="writes.processing.value !== null || writes.conflict.value" data-testid="ADM-54.reopen" @click="dialog = 'reopen'">{{ trans('events.actions.reopen') }}</Button>
                </template>
            </template>

            <template #overview>
                <div class="flex flex-col gap-24">
                    <p v-if="!mayDecide" class="flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-54.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('events.view_only') }}</p>

                    <dl v-if="e.review.reviewed_at || e.cancellation.cancelled_at || e.removed_at" class="flex flex-col gap-12 border-b border-line-subtle pb-20" data-testid="ADM-54.decision">
                        <div v-if="e.review.reviewed_at" class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('events.detail.review') }}</dt>
                            <dd class="flex flex-col gap-2 text-admin-base text-ink">
                                <span class="tabular-nums">{{ trans('events.detail.reviewed', { name: e.review.reviewed_by ?? '–', date: formatDateTime(e.review.reviewed_at) }) }}</span>
                                <span v-if="e.review.reason" class="max-w-720 whitespace-pre-line text-ink-2">{{ e.review.reason }}</span>
                            </dd>
                        </div>
                        <div v-if="e.cancellation.cancelled_at" class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('events.detail.cancellation') }}</dt>
                            <dd class="flex flex-col gap-2 text-admin-base text-ink">
                                <span class="tabular-nums">{{ trans(e.cancellation.by_staff ? 'events.detail.cancelled_by_staff' : 'events.detail.cancelled_by_organiser', { date: formatDateTime(e.cancellation.cancelled_at) }) }}</span>
                                <span v-if="e.cancellation.reason" class="max-w-720 whitespace-pre-line text-ink-2">{{ e.cancellation.reason }}</span>
                            </dd>
                        </div>
                        <div v-if="e.removed_at" class="text-admin-base text-ink tabular-nums">{{ trans('events.detail.removed', { date: formatDateTime(e.removed_at) }) }}</div>
                    </dl>

                    <EventDetails :event="e" test-id="ADM-54.detail" />
                </div>
            </template>

            <template #answers>
                <div class="flex flex-col gap-16" data-testid="ADM-54.answers">
                    <p class="flex flex-wrap gap-x-16 text-admin-base text-ink tabular-nums">
                        <span>{{ trans('events.detail.going') }} {{ formatNumber(e.counts.going) }}</span>
                        <span>{{ trans('events.detail.interested') }} {{ formatNumber(e.counts.interested) }}</span>
                        <span>{{ trans('events.detail.waitlist') }} {{ formatNumber(e.counts.waitlist) }}</span>
                    </p>
                    <h3 class="text-admin-base-strong text-ink">{{ trans('events.record.updates') }}</h3>
                    <EmptyQueue v-if="e.updates.length === 0" compact variant="quiet" :title="trans('events.record.no_updates')" />
                    <ul v-else class="flex flex-col">
                        <li v-for="update in e.updates" :key="update.id" class="flex flex-col gap-4 border-t border-line-subtle py-12 first:border-t-0 first:pt-0">
                            <time class="text-caption text-ink-3 tabular-nums" :datetime="update.created_at ?? undefined">{{ formatDateTime(update.created_at) }}</time>
                            <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ update.body }}</p>
                        </li>
                    </ul>
                </div>
            </template>

            <template #reports>
                <div class="flex flex-col gap-8" data-testid="ADM-54.reports">
                    <EmptyQueue v-if="e.cases.length === 0" compact :title="trans('events.record.no_cases')" />
                    <ul v-else class="flex flex-col">
                        <li v-for="item in e.cases" :key="item.id" class="flex min-h-40 items-center justify-between gap-12 border-t border-line-subtle first:border-t-0">
                            <Link :href="caseHref(item.id)" :class="[focusRing, 'rounded-xs text-admin-base text-ink tabular-nums hover:underline']">{{ trans('events.record.case', { date: formatDateTime(item.created_at) }) }}</Link>
                            <StatusPill :tone="caseTones[item.status as keyof typeof caseTones] ?? 'neutral'" :label="trans(`moderation.status.${item.status}`)" />
                        </li>
                    </ul>
                </div>
            </template>
        </RecordLayout>

        <ConfirmDialog
            v-model:open="dialogOpen"
            :title="dialogCopy.title"
            :body="dialogCopy.body"
            :confirm-label="dialogCopy.confirm"
            :reason="dialog !== 'reopen'"
            :reason-label="dialogCopy.reason"
            :reason-first="dialog !== 'reopen'"
            :tone="dialog === 'reopen' ? 'neutral' : 'danger'"
            :processing="writes.processing.value !== null"
            :error="writes.error.value"
            :test-id="`ADM-54.${dialog ?? 'reject'}-dialog`"
            @confirm="(reason) => run(dialog ?? 'reject', reason)"
        />
    </div>
</template>
