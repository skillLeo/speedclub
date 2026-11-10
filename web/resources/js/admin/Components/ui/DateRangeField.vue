<script setup lang="ts">
import { PhCalendarBlank } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { useField } from './field';
import { dateSeparator } from '../../lib/format';
import { controlSize, type ControlSize } from './styles';

defineOptions({ name: 'UiDateRangeField' });

/**
 * A date range as one token field (DQ-509): "TT.MM.JJJJ – TT.MM.JJJJ" (en: "DD/MM/YYYY", as the tables print dates, DQ-549), typed with
 * the keyboard (the separators come by themselves), no UA
 * date control. The models are ISO days ("2026-06-14") or '' for an open end; an incomplete or impossible date marks the half invalid
 * and keeps the last valid value. Inside a Field the first half takes the Field's id, so the label points at it.
 * `single`: one day only (v-model:from), labelled by its Field.
 */
const from = defineModel<string>('from', { default: '' });
const to = defineModel<string>('to', { default: '' });
const props = withDefaults(defineProps<{ id?: string; size?: ControlSize; invalid?: boolean; disabled?: boolean; testId?: string; single?: boolean }>(), {
    id: undefined,
    single: false,
    size: 'md',
    invalid: false,
    disabled: false,
    testId: undefined,
});

const field = useField(props);

function toDisplay(iso: string): string {
    const sep = dateSeparator();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? `${match[3]}${sep}${match[2]}${sep}${match[1]}` : '';
}

/** Digits only, separators after day and month: "1406" → "14.06" (en "14/06"). */
function mask(text: string): string {
    const sep = dateSeparator();
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}${sep}${digits.slice(2)}`;
    return `${digits.slice(0, 2)}${sep}${digits.slice(2, 4)}${sep}${digits.slice(4)}`;
}

function toIso(text: string): string | null {
    if (text === '') return '';
    const match = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(text);
    if (!match) return null;
    const [, d, m, y] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
    return `${y}-${m}-${d}`;
}

const fromText = ref(toDisplay(from.value));
const toText = ref(toDisplay(to.value));
const fromBad = ref(false);
const toBad = ref(false);

watch(from, (value) => {
    if (toIso(fromText.value) !== value) fromText.value = toDisplay(value);
    fromBad.value = false;
});
watch(to, (value) => {
    if (toIso(toText.value) !== value) toText.value = toDisplay(value);
    toBad.value = false;
});

function onInput(which: 'from' | 'to', event: Event): void {
    const input = event.target as HTMLInputElement;
    const masked = mask(input.value);
    input.value = masked;
    (which === 'from' ? fromText : toText).value = masked;
    const iso = toIso(masked);
    if (iso !== null) {
        if (which === 'from') from.value = iso;
        else to.value = iso;
    }
}

function onBlur(which: 'from' | 'to'): void {
    const iso = toIso(which === 'from' ? fromText.value : toText.value);
    if (which === 'from') fromBad.value = iso === null;
    else toBad.value = iso === null;
}

const reversed = computed(() => from.value !== '' && to.value !== '' && from.value > to.value);
const anyInvalid = computed(() => field.invalid.value || fromBad.value || toBad.value || reversed.value);
// The frame is an inset ring, not a border, so each half is as tall as the control: a full 32/40 target (ADR-212).
const inputClass = computed(() => ['h-full w-full min-w-0 bg-transparent text-supporting text-ink tabular-nums placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed']);
</script>

<template>
    <div
        :class="[
            controlSize[size],
            'flex w-full items-center gap-4 rounded-sm bg-raised ring-1 ring-inset transition-colors duration-150 ease-standard hover:ring-line-strong',
            'focus-within:ring-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-not-allowed',
            anyInvalid ? 'ring-danger' : 'ring-line-control',
        ]"
        role="group"
        :data-testid="testId"
    >
        <PhCalendarBlank :size="16" class="mr-4 shrink-0 text-ink-3" aria-hidden="true" />
        <input
            :id="field.id.value"
            :value="fromText"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            maxlength="10"
            :placeholder="trans('ui.date.placeholder')"
            :aria-label="single ? undefined : trans('ui.date.from')"
            :aria-invalid="fromBad || reversed || field.invalid.value ? 'true' : undefined"
            :aria-describedby="field.describedBy.value"
            :disabled="disabled"
            :class="inputClass"
            :data-testid="testId ? `${testId}.from` : undefined"
            @input="onInput('from', $event)"
            @blur="onBlur('from')"
        />
        <span v-if="!single" class="shrink-0 text-ink-3" aria-hidden="true">–</span>
        <input
            v-if="!single"
            :value="toText"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            maxlength="10"
            :placeholder="trans('ui.date.placeholder')"
            :aria-label="trans('ui.date.to')"
            :aria-invalid="toBad || reversed || field.invalid.value ? 'true' : undefined"
            :aria-describedby="field.describedBy.value"
            :disabled="disabled"
            :class="inputClass"
            :data-testid="testId ? `${testId}.to` : undefined"
            @input="onInput('to', $event)"
            @blur="onBlur('to')"
        />
    </div>
</template>
