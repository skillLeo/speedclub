<script setup lang="ts">
import { PhCaretDown, PhCheck } from '@phosphor-icons/vue';
import { ComboboxAnchor, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxPortal, ComboboxRoot, ComboboxViewport } from 'reka-ui';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { useField } from './field';
import { controlSize, floating, menuItem, type ControlSize } from './styles';
import type { SelectOption } from './types';

defineOptions({ name: 'UiCombobox' });

/**
 * Searchable single select. Filters the given options locally; for server search pass `filter: false` and listen to `search`.
 * The list opens on click, typing or ArrowDown; the caret is decoration inside the field, so there is one control, not two
 * overlapping ones.
 */
const model = defineModel<string | undefined>();
const props = withDefaults(
    defineProps<{ options: SelectOption[]; placeholder?: string; id?: string; size?: ControlSize; invalid?: boolean; disabled?: boolean; filter?: boolean; ariaLabel?: string }>(),
    { placeholder: undefined, id: undefined, size: 'md', invalid: false, disabled: false, filter: true, ariaLabel: undefined },
);
const emit = defineEmits<{ search: [term: string] }>();

const field = useField(props);
const term = ref('');
const visible = computed(() => {
    if (!props.filter || term.value === '') return props.options;
    const needle = term.value.toLocaleLowerCase();
    return props.options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
});
const labelOf = (value: unknown): string => props.options.find((option) => option.value === value)?.label ?? '';

function onInput(value: string): void {
    term.value = value;
    emit('search', value);
}
</script>

<template>
    <ComboboxRoot v-model="model" :disabled="disabled" :ignore-filter="true" :open-on-click="true">
        <ComboboxAnchor
            :class="[
                controlSize[size],
                'flex w-full items-center gap-8 rounded-sm border border-line-control bg-raised text-ink transition-colors duration-effect-fast ease-effect-fast hover:border-line-strong',
                'focus-within:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus has-[[aria-invalid=true]]:border-danger has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-disabled',
            ]"
        >
            <ComboboxInput
                :id="field.id.value"
                :display-value="labelOf"
                :placeholder="placeholder"
                :aria-label="ariaLabel"
                :aria-invalid="field.invalid.value ? 'true' : undefined"
                :aria-describedby="field.describedBy.value"
                class="h-full min-w-0 flex-1 bg-transparent text-admin-base text-ink placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed"
                @update:model-value="onInput"
            />
            <PhCaretDown :size="16" class="pointer-events-none shrink-0 text-ink-3" aria-hidden="true" />
        </ComboboxAnchor>
        <ComboboxPortal>
            <ComboboxContent position="popper" :side-offset="4" :class="[floating, 'max-h-320 sc-match-trigger']">
                <ComboboxViewport>
                    <ComboboxEmpty class="px-8 py-8 text-admin-base text-ink-3">{{ trans('ui.combobox.empty') }}</ComboboxEmpty>
                    <ComboboxItem v-for="option in visible" :key="option.value" :value="option.value" :disabled="option.disabled" :class="menuItem">
                        <span class="flex-1 truncate">{{ option.label }}</span>
                        <ComboboxItemIndicator><PhCheck :size="16" aria-hidden="true" /></ComboboxItemIndicator>
                    </ComboboxItem>
                </ComboboxViewport>
            </ComboboxContent>
        </ComboboxPortal>
    </ComboboxRoot>
</template>
