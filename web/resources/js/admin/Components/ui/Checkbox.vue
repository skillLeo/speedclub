<script setup lang="ts">
import { PhCheck, PhMinus } from '@phosphor-icons/vue';
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui';
import { useField } from './field';
import { focusRing } from './styles';

defineOptions({ name: 'UiCheckbox' });

/**
 * 16 px box; the wrapping <label> is the hit area: at least 32 px high, and 32 px wide without visible text (ADR-212: 32 standalone,
 * it also fits a 40 px table row). Without `label`, pass `ariaLabel`.
 */
const model = defineModel<boolean | 'indeterminate'>({ default: false });
const props = withDefaults(defineProps<{ id?: string; label?: string; ariaLabel?: string; disabled?: boolean; invalid?: boolean }>(), {
    id: undefined,
    label: undefined,
    ariaLabel: undefined,
    disabled: false,
    invalid: false,
});
const field = useField(props);
</script>

<template>
    <label
        class="inline-flex min-h-32 cursor-pointer items-center gap-8 text-admin-base text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-3"
        :class="label ? '' : 'min-w-32 justify-center'"
    >
        <CheckboxRoot
            :id="field.id.value"
            v-model="model"
            :disabled="disabled"
            :aria-label="label ? undefined : ariaLabel"
            :aria-describedby="field.describedBy.value"
            :class="[
                focusRing,
                'relative flex size-16 shrink-0 items-center justify-center rounded-xs border border-line-control bg-raised text-ink-inverse',
                'data-[state=checked]:border-inverse data-[state=checked]:bg-inverse data-[state=indeterminate]:border-inverse data-[state=indeterminate]:bg-inverse',
                'disabled:border-line disabled:bg-raised',
            ]"
        >
            <CheckboxIndicator class="flex items-center justify-center">
                <PhMinus v-if="model === 'indeterminate'" :size="16" weight="bold" aria-hidden="true" />
                <PhCheck v-else :size="16" weight="bold" aria-hidden="true" />
            </CheckboxIndicator>
        </CheckboxRoot>
        <span v-if="label">{{ label }}</span>
    </label>
</template>
