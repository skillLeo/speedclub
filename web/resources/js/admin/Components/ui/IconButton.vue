<script setup lang="ts">
import { computed, type Component } from 'vue';
import Spinner from './Spinner.vue';
import Tooltip from './Tooltip.vue';
import { focusRing } from './styles';

defineOptions({ name: 'UiIconButton', inheritAttrs: false });

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
const props = withDefaults(
    defineProps<{
        icon: Component;
        label: string;
        size?: 'xs' | 'sm' | 'md';
        variant?: 'ghost' | 'secondary' | 'danger' | 'destructive';
        type?: 'button' | 'submit';
        disabled?: boolean;
        loading?: boolean;
        pressed?: boolean;
        tooltip?: boolean;
    }>(),
    { size: 'sm', variant: 'ghost', type: 'button', disabled: false, loading: false, pressed: undefined, tooltip: true },
);

const sizes = { xs: 'size-24', sm: 'size-32', md: 'size-40' } as const;
const variants = {
    ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed',
    secondary: 'border border-line-control text-ink hover:bg-hover active:bg-pressed',
    danger: 'text-danger hover:bg-hover active:bg-pressed',
    /** Outlined, accent.fg icon: a destructive action next to secondary buttons (DQ-530/531). */
    destructive: 'border border-line-control text-accent hover:bg-hover active:bg-pressed',
} as const;

const classes = computed(() => [
    'inline-flex shrink-0 items-center justify-center rounded-sm transition-colors duration-150 ease-standard',
    focusRing,
    sizes[props.size],
    props.disabled ? 'cursor-not-allowed text-ink-disabled' : variants[props.variant],
    props.pressed === true ? 'bg-selected text-ink' : '',
]);
const iconSize = computed(() => (props.size === 'md' ? 20 : 16));
</script>

<template>
    <Tooltip :content="label" :disabled="!tooltip">
        <button v-bind="$attrs" :type="type" :class="classes" :aria-label="label" :aria-pressed="pressed" :disabled="disabled || loading">
            <Spinner v-if="loading" :size="iconSize" />
            <component :is="icon" v-else :size="iconSize" aria-hidden="true" />
        </button>
    </Tooltip>
</template>
