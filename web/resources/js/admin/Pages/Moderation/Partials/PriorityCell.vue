<script setup lang="ts">
import { Tooltip } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatNumber } from '../../../lib/format';
import { priorityTooltip, type PriorityParts } from '../shared';

/** The ADM-20 priority: the sum, right-aligned tnum, with its parts in the tooltip and for screen readers (never a black box). */
const props = defineProps<{ priority: PriorityParts; testId?: string }>();
</script>

<template>
    <Tooltip :content="priorityTooltip(props.priority)">
        <span :class="[focusRing, 'flex h-32 min-w-32 items-center justify-end rounded-xs text-ink tabular-nums']" tabindex="0" :data-testid="testId">
            <span aria-hidden="true">{{ formatNumber(props.priority.total) }}</span>
            <span class="sr-only">{{ priorityTooltip(props.priority) }}</span>
        </span>
    </Tooltip>
</template>
