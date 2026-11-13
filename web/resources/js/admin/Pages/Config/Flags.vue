<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhPencilSimple, PhSealCheck, PhToggleRight, PhWarning } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import DialogError from '../../Components/patterns/DialogError.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, Drawer, EmptyQueue, Field, IconButton, Input, Skeleton, StatusPill, Switch, Textarea } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-36 Feature-Flags (06 §3, m3.5 §2): every flag with its state per environment (only this environment's switch takes effect here;
 * the others document the intended state), team-only rollout, percentage rollout for member flags (a stable hash of the member) and the
 * critical marker. Every change ⚿ needs a reason and is audited with before/after; a critical flag in production needs a second
 * person; an AI flag stays off without a configured provider.
 */
type Environment = 'local' | 'staging' | 'production';
interface Flag {
    id: number;
    key: string;
    enabled: boolean;
    environments: Record<Environment, boolean>;
    staff_only: boolean;
    percentage: number;
    critical: boolean;
    description: string | null;
    ai: boolean;
    pending: boolean;
    updated_at: string | null;
}

const props = defineProps<{ flags: Flag[]; environment: Environment; production: boolean; aiAvailable: boolean }>();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const list = computed(() => (pageState.value === 'empty' ? [] : props.flags));
const ENVIRONMENTS: Environment[] = ['local', 'staging', 'production'];

const action = useAdminAction();
const editing = ref<Flag | null>(null);
const drawerOpen = ref(false);
const form = reactive({ description: '', environments: { local: false, staging: false, production: false }, staff_only: false, percentage: '100', critical: false, reason: '' });
const errors = ref<Record<string, string>>({});
function open(flag: Flag): void {
    editing.value = flag;
    Object.assign(form, { description: flag.description ?? '', environments: { ...flag.environments }, staff_only: flag.staff_only, percentage: String(flag.percentage), critical: flag.critical, reason: '' });
    errors.value = {};
    action.reset();
    drawerOpen.value = true;
}
const qaFlag = props.flags.find((flag) => flag.ai) ?? props.flags[0];
if (qaDialog() === 'edit' && qaFlag) open(qaFlag);

const changes = computed<Record<string, unknown>>(() => {
    const flag = editing.value;
    if (!flag) return {};
    const out: Record<string, unknown> = {};
    if ((form.description.trim() || null) !== flag.description) out.description = form.description.trim() === '' ? null : form.description.trim();
    if (ENVIRONMENTS.some((env) => form.environments[env] !== flag.environments[env])) out.environments = { ...form.environments };
    if (form.staff_only !== flag.staff_only) out.staff_only = form.staff_only;
    if (Number(form.percentage) !== flag.percentage) out.percentage = Number(form.percentage);
    if (form.critical !== flag.critical) out.critical = form.critical;
    return out;
});
const fourEyes = computed(() => props.production && editing.value !== null && (editing.value.critical || form.critical));
const aiBlocked = computed(() => editing.value?.ai === true && !props.aiAvailable);

function save(): void {
    const next: Record<string, string> = {};
    const percentage = Number(form.percentage);
    if (!/^\d{1,3}$/.test(form.percentage) || percentage > 100) next.percentage = trans('config.flags.percentage_hint');
    if (Object.keys(changes.value).length === 0) next.changes = trans('config.flags.no_changes');
    const reason = form.reason.trim().length;
    if (reason < 10 || reason > 1000) next.reason = trans('ui.confirm.reason_length');
    errors.value = next;
    if (Object.keys(next).length > 0 || !editing.value) return;
    action.run('patch', routeOr('admin.config.flags.update', `/admin/config/flags/${editing.value.id}`, { flag: editing.value.id }), { changes: changes.value, reason: form.reason.trim() }, { sensitive: true, onSuccess: () => (drawerOpen.value = false) });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
const envLabel = (env: Environment) => trans(`config.flags.environments.${env}`);
// DQ-627: "–" for a flag that is off; a rollout only where it narrows who gets the flag.
function rollout(flag: Flag): string {
    if (!flag.enabled) return '–';
    if (flag.staff_only) return trans('config.flags.staff_only');
    return flag.percentage < 100 ? trans('config.flags.percentage_of', { percent: formatNumber(flag.percentage) }) : trans('config.flags.everyone');
}
</script>

<template>
    <Head :title="trans('config.flags.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-36" :data-qa-state="pageState">
        <PageHeader :title="trans('config.flags.title')" :crumbs="[{ label: trans('shell.groups.configuration') }]" :description="trans('config.flags.intro', { environment: envLabel(environment) })" />

        <div v-if="!aiAvailable && (pageState === 'ready' || pageState === 'loading')" class="flex items-start gap-12 rounded-sm border border-line px-16 py-12" role="note" data-testid="ADM-36.ai-note">
            <PhWarning :size="20" class="mt-2 shrink-0 text-warning" aria-hidden="true" />
            <p class="text-admin-base text-ink-2">{{ trans('config.flags.ai_note') }}</p>
        </div>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('config.flags.error')" :body="trans('ui.state.error_body')" test-id="ADM-36.error" @retry="router.reload()" />
        <EmptyQueue v-else-if="pageState !== 'loading' && list.length === 0" variant="first" :icon="PhToggleRight" :title="trans('config.flags.empty_title')" :body="trans('config.flags.empty_body')" data-testid="ADM-36.empty" />
        <ScrollRegion v-else :label="trans('config.flags.caption')">
            <table class="w-full text-admin-base" data-testid="ADM-36.table">
                <caption class="sr-only">{{ trans('config.flags.caption') }}</caption>
                <thead>
                    <tr class="h-40 border-b border-line text-left text-admin-base-strong text-ink-2">
                        <th scope="col" class="px-12">{{ trans('config.flags.columns.flag') }}</th>
                        <th scope="col" class="px-12">{{ trans('config.flags.columns.here') }}</th>
                        <th scope="col" class="whitespace-nowrap px-12">
                            {{ trans('config.flags.columns.environments') }}
                            <span class="block text-caption text-ink-3">{{ trans('config.flags.environments_legend') }}</span>
                        </th>
                        <th scope="col" class="px-12">{{ trans('config.flags.columns.rollout') }}</th>
                        <th scope="col" class="px-12">{{ trans('config.flags.columns.updated') }}</th>
                        <th scope="col" class="w-48 px-12"><span class="sr-only">{{ trans('config.flags.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                    <template v-if="pageState === 'loading'">
                        <tr v-for="n in 10" :key="n" class="h-40 border-b border-line-subtle" aria-hidden="true">
                            <td class="px-12"><span class="flex flex-col gap-4"><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="w-120" /></span></td>
                            <td v-for="c in 5" :key="c" class="px-12"><Skeleton shape="text" class="w-64" /></td>
                        </tr>
                    </template>
                    <tr v-for="flag in pageState === 'loading' ? [] : list" :key="flag.id" class="border-b border-line-subtle last:border-b-0" data-testid="ADM-36.row">
                        <!-- DQ-627: what the flag does first, its key as the caption; one line each, the row stays 40. -->
                        <td class="h-40 px-12 py-2">
                            <span class="flex min-w-0 items-center gap-8">
                                <span class="block max-w-360 truncate text-ink" :title="flag.description ?? flag.key">{{ flag.description ?? flag.key }}</span>
                                <Badge v-if="flag.critical" tone="warning">{{ trans('config.flags.critical') }}</Badge>
                                <Badge v-if="flag.ai" tone="neutral">{{ trans('config.flags.ai') }}</Badge>
                                <span v-if="flag.pending" class="inline-flex items-center gap-4 whitespace-nowrap text-admin-base text-info"><PhSealCheck :size="16" aria-hidden="true" />{{ trans('config.flags.pending') }}</span>
                            </span>
                            <span v-if="flag.description" class="sc-key block text-caption text-ink-3">{{ flag.key }}</span>
                        </td>
                        <td class="whitespace-nowrap px-12"><StatusPill :tone="flag.enabled ? 'success' : 'neutral'" :label="flag.enabled ? trans('config.flags.on') : trans('config.flags.off')" /></td>
                        <td class="whitespace-nowrap px-12">
                            <span class="flex gap-4">
                                <Badge
                                    v-for="env in ENVIRONMENTS"
                                    :key="env"
                                    :tone="flag.environments[env] ? 'success' : 'neutral'"
                                    :aria-label="`${envLabel(env)}: ${flag.environments[env] ? trans('config.flags.on') : trans('config.flags.off')}`"
                                    :title="`${envLabel(env)}: ${flag.environments[env] ? trans('config.flags.on') : trans('config.flags.off')}`"
                                >
                                    {{ trans(`config.flags.environments_short.${env}`) }}
                                </Badge>
                            </span>
                        </td>
                        <td class="whitespace-nowrap px-12 tabular-nums text-ink-2">
                            {{ rollout(flag) }}
                        </td>
                        <td class="whitespace-nowrap px-12 tabular-nums text-ink-3" :title="formatDateTime(flag.updated_at)">{{ formatDate(flag.updated_at) }}</td>
                        <td class="px-12">
                            <IconButton :icon="PhPencilSimple" size="sm" :label="trans('config.flags.edit', { key: flag.key })" :disabled="flag.pending" data-testid="ADM-36.edit" @click="open(flag)" />
                        </td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>

        <Drawer v-model:open="drawerOpen" :title="trans('config.flags.drawer_title', { key: editing?.key ?? '' })" size="lg" :dismissible="!action.processing.value" test-id="ADM-36.drawer">
            <form id="adm36-form" class="flex flex-col gap-16" novalidate @submit.prevent="save">
                <Field :label="trans('config.flags.fields.description')" optional><Textarea v-model="form.description" :rows="2" :maxlength="500" /></Field>
                <fieldset class="flex flex-col gap-8">
                    <legend class="mb-4 text-admin-base-strong text-ink">{{ trans('config.flags.fields.environments') }}</legend>
                    <div v-for="env in ENVIRONMENTS" :key="env" class="flex items-center justify-between gap-12 rounded-sm border border-line px-12 py-8">
                        <span class="flex flex-col">
                            <span class="text-admin-base text-ink">{{ envLabel(env) }}</span>
                            <span class="text-admin-base text-ink-3">{{ env === environment ? trans('config.flags.this_environment') : trans('config.flags.other_environment') }}</span>
                        </span>
                        <Switch v-model="form.environments[env]" :aria-label="trans('config.flags.switch_for', { environment: envLabel(env) })" :disabled="aiBlocked && !editing?.environments[env]" :data-testid="`ADM-36.form.${env}`" />
                    </div>
                    <p v-if="aiBlocked" class="text-admin-base text-warning" role="note">{{ trans('config.refused.ai_provider_missing') }}</p>
                </fieldset>
                <Switch v-model="form.staff_only" :label="trans('config.flags.fields.staff_only')" />
                <p class="-mt-8 text-admin-base text-ink-3">{{ trans('config.flags.staff_only_hint') }}</p>
                <div class="w-200">
                    <Field :label="trans('config.flags.fields.percentage')" :hint="trans('config.flags.percentage_hint')" :error="errors.percentage">
                        <Input v-model="form.percentage" inputmode="numeric" maxlength="3" tnum :disabled="form.staff_only">
                            <template #trailing><span class="text-admin-base text-ink-3">%</span></template>
                        </Input>
                    </Field>
                </div>
                <Switch v-model="form.critical" :label="trans('config.flags.fields.critical')" />
                <p class="-mt-8 text-admin-base text-ink-3">{{ trans('config.flags.critical_hint') }}</p>
                <p v-if="fourEyes" class="rounded-sm border border-line px-12 py-8 text-admin-base text-ink-2" data-testid="ADM-36.four-eyes">{{ trans('config.flags.four_eyes') }}</p>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="errors.reason ?? errors.changes" required>
                    <Textarea v-model="form.reason" :rows="3" :maxlength="1000" show-count data-testid="ADM-36.form.reason" />
                </Field>
            </form>
            <template #footer>
                <DialogError :message="serverError" />
                <Button variant="ghost" :disabled="action.processing.value" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm36-form" variant="primary" :loading="action.processing.value" data-testid="ADM-36.form.save">{{ fourEyes ? trans('config.draft.request') : trans('config.flags.save') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
