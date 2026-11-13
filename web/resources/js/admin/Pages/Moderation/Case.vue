<script setup lang="ts">
import { qaDialogFailed } from '../../composables/pageState';
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhEye, PhGavel, PhHandPointing, PhImageBroken, PhUserCircle, PhUserSwitch } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Badge, Skeleton, Button, Dialog, Field, Select, StatusPill, type TabItem } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { JsonError, requestJson } from '../../lib/http';
import { usePermissions } from '../../lib/permissions';
import { hasRoute, routeOr } from '../../lib/routes';
import { visibilityPill } from '../../lib/vehicleStatus';
import AppealDialog from './Partials/AppealDialog.vue';
import DecisionComposer from './Partials/DecisionComposer.vue';
import EvidencePanel from './Partials/EvidencePanel.vue';
import {
    appealTones,
    caseHref,
    memberHref,
    outcomeTones,
    priorityTooltip,
    reasonText,
    statusTones,
    targetText,
    type AppealItem,
    type CaseSummary,
    type ComposerOptions,
    type DecisionDetail,
    type PriorDecision,
    type ReportItem,
    type SorTemplate,
} from './shared';

/**
 * ADM-21 case (06 §3 Moderation, m3.4-contract §2): the target as members see it now, every report, the evidence (on request, audited), the
 * decision with its appeals, the member's earlier decisions, and the history from the audit log. Header actions: Übernehmen / Übergeben
 * (moderation.decide), Entscheiden (composer, ⚿; a suspension asks for the approval), Einspruch entscheiden (moderation.appeals, another
 * person than the decider). A message case shows no content here: its evidence is ADM-22's.
 */
interface Preview {
    kind: 'member' | 'vehicle' | 'photo' | 'build_update' | 'modification' | 'comment' | 'event' | 'business';
    [key: string]: unknown;
}
const props = defineProps<{
    case: CaseSummary;
    preview: Preview | null;
    reports: ReportItem[];
    decision: DecisionDetail | null;
    prior: PriorDecision[];
    activity: { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null }[];
    composer: ComposerOptions;
    templates: SorTemplate[];
    staffOptions: { id: number; name: string }[];
    messageCase: boolean;
    ai?: { score: number; summary: string | null } | null;
}>();

const { can } = usePermissions();
// DQ-560: the activity column is a summary; the whole history is in the audit log (audit.view).
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=moderation_case&filter[target_id]=${c.value.id}` : undefined));
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));

const c = computed(() => props.case);
const isOpen = computed(() => c.value.status === 'new' || c.value.status === 'in_review');
const tab = ref(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tab') ?? 'overview');
const tabs = computed<TabItem[]>(() => [
    { value: 'overview', label: trans('moderation.case.tabs.overview') },
    { value: 'reports', label: trans('moderation.case.tabs.reports'), count: props.reports.length },
    { value: 'evidence', label: trans('moderation.case.tabs.evidence') },
    { value: 'decision', label: trans('moderation.case.tabs.decision'), count: props.decision?.appeals.length ?? null },
    { value: 'prior', label: trans('moderation.case.tabs.prior'), count: props.prior.length },
]);
const status = computed(() => ({ tone: statusTones[c.value.status], label: trans(`moderation.status.${c.value.status}`) }));
const title = computed(() => targetText(c.value.target_type, c.value.target_label));
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
const crumbs = computed(() => [{ label: trans('shell.groups.moderation') }, { label: trans('moderation.case.crumb'), href: routeOr('admin.moderation.reports', '/admin/moderation/reports') }]);

// ---- notifier address (SEC-P3-25) --------------------------------------------------------------------------------------------
// Masked in the props; "Anzeigen" fetches one report's address (audited, JSON only, daily cap) and shows it until the page is left.
const revealed = ref<Record<string, string>>({});
const revealing = ref<string | null>(null);
const revealError = ref<{ id: string; message: string } | null>(null);
async function revealContact(report: ReportItem): Promise<void> {
    revealing.value = report.id;
    revealError.value = null;
    try {
        const url = routeOr('admin.moderation.cases.reports.contact', `/admin/moderation/cases/${c.value.id}/reports/${report.id}/contact`, { case: c.value.id, report: report.id });
        const answer = await requestJson<{ email: string }>('post', url);
        revealed.value = { ...revealed.value, [report.id]: answer.email };
    } catch (error) {
        // The daily cap of address reveals (429, PiiReveals) says how many and what next; the plain throttle keeps the generic text.
        const capped = error instanceof JsonError && error.status === 429 && typeof error.body.message === 'string' && error.body.message !== '' && error.body.message !== 'Too Many Attempts.';
        revealError.value = { id: report.id, message: capped ? (error.body.message as string) : trans('moderation.case.reports.reveal_error') };
    } finally {
        revealing.value = null;
    }
}
function contactText(report: ReportItem): string {
    const email = revealed.value[report.id] ?? report.contact?.email ?? null;

    return trans('moderation.case.reports.contact', { value: [report.contact?.name ?? null, email].filter(Boolean).join(', ') });
}

// ---- assignment -------------------------------------------------------------------------------------------------------------
const assignUrl = computed(() => routeOr('admin.moderation.cases.assign', `/admin/moderation/cases/${c.value.id}/assign`, { case: c.value.id }));
const taking = ref(false);
function take(): void {
    router.post(assignUrl.value, {}, { preserveScroll: true, onStart: () => (taking.value = true), onFinish: () => (taking.value = false) });
}
const reassignOpen = ref(qaDialog() === 'reassign');
const reassignTo = ref<string | undefined>(undefined);
const reassignOptions = computed(() => props.staffOptions.map((s) => ({ value: String(s.id), label: s.name })));
function reassign(): void {
    if (reassignTo.value === undefined) return;
    router.post(assignUrl.value, { staff_id: Number(reassignTo.value) }, { preserveScroll: true, onSuccess: () => (reassignOpen.value = false) });
}

// ---- composer and appeal ----------------------------------------------------------------------------------------------------
const composerOpen = ref(qaDialog() === 'decide');
const appealOpen = ref(false);
const appeal = ref<AppealItem | null>(null);
const openAppeal = props.decision?.appeals.find((a) => a.status === 'open') ?? null;
if (qaDialog() === 'appeal' && openAppeal) {
    appeal.value = openAppeal;
    appealOpen.value = true;
}
function decideAppeal(item: AppealItem): void {
    appeal.value = item;
    appealOpen.value = true;
}
const canDecide = computed(() => isOpen.value && can('moderation.decide') && (!props.messageCase || can('moderation.messages')));

const messagesHref = computed(() => routeOr('admin.moderation.messages', '/admin/moderation/messages', {}) + `?case=${c.value.id}`);
const restrictionText = (d: DecisionDetail): string | null => {
    if (d.restriction === null) return null;
    const until = d.restriction.until ?? null;
    return until ? trans('moderation.case.decision.until', { date: formatDate(until) }) : trans('moderation.case.decision.no_end');
};
</script>

<template>
    <Head :title="trans('moderation.case.title', { reference: c.reference })" />
    <div data-testid="ADM-21-page" :data-qa-state="pageState">
        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('moderation.case.error')" :body="trans('ui.state.error_body')" test-id="ADM-21.error" @retry="router.reload()" />
        <RecordLayout
            v-else
            v-model:tab="tab"
            :title="title"
            :crumbs="crumbs"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('moderation.case.tabs.label')"
            :activity="activity"
            :activity-href="auditHref"
            :loading="pageState === 'loading'"
            :loading-actions="4" loading-meta="line"
            actions-below
            test-id="ADM-21"
        >
            <!-- DQ-555: the overview's own parts while loading: the preview heading, a 4:3 photo block and its text lines. -->
            <template #loading>
                <div class="flex flex-col gap-24" aria-hidden="true">
                    <div class="flex flex-col gap-12">
                        <Skeleton shape="text" class="h-20 w-200" />
                        <div class="flex flex-col gap-12 desktop:flex-row">
                            <Skeleton class="aspect-4/3 w-240 shrink-0" />
                            <div class="flex min-w-0 grow flex-col gap-8"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-160" /><Skeleton class="h-20 w-96" /><Skeleton shape="text" class="w-full" /><Skeleton shape="text" class="w-3/4" /></div>
                        </div>
                    </div>
                    <div class="flex flex-col gap-8"><Skeleton shape="text" class="h-20 w-160" /><Skeleton shape="text" class="w-320" /><Skeleton shape="text" class="w-240" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-21.meta">
                    <span class="sc-key">{{ trans('moderation.case.title', { reference: c.reference }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ trans('moderation.case.meta.created', { date: formatDateTime(c.created_at) }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span :title="priorityTooltip(c.priority)">{{ trans('moderation.priority.label', { total: formatNumber(c.priority.total) }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ c.assigned ? trans('moderation.case.meta.assigned', { name: c.assigned.me ? trans('moderation.reports.you') : c.assigned.name }) : trans('moderation.case.meta.unassigned') }}</span>
                    <Badge v-if="c.automated_detection" tone="neutral">{{ trans('moderation.sources.automated') }}</Badge>
                    <Badge v-if="ai" tone="info" tnum :title="ai.summary ? trans('moderation.case.ai_title', { summary: ai.summary }) : trans('moderation.case.ai_note')" data-testid="ADM-21.ai">{{ trans('moderation.case.ai', { score: formatNumber(Math.round(ai.score * 100)) }) }}</Badge>
                    <Badge v-if="c.origin === 'staff'" tone="neutral">{{ trans('moderation.origin_staff') }}</Badge>
                </p>
            </template>
            <template #actions>
                <Button v-if="c.subject && !c.subject.deleted && can('members.view')" size="sm" variant="ghost" :icon="PhUserCircle" :href="memberHref(c.subject.id)" data-testid="ADM-21.member">{{ trans('moderation.case.actions.member') }}</Button>
                <Button v-if="isOpen && can('moderation.decide') && !c.assigned?.me" size="sm" variant="secondary" :icon="PhHandPointing" :loading="taking" data-testid="ADM-21.take" @click="take()">{{ trans('moderation.case.actions.take') }}</Button>
                <Button v-if="isOpen && can('moderation.decide') && staffOptions.length > 1" size="sm" variant="secondary" :icon="PhUserSwitch" data-testid="ADM-21.reassign" @click="reassignOpen = true">{{ trans('moderation.case.actions.reassign') }}</Button>
                <Button v-if="canDecide" size="sm" variant="primary" :icon="PhGavel" data-testid="ADM-21.decide" @click="composerOpen = true">{{ trans('moderation.case.actions.decide') }}</Button>
            </template>

            <template #overview>
                <div class="flex flex-col gap-24" data-testid="ADM-21.overview">
                    <p v-if="c.assigned && !c.assigned.me && isOpen" class="text-admin-base text-ink-2" data-testid="ADM-21.taken">{{ trans('moderation.case.taken_by_other', { name: c.assigned.name }) }}</p>
                    <section class="flex flex-col gap-12">
                        <h2 class="text-headline text-ink">{{ trans('moderation.case.preview.title') }}</h2>
                        <div v-if="messageCase" class="flex flex-col items-start gap-8 rounded-sm border border-dashed border-line px-16 py-16" data-testid="ADM-21.preview.message">
                            <p class="text-admin-base text-ink-2">{{ trans('moderation.case.preview.message') }}</p>
                            <Link v-if="can('moderation.messages')" :href="messagesHref" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 rounded-xs text-admin-base-strong text-ink hover:underline']">
                                {{ trans('moderation.case.preview.message_link') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                            </Link>
                        </div>
                        <p v-else-if="preview === null" class="text-admin-base text-ink-3" data-testid="ADM-21.preview.gone">{{ trans('moderation.case.preview.gone') }}</p>
                        <div v-else-if="preview.kind === 'member'" class="flex items-start gap-16" data-testid="ADM-21.preview">
                            <img v-if="preview.avatar" :src="String(preview.avatar)" alt="" class="size-48 shrink-0 rounded-full object-cover" />
                            <PhUserCircle v-else :size="24" class="mt-4 shrink-0 text-ink-3" aria-hidden="true" />
                            <div class="flex min-w-0 flex-col gap-4">
                                <p class="text-admin-base-strong text-ink">{{ preview.display_name ?? `@${preview.username}` }}</p>
                                <p class="sc-key text-admin-base text-ink-2">{{ `@${preview.username}` }}</p>
                                <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.bio ?? trans('moderation.case.preview.no_bio') }}</p>
                            </div>
                        </div>
                        <div v-else-if="preview.kind === 'vehicle'" class="flex flex-col gap-12 desktop:flex-row" data-testid="ADM-21.preview">
                            <img v-if="preview.cover" :src="String(preview.cover)" alt="" class="aspect-4/3 w-240 shrink-0 rounded-sm object-cover" />
                            <div class="flex min-w-0 flex-col gap-4">
                                <p class="text-admin-base-strong text-ink">{{ preview.title }}</p>
                                <p v-if="preview.nickname" class="text-admin-base text-ink-2">{{ `„${preview.nickname}“` }}</p>
                                <div class="flex flex-wrap gap-8">
                                    <StatusPill v-bind="visibilityPill({ status: String(preview.status), visibility: String(preview.visibility), deleted: preview.deleted === true })" />
                                </div>
                                <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.description ?? trans('moderation.case.preview.no_description') }}</p>
                            </div>
                        </div>
                        <div v-else-if="preview.kind === 'photo'" class="flex flex-col gap-8" data-testid="ADM-21.preview">
                            <img v-if="preview.url" :src="String(preview.url)" :alt="String(preview.alt ?? '')" class="aspect-4/3 w-320 rounded-sm object-cover" />
                            <div v-else class="flex aspect-4/3 w-320 items-center justify-center rounded-sm border border-dashed border-line"><PhImageBroken :size="24" class="text-ink-3" aria-hidden="true" /></div>
                            <p v-if="!preview.url" class="text-admin-base text-ink-2">{{ trans('moderation.case.preview.removed_photo') }}</p>
                            <p v-else-if="preview.alt" class="text-admin-base text-ink-2">{{ preview.alt }}</p>
                        </div>
                        <!-- M4.11: a comment under a build update, as written; its author is the case's subject. -->
                        <div v-else-if="preview.kind === 'comment'" class="flex flex-col gap-8" data-testid="ADM-21.preview">
                            <p class="flex flex-wrap items-center gap-8 text-caption text-ink-3 tabular-nums">
                                <span>{{ preview.reply ? trans('moderation.case.preview.comment_reply') : trans('moderation.case.preview.comment_on') }}</span>
                                <time v-if="preview.created_at" :datetime="String(preview.created_at)">{{ formatDateTime(String(preview.created_at)) }}</time>
                                <Badge v-if="preview.deleted" tone="neutral">{{ trans('moderation.case.preview.comment_deleted') }}</Badge>
                            </p>
                            <blockquote class="max-w-720 whitespace-pre-line border-l-2 border-line-strong pl-12 text-admin-base text-ink" data-testid="ADM-21.preview.comment">{{ preview.body ?? '–' }}</blockquote>
                            <p v-if="preview.status === 'removed'" class="text-admin-base text-ink-3">{{ trans('moderation.case.preview.comment_removed') }}</p>
                            <Link v-if="preview.vehicle_id && hasRoute('admin.vehicles.show')" :href="routeOr('admin.vehicles.show', `/admin/vehicles/${String(preview.vehicle_id)}`, { vehicle: String(preview.vehicle_id) })" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs text-admin-base-strong text-ink hover:underline']">
                                {{ trans('moderation.case.preview.open_vehicle') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                            </Link>
                        </div>
                        <!-- M4.12: an event, linked to its ADM-54 record. -->
                        <div v-else-if="preview.kind === 'event'" class="flex flex-col gap-12 desktop:flex-row" data-testid="ADM-21.preview">
                            <img v-if="preview.cover" :src="String(preview.cover)" alt="" class="aspect-video w-240 shrink-0 rounded-sm object-cover" />
                            <div class="flex min-w-0 flex-col gap-4">
                                <p class="text-admin-base-strong text-ink">{{ preview.title }}</p>
                                <p class="text-admin-base text-ink-2 tabular-nums">{{ [trans(`events.types.${String(preview.type)}`), preview.starts_at ? formatDateTime(String(preview.starts_at)) : null, preview.city].filter(Boolean).join(' · ') }}</p>
                                <div class="flex flex-wrap gap-8">
                                    <StatusPill :tone="preview.removed ? 'danger' : 'neutral'" :label="preview.removed ? trans('moderation.case.preview.event_removed') : trans(`events.status.${String(preview.status)}`)" />
                                </div>
                                <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.description ?? trans('moderation.case.preview.no_description') }}</p>
                                <Link v-if="hasRoute('admin.events.show')" :href="routeOr('admin.events.show', `/admin/events/${String(preview.id)}`, { event: String(preview.id) })" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs text-admin-base-strong text-ink hover:underline']">
                                    {{ trans('moderation.case.preview.open_event') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                                </Link>
                            </div>
                        </div>
                        <!-- M4.14/M4.17: a business profile, linked to its ADM-56 record. -->
                        <div v-else-if="preview.kind === 'business'" class="flex flex-col gap-12 desktop:flex-row" data-testid="ADM-21.preview">
                            <img v-if="preview.cover" :src="String(preview.cover)" alt="" class="aspect-video w-240 shrink-0 rounded-sm object-cover" />
                            <div class="flex min-w-0 flex-col gap-4">
                                <p class="text-admin-base-strong text-ink">{{ preview.name }}</p>
                                <p class="text-admin-base text-ink-2">{{ [preview.legal_name, preview.city].filter(Boolean).join(' · ') }}</p>
                                <div class="flex flex-wrap gap-8">
                                    <StatusPill :tone="preview.removed ? 'danger' : 'neutral'" :label="preview.removed ? trans('moderation.case.preview.event_removed') : trans(`businesses.status.${String(preview.status)}`)" />
                                </div>
                                <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.about ?? trans('moderation.case.preview.no_description') }}</p>
                                <Link v-if="hasRoute('admin.businesses.show')" :href="routeOr('admin.businesses.show', `/admin/businesses/${String(preview.id)}`, { business: String(preview.id) })" :class="[focusRing, 'inline-flex min-h-32 items-center gap-4 self-start rounded-xs text-admin-base-strong text-ink hover:underline']">
                                    {{ trans('moderation.case.preview.open_business') }}<PhArrowSquareOut :size="16" aria-hidden="true" />
                                </Link>
                            </div>
                        </div>
                        <div v-else class="flex flex-col gap-4" data-testid="ADM-21.preview">
                            <p v-if="preview.title" class="text-admin-base-strong text-ink">{{ preview.title }}</p>
                            <p v-if="preview.hidden" class="text-admin-base text-ink-3">{{ trans('moderation.case.preview.hidden') }}</p>
                            <p class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ preview.note ?? preview.part_name ?? '–' }}</p>
                        </div>
                    </section>

                    <section class="flex flex-col gap-8">
                        <h2 class="text-headline text-ink">{{ trans('moderation.case.reports.title') }}</h2>
                        <ul class="flex flex-col">
                            <li v-for="r in reports.slice(0, 3)" :key="r.id" class="flex flex-wrap items-center gap-8 border-t border-line-subtle py-8 text-admin-base first:border-t-0">
                                <span class="text-ink">{{ reasonText(r.reason, r.sub_reason) }}</span>
                                <span class="text-ink-3 tabular-nums">{{ formatDateTime(r.created_at) }}</span>
                            </li>
                        </ul>
                        <p v-if="reports.length === 0" class="text-admin-base text-ink-3">{{ trans('moderation.case.reports.none') }}</p>
                    </section>
                </div>
            </template>

            <template #reports>
                <ul class="flex flex-col" data-testid="ADM-21.reports">
                    <li v-for="r in reports" :key="r.id" class="flex flex-col gap-4 border-t border-line-subtle py-12 first:border-t-0 first:pt-0" data-testid="ADM-21.report">
                        <p class="flex flex-wrap items-center gap-8">
                            <span class="text-admin-base-strong text-ink">{{ reasonText(r.reason, r.sub_reason) }}</span>
                            <Badge tone="neutral">{{ trans(`moderation.sources.${r.source}`) }}</Badge>
                            <span class="text-caption text-ink-3 tabular-nums">{{ formatDateTime(r.created_at) }}</span>
                        </p>
                        <p class="sc-key text-caption text-ink-2">
                            <template v-if="r.reporter">{{ `@${r.reporter.username}` }}</template>
                            <template v-else-if="r.source === 'automated'">{{ trans('moderation.case.reports.automated') }}</template>
                            <template v-else>{{ trans('moderation.case.reports.anonymous') }}</template>
                            <template v-if="r.contact"> · <span data-testid="ADM-21.report-contact" aria-live="polite">{{ contactText(r) }}</span></template>
                            <template v-if="r.good_faith"> · {{ trans('moderation.case.reports.good_faith') }}</template>
                            <Button v-if="r.can_reveal_contact && revealed[r.id] === undefined" size="sm" variant="ghost" :icon="PhEye" :loading="revealing === r.id" data-testid="ADM-21.report-reveal" @click="revealContact(r)">{{ trans('moderation.case.reports.reveal') }}</Button>
                            <span v-if="revealError?.id === r.id" class="text-admin-base text-danger" role="alert">{{ revealError.message }}</span>
                        </p>
                        <p v-if="r.details" class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ r.details }}</p>
                        <p v-else-if="r.details_withheld" class="text-admin-base text-ink-3" data-testid="ADM-21.details-withheld">{{ trans('moderation.case.reports.details_withheld') }}</p>
                    </li>
                </ul>
                <p v-if="reports.length === 0" class="text-admin-base text-ink-3">{{ trans('moderation.case.reports.none') }}</p>
            </template>

            <template #evidence>
                <EvidencePanel :case-id="c.id" :target-type="c.target_type" :allowed="!messageCase || can('moderation.messages')" test-id="ADM-21.evidence" />
            </template>

            <template #decision>
                <div class="flex flex-col gap-24" data-testid="ADM-21.decision">
                    <section v-if="decision" class="flex flex-col gap-12">
                        <div class="flex flex-wrap items-center gap-8">
                            <StatusPill :tone="outcomeTones[decision.action]" :label="trans(`moderation.outcomes.${decision.action}`)" />
                            <span v-if="restrictionText(decision)" class="text-admin-base text-ink-2 tabular-nums">{{ restrictionText(decision) }}</span>
                        </div>
                        <p class="text-admin-base text-ink-2 tabular-nums">
                            {{ decision.decided_by ? trans('moderation.case.decision.by', { name: decision.decided_by.name, date: formatDateTime(decision.decided_at) }) : trans('moderation.case.decision.by_system', { date: formatDateTime(decision.decided_at) }) }}
                            · {{ trans(decision.automated_detection ? 'moderation.case.decision.automated_detection' : 'moderation.case.decision.human') }}
                        </p>
                        <dl class="flex flex-col gap-8">
                            <div class="flex flex-col gap-2"><dt class="text-caption text-ink-3">{{ trans('moderation.case.decision.facts') }}</dt><dd class="max-w-720 whitespace-pre-line text-admin-base text-ink">{{ decision.facts || '–' }}</dd></div>
                            <div class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ trans('moderation.case.decision.ground') }}</dt>
                                <dd class="flex max-w-720 flex-col gap-2">
                                    <span class="text-admin-base text-ink">{{ decision.ground || '–' }}</span>
                                    <span class="text-caption text-ink-3">{{ `${trans('decisions.document')}: ${trans(`decisions.documents.${decision.ground_document}`)}${decision.ground_section ? ` § ${decision.ground_section}` : ''}` }}</span>
                                </dd>
                            </div>
                        </dl>
                        <p v-if="decision.appeal_until" class="text-caption text-ink-3 tabular-nums">{{ trans('moderation.case.decision.appeal_until', { date: formatDate(decision.appeal_until) }) }}</p>
                        <p v-if="decision.reversed_by" class="text-caption text-ink-3 tabular-nums">{{ trans('moderation.case.decision.reversed', { date: formatDate(decision.reversed_by.decided_at) }) }}</p>
                    </section>
                    <p v-else class="text-admin-base text-ink-3">{{ trans('moderation.case.decision.none') }}</p>

                    <section v-if="decision" class="flex flex-col gap-8" data-testid="ADM-21.appeals">
                        <h2 class="text-headline text-ink">{{ trans('moderation.case.appeals.title') }}</h2>
                        <p v-if="decision.appeals.length === 0" class="text-admin-base text-ink-3">{{ trans('moderation.case.appeals.none') }}</p>
                        <ul v-else class="flex flex-col">
                            <li v-for="a in decision.appeals" :key="a.id" class="flex flex-col gap-8 border-t border-line-subtle py-12 first:border-t-0" data-testid="ADM-21.appeal">
                                <div class="flex flex-wrap items-center justify-between gap-8">
                                    <p class="flex flex-wrap items-center gap-8">
                                        <StatusPill :tone="appealTones[a.status]" :label="trans(`moderation.appeal_status.${a.status}`)" />
                                        <span class="text-admin-base text-ink">{{ [trans(`moderation.roles.${a.role}`), a.appellant ? `@${a.appellant}` : null].filter(Boolean).join(' · ') }}</span>
                                        <span class="text-caption text-ink-3 tabular-nums">{{ trans('moderation.case.appeals.filed', { date: formatDateTime(a.created_at) }) }}</span>
                                    </p>
                                    <Button v-if="a.may_decide" size="sm" variant="primary" data-testid="ADM-21.appeal.decide" @click="decideAppeal(a)">{{ trans('moderation.case.appeals.decide') }}</Button>
                                </div>
                                <blockquote v-if="a.text" class="max-w-720 border-l-2 border-line pl-12 text-admin-base text-ink">{{ a.text }}</blockquote>
                                <p v-else class="text-caption text-ink-3">{{ trans('moderation.case.appeals.text_hidden') }}</p>
                                <p v-if="a.status === 'open' && !a.may_decide && can('moderation.appeals') && decision.decided_by?.me" class="text-caption text-ink-2" data-testid="ADM-21.appeal.same-staff">{{ trans('moderation.case.appeals.same_staff') }}</p>
                                <p v-if="a.decided_at" class="text-caption text-ink-3 tabular-nums">{{ trans('moderation.case.appeals.decided', { name: a.decided_by ?? '–', date: formatDateTime(a.decided_at) }) }}</p>
                            </li>
                        </ul>
                    </section>
                </div>
            </template>

            <template #prior>
                <section class="flex flex-col gap-8" data-testid="ADM-21.prior">
                    <h2 class="text-headline text-ink">{{ trans('moderation.case.prior.title') }}</h2>
                    <p v-if="prior.length === 0" class="text-admin-base text-ink-3">{{ trans('moderation.case.prior.none') }}</p>
                    <ul v-else class="flex flex-col">
                        <li v-for="p in prior" :key="p.id" class="flex flex-wrap items-center gap-8 border-t border-line-subtle py-8 first:border-t-0">
                            <StatusPill :tone="outcomeTones[p.action]" :label="trans(`moderation.outcomes.${p.action}`)" />
                            <span class="text-admin-base text-ink-2">{{ trans(`moderation.target_types.${p.target_type}`) }}</span>
                            <time class="text-caption text-ink-3 tabular-nums" :datetime="p.decided_at">{{ formatDate(p.decided_at) }}</time>
                            <Badge v-if="p.reversed" tone="success">{{ trans('moderation.case.prior.reversed') }}</Badge>
                            <Link :href="caseHref(p.case_id)" :class="[focusRing, 'ml-auto inline-flex min-h-32 items-center rounded-xs text-admin-base-strong text-ink hover:underline']">{{ trans('moderation.case.prior.open') }}</Link>
                        </li>
                    </ul>
                </section>
            </template>
        </RecordLayout>

        <DecisionComposer v-if="canDecide || qaDialog() === 'decide'" v-model:open="composerOpen" :case-id="c.id" :composer="composer" :templates="templates" :failed="failedDialog" test-id="ADM-21.composer" />
        <AppealDialog v-model:open="appealOpen" :appeal="appeal" :composer="composer" :templates="templates" :failed="failedDialog" test-id="ADM-21.appeal-dialog" />
        <Dialog v-model:open="reassignOpen" :title="trans('moderation.reassign.title')" size="sm" test-id="ADM-21.reassign-dialog">
            <Field :label="trans('moderation.reassign.staff')">
                <Select v-model="reassignTo" :options="reassignOptions" :placeholder="trans('moderation.reassign.placeholder')" data-testid="ADM-21.reassign.staff" />
            </Field>
            <template #footer>
                <Button variant="ghost" data-dialog-cancel @click="reassignOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :disabled="reassignTo === undefined" data-testid="ADM-21.reassign.submit" @click="reassign()">{{ trans('moderation.reassign.submit') }}</Button>
            </template>
        </Dialog>
    </div>
</template>
