<script setup lang="ts">
import { PhClock } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { useField } from './field';
import { controlSize, type ControlSize } from './styles';

defineOptions({ name: 'UiTimeField' });

/**
 * A time of day as one token field, the sibling of DateRangeField (DQ-509, DQ-P5G-35): "HH:MM" in 24 hours in both admin languages
 * (de-DE and en-GB both print 18:42), typed with the keyboard (the colon comes by itself, "930" reads 09:30), no UA time control, so
 * the field never follows the browser language ("10:00 AM"). The model is "HH:MM" or '' for an empty field; an incomplete or
 * impossible time marks the field invalid on blur and keeps the last valid value, as DateRangeField does. Inside a Field it takes the
 * Field's id, so the label points at it.
 */
const model = defineModel<string>({ default: '' });
const props = withDefaults(defineProps<{ id?: string; size?: ControlSize; invalid?: boolean; disabled?: boolean; testId?: string }>(), {
    id: undefined,
    size: 'md',
    invalid: false,
    disabled: false,
    testId: undefined,
});

const field = useField(props);

function toDisplay(value: string): string {
    return /^\d{2}:\d{2}$/.test(value) ? value : '';
}

/** Digits only, the colon after the hour: "1000" → "10:00"; a first digit above 2 is a one-digit hour ("930" → "09:30"). */
function mask(text: string): string {
    let digits = text.replace(/\D/g, '');
    if (digits.length > 0 && Number(digits[0]) > 2) digits = `0${digits}`;
    digits = digits.slice(0, 4);
    return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function toValue(text: string): string | null {
    if (text === '') return '';
    const match = /^(\d{2}):(\d{2})$/.exec(text);
    if (!match) return null;
    return Number(match[1]) <= 23 && Number(match[2]) <= 59 ? text : null;
}

const text = ref(toDisplay(model.value));
const bad = ref(false);

watch(model, (value) => {
    if (toValue(text.value) !== value) text.value = toDisplay(value);
    bad.value = false;
});

function onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const masked = mask(input.value);
    input.value = masked;
    text.value = masked;
    const value = toValue(masked);
    if (value !== null) model.value = value;
}

function onBlur(): void {
    bad.value = toValue(text.value) === null;
}

const anyInvalid = computed(() => field.invalid.value || bad.value);
</script>

<template>
    <div
        :class="[
            controlSize[size],
            'flex w-full items-center gap-4 rounded-sm bg-raised ring-1 ring-inset transition-colors duration-effect-fast ease-effect-fast hover:ring-line-strong',
            'focus-within:ring-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-not-allowed',
            anyInvalid ? 'ring-danger' : 'ring-line-control',
        ]"
        :data-testid="testId"
    >
        <PhClock :size="16" class="mr-4 shrink-0 text-ink-3" aria-hidden="true" />
        <input
            :id="field.id.value"
            :value="text"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            maxlength="5"
            :placeholder="trans('ui.time.placeholder')"
            :required="field.required.value || undefined"
            :aria-invalid="anyInvalid ? 'true' : undefined"
            :aria-describedby="field.describedBy.value"
            :disabled="disabled"
            class="h-full w-full min-w-0 bg-transparent text-admin-base text-ink tabular-nums placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed"
            :data-testid="testId ? `${testId}.input` : undefined"
            @input="onInput"
            @blur="onBlur"
        />
    </div>
</template>
