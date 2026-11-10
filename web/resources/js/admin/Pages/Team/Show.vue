<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhEnvelopeSimple, PhKey, PhProhibit, PhSignOut, PhTrash, PhUserGear } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import type { TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import RecordLayout from '../../Components/record/RecordLayout.vue';
import { Button, ConfirmDialog, Drawer, Field, Skeleton, Textarea } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actorName } from '../../lib/audit';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import RolePicker from './Partials/RolePicker.vue';
import { atomGroupLabel, atomLabel, atomsOf, groupAtoms, roleChangeReasons, roleDescription, roleLabel, stateTones, teamEventLabel, type RoleOption, type StaffRow } from './shared';

/**
 * ADM-40 staff detail (m3.6 §1, ADR-237/238): roles with the atoms they carry and the atom diff of a change before it is asked; status
 * and second factor; sessions (by device and last activity); the audit timeline. Actions by the Owner rules: change roles, deactivate,
 * reactivate, delete (typed, only deactivated), end every session, reset a lost second factor (Owner, four-eyes), resend the invitation.
 * Four-eyes steps ask for an approval; the shell shows the ApprovalNotice from the flash.
 */
interface Member extends StaffRow {
    deactivated_at: string | null;
    two_factor_confirmed_at: string | null;
    privileged: boolean;
    owner: boolean;
    atoms: string[];
}
interface Session {
    handle: string;
    current: boolean;
    last_active_at: string;
    browser: string | null;
    os: string | null;
}
const props = defineProps<{
    member: Member;
    roles: RoleOption[];
    atomOrder: string[];
    sessions: Session[];
    pending: { id: string; action: string; title: string; requested_by: string | null; expires_at: string }[];
    activity: { id: number; occurred_at: string; action: string; actor: string | null; actor_type?: string; actor_id?: string | null; reason: string | null }[];
    owners: { active: number; max: number };
    can: { roles: boolean; deactivate: boolean; reactivate: boolean; delete: boolean; revoke_sessions: boolean; reset_two_factor: boolean; resend_invite: boolean; viewer_is_owner: boolean };
}>();

const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const tab = ref('roles');
const tabs = computed(() => [
    { value: 'roles', label: trans('team.show.tabs.roles') },
    // No "0" badge on the tab (DQ-659): the count shows only when there are sessions.
    { value: 'security', label: trans('team.show.tabs.security'), count: props.sessions.length > 0 ? props.sessions.length : undefined },
]);
const crumbs = computed(() => [{ label: trans('shell.groups.team') }, { label: trans('team.index.title'), href: routeOr('admin.team.staff', '/admin/team') }]);
const status = computed(() => ({ tone: stateTones[props.member.state], label: trans(`team.state.${props.member.state}`) }));
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: teamEventLabel(e.action), actor: actorName(e), reason: e.reason })));
const meta = computed(() =>
    [
        props.member.email,
        trans('team.show.since', { date: formatDate(props.member.created_at) }),
        props.member.state === 'deactivated' && props.member.deactivated_at ? trans('team.show.deactivated_at', { date: formatDate(props.member.deactivated_at) }) : props.member.last_login_at ? trans('team.show.last_login', { date: formatDateTime(props.member.last_login_at) }) : trans('team.show.never_signed_in'),
    ].filter((part): part is string => typeof part === 'string' && part !== ''),
);
const anyAction = computed(() => Object.entries(props.can).some(([key, value]) => key !== 'viewer_is_owner' && value));
const atomGroups = computed(() => groupAtoms(props.member.atoms));
const allAtoms = computed(() => props.member.roles.some((r) => r === 'owner' || r === 'admin'));
const describe = (name: string) => roleDescription(name, props.roles.find((r) => r.name === name)?.description ?? null);

// ---- dialogs ---------------------------------------------------------------------------------------------------------------
type DialogName = 'roles' | 'deactivate' | 'reactivate' | 'delete' | 'revoke_sessions' | 'reset_two_factor' | 'resend';
const open = ref<DialogName | null>(null);
const action = useAdminAction();
const url = (step: string) => routeOr(`admin.team.${step}`, `/admin/team/${props.member.id}/${step}`, { staff: props.member.id });
function show(name: DialogName): void {
    action.reset();
    if (name === 'roles') {
        draftRoles.value = [...props.member.roles];
        rolesReason.value = '';
        rolesError.value = null;
    }
    open.value = name;
}
function close(): void {
    open.value = null;
}
const dialogOpen = (name: DialogName) =>
    computed({
        get: () => open.value === name,
        set: (value: boolean) => {
            if (!value && open.value === name) close();
        },
    });
const deactivateOpen = dialogOpen('deactivate');
const reactivateOpen = dialogOpen('reactivate');
const deleteOpen = dialogOpen('delete');
const revokeOpen = dialogOpen('revoke_sessions');
const resetOpen = dialogOpen('reset_two_factor');
const resendOpen = dialogOpen('resend');
const rolesOpen = dialogOpen('roles');

function post(step: 'deactivate' | 'reactivate' | 'delete' | 'revoke-sessions' | 'reset-two-factor' | 'resend-invite', reason: string | null): void {
    action.run('post', url(step), reason === null ? {} : { reason }, { sensitive: true, onSuccess: close });
}

// ---- roles drawer: the atom diff before asking ------------------------------------------------------------------------------
const draftRoles = ref<string[]>([]);
const rolesReason = ref('');
const rolesError = ref<string | null>(null);
const before = computed(() => atomsOf(props.member.roles, props.roles));
const after = computed(() => atomsOf(draftRoles.value, props.roles));
const ordered = (atoms: string[]) => props.atomOrder.filter((a) => atoms.includes(a));
const added = computed(() => ordered(after.value.filter((a) => !before.value.includes(a))));
const removed = computed(() => ordered(before.value.filter((a) => !after.value.includes(a))));
const changed = computed(() => [...draftRoles.value].sort().join('|') !== [...props.member.roles].sort().join('|'));
const reasons = computed(() => (changed.value ? roleChangeReasons(props.member.roles, draftRoles.value, props.roles) : []));
const fourEyes = computed(() => reasons.value.length > 0);
const disabledRoles = computed(() => {
    const list = props.can.viewer_is_owner ? [] : ['owner'];
    // Nobody adds a role to their own account (stepping down is allowed).
    if (props.member.me) list.push(...props.roles.map((r) => r.name).filter((name) => !props.member.roles.includes(name)));
    return list;
});
function saveRoles(): void {
    const reason = rolesReason.value.trim();
    if (fourEyes.value && (reason.length < 10 || reason.length > 1000)) {
        rolesError.value = trans('team.invite.errors.reason');
        return;
    }
    rolesError.value = null;
    action.run('patch', routeOr('admin.team.roles.update', `/admin/team/${props.member.id}/roles`, { staff: props.member.id }), { roles: draftRoles.value, reason: reason === '' ? null : reason }, { sensitive: true, onSuccess: close });
}
watch(open, (value) => {
    if (value === null) action.reset();
});

// ---- QA overlays (?dialog=, non-production, DQ-529) ------------------------------------------------------------------------------
const QA: Record<string, DialogName> = { roles: 'roles', deactivate: 'deactivate', reactivate: 'reactivate', delete: 'delete', 'revoke-sessions': 'revoke_sessions', 'reset-2fa': 'reset_two_factor', resend: 'resend' };
onMounted(async () => {
    const name = QA[qaDialog() ?? ''];
    if (name === undefined) return;
    show(name);
    if (name === 'roles') draftRoles.value = props.member.roles.includes('admin') ? props.member.roles.filter((r) => r !== 'admin').concat('support') : [...new Set([...props.member.roles, 'admin'])].sort();
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
const sessionText = (s: Session) => (s.browser || s.os ? trans('team.show.session_line', { browser: s.browser ?? '–', os: s.os ?? '–' }) : trans('team.show.session_unknown'));
</script>

<template>
    <Head :title="member.name" />
    <div :data-qa-state="pageState" data-testid="ADM-40-page">
        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('team.show.error')" :body="trans('ui.state.error_body')" test-id="ADM-40.error" @retry="router.reload()" />
        <RecordLayout
            v-else
            v-model:tab="tab"
            :title="member.name"
            :crumbs="crumbs"
            :status="status"
            :tabs="tabs"
            :tabs-label="trans('team.show.tabs_label')"
            :activity="activity"
            :loading="pageState === 'loading'"
            :loading-actions="3"
            :actions-below="true"
            test-id="ADM-40"
        >
            <template #loading>
                <div class="flex flex-col gap-24" aria-hidden="true">
                    <div class="flex flex-col gap-8"><Skeleton shape="text" class="h-20 w-120" /><Skeleton shape="text" class="w-320" /></div>
                    <div class="flex flex-col gap-8"><Skeleton shape="text" class="h-20 w-200" /><Skeleton v-for="n in 4" :key="n" shape="text" class="w-full" /></div>
                </div>
            </template>
            <template #meta>
                <p class="flex flex-wrap items-center gap-x-8 gap-y-4 text-supporting text-ink-2 tabular-nums" data-testid="ADM-40.meta">{{ meta.join(' · ') }}</p>
            </template>
            <template v-if="anyAction" #actions>
                <Button v-if="can.roles" size="sm" variant="secondary" :icon="PhUserGear" data-testid="ADM-40.roles" @click="show('roles')">{{ trans('team.actions.roles') }}</Button>
                <Button v-if="can.resend_invite" size="sm" variant="secondary" :icon="PhEnvelopeSimple" data-testid="ADM-40.resend" @click="show('resend')">{{ trans('team.actions.resend_invite') }}</Button>
                <Button v-if="can.reactivate" size="sm" variant="secondary" :icon="PhArrowCounterClockwise" data-testid="ADM-40.reactivate" @click="show('reactivate')">{{ trans('team.actions.reactivate') }}</Button>
                <Button v-if="can.deactivate" size="sm" variant="destructive" :icon="PhProhibit" data-testid="ADM-40.deactivate" @click="show('deactivate')">{{ trans('team.actions.deactivate') }}</Button>
                <Button v-if="can.delete" size="sm" variant="destructive" :icon="PhTrash" data-testid="ADM-40.delete" @click="show('delete')">{{ trans('team.actions.delete') }}</Button>
            </template>

            <template #roles>
                <div class="flex flex-col gap-24 pt-24">
                    <section v-if="pending.length > 0" class="flex flex-col gap-8 rounded-sm border border-line px-16 py-12" data-testid="ADM-40.pending">
                        <h2 class="text-label text-ink">{{ trans('team.show.pending_title') }}</h2>
                        <ul class="flex flex-col gap-4">
                            <li v-for="p in pending" :key="p.id" class="text-supporting text-ink-2 tabular-nums">{{ trans('team.show.pending_line', { title: trans(p.title), name: p.requested_by ?? '–', date: formatDateTime(p.expires_at) }) }}</li>
                        </ul>
                    </section>
                    <p v-if="member.me" class="text-supporting text-ink-2" data-testid="ADM-40.self">{{ trans('team.show.own_account') }}</p>
                    <p v-else-if="!anyAction && member.state !== 'deleted'" class="text-supporting text-ink-2" data-testid="ADM-40.view-only">{{ member.owner && !can.viewer_is_owner ? trans('team.show.owner_view_only') : trans('team.show.view_only') }}</p>

                    <section class="flex flex-col gap-8" data-testid="ADM-40.role-list">
                        <h2 class="text-title-s text-ink">{{ trans('team.show.roles_title') }}</h2>
                        <p v-if="member.roles.length === 0" class="text-supporting text-ink-2">{{ trans('team.show.no_roles') }}</p>
                        <ul v-else class="flex flex-col gap-8">
                            <li v-for="role in member.roles" :key="role" class="flex flex-col gap-2" :data-testid="`ADM-40.role.${role}`">
                                <span class="text-label text-ink">{{ roleLabel(role) }}</span>
                                <span v-if="describe(role)" class="max-w-640 text-helper text-ink-3">{{ describe(role) }}</span>
                            </li>
                        </ul>
                    </section>

                    <section class="flex flex-col gap-12" data-testid="ADM-40.atoms">
                        <div class="flex flex-wrap items-baseline gap-x-12 gap-y-4">
                            <h2 class="text-title-s text-ink">{{ trans('team.show.atoms_title') }}</h2>
                            <span class="text-supporting text-ink-3 tabular-nums">{{ transChoice('team.show.atoms_count', member.atoms.length, { count: formatNumber(member.atoms.length) }) }}</span>
                        </div>
                        <p v-if="allAtoms" class="text-supporting text-ink-2">{{ trans('team.show.all_atoms') }}</p>
                        <dl v-else-if="atomGroups.length > 0" class="grid grid-cols-1 gap-x-24 gap-y-12 tablet:grid-cols-2">
                            <div v-for="group in atomGroups" :key="group.group" class="flex flex-col gap-2">
                                <dt class="text-caption text-ink-3">{{ atomGroupLabel(group.group) }}</dt>
                                <dd class="text-supporting text-ink">{{ group.atoms.map(atomLabel).join(', ') }}</dd>
                            </div>
                        </dl>
                    </section>
                </div>
            </template>

            <template #security>
                <div class="flex flex-col gap-24 pt-24">
                    <section class="flex flex-col gap-8" data-testid="ADM-40.two-factor">
                        <h2 class="text-title-s text-ink">{{ trans('team.show.security_title') }}</h2>
                        <p class="text-supporting text-ink-2 tabular-nums">{{ member.two_factor ? trans('team.show.two_factor_on', { date: formatDate(member.two_factor_confirmed_at) }) : trans('team.show.two_factor_off') }}</p>
                        <div v-if="can.reset_two_factor" class="flex"><Button size="sm" variant="destructive" :icon="PhKey" data-testid="ADM-40.reset-2fa" @click="show('reset_two_factor')">{{ trans('team.actions.reset_two_factor') }}</Button></div>
                    </section>
                    <section class="flex flex-col gap-8" data-testid="ADM-40.sessions">
                        <div class="flex flex-wrap items-center justify-between gap-12">
                            <h2 class="text-title-s text-ink">{{ trans('team.show.sessions_title') }}</h2>
                            <Button v-if="can.revoke_sessions && sessions.length > 0" size="sm" variant="secondary" :icon="PhSignOut" data-testid="ADM-40.revoke-sessions" @click="show('revoke_sessions')">{{ trans('team.actions.revoke_sessions') }}</Button>
                        </div>
                        <p v-if="sessions.length === 0" class="text-supporting text-ink-2">{{ trans('team.show.sessions_empty') }}</p>
                        <ul v-else class="flex flex-col rounded-sm border border-line-subtle">
                            <li v-for="s in sessions" :key="s.handle" class="flex min-h-40 flex-wrap items-center gap-x-12 gap-y-2 border-b border-line-subtle px-12 py-8 text-supporting last:border-b-0">
                                <span class="min-w-0 flex-1 text-ink">{{ sessionText(s) }}</span>
                                <span class="text-ink-3 tabular-nums">{{ trans('team.show.session_active', { date: formatDateTime(s.last_active_at) }) }}</span>
                            </li>
                        </ul>
                    </section>
                </div>
            </template>
        </RecordLayout>

        <Drawer v-model:open="rolesOpen" :title="trans('team.roles_drawer.title', { name: member.name })" :description="trans('team.roles_drawer.body')" :dismissible="!action.processing.value" size="lg" test-id="ADM-40.roles-drawer">
            <div class="flex flex-col gap-16">
                <StateBlock v-if="action.error.value" kind="error" :title="trans('ui.state.error_title')" :body="action.error.value" :retryable="false" test-id="ADM-40.roles-drawer.server-error" />
                <p v-if="member.me" class="text-helper text-ink-2">{{ trans('team.roles_drawer.self') }}</p>
                <RolePicker v-model="draftRoles" :options="roles" :disabled="disabledRoles" :legend="trans('team.invite.roles')" :hint="trans('team.invite.roles_hint')" test-id="ADM-40.roles-drawer.roles" />
                <!-- DQ-633: one permission per line, grouped by area, the "+" in the success tone; an empty side is one quiet line. -->
                <section class="flex flex-col gap-16" data-testid="ADM-40.roles-drawer.diff" aria-live="polite">
                    <div class="flex flex-col gap-8" data-testid="ADM-40.roles-drawer.added">
                        <template v-if="added.length > 0">
                            <h3 class="text-label-s text-ink">{{ trans('team.roles_drawer.added') }}</h3>
                            <dl class="grid grid-cols-1 gap-x-24 gap-y-8 tablet:grid-cols-2">
                                <div v-for="g in groupAtoms(added)" :key="g.group" class="flex flex-col gap-2">
                                    <dt class="text-caption text-ink-3">{{ atomGroupLabel(g.group) }}</dt>
                                    <dd v-for="a in g.atoms" :key="a" class="text-supporting text-ink"><span class="inline-block w-12 text-label-s text-success" aria-hidden="true">+</span> {{ atomLabel(a) }}</dd>
                                </div>
                            </dl>
                        </template>
                        <p v-else class="text-supporting text-ink-3">{{ trans('team.roles_drawer.none_added') }}</p>
                    </div>
                    <div class="flex flex-col gap-8" data-testid="ADM-40.roles-drawer.removed">
                        <template v-if="removed.length > 0">
                            <h3 class="text-label-s text-ink">{{ trans('team.roles_drawer.removed') }}</h3>
                            <dl class="grid grid-cols-1 gap-x-24 gap-y-8 tablet:grid-cols-2">
                                <div v-for="g in groupAtoms(removed)" :key="g.group" class="flex flex-col gap-2">
                                    <dt class="text-caption text-ink-3">{{ atomGroupLabel(g.group) }}</dt>
                                    <dd v-for="a in g.atoms" :key="a" class="text-supporting text-ink-2"><span class="inline-block w-12 text-label-s text-ink-3" aria-hidden="true">−</span> {{ atomLabel(a) }}</dd>
                                </div>
                            </dl>
                        </template>
                        <p v-else class="text-supporting text-ink-3">{{ trans('team.roles_drawer.none_removed') }}</p>
                    </div>
                </section>
                <template v-if="fourEyes">
                    <ApprovalNotice test-id="ADM-40.roles-drawer.four-eyes" />
                    <div class="flex flex-col gap-4 text-helper text-ink-2">
                        <p>{{ trans('team.roles_drawer.four_eyes') }}</p>
                        <ul class="flex flex-col gap-2"><li v-for="why in reasons" :key="why">{{ trans(`team.roles_drawer.why.${why}`) }}</li></ul>
                    </div>
                </template>
                <Field :label="trans('ui.confirm.reason')" :hint="fourEyes ? trans('team.invite.reason_hint') : trans('team.roles_drawer.reason_optional')" :error="rolesError" :required="fourEyes" :optional="!fourEyes">
                    <Textarea v-model="rolesReason" :rows="2" :maxlength="1000" show-count data-testid="ADM-40.roles-drawer.reason" />
                </Field>
            </div>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="close()">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :disabled="!changed" :loading="action.processing.value" data-testid="ADM-40.roles-drawer.submit" @click="saveRoles()">{{ fourEyes ? trans('team.roles_drawer.submit_four_eyes') : trans('team.roles_drawer.submit') }}</Button>
            </template>
        </Drawer>

        <ConfirmDialog v-model:open="deactivateOpen" :title="trans('team.deactivate.title', { name: member.name })" :body="trans('team.deactivate.body')" :confirm-label="trans('team.actions.deactivate')" reason :four-eyes="member.privileged" :processing="action.processing.value" :error="action.error.value" test-id="ADM-40.deactivate-dialog" @confirm="(r: string | null) => post('deactivate', r)" />
        <ConfirmDialog v-model:open="reactivateOpen" :title="trans('team.reactivate.title', { name: member.name })" :body="trans('team.reactivate.body')" :confirm-label="trans('team.actions.reactivate')" tone="neutral" reason :four-eyes="member.owner" :processing="action.processing.value" :error="action.error.value" test-id="ADM-40.reactivate-dialog" @confirm="(r: string | null) => post('reactivate', r)" />
        <ConfirmDialog v-model:open="deleteOpen" :title="trans('team.delete.title', { name: member.name })" :body="trans('team.delete.body')" :confirm-label="trans('team.actions.delete')" typed reason :four-eyes="member.owner" :processing="action.processing.value" :error="action.error.value" test-id="ADM-40.delete-dialog" @confirm="(r: string | null) => post('delete', r)" />
        <ConfirmDialog v-model:open="revokeOpen" :title="trans('team.revoke_sessions.title', { name: member.name })" :body="trans('team.revoke_sessions.body')" :confirm-label="trans('team.actions.revoke_sessions')" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-40.revoke-dialog" @confirm="(r: string | null) => post('revoke-sessions', r)" />
        <ConfirmDialog v-model:open="resetOpen" :title="trans('team.reset_two_factor.title', { name: member.name })" :body="trans('team.reset_two_factor.body')" :confirm-label="trans('team.actions.reset_two_factor')" reason four-eyes :processing="action.processing.value" :error="action.error.value" test-id="ADM-40.reset-2fa-dialog" @confirm="(r: string | null) => post('reset-two-factor', r)" />
        <ConfirmDialog v-model:open="resendOpen" :title="trans('team.resend.title', { name: member.name })" :body="trans('team.resend.body')" :confirm-label="trans('team.resend.submit')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-40.resend-dialog" @confirm="() => post('resend-invite', null)" />
    </div>
</template>
