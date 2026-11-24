<script setup lang="ts">
import DialogError from '../../../Components/patterns/DialogError.vue';
import { focusRing } from '../../../Components/ui/styles';
import { trans } from 'laravel-vue-i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { qaEnabled, withQaNow } from '../../../lib/qa';
import { useAdminAction } from '../../../Components/decisions/action';
import { statementErrors, untilFrom, type Duration } from '../../../Components/decisions/statement';
import ApprovalNotice from '../../../Components/patterns/ApprovalNotice.vue';
import { Button, DateRangeField, Drawer, Field, Input, RadioGroup, Select, Skeleton, Textarea } from '../../../Components/ui';
import { formatNumber } from '../../../lib/format';
import { isCancelled, JsonError, requestJson } from '../../../lib/http';
import { useFourEyes } from '../../../composables/fourEyes';
import { routeOr } from '../../../lib/routes';
import { fillPlaceholders, type ComposerOptions, type SorTemplate } from '../shared';

/**
 * The ADM-21/22 decision composer (06 §3 Moderation, m3.4-contract §1): action (keine Maßnahme · Inhalt entfernen · Einschränken ·
 * Sperren), for restrict what and how long, a statement-of-reasons template in the member's language (placeholders filled, every field
 * editable), facts, ground, where it is written, the automated flags read-only, the DE/EN preview of what the member reads (SAFE-01 and
 * the mail). A suspension is four-eyes (when the governance switch is on): the notice says so and the server only creates the approval.
 * M5.9 (10 §8.6): when the triage suggested a template the composer has, one line "KI-Vorschlag: <Vorlage>" with "Übernehmen", which
 * applies it exactly like a pick in the template field. Nothing is preselected or sent by itself; a key the composer lacks shows nothing.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        caseId: string;
        composer: ComposerOptions;
        templates: SorTemplate[];
        testId: string;
        failed?: boolean;
        /** The action the form starts with (ADM-20 SplitQueue: `a` = Inhalt entfernen, `r` = Keine Maßnahme); else the usual default. */
        initialAction?: ComposerOptions['actions'][number] | null;
        /** M5.9: the triage's suggested statement-of-reasons template key (`ai.template_key` of the case), never applied by itself. */
        aiTemplateKey?: string | null;
    }>(),
    { failed: false, initialAction: null, aiTemplateKey: null },
);
const emit = defineEmits<{ decided: [] }>();

type PreviewLocale = 'de' | 'en';
type Action = ComposerOptions['actions'][number];
interface Form {
    /** Null until the moderator picks one (DQ-1199): a decision is a deliberate act, no sanction is the default. */
    action: Action | null;
    /** M5.8: `forum` = the forum ban (DSA restriction type forum, m5.8-contract D3). */
    restriction: 'messaging' | 'publishing' | 'forum';
    duration: Duration;
    day: string;
    template: string;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string;
}
// Only a one-key decision (`a` / `r` in a SplitQueue) arrives with its action; every other way in starts without one (DQ-1199).
const startAction = (): Action | null => (props.initialAction !== null && props.composer.actions.includes(props.initialAction) ? props.initialAction : null);
const blank = (): Form => ({ action: startAction(), restriction: 'messaging', duration: '7', day: '', template: '', facts: '', ground: '', ground_document: 'community', ground_section: '' });
const form = reactive<Form>(blank());
const fourEyesOn = useFourEyes();
const errors = ref<Partial<Record<string, string>>>({});
const action = useAdminAction();

watch(open, (value) => {
    if (value) onOpen();
});
function onOpen(): void {
    Object.assign(form, blank());
    errors.value = {};
    action.reset();
    preview.value = null;
    previewError.value = false;
    schedulePreview();
    // QA cell ADM-21-composer-preview (DQ-556, non-production): a template chosen, the preview in view once it has loaded.
    if (qaEnabled() && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1') {
        const first = templateOptions.value.find((o) => o.value !== '-');
        if (first) templateModel.value = first.value;
        const stop = watch(preview, (value) => {
            if (value === null) return;
            stop();
            void nextTick(() => document.querySelector(`[data-testid="${props.testId}.preview"]`)?.scrollIntoView({ block: 'start' }));
        });
    }
}

const actionOptions = computed(() => props.composer.actions.map((value) => ({ value, label: trans(`moderation.composer.actions.${value}`), hint: trans(`moderation.composer.hints.${value}`) })));
const restrictionOptions = computed(() => (['messaging', 'publishing', 'forum'] as const).map((value) => ({ value, label: trans(`decisions.measures.${value}`), hint: trans(`decisions.measures.${value}_hint`) })));
const limited = computed(() => form.action === 'suspend' && props.composer.max_suspension_days !== null);
const durationOptions = computed(() =>
    (['1', '7', '30', 'date', 'none'] as const).filter((v) => !(limited.value && v === 'none')).map((value) => ({ value, label: trans(`decisions.durations.${value}`) })),
);
const documentOptions = computed(() => (['community', 'terms', 'law'] as const).map((value) => ({ value, label: trans(`decisions.documents.${value}`) })));
const needsStatement = computed(() => form.action !== null && form.action !== 'no_action');
const timed = computed(() => form.action === 'restrict' || form.action === 'suspend');

// Templates in the member's language first; the action of a template is a suggestion, every template can be used.
const templateOptions = computed(() => [
    { value: '-', label: trans('moderation.composer.template_none') },
    ...props.templates
        .filter((t) => t.locale === props.composer.member_locale)
        .map((t) => ({ value: t.id, label: t.label })),
]);
const actionModel = computed({ get: () => form.action ?? undefined, set: (v: string | undefined) => (form.action = (props.composer.actions.find((a) => a === v) ?? form.action)) });
const restrictionModel = computed({ get: () => form.restriction, set: (v: string | undefined) => (form.restriction = v === 'publishing' || v === 'forum' ? v : 'messaging') });
const durationModel = computed({ get: () => form.duration, set: (v: string | undefined) => (form.duration = (v ?? '7') as Duration) });
const documentModel = computed({ get: () => form.ground_document, set: (v: string | undefined) => (form.ground_document = (v ?? 'community') as Form['ground_document']) });
const templateModel = computed({
    get: () => (form.template === '' ? undefined : form.template),
    set: (id: string | undefined) => {
        form.template = id === undefined || id === '-' ? '' : id;
        const template = props.templates.find((t) => t.id === id);
        if (!template) return;
        form.facts = fillPlaceholders(template.facts, props.composer.placeholders);
        form.ground = fillPlaceholders(template.ground, props.composer.placeholders);
        form.ground_document = template.ground_document;
        form.ground_section = template.ground_section ?? '';
        if ((props.composer.actions as string[]).includes(template.action)) form.action = template.action as Action;
    },
});
// The suggested template in the member's language, as the template field offers it; null when the key is not one of them.
const aiTemplate = computed(() => (props.aiTemplateKey ? (props.templates.find((t) => t.key === props.aiTemplateKey && t.locale === props.composer.member_locale) ?? null) : null));
const aiTemplateApplied = computed(() => aiTemplate.value !== null && form.template === aiTemplate.value.id);
function applyAiTemplate(): void {
    if (aiTemplate.value !== null) templateModel.value = aiTemplate.value.id;
}

watch(limited, (value) => {
    if (value && form.duration === 'none') form.duration = '30';
});

// ---- preview (DE/EN) --------------------------------------------------------------------------------------------------------
const preview = ref<{ de: string[]; en: string[] } | null>(null);
const memberLocale = computed<PreviewLocale>(() => (props.composer.member_locale === 'en' ? 'en' : 'de'));
const otherLocale = computed<PreviewLocale>(() => (memberLocale.value === 'en' ? 'de' : 'en'));
const previewReady = computed(() => form.action !== null && (form.action === 'no_action' || (form.facts.trim().length >= 10 && form.ground.trim().length >= 3)));
const previewError = ref(false);
const previewLoading = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
function schedulePreview(): void {
    if (timer !== null) clearTimeout(timer);
    // DQ-556: the preview follows the form by itself, 500 ms after the last change, once there is something to show.
    timer = setTimeout(() => {
        if (previewReady.value) void loadPreview();
    }, 500);
}
async function loadPreview(): Promise<void> {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    previewLoading.value = true;
    previewError.value = false;
    // Only the latest preview speaks: one aborted for a newer change of the form settles after that one has started.
    try {
        const answer = await requestJson<{ de: string[]; en: string[] }>(
            'post',
            withQaNow(routeOr('admin.moderation.cases.preview', `/admin/moderation/cases/${props.caseId}/preview`, { case: props.caseId })),
            { action: form.action, restriction: form.action === 'restrict' ? form.restriction : null, until: timed.value ? untilFrom(form.duration, form.day) : null, facts: form.facts, ground: form.ground },
            mine.signal,
        );
        if (controller === mine) preview.value = answer;
    } catch (error) {
        if (controller === mine && !isCancelled(error)) previewError.value = error instanceof JsonError || error instanceof Error;
    } finally {
        if (controller === mine) previewLoading.value = false;
    }
}
watch(() => [form.action, form.restriction, form.duration, form.day, form.facts, form.ground], () => {
    if (open.value) schedulePreview();
});
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
});

// Opened on mount (?dialog=decide or a parent that starts open): prepare the form as on any later open.
onMounted(() => {
    if (open.value) onOpen();
});

// DQ-1199/1205: "Entscheidung senden" stays off until an action and the statement (where one is needed) are there; the server
// validates again. Dates and limits are still checked on submit.
const canSend = computed(() => {
    if (form.action === null) return false;
    return !needsStatement.value || (form.facts.trim().length >= 10 && form.ground.trim().length >= 3);
});
/** Red only when the decision restricts (remove, restrict, suspend); "Keine Maßnahme" and no choice yet are neutral. */
const restricting = computed(() => form.action !== null && form.action !== 'no_action');

function submit(): void {
    if (form.action === null) return;
    const next: Partial<Record<string, string>> = needsStatement.value ? { ...statementErrors({ template: '', facts: form.facts, ground: form.ground, ground_document: form.ground_document, ground_section: form.ground_section }) } : {};
    const until = timed.value ? untilFrom(form.duration, form.day) : null;
    if (timed.value && form.duration === 'date' && until === null) next.until = trans('decisions.errors.date');
    if (until !== null && Date.parse(until) <= Date.now()) next.until = trans('decisions.errors.date_past');
    const max = props.composer.max_suspension_days;
    if (limited.value && max !== null && (until === null || Date.parse(until) > Date.now() + (max + 1) * 86_400_000)) next.until = trans('decisions.errors.max_days', { days: formatNumber(max) });
    errors.value = next;
    if (Object.keys(next).length > 0) return;
    // A preview landing after the decide redirect would take the one-time flash ("Entscheidung gespeichert") before the next page reads it.
    if (timer !== null) clearTimeout(timer);
    timer = null;
    controller?.abort();
    action.run(
        'post',
        routeOr('admin.moderation.cases.decide', `/admin/moderation/cases/${props.caseId}/decide`, { case: props.caseId }),
        {
            action: form.action,
            restriction: form.action === 'restrict' ? form.restriction : null,
            until,
            template: form.template || null,
            facts: needsStatement.value ? form.facts.trim() : null,
            ground: needsStatement.value ? form.ground.trim() : null,
            ground_document: needsStatement.value ? form.ground_document : null,
            ground_section: needsStatement.value && form.ground_section.trim() !== '' ? form.ground_section.trim() : null,
        },
        {
            sensitive: true,
            onSuccess: () => {
                open.value = false;
                emit('decided');
            },
        },
    );
}
const serverError = computed(() => (props.failed ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Drawer v-model:open="open" :title="trans('moderation.composer.title')" :description="trans('moderation.composer.description')" size="lg" :dismissible="!action.processing.value" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-20" novalidate @submit.prevent="submit">
            <div v-if="aiTemplate" class="flex flex-wrap items-center justify-between gap-x-12 gap-y-4 rounded-sm border border-line-subtle px-12 py-8" :data-testid="`${testId}.ai-template`">
                <div class="flex min-w-0 flex-col gap-2">
                    <p class="text-admin-base-strong text-ink">{{ trans('moderation.composer.ai_template', { template: aiTemplate.label }) }}</p>
                    <p class="text-caption text-ink-3">{{ trans('moderation.composer.ai_template_note') }}</p>
                </div>
                <Button
                    size="sm"
                    variant="secondary"
                    :disabled="aiTemplateApplied"
                    :data-autofocus="aiTemplateApplied ? undefined : ''"
                    :data-testid="`${testId}.ai-template.apply`"
                    @click="applyAiTemplate"
                >
                    {{ trans(aiTemplateApplied ? 'moderation.composer.ai_template_applied' : 'moderation.composer.ai_template_apply') }}
                </Button>
            </div>
            <RadioGroup v-model="actionModel" :legend="trans('moderation.composer.action')" :options="actionOptions" :data-testid="`${testId}.action`" />
            <ApprovalNotice v-if="fourEyesOn && form.action === 'suspend'" :test-id="`${testId}.four-eyes`" />

            <div v-if="form.action === 'restrict'">
                <RadioGroup v-model="restrictionModel" :legend="trans('moderation.composer.restriction')" :options="restrictionOptions" :data-testid="`${testId}.restriction`" />
            </div>
            <div v-if="timed" class="flex flex-wrap items-start gap-12">
                <div class="w-200">
                    <Field :label="trans('decisions.duration')" :hint="limited ? trans('decisions.max_days_hint', { days: formatNumber(composer.max_suspension_days) }) : undefined" :error="form.duration !== 'date' ? errors.until : undefined">
                        <Select v-model="durationModel" :options="durationOptions" :data-testid="`${testId}.duration`" />
                    </Field>
                </div>
                <div v-if="form.duration === 'date'" class="w-160">
                    <Field :label="trans('decisions.until')" :error="errors.until" required>
                        <DateRangeField v-model:from="form.day" single :test-id="`${testId}.until`" />
                    </Field>
                </div>
            </div>

            <fieldset v-if="needsStatement" class="flex flex-col gap-16" :data-testid="`${testId}.statement`">
                <legend class="mb-4 text-admin-base-strong text-ink">{{ trans('decisions.legend') }}</legend>
                <Field :label="trans('moderation.composer.template')" :hint="trans('moderation.composer.template_hint', { locale: composer.member_locale.toUpperCase() })" optional>
                    <Select v-model="templateModel" :options="templateOptions" :placeholder="trans('decisions.template_placeholder')" :data-testid="`${testId}.template`" />
                </Field>
                <Field :label="trans('decisions.facts')" :hint="trans('decisions.facts_hint')" :error="errors.facts" required>
                    <Textarea v-model="form.facts" :rows="4" :maxlength="5000" :data-testid="`${testId}.facts`" />
                </Field>
                <Field :label="trans('decisions.ground')" :error="errors.ground" required>
                    <Textarea v-model="form.ground" :rows="2" :maxlength="2000" :data-testid="`${testId}.ground`" />
                </Field>
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-160 grow basis-0">
                        <Field :label="trans('decisions.document')" required><Select v-model="documentModel" :options="documentOptions" :data-testid="`${testId}.document`" /></Field>
                    </div>
                    <div class="w-120">
                        <Field :label="trans('decisions.section')" optional><Input v-model="form.ground_section" maxlength="100" :data-testid="`${testId}.section`" /></Field>
                    </div>
                </div>
            </fieldset>
            <p v-else-if="form.action === 'no_action'" class="text-admin-base text-ink-2">{{ trans('moderation.composer.no_action_note') }}</p>

            <div class="flex flex-col gap-4" :data-testid="`${testId}.automated`">
                <p class="text-admin-base-strong text-ink">{{ trans('moderation.composer.automated') }}</p>
                <p class="text-admin-base text-ink-2">{{ trans(composer.automated_detection ? 'moderation.composer.automated_detection_yes' : 'moderation.composer.automated_detection_no') }}</p>
                <p class="text-admin-base text-ink-2">{{ trans('moderation.composer.automated_decision') }}</p>
            </div>

            <section class="flex flex-col gap-12 rounded-sm border border-line-subtle px-16 py-16" :aria-busy="previewLoading" :data-testid="`${testId}.preview`">
                <div class="flex flex-wrap items-center justify-between gap-8">
                    <div class="flex flex-col gap-2">
                        <h3 class="text-admin-base-strong text-ink">{{ trans('moderation.composer.preview') }}</h3>
                        <p class="text-caption text-ink-3">{{ trans('moderation.composer.preview_hint') }}</p>
                    </div>
                    <Button size="sm" variant="ghost" :loading="previewLoading" :disabled="!previewReady" @click="loadPreview()">{{ trans('moderation.composer.preview_load') }}</Button>
                </div>
                <p v-if="previewError" class="text-admin-base text-danger" role="alert">{{ trans('moderation.composer.preview_error') }}</p>
                <div v-else-if="preview === null && previewLoading" class="flex flex-col gap-8" aria-hidden="true"><Skeleton v-for="n in 4" :key="n" shape="text" class="w-full" /></div>
                <p v-else-if="preview === null" class="text-admin-base text-ink-3" :data-testid="`${testId}.preview.waiting`">{{ trans('moderation.composer.preview_waiting') }}</p>
                <!-- DQ-610: what this member reads, in their language; the other one only on request (if they switch the language). -->
                <div v-else class="flex flex-col gap-12">
                    <div class="flex min-w-0 flex-col gap-8" :lang="memberLocale" :data-testid="`${testId}.preview.${memberLocale}`">
                        <p class="text-caption text-ink-3">{{ trans(`moderation.composer.preview_${memberLocale}`) }}</p>
                        <p v-for="(line, index) in preview[memberLocale]" :key="index" class="text-admin-base text-ink">{{ line }}</p>
                    </div>
                    <details class="rounded-sm border border-line-subtle px-12 py-8" :data-testid="`${testId}.preview.${otherLocale}`">
                        <summary :class="[focusRing, 'flex min-h-32 cursor-pointer items-center rounded-xs text-admin-base-strong text-ink-2']">{{ trans('moderation.composer.preview_other', { language: trans(`moderation.composer.preview_${otherLocale}`) }) }}</summary>
                        <div class="flex flex-col gap-8 pt-8" :lang="otherLocale">
                            <p v-for="(line, index) in preview[otherLocale]" :key="index" class="text-admin-base text-ink-2">{{ line }}</p>
                        </div>
                    </details>
                </div>
            </section>
        </form>
        <template #footer>
            <DialogError :message="serverError" />
            <Button variant="ghost" :disabled="action.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" :variant="restricting ? 'danger' : 'primary'" :disabled="!canSend" :loading="action.processing.value" :data-testid="`${testId}.submit`">
                {{ form.action === 'suspend' ? trans(fourEyesOn ? 'moderation.composer.submit_suspend' : 'decisions.submit_suspend_direct') : trans('moderation.composer.submit') }}
            </Button>
        </template>
    </Drawer>
</template>
