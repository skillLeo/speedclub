<script setup lang="ts">
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, ref, watch } from 'vue';
import ApprovalNotice from '../../../Components/patterns/ApprovalNotice.vue';
import DialogError from '../../../Components/patterns/DialogError.vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Button, Combobox, Dialog, Field, Skeleton, Textarea, type SelectOption } from '../../../Components/ui';
import { qaDialogFailed } from '../../../composables/pageState';
import { formatNumber } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';
import { fetchImpact, FOUR_EYES_ABOVE, useCatalogWrite, type CatalogLevel, type Impact } from '../shared';

/**
 * ADM-14 / ADM-16 "Zusammenführen" (m3.3 §1, ADR-234; catalog.manage, ⚿, reason): pick the survivor of the same level (under the same
 * make or model), see what moves before anything happens (vehicles, models/generations, modifications; the merged slug stays as a
 * redirect), and send. More than 100 affected vehicles only create a four-eyes request (ADR-214/229): the dialog says so ahead.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ level: CatalogLevel; entry: { id: number; name: string } | null; presetTarget?: number | null; testId: string }>(), { presetTarget: null });

const impact = ref<Impact | null>(null);
const loadState = ref<'loading' | 'ready' | 'error'>('loading');
const target = ref<string | undefined>(undefined);
const reason = ref('');
const reasonError = ref<string | null>(null);
const write = useCatalogWrite();
const failed = qaDialogFailed();

async function load(): Promise<void> {
    if (props.entry === null) return;
    loadState.value = 'loading';
    try {
        impact.value = await fetchImpact(props.level, props.entry.id);
        loadState.value = 'ready';
        const preset = props.presetTarget ?? null;
        if (preset !== null && impact.value.candidates.some((c) => c.id === preset)) target.value = String(preset);
        // DQ-603: the dialog opened on Abbrechen while the facts loaded; the first decision is the survivor, so focus moves there.
        await nextTick();
        document.querySelector<HTMLElement>(`[data-testid="${props.testId}.survivor"] [role="combobox"], [data-testid="${props.testId}.survivor"][role="combobox"]`)?.focus({ preventScroll: true });
    } catch {
        loadState.value = 'error';
    }
}

watch(
    open,
    (value) => {
        if (!value) return;
        impact.value = null;
        target.value = undefined;
        reason.value = '';
        reasonError.value = null;
        write.reset();
        void load();
    },
    { immediate: true },
);

const unit = computed(() => (props.level === 'brand' ? 'catalog.merge.option_brand' : 'catalog.merge.option'));
const options = computed<SelectOption[]>(() =>
    (impact.value?.candidates ?? []).map((c) => ({
        value: String(c.id),
        label: transChoice(c.active ? unit.value : `${unit.value}_inactive`, c.vehicles, { name: c.name, count: formatNumber(c.vehicles) }),
    })),
);
const chosen = computed(() => impact.value?.candidates.find((c) => String(c.id) === target.value) ?? null);
const moving = computed(() => impact.value?.entry.vehicles ?? 0);
const fourEyes = computed(() => moving.value > FOUR_EYES_ABOVE);
const facts = computed(() => {
    const i = impact.value;
    if (i === null) return [];
    return [
        { key: 'vehicles', label: trans(props.level === 'brand' ? 'catalog.merge.facts.vehicles_brand' : 'catalog.merge.facts.vehicles'), value: i.entry.vehicles },
        ...(props.level === 'make' ? [{ key: 'models', label: trans('catalog.merge.facts.models'), value: i.children.models }] : []),
        ...(props.level === 'make' || props.level === 'model' ? [{ key: 'generations', label: trans('catalog.merge.facts.generations'), value: i.children.generations }] : []),
        ...(props.level === 'brand' ? [{ key: 'modifications', label: trans('catalog.merge.facts.modifications'), value: i.entry.modifications ?? 0 }] : []),
        { key: 'aliases', label: trans('catalog.merge.facts.aliases'), value: i.references.aliases },
    ];
});

function submit(): void {
    if (props.entry === null || chosen.value === null) return;
    const length = reason.value.trim().length;
    if (length < 10 || length > 1000) {
        reasonError.value = trans('ui.confirm.reason_length');
        return;
    }
    reasonError.value = null;
    const url = routeOr('admin.catalog.entries.merge', `/admin/catalog/entries/${props.level}/${props.entry.id}/merge`, { level: props.level, id: props.entry.id });
    write.run('post', url, { target_id: chosen.value.id, reason: reason.value.trim() }, { sensitive: true, onSuccess: () => (open.value = false) });
}

const serverError = computed(() => (failed ? trans('ui.state.server_error') : write.error.value));
const formId = `${props.testId}-form`;
</script>

<template>
    <Dialog
        v-model:open="open"
        :title="trans('catalog.merge.title', { name: entry?.name ?? '' })"
        :description="trans(`catalog.merge.body.${level}`)"
        size="md"
        :dismissible="!write.processing.value"
        :test-id="testId"
    >
        <form :id="formId" class="flex flex-col gap-16" novalidate @submit.prevent="submit">
            <div v-if="loadState === 'loading'" class="flex flex-col gap-12" aria-busy="true" :data-testid="`${testId}.loading`">
                <div class="flex flex-wrap gap-x-24 gap-y-8">
                    <div v-for="n in 4" :key="n" class="flex flex-col gap-2"><span class="flex h-16 items-center"><Skeleton shape="text" class="w-64" /></span><span class="flex h-20 items-center"><Skeleton shape="text" class="w-24" /></span></div>
                </div>
                <Skeleton shape="text" class="w-120" />
                <Skeleton class="h-40 w-full" />
            </div>
            <StateBlock v-else-if="loadState === 'error'" kind="error" :title="trans('catalog.merge.load_error')" :body="trans('catalog.error_body')" :test-id="`${testId}.load-error`" @retry="load" />
            <template v-else-if="impact">
                <!-- DQ-603: the facts in one row of label/value pairs, no box. -->
                <dl class="flex flex-wrap gap-x-24 gap-y-8" :data-testid="`${testId}.facts`">
                    <div v-for="fact in facts" :key="fact.key" class="flex flex-col gap-2">
                        <dt class="text-caption text-ink-3">{{ fact.label }}</dt>
                        <dd class="text-label-s text-ink tabular-nums">{{ formatNumber(fact.value) }}</dd>
                    </div>
                </dl>
                <p v-if="impact.candidates.length === 0" class="text-supporting text-ink-2" :data-testid="`${testId}.no-candidates`">{{ trans(`catalog.merge.no_candidates.${level}`) }}</p>
                <Field v-else :label="trans('catalog.merge.survivor')" :hint="trans('catalog.merge.survivor_hint')" required>
                    <Combobox v-model="target" :options="options" :placeholder="trans('catalog.merge.survivor_placeholder')" :data-testid="`${testId}.survivor`" />
                </Field>
                <p v-if="chosen" class="rounded-sm border border-line px-12 py-8 text-supporting text-ink-2" :data-testid="`${testId}.outcome`">
                    {{
                        transChoice(level === 'brand' ? 'catalog.merge.outcome_brand' : 'catalog.merge.outcome', moving, {
                            count: formatNumber(moving),
                            survivor: chosen.name,
                            after: formatNumber(chosen.vehicles + moving),
                            slug: impact.entry.slug,
                        })
                    }}
                </p>
                <ApprovalNotice v-if="fourEyes" :test-id="`${testId}.four-eyes`" />
                <Field :label="trans('ui.confirm.reason')" :hint="trans('ui.confirm.reason_hint')" :error="reasonError ?? write.errors.value.reason ?? null" required>
                    <Textarea v-model="reason" :rows="3" :maxlength="1000" show-count :data-testid="`${testId}.reason`" />
                </Field>
            </template>
        </form>
        <template #footer>
            <DialogError :message="serverError" />
            <Button variant="ghost" :disabled="write.processing.value" data-dialog-cancel @click="open = false">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" :form="formId" variant="danger" :disabled="chosen === null" :loading="write.processing.value" :data-testid="`${testId}.confirm`">
                {{ trans(fourEyes ? 'catalog.merge.request' : 'catalog.merge.confirm') }}
            </Button>
        </template>
    </Dialog>
</template>
