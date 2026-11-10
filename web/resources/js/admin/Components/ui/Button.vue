<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { computed, type Component } from 'vue';
import Spinner from './Spinner.vue';
import { focusRing } from './styles';

defineOptions({ name: 'UiButton' });

/**
 * `destructive` = the outlined secondary button with accent.fg text and icon: destructive and high-risk actions in page headers, cards
 * and bulk bars (DQ-530). `danger` (the red fill) is only for the confirm button inside a confirm dialog.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive';
export type ButtonSize = 'sm' | 'md';

const props = withDefaults(
    defineProps<{
        variant?: ButtonVariant;
        size?: ButtonSize;
        type?: 'button' | 'submit' | 'reset';
        disabled?: boolean;
        loading?: boolean;
        /** Renders an Inertia Link (internal) or <a> (external / download). */
        href?: string;
        external?: boolean;
        icon?: Component;
        iconRight?: Component;
        block?: boolean;
    }>(),
    { variant: 'secondary', size: 'md', type: 'button', disabled: false, loading: false, href: undefined, external: false, icon: undefined, iconRight: undefined, block: false },
);

const variants: Record<ButtonVariant, string> = {
    primary: 'bg-inverse text-ink-inverse hover:bg-inverse/90 active:bg-inverse/80',
    secondary: 'border border-line-control text-ink hover:bg-hover active:bg-pressed',
    ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-pressed',
    danger: 'bg-accent-fill text-on-accent hover:bg-accent-fill-pressed active:bg-accent-fill-pressed',
    destructive: 'border border-line-control text-accent hover:bg-hover active:bg-pressed',
};

const sizes: Record<ButtonSize, string> = {
    sm: 'h-32 gap-4 px-12 text-label-s',
    md: 'h-40 gap-8 px-16 text-label-s',
};

const inactive = computed(() => props.disabled || props.loading);

const classes = computed(() => [
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-sm transition-colors duration-150 ease-standard',
    focusRing,
    sizes[props.size],
    inactive.value ? 'cursor-not-allowed border-transparent bg-raised text-ink-disabled' : variants[props.variant],
    props.block ? 'w-full' : '',
]);

const iconSize = computed(() => (props.size === 'sm' ? 16 : 20));
</script>

<template>
    <a v-if="href && (external || inactive)" :href="inactive ? undefined : href" :class="classes" :aria-disabled="inactive || undefined">
        <Spinner v-if="loading" :size="iconSize" />
        <component :is="icon" v-else-if="icon" :size="iconSize" aria-hidden="true" />
        <slot />
        <component :is="iconRight" v-if="iconRight" :size="iconSize" aria-hidden="true" />
    </a>
    <Link v-else-if="href" :href="href" :class="classes">
        <component :is="icon" v-if="icon" :size="iconSize" aria-hidden="true" />
        <slot />
        <component :is="iconRight" v-if="iconRight" :size="iconSize" aria-hidden="true" />
    </Link>
    <button v-else :type="type" :class="classes" :disabled="inactive" :aria-busy="loading || undefined">
        <Spinner v-if="loading" :size="iconSize" />
        <component :is="icon" v-else-if="icon" :size="iconSize" aria-hidden="true" />
        <slot />
        <component :is="iconRight" v-if="iconRight" :size="iconSize" aria-hidden="true" />
    </button>
</template>
