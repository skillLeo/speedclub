<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhFloppyDisk, PhLockSimple } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, Field, Input, Select, Skeleton } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDateTime, formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import GovernanceSection from './Partials/GovernanceSection.vue';

/**
 * ADM-52 org settings (06 §3 Settings, m3.6 §1, ADR-239): the 17 fields of the config key `org` in four groups, each with the `[[…]]`
 * placeholder of the legal texts it fills. Owner only (recent password; ADR-540: no reason); an Admin reads them. Saving publishes a new version;
 * the Impressum, the legal texts and the mails use it at once. OA-10: the real values come from the owner. M5.1: Governance section
 * (GovernanceSection, ADR-507).
 */
const props = defineProps<{
    values: Record<string, string | null>;
    fields: string[];
    emailFields: string[];
    placeholders: Record<string, string>;
    locales: string[];
    lastPublished: { version: number; at: string | null; by: string | null } | null;
    canEdit: boolean;
    /** The active Owners by name, for a reader's notice (empty for an Owner). */
    owners: string[];
    /** M5.1 (ADR-507) + ADR-540: the governance switches and who can approve four-eyes requests today. */
    governance: { owner_override: boolean; four_eyes: boolean; staff_two_factor: 'required' | 'optional'; two_factor_forced: boolean; approvers: { id: number; name: string; owner: boolean }[] };
}>();

const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const GROUPS: { key: string; fields: string[] }[] = [
    { key: 'company', fields: ['company_name', 'legal_form', 'street', 'postal_city', 'representative', 'responsible_person'] },
    { key: 'contact', fields: ['contact_email', 'phone', 'support_email', 'privacy_email', 'dsa_email', 'report_email'] },
    { key: 'register', fields: ['register_court', 'register_number', 'vat_id', 'supervisory_authority'] },
    { key: 'locale', fields: ['default_locale'] },
];

const draft = reactive<Record<string, string>>({});
function reset(): void {
    for (const field of props.fields) draft[field] = props.values[field] ?? (field === 'default_locale' ? 'de' : '');
}
watch(() => props.values, reset, { immediate: true });
const changed = computed(() => props.fields.filter((f) => (draft[f] ?? '').trim() !== (props.values[f] ?? (f === 'default_locale' ? 'de' : ''))));
const missing = computed(() => props.fields.filter((f) => (props.values[f] ?? '') === '').length);
const localeOptions = computed(() => props.locales.map((l) => ({ value: l, label: trans(`settings.locales.${l}`) })));

/** Client rounds 3 and 6: spaces, dots, dashes and lower case in a VAT ID are fine; it is saved as DE123456789 (as OrgSchema normalises it). */
const vatOf = (value: string): string => value.replace(/[\s.-]+/g, '').toUpperCase();

function fieldError(field: string): string | null {
    const value = (draft[field] ?? '').trim();
    if (value === '') return null;
    if (props.emailFields.includes(field) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return trans('settings.errors.email');
    if (field === 'vat_id' && !/^[A-Z]{2}(?=[0-9A-Z+*]*[0-9])[0-9A-Z+*]{2,12}$/.test(vatOf(value))) return trans('settings.errors.vat_id');
    if (field === 'phone' && !/^\+?[0-9 ().\/-]{5,30}$/.test(value)) return trans('settings.errors.phone');
    return null;
}
const invalid = computed(() => props.fields.some((f) => fieldError(f) !== null));
const label = (field: string) => trans(`settings.fields.${field}.label`);
function hint(field: string): string {
    const key = `settings.fields.${field}.hint`;
    const own = trans(key);
    const placeholder = props.placeholders[field];
    const fills = placeholder ? trans('settings.placeholder', { placeholder: `[[${placeholder}]]` }) : trans('settings.no_placeholder');
    // DQ-631: the example ends as a sentence before the placeholder line; DQ-665: an empty field says that it is still missing.
    const text = own === key ? fills : `${/[.!?…]$/.test(own) ? own : `${own}.`} ${fills}`;
    return (props.values[field] ?? '') === '' ? `${trans('settings.missing_field')} ${text}` : text;
}

const action = useAdminAction();
const confirmOpen = ref(false);
function save(): void {
    const values = Object.fromEntries(props.fields.map((f) => [f, (draft[f] ?? '').trim() === '' ? null : f === 'vat_id' ? vatOf(draft[f] ?? '') : (draft[f] ?? '').trim()]));
    action.run('patch', routeOr('admin.settings.update', '/admin/settings'), { values }, { sensitive: true, onSuccess: () => (confirmOpen.value = false) });
}
onMounted(async () => {
    if (qaDialog() !== 'save' || !props.canEdit) return;
    draft.support_email = 'hilfe@speedclub.de';
    confirmOpen.value = true;
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('settings.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-52" :data-qa-state="pageState">
        <PageHeader :title="trans('settings.title')" :crumbs="[{ label: trans('shell.groups.settings') }]" :description="trans('settings.intro')">
            <template #meta>
                <p class="flex flex-wrap gap-x-16 gap-y-4 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-52.last">
                    <span>{{ lastPublished ? trans('settings.last', { version: formatNumber(lastPublished.version), date: formatDateTime(lastPublished.at), name: lastPublished.by ?? '–' }) : trans('settings.never') }}</span>
                    <span v-if="missing > 0 && pageState === 'ready'" class="text-warning">{{ transChoice('settings.missing', missing, { count: formatNumber(missing) }) }}</span>
                </p>
            </template>
            <template v-if="canEdit && pageState === 'ready'" #actions>
                <Button size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :disabled="changed.length === 0" data-testid="ADM-52.discard" @click="reset()">{{ trans('settings.discard') }}</Button>
                <Button size="sm" variant="primary" :icon="PhFloppyDisk" :disabled="changed.length === 0 || invalid" data-testid="ADM-52.save" @click="(action.reset(), (confirmOpen = true))">{{ trans('settings.save') }}</Button>
            </template>
        </PageHeader>
        <!-- Client report 2026-11-23: a reader saw disabled fields and one grey line; now it says who can save and how to get there. -->
        <section v-if="!canEdit" class="flex items-start gap-12 rounded-sm border border-line bg-raised px-16 py-12" role="note" aria-labelledby="adm52-owner-only" data-testid="ADM-52.view-only">
            <PhLockSimple :size="20" class="mt-2 shrink-0 text-ink-2" aria-hidden="true" />
            <div class="flex min-w-0 flex-1 flex-col gap-4">
                <h2 id="adm52-owner-only" class="text-admin-base-strong text-ink">{{ trans('settings.owner_only_title') }}</h2>
                <p class="max-w-720 text-admin-base text-ink-2">{{ trans('settings.owner_only') }}</p>
                <p class="text-admin-base text-ink-2" data-testid="ADM-52.owners">{{ owners.length > 0 ? trans('settings.owners', { names: owners.join(', ') }) : trans('settings.no_owners') }}</p>
            </div>
        </section>

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('settings.error')" :body="trans('ui.state.error_body')" test-id="ADM-52.error" @retry="router.reload()" />
        <div v-else-if="pageState === 'loading'" class="flex flex-col gap-32" aria-busy="true" data-testid="ADM-52.loading">
            <section v-for="g in GROUPS" :key="g.key" class="flex flex-col gap-16">
                <Skeleton shape="text" class="h-20 w-160" />
                <div class="grid grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2">
                    <div v-for="f in g.fields" :key="f" class="flex flex-col gap-4"><span class="flex h-20 items-center"><Skeleton shape="text" class="w-160" /></span><Skeleton class="h-40 w-full" /><span class="flex h-16 items-center"><Skeleton shape="text" class="w-240" /></span></div>
                </div>
            </section>
        </div>
        <form v-else class="flex flex-col gap-32" novalidate @submit.prevent="confirmOpen = true">
            <section v-for="g in GROUPS" :key="g.key" class="flex flex-col gap-16" :data-testid="`ADM-52.group.${g.key}`" :aria-labelledby="`adm52-${g.key}`">
                <h2 :id="`adm52-${g.key}`" class="text-headline text-ink">{{ trans(`settings.groups.${g.key}`) }}</h2>
                <div class="grid grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2">
                    <Field v-for="f in g.fields" :key="f" :label="label(f)" :hint="hint(f)" :error="fieldError(f)">
                        <Select v-if="f === 'default_locale'" v-model="draft[f]" :options="localeOptions" :disabled="!canEdit" :data-testid="`ADM-52.field.${f}`" />
                        <Input v-else v-model="draft[f]" :type="emailFields.includes(f) ? 'email' : 'text'" maxlength="200" :disabled="!canEdit" :placeholder="canEdit ? undefined : trans('settings.empty_value')" :data-testid="`ADM-52.field.${f}`" />
                    </Field>
                </div>
            </section>
        </form>
        <GovernanceSection v-if="pageState === 'ready'" :governance="governance" :can-edit="canEdit" />

        <ConfirmDialog v-model:open="confirmOpen" :title="trans('settings.confirm_title')" :body="trans('settings.confirm_body')" :confirm-label="trans('settings.save')" tone="neutral" :processing="action.processing.value" :error="action.error.value" test-id="ADM-52.confirm" @confirm="save()" />
    </div>
</template>
