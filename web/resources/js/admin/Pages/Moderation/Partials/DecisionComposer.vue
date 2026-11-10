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
import { routeOr } from '../../../lib/routes';
import { fillPlaceholders, type ComposerOptions, type SorTemplate } from '../shared';

/**
 * The ADM-21/22 decision composer (06 §3 Moderation, m3.4-contract §1): action (keine Maßnahme · Inhalt entfernen · Einschränken ·
 * Sperren), for restrict what and how long, a statement-of-reasons template in the member's language (placeholders filled, every field
 * editable), facts, ground, where it is written, the automated flags read-only, the DE/EN preview of what the member reads (SAFE-01 and
 * the mail), and the audit reason. A suspension is four-eyes: the notice says so and the server only creates the approval.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ caseId: string; composer: ComposerOptions; templates: SorTemplate[]; testId: string; failed?: boolean }>(), { failed: false });

type PreviewLocale = 'de' | 'en';
type Action = ComposerOptions['actions'][number];
interface Form {
    action: Action;
    restriction: 'messaging' | 'publishing';
    duration: Duration;
    day: string;
    template: string;
    facts: string;
    ground: string;
    ground_document: 'community' | 'terms' | 'law';
    ground_section: string;
    reason: string;
}
const blank = (): Form => ({ action: props.composer.actions.includes('remove_content') ? 'remove_content' : 'no_action', restriction: 'messaging', duration: '7', day: '', template: '', facts: '', ground: '', ground_document: 'community', ground_section: '', reason: '' });
const form = reactive<Form>(blank());
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
const restrictionOptions = computed(() => (['messaging', 'publishing'] as const).map((value) => ({ value, label: trans(`decisions.measures.${value}`), hint: trans(`decisions.measures.${value}_hint`) })));
const limited = computed(() => form.action === 'suspend' && props.composer.max_suspension_days !== null);
const durationOptions = computed(() =>
    (['1', '7', '30', 'date', 'none'] as const).filter((v) => !(limited.value && v === 'none')).map((value) => ({ value, label: trans(`decisions.durations.${value}`) })),
);
const documentOptions = computed(() => (['community', 'terms', 'law'] as const).map((value) => ({ value, label: trans(`decisions.documents.${value}`) })));
const needsStatement = computed(() => form.action !== 'no_action');
const timed = computed(() => form.action === 'restrict' || form.action === 'suspend');

// Templates in the member's language first; the action of a template is a suggestion, every template can be used.
const templateOptions = computed(() => [
    { value: '-', label: trans('moderation.composer.template_none') },
    ...props.templates
        .filter((t) => t.locale === props.composer.member_locale)
        .map((t) => ({ value: t.id, label: t.label })),
]);
const actionModel = computed({ get: () => form.action, set: (v: string | undefined) => (form.action = (props.composer.actions.find((a) => a === v) ?? form.action)) });
const restrictionModel = computed({ get: () => form.restriction, set: (v: string | undefined) => (form.restriction = v === 'publishing' ? 'publishing' : 'messaging') });
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
watch(limited, (value) => {
    if (value && form.duration === 'none') form.duration = '30';
});

// ---- preview (DE/EN) --------------------------------------------------------------------------------------------------------
const preview = ref<{ de: string[]; en: string[] } | null>(null);
const memberLocale = computed<PreviewLocale>(() => (props.composer.member_locale === 'en' ? 'en' : 'de'));
const otherLocale = computed<PreviewLocale>(() => (memberLocale.value === 'en' ? 'de' : 'en'));
const previewReady = computed(() => form.action === 'no_action' || (form.facts.trim().length >= 10 && form.ground.trim().length >= 3));
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

function submit(): void {
    const next: Partial<Record<string, string>> = needsStatement.value ? { ...statementErrors({ template: '', facts: form.facts, ground: form.ground, ground_document: form.ground_document, ground_section: form.ground_section }) } : {};
    const reason = form.reason.trim().length;
    if (reason < 10 || reason > 1000) next.reason = trans('ui.confirm.reason_length');
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
            reason: form.reason.trim(),
        },
        { sensitive: true, onSuccess: () => (open.value = false) },
    );
}
const serverError = computed(() => (props.failed ? trans('ui.state.server_error') : action.error.value));
</script>

<template>
    <Drawer v-model:open="open" :title="trans('moderation.composer.title')" :description="trans('moderation.composer.description')" size="lg" :dismissible="!action.processing.value" :test-id="testId">
        <form :id="`${testId}-form`" class="flex flex-col gap-20" novalidate @submit.prevent="submit">
            <RadioGroup v-model="actionModel" :legend="trans('moderation.composer.action')" :options="actionOptions" :data-testid="`${testId}.action`" />
            <ApprovalNotice v-if="form.action === 'suspend'" :test-id="`${testId}.four-eyes`" />

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
                <legend class="mb-4 text-label-s text-ink">{{ trans('decisions.legend') }}</legend>
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
            <p v-else class="text-supporting text-ink-2">{{ trans('moderation.composer.no_action_note') }}</p>

            <div class="flex flex-col gap-4" :data-testid="`${testId}.automated`">
                <p class="text-label-s text-ink">{{ trans('moderation.composer.automated') }}</p>
                <p class="text-supporting text-ink-2">{{ trans(composer.automated_detection ? 'moderation.composer.automated_detection_yes' : 'moderation.composer.automated_detection_no') }}</p>
                <p class="text-supporting text-ink-2">{{ trans('moderation.composer.automated_decision') }}</p>
            </div>

            <section class="flex flex-col gap-12 rounded-sm border border-line-subtle px-16 py-16" :aria-busy="previewLoading" :data-testid="`${testId}.preview`">
                <div class="flex flex-wrap items-center justify-between gap-8">
                    <div class="flex flex-col gap-2">
                        <h3 class="text-label-s text-ink">{{ trans('moderation.composer.preview') }}</h3>
                        <p class="text-caption text-ink-3">{{ trans('moderation.composer.preview_hint') }}</p>
                    </div>
                    <Button size="sm" variant="ghost" :loading="previewLoading" :disabled="!previewReady" @click="loadPreview()">{{ trans('moderation.composer.preview_load') }}</Button>
                </div>
                <p v-if="previewError" class="text-helper text-danger" role="alert">{{ trans('moderation.composer.preview_error') }}</p>
                <div v-else-if="preview === null && previewLoading" class="flex flex-col gap-8" aria-hidden="true"><Skeleton v-for="n in 4" :key="n" shape="text" class="w-full" /></div>
                <p v-else-if="preview === null" class="text-supporting text-ink-3" :data-testid="`${testId}.preview.waiting`">{{ trans('moderation.composer.preview_waiting') }}</p>
                <!-- DQ-610: what this member reads, in their language; the other one only on request (if they switch the language). -->
                <div v-else class="flex flex-col gap-12">
                    <div class="flex min-w-0 flex-col gap-8" :lang="memberLocale" :data-testid="`${testId}.preview.${memberLocale}`">
                        <p class="text-caption text-ink-3">{{ trans(`moderation.composer.preview_${memberLocale}`) }}</p>
                        <p v-for="(line, index) in preview[memberLocale]" :key="index" class="text-supporting text-ink">{{ line }}</p>
                    </div>
                    <details class="rounded-sm border border-line-subtle px-12 py-8" :data-testid="`${testId}.preview.${otherLocale}`">
                        <summary :class="[focusRing, 'flex min-h-32 cursor-pointer items-center rounded-xs text-label-s text-ink-2']">{{ trans('moderation.composer.preview_other', { language: trans(`moderation.composer.preview_${otherLocale}`) }) }}</summary>
                        <div class="flex flex-col gap-8 pt-8" :lang="otherLocale">
                            <p v-for="(line, index) in preview[otherLocale]" :key="index" class="text-supporting text-ink-2">{{ line }}</p>
                        </div>
                    </details>
                </div>
            </section>

            <Field :label="trans('ui.confirm.reason')" :hint="trans('decisions.reason_hint')" :error="errors.reason" required>
                <Textarea v-model="form.reason" :rows="3" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
            </Field>
        </form>
        <template #footer>
            <DialogError :message="serverError" />
            <Button variant="ghost" :disabled="action.processing.value" @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="`${testId}-form`" :variant="form.action === 'no_action' ? 'primary' : 'danger'" :loading="action.processing.value" :data-testid="`${testId}.submit`">
                {{ form.action === 'suspend' ? trans('moderation.composer.submit_suspend') : trans('moderation.composer.submit') }}
            </Button>
        </template>
    </Drawer>
</template>
