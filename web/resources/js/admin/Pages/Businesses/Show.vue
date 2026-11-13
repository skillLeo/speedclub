<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowsClockwise, PhCheck, PhLockSimple, PhProhibit, PhSealCheck, PhX } from '@phosphor-icons/vue';
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
import { formatDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { caseHref, statusTones as caseTones } from '../Moderation/shared';
import BusinessDetails from './Partials/BusinessDetails.vue';
import { queueUrl, statusLabel, statusTones, useBusinessWrites, type BusinessAction, type BusinessDetail } from './shared';

/**
 * ADM-56 Betrieb-Detail (09 §8.10, §10.2 record page, §10.3; ADR-455): what staff check before verifying, the reports about the business
 * and the activity column from the audit log. Header actions by state: Verifizieren / Ablehnen (application), Sperren (verified; four-eyes
 * `business.suspend`: the request waits for a second staff member in ADM-43), Wieder freischalten (suspended), Entscheidung zurücknehmen
 * (rejected, or verified without portfolio tags). Every write posts the version shown. Without moderation.decide: read-only.
 */
type Activity = { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null };
const props = defineProps<{ business: BusinessDetail; activity?: Activity[] }>();

const { can } = usePermissions();
const state = usePageState();
const b = computed(() => props.business);
const mayDecide = computed(() => can('moderation.decide'));

const tab = ref(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tab') ?? 'overview');
const tabs = computed<TabItem[]>(() => [
    { value: 'overview', label: trans('businesses.record.tabs.overview') },
    { value: 'reports', label: trans('businesses.record.tabs.reports'), count: b.value.cases.length },
]);
const crumbs = computed(() => [{ label: trans('shell.groups.vehicles_media') }, { label: trans('businesses.record.crumb'), href: queueUrl() }]);
const status = computed(() => ({ tone: statusTones[b.value.status], label: statusLabel(b.value) }));
const activity = computed<TimelineEntry[]>(() => (props.activity ?? []).map((a) => ({ id: a.id, occurred_at: a.occurred_at, label: actionLabel(a.action), actor: actorName(a), reason: a.reason })));
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=business&filter[target_id]=${b.value.id}` : undefined));

// ---- actions ----------------------------------------------------------------------------------------------------------------------
type DialogAction = Exclude<BusinessAction, 'verify'>;
const writes = useBusinessWrites();
const dialog = ref<DialogAction | null>((['reject', 'suspend', 'reinstate', 'reopen'] as const).find((name) => qaDialog() === name) ?? null);
const dialogOpen = computed({ get: () => dialog.value !== null, set: (open: boolean) => (dialog.value = open ? dialog.value : null) });
function run(action: BusinessAction, reason: string | null = null): void {
    writes.post(b.value, action, reason === null ? {} : { reason }, () => (dialog.value = null));
}
const dialogCopy = computed(() => {
    const name = dialog.value ?? 'reject';
    return {
        title: trans(`businesses.${name}_dialog.title`, { name: b.value.name }),
        body: trans(`businesses.${name}_dialog.body`),
        reason: name === 'reopen' ? undefined : trans(`businesses.${name}_dialog.reason`),
        confirm: trans(name === 'suspend' ? 'businesses.actions.request_suspend' : `businesses.actions.${name}`),
    };
});
const busy = computed(() => writes.processing.value !== null || writes.conflict.value);
const anyAction = computed(() => mayDecide.value && Object.values(b.value.can).some(Boolean));
</script>

<template>
    <Head :title="b.name" />
    <div data-testid="ADM-56-page" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('businesses.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-56.error" @retry="router.reload()" />
        <StateBlock v-if="writes.conflict.value" class="mb-24" kind="partial" :title="trans('businesses.conflict.title')" :body="trans('businesses.conflict.changed')" :retryable="false" test-id="ADM-56.conflict">
            <div class="mt-8"><Button size="sm" variant="secondary" :icon="PhArrowsClockwise" data-testid="ADM-56.conflict.reload" @click="writes.reload()">{{ trans('businesses.actions.reload') }}</Button></div>
        </StateBlock>
        <p v-else-if="writes.error.value && dialog === null && state !== 'error'" class="mb-24 text-admin-base text-danger" role="alert" data-testid="ADM-56.error-text">{{ writes.error.value }}</p>
        <RecordLayout
            v-if="state !== 'error'"
            v-model:tab="tab"
            :title="b.name"
            :crumbs="crumbs"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('businesses.record.tabs.label')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="state === 'loading'"
            :loading-actions="2"
            loading-meta="line"
            test-id="ADM-56"
        >
            <template #loading>
                <div class="flex flex-col gap-16 desktop:flex-row" aria-hidden="true">
                    <Skeleton class="aspect-video w-full desktop:w-320" />
                    <div class="flex grow flex-col gap-12"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /><Skeleton shape="text" class="w-full" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-56.meta">
                    <span>{{ trans(`businesses.kinds.${b.kind}`) }}</span>
                    <template v-if="b.city"><span aria-hidden="true">·</span><span>{{ b.city }}</span></template>
                    <template v-if="b.submitted_at"><span aria-hidden="true">·</span><span>{{ trans('businesses.detail.submitted', { date: formatDateTime(b.submitted_at) }) }}</span></template>
                    <template v-if="b.owner.username"><span aria-hidden="true">·</span><span class="sc-key">{{ `@${b.owner.username}` }}</span></template>
                </p>
            </template>
            <template #actions>
                <template v-if="anyAction">
                    <Button v-if="b.can.verify" variant="primary" size="sm" :icon="PhCheck" :loading="writes.processing.value === 'verify'" :disabled="busy" data-testid="ADM-56.verify" @click="run('verify')">{{ trans('businesses.actions.verify') }}</Button>
                    <Button v-if="b.can.reject" variant="destructive" size="sm" :icon="PhX" :disabled="busy" data-testid="ADM-56.reject" @click="dialog = 'reject'">{{ trans('businesses.actions.reject') }}</Button>
                    <Button v-if="b.can.suspend" variant="destructive" size="sm" :icon="PhProhibit" :disabled="busy" data-testid="ADM-56.suspend" @click="dialog = 'suspend'">{{ trans('businesses.actions.suspend') }}</Button>
                    <Button v-if="b.can.reinstate" variant="secondary" size="sm" :icon="PhSealCheck" :disabled="busy" data-testid="ADM-56.reinstate" @click="dialog = 'reinstate'">{{ trans('businesses.actions.reinstate') }}</Button>
                    <Button v-if="b.can.reopen" variant="secondary" size="sm" :icon="PhArrowCounterClockwise" :disabled="busy" data-testid="ADM-56.reopen" @click="dialog = 'reopen'">{{ trans('businesses.actions.reopen') }}</Button>
                </template>
            </template>

            <template #overview>
                <div class="flex flex-col gap-24">
                    <p v-if="!mayDecide" class="flex items-center gap-8 text-admin-base text-ink-2" data-testid="ADM-56.view-only"><PhLockSimple :size="16" class="shrink-0" aria-hidden="true" />{{ trans('businesses.view_only') }}</p>

                    <dl v-if="b.review.reviewed_at || b.review.suspended_at" class="flex flex-col gap-12 border-b border-line-subtle pb-20" data-testid="ADM-56.decision">
                        <div v-if="b.review.reviewed_at" class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('businesses.detail.review') }}</dt>
                            <dd class="flex flex-col gap-2 text-admin-base text-ink">
                                <span class="tabular-nums">{{ trans('businesses.detail.reviewed', { name: b.review.reviewed_by ?? '–', date: formatDateTime(b.review.reviewed_at) }) }}</span>
                                <span v-if="b.review.reason" class="max-w-720 whitespace-pre-line text-ink-2">{{ b.review.reason }}</span>
                            </dd>
                        </div>
                        <div v-if="b.review.suspended_at" class="text-admin-base text-ink tabular-nums">{{ trans('businesses.detail.suspended', { date: formatDateTime(b.review.suspended_at) }) }}</div>
                    </dl>

                    <BusinessDetails :business="b" test-id="ADM-56.detail" />
                </div>
            </template>

            <template #reports>
                <div class="flex flex-col gap-8" data-testid="ADM-56.reports">
                    <EmptyQueue v-if="b.cases.length === 0" compact :title="trans('businesses.record.no_cases')" />
                    <ul v-else class="flex flex-col">
                        <li v-for="item in b.cases" :key="item.id" class="flex min-h-40 items-center justify-between gap-12 border-t border-line-subtle first:border-t-0">
                            <Link :href="caseHref(item.id)" :class="[focusRing, 'rounded-xs text-admin-base text-ink tabular-nums hover:underline']">{{ trans('businesses.record.case', { date: formatDateTime(item.created_at) }) }}</Link>
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
            :four-eyes="dialog === 'suspend'"
            :tone="dialog === 'reopen' || dialog === 'reinstate' ? 'neutral' : 'danger'"
            :processing="writes.processing.value !== null"
            :error="writes.error.value"
            :test-id="`ADM-56.${dialog ?? 'reject'}-dialog`"
            @confirm="(reason) => run(dialog ?? 'reject', reason)"
        />
    </div>
</template>
