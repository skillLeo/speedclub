<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
import { useField } from './field';
import { focusRing } from './styles';

defineOptions({ name: 'UiSwitch' });

const model = defineModel<boolean>({ default: false });
const props = withDefaults(defineProps<{ id?: string; label?: string; ariaLabel?: string; disabled?: boolean }>(), {
    id: undefined,
    label: undefined,
    ariaLabel: undefined,
    disabled: false,
});
const field = useField(props);
</script>

<template>
    <label class="inline-flex min-h-32 min-w-32 cursor-pointer items-center gap-8 text-supporting text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-3">
        <SwitchRoot
            :id="field.id.value"
            v-model="model"
            :disabled="disabled"
            :aria-label="label ? undefined : ariaLabel"
            :aria-describedby="field.describedBy.value"
            :class="[
                focusRing,
                'relative inline-flex h-20 w-32 shrink-0 items-center rounded-full border border-line-control bg-raised transition-colors duration-150 ease-standard',
                'data-[state=checked]:border-inverse data-[state=checked]:bg-inverse disabled:opacity-50',
            ]"
        >
            <SwitchThumb
                class="block size-16 translate-x-2 rounded-full bg-ink-3 transition-transform duration-150 ease-standard data-[state=checked]:translate-x-12 data-[state=checked]:bg-canvas"
            />
        </SwitchRoot>
        <span v-if="label">{{ label }}</span>
    </label>
</template>
