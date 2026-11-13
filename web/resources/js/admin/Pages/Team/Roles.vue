<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhLockSimple, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, Drawer, EmptyQueue, Field, IconButton, Input, Skeleton, Textarea, Tooltip } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import AtomPicker from './Partials/AtomPicker.vue';
import { roleDescription, roleLabel } from './shared';

/**
 * ADM-41 roles (06 §3 Team & roles, m3.6 §1): the six base roles and custom ones, each with its description, number of permissions and
 * team members. Custom roles are added with name, description and permissions; edits of permissions follow the matrix rules (a
 * sensitive permission waits for `roles.sensitive_atoms`); a custom role nobody holds can be deleted with a reason.
 */
interface MatrixRole {
    name: string;
    description: string | null;
    locked: boolean;
    system: boolean;
    atoms: string[];
    staff: number;
}
const props = defineProps<{ matrix: { atoms: string[]; sensitive: string[]; roles: MatrixRole[] }; ids: Record<string, number> }>();

const { can } = usePermissions();
const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const manage = computed(() => can('roles.manage'));
const customRoles = computed(() => props.matrix.roles.filter((r) => !r.system));
const shown = computed(() => (pageState.value === 'empty' ? props.matrix.roles.filter((r) => r.system) : props.matrix.roles));
const kind = (role: MatrixRole) => (role.locked ? 'locked' : role.system ? 'system' : 'custom');

// ---- drawer -------------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const drawerOpen = ref(false);
const editing = ref<MatrixRole | null>(null);
const form = reactive({ name: '', description: '', atoms: [] as string[], reason: '' });
const errors = reactive<{ name: string | null; reason: string | null }>({ name: null, reason: null });
const addedSensitive = computed(() => form.atoms.filter((a) => props.matrix.sensitive.includes(a) && !(editing.value?.atoms ?? []).includes(a)));
const fourEyes = computed(() => addedSensitive.value.length > 0);
function openDrawer(role: MatrixRole | null): void {
    editing.value = role;
    Object.assign(form, { name: role?.name ?? '', description: role?.description ?? '', atoms: [...(role?.atoms ?? [])], reason: '' });
    errors.name = null;
    errors.reason = null;
    action.reset();
    drawerOpen.value = true;
}
function save(): void {
    const name = form.name.trim();
    errors.name = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{2,59}$/u.test(name) ? null : trans('team.role_form.errors.name');
    const reason = form.reason.trim();
    errors.reason = fourEyes.value && (reason.length < 10 || reason.length > 1000) ? trans('team.role_form.errors.reason') : null;
    if (errors.name || errors.reason) return;
    const data = { name, description: form.description.trim() === '' ? null : form.description.trim(), atoms: form.atoms, reason: reason === '' ? null : reason };
    const role = editing.value;
    if (role === null) action.run('post', routeOr('admin.team.roles.store', '/admin/team/roles'), data, { sensitive: true, onSuccess: () => (drawerOpen.value = false) });
    else {
        const id = props.ids[role.name] ?? 0;
        action.run('patch', routeOr('admin.team.roles.update-role', `/admin/team/roles/${id}`, { role: id }), data, { sensitive: true, onSuccess: () => (drawerOpen.value = false) });
    }
}

// ---- delete -------------------------------------------------------------------------------------------------------------------
const deleting = ref<MatrixRole | null>(null);
const deleteOpen = computed({ get: () => deleting.value !== null, set: (v: boolean) => (v ? null : (deleting.value = null)) });
function remove(reason: string | null): void {
    const role = deleting.value;
    if (role === null) return;
    const id = props.ids[role.name] ?? 0;
    action.run('delete', routeOr('admin.team.roles.destroy', `/admin/team/roles/${id}`, { role: id }), { reason: reason ?? '' }, { sensitive: true, onSuccess: () => (deleting.value = null) });
}

// ---- QA overlays --------------------------------------------------------------------------------------------------------------
onMounted(async () => {
    const overlay = qaDialog();
    if (overlay === 'create') {
        openDrawer(null);
        Object.assign(form, { name: 'Community-Team', description: 'Beantwortet Support-Tickets und prüft gemeldete Fotos.', atoms: ['media.review', 'members.view', 'support.reply', 'support.view'] });
    } else if (overlay === 'edit') {
        const role = customRoles.value[0] ?? props.matrix.roles.find((r) => !r.locked);
        if (role) {
            openDrawer(role);
            form.atoms = [...new Set([...form.atoms, 'approvals.decide'])].sort();
            form.reason = 'Übernimmt ab Montag die Freigaben der Moderation.';
        }
    } else if (overlay === 'delete') {
        const role = customRoles.value.find((r) => r.staff === 0);
        if (role) deleting.value = role;
    } else return;
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('team.roles_page.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-41" :data-qa-state="pageState">
        <PageHeader :title="trans('team.roles_page.title')" :crumbs="[{ label: trans('shell.groups.team') }]" :description="trans('team.roles_page.intro')">
            <template v-if="manage" #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-41.create" @click="openDrawer(null)">{{ trans('team.roles_page.create') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('team.roles_page.error')" :body="trans('ui.state.error_body')" test-id="ADM-41.error" @retry="router.reload()" />
        <div v-else-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-busy="true" data-testid="ADM-41.loading">
            <div class="flex h-40 items-center gap-24 border-b border-line-subtle px-12"><Skeleton shape="text" class="w-120" /><Skeleton shape="text" class="ml-auto w-80" /></div>
            <div v-for="n in 6" :key="n" class="flex min-h-56 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0">
                <span class="flex flex-1 flex-col gap-4"><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /></span>
                <Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-80" /><Skeleton shape="text" class="w-120" />
            </div>
        </div>
        <template v-else>
            <ScrollRegion :label="trans('team.roles_page.caption')">
                <table class="w-full border-collapse text-admin-base" data-testid="ADM-41.table">
                    <caption class="sr-only">{{ trans('team.roles_page.caption') }}</caption>
                    <thead class="bg-surface text-left text-admin-base-strong text-ink-2">
                        <tr class="h-40 border-b border-line-subtle">
                            <th scope="col" class="px-12">{{ trans('team.roles_page.columns.role') }}</th>
                            <th scope="col" class="px-12 text-right">{{ trans('team.roles_page.columns.atoms') }}</th>
                            <th scope="col" class="px-12 text-right">{{ trans('team.roles_page.columns.staff') }}</th>
                            <th scope="col" class="px-12">{{ trans('team.roles_page.columns.kind') }}</th>
                            <th v-if="manage" scope="col" class="w-96 px-12"><span class="sr-only">{{ trans('team.roles_page.columns.actions') }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="role in shown" :key="role.name" class="border-b border-line-subtle last:border-b-0" :data-testid="`ADM-41.role.${role.name}`">
                            <td class="px-12 py-8 align-top">
                                <span class="block text-admin-base-strong text-ink">{{ roleLabel(role.name) }}</span>
                                <span v-if="roleDescription(role.name, role.description)" class="block max-w-640 text-admin-base text-ink-3">{{ roleDescription(role.name, role.description) }}</span>
                            </td>
                            <td class="whitespace-nowrap px-12 py-8 text-right align-top text-ink tabular-nums">{{ role.locked ? trans('team.matrix.locked') : formatNumber(role.atoms.length) }}</td>
                            <td class="whitespace-nowrap px-12 py-8 text-right align-top text-ink tabular-nums">{{ transChoice('team.roles_page.staff_count', role.staff, { count: formatNumber(role.staff) }) }}</td>
                            <td class="whitespace-nowrap px-12 py-8 align-top text-ink-2">
                                <span class="inline-flex items-center gap-4"><PhLockSimple v-if="role.locked" :size="16" aria-hidden="true" />{{ trans(`team.roles_page.kind.${kind(role)}`) }}</span>
                            </td>
                            <td v-if="manage" class="px-12 py-4 align-top">
                                <span class="flex justify-end gap-4">
                                    <IconButton v-if="!role.locked" :icon="PhPencilSimple" :label="`${trans('team.roles_page.edit')}: ${roleLabel(role.name)}`" size="sm" :data-testid="`ADM-41.edit.${role.name}`" @click="openDrawer(role)" />
                                    <template v-if="!role.system">
                                        <Tooltip v-if="role.staff > 0" :content="trans('team.roles_page.in_use')"><IconButton :icon="PhTrash" :label="`${trans('team.roles_page.delete')}: ${role.name}`" size="sm" disabled /></Tooltip>
                                        <IconButton v-else :icon="PhTrash" :label="`${trans('team.roles_page.delete')}: ${role.name}`" size="sm" :data-testid="`ADM-41.delete.${role.name}`" @click="(action.reset(), (deleting = role))" />
                                    </template>
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
            <EmptyQueue v-if="customRoles.length === 0 || pageState === 'empty'" variant="quiet" compact :title="trans('team.roles_page.kind.custom')" :body="trans('team.roles_page.empty_custom')" data-testid="ADM-41.empty" />
        </template>

        <Drawer v-model:open="drawerOpen" :title="editing ? trans('team.role_form.edit_title', { name: roleLabel(editing.name) }) : trans('team.role_form.create_title')" :dismissible="!action.processing.value" size="lg" test-id="ADM-41.drawer">
            <form class="flex flex-col gap-16" novalidate @submit.prevent="save()">
                <StateBlock v-if="action.error.value" kind="error" :title="trans('ui.state.error_title')" :body="action.error.value" :retryable="false" test-id="ADM-41.drawer.server-error" />
                <Field :label="trans('team.role_form.name')" :hint="trans('team.role_form.name_hint')" :error="errors.name" required>
                    <Input v-model="form.name" maxlength="60" :disabled="editing?.system === true" data-autofocus data-testid="ADM-41.drawer.name" />
                </Field>
                <Field :label="trans('team.role_form.description')" :hint="trans('team.role_form.description_hint')" optional>
                    <Textarea v-model="form.description" :rows="2" :maxlength="500" show-count data-testid="ADM-41.drawer.description" />
                </Field>
                <p class="text-admin-base text-ink-2">{{ transChoice('team.role_form.atoms_count', form.atoms.length, { count: formatNumber(form.atoms.length) }) }} · {{ trans('team.role_form.sensitive') }}</p>
                <AtomPicker v-model="form.atoms" :atoms="matrix.atoms" :sensitive="matrix.sensitive" :legend="trans('team.role_form.atoms')" test-id="ADM-41.drawer.atoms" />
                <template v-if="fourEyes">
                    <ApprovalNotice test-id="ADM-41.drawer.four-eyes" />
                    <Field :label="trans('ui.confirm.reason')" :hint="trans('team.role_form.reason_hint')" :error="errors.reason" required><Textarea v-model="form.reason" :rows="2" :maxlength="1000" show-count data-testid="ADM-41.drawer.reason" /></Field>
                </template>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" data-testid="ADM-41.drawer.submit" @click="save()">{{ fourEyes ? trans('team.role_form.submit_four_eyes') : trans('team.role_form.submit') }}</Button>
            </template>
        </Drawer>

        <ConfirmDialog v-model:open="deleteOpen" :title="trans('team.role_delete.title', { name: deleting?.name ?? '' })" :body="trans('team.role_delete.body')" :confirm-label="trans('team.roles_page.delete')" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-41.delete-dialog" @confirm="(r: string | null) => remove(r)" />
    </div>
</template>
