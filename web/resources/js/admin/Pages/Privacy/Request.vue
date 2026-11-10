<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhCalendarPlus, PhDownloadSimple, PhPaperPlaneTilt, PhPaperclip, PhTrash, PhUserCircle, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import DialogError from '../../Components/patterns/DialogError.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import { Button, ConfirmDialog, Field, IconButton, RadioGroup, Select, Skeleton, Textarea } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actorName } from '../../lib/audit';
import { formatDate, formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import { dueInfo, FINAL, memberHref, privacyEventLabel, requesterText, statusTones, typeLabel, type RequestRow } from './shared';

/**
 * ADM-46 GDPR request (06 §3, m3.6 §1, Art. 12 GDPR): who asked, what, received and due (the one extension with its reason), status and
 * assignee; replies from the DE/EN templates; the member's own SET-12 export by mail (Auskunft/Export) or the erasure through the
 * four-eyes `members.delete` (Löschung); closing with evidence (note, file or both; a refusal needs the note). Opening it is audited.
 */
interface Detail extends RequestRow {
    locale: string;
    details: string | null;
    extended_at: string | null;
    extension_reason: string | null;
    last_reply_at: string | null;
    /** The deadline after the one extension (server-computed); null once extended. */
    extended_due_at: string | null;
    /** Where a reply goes, masked; null when there is no address. */
    reply_to: string | null;
    evidence: { note: string | null; file: string | null; download: string | null } | null;
    export: { status: string; requested_at: string | null } | null;
    approval: { id: string; status: string } | null;
}
const props = defineProps<{
    request: Detail;
    templates: { key: string; available: boolean }[];
    assignees: { id: number; name: string }[];
    activity: { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null }[];
    can: { process: boolean; reply: boolean; reply_blocked: 'permission' | 'no_address' | 'no_member_address' | null; extend: boolean; export: boolean; erasure: boolean };
}>();

const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const r = computed(() => props.request);
const final = computed(() => FINAL.includes(r.value.status));
const tab = ref(final.value ? 'complete' : 'request');
const tabs = computed(() => [
    { value: 'request', label: trans('privacy.request.tabs.request') },
    { value: 'reply', label: trans('privacy.request.tabs.reply') },
    { value: 'complete', label: trans('privacy.request.tabs.complete') },
]);
const crumbs = computed(() => [{ label: trans('shell.groups.audit_privacy') }, { label: trans('privacy.requests.title'), href: routeOr('admin.privacy.requests', '/admin/privacy/requests') }]);
const title = computed(() => `${typeLabel(r.value.type)} · ${r.value.reference}`);
const status = computed(() => ({ tone: statusTones[r.value.status], label: trans(`privacy.status.${r.value.status}`) }));
const due = computed(() => dueInfo(r.value));
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: privacyEventLabel(e.action), actor: actorName(e), reason: e.reason })));
const actionsShown = computed(() => props.can.extend || props.can.export || props.can.erasure);
const url = (step: string) => routeOr(`admin.privacy.requests.${step}`, `/admin/privacy/requests/${r.value.id}/${step}`, { privacyRequest: r.value.id });
const newDue = computed(() => formatDate(r.value.extended_due_at));
// Why no reply can be sent (DQ-618): the permission, or no address (an external requester without one, or a member's account).
const replyBlocked = computed(() => {
    const why = props.can.reply_blocked ?? 'permission';
    return why === 'permission' ? trans('privacy.request.view_only') : trans(`privacy.request.${why}`);
});

const action = useAdminAction();

// ---- handling: assignee + status ----------------------------------------------------------------------------------------------
const NOBODY = 'none';
const handling = reactive({ assigned: r.value.assigned ? String(r.value.assigned.id) : NOBODY, status: r.value.status });
watch(r, (value) => Object.assign(handling, { assigned: value.assigned ? String(value.assigned.id) : NOBODY, status: value.status }));
const assigneeOptions = computed(() => [{ value: NOBODY, label: trans('privacy.request.nobody') }, ...props.assignees.map((a) => ({ value: String(a.id), label: a.name }))]);
const statusOptions = computed(() => (['open', 'in_progress', 'waiting'] as const).map((v) => ({ value: v, label: trans(`privacy.status.${v}`) })));
const handlingChanged = computed(() => handling.assigned !== (r.value.assigned ? String(r.value.assigned.id) : NOBODY) || handling.status !== r.value.status);
function saveHandling(): void {
    action.run('patch', routeOr('admin.privacy.requests.update', `/admin/privacy/requests/${r.value.id}`, { privacyRequest: r.value.id }), { assigned_to: handling.assigned === NOBODY ? null : Number(handling.assigned), status: handling.status }, { sensitive: true });
}

// ---- reply ------------------------------------------------------------------------------------------------------------------
const reply = reactive({ template: props.templates.find((t) => t.available)?.key ?? 'received', locale: r.value.locale, detail: '' });
const templateOptions = computed(() => props.templates.map((t) => ({ value: t.key, label: trans(`privacy.request.templates.${t.key}`), disabled: !t.available })));
const localeOptions = computed(() => (['de', 'en'] as const).map((v) => ({ value: v, label: trans(`team.invite.locales.${v}`) })));
function sendReply(): void {
    action.run('post', url('reply'), { template: reply.template, locale: reply.locale, detail: reply.detail.trim() === '' ? null : reply.detail.trim() }, { sensitive: true, onSuccess: () => (reply.detail = '') });
}

// ---- complete -----------------------------------------------------------------------------------------------------------------
const complete = reactive({ outcome: 'completed', note: '', file: null as File | null });
const completeError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const outcomeOptions = computed(() => (['completed', 'rejected'] as const).map((v) => ({ value: v, label: trans(`privacy.request.outcomes.${v}`) })));
function pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    complete.file = input.files?.[0] ?? null;
}
function clearFile(): void {
    complete.file = null;
    if (fileInput.value) fileInput.value.value = '';
}
function submitComplete(): void {
    const note = complete.note.trim();
    if (complete.outcome === 'rejected' && (note.length < 10 || note.length > 5000)) completeError.value = trans('privacy.request.errors.reject_note');
    else if (note !== '' && (note.length < 10 || note.length > 5000)) completeError.value = trans('privacy.request.errors.note');
    else if (note === '' && complete.file === null) completeError.value = trans('privacy.request.errors.evidence');
    else completeError.value = null;
    if (completeError.value) return;
    action.run('post', url('complete'), { status: complete.outcome, note: note === '' ? null : note, ...(complete.file ? { evidence: complete.file } : {}) }, { sensitive: true });
}

// ---- dialogs ----------------------------------------------------------------------------------------------------------------
const extendOpen = ref(false);
const exportOpen = ref(false);
const erasureOpen = ref(false);
function openDialog(name: 'extend' | 'export' | 'erasure'): void {
    action.reset();
    ({ extend: extendOpen, export: exportOpen, erasure: erasureOpen })[name].value = true;
}
onMounted(async () => {
    const overlay = qaDialog();
    if (overlay === 'extend' && props.can.extend) extendOpen.value = true;
    else if (overlay === 'export' && props.can.export) exportOpen.value = true;
    else if (overlay === 'erasure' && props.can.erasure) erasureOpen.value = true;
    else if (overlay === 'reply') tab.value = 'reply';
    else if (overlay === 'complete') {
        tab.value = 'complete';
        complete.note = 'Datenexport am 08.11.2026 per E‑Mail an das Konto geschickt; Eingang vom Mitglied bestätigt.';
    } else return;
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
const exportState = computed(() => (r.value.export ? trans(`privacy.request.export_states.${r.value.export.status}`) : null));
</script>

<template>
    <Head :title="title" />
    <div :data-qa-state="pageState" data-testid="ADM-46-page">
        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('privacy.request.error')" :body="trans('ui.state.error_body')" test-id="ADM-46.error" @retry="router.reload()" />
        <RecordLayout v-else v-model:tab="tab" :title="title" :crumbs="crumbs" :status="status" :tabs="tabs" :tabs-label="trans('privacy.request.tabs_label')" :activity="activity" :loading="pageState === 'loading'" :loading-actions="2" test-id="ADM-46">
            <template #loading>
                <div class="flex flex-col gap-24" aria-hidden="true">
                    <div class="flex flex-col gap-8 rounded-sm border border-line-subtle px-16 py-12"><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="h-20 w-200" /><Skeleton shape="text" class="w-240" /></div>
                    <div class="flex flex-col gap-8"><Skeleton shape="text" class="h-20 w-120" /><Skeleton shape="text" class="w-full" /><Skeleton shape="text" class="w-3/4" /></div>
                    <div class="flex flex-col gap-8"><Skeleton shape="text" class="h-20 w-160" /><Skeleton class="h-40 w-full" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-supporting text-ink-2 tabular-nums" data-testid="ADM-46.meta">
                    <span>{{ trans('privacy.request.received', { date: formatDate(r.received_at) }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span :class="due.tone === 'danger' ? 'text-danger' : due.tone === 'warning' ? 'text-warning' : ''">{{ `${trans('privacy.request.due', { date: formatDate(r.due_at) })} (${due.text})` }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ trans('privacy.request.source', { source: trans(`privacy.sources.${r.source}`) }) }}</span>
                </p>
            </template>
            <template v-if="actionsShown" #actions>
                <Button v-if="can.export" size="sm" variant="secondary" :icon="PhPaperPlaneTilt" data-testid="ADM-46.export" @click="openDialog('export')">{{ trans('privacy.actions.export') }}</Button>
                <Button v-if="can.extend" size="sm" variant="secondary" :icon="PhCalendarPlus" data-testid="ADM-46.extend" @click="openDialog('extend')">{{ trans('privacy.actions.extend') }}</Button>
                <Button v-if="can.erasure" size="sm" variant="destructive" :icon="PhTrash" data-testid="ADM-46.erasure" @click="openDialog('erasure')">{{ trans('privacy.actions.erasure') }}</Button>
            </template>

            <template #request>
                <div class="flex flex-col gap-24 pt-24">
                    <p v-if="!can.process && !final" class="text-supporting text-ink-2" data-testid="ADM-46.view-only">{{ trans('privacy.request.view_only') }}</p>
                    <section class="flex flex-col gap-4 rounded-sm border border-line-subtle px-16 py-12" data-testid="ADM-46.requester">
                        <p class="text-caption text-ink-3">{{ trans('privacy.request.requester_title') }}</p>
                        <p class="sc-key text-body-strong text-ink">{{ requesterText(r.requester) }}<template v-if="r.requester.kind === 'member' && r.requester.name">{{ ` · ${r.requester.name}` }}</template></p>
                        <p v-if="r.requester.email" class="sc-key text-supporting text-ink-2">{{ trans('privacy.request.address', { email: r.requester.email }) }}</p>
                        <p v-else-if="r.requester.kind === 'external'" class="text-supporting text-warning">{{ trans('privacy.request.no_address') }}</p>
                        <Link v-if="r.requester.id && !r.requester.deleted" :href="memberHref(r.requester.id)" :class="[focusRing, 'inline-flex h-32 items-center gap-4 self-start rounded-xs text-label-s text-ink hover:underline']" data-testid="ADM-46.member">
                            <PhUserCircle :size="16" aria-hidden="true" />{{ trans('privacy.request.member_link') }}
                        </Link>
                    </section>
                    <section class="flex flex-col gap-8" data-testid="ADM-46.details">
                        <h2 class="text-title-s text-ink">{{ trans('privacy.request.details_title') }}</h2>
                        <p v-if="r.details" class="max-w-720 whitespace-pre-line text-supporting text-ink">{{ r.details }}</p>
                        <p v-else class="text-supporting text-ink-3">{{ trans('privacy.request.no_details') }}</p>
                    </section>
                    <section class="flex flex-col gap-8" data-testid="ADM-46.deadline">
                        <h2 class="text-title-s text-ink">{{ trans('privacy.request.deadline_title') }}</h2>
                        <p class="text-supporting text-ink tabular-nums">{{ trans('privacy.request.deadline_line', { received: formatDate(r.received_at), due: formatDate(r.due_at) }) }}</p>
                        <p v-if="r.extended_at" class="max-w-720 text-supporting text-ink-2">{{ trans('privacy.request.extended_line', { date: formatDate(r.extended_at), reason: r.extension_reason ?? '–' }) }}</p>
                        <p v-else-if="can.extend" class="text-helper text-ink-3">{{ trans('privacy.request.extend_hint') }}</p>
                    </section>
                    <section v-if="r.export || r.approval" class="flex flex-col gap-4" data-testid="ADM-46.linked">
                        <h2 class="text-title-s text-ink">{{ trans('privacy.request.linked_title') }}</h2>
                        <p v-if="exportState" class="text-supporting text-ink-2">{{ trans('privacy.request.export_status', { status: exportState }) }}</p>
                        <p v-if="r.approval" class="text-supporting text-ink-2">{{ trans('privacy.request.approval_status', { status: trans(`approvals.status.${r.approval.status}`) }) }}</p>
                    </section>
                    <section v-if="can.process" class="flex flex-col gap-12" data-testid="ADM-46.handling">
                        <h2 class="text-title-s text-ink">{{ trans('privacy.request.handling_title') }}</h2>
                        <div class="flex flex-wrap items-end gap-12">
                            <div class="w-240"><Field :label="trans('privacy.request.assignee')"><Select v-model="handling.assigned" :options="assigneeOptions" size="sm" data-testid="ADM-46.assignee" /></Field></div>
                            <div class="w-200"><Field :label="trans('privacy.request.status')"><Select v-model="handling.status" :options="statusOptions" size="sm" data-testid="ADM-46.status-select" /></Field></div>
                            <Button size="sm" variant="secondary" :disabled="!handlingChanged" :loading="action.processing.value" data-testid="ADM-46.handling.save" @click="saveHandling()">{{ trans('privacy.request.save') }}</Button>
                        </div>
                    </section>
                </div>
            </template>

            <template #reply>
                <div class="flex flex-col gap-16 pt-24" data-testid="ADM-46.reply">
                    <div class="flex flex-col gap-4">
                        <h2 class="text-title-s text-ink">{{ trans('privacy.request.reply_title') }}</h2>
                        <p class="max-w-720 text-supporting text-ink-2">{{ trans('privacy.request.reply_body') }}</p>
                        <p v-if="r.last_reply_at" class="text-helper text-ink-3 tabular-nums">{{ trans('privacy.request.last_reply', { date: formatDateTime(r.last_reply_at) }) }}</p>
                    </div>
                    <p v-if="!can.reply" class="max-w-720 text-supporting" :class="can.reply_blocked === 'permission' ? 'text-ink-2' : 'text-warning'" data-testid="ADM-46.reply.blocked">{{ replyBlocked }}</p>
                    <template v-else>
                        <p v-if="r.reply_to" class="sc-key text-supporting text-ink" data-testid="ADM-46.reply.to">{{ trans('privacy.request.reply_to', { email: r.reply_to }) }}</p>
                        <div class="flex flex-wrap items-end gap-12">
                            <div class="min-w-240 grow basis-0"><Field :label="trans('privacy.request.template')"><Select v-model="reply.template" :options="templateOptions" data-testid="ADM-46.reply.template" /></Field></div>
                            <div class="w-160"><Field :label="trans('privacy.request.reply_locale')"><Select v-model="reply.locale" :options="localeOptions" data-testid="ADM-46.reply.locale" /></Field></div>
                        </div>
                        <p class="max-w-720 text-helper text-ink-2" data-testid="ADM-46.reply.about">{{ trans(`privacy.request.template_about.${reply.template}`) }}</p>
                        <Field :label="trans('privacy.request.detail')" :hint="trans('privacy.request.detail_hint')" optional>
                            <Textarea v-model="reply.detail" :rows="3" :maxlength="2000" show-count data-testid="ADM-46.reply.detail" />
                        </Field>
                        <div class="flex flex-wrap items-center gap-12">
                            <Button variant="primary" size="sm" :icon="PhPaperPlaneTilt" :loading="action.processing.value" data-testid="ADM-46.reply.send" @click="sendReply()">{{ trans('privacy.request.send') }}</Button>
                            <DialogError :message="tab === 'reply' ? action.error.value : null" test-id="ADM-46.reply.error" />
                        </div>
                    </template>
                </div>
            </template>

            <template #complete>
                <div class="flex flex-col gap-16 pt-24" data-testid="ADM-46.complete">
                    <template v-if="final">
                        <p class="max-w-720 text-supporting text-ink-2">{{ trans('privacy.request.final') }}</p>
                        <section class="flex flex-col gap-8 rounded-sm border border-line-subtle px-16 py-12" data-testid="ADM-46.evidence">
                            <h2 class="text-title-s text-ink">{{ trans('privacy.request.evidence_title') }}</h2>
                            <p v-if="!r.evidence?.note && !r.evidence?.file" class="text-supporting text-ink-3">{{ trans('privacy.request.no_evidence') }}</p>
                            <div v-if="r.evidence?.note" class="flex flex-col gap-2"><p class="text-caption text-ink-3">{{ trans('privacy.request.evidence_note') }}</p><p class="max-w-720 whitespace-pre-line text-supporting text-ink">{{ r.evidence.note }}</p></div>
                            <div v-if="r.evidence?.file" class="flex flex-wrap items-center gap-12">
                                <span class="text-caption text-ink-3">{{ trans('privacy.request.evidence_file') }}</span>
                                <span class="sc-key text-supporting text-ink">{{ r.evidence.file }}</span>
                                <Button v-if="r.evidence.download" size="sm" variant="secondary" :icon="PhDownloadSimple" :href="r.evidence.download" external data-testid="ADM-46.evidence.download">{{ trans('privacy.request.download') }}</Button>
                            </div>
                        </section>
                    </template>
                    <p v-else-if="!can.process" class="text-supporting text-ink-2">{{ trans('privacy.request.view_only') }}</p>
                    <form v-else class="flex flex-col gap-16" novalidate @submit.prevent="submitComplete()">
                        <div class="flex flex-col gap-4">
                            <h2 class="text-title-s text-ink">{{ trans('privacy.request.complete_title') }}</h2>
                            <p class="max-w-720 text-supporting text-ink-2">{{ trans('privacy.request.complete_body') }}</p>
                        </div>
                        <RadioGroup v-model="complete.outcome" :options="outcomeOptions" :legend="trans('privacy.request.outcome')" orientation="horizontal" data-testid="ADM-46.complete.outcome" />
                        <Field :label="trans('privacy.request.note')" :hint="trans('privacy.request.note_hint')" :required="complete.outcome === 'rejected'" :optional="complete.outcome !== 'rejected'">
                            <Textarea v-model="complete.note" :rows="4" :maxlength="5000" show-count data-testid="ADM-46.complete.note" />
                        </Field>
                        <div class="flex flex-col gap-4">
                            <span class="text-label-s text-ink">{{ trans('privacy.request.file') }}</span>
                            <div class="flex flex-wrap items-center gap-12">
                                <label :class="[focusRing, 'inline-flex h-32 cursor-pointer items-center gap-8 rounded-sm border border-line bg-raised px-12 text-label-s text-ink hover:bg-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus']">
                                    <PhPaperclip :size="16" aria-hidden="true" />{{ trans('privacy.request.file_choose') }}
                                    <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.zip" data-testid="ADM-46.complete.file" @change="pickFile" />
                                </label>
                                <span class="sc-key text-supporting" :class="complete.file ? 'text-ink' : 'text-ink-3'">{{ complete.file?.name ?? trans('privacy.request.file_none') }}</span>
                                <IconButton v-if="complete.file" :icon="PhX" :label="trans('privacy.request.file_remove')" size="sm" @click="clearFile()" />
                            </div>
                            <p class="max-w-720 text-helper text-ink-3">{{ trans('privacy.request.file_hint') }}</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-12">
                            <Button type="submit" variant="primary" size="sm" :loading="action.processing.value" data-testid="ADM-46.complete.submit">{{ complete.outcome === 'rejected' ? trans('privacy.request.reject_submit') : trans('privacy.request.complete_submit') }}</Button>
                            <DialogError :message="completeError ?? (tab === 'complete' ? action.error.value : null)" test-id="ADM-46.complete.error" />
                        </div>
                    </form>
                </div>
            </template>
        </RecordLayout>

        <ConfirmDialog v-model:open="extendOpen" :title="trans('privacy.extend.title')" :body="trans('privacy.extend.body', { date: newDue })" :confirm-label="trans('privacy.actions.extend')" tone="neutral" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-46.extend-dialog" @confirm="(reason: string | null) => action.run('post', url('extend'), { reason: reason ?? '' }, { sensitive: true, onSuccess: () => (extendOpen = false) })" />
        <ConfirmDialog v-model:open="exportOpen" :title="trans('privacy.export.title')" :body="trans('privacy.export.body')" :confirm-label="trans('privacy.export.submit')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-46.export-dialog" @confirm="() => action.run('post', url('export'), {}, { sensitive: true, onSuccess: () => (exportOpen = false) })" />
        <ConfirmDialog v-model:open="erasureOpen" :title="trans('privacy.erasure.title')" :body="trans('privacy.erasure.body')" :confirm-label="trans('privacy.actions.erasure')" reason four-eyes :processing="action.processing.value" :error="action.error.value" test-id="ADM-46.erasure-dialog" @confirm="(reason: string | null) => action.run('post', url('erasure'), { reason: reason ?? '' }, { sensitive: true, onSuccess: () => (erasureOpen = false) })" />
    </div>
</template>
