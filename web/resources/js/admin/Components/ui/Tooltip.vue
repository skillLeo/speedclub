<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

defineOptions({ name: 'UiTooltip' });

/** Needs the TooltipProvider of the shell (AdminLayout/AuthLayout). The trigger slot must be one focusable element. */
withDefaults(defineProps<{ content: string; side?: 'top' | 'right' | 'bottom' | 'left'; disabled?: boolean }>(), { side: 'top', disabled: false });
</script>

<template>
    <TooltipRoot :disabled="disabled">
        <TooltipTrigger as-child>
            <slot />
        </TooltipTrigger>
        <TooltipPortal>
            <TooltipContent
                :side="side"
                :side-offset="4"
                class="z-50 max-w-320 rounded-xs bg-inverse px-8 py-4 text-caption text-ink-inverse"
            >
                {{ content }}
                <TooltipArrow class="fill-inverse" :width="8" :height="4" />
            </TooltipContent>
        </TooltipPortal>
    </TooltipRoot>
</template>
