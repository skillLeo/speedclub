<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { PhArrowSquareOut, PhDotsThree, PhPencilSimple, PhProhibit, PhStop, PhWarningCircle } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import RestrictDialog from '../../Components/decisions/RestrictDialog.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import { Button, Checkbox, ConfirmDialog, Dialog, Drawer, DropdownMenu, Field, Input, Skeleton, Textarea, type MenuEntry, type TabItem, type Tone } from '../../Components/ui';
import { qaDialog } from '../../composables/qaDialog';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { actionLabel, actorName } from '../../lib/audit';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { JsonError, requestJson } from '../../lib/http';
import { usePermissions } from '../../lib/permissions';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { hasRoute, routeOr } from '../../lib/routes';
import AuditTab from './Partials/AuditTab.vue';
import MessagesTab from './Partials/MessagesTab.vue';
import OverviewTab from './Partials/OverviewTab.vue';
import PrivacyTab from './Partials/PrivacyTab.vue';
import ReportsTab from './Partials/ReportsTab.vue';
import SecurityTab from './Partials/SecurityTab.vue';
import VehiclesTab from './Partials/VehiclesTab.vue';
import type { FeedEntry, MemberOverview, MemberPrivacy, MemberReports, MemberSecurity, MemberVehicle, MessageMetadata } from './types';

/**
 * ADM-10 member record (06 §3 Members, m3.2-contract §2/§3). Tabs read their data when opened (?tab=). Every row action of the
 * contract: edit drawer, restrict / suspend sheet with the statement of reasons, lift, reset link, force password change, revoke
 * sessions, 2FA reset*, e-mail change, view-as (JSON, opens /app in a new tab; the token never enters a prop or the session), export*,
 * delete* with typed confirmation, and the audited PII reveal (the address is masked in every prop, SEC-P3-02).
 */
type Tab = 'overview' | 'vehicles' | 'security' | 'reports' | 'messages' | 'audit' | 'privacy';

const props = defineProps<{
    member: MemberOverview;
    tab: Tab;
    vehicles?: MemberVehicle[];
    security?: MemberSecurity;
    reports?: MemberReports;
    messages?: MessageMetadata | null;
    audit?: { events: FeedEntry[]; more: boolean } | null;
    privacy?: MemberPrivacy;
    activity: FeedEntry[];
    pendingApprovals: { id: string; action: string; title: string; expires_at: string }[];
    viewAs: { expires_at: string | null } | null;
    suspendMaxDays: number | null;
}>();

const page = usePage();
const { can } = usePermissions();
const state = usePageState();

// ---- tabs (?tab=, each tab's data is an optional prop) -------------------------------------------------------------------
const tabs = computed<TabItem[]>(() => [
    { value: 'overview', label: trans('members.tabs.overview') },
    { value: 'vehicles', label: trans('members.tabs.vehicles'), count: props.member.counters.vehicles },
    { value: 'security', label: trans('members.tabs.security') },
    { value: 'reports', label: trans('members.tabs.reports'), count: props.member.counters.reports_as_target || null },
    ...(can('members.message_metadata') ? [{ value: 'messages', label: trans('members.tabs.messages') }] : []),
    ...(can('audit.view') ? [{ value: 'audit', label: trans('members.tabs.audit') }] : []),
    { value: 'privacy', label: trans('members.tabs.privacy') },
]);
const current = ref<Tab>(props.tab);
const tabLoading = ref(false);
const tabFailed = ref(false);
watch(
    () => props.tab,
    (tab) => (current.value = tab),
);
function loadTab(tab: Tab): void {
    tabFailed.value = false;
    router.get(window.location.pathname, tab === 'overview' ? {} : { tab }, {
        only: tab === 'overview' ? ['tab', 'member'] : ['tab', tab],
        preserveState: true,
        preserveScroll: true,
        replace: true,
        onStart: () => (tabLoading.value = true),
        onFinish: () => (tabLoading.value = false),
        onNetworkError: () => {
            tabFailed.value = true;
            return false;
        },
    });
}
const tabModel = computed({
    get: () => current.value,
    set: (tab: string) => {
        current.value = tab as Tab;
        loadTab(current.value);
    },
});
const panelReady = computed(() => {
    if (state.value === 'loading' || tabLoading.value) return false;
    const data = { overview: true, vehicles: props.vehicles, security: props.security, reports: props.reports, messages: props.messages, audit: props.audit, privacy: props.privacy }[current.value];
    return data !== undefined;
});

// ---- header -------------------------------------------------------------------------------------------------------------
const tones: Record<MemberOverview['state'], Tone> = { active: 'success', restricted: 'warning', suspended: 'danger', deactivated: 'neutral', pending_deletion: 'neutral' };
const title = computed(() => (props.member.username ? `@${props.member.username}` : trans('members.no_username')));
const closed = computed(() => props.member.deleted || props.member.pending_deletion || props.member.state === 'deactivated');
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
const auditHref = computed(() => (can('audit.view') && hasRoute('admin.audit.index') ? `${routeOr('admin.audit.index', '/admin/audit')}?filter[target_type]=user&filter[target_id]=${props.member.id}` : null));
const memberUrl = (name: string, fallback: string) => routeOr(`admin.members.${name}`, `/admin/members/${props.member.id}${fallback}`, { member: props.member.id });

// ---- PII reveal (JSON, audited, shown until navigation) ------------------------------------------------------------------
const revealed = ref<string | null>(null);
const revealing = ref(false);
const revealError = ref<string | null>(null);
async function reveal(): Promise<void> {
    revealing.value = true;
    revealError.value = null;
    try {
        const answer = await requestJson<{ email?: string }>('post', memberUrl('pii', '/pii'));
        revealed.value = typeof answer.email === 'string' ? answer.email : null;
    } catch (error) {
        // The daily cap of address reveals (429, PiiReveals): its message says how many and what next; the plain throttle keeps the generic text.
        revealError.value = error instanceof JsonError && error.status === 429 && typeof error.body.message === 'string' && error.body.message !== '' && error.body.message !== 'Too Many Attempts.' ? error.body.message : trans('members.record.reveal_failed');
    } finally {
        revealing.value = false;
    }
}

// ---- actions ------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
type DialogName = 'edit' | 'restrict' | 'lift' | 'reset_link' | 'force_password' | 'revoke_sessions' | 'reset_2fa' | 'email' | 'view_as' | 'export' | 'delete' | null;
const open = ref<DialogName>(null);
const isOpen = (name: Exclude<DialogName, null>) =>
    computed({
        get: () => open.value === name,
        set: (value: boolean) => {
            if (!value && open.value === name) open.value = null;
        },
    });
const editOpen = isOpen('edit');
const restrictOpen = isOpen('restrict');
const liftOpen = isOpen('lift');
const resetLinkOpen = isOpen('reset_link');
const forceOpen = isOpen('force_password');
const revokeOpen = isOpen('revoke_sessions');
const reset2faOpen = isOpen('reset_2fa');
const emailOpen = isOpen('email');
const viewAsOpen = isOpen('view_as');
const exportOpen = isOpen('export');
const deleteOpen = isOpen('delete');

function show(name: Exclude<DialogName, null>): void {
    action.reset();
    open.value = name;
}
const close = (): void => {
    open.value = null;
};

const more = computed<MenuEntry[]>(() => {
    const entries: { atom: string; entry: MenuEntry }[] = [
        { atom: 'members.reset_password', entry: { key: 'reset_link', label: trans('members.actions.reset_link'), testId: 'ADM-10.action.reset-link', onSelect: () => show('reset_link') } },
        { atom: 'members.reset_password', entry: { key: 'force_password', label: trans('members.actions.force_password'), testId: 'ADM-10.action.force-password', onSelect: () => show('force_password') } },
        { atom: 'members.revoke_sessions', entry: { key: 'revoke_sessions', label: trans('members.actions.revoke_sessions'), testId: 'ADM-10.action.revoke-sessions', onSelect: () => show('revoke_sessions') } },
        { atom: 'members.reset_2fa', entry: { key: 'reset_2fa', label: trans('members.actions.reset_2fa'), disabled: !props.member.two_factor, testId: 'ADM-10.action.reset-2fa', onSelect: () => show('reset_2fa') } },
        { atom: 'members.edit', entry: { key: 'email', label: trans('members.actions.email'), disabled: props.member.deleted, testId: 'ADM-10.action.email', onSelect: () => show('email') } },
        { atom: 'members.view_as', entry: { key: 'view_as', label: trans('members.actions.view_as'), disabled: closed.value, separated: true, testId: 'ADM-10.action.view-as', onSelect: () => show('view_as') } },
        { atom: 'members.export', entry: { key: 'export', label: trans('members.actions.export'), separated: true, testId: 'ADM-10.action.export', onSelect: () => show('export') } },
        { atom: 'members.delete', entry: { key: 'delete', label: trans('members.actions.delete'), danger: true, disabled: closed.value, testId: 'ADM-10.action.delete', onSelect: () => show('delete') } },
    ];
    return entries.filter((item) => can(item.atom)).map((item) => item.entry);
});

// edit drawer
const edit = reactive({ display_name: '', username: '', city: '', bio: '', reason: '' });
const editErrors = ref<Record<string, string>>({});
watch(editOpen, (value) => {
    if (!value) return;
    Object.assign(edit, { display_name: props.member.display_name ?? '', username: props.member.username ?? '', city: props.member.city ?? '', bio: props.member.bio ?? '', reason: '' });
    editErrors.value = {};
});
function submitEdit(): void {
    const changes: Record<string, string | null> = {};
    const text = (value: string) => (value.trim() === '' ? null : value.trim());
    if (text(edit.display_name) !== props.member.display_name) changes.display_name = text(edit.display_name);
    if (text(edit.city) !== props.member.city) changes.city = text(edit.city);
    if (text(edit.bio) !== props.member.bio) changes.bio = text(edit.bio);
    if (edit.username.trim() !== '' && edit.username.trim() !== props.member.username) changes.username = edit.username.trim().toLowerCase();
    const errors: Record<string, string> = {};
    if (Object.keys(changes).length === 0) errors.form = trans('members.edit.nothing');
    const reason = edit.reason.trim().length;
    if (reason < 10 || reason > 1000) errors.reason = trans('ui.confirm.reason_length');
    editErrors.value = errors;
    if (Object.keys(errors).length > 0) return;
    action.run('patch', memberUrl('update', ''), { ...changes, reason: edit.reason.trim() }, { sensitive: true, onSuccess: close });
}

// restrict / suspend
function submitRestrict(payload: { measure: string } & Record<string, string | null>): void {
    const { measure, ...rest } = payload;
    if (measure === 'suspension') action.run('post', memberUrl('suspend', '/suspend'), rest, { sensitive: true, onSuccess: close });
    else action.run('post', memberUrl('restrict', '/restrict'), { ...rest, type: measure }, { sensitive: true, onSuccess: close });
}

// lift
const liftType = ref<'messaging' | 'publishing' | 'suspension'>('messaging');
const liftFacts = ref('');
const liftError = ref<string | null>(null);
function openLift(type: 'messaging' | 'publishing' | 'suspension'): void {
    liftType.value = type;
    liftFacts.value = '';
    liftError.value = null;
    show('lift');
}
function submitLift(reason: string | null): void {
    const facts = liftFacts.value.trim().length;
    if (facts < 10 || facts > 5000) {
        liftError.value = trans('decisions.errors.facts');
        return;
    }
    liftError.value = null;
    // A reverse decision is a sensitive write like unhiding a vehicle or photo (SF-4, ADR-215).
    action.run('post', memberUrl('lift', '/lift'), { type: liftType.value, facts: liftFacts.value.trim(), reason: reason ?? '' }, { sensitive: true, onSuccess: close });
}
const canLift = (type: string): boolean => can('members.restrict') && (type !== 'suspension' || can('members.suspend'));

// simple confirmations
function confirmed(name: 'reset-link' | 'force-password-change' | 'revoke-sessions' | 'reset-two-factor' | 'export-data', path: string, sensitive: boolean) {
    return (reason: string | null): void => action.run('post', memberUrl(name, path), { reason: reason ?? '' }, { sensitive, onSuccess: close });
}
const sendResetLink = confirmed('reset-link', '/reset-link', false);
const forcePassword = confirmed('force-password-change', '/force-password-change', true);
const revokeSessions = confirmed('revoke-sessions', '/revoke-sessions', true);
const resetTwoFactor = confirmed('reset-two-factor', '/reset-two-factor', true);
const requestExport = confirmed('export-data', '/export', false);
function requestDelete(reason: string | null): void {
    action.run('post', memberUrl('delete', '/delete'), { reason: reason ?? '', confirm: trans('ui.confirm.typed_word') }, { onSuccess: close });
}

// e-mail change
const email = reactive({ address: '', verified: false, reason: '' });
const emailErrors = ref<Record<string, string>>({});
watch(emailOpen, (value) => {
    if (value) Object.assign(email, { address: '', verified: false, reason: '' });
    emailErrors.value = {};
});
function submitEmail(): void {
    const errors: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.address.trim())) errors.email = trans('members.email.invalid');
    if (email.verified !== true) errors.identity = trans('members.email.identity_required');
    const reason = email.reason.trim().length;
    if (reason < 10 || reason > 1000) errors.reason = trans('ui.confirm.reason_length');
    emailErrors.value = errors;
    if (Object.keys(errors).length > 0) return;
    action.run('post', memberUrl('email', '/email'), { email: email.address.trim(), identity_verified: true, reason: email.reason.trim() }, { sensitive: true, onSuccess: close });
}

// view-as (m3.2-contract §3, SF-8): JSON only, the URL is opened and forgotten
const supportOnly = computed(() => {
    const roles = page.props.staff?.roles ?? [];
    return roles.includes('support') && !roles.includes('owner') && !roles.includes('admin');
});
const viewAsForm = reactive({ reason: '', consent: false });
const viewAsErrors = ref<Record<string, string>>({});
const viewAsBusy = ref(false);
const viewAsStarted = ref<string | null>(null);
watch(viewAsOpen, (value) => {
    if (value) Object.assign(viewAsForm, { reason: '', consent: false });
    viewAsErrors.value = {};
});
const viewAsNote = ref<string | null>(null);
/** The page's own record of a password confirmed in the dialog (the shared prop only refreshes on the next visit). */
const confirmedAt = ref(0);
const passwordFresh = (): boolean => passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until) || Date.now() - confirmedAt.value < 4 * 60_000;
function askPassword(): void {
    confirmPasswordFirst(() => {
        confirmedAt.value = Date.now();
        viewAsNote.value = trans('members.view_as.confirm_again');
    });
}

/**
 * SF-1: the new tab is opened synchronously on the click (a browser lets a tab open only inside the user's gesture, Safari strictly),
 * as about:blank, and sent to the one-time URL when the JSON answer arrives; on a failure it is closed again. SF-4: a password
 * confirmed within 5 minutes first; then the person clicks "Ansicht öffnen" once more, so the tab still opens on a click.
 */
function startViewAs(): void {
    const errors: Record<string, string> = {};
    const reason = viewAsForm.reason.trim().length;
    if (reason < 10 || reason > 1000) errors.reason = trans('ui.confirm.reason_length');
    if (supportOnly.value && viewAsForm.consent !== true) errors.consent = trans('members.view_as.consent_required');
    viewAsErrors.value = errors;
    viewAsNote.value = null;
    if (Object.keys(errors).length > 0) return;
    if (!passwordFresh()) {
        askPassword();
        return;
    }
    const tab = window.open('about:blank', '_blank');
    if (tab === null) {
        viewAsErrors.value = { form: trans('members.view_as.popup_blocked') };
        return;
    }
    void requestViewAs(tab);
}
async function requestViewAs(tab: Window): Promise<void> {
    viewAsBusy.value = true;
    try {
        const answer = await requestJson<{ url?: string; expires_at?: string }>('post', memberUrl('view-as', '/view-as'), { reason: viewAsForm.reason.trim(), member_consented: viewAsForm.consent === true });
        if (typeof answer.url !== 'string') throw new Error('no url');
        tab.opener = null;
        tab.location.replace(answer.url);
        viewAsStarted.value = answer.expires_at ?? null;
        close();
        router.reload({ only: ['viewAs', 'activity'] });
    } catch (error) {
        tab.close();
        if (error instanceof JsonError && error.body.code === 'password_confirmation_required') {
            confirmedAt.value = 0;
            askPassword();
            return;
        }
        viewAsErrors.value = { form: error instanceof JsonError && error.status === 422 ? (error.field('member_consented') ?? error.field('reason') ?? trans('members.view_as.not_possible')) : trans('members.view_as.failed') };
    } finally {
        viewAsBusy.value = false;
    }
}
// ---- QA overlays (?dialog=, non-production, DQ-529): the sheet opens on load; with ?qaState=error it shows the server error. ----
const qaOverlay = qaDialog();
const QA_DIALOGS: Record<string, Exclude<DialogName, null>> = {
    edit: 'edit',
    restrict: 'restrict',
    suspend: 'restrict',
    lift: 'lift',
    'reset-link': 'reset_link',
    'force-password': 'force_password',
    'revoke-sessions': 'revoke_sessions',
    'reset-2fa': 'reset_2fa',
    email: 'email',
    'view-as': 'view_as',
    export: 'export',
    delete: 'delete',
};
const restrictPreset = computed(() =>
    qaOverlay === 'suspend'
        ? { measure: 'suspension' as const, duration: '30' as const, template: 'harassment' }
        : qaOverlay === 'restrict'
          ? { measure: 'messaging' as const, duration: '7' as const, template: 'spam' }
          : null,
);
onMounted(async () => {
    const name = qaOverlay === null ? undefined : QA_DIALOGS[qaOverlay];
    if (name === undefined) return;
    if (name === 'lift') openLift(props.member.restrictions[0]?.type ?? 'messaging');
    else show(name);
    // After the dialogs' own open watchers, which clear their errors.
    await nextTick();
    if (qaDialogFailed()) {
        action.error.value = trans('ui.state.server_error');
        viewAsErrors.value = { form: trans('ui.state.server_error') };
    }
});
const ending = ref(false);
async function endViewAs(): Promise<void> {
    ending.value = true;
    try {
        await requestJson('delete', memberUrl('view-as.end', '/view-as'));
        viewAsStarted.value = null;
        router.reload({ only: ['viewAs', 'activity'] });
    } finally {
        ending.value = false;
    }
}
</script>

<template>
    <Head :title="title" />
    <div data-testid="ADM-10-page" :data-qa-state="state">
        <StateBlock v-if="state === 'error'" kind="error" :title="trans('members.record.error')" :body="trans('ui.state.error_body')" test-id="ADM-10" @retry="router.reload()" />

        <RecordLayout
            v-else
            v-model:tab="tabModel"
            :title="title"
            :crumbs="[{ label: trans('members.title'), href: routeOr('admin.members.index', '/admin/members') }]"
            :status="{ tone: tones[member.state], label: trans(`members.status.${member.state}`) }"
            :tabs="tabs"
            :tabs-label="trans('members.tabs.label')"
            :activity="activity"
            :activity-href="auditHref ?? undefined"
            :loading="state === 'loading'"
            :aside-hidden="current === 'audit'"
            test-id="ADM-10"
        >
            <template #meta>
                <!-- One meta line, its parts separated by "·" (DQ-546); 32 high like the other record headers. -->
                <p class="flex min-h-32 flex-wrap items-center gap-8 text-supporting text-ink-2 tabular-nums">
                    <img v-if="member.avatar" :src="member.avatar" alt="" width="24" height="24" class="size-24 rounded-full object-cover" />
                    <template v-if="member.display_name">
                        <span class="text-ink">{{ member.display_name }}</span>
                        <span aria-hidden="true">·</span>
                    </template>
                    <span>{{ trans('members.record.registered', { date: formatDate(member.created_at) }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ member.last_seen_at ? trans('members.record.last_seen', { date: formatDateTime(member.last_seen_at) }) : trans('members.record.never_seen') }}</span>
                </p>
            </template>
            <template #actions>
                <Button v-if="viewAs" size="sm" variant="secondary" :icon="PhStop" :loading="ending" data-testid="ADM-10.view-as-end" @click="endViewAs">{{ trans('members.view_as.end') }}</Button>
                <!-- neutral → destructive; the red fill only inside the dialog (DQ-530) -->
                <Button v-if="can('members.edit') && !member.deleted" size="sm" variant="primary" :icon="PhPencilSimple" data-testid="ADM-10.action.edit" @click="show('edit')">{{ trans('members.actions.edit') }}</Button>
                <Button v-if="can('members.restrict') && !closed" size="sm" variant="destructive" :icon="PhProhibit" data-testid="ADM-10.action.restrict" @click="show('restrict')">{{ trans('members.actions.restrict') }}</Button>
                <DropdownMenu v-if="more.length > 0" :items="more" :label="trans('members.actions.more')">
                    <template #trigger>
                        <Button size="sm" variant="secondary" :icon="PhDotsThree" data-testid="ADM-10.action.more">{{ trans('members.actions.more') }}</Button>
                    </template>
                </DropdownMenu>
            </template>

            <template v-for="name in (['overview', 'vehicles', 'security', 'reports', 'messages', 'audit', 'privacy'] as const)" :key="name" #[name]>
                <div class="flex flex-col gap-16">
                    <!-- four-eyes requests about this member -->
                    <ul v-if="name === current && pendingApprovals.length > 0" class="flex flex-col gap-4 rounded-sm border border-line px-12 py-8" data-testid="ADM-10.pending">
                        <li v-for="item in pendingApprovals" :key="item.id" class="text-supporting text-ink-2 tabular-nums">
                            {{ trans('members.record.pending', { title: trans(item.title), until: formatDateTime(item.expires_at) }) }}
                        </li>
                    </ul>
                    <p v-if="name === current && (viewAs || viewAsStarted)" class="flex items-center gap-8 text-supporting text-ink-2" data-testid="ADM-10.view-as-running">
                        <PhArrowSquareOut :size="16" aria-hidden="true" />{{ trans('members.view_as.running', { until: formatDateTime(viewAs?.expires_at ?? viewAsStarted) }) }}
                    </p>

                    <StateBlock v-if="tabFailed" kind="error" :title="trans('members.record.tab_error')" @retry="loadTab(current)" />
                    <div v-else-if="!panelReady" class="flex flex-col gap-12" aria-busy="true" :data-testid="`ADM-10.${name}.loading`">
                        <Skeleton shape="text" class="w-160" />
                        <Skeleton v-for="n in 4" :key="n" class="h-40 w-full" />
                    </div>
                    <template v-else>
                        <OverviewTab
                            v-if="name === 'overview'"
                            :member="member"
                            :email="revealed ?? member.email"
                            :revealed="revealed !== null"
                            :can-reveal="member.can_reveal_pii"
                            :revealing="revealing"
                            :reveal-error="revealError"
                            :can-lift="canLift"
                            @reveal="reveal"
                            @lift="openLift"
                        />
                        <VehiclesTab v-else-if="name === 'vehicles' && vehicles" :vehicles="vehicles" />
                        <SecurityTab v-else-if="name === 'security' && security" :security="security" />
                        <ReportsTab v-else-if="name === 'reports' && reports" :reports="reports" />
                        <template v-else-if="name === 'messages'">
                            <MessagesTab v-if="messages" :metadata="messages" />
                            <StateBlock v-else kind="forbidden" :title="trans('members.messages.forbidden')" test-id="ADM-10.messages.forbidden" />
                        </template>
                        <template v-else-if="name === 'audit'">
                            <AuditTab v-if="audit" :events="audit.events" :more="audit.more" :log-href="auditHref" />
                            <StateBlock v-else kind="forbidden" :title="trans('members.audit.forbidden')" />
                        </template>
                        <PrivacyTab v-else-if="name === 'privacy' && privacy" :privacy="privacy" />
                    </template>
                </div>
            </template>
        </RecordLayout>

        <!-- edit drawer -->
        <Drawer v-model:open="editOpen" :title="trans('members.edit.title')" :description="trans('members.edit.body')" test-id="ADM-10.edit">
            <form id="adm10-edit" class="flex flex-col gap-16" novalidate @submit.prevent="submitEdit">
                <Field :label="trans('members.columns.username')" :hint="trans('members.edit.username_hint')" :error="editErrors.username">
                    <Input v-model="edit.username" autocomplete="off" spellcheck="false" maxlength="24" data-testid="ADM-10.edit.username" />
                </Field>
                <Field :label="trans('members.columns.display_name')" optional>
                    <Input v-model="edit.display_name" maxlength="60" data-testid="ADM-10.edit.display-name" />
                </Field>
                <Field :label="trans('members.record.city')" optional>
                    <Input v-model="edit.city" maxlength="100" data-testid="ADM-10.edit.city" />
                </Field>
                <Field :label="trans('members.record.bio')" optional>
                    <Textarea v-model="edit.bio" :rows="4" :maxlength="500" show-count data-testid="ADM-10.edit.bio" />
                </Field>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="editErrors.reason" required>
                    <Textarea v-model="edit.reason" :rows="3" :maxlength="1000" show-count data-testid="ADM-10.edit.reason" />
                </Field>
                <p class="text-helper text-ink-3">{{ trans('members.edit.never_password') }}</p>
            </form>
            <template #footer>
                <p v-if="editErrors.form || action.error.value" class="flex basis-full items-start gap-8 rounded-sm border border-line px-12 py-8 text-supporting text-ink" role="alert">
                    <PhWarningCircle :size="20" class="shrink-0 text-danger" aria-hidden="true" />{{ editErrors.form ?? action.error.value }}
                </p>
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="close">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm10-edit" variant="primary" :loading="action.processing.value" data-testid="ADM-10.edit.save">{{ trans('members.edit.save') }}</Button>
            </template>
        </Drawer>

        <RestrictDialog
            v-model:open="restrictOpen"
            :preset="restrictPreset"
            :title="trans('members.restrict.title', { name: title })"
            :description="trans('members.restrict.body')"
            :can-suspend="can('members.suspend')"
            :max-days="suspendMaxDays"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-10.restrict"
            @submit="submitRestrict"
        />

        <ConfirmDialog
            v-model:open="liftOpen"
            :title="trans('members.lift.title', { measure: trans(`decisions.measures.${liftType}`) })"
            :body="trans('members.lift.body')"
            :confirm-label="trans('members.actions.lift')"
            tone="neutral"
            reason
            :processing="action.processing.value"
            :error="liftError ?? action.error.value"
            test-id="ADM-10.lift"
            @confirm="submitLift"
        >
            <Field :label="trans('members.lift.facts')" :hint="trans('members.lift.facts_hint')" required>
                <Textarea v-model="liftFacts" :rows="3" :maxlength="5000" data-testid="ADM-10.lift.facts" />
            </Field>
        </ConfirmDialog>

        <ConfirmDialog v-model:open="resetLinkOpen" :title="trans('members.reset_link.title')" :body="trans('members.reset_link.body')" :confirm-label="trans('members.actions.reset_link')" tone="neutral" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-10.reset-link" @confirm="sendResetLink" />
        <ConfirmDialog v-model:open="forceOpen" :title="trans('members.force_password.title')" :body="trans('members.force_password.body')" :confirm-label="trans('members.actions.force_password')" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-10.force-password" @confirm="forcePassword" />
        <ConfirmDialog v-model:open="revokeOpen" :title="trans('members.revoke_sessions.title')" :body="trans('members.revoke_sessions.body')" :confirm-label="trans('members.actions.revoke_sessions')" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-10.revoke-sessions" @confirm="revokeSessions" />
        <ConfirmDialog v-model:open="reset2faOpen" :title="trans('members.reset_2fa.title')" :body="trans('members.reset_2fa.body')" :confirm-label="trans('members.reset_2fa.submit')" reason four-eyes :processing="action.processing.value" :error="action.error.value" test-id="ADM-10.reset-2fa" @confirm="resetTwoFactor" />
        <ConfirmDialog v-model:open="exportOpen" :title="trans('members.export.title')" :body="trans('members.export.body')" :confirm-label="trans('members.export.submit')" tone="neutral" reason four-eyes :processing="action.processing.value" :error="action.error.value" test-id="ADM-10.export" @confirm="requestExport" />
        <ConfirmDialog v-model:open="deleteOpen" :title="trans('members.delete.title', { name: title })" :body="trans('members.delete.body')" :confirm-label="trans('members.delete.submit')" typed reason four-eyes :processing="action.processing.value" :error="action.error.value" test-id="ADM-10.delete" @confirm="requestDelete" />

        <!-- e-mail change -->
        <Dialog v-model:open="emailOpen" :title="trans('members.email.title')" :description="trans('members.email.body')" test-id="ADM-10.email-dialog">
            <form id="adm10-email" class="flex flex-col gap-16" novalidate @submit.prevent="submitEmail">
                <Field :label="trans('members.email.new')" :error="emailErrors.email" required>
                    <Input v-model="email.address" type="email" autocomplete="off" maxlength="255" data-testid="ADM-10.email.address" />
                </Field>
                <div class="flex flex-col gap-4">
                    <Checkbox v-model="email.verified" :label="trans('members.email.identity')" :invalid="Boolean(emailErrors.identity)" data-testid="ADM-10.email.identity" />
                    <p v-if="emailErrors.identity" class="text-helper text-danger" role="alert">{{ emailErrors.identity }}</p>
                </div>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="emailErrors.reason" required>
                    <Textarea v-model="email.reason" :rows="3" :maxlength="1000" show-count data-testid="ADM-10.email.reason" />
                </Field>
                <p v-if="action.error.value" class="text-helper text-danger" role="alert">{{ action.error.value }}</p>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="close">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm10-email" variant="primary" :loading="action.processing.value" data-testid="ADM-10.email.save">{{ trans('members.email.submit') }}</Button>
            </template>
        </Dialog>

        <!-- view-as -->
        <Dialog v-model:open="viewAsOpen" :title="trans('members.view_as.title', { name: title })" :description="trans('members.view_as.body', { minutes: formatNumber(30) })" test-id="ADM-10.view-as">
            <form id="adm10-view-as" class="flex flex-col gap-16" novalidate @submit.prevent="startViewAs">
                <Field :label="trans('ui.confirm.reason')" :hint="trans('members.view_as.reason_hint')" :error="viewAsErrors.reason" required>
                    <Textarea v-model="viewAsForm.reason" :rows="3" :maxlength="1000" show-count data-testid="ADM-10.view-as.reason" />
                </Field>
                <div class="flex flex-col gap-4">
                    <Checkbox v-model="viewAsForm.consent" :label="trans(supportOnly ? 'members.view_as.consent' : 'members.view_as.consent_optional')" :invalid="Boolean(viewAsErrors.consent)" data-testid="ADM-10.view-as.consent" />
                    <p v-if="viewAsErrors.consent" class="text-helper text-danger" role="alert">{{ viewAsErrors.consent }}</p>
                </div>
                <p class="text-helper text-ink-3">{{ trans('members.view_as.read_only') }}</p>
                <p v-if="viewAsNote" class="text-helper text-ink-2" role="status" data-testid="ADM-10.view-as.note">{{ viewAsNote }}</p>
                <p v-if="viewAsErrors.form" class="text-helper text-danger" role="alert">{{ viewAsErrors.form }}</p>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="viewAsBusy" data-dialog-cancel @click="close">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm10-view-as" variant="primary" :icon="PhArrowSquareOut" :loading="viewAsBusy" data-testid="ADM-10.view-as.start">{{ trans('members.view_as.start') }}</Button>
            </template>
        </Dialog>
    </div>
</template>
