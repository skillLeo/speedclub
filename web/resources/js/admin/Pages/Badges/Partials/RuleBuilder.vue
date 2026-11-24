<script setup lang="ts">
import { PhUsers } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Field, Input, Select, type SelectOption } from '../../../Components/ui';
import { isCancelled, JsonError, requestJson } from '../../../lib/http';
import { metricLabel, previewQuery, previewText, previewUrl, type BadgeRule, type DexSetInfo, type MetricInfo } from '../shared';

/**
 * ADM-63 rule form (m5.9d contract §2): a whitelisted metric, its condition ("mindestens N" for counting metrics, "ist erfüllt" for yes/no
 * ones) and, for set_completed, the Dex set. Never a raw JSON box. Each change asks the server how many members the rule would reach
 * today (PreviewBadgeRule, debounced); an invalid rule shows the server's message there and under the field.
 */
const rule = defineModel<BadgeRule>({ required: true });
const props = withDefaults(defineProps<{ metrics: MetricInfo[]; sets: DexSetInfo[]; disabled?: boolean; error?: string | null }>(), { disabled: false, error: null });
const emit = defineEmits<{ counted: [count: number | null] }>();

const info = computed(() => props.metrics.find((m) => m.key === rule.value.metric) ?? null);
const metricOptions = computed<SelectOption[]>(() => props.metrics.map((m) => ({ value: m.key, label: metricLabel(m.key) })));
const setOptions = computed<SelectOption[]>(() => props.sets.map((s) => ({ value: s.key, label: s.name })));

const metric = computed({
    get: () => rule.value.metric,
    set: (key: string) => {
        const next = props.metrics.find((m) => m.key === key);
        if (next === undefined) return;
        // A new metric starts with its own condition: "mindestens" keeps the number, a yes/no one holds, a set waits for the set.
        const value = rule.value.gte ?? 1;
        rule.value = next.boolean ? { metric: key, eq: true, ...(next.parameter === 'set' ? { set: props.sets[0]?.key ?? '' } : {}) } : { metric: key, gte: value };
    },
});
const gte = computed({
    get: () => (rule.value.gte === undefined ? '' : String(rule.value.gte)),
    set: (text: string) => {
        const value = Number.parseInt(text, 10);
        rule.value = { ...rule.value, gte: Number.isNaN(value) ? 0 : value };
    },
});
const set = computed({
    get: () => rule.value.set,
    set: (key: string | undefined) => (rule.value = { ...rule.value, set: key ?? '' }),
});

// ---- preview ("würde heute N Mitglieder erhalten") ---------------------------------------------------------------------------------
const count = ref<number | null>(null);
const counting = ref(false);
const previewError = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;

function preview(): void {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    counting.value = true;
    previewError.value = null;
    requestJson<{ data: { count: number } }>('get', previewUrl(), previewQuery(rule.value), mine.signal)
        .then((answer) => {
            if (controller !== mine) return;
            count.value = answer.data.count;
            emit('counted', answer.data.count);
        })
        .catch((error: unknown) => {
            if (controller !== mine || isCancelled(error)) return;
            count.value = null;
            emit('counted', null);
            previewError.value = error instanceof JsonError && error.status === 422 ? (error.field('rule_json') ?? error.field('metric') ?? trans('gift.badges.rule.preview_failed')) : trans('gift.badges.rule.preview_failed');
        })
        .finally(() => {
            if (controller === mine) counting.value = false;
        });
}
watch(
    () => JSON.stringify(rule.value),
    () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(preview, 400);
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
});
</script>

<template>
    <div class="flex flex-col gap-12" data-testid="ADM-63.rule">
        <div class="flex flex-wrap items-end gap-12">
            <div class="w-320">
                <Field :label="trans('gift.badges.rule.metric')" :error="error" required>
                    <Select v-model="metric" :options="metricOptions" :disabled="disabled" data-testid="ADM-63.rule.metric" />
                </Field>
            </div>
            <template v-if="info && !info.boolean">
                <p class="flex min-h-40 items-center text-admin-base text-ink-2">{{ trans('gift.badges.rule.gte') }}</p>
                <div class="w-120">
                    <Field :label="trans('gift.badges.rule.value')" required>
                        <Input v-model="gte" type="number" min="1" max="1000000" step="1" inputmode="numeric" tnum :disabled="disabled" data-testid="ADM-63.rule.value" />
                    </Field>
                </div>
            </template>
            <template v-else-if="info">
                <div v-if="info.parameter === 'set'" class="w-240">
                    <Field :label="trans('gift.badges.rule.set')" required>
                        <Select v-model="set" :options="setOptions" :placeholder="trans('gift.badges.rule.set_placeholder')" :disabled="disabled" data-testid="ADM-63.rule.set" />
                    </Field>
                </div>
                <p class="flex min-h-40 items-center text-admin-base text-ink-2">{{ trans('gift.badges.rule.eq') }}</p>
            </template>
        </div>

        <p class="flex items-center gap-8 text-admin-base tabular-nums" role="status" aria-live="polite" data-testid="ADM-63.rule.preview">
            <PhUsers :size="16" class="shrink-0 text-ink-3" aria-hidden="true" />
            <span v-if="counting" class="text-ink-3">{{ trans('gift.badges.rule.preview_loading') }}</span>
            <span v-else-if="previewError" class="text-danger">{{ previewError }}</span>
            <span v-else-if="count !== null" class="text-ink">{{ previewText(count) }}</span>
        </p>
        <p class="max-w-720 text-caption text-ink-3">{{ trans('gift.badges.rule.preview_hint') }}</p>
    </div>
</template>
