<script setup lang="ts">
import { qaDialogFailed } from '../../composables/pageState';
import DialogError from '../../Components/patterns/DialogError.vue';
import { Head } from '@inertiajs/vue3';
import { PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, ConfirmDialog, Dialog, Drawer, EmptyQueue, Field, IconButton, Input, RadioGroup, Skeleton, StatusPill, Textarea } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';

/**
 * ADM-23 rules (06 §3 Moderation, m3.4-contract §1; moderation.rules, recent password, reason): the keyword lists (Sperren · Markieren:
 * term, list, created by/at, matches in 30 days) and the rate-limit overrides of the member limiters (default, allowed 0.25×–4×,
 * override), published as one config version.
 */
interface Rule {
    id: number;
    term: string;
    list: 'block' | 'flag';
    created_by: string | null;
    created_at: string | null;
    hits: number;
}
interface LimitRow {
    name: string;
    default: number;
    minutes: number;
    lower: number;
    upper: number;
    override: number | null;
}
const props = defineProps<{
    rules: Rule[];
    limits: LimitRow[];
    published: { version: number; published_at: string | null; published_by: string | null; reason: string | null } | null;
}>();

const { can } = usePermissions();
const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const rules = computed(() => (pageState.value === 'empty' ? [] : props.rules));

const limitLabel = (name: string): string => {
    const key = `moderation.rules.limits.names.${name}`;
    const text = trans(key);
    return text === key ? name : text;
};
// DQ-557: the limiters by group (Konto, Inhalte, Nachrichten, Öffentlich), by label inside a group.
const LIMIT_GROUPS = ['account', 'content', 'messages', 'public'] as const;
type LimitGroup = (typeof LIMIT_GROUPS)[number];
const GROUP_OF: Record<string, LimitGroup> = {
    account_edits: 'account', account_security: 'account', member_email: 'account', member_login: 'account', member_register: 'account', member_verify: 'account',
    two_factor_challenge: 'account', token_rotate: 'account', push_tokens: 'account', web_account_deletion: 'account', username_check: 'account', csrf_cookie: 'account',
    notification_reads: 'account', realtime_auth: 'account',
    messages: 'messages', conversations: 'messages', conversation_requests: 'messages', conversation_edits: 'messages', typing: 'messages',
    public_read: 'public', qr: 'public', contact_form: 'public', browse: 'public', search: 'public',
};
const groupOf = (name: string): LimitGroup => GROUP_OF[name] ?? 'content';
const limitRows = computed<LimitRow[]>(() =>
    [...props.limits].sort((a, b) => LIMIT_GROUPS.indexOf(groupOf(a.name)) - LIMIT_GROUPS.indexOf(groupOf(b.name)) || limitLabel(a.name).localeCompare(limitLabel(b.name), 'de')),
);
const startsGroup = (index: number): boolean => index === 0 || groupOf(limitRows.value[index]?.name ?? '') !== groupOf(limitRows.value[index - 1]?.name ?? '');

function windowText(minutes: number): string {
    if (minutes % 1440 === 0) return transChoice('moderation.rules.limits.days', minutes / 1440, { count: formatNumber(minutes / 1440) });
    if (minutes % 60 === 0) return transChoice('moderation.rules.limits.hours', minutes / 60, { count: formatNumber(minutes / 60) });
    return transChoice('moderation.rules.limits.minutes', minutes, { count: formatNumber(minutes) });
}

// ---- keywords ---------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const addOpen = ref(qaDialog() === 'add');
const addForm = reactive({ term: '', list: 'flag', reason: '' });
const addErrors = ref<Partial<Record<string, string>>>({});
watch(addOpen, (open) => {
    if (!open) return;
    Object.assign(addForm, { term: '', list: 'flag', reason: '' });
    addErrors.value = {};
    action.reset();
});
const listOptions = computed(() => (['block', 'flag'] as const).map((value) => ({ value, label: trans(`moderation.rules.keywords.lists.${value}`), hint: trans(`moderation.rules.keywords.list_hints.${value}`) })));
const listModel = computed({ get: () => addForm.list, set: (v: string | undefined) => (addForm.list = v === 'block' ? 'block' : 'flag') });
function add(): void {
    const next: Partial<Record<string, string>> = {};
    if (addForm.term.trim().length < 2) next.term = trans('moderation.rules.keywords.term_error');
    const reason = addForm.reason.trim().length;
    if (reason < 10 || reason > 1000) next.reason = trans('ui.confirm.reason_length');
    addErrors.value = next;
    if (Object.keys(next).length > 0) return;
    action.run('post', routeOr('admin.moderation.rules.store', '/admin/moderation/rules'), { term: addForm.term.trim(), list: addForm.list, reason: addForm.reason.trim() }, { sensitive: true, onSuccess: () => (addOpen.value = false) });
}

const removing = ref<Rule | null>(null);
const removeOpen = ref(false);
function openRemove(rule: Rule): void {
    removing.value = rule;
    action.reset();
    removeOpen.value = true;
}
function remove(reason: string | null): void {
    if (!removing.value) return;
    action.run('delete', routeOr('admin.moderation.rules.destroy', `/admin/moderation/rules/${removing.value.id}`, { rule: removing.value.id }), { reason: reason ?? '' }, { sensitive: true, onSuccess: () => (removeOpen.value = false) });
}

// ---- limits -----------------------------------------------------------------------------------------------------------------
const limitsOpen = ref(qaDialog() === 'limits');
const limitForm = reactive<Record<string, string>>({});
const limitReason = ref('');
const limitErrors = ref<Partial<Record<string, string>>>({});
watch(
    limitsOpen,
    (open) => {
        if (!open) return;
        limitRows.value.forEach((l) => (limitForm[l.name] = l.override === null ? '' : String(l.override)));
        limitReason.value = '';
        limitErrors.value = {};
        action.reset();
    },
    { immediate: true },
);
const changed = computed(() => limitRows.value.filter((l) => (limitForm[l.name] ?? '') !== (l.override === null ? '' : String(l.override))).length);
function publishLimits(): void {
    const next: Partial<Record<string, string>> = {};
    const overrides: Record<string, number | null> = {};
    for (const l of limitRows.value) {
        const raw = (limitForm[l.name] ?? '').trim();
        if (raw === '') {
            overrides[l.name] = null;
            continue;
        }
        const value = Number(raw);
        if (!Number.isInteger(value) || value < l.lower || value > l.upper) next[l.name] = trans('moderation.rules.limits.invalid', { min: formatNumber(l.lower), max: formatNumber(l.upper) });
        else overrides[l.name] = value;
    }
    const reason = limitReason.value.trim().length;
    if (reason < 10 || reason > 1000) next.reason = trans('ui.confirm.reason_length');
    limitErrors.value = next;
    if (Object.keys(next).length > 0) return;
    action.run('post', routeOr('admin.moderation.rules.limits', '/admin/moderation/rules/rate-limits'), { overrides, reason: limitReason.value.trim() }, { sensitive: true, onSuccess: () => (limitsOpen.value = false) });
}
const serverError = computed(() => (failedDialog ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Head :title="trans('moderation.rules.title')" />
    <div class="flex flex-col gap-32" data-testid="ADM-23" :data-qa-state="pageState">
        <PageHeader :title="trans('moderation.rules.title')" :crumbs="[{ label: trans('shell.groups.moderation') }]" :description="trans('moderation.rules.intro')" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('moderation.rules.error')" :body="trans('ui.state.error_body')" test-id="ADM-23.error" />
        <template v-else>
            <section class="flex flex-col gap-12" data-testid="ADM-23.keywords">
                <div class="flex flex-wrap items-end justify-between gap-12">
                    <div class="flex max-w-720 flex-col gap-4">
                        <h2 class="text-headline text-ink">{{ trans('moderation.rules.keywords.title') }}</h2>
                        <p class="text-supporting text-ink-2">{{ trans('moderation.rules.keywords.intro') }}</p>
                    </div>
                    <Button v-if="can('moderation.rules')" size="sm" variant="primary" :icon="PhPlus" data-testid="ADM-23.add" @click="addOpen = true">{{ trans('moderation.rules.keywords.add') }}</Button>
                </div>
                <EmptyQueue v-if="pageState !== 'loading' && rules.length === 0" variant="first" :title="trans('moderation.rules.keywords.empty_title')" :body="trans('moderation.rules.keywords.empty_body')" data-testid="ADM-23.keywords.empty" />
                <ScrollRegion v-else :label="trans('moderation.rules.keywords.caption')">
                    <table class="w-full text-supporting">
                        <caption class="sr-only">{{ trans('moderation.rules.keywords.caption') }}</caption>
                        <thead>
                            <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                                <th scope="col" class="px-12">{{ trans('moderation.rules.keywords.term') }}</th>
                                <th scope="col" class="px-12">{{ trans('moderation.rules.keywords.list') }}</th>
                                <th scope="col" class="px-12">{{ trans('moderation.rules.keywords.created') }}</th>
                                <th scope="col" class="px-12 text-right">{{ trans('moderation.rules.keywords.hits') }}</th>
                                <th scope="col" class="w-48 px-12"><span class="sr-only">{{ trans('moderation.rules.keywords.actions') }}</span></th>
                            </tr>
                        </thead>
                        <tbody>
                        <template v-if="pageState === 'loading'">
                            <tr v-for="n in 4" :key="`skeleton-${n}`" class="h-40 border-b border-line-subtle" aria-hidden="true">
                                <td v-for="c in 5" :key="c" class="px-12"><Skeleton shape="text" :class="c === 1 ? 'w-160' : 'w-80'" /></td>
                            </tr>
                        </template>
                        <template v-else>
                            <tr v-for="rule in rules" :key="rule.id" class="h-40 border-b border-line-subtle" data-testid="ADM-23.rule">
                                <td class="px-12"><span class="sc-key text-ink">{{ rule.term }}</span></td>
                                <td class="px-12"><StatusPill :tone="rule.list === 'block' ? 'danger' : 'warning'" :label="trans(`moderation.rules.keywords.lists.${rule.list}`)" /></td>
                                <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums" :title="formatDateTime(rule.created_at)">{{ rule.created_by ? trans('moderation.rules.keywords.by', { name: rule.created_by, date: formatDate(rule.created_at) }) : formatDate(rule.created_at) }}</td>
                                <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(rule.hits) }}</td>
                                <td class="px-12">
                                    <IconButton v-if="can('moderation.rules')" :icon="PhTrash" :label="trans('moderation.rules.keywords.remove')" size="sm" variant="ghost" class="hover:text-danger" data-testid="ADM-23.remove" @click="openRemove(rule)" />
                                </td>
                            </tr>
                        </template>
                    </tbody>
                    </table>
                </ScrollRegion>
            </section>

            <section class="flex flex-col gap-12" data-testid="ADM-23.limits">
                <div class="flex flex-wrap items-end justify-between gap-12">
                    <div class="flex max-w-720 flex-col gap-4">
                        <h2 class="text-headline text-ink">{{ trans('moderation.rules.limits.title') }}</h2>
                        <p class="text-supporting text-ink-2">{{ trans('moderation.rules.limits.intro') }}</p>
                        <p class="text-caption text-ink-3 tabular-nums" data-testid="ADM-23.limits.published">
                            {{ published ? trans('moderation.rules.limits.published', { version: formatNumber(published.version), name: published.published_by ?? '–', date: formatDateTime(published.published_at) }) : trans('moderation.rules.limits.never') }}
                        </p>
                    </div>
                    <Button v-if="can('moderation.rules')" size="sm" variant="secondary" :icon="PhPencilSimple" data-testid="ADM-23.limits.edit" @click="limitsOpen = true">{{ trans('moderation.rules.limits.edit') }}</Button>
                </div>
                <ScrollRegion :label="trans('moderation.rules.limits.caption')">
                    <table class="w-full text-supporting">
                        <caption class="sr-only">{{ trans('moderation.rules.limits.caption') }}</caption>
                        <thead>
                            <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                                <th scope="col" class="px-12">{{ trans('moderation.rules.limits.name') }}</th>
                                <th scope="col" class="px-12 text-right">{{ trans('moderation.rules.limits.default') }}</th>
                                <th scope="col" class="px-12 text-right">{{ trans('moderation.rules.limits.range') }}</th>
                                <th scope="col" class="px-12 text-right">{{ trans('moderation.rules.limits.override') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                        <template v-if="pageState === 'loading'">
                            <tr v-for="n in 6" :key="`skeleton-${n}`" class="h-40 border-b border-line-subtle" aria-hidden="true">
                                <td v-for="c in 4" :key="c" class="px-12"><Skeleton shape="text" :class="c === 1 ? 'w-160' : 'w-80'" /></td>
                            </tr>
                        </template>
                        <template v-else>
                            <template v-for="(l, index) in limitRows" :key="l.name">
                            <tr v-if="startsGroup(index)" class="h-32 border-b border-line-subtle bg-raised">
                                <th scope="colgroup" colspan="4" class="px-12 text-left text-caption text-ink-3">{{ trans(`moderation.rules.limits.groups.${groupOf(l.name)}`) }}</th>
                            </tr>
                            <tr class="h-40 border-b border-line-subtle" data-testid="ADM-23.limit">
                                <td class="px-12"><span class="flex flex-col"><span class="text-ink">{{ limitLabel(l.name) }}</span></span></td>
                                <td class="whitespace-nowrap px-12 text-right text-ink-2 tabular-nums">{{ trans('moderation.rules.limits.per', { max: formatNumber(l.default), window: windowText(l.minutes) }) }}</td>
                                <td class="whitespace-nowrap px-12 text-right text-ink-3 tabular-nums">{{ trans('moderation.rules.limits.range_value', { min: formatNumber(l.lower), max: formatNumber(l.upper) }) }}</td>
                                <td class="whitespace-nowrap px-12 text-right tabular-nums">
                                    <Badge v-if="l.override !== null" tone="warning" tnum>{{ formatNumber(l.override) }}</Badge>
                                    <span v-else class="text-ink-3">–</span>
                                </td>
                            </tr>
                            </template>
                        </template>
                    </tbody>
                    </table>
                </ScrollRegion>
            </section>
        </template>

        <Dialog v-model:open="addOpen" :title="trans('moderation.rules.keywords.add_title')" size="md" :dismissible="!action.processing.value" test-id="ADM-23.add-dialog">
            <form id="adm23-add" class="flex flex-col gap-16" novalidate @submit.prevent="add">
                <Field :label="trans('moderation.rules.keywords.term')" :hint="trans('moderation.rules.keywords.term_hint')" :error="addErrors.term" required>
                    <Input v-model="addForm.term" maxlength="100" data-testid="ADM-23.add.term" />
                </Field>
                <RadioGroup v-model="listModel" :legend="trans('moderation.rules.keywords.list')" :options="listOptions" data-testid="ADM-23.add.list" />
                <Field :label="trans('ui.confirm.reason')" :hint="trans('moderation.rules.reason_hint')" :error="addErrors.reason" required>
                    <Textarea v-model="addForm.reason" :rows="2" :maxlength="1000" show-count data-testid="ADM-23.add.reason" />
                </Field>
            </form>
            <template #footer>
                <DialogError :message="serverError" />
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="addOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm23-add" variant="primary" :loading="action.processing.value" data-testid="ADM-23.add.submit">{{ trans('moderation.rules.keywords.submit') }}</Button>
            </template>
        </Dialog>

        <ConfirmDialog
            v-model:open="removeOpen"
            :title="trans('moderation.rules.keywords.remove_title', { term: removing?.term ?? '' })"
            :body="trans('moderation.rules.keywords.remove_body')"
            :confirm-label="trans('moderation.rules.keywords.remove')"
            reason
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-23.remove-confirm"
            @confirm="remove"
        />

        <Drawer v-model:open="limitsOpen" :title="trans('moderation.rules.limits.edit_title')" :description="trans('moderation.rules.limits.intro')" size="lg" :dismissible="!action.processing.value" test-id="ADM-23.limits-drawer">
            <form id="adm23-limits" class="flex flex-col gap-16" novalidate @submit.prevent="publishLimits">
                <div v-for="l in limitRows" :key="l.name" class="flex flex-wrap items-end justify-between gap-12 border-b border-line-subtle pb-12">
                    <div class="flex min-w-0 flex-col gap-2">
                        <p class="text-label-s text-ink">{{ limitLabel(l.name) }}</p>
                        <p class="text-caption text-ink-3 tabular-nums">{{ trans('moderation.rules.limits.per', { max: formatNumber(l.default), window: windowText(l.minutes) }) }} · {{ trans('moderation.rules.limits.range_value', { min: formatNumber(l.lower), max: formatNumber(l.upper) }) }}</p>
                    </div>
                    <div class="w-120">
                        <Field :label="trans('moderation.rules.limits.override')" :error="limitErrors[l.name]" hide-label>
                            <Input v-model="limitForm[l.name]" inputmode="numeric" size="sm" :placeholder="trans('moderation.rules.limits.reset')" :aria-label="`${limitLabel(l.name)}: ${trans('moderation.rules.limits.override')}`" :data-testid="`ADM-23.limits.${l.name}`" />
                        </Field>
                    </div>
                </div>
                <Field :label="trans('ui.confirm.reason')" :hint="trans('moderation.rules.reason_hint')" :error="limitErrors.reason" required>
                    <Textarea v-model="limitReason" :rows="2" :maxlength="1000" show-count data-testid="ADM-23.limits.reason" />
                </Field>
            </form>
            <template #footer>
                <DialogError :message="serverError" />
                <p v-if="!serverError" class="mr-auto text-caption text-ink-3 tabular-nums">{{ trans('moderation.rules.limits.changed', { count: formatNumber(changed) }) }}</p>
                <Button variant="ghost" :disabled="action.processing.value" @click="limitsOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm23-limits" variant="primary" :loading="action.processing.value" data-testid="ADM-23.limits.submit">{{ trans('moderation.rules.limits.submit') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
