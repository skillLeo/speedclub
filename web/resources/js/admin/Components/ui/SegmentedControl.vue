<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui';
import { focusRing } from './styles';

defineOptions({ name: 'UiSegmentedControl' });

export interface SegmentOption {
    value: string;
    label: string;
}

/**
 * One choice out of a few short, equal options that switch a view (a chart's range, DQ-547): the raised track with the selected
 * segment on the overlay surface (03 §3). Always one value; choosing the selected one again keeps it.
 * Sizes: `sm` / `md` are the segment heights (32 / 40, the track adds 4). In a row of form fields the whole track takes the row's
 * control height (DQ-591): `field-sm` 32 (filter rows, next to `size="sm"` inputs), `field-md` 40 (forms).
 */
const model = defineModel<string>({ required: true });
withDefaults(defineProps<{ options: SegmentOption[]; label: string; size?: 'sm' | 'md' | 'field-sm' | 'field-md'; disabled?: boolean }>(), { size: 'sm', disabled: false });
const segments = { sm: 'h-32 px-12', md: 'h-40 px-16' } as const;
// Field sizes: the track has no padding and each segment is the full control height (a 32 px target at least, ADR-212); the visible
// pill is an inner span inset by 2, so it looks like the padded track.
const fieldHeights = { 'field-sm': 'h-32', 'field-md': 'h-40' } as const;
const fieldPills = { 'field-sm': 'h-28 px-12', 'field-md': 'h-36 px-16' } as const;
const isField = (size: string): size is keyof typeof fieldHeights => size in fieldHeights;

function choose(value: unknown): void {
    if (typeof value === 'string' && value !== '') model.value = value;
}
</script>

<template>
    <ToggleGroupRoot
        type="single"
        :model-value="model"
        :aria-label="label"
        :disabled="disabled"
        :class="['inline-flex items-center gap-2 rounded-sm bg-raised', isField(size) ? 'px-2' : 'p-2']"
        @update:model-value="choose"
    >
        <template v-if="isField(size)">
            <ToggleGroupItem
                v-for="option in options"
                :key="option.value"
                :value="option.value"
                :class="[
                    focusRing,
                    fieldHeights[size],
                    'group inline-flex items-center justify-center whitespace-nowrap rounded-xs text-admin-base-strong text-ink-2 transition-colors duration-effect-fast ease-effect-fast hover:text-ink data-[state=on]:text-ink data-[disabled]:text-ink-disabled',
                ]"
                :data-testid="`segment.${option.value}`"
            >
                <span :class="[fieldPills[size], 'inline-flex items-center rounded-xs group-data-[state=on]:bg-overlay group-data-[state=on]:shadow-e1']">{{ option.label }}</span>
            </ToggleGroupItem>
        </template>
        <template v-else>
            <ToggleGroupItem
                v-for="option in options"
                :key="option.value"
                :value="option.value"
                :class="[
                    focusRing,
                    segments[size],
                    'inline-flex items-center justify-center whitespace-nowrap rounded-xs text-admin-base-strong text-ink-2 transition-colors duration-effect-fast ease-effect-fast hover:text-ink data-[state=on]:bg-overlay data-[state=on]:text-ink data-[state=on]:shadow-e1 data-[disabled]:text-ink-disabled',
                ]"
                :data-testid="`segment.${option.value}`"
            >
                {{ option.label }}
            </ToggleGroupItem>
        </template>
    </ToggleGroupRoot>
</template>
