<script setup lang="ts">
import { PhEyes } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { Checkbox } from '../../../Components/ui';
import { roleDescription, roleLabel, type RoleOption } from '../shared';

/**
 * The role checkboxes of the invite drawer (ADM-39) and the roles drawer (ADM-40): name, description, and the four-eyes mark on roles
 * that carry Admin/Owner or a sensitive atom. `disabled` names roles the viewer cannot give (Owner for a non-Owner).
 */
const model = defineModel<string[]>({ default: () => [] });
const props = withDefaults(defineProps<{ options: RoleOption[]; disabled?: string[]; legend: string; hint?: string; testId: string }>(), { disabled: () => [], hint: undefined });

function toggle(name: string, on: boolean | 'indeterminate'): void {
    model.value = on === true ? [...new Set([...model.value, name])].sort() : model.value.filter((role) => role !== name);
}
const isDisabled = (name: string) => props.disabled.includes(name);
</script>

<template>
    <fieldset class="flex flex-col gap-8" :data-testid="testId">
        <legend class="mb-4 text-label-s text-ink">{{ legend }}</legend>
        <p v-if="hint" class="text-helper text-ink-3">{{ hint }}</p>
        <ul class="flex flex-col rounded-sm border border-line-subtle">
            <li v-for="option in options" :key="option.name" class="flex flex-col gap-2 border-b border-line-subtle px-12 py-4 last:border-b-0">
                <div class="flex items-center justify-between gap-8">
                    <Checkbox
                        :model-value="model.includes(option.name)"
                        :label="roleLabel(option.name)"
                        :disabled="isDisabled(option.name)"
                        :data-testid="`${testId}.${option.name}`"
                        @update:model-value="(on: boolean | 'indeterminate') => toggle(option.name, on)"
                    />
                    <span v-if="option.sensitive" class="inline-flex shrink-0 items-center gap-4 text-caption text-ink-3">
                        <PhEyes :size="16" aria-hidden="true" />{{ trans('team.four_eyes') }}
                    </span>
                </div>
                <p v-if="roleDescription(option.name, option.description)" class="pb-4 pl-24 text-helper text-ink-3">{{ roleDescription(option.name, option.description) }}</p>
            </li>
        </ul>
    </fieldset>
</template>
