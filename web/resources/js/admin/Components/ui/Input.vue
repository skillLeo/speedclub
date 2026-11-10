<script setup lang="ts">
import { computed, ref, useSlots } from 'vue';
import { useField } from './field';
import { controlBase, controlSize, type ControlSize } from './styles';

defineOptions({ name: 'UiInput', inheritAttrs: false });

const model = defineModel<string>({ default: '' });
const props = withDefaults(defineProps<{ id?: string; type?: string; size?: ControlSize; invalid?: boolean; disabled?: boolean; tnum?: boolean }>(), {
    id: undefined,
    type: 'text',
    size: 'md',
    invalid: false,
    disabled: false,
    tnum: false,
});

const field = useField(props);
const slots = useSlots();
const input = ref<HTMLInputElement | null>(null);

defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select() });

const classes = computed(() => [
    controlBase,
    controlSize[props.size],
    'border-line-control',
    slots.leading ? (props.size === 'sm' ? 'pl-32' : 'pl-40') : '',
    slots.trailing ? (props.size === 'sm' ? 'pr-32' : 'pr-40') : '',
    props.tnum ? 'tabular-nums' : '',
]);
</script>

<template>
    <div class="relative w-full">
        <span v-if="$slots.leading" class="pointer-events-none absolute inset-y-0 left-0 flex items-center text-ink-3" :class="size === 'sm' ? 'pl-8' : 'pl-12'">
            <slot name="leading" />
        </span>
        <input
            :id="field.id.value"
            ref="input"
            v-model="model"
            v-bind="$attrs"
            :type="type"
            :disabled="disabled"
            :required="field.required.value || undefined"
            :aria-invalid="field.invalid.value ? 'true' : undefined"
            :aria-describedby="field.describedBy.value"
            :class="classes"
        />
        <span v-if="$slots.trailing" class="absolute inset-y-0 right-0 flex items-center" :class="size === 'sm' ? 'pr-4' : 'pr-4'">
            <slot name="trailing" />
        </span>
    </div>
</template>
