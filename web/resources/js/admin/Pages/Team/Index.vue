<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { PhFunnel, PhUserPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import DataTable from '../../Components/data-table/DataTable.vue';
import NameCell from '../../Components/data-table/NameCell.vue';
import type { TableColumn } from '../../Components/data-table/table';
import { useAdminAction } from '../../Components/decisions/action';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Drawer, Field, Input, Select, StatusPill, Textarea } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import type { Paginated, PresetView, SavedView, TableQuery } from '../../types/table';
import RolePicker from './Partials/RolePicker.vue';
import { roleChangeReasons, roleLabel, staffHref, stateTones, type RoleOption, type StaffRow } from './shared';

/**
 * ADM-39 staff list (06 §3 Team & roles, m3.6 §1): name and address, roles, status, second factor, last sign-in; filters and presets;
 * the invite drawer (name, address, roles with the four-eyes mark, mail language; a reason when a role waits for approval).
 */
const props = defineProps<{
    rows: Paginated<StaffRow>;
    query: TableQuery;
    views: SavedView[];
    roles: RoleOption[];
    owners: { active: number; max: number };
    viewerIsOwner: boolean;
}>();

const { can } = usePermissions();
const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));

const columns = computed<TableColumn[]>(() => [
    { key: 'name', label: trans('team.index.columns.name'), grow: true, min: 240, hideable: false },
    { key: 'roles', label: trans('team.index.columns.roles'), min: 160, wrap: true, width: 'lg' },
    { key: 'state', label: trans('team.index.columns.state'), min: 120 },
    { key: 'two_factor', label: trans('team.index.columns.two_factor') },
    { key: 'last_login_at', label: trans('team.index.columns.last_login'), sort: 'last_login_at', min: 120 },
    { key: 'created_at', label: trans('team.index.columns.created'), sort: 'created_at', defaultHidden: true },
]);
const presets: PresetView[] = [
    { key: 'active', name: 'team.index.presets.active', query: { filter: { state: 'active' } } },
    { key: 'invited', name: 'team.index.presets.invited', query: { filter: { state: 'invited' } } },
    { key: 'deactivated', name: 'team.index.presets.deactivated', query: { filter: { state: 'deactivated' } } },
];

// ---- filters --------------------------------------------------------------------------------------------------------------
const FILTER_KEYS = ['q', 'state', 'role'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const filters = reactive<Record<FilterKey, string>>({ q: '', state: '', role: '' });
watch(
    () => props.query.filter,
    (filter) => FILTER_KEYS.forEach((key) => (filters[key] = filter[key] ?? '')),
    { immediate: true },
);
const ANY = '*';
function selectModel(key: FilterKey) {
    return computed({ get: () => (filters[key] === '' ? undefined : filters[key]), set: (v: string | undefined) => (filters[key] = v === undefined || v === ANY ? '' : v) });
}
const stateModel = selectModel('state');
const roleModel = selectModel('role');
const any = computed(() => ({ value: ANY, label: trans('team.index.filters.any') }));
const stateOptions = computed(() => [any.value, ...(['active', 'invited', 'suspended', 'deactivated', 'deleted'] as const).map((v) => ({ value: v, label: trans(`team.state.${v}`) }))]);
const roleOptions = computed(() => [any.value, ...props.roles.map((r) => ({ value: r.name, label: roleLabel(r.name) }))]);

function rolesText(roles: string[]): string {
    return roles.length === 0 ? '–' : roles.map(roleLabel).join(', ');
}
function inviteText(row: StaffRow): string | null {
    if (row.state !== 'invited' || row.invite_expires_at === null) return null;
    return Date.parse(row.invite_expires_at) > Date.now() ? trans('team.index.invite_until', { date: formatDateTime(row.invite_expires_at) }) : trans('team.index.invite_expired');
}

// ---- invite drawer ----------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const inviteOpen = ref(false);
const form = reactive({ name: '', email: '', roles: [] as string[], locale: 'de', reason: '' });
const errors = reactive<Record<string, string | null>>({ name: null, email: null, roles: null, reason: null });
const localeOptions = computed(() => (['de', 'en'] as const).map((v) => ({ value: v, label: trans(`team.invite.locales.${v}`) })));
const disabledRoles = computed(() => (props.viewerIsOwner ? [] : ['owner']));
const fourEyes = computed(() => form.roles.length > 0 && roleChangeReasons([], form.roles, props.roles).includes('elevates'));
function openInvite(): void {
    Object.assign(form, { name: '', email: '', roles: [], locale: 'de', reason: '' });
    Object.keys(errors).forEach((key) => (errors[key] = null));
    action.reset();
    inviteOpen.value = true;
}
function submitInvite(): void {
    errors.name = form.name.trim().length < 2 ? trans('team.invite.errors.name') : null;
    errors.email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? null : trans('team.invite.errors.email');
    errors.roles = form.roles.length === 0 ? trans('team.invite.errors.roles') : null;
    const reason = form.reason.trim();
    errors.reason = fourEyes.value && (reason.length < 10 || reason.length > 1000) ? trans('team.invite.errors.reason') : null;
    if (Object.values(errors).some((e) => e !== null)) return;
    action.run('post', routeOr('admin.team.invite', '/admin/team/invite'), { name: form.name.trim(), email: form.email.trim(), roles: form.roles, locale: form.locale, reason: fourEyes.value ? reason : null }, { sensitive: true, onSuccess: () => (inviteOpen.value = false) });
}
if (qaDialog() === 'invite') {
    openInvite();
    Object.assign(form, { name: 'Jana Wolff', email: 'jana.wolff@speedclub.de', roles: ['admin'], reason: 'Übernimmt ab Montag die Vertretung im Team.' });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Head :title="trans('team.index.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-39" :data-qa-state="pageState">
        <PageHeader :title="trans('team.index.title')" :crumbs="[{ label: trans('shell.groups.team') }]" :description="trans('team.index.intro')">
            <template #meta>
                <p class="text-supporting text-ink-2 tabular-nums" data-testid="ADM-39.owners">{{ trans('team.index.owners', { count: formatNumber(owners.active), max: formatNumber(owners.max) }) }}</p>
            </template>
            <template v-if="can('staff.invite')" #actions>
                <Button size="sm" variant="primary" :icon="PhUserPlus" data-testid="ADM-39.invite" @click="openInvite()">{{ trans('team.index.invite') }}</Button>
            </template>
        </PageHeader>

        <DataTable
            id="team-staff"
            :columns="columns"
            :rows="rows"
            :query="query"
            :views="views"
            :presets="presets"
            :only="['rows', 'query', 'views', 'owners']"
            :caption="trans('team.index.caption')"
            :empty-title="trans('team.index.empty_title')"
            :empty-body="trans('team.index.empty_body')"
            :row-href="(row: StaffRow) => staffHref(row.id)"
            :force-state="pageState === 'loading' || pageState === 'error' || pageState === 'empty' ? pageState : undefined"
            test-id="ADM-39.table"
        >
            <template #filters="{ apply, loading }">
                <form class="flex w-full flex-wrap items-end gap-8 desktop:flex-nowrap" :aria-label="trans('team.index.filters.label')" @submit.prevent="apply({ ...filters })">
                    <div class="min-w-200 grow-2 basis-0"><Field :label="trans('team.index.filters.q')"><Input v-model="filters.q" size="sm" maxlength="120" :placeholder="trans('team.index.filters.q_placeholder')" data-testid="ADM-39.filter.q" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('team.index.filters.state')"><Select v-model="stateModel" :options="stateOptions" size="sm" :placeholder="trans('team.index.filters.any')" data-testid="ADM-39.filter.state" /></Field></div>
                    <div class="min-w-140 grow basis-0"><Field :label="trans('team.index.filters.role')"><Select v-model="roleModel" :options="roleOptions" size="sm" :placeholder="trans('team.index.filters.any')" data-testid="ADM-39.filter.role" /></Field></div>
                    <Button type="submit" size="sm" variant="primary" :icon="PhFunnel" :loading="loading" class="shrink-0" data-testid="ADM-39.filter.apply">{{ trans('team.index.filters.apply') }}</Button>
                </form>
            </template>

            <template #cell-name="{ row }">
                <NameCell :name="row.me ? `${row.name} (${trans('team.you')})` : row.name" :caption="row.email" :href="staffHref(row.id)" test-id="ADM-39.open" />
            </template>
            <template #cell-roles="{ row }"><span class="text-ink-2">{{ rolesText(row.roles) }}</span></template>
            <template #cell-state="{ row }">
                <span class="flex flex-col items-start gap-2">
                    <StatusPill :tone="stateTones[row.state as StaffRow['state']]" :label="trans(`team.state.${row.state}`)" />
                    <span v-if="inviteText(row)" class="whitespace-nowrap text-caption text-ink-3 tabular-nums">{{ inviteText(row) }}</span>
                </span>
            </template>
            <template #cell-two_factor="{ row }"><span class="whitespace-nowrap" :class="row.two_factor ? 'text-ink-2' : 'text-ink-3'">{{ row.two_factor ? trans('team.yes') : trans('team.no') }}</span></template>
            <template #cell-last_login_at="{ row }">
                <time v-if="row.last_login_at" :datetime="row.last_login_at" :title="formatDateTime(row.last_login_at)" class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.last_login_at) }}</time>
                <span v-else class="whitespace-nowrap text-ink-3">{{ trans('team.never') }}</span>
            </template>
            <template #cell-created_at="{ row }"><span class="block whitespace-nowrap text-ink-2 tabular-nums">{{ formatDate(row.created_at) }}</span></template>
        </DataTable>

        <Drawer v-model:open="inviteOpen" :title="trans('team.invite.title')" :description="trans('team.invite.body')" :dismissible="!action.processing.value" test-id="ADM-39.invite-drawer">
            <form class="flex flex-col gap-16" novalidate @submit.prevent="submitInvite()">
                <StateBlock v-if="serverError" kind="error" :title="trans('ui.state.error_title')" :body="serverError" :retryable="false" test-id="ADM-39.invite.server-error" />
                <Field :label="trans('team.invite.name')" :error="errors.name" required><Input v-model="form.name" maxlength="120" autocomplete="off" data-autofocus data-testid="ADM-39.invite.name" /></Field>
                <Field :label="trans('team.invite.email')" :error="errors.email" required><Input v-model="form.email" type="email" maxlength="191" autocomplete="off" data-testid="ADM-39.invite.email" /></Field>
                <RolePicker v-model="form.roles" :options="roles" :disabled="disabledRoles" :legend="trans('team.invite.roles')" :hint="viewerIsOwner ? trans('team.invite.roles_hint') : `${trans('team.invite.roles_hint')} ${trans('team.invite.owner_only')}`" test-id="ADM-39.invite.roles" />
                <p v-if="errors.roles" class="text-helper text-danger" role="alert">{{ errors.roles }}</p>
                <Field :label="trans('team.invite.locale')"><Select v-model="form.locale" :options="localeOptions" data-testid="ADM-39.invite.locale" /></Field>
                <template v-if="fourEyes">
                    <ApprovalNotice test-id="ADM-39.invite.four-eyes" />
                    <p class="text-helper text-ink-2">{{ trans('team.invite.elevating') }}</p>
                    <Field :label="trans('ui.confirm.reason')" :hint="trans('team.invite.reason_hint')" :error="errors.reason" required><Textarea v-model="form.reason" :rows="2" :maxlength="1000" show-count data-testid="ADM-39.invite.reason" /></Field>
                </template>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="inviteOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" data-testid="ADM-39.invite.submit" @click="submitInvite()">{{ trans('team.invite.submit') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
