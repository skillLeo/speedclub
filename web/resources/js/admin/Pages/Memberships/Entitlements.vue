<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhProhibit, PhUserPlus } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, DateRangeField, Drawer, EmptyQueue, Field, IconButton, Input, Select, Skeleton, StatusPill, Textarea, type Tone } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-F2 entitlements (06 §3: "grant/revoke manually with reason and end date, audited"; premium.enabled, 404 while off): member, plan,
 * period, status (aktiv · geplant · abgelaufen · widerrufen), who granted, reason. Grant with reason and an optional period; revoke with
 * a reason; a revoked row stays as history.
 */
interface Row {
    id: string;
    member: { id: string; username: string | null };
    plan: { id: number; name: { de: string; en: string | null } };
    granted_by: string | null;
    reason: string;
    starts_at: string;
    ends_at: string | null;
    revoked_at: string | null;
    revoked_by: string | null;
    revoke_reason: string | null;
    /** Read by the server with the page's clock. */
    status: 'active' | 'scheduled' | 'ended' | 'revoked';
}
const props = defineProps<{ entitlements: Row[]; plans: { id: number; name: { de: string; en: string | null }; active: boolean }[] }>();

const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const rows = computed(() => (pageState.value === 'empty' ? [] : props.entitlements));
const name = (n: { de: string; en: string | null }) => (document.documentElement.lang === 'en' && n.en ? n.en : n.de);
const tones: Record<string, Tone> = { active: 'success', scheduled: 'info', ended: 'neutral', revoked: 'neutral' };
const status = (row: Row) => row.status;
const period = (row: Row) => (row.ends_at ? trans('memberships.entitlements.period', { from: formatDate(row.starts_at), to: formatDate(row.ends_at) }) : `${trans('memberships.entitlements.from', { date: formatDate(row.starts_at) })}, ${trans('memberships.entitlements.open_end')}`);
const memberHref = (id: string) => routeOr('admin.members.show', `/admin/members/${id}`, { member: id });
const plansHref = routeOr('admin.memberships.plans', '/admin/memberships/plans');

// ---- grant ------------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const grantOpen = ref(false);
const form = reactive({ member: '', plan: undefined as string | undefined, from: '', to: '', reason: '' });
const errors = reactive<{ member: string | null; plan: string | null; reason: string | null }>({ member: null, plan: null, reason: null });
const planOptions = computed(() => props.plans.filter((p) => p.active).map((p) => ({ value: String(p.id), label: name(p.name) })));
function openGrant(): void {
    Object.assign(form, { member: '', plan: planOptions.value[0]?.value, from: '', to: '', reason: '' });
    Object.assign(errors, { member: null, plan: null, reason: null });
    action.reset();
    grantOpen.value = true;
}
function grant(): void {
    errors.member = form.member.replace(/^@/, '').trim() === '' ? trans('memberships.grant_form.errors.member') : null;
    errors.plan = form.plan === undefined ? trans('memberships.grant_form.errors.plan') : null;
    const reason = form.reason.trim();
    errors.reason = reason.length < 10 || reason.length > 1000 ? trans('ui.confirm.reason_length') : null;
    if (errors.member || errors.plan || errors.reason) return;
    action.run('post', routeOr('admin.memberships.entitlements.store', '/admin/memberships/entitlements'), { member: form.member.trim(), plan_id: Number(form.plan), starts_at: form.from || null, ends_at: form.to || null, reason }, { sensitive: true, onSuccess: () => (grantOpen.value = false) });
}

// ---- revoke -----------------------------------------------------------------------------------------------------------------
const revoking = ref<Row | null>(null);
const revokeOpen = computed({ get: () => revoking.value !== null, set: (v: boolean) => (v ? null : (revoking.value = null)) });
function revoke(reason: string | null): void {
    const row = revoking.value;
    if (!row) return;
    action.run('post', routeOr('admin.memberships.entitlements.revoke', `/admin/memberships/entitlements/${row.id}/revoke`, { entitlement: row.id }), { reason: reason ?? '' }, { sensitive: true, onSuccess: () => (revoking.value = null) });
}
onMounted(async () => {
    const overlay = qaDialog();
    if (overlay === 'grant') {
        openGrant();
        Object.assign(form, { member: '@lukas.sc', reason: 'Gewinner der Build-Challenge im Oktober.' });
    } else if (overlay === 'revoke') {
        const row = rows.value.find((r) => status(r) === 'active');
        if (!row) return;
        action.reset();
        revoking.value = row;
    } else return;
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('memberships.entitlements.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-F2" :data-qa-state="pageState">
        <PageHeader :title="trans('memberships.entitlements.title')" :crumbs="[{ label: trans('shell.groups.settings') }]" :description="trans('memberships.entitlements.intro')">
            <template #meta><p class="text-supporting text-ink-3">{{ trans('memberships.scaffold') }}</p></template>
            <template #actions>
                <Button size="sm" variant="primary" :icon="PhUserPlus" :disabled="planOptions.length === 0" data-testid="ADM-F2.grant" @click="openGrant()">{{ trans('memberships.entitlements.grant') }}</Button>
            </template>
        </PageHeader>
        <p v-if="planOptions.length === 0" class="text-supporting text-ink-2">{{ trans('memberships.entitlements.no_plans') }}</p>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('memberships.entitlements.error')" :body="trans('ui.state.error_body')" test-id="ADM-F2.error" @retry="router.reload()" />
        <div v-else-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-busy="true" data-testid="ADM-F2.loading">
            <div v-for="n in 5" :key="n" class="flex min-h-48 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0"><Skeleton shape="text" class="w-120" /><Skeleton shape="text" class="w-120" /><Skeleton shape="text" class="w-200" /><Skeleton class="h-20 w-80" /><Skeleton shape="text" class="w-160" /></div>
        </div>
        <EmptyQueue v-else-if="rows.length === 0" variant="first" :title="trans('memberships.entitlements.empty_title')" :body="trans('memberships.entitlements.empty_body')" data-testid="ADM-F2.empty" />
        <ScrollRegion v-else :label="trans('memberships.entitlements.caption')" test-id="ADM-F2.table">
            <table class="w-full border-collapse text-supporting">
                <caption class="sr-only">{{ trans('memberships.entitlements.caption') }}</caption>
                <thead class="bg-surface text-left text-label-s text-ink-2">
                    <tr class="h-40 border-b border-line">
                        <th scope="col" class="px-12">{{ trans('memberships.entitlements.columns.member') }}</th>
                        <th scope="col" class="px-12">{{ trans('memberships.entitlements.columns.plan') }}</th>
                        <th scope="col" class="px-12">{{ trans('memberships.entitlements.columns.period') }}</th>
                        <th scope="col" class="px-12">{{ trans('memberships.entitlements.columns.status') }}</th>
                        <th scope="col" class="px-12">{{ trans('memberships.entitlements.columns.reason') }}</th>
                        <th scope="col" class="w-48 px-12"><span class="sr-only">{{ trans('memberships.entitlements.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.id" class="border-b border-line-subtle align-top last:border-b-0" :data-testid="`ADM-F2.row.${row.id}`">
                        <td class="whitespace-nowrap px-12 py-8"><Link v-if="row.member.username" :href="memberHref(row.member.id)" :class="[focusRing, 'sc-key inline-flex h-32 items-center rounded-xs text-ink hover:underline']">{{ `@${row.member.username}` }}</Link></td>
                        <td class="whitespace-nowrap px-12 py-8 text-ink">{{ name(row.plan.name) }}</td>
                        <td class="whitespace-nowrap px-12 py-8 text-ink-2 tabular-nums">{{ period(row) }}</td>
                        <td class="px-12 py-8"><StatusPill :tone="tones[status(row)]" :label="trans(`memberships.entitlements.status.${status(row)}`)" /></td>
                        <td class="px-12 py-8">
                            <span class="block max-w-480 text-ink-2">{{ row.reason }}</span>
                            <span class="block text-caption text-ink-3">{{ row.granted_by ?? '–' }}</span>
                            <span v-if="row.revoked_at" class="block max-w-480 text-caption text-ink-3 tabular-nums">{{ trans('memberships.entitlements.revoked_line', { date: formatDateTime(row.revoked_at), name: row.revoked_by ?? '–', reason: row.revoke_reason ?? '–' }) }}</span>
                        </td>
                        <td class="px-12 py-4"><IconButton v-if="!row.revoked_at && status(row) !== 'ended'" :icon="PhProhibit" :label="`${trans('memberships.entitlements.revoke')}: @${row.member.username ?? ''}`" size="sm" :data-testid="`ADM-F2.revoke.${row.id}`" @click="(action.reset(), (revoking = row))" /></td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>

        <Drawer v-model:open="grantOpen" :title="trans('memberships.grant_form.title')" :description="trans('memberships.grant_form.body')" :dismissible="!action.processing.value" test-id="ADM-F2.drawer">
            <!-- No active plan yet: a designed first step instead of an empty plan select (A3/A4 follow-up). -->
            <EmptyQueue v-if="planOptions.length === 0" variant="first" :title="trans('memberships.grant_form.no_plan_title')" :body="trans('memberships.grant_form.no_plan_body')" data-testid="ADM-F2.drawer.no-plan">
                <Button size="sm" variant="secondary" :href="plansHref" data-testid="ADM-F2.drawer.to-plans">{{ trans('memberships.grant_form.to_plans') }}</Button>
            </EmptyQueue>
            <form v-else class="flex flex-col gap-16" novalidate @submit.prevent="grant()">
                <StateBlock v-if="action.error.value" kind="error" :title="trans('ui.state.error_title')" :body="action.error.value" :retryable="false" test-id="ADM-F2.drawer.server-error" />
                <Field :label="trans('memberships.grant_form.member')" :hint="trans('memberships.grant_form.member_hint')" :error="errors.member" required><Input v-model="form.member" maxlength="40" autocomplete="off" data-autofocus data-testid="ADM-F2.drawer.member" /></Field>
                <Field :label="trans('memberships.grant_form.plan')" :error="errors.plan" required><Select v-model="form.plan" :options="planOptions" data-testid="ADM-F2.drawer.plan" /></Field>
                <Field :label="trans('memberships.grant_form.period')" :hint="trans('memberships.grant_form.period_hint')" optional><DateRangeField v-model:from="form.from" v-model:to="form.to" test-id="ADM-F2.drawer.period" /></Field>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="errors.reason" required><Textarea v-model="form.reason" :rows="2" :maxlength="1000" show-count data-testid="ADM-F2.drawer.reason" /></Field>
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="grantOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button v-if="planOptions.length > 0" variant="primary" :loading="action.processing.value" data-testid="ADM-F2.drawer.submit" @click="grant()">{{ trans('memberships.grant_form.submit') }}</Button>
            </template>
        </Drawer>

        <ConfirmDialog v-model:open="revokeOpen" :title="trans('memberships.revoke_dialog.title', { member: `@${revoking?.member.username ?? ''}` })" :body="trans('memberships.revoke_dialog.body', { plan: revoking ? name(revoking.plan.name) : '' })" :confirm-label="trans('memberships.entitlements.revoke')" reason :processing="action.processing.value" :error="action.error.value" test-id="ADM-F2.revoke-dialog" @confirm="(r: string | null) => revoke(r)" />
    </div>
</template>
