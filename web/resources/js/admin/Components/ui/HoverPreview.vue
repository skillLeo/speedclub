<script setup lang="ts">
import { HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui';
import { floating } from './styles';

defineOptions({ name: 'UiHoverPreview' });

/**
 * The row hover preview of 09 §10.2: a quiet card beside a list's key cell after a short rest of the pointer (or keyboard focus on the
 * trigger), so staff can tell rows apart without opening each record. Supplementary only: everything in it is on the record page.
 * The trigger slot must be one focusable element (the row's link). No motion beyond the effect tokens' fade.
 */
withDefaults(
    defineProps<{
        disabled?: boolean;
        side?: 'right' | 'bottom';
        testId?: string;
    }>(),
    { disabled: false, side: 'right', testId: undefined },
);
</script>

<template>
    <slot v-if="disabled" />
    <HoverCardRoot v-else :open-delay="400" :close-delay="100">
        <HoverCardTrigger as-child>
            <slot />
        </HoverCardTrigger>
        <HoverCardPortal>
            <HoverCardContent :side="side" :side-offset="8" align="start" :collision-padding="16" :class="[floating, 'w-320 px-12 py-12']" :data-testid="testId">
                <slot name="preview" />
            </HoverCardContent>
        </HoverCardPortal>
    </HoverCardRoot>
</template>
