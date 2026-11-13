<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhPencilSimple, PhPlus } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Drawer, EmptyQueue, Field, IconButton, Input, Skeleton, StatusPill, Switch, Textarea } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-F1 plans of the flagged memberships scaffold (06 §3, premium.enabled; 404 while off): name and features in DE/EN, active, how
 * many members hold each now. No price, no payment code (V1).
 */
interface Plan {
    id: number;
    key: string;
    name: { de: string; en: string | null };
    features: { de: string[]; en: string[] };
    active: boolean;
    holders: number;
}
const props = defineProps<{ plans: Plan[] }>();

const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const rows = computed(() => (pageState.value === 'empty' ? [] : props.plans));
const locale = () => (document.documentElement.lang === 'en' ? 'en' : 'de');
const planName = (p: Plan) => (locale() === 'en' && p.name.en ? p.name.en : p.name.de);

const action = useAdminAction();
const open = ref(false);
const editing = ref<Plan | null>(null);
const form = reactive({ key: '', name_de: '', name_en: '', features_de: '', features_en: '', active: true });
const errors = reactive<{ key: string | null; name: string | null; features: string | null }>({ key: null, name: null, features: null });
function openDrawer(plan: Plan | null): void {
    editing.value = plan;
    Object.assign(form, { key: plan?.key ?? '', name_de: plan?.name.de ?? '', name_en: plan?.name.en ?? '', features_de: (plan?.features.de ?? []).join('\n'), features_en: (plan?.features.en ?? []).join('\n'), active: plan?.active ?? true });
    Object.assign(errors, { key: null, name: null, features: null });
    action.reset();
    open.value = true;
}
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
function save(): void {
    errors.key = editing.value === null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(form.key.trim()) ? trans('memberships.plan_form.errors.key') : null;
    errors.name = form.name_de.trim() === '' || form.name_de.trim().length > 80 ? trans('memberships.plan_form.errors.name') : null;
    const de = lines(form.features_de);
    const en = lines(form.features_en);
    errors.features = de.length > 20 || en.length > 20 || [...de, ...en].some((l) => l.length > 160) ? trans('memberships.plan_form.errors.features') : null;
    if (errors.key || errors.name || errors.features) return;
    const data = { name: { de: form.name_de.trim(), en: form.name_en.trim() === '' ? null : form.name_en.trim() }, features: { de, en }, active: form.active };
    const plan = editing.value;
    if (plan === null) action.run('post', routeOr('admin.memberships.plans.store', '/admin/memberships/plans'), { key: form.key.trim(), ...data }, { sensitive: true, onSuccess: () => (open.value = false) });
    else action.run('patch', routeOr('admin.memberships.plans.update', `/admin/memberships/plans/${plan.id}`, { plan: plan.id }), data, { sensitive: true, onSuccess: () => (open.value = false) });
}
onMounted(async () => {
    if (qaDialog() !== 'edit' && qaDialog() !== 'create') return;
    openDrawer(qaDialog() === 'edit' ? (props.plans[0] ?? null) : null);
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('memberships.plans.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-F1" :data-qa-state="pageState">
        <PageHeader :title="trans('memberships.plans.title')" :crumbs="[{ label: trans('shell.groups.settings') }]" :description="trans('memberships.plans.intro')">
            <template #meta><p class="text-admin-base text-ink-3">{{ trans('memberships.scaffold') }}</p></template>
            <template #actions>
                <Button size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-F1.create" @click="openDrawer(null)">{{ trans('memberships.plans.create') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('memberships.plans.error')" :body="trans('ui.state.error_body')" test-id="ADM-F1.error" @retry="router.reload()" />
        <div v-else-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-busy="true" data-testid="ADM-F1.loading">
            <div v-for="n in 3" :key="n" class="flex min-h-56 items-center gap-24 border-b border-line-subtle px-12 last:border-b-0"><span class="flex flex-1 flex-col gap-4"><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-80" /></span><Skeleton shape="text" class="w-120" /><Skeleton class="h-20 w-80" /><Skeleton shape="text" class="w-80" /></div>
        </div>
        <EmptyQueue v-else-if="rows.length === 0" variant="first" :title="trans('memberships.plans.empty_title')" :body="trans('memberships.plans.empty_body')" data-testid="ADM-F1.empty" />
        <ScrollRegion v-else :label="trans('memberships.plans.caption')" test-id="ADM-F1.table">
            <table class="w-full border-collapse text-admin-base">
                <caption class="sr-only">{{ trans('memberships.plans.caption') }}</caption>
                <thead class="bg-surface text-left text-admin-base-strong text-ink-2">
                    <tr class="h-40 border-b border-line">
                        <th scope="col" class="px-12">{{ trans('memberships.plans.columns.plan') }}</th>
                        <th scope="col" class="px-12">{{ trans('memberships.plans.columns.features') }}</th>
                        <th scope="col" class="px-12">{{ trans('memberships.plans.columns.status') }}</th>
                        <th scope="col" class="px-12 text-right">{{ trans('memberships.plans.columns.holders') }}</th>
                        <th scope="col" class="w-48 px-12"><span class="sr-only">{{ trans('memberships.plans.columns.actions') }}</span></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="plan in rows" :key="plan.id" class="border-b border-line-subtle align-top last:border-b-0" :data-testid="`ADM-F1.plan.${plan.key}`">
                        <td class="px-12 py-8"><span class="block text-admin-base-strong text-ink">{{ planName(plan) }}</span><span class="sc-key block text-caption text-ink-3">{{ plan.key }}</span></td>
                        <td class="px-12 py-8 text-ink-2">
                            <ul v-if="plan.features.de.length > 0" class="flex flex-col gap-2"><li v-for="f in (locale() === 'en' && plan.features.en.length > 0 ? plan.features.en : plan.features.de)" :key="f">{{ f }}</li></ul>
                            <span v-else class="text-ink-3">{{ transChoice('memberships.plans.features_count', 0) }}</span>
                        </td>
                        <td class="px-12 py-8"><StatusPill :tone="plan.active ? 'success' : 'neutral'" :label="plan.active ? trans('memberships.plans.active') : trans('memberships.plans.inactive')" /></td>
                        <td class="whitespace-nowrap px-12 py-8 text-right text-ink tabular-nums">{{ transChoice('memberships.plans.holders', plan.holders, { count: formatNumber(plan.holders) }) }}</td>
                        <td class="px-12 py-4"><IconButton :icon="PhPencilSimple" :label="`${trans('memberships.plans.edit')}: ${planName(plan)}`" size="sm" :data-testid="`ADM-F1.edit.${plan.key}`" @click="openDrawer(plan)" /></td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>

        <Drawer v-model:open="open" :title="editing ? trans('memberships.plan_form.edit_title', { name: planName(editing) }) : trans('memberships.plan_form.create_title')" :dismissible="!action.processing.value" test-id="ADM-F1.drawer">
            <form class="flex flex-col gap-16" novalidate @submit.prevent="save()">
                <StateBlock v-if="action.error.value" kind="error" :title="trans('ui.state.error_title')" :body="action.error.value" :retryable="false" test-id="ADM-F1.drawer.server-error" />
                <Field :label="trans('memberships.plan_form.key')" :hint="trans('memberships.plan_form.key_hint')" :error="errors.key" :required="editing === null">
                    <Input v-model="form.key" maxlength="64" :disabled="editing !== null" data-autofocus data-testid="ADM-F1.drawer.key" />
                </Field>
                <Field :label="trans('memberships.plan_form.name_de')" :error="errors.name" required><Input v-model="form.name_de" maxlength="80" data-testid="ADM-F1.drawer.name-de" /></Field>
                <Field :label="trans('memberships.plan_form.name_en')" optional><Input v-model="form.name_en" maxlength="80" data-testid="ADM-F1.drawer.name-en" /></Field>
                <Field :label="trans('memberships.plan_form.features_de')" :hint="trans('memberships.plan_form.features_hint')" :error="errors.features" optional><Textarea v-model="form.features_de" :rows="4" data-testid="ADM-F1.drawer.features-de" /></Field>
                <Field :label="trans('memberships.plan_form.features_en')" :hint="trans('memberships.plan_form.features_hint')" optional><Textarea v-model="form.features_en" :rows="4" data-testid="ADM-F1.drawer.features-en" /></Field>
                <Switch v-model="form.active" :label="trans('memberships.plan_form.active')" data-testid="ADM-F1.drawer.active" />
            </form>
            <template #footer>
                <Button variant="ghost" :disabled="action.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" data-testid="ADM-F1.drawer.submit" @click="save()">{{ trans('memberships.plan_form.submit') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
