<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhFloppyDisk, PhPlay, PhPause } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import ActivityTimeline, { type TimelineEntry } from '../../Components/record/ActivityTimeline.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, Field, Input, Select, Skeleton, StatusPill, Switch, Textarea, type SelectOption } from '../../Components/ui';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../composables/recentPassword';
import { usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { actionLabel, actorName } from '../../lib/audit';
import { formatNumber } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import type { FeedEntry } from '../Members/types';
import { useLeaveGuard } from '../Content/Partials/configDraft';
import RuleBuilder from './Partials/RuleBuilder.vue';
import { badgeUrl, indexHref, previewText, storeUrl, type BadgeDetail, type BadgeRule, type DexSetInfo, type MetricInfo } from './shared';

/**
 * ADM-63 badge form (M5.9d admin, m5.9d contract §2): texts DE + EN (name, description, the hint hidden badges show as "???"),
 * category, tier, order, hidden and the rule (RuleBuilder: whitelisted metric + condition + value, with the live preview). A new badge
 * also gets its key and whether it starts active. On an existing badge: Aktivieren / Deaktivieren (SetBadgeActive) and "Jetzt anwenden"
 * (ApplyBadge, confirm with the preview count). Every write ⚿, audited by the actions (activity column). Without content.edit: read-only.
 */
const props = defineProps<{
    badge: BadgeDetail | null;
    metrics: MetricInfo[];
    sets: DexSetInfo[];
    tiers: string[];
    categories: string[];
    canEdit: boolean;
    activity: FeedEntry[];
}>();

const page = usePage();
const { can } = usePermissions();
const state = usePageState();
const creating = computed(() => props.badge === null);
const readOnly = computed(() => !(props.canEdit && can('content.edit')));

interface FormState {
    key: string;
    name_de: string;
    name_en: string;
    description_de: string;
    description_en: string;
    hint_de: string;
    hint_en: string;
    hidden: boolean;
    tier: string;
    category: string;
    sort: string;
    active: boolean;
    rule: BadgeRule;
}
function fromProps(): FormState {
    const b = props.badge;
    return {
        key: b?.key ?? '',
        name_de: b?.name_de ?? '',
        name_en: b?.name_en ?? '',
        description_de: b?.description_de ?? '',
        description_en: b?.description_en ?? '',
        hint_de: b?.hint_de ?? '',
        hint_en: b?.hint_en ?? '',
        hidden: b?.hidden ?? false,
        tier: b?.tier ?? 'bronze',
        category: b?.category ?? 'garage',
        sort: String(b?.sort ?? 100),
        active: b?.active ?? true,
        rule: b?.rule ? { ...b.rule } : { metric: props.metrics[0]?.key ?? 'published_vehicles', gte: 1 },
    };
}
const form = reactive<FormState>(fromProps());
const baseline = ref(JSON.stringify(form));
watch(
    () => props.badge,
    () => {
        Object.assign(form, fromProps());
        baseline.value = JSON.stringify(form);
    },
);
const dirty = computed(() => !readOnly.value && JSON.stringify(form) !== baseline.value);
const { guardOpen, leave, setGuard } = useLeaveGuard(dirty);

const tierOptions = computed<SelectOption[]>(() => props.tiers.map((t) => ({ value: t, label: trans(`gift.badges.tiers.${t}`) })));
const categoryOptions = computed<SelectOption[]>(() => props.categories.map((c) => ({ value: c, label: trans(`gift.badges.categories.${c}`) })));

// ---- save --------------------------------------------------------------------------------------------------------------------------
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const count = ref<number | null>(null);
const errorAt = (field: string): string | null => errors.value[field] ?? null;

function payload(): Record<string, unknown> {
    const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    return {
        ...(creating.value ? { key: form.key.trim(), active: form.active } : {}),
        name_de: form.name_de.trim(),
        name_en: form.name_en.trim(),
        description_de: form.description_de.trim(),
        description_en: form.description_en.trim(),
        hint_de: text(form.hint_de),
        hint_en: text(form.hint_en),
        hidden: form.hidden,
        tier: form.tier,
        category: form.category,
        sort: Number.parseInt(form.sort, 10),
        rule_json: form.rule,
    };
}
function save(): void {
    const go = (): void => {
        const url = creating.value ? storeUrl() : badgeUrl('update', props.badge!.key);
        router.visit(url, {
            method: creating.value ? 'post' : 'patch',
            data: payload() as never,
            preserveScroll: true,
            preserveState: true,
            onStart: () => (saving.value = true),
            onFinish: () => (saving.value = false),
            onSuccess: (next) => {
                if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) return;
                errors.value = {};
                baseline.value = JSON.stringify(form);
            },
            onError: (bag) => (errors.value = bag),
        });
    };
    if (passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) go();
    else confirmPasswordFirst(go);
}
const hasErrors = computed(() => Object.keys(errors.value).length > 0);

// ---- activate / deactivate / apply ----------------------------------------------------------------------------------------------------
const action = useAdminAction();
const activeOpen = ref(false);
const applyOpen = ref(false);
function openActive(): void {
    action.reset();
    activeOpen.value = true;
}
function openApply(): void {
    action.reset();
    applyOpen.value = true;
}
if (qaDialog() === 'apply' && props.badge?.active === true && !readOnly.value) openApply();
if (qaDialog() === 'deactivate' && props.badge?.active === true && !readOnly.value) openActive();
function setActive(): void {
    if (props.badge === null) return;
    action.run('post', badgeUrl('active', props.badge.key), { active: !props.badge.active }, { sensitive: true, onSuccess: () => (activeOpen.value = false) });
}
function apply(): void {
    if (props.badge === null) return;
    action.run('post', badgeUrl('apply', props.badge.key), {}, { sensitive: true, onSuccess: () => (applyOpen.value = false) });
}

// ---- header ------------------------------------------------------------------------------------------------------------------------
const title = computed(() => (props.badge ? props.badge.name_de : trans('gift.badges.form.create_title')));
const earnedText = computed(() => {
    const earned = props.badge?.earned ?? 0;
    if (earned === 0) return trans('gift.badges.form.earned_none');
    return earned === 1 ? trans('gift.badges.form.earned_one') : trans('gift.badges.form.earned', { count: formatNumber(earned) });
});
const activity = computed<TimelineEntry[]>(() => props.activity.map((e) => ({ id: e.id, occurred_at: e.occurred_at, label: actionLabel(e.action), actor: actorName(e), reason: e.reason })));
</script>

<template>
    <Head :title="title" />
    <div class="flex flex-col gap-24" data-testid="ADM-63R" :data-qa-state="state">
        <PageHeader :title="title" :crumbs="[{ label: trans('shell.groups.brand_content') }, { label: trans('gift.badges.title'), href: indexHref() }]" :loading="state === 'loading'">
            <template v-if="badge" #badge>
                <StatusPill :tone="badge.active ? 'success' : 'neutral'" :label="trans(badge.active ? 'gift.badges.status.active' : 'gift.badges.status.inactive')" data-testid="ADM-63R.status" />
            </template>
            <template v-if="badge" #meta>
                <p class="flex min-h-20 flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums">
                    <span class="sc-key">{{ badge.key }}</span><span aria-hidden="true">·</span><span>{{ earnedText }}</span>
                </p>
            </template>
            <template v-if="badge && !readOnly" #actions>
                <Button size="sm" variant="secondary" :icon="badge.active ? PhPause : PhPlay" data-testid="ADM-63R.active" @click="openActive">{{ trans(badge.active ? 'gift.badges.actions.deactivate' : 'gift.badges.actions.activate') }}</Button>
                <Button size="sm" variant="secondary" :icon="PhArrowsClockwise" :disabled="!badge.active || dirty" :title="badge.active ? undefined : trans('gift.badges.actions.apply_inactive')" data-testid="ADM-63R.apply" @click="openApply">{{ trans('gift.badges.actions.apply') }}</Button>
            </template>
        </PageHeader>

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('gift.badges.form.load_error')" :body="trans('ui.state.error_body')" test-id="ADM-63R.error" @retry="router.reload()" />
        <div v-else-if="state === 'loading'" class="flex flex-col gap-16" aria-busy="true" data-testid="ADM-63R.loading">
            <div v-for="height in ['h-320', 'h-200', 'h-160']" :key="height" :class="[height, 'flex flex-col gap-12 rounded-sm border border-line p-16']" aria-hidden="true">
                <Skeleton shape="text" class="w-160" />
                <Skeleton class="h-40 w-full rounded-sm" />
                <Skeleton class="h-40 w-full rounded-sm" />
            </div>
        </div>
        <div v-else class="flex flex-col gap-24 desktop:flex-row desktop:items-start">
            <form id="adm63-form" class="flex min-w-0 flex-1 flex-col gap-16" novalidate data-testid="ADM-63R.form" @submit.prevent="save">
                <p v-if="readOnly" class="text-admin-base text-ink-2" data-testid="ADM-63R.view-only">{{ trans('gift.badges.view_only') }}</p>
                <StateBlock v-if="hasErrors" kind="error" :title="trans('gift.badges.form.error')" test-id="ADM-63R.form-error" />

                <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm63-texts">
                    <div class="flex flex-col gap-4">
                        <h2 id="adm63-texts" class="text-headline text-ink">{{ trans('gift.badges.form.texts') }}</h2>
                        <p class="max-w-720 text-admin-base text-ink-2">{{ trans('gift.badges.form.texts_intro') }}</p>
                    </div>
                    <div v-if="creating" class="w-320">
                        <Field :label="trans('gift.badges.form.key')" :hint="trans('gift.badges.form.key_hint')" :error="errorAt('key')" required>
                            <Input v-model="form.key" maxlength="64" autocomplete="off" spellcheck="false" :disabled="readOnly" data-testid="ADM-63R.key" />
                        </Field>
                    </div>
                    <div class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                        <Field :label="trans('gift.badges.form.name_de')" :error="errorAt('name_de')" required><Input v-model="form.name_de" maxlength="80" :disabled="readOnly" data-testid="ADM-63R.name-de" /></Field>
                        <Field :label="trans('gift.badges.form.name_en')" :error="errorAt('name_en')" required><Input v-model="form.name_en" maxlength="80" :disabled="readOnly" data-testid="ADM-63R.name-en" /></Field>
                        <Field :label="trans('gift.badges.form.description_de')" :error="errorAt('description_de')" required><Textarea v-model="form.description_de" :rows="2" :maxlength="255" show-count :disabled="readOnly" data-testid="ADM-63R.description-de" /></Field>
                        <Field :label="trans('gift.badges.form.description_en')" :error="errorAt('description_en')" required><Textarea v-model="form.description_en" :rows="2" :maxlength="255" show-count :disabled="readOnly" data-testid="ADM-63R.description-en" /></Field>
                        <Field :label="trans('gift.badges.form.hint_de')" :hint="trans('gift.badges.form.hint_hint')" :error="errorAt('hint_de')" :required="form.hidden" :optional="!form.hidden"><Textarea v-model="form.hint_de" :rows="2" :maxlength="160" show-count :disabled="readOnly" data-testid="ADM-63R.hint-de" /></Field>
                        <Field :label="trans('gift.badges.form.hint_en')" :error="errorAt('hint_en')" :required="form.hidden" :optional="!form.hidden"><Textarea v-model="form.hint_en" :rows="2" :maxlength="160" show-count :disabled="readOnly" data-testid="ADM-63R.hint-en" /></Field>
                    </div>
                </section>

                <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm63-settings">
                    <h2 id="adm63-settings" class="text-headline text-ink">{{ trans('gift.badges.form.settings') }}</h2>
                    <div class="flex flex-wrap items-start gap-12">
                        <div class="w-200"><Field :label="trans('gift.badges.form.category')" :error="errorAt('category')" required><Select v-model="form.category" :options="categoryOptions" :disabled="readOnly" data-testid="ADM-63R.category" /></Field></div>
                        <div class="w-160"><Field :label="trans('gift.badges.form.tier')" :error="errorAt('tier')" required><Select v-model="form.tier" :options="tierOptions" :disabled="readOnly" data-testid="ADM-63R.tier" /></Field></div>
                        <div class="w-240"><Field :label="trans('gift.badges.form.sort')" :hint="trans('gift.badges.form.sort_hint')" :error="errorAt('sort')" required><Input v-model="form.sort" type="number" min="0" max="9999" inputmode="numeric" tnum :disabled="readOnly" data-testid="ADM-63R.sort" /></Field></div>
                    </div>
                    <div class="flex flex-wrap gap-24">
                        <Switch v-model="form.hidden" :label="trans(form.hidden ? 'gift.badges.form.hidden_on' : 'gift.badges.form.hidden_off')" :disabled="readOnly" data-testid="ADM-63R.hidden" />
                        <Switch v-if="creating" v-model="form.active" :label="trans(form.active ? 'gift.badges.form.active_on' : 'gift.badges.form.active_off')" :disabled="readOnly" data-testid="ADM-63R.active-switch" />
                    </div>
                </section>

                <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm63-rule">
                    <div class="flex flex-col gap-4">
                        <h2 id="adm63-rule" class="text-headline text-ink">{{ trans('gift.badges.rule.title') }}</h2>
                        <p class="max-w-720 text-admin-base text-ink-2">{{ trans('gift.badges.rule.intro') }}</p>
                    </div>
                    <RuleBuilder v-model="form.rule" :metrics="metrics" :sets="sets" :disabled="readOnly" :error="errorAt('rule_json')" @counted="(n) => (count = n)" />
                </section>

                <div v-if="!readOnly" class="flex flex-wrap items-center gap-12">
                    <Button type="submit" variant="primary" :icon="PhFloppyDisk" :loading="saving" :disabled="!creating && !dirty" data-testid="ADM-63R.save">{{ trans(creating ? 'gift.badges.form.create' : 'gift.badges.form.save') }}</Button>
                </div>
            </form>

            <aside v-if="badge" class="min-w-0 shrink-0 desktop:w-240 desktop:border-l desktop:border-line-subtle desktop:pl-24 wide:w-320">
                <ActivityTimeline :entries="activity" test-id="ADM-63R.activity" />
            </aside>
        </div>

        <ConfirmDialog
            v-if="badge"
            v-model:open="activeOpen"
            :title="trans(badge.active ? 'gift.badges.actions.deactivate_title' : 'gift.badges.actions.activate_title')"
            :body="trans(badge.active ? 'gift.badges.actions.deactivate_body' : 'gift.badges.actions.activate_body')"
            :confirm-label="trans(badge.active ? 'gift.badges.actions.deactivate' : 'gift.badges.actions.activate')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-63R.active-dialog"
            @confirm="setActive"
        />
        <ConfirmDialog
            v-if="badge"
            v-model:open="applyOpen"
            :title="trans('gift.badges.actions.apply_title')"
            :body="trans('gift.badges.actions.apply_body')"
            :confirm-label="trans('gift.badges.actions.apply')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-63R.apply-dialog"
            @confirm="apply"
        >
            <p class="text-admin-base text-ink tabular-nums" data-testid="ADM-63R.apply-count">
                {{ count === null ? trans('gift.badges.rule.preview_loading') : `${previewText(count)}.` }}
            </p>
        </ConfirmDialog>
        <ConfirmDialog
            :open="guardOpen"
            :title="trans('gift.badges.form.discard_title')"
            :body="trans('gift.badges.form.discard_body')"
            :confirm-label="trans('gift.badges.form.discard')"
            tone="neutral"
            test-id="ADM-63R.discard"
            @update:open="setGuard"
            @confirm="leave"
        />
    </div>
</template>
