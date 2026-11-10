<script setup lang="ts">
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import { useId } from 'vue';
import { focusRing } from './styles';

export interface RadioOption {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
}

const model = defineModel<string | undefined>();
withDefaults(defineProps<{ options: RadioOption[]; legend: string; hideLegend?: boolean; orientation?: 'vertical' | 'horizontal'; disabled?: boolean }>(), {
    hideLegend: false,
    orientation: 'vertical',
    disabled: false,
});
const id = useId();
</script>

<template>
    <fieldset class="flex flex-col gap-8">
        <legend class="mb-4 text-label-s text-ink" :class="hideLegend ? 'sr-only' : ''">{{ legend }}</legend>
        <RadioGroupRoot v-model="model" :disabled="disabled" :orientation="orientation" class="flex gap-12" :class="orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap'">
            <label v-for="option in options" :key="option.value" :for="`${id}-${option.value}`" class="flex min-h-32 cursor-pointer gap-8 text-supporting text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-3" :class="option.hint ? 'items-start' : 'items-center'">
                <RadioGroupItem
                    :id="`${id}-${option.value}`"
                    :value="option.value"
                    :disabled="option.disabled"
                    :class="[focusRing, 'relative flex size-16 shrink-0 items-center justify-center rounded-full border border-line-control bg-raised data-[state=checked]:border-inverse', option.hint ? 'mt-2' : '']"
                >
                    <RadioGroupIndicator class="block size-8 rounded-full bg-inverse" />
                </RadioGroupItem>
                <span class="flex flex-col">
                    <span>{{ option.label }}</span>
                    <span v-if="option.hint" class="text-helper text-ink-3">{{ option.hint }}</span>
                </span>
            </label>
        </RadioGroupRoot>
    </fieldset>
</template>
