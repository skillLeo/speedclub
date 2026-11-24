<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhArrowSquareOut, PhEye, PhEyeSlash, PhTrash, PhUsersThree } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import HideDialog from '../../Components/decisions/HideDialog.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import { Badge, Button, ConfirmDialog, EmptyQueue, Field, Skeleton, StatusPill, Textarea, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import type { FeedEntry } from '../Members/types';
import { caseHref, statusTones as caseTones } from '../Moderation/shared';
import { actionUrl, indexUrl, stateLabel, stateTone, type CrewCase, type CrewDetail, type CrewMemberRow } from './shared';

/**
 * ADM-81 Crew (R4-2.3, contract-crews.md §6/C6): header with the state and the Staff actions, Überblick (description, logo, cover, facts,
 * open requests and invitations), Mitglieder (role, since), Meldungen (the moderation cases on the crew) and the activity column (crew.*
 * and the decisions). Actions by state: Ausblenden (active: a DSA removal with the statement of reasons the founder reads), Einblenden
 * (hidden by a decision: its reversal, with the facts the founder reads), Löschen (only a hidden crew) and Wiederherstellen (deleted by
 * staff → hidden). Each ⚿, audited by the Staff actions.
 */
const props = defineProps<{ crew: CrewDetail; members: { rows: CrewMemberRow[]; total: number }; cases: CrewCase[]; activity: FeedEntry[] }>();

const { can } = usePermissions();
const state = usePageState();
const c = computed(() => props.crew);
const mayDecide = computed(() => can('moderation.decide'));

const tab = ref(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tab') ?? 'overview');
const tabs = computed<TabItem[]>(() => [
    { value: 'overview', label: trans('crews.record.tabs.overview') },
    { value: 'members', label: trans('crews.record.tabs.members'), count: props.members.total },
    { value: 'reports', label: trans('crews.record.tabs.reports'), count: props.cases.length },
]);
const crumbs = computed(() => [{ label: trans('shell.groups.moderation') }, { label: trans('crews.title'), href: indexUrl() }]);
const status = computed(() => ({ tone: stateTone[c.value.state], label: stateLabel(c.value.state) }));
const activity = computed<TimelineEntry[]>(() => props.activity.map((a) => ({ id: a.id, occurred_at: a.occurred_at, label: actionLabel(a.action), actor: actorName(a), reason: a.reason })));
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=crew&filter[target_id]=${c.value.id}` : undefined));
const memberHref = (id: string): string | null => (hasRoute('admin.members.show') ? routeOr('admin.members.show', `/admin/members/${id}`, { member: id }) : null);
const stateNote = computed(() => {
    if (c.value.state === 'hidden' && c.value.hidden_since) return trans('crews.record.hidden_since', { date: formatDateTime(c.value.hidden_since) });
    if (c.value.state === 'removed' && c.value.removed_at) return trans('crews.record.removed_at', { date: formatDateTime(c.value.removed_at) });
    if (c.value.state === 'deleted' && c.value.deleted_at) return trans('crews.record.deleted_at', { date: formatDateTime(c.value.deleted_at) });
    if (c.value.state === 'ended' && c.value.deleted_at) return trans('crews.record.ended_at', { date: formatDateTime(c.value.deleted_at) });
    return null;
});

// ---- actions ----------------------------------------------------------------------------------------------------------------
type Dialog = 'hide' | 'unhide' | 'remove' | 'restore';
const action = useAdminAction();
const dialog = ref<Dialog | null>(null);
const hideOpen = computed({ get: () => dialog.value === 'hide', set: (open: boolean) => (dialog.value = open ? 'hide' : null) });
const confirmOpen = computed({ get: () => dialog.value !== null && dialog.value !== 'hide', set: (open: boolean) => (dialog.value = open ? dialog.value : null) });
const unhideFacts = ref('');
const factsError = ref<string | null>(null);
const anyAction = computed(() => mayDecide.value && Object.values(c.value.can).some(Boolean));

function open(which: Dialog): void {
    action.reset();
    unhideFacts.value = '';
    factsError.value = null;
    dialog.value = which;
}
const close = (): void => {
    dialog.value = null;
};
function hide(payload: Record<string, string | null>): void {
    action.run('post', actionUrl(c.value.id, 'hide'), payload, { sensitive: true, onSuccess: close });
}
function confirm(): void {
    const which = dialog.value;
    if (which === null || which === 'hide') return;
    if (which === 'unhide') {
        const length = unhideFacts.value.trim().length;
        if (length < 10 || length > 5000) {
            factsError.value = trans('decisions.errors.facts');
            return;
        }
        factsError.value = null;
    }
    const data = which === 'unhide' ? { facts: unhideFacts.value.trim() } : {};
    action.run('post', actionUrl(c.value.id, which), data, { sensitive: true, onSuccess: close });
}
const confirmCopy = computed(() => {
    const which = dialog.value === null || dialog.value === 'hide' ? 'remove' : dialog.value;
    return { title: trans(`crews.${which}.title`, { name: c.value.name }), body: trans(`crews.${which}.body`), confirm: trans(`crews.actions.${which}`), tone: which === 'remove' ? ('danger' as const) : ('neutral' as const), which };
});

// ---- QA overlays (?dialog=hide|unhide|remove|restore, non-production, DQ-529) ------------------------------------------------
const qaOverlay = qaDialog();
const hidePreset = qaOverlay === 'hide' ? { template: 'impersonation' } : null;
onMounted(async () => {
    if (qaOverlay !== 'hide' && qaOverlay !== 'unhide' && qaOverlay !== 'remove' && qaOverlay !== 'restore') return;
    open(qaOverlay);
    await nextTick();
    if (qaDialogFailed()) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="c.name" />
    <div data-testid="ADM-81-page" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('crews.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-81.error" @retry="router.reload()" />
        <p v-else-if="action.error.value && dialog === null" class="mb-24 text-admin-base text-danger" role="alert" data-testid="ADM-81.error-text">{{ action.error.value }}</p>
        <RecordLayout
            v-if="state !== 'error'"
            v-model:tab="tab"
            :title="c.name"
            :crumbs="crumbs"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('crews.record.tabs.label')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="state === 'loading'"
            :loading-actions="2"
            loading-meta="line"
            test-id="ADM-81"
        >
            <template #loading>
                <div class="flex flex-col gap-16 desktop:flex-row" aria-hidden="true">
                    <Skeleton class="aspect-video w-full desktop:w-320" />
                    <div class="flex grow flex-col gap-12"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /><Skeleton shape="text" class="w-full" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-81.meta">
                    <span class="sc-key">{{ `/crews/${c.slug}` }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ trans(`crews.join_modes.${c.join_mode}`) }}</span>
                    <template v-if="c.bundesland"><span aria-hidden="true">·</span><span>{{ c.bundesland }}</span></template>
                    <template v-if="stateNote"><span aria-hidden="true">·</span><span>{{ stateNote }}</span></template>
                    <Badge v-if="c.is_sample">{{ trans('crews.sample') }}</Badge>
                </p>
            </template>
            <template #actions>
                <Button v-if="c.public_url" size="sm" variant="ghost" :icon="PhArrowSquareOut" :href="c.public_url" external data-testid="ADM-81.public">{{ trans('crews.actions.public') }}</Button>
                <template v-if="anyAction">
                    <Button v-if="c.can.hide" size="sm" variant="destructive" :icon="PhEyeSlash" :disabled="action.processing.value" data-testid="ADM-81.action.hide" @click="open('hide')">{{ trans('crews.actions.hide') }}</Button>
                    <Button v-if="c.can.unhide" size="sm" variant="secondary" :icon="PhEye" :disabled="action.processing.value" data-testid="ADM-81.action.unhide" @click="open('unhide')">{{ trans('crews.actions.unhide') }}</Button>
                    <Button v-if="c.can.remove" size="sm" variant="destructive" :icon="PhTrash" :disabled="action.processing.value" data-testid="ADM-81.action.remove" @click="open('remove')">{{ trans('crews.actions.remove') }}</Button>
                    <Button v-if="c.can.restore" size="sm" variant="secondary" :icon="PhArrowCounterClockwise" :disabled="action.processing.value" data-testid="ADM-81.action.restore" @click="open('restore')">{{ trans('crews.actions.restore') }}</Button>
                </template>
            </template>

            <template #overview>
                <div class="flex flex-col gap-24" data-testid="ADM-81.overview">
                    <div class="flex flex-col gap-16 desktop:flex-row">
                        <img v-if="c.cover" :src="c.cover" alt="" class="aspect-video w-full shrink-0 rounded-sm object-cover desktop:w-320" data-testid="ADM-81.cover" />
                        <div v-else class="flex aspect-video w-full shrink-0 items-center justify-center rounded-sm border border-dashed border-line text-caption text-ink-3 desktop:w-320">{{ trans('crews.record.no_cover') }}</div>
                        <div class="flex min-w-0 flex-col gap-12">
                            <div class="flex items-center gap-12">
                                <img v-if="c.logo" :src="c.logo" alt="" class="size-48 shrink-0 rounded-sm object-cover" data-testid="ADM-81.logo" />
                                <span v-else class="flex size-48 shrink-0 items-center justify-center rounded-sm border border-line-subtle text-ink-3" aria-hidden="true"><PhUsersThree :size="20" /></span>
                                <p class="text-admin-base-strong text-ink">{{ c.name }}</p>
                            </div>
                            <p class="max-w-720 whitespace-pre-line text-admin-base" :class="c.description ? 'text-ink' : 'text-ink-3'" data-testid="ADM-81.description">{{ c.description ?? trans('crews.record.no_description') }}</p>
                        </div>
                    </div>

                    <dl class="grid grid-cols-1 gap-x-24 gap-y-16 border-t border-line-subtle pt-20 tablet:grid-cols-2" data-testid="ADM-81.facts">
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.founder') }}</dt>
                            <dd class="text-admin-base text-ink">
                                <component :is="memberHref(c.founder.id) ? Link : 'span'" v-if="c.founder" :href="memberHref(c.founder.id) ?? undefined" :class="[focusRing, 'sc-key rounded-xs hover:underline']">{{ c.founder.username ? `@${c.founder.username}` : '–' }}</component>
                                <span v-else class="text-ink-3">{{ trans('crews.record.no_founder') }}</span>
                            </dd>
                        </div>
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.members') }}</dt>
                            <dd class="text-admin-base text-ink tabular-nums">{{ formatNumber(c.members) }}</dd>
                        </div>
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.open_requests') }}</dt>
                            <dd class="text-admin-base text-ink tabular-nums" data-testid="ADM-81.open-requests">{{ formatNumber(c.open_requests) }}</dd>
                        </div>
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.open_invites') }}</dt>
                            <dd class="text-admin-base text-ink tabular-nums" data-testid="ADM-81.open-invites">{{ formatNumber(c.open_invites) }}</dd>
                        </div>
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.created') }}</dt>
                            <dd class="text-admin-base text-ink tabular-nums">{{ formatDateTime(c.created_at) }}</dd>
                        </div>
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.updated') }}</dt>
                            <dd class="text-admin-base text-ink tabular-nums">{{ formatDateTime(c.updated_at) }}</dd>
                        </div>
                        <div v-if="c.previous_slug" class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('crews.fields.previous_slug') }}</dt>
                            <dd class="sc-key text-admin-base text-ink">{{ `/crews/${c.previous_slug}` }}</dd>
                        </div>
                    </dl>
                </div>
            </template>

            <template #members>
                <div class="flex flex-col gap-8" data-testid="ADM-81.members">
                    <EmptyQueue v-if="members.rows.length === 0" compact variant="quiet" :title="trans('crews.record.no_members')" :body="c.state === 'deleted' ? trans('crews.record.no_members_deleted') : c.state === 'ended' ? trans('crews.record.no_members_ended') : undefined" />
                    <template v-else>
                        <table class="w-full border-collapse text-admin-base">
                            <caption class="sr-only">{{ trans('crews.record.members_caption') }}</caption>
                            <thead>
                                <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                                    <th scope="col" class="px-12">{{ trans('crews.columns.member') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('crews.columns.role') }}</th>
                                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('crews.columns.joined') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in members.rows" :key="row.id" class="h-40 border-b border-line-subtle last:border-b-0" data-testid="ADM-81.member">
                                    <td class="px-12">
                                        <component :is="memberHref(row.member.id) ? Link : 'span'" v-if="row.member" :href="memberHref(row.member.id) ?? undefined" :class="[focusRing, 'sc-key inline-flex min-h-32 items-center rounded-xs text-ink hover:underline']">{{ row.member.username ? `@${row.member.username}` : '–' }}</component>
                                        <span v-else class="text-ink-3">{{ trans('crews.record.member_gone') }}</span>
                                        <Badge v-if="row.member && row.member.status !== 'active'" class="ml-8">{{ trans(`members.status.${row.member.status}`) }}</Badge>
                                    </td>
                                    <td class="whitespace-nowrap px-12 text-ink-2">{{ trans(`crews.roles.${row.role}`) }}</td>
                                    <td class="whitespace-nowrap px-12 text-right text-ink-2 tabular-nums"><time :datetime="row.joined_at">{{ formatDateTime(row.joined_at) }}</time></td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-if="members.total > members.rows.length" class="text-caption text-ink-3 tabular-nums">{{ trans('crews.record.members_more', { shown: formatNumber(members.rows.length), total: formatNumber(members.total) }) }}</p>
                    </template>
                </div>
            </template>

            <template #reports>
                <div class="flex flex-col gap-8" data-testid="ADM-81.reports">
                    <EmptyQueue v-if="cases.length === 0" compact :title="trans('crews.record.no_cases')" />
                    <ul v-else class="flex flex-col">
                        <li v-for="item in cases" :key="item.id" class="flex min-h-40 items-center justify-between gap-12 border-t border-line-subtle first:border-t-0" data-testid="ADM-81.case">
                            <Link :href="caseHref(item.id)" :class="[focusRing, 'rounded-xs text-admin-base text-ink tabular-nums hover:underline']">{{ trans(item.origin === 'staff' ? 'crews.record.case_staff' : 'crews.record.case', { date: formatDateTime(item.created_at), count: formatNumber(item.report_count) }) }}</Link>
                            <span class="flex items-center gap-8">
                                <span v-if="item.decision" class="text-caption text-ink-2">{{ trans(`moderation.outcomes.${item.decision.action}`) }}</span>
                                <StatusPill :tone="caseTones[item.status as keyof typeof caseTones] ?? 'neutral'" :label="trans(`moderation.status.${item.status}`)" />
                            </span>
                        </li>
                    </ul>
                </div>
            </template>
        </RecordLayout>

        <HideDialog
            v-model:open="hideOpen"
            :preset="hidePreset"
            :title="trans('crews.hide.title', { name: c.name })"
            :description="trans('crews.hide.body')"
            subject="crew"
            :confirm-label="trans('crews.actions.hide')"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-81.hide"
            @submit="hide"
        />
        <ConfirmDialog
            v-model:open="confirmOpen"
            :title="confirmCopy.title"
            :body="confirmCopy.body"
            :confirm-label="confirmCopy.confirm"
            :tone="confirmCopy.tone"
            :processing="action.processing.value"
            :error="factsError ?? action.error.value"
            :test-id="`ADM-81.${confirmCopy.which}`"
            @confirm="confirm"
        >
            <Field v-if="dialog === 'unhide'" :label="trans('crews.unhide.facts')" :hint="trans('crews.unhide.facts_hint')" required>
                <Textarea v-model="unhideFacts" :rows="3" :maxlength="5000" data-testid="ADM-81.unhide.facts" />
            </Field>
        </ConfirmDialog>
    </div>
</template>
