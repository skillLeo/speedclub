<script setup lang="ts">
import { qaDialogFailed } from '../../composables/pageState';
import { Head, router } from '@inertiajs/vue3';
import { PhEye, PhLockSimple, PhPaperPlaneTilt, PhUserCircle, PhUserSwitch } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Badge, Button, Drawer, Field, SegmentedControl, Select, Skeleton, Textarea, type TabItem } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { JsonError, requestJson } from '../../lib/http';
import { routeOr } from '../../lib/routes';
import { fillVariables, fromText, statusTones, type TicketAssigned, type TicketFrom, type TicketStatus } from './shared';

/**
 * ADM-26 ticket (06 §3 Support, m3.4-contract §1/§2; support.reply): the thread with replies and internal notes told apart (a note is
 * never sent), the member link (members.view), metadata, status (offen · wartet · gelöst) and assignment, and the composer with the macro
 * picker (DE/EN, variables filled, editable). A member reads replies in the app (SET-15), a web contact gets them by e-mail.
 */
interface ThreadMessage {
    id: string;
    author_type: 'member' | 'guest' | 'staff';
    author: string | null;
    body: string;
    internal: boolean;
    created_at: string;
    mailed_at: string | null;
}
interface Macro {
    id: string;
    key: string;
    locale: 'de' | 'en';
    title: string;
    body: string;
}
const props = defineProps<{
    ticket: {
        id: string;
        reference: string;
        subject: string;
        category: string;
        status: TicketStatus;
        source: 'app' | 'web';
        locale: string | null;
        from: TicketFrom;
        member_link: boolean;
        assigned: TicketAssigned | null;
        created_at: string | null;
        last_activity_at: string | null;
        closed_at: string | null;
    };
    thread: ThreadMessage[];
    macros: Macro[];
    variables: Record<string, string>;
    staffOptions: { id: number; name: string }[];
    activity: { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null }[];
}>();

const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const t = computed(() => props.ticket);
const tab = ref('thread');
const tabs = computed<TabItem[]>(() => [{ value: 'thread', label: trans('support.ticket.tabs.thread'), count: props.thread.length }]);
const crumbs = computed(() => [{ label: trans('shell.groups.support') }, { label: trans('support.ticket.crumb'), href: routeOr('admin.support.tickets', '/admin/support/tickets') }]);
const status = computed(() => ({ tone: statusTones[t.value.status], label: trans(`support.status.${t.value.status}`) }));
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
const updateUrl = computed(() => routeOr('admin.support.tickets.update', `/admin/support/tickets/${t.value.id}`, { ticket: t.value.id }));
const action = useAdminAction();

// ---- status and assignment ------------------------------------------------------------------------------------------------
const statusOptions = computed(() => (['open', 'pending', 'closed'] as const).map((value) => ({ value, label: trans(`support.status.${value}`) })));
const statusModel = computed({
    get: () => t.value.status,
    set: (value: string | undefined) => {
        if (value === undefined || value === t.value.status) return;
        router.patch(updateUrl.value, { status: value }, { preserveScroll: true });
    },
});
const assignOpen = ref(qaDialog() === 'assign');
const NOBODY = 'none';
const assignTo = ref<string | undefined>(t.value.assigned ? String(t.value.assigned.id) : NOBODY);
const staffSelect = computed(() => [{ value: NOBODY, label: trans('support.tickets.assign_none') }, ...props.staffOptions.map((s) => ({ value: String(s.id), label: s.name }))]);
function saveAssign(): void {
    action.run('patch', updateUrl.value, { staff_id: assignTo.value === NOBODY || assignTo.value === undefined ? null : Number(assignTo.value) }, { onSuccess: () => (assignOpen.value = false) });
}

// ---- composer -------------------------------------------------------------------------------------------------------------
const mode = ref<'reply' | 'note'>(qaDialog() === 'note' ? 'note' : 'reply');
const modeOptions = computed(() => [
    { value: 'reply', label: trans('support.ticket.composer.reply') },
    { value: 'note', label: trans('support.ticket.composer.note') },
]);
const body = ref('');
const after = ref<string | undefined>('pending');
const composeError = ref<string | null>(null);
const macroOptions = computed(() => {
    const locale = t.value.locale === 'en' ? 'en' : 'de';
    return props.macros.filter((m) => m.locale === locale).map((m) => ({ value: m.id, label: m.title }));
});
const macroModel = computed({
    get: () => undefined as string | undefined,
    set: (id: string | undefined) => {
        const macro = props.macros.find((m) => m.id === id);
        if (macro) body.value = fillVariables(macro.body, props.variables);
    },
});
watch(mode, () => (composeError.value = null));
const recipient = computed(() => fromText(t.value.from));

// DQ-563: a web contact's address is masked; "Anzeigen" fetches it (audited, JSON only) and shows it until the page is left.
const revealed = ref<string | null>(null);
const revealing = ref(false);
const revealError = ref<string | null>(null);
async function reveal(): Promise<void> {
    revealing.value = true;
    revealError.value = null;
    try {
        const answer = await requestJson<{ email: string | null }>('post', routeOr('admin.support.tickets.contact', `/admin/support/tickets/${t.value.id}/contact`, { ticket: t.value.id }));
        revealed.value = answer.email;
    } catch (error) {
        // The daily cap of address reveals (429, PiiReveals): its message says how many and what next; the plain throttle keeps the generic text.
        revealError.value = error instanceof JsonError && error.status === 429 && typeof error.body.message === 'string' && error.body.message !== '' && error.body.message !== 'Too Many Attempts.' ? error.body.message : trans('support.ticket.reveal_error');
    } finally {
        revealing.value = false;
    }
}
function send(): void {
    const length = body.value.trim().length;
    if (length < 2 || length > 5000) {
        composeError.value = trans('decisions.errors.facts');
        return;
    }
    composeError.value = null;
    const url = mode.value === 'reply'
        ? routeOr('admin.support.tickets.reply', `/admin/support/tickets/${t.value.id}/reply`, { ticket: t.value.id })
        : routeOr('admin.support.tickets.note', `/admin/support/tickets/${t.value.id}/notes`, { ticket: t.value.id });
    action.run('post', url, mode.value === 'reply' ? { body: body.value.trim(), status: after.value ?? 'pending' } : { body: body.value.trim() }, { onSuccess: () => (body.value = '') });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
const authorText = (m: ThreadMessage): string => (m.author_type === 'staff' ? (m.author ?? trans('support.ticket.thread.team')) : (m.author ?? recipient.value));
</script>

<template>
    <Head :title="t.subject" />
    <div data-testid="ADM-26-page" :data-qa-state="pageState">
        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('support.ticket.error')" :body="trans('ui.state.error_body')" test-id="ADM-26.error" @retry="router.reload()" />
        <RecordLayout v-else v-model:tab="tab" :title="t.subject" :crumbs="crumbs" :status="status" :tabs="tabs" :tabs-label="trans('support.ticket.tabs.label')" :activity="activity" :loading="pageState === 'loading'" :loading-actions="3" loading-meta="line" actions-below test-id="ADM-26">
            <!-- DQ-555: the thread's own parts while loading: the sender box and three message cards. -->
            <template #loading>
                <div class="flex flex-col gap-24" aria-hidden="true">
                    <div class="flex flex-col gap-8 rounded-sm border border-line-subtle px-16 py-12"><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="h-20 w-200" /><Skeleton shape="text" class="w-120" /></div>
                    <div class="flex flex-col gap-12">
                        <div v-for="n in 3" :key="n" class="flex flex-col gap-8 rounded-sm border border-line-subtle px-16 py-12">
                            <span class="flex items-center gap-8"><Skeleton shape="text" class="w-120" /><Skeleton shape="text" class="w-80" /></span>
                            <Skeleton shape="text" class="w-full" /><Skeleton shape="text" class="w-3/4" />
                        </div>
                    </div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-26.meta">
                    {{ [trans('support.ticket.meta.reference', { reference: t.reference }), trans(`support.categories.${t.category}`), trans(t.source === 'app' ? 'support.ticket.meta.source_app' : 'support.ticket.meta.source_web'), trans('support.ticket.meta.created', { date: formatDateTime(t.created_at) })].join(' · ') }}
                </p>
            </template>
            <template #actions>
                <Button v-if="t.member_link && t.from.id" size="sm" variant="ghost" :icon="PhUserCircle" :href="routeOr('admin.members.show', `/admin/members/${t.from.id}`, { member: t.from.id })" data-testid="ADM-26.member">{{ trans('support.ticket.actions.member') }}</Button>
                <Button v-if="can('support.reply')" size="sm" variant="secondary" :icon="PhUserSwitch" data-testid="ADM-26.assign" @click="assignOpen = true">{{ trans('support.ticket.actions.assign') }}</Button>
                <div v-if="can('support.reply')" class="w-160"><Select v-model="statusModel" :options="statusOptions" size="sm" :aria-label="trans('support.ticket.actions.status')" data-testid="ADM-26.status" /></div>
            </template>

            <template #thread>
                <div class="flex flex-col gap-24">
                    <section class="flex flex-col gap-4 rounded-sm border border-line-subtle px-16 py-12" data-testid="ADM-26.from">
                        <p class="text-caption text-ink-3">{{ trans('support.ticket.from_title') }}</p>
                        <p class="sc-key text-admin-base-strong text-ink">{{ recipient }}</p>
                        <p v-if="t.from.kind === 'web' && t.from.email" class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2">
                            <span class="sc-key" data-testid="ADM-26.email">{{ trans('support.ticket.email', { email: revealed ?? t.from.email }) }}</span>
                            <Button v-if="revealed === null && can('members.view_pii')" size="sm" variant="ghost" :icon="PhEye" :loading="revealing" data-testid="ADM-26.reveal" @click="reveal">{{ trans('support.ticket.reveal') }}</Button>
                            <span v-if="revealError" class="text-admin-base text-danger" role="alert">{{ revealError }}</span>
                        </p>
                        <p class="text-caption text-ink-3">{{ trans(t.from.kind === 'member' ? 'support.ticket.channel_app' : 'support.ticket.channel_email') }}</p>
                    </section>

                    <ol class="flex flex-col gap-12" data-testid="ADM-26.thread">
                        <li
                            v-for="m in thread"
                            :key="m.id"
                            class="flex flex-col gap-8 rounded-sm px-16 py-12"
                            :class="m.internal ? 'border border-dashed border-line-strong bg-raised' : m.author_type === 'staff' ? 'border border-line bg-surface' : 'border border-line-subtle'"
                            :data-testid="m.internal ? 'ADM-26.note' : 'ADM-26.message'"
                        >
                            <p class="flex flex-wrap items-center gap-8 text-caption text-ink-3 tabular-nums">
                                <span class="sc-key text-admin-base-strong text-ink">{{ authorText(m) }}</span>
                                <time :datetime="m.created_at">{{ formatDateTime(m.created_at) }}</time>
                                <Badge v-if="m.internal" tone="neutral"><PhLockSimple :size="16" aria-hidden="true" />{{ trans('support.ticket.thread.internal') }}</Badge>
                                <span v-else-if="m.author_type === 'staff' && t.from.kind === 'web'">{{ m.mailed_at ? trans('support.ticket.thread.mailed', { date: formatDateTime(m.mailed_at) }) : trans('support.ticket.thread.queued') }}</span>
                            </p>
                            <p class="whitespace-pre-line text-admin-base text-ink">{{ m.body }}</p>
                        </li>
                    </ol>
                    <p v-if="thread.length === 0" class="text-admin-base text-ink-3">{{ trans('support.ticket.thread.empty') }}</p>

                    <form v-if="can('support.reply')" class="flex flex-col gap-12 border-t border-line-subtle pt-16" novalidate data-testid="ADM-26.composer" @submit.prevent="send">
                        <div class="flex flex-wrap items-end justify-between gap-12">
                            <SegmentedControl v-model="mode" :options="modeOptions" :label="trans('support.ticket.composer.reply')" data-testid="ADM-26.mode" />
                            <div v-if="mode === 'reply' && macroOptions.length > 0" class="w-240">
                                <Field :label="trans('support.ticket.composer.macro')"><Select v-model="macroModel" :options="macroOptions" size="sm" :placeholder="trans('support.ticket.composer.macro_placeholder')" data-testid="ADM-26.macro" /></Field>
                            </div>
                        </div>
                        <p v-if="t.status === 'closed' && mode === 'reply'" class="text-caption text-ink-3">{{ trans('support.ticket.closed_note') }}</p>
                        <Field
                            :label="mode === 'reply' ? trans('support.ticket.composer.label_reply', { name: recipient }) : trans('support.ticket.composer.label_note')"
                            :hint="mode === 'note' ? trans('support.ticket.composer.hint_note') : trans(t.from.kind === 'member' ? 'support.ticket.composer.hint_reply_app' : 'support.ticket.composer.hint_reply_email')"
                            :error="composeError"
                            required
                        >
                            <Textarea v-model="body" :rows="6" :maxlength="5000" show-count :data-testid="`ADM-26.${mode}.body`" />
                        </Field>
                        <div class="flex flex-wrap items-end justify-between gap-12">
                            <div v-if="mode === 'reply'" class="w-200"><Field :label="trans('support.ticket.composer.status_after')"><Select v-model="after" :options="statusOptions" size="sm" data-testid="ADM-26.after" /></Field></div>
                            <div v-else />
                            <div class="flex items-center gap-8">
                                <p v-if="serverError" class="text-admin-base text-danger" role="alert">{{ serverError }}</p>
                                <Button v-if="body !== ''" variant="ghost" size="sm" :disabled="action.processing.value" @click="body = ''">{{ trans('support.ticket.composer.discard') }}</Button>
                                <Button type="submit" size="sm" :variant="mode === 'reply' ? 'primary' : 'secondary'" :icon="mode === 'reply' ? PhPaperPlaneTilt : PhLockSimple" :loading="action.processing.value" :data-testid="`ADM-26.${mode}.submit`">
                                    {{ mode === 'reply' ? trans('support.ticket.composer.send') : trans('support.ticket.composer.save_note') }}
                                </Button>
                            </div>
                        </div>
                    </form>
                </div>
            </template>
        </RecordLayout>

        <Drawer v-model:open="assignOpen" :title="trans('support.tickets.assign_title', { reference: t.reference })" :dismissible="!action.processing.value" test-id="ADM-26.assign-drawer">
            <div class="flex flex-col gap-16">
                <StateBlock v-if="serverError" kind="error" :title="trans('ui.state.error_title')" :body="serverError" :retryable="false" test-id="ADM-26.assign.error" />
                <Field :label="trans('support.tickets.assign_staff')"><Select v-model="assignTo" :options="staffSelect" data-testid="ADM-26.assign.staff" /></Field>
            </div>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="assignOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" data-testid="ADM-26.assign.save" @click="saveAssign()">{{ trans('support.tickets.assign_submit') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
