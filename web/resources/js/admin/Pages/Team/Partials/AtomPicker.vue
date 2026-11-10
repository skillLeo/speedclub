<script setup lang="ts">
import { PhEyes } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import { Checkbox } from '../../../Components/ui';
import { atomGroupLabel, atomLabel, groupAtoms } from '../shared';

/** The atoms of a role, grouped (ADM-41 role drawer). Sensitive atoms carry the four-eyes mark. */
const model = defineModel<string[]>({ default: () => [] });
const props = defineProps<{ atoms: string[]; sensitive: string[]; legend: string; testId: string }>();
const groups = computed(() => groupAtoms(props.atoms));

function toggle(atom: string, on: boolean | 'indeterminate'): void {
    model.value = on === true ? [...new Set([...model.value, atom])].sort() : model.value.filter((a) => a !== atom);
}
</script>

<template>
    <fieldset class="flex flex-col gap-12" :data-testid="testId">
        <legend class="mb-4 text-label-s text-ink">{{ legend }}</legend>
        <div v-for="group in groups" :key="group.group" class="flex flex-col gap-2">
            <p class="text-caption text-ink-3">{{ atomGroupLabel(group.group) }}</p>
            <div class="grid grid-cols-1 gap-x-16 tablet:grid-cols-2">
                <span v-for="atom in group.atoms" :key="atom" class="flex min-w-0 items-center justify-between gap-8">
                    <Checkbox :model-value="model.includes(atom)" :label="atomLabel(atom)" :data-testid="`${testId}.${atom}`" @update:model-value="(on: boolean | 'indeterminate') => toggle(atom, on)" />
                    <PhEyes v-if="sensitive.includes(atom)" :size="16" class="shrink-0 text-ink-3" :aria-label="trans('team.matrix.sensitive')" role="img" />
                </span>
            </div>
        </div>
    </fieldset>
</template>
