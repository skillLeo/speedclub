<script setup lang="ts" generic="T extends string">
import { PhCaretDown, PhCheck } from '@phosphor-icons/vue';
import { SelectContent, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui';
import { computed } from 'vue';
import { useField } from './field';
import type { SelectOption } from './types';
import { controlBase, controlSize, floating, focusRing, menuItem, type ControlSize } from './styles';

defineOptions({ name: 'UiSelect' });

const model = defineModel<T | undefined>();
const props = withDefaults(
    defineProps<{ options: SelectOption<T>[]; placeholder?: string; id?: string; size?: ControlSize; invalid?: boolean; disabled?: boolean; ariaLabel?: string }>(),
    { placeholder: undefined, id: undefined, size: 'md', invalid: false, disabled: false, ariaLabel: undefined },
);

const field = useField(props);
const triggerClass = computed(() => [controlBase, controlSize[props.size], focusRing, 'flex items-center justify-between gap-8 border-line-control text-left data-[placeholder]:text-ink-3']);
// The shown value truncates in a narrow trigger: its title keeps the whole label available (ADR-212, 640 px columns).
const shownLabel = computed(() => props.options.find((option) => option.value === model.value)?.label ?? props.placeholder);
</script>

<template>
    <SelectRoot v-model="model" :disabled="disabled">
        <SelectTrigger
            :id="field.id.value"
            :class="triggerClass"
            :aria-label="ariaLabel"
            :aria-invalid="field.invalid.value ? 'true' : undefined"
            :aria-describedby="field.describedBy.value"
        >
            <SelectValue :placeholder="placeholder" :title="shownLabel" class="truncate" />
            <SelectIcon class="text-ink-3"><PhCaretDown :size="16" aria-hidden="true" /></SelectIcon>
        </SelectTrigger>
        <SelectPortal>
            <SelectContent position="popper" :side-offset="4" :class="[floating, 'max-h-320 sc-match-trigger']">
                <SelectViewport>
                    <SelectItem v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled" :class="menuItem">
                        <SelectItemText class="flex-1 truncate">{{ option.label }}</SelectItemText>
                        <SelectItemIndicator><PhCheck :size="16" aria-hidden="true" /></SelectItemIndicator>
                    </SelectItem>
                </SelectViewport>
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
