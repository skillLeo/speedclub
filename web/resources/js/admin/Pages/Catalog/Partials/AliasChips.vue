<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { Button, Field, Input } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';

/**
 * ADM-16 aliases as chips (other spellings members type: "Akrapovic", "Akra"): Enter or the plus adds one, the x on a chip removes it.
 * At most 20, each at most 120 characters, no duplicates regardless of case (EntryRules).
 */
const model = defineModel<string[]>({ required: true });
const props = defineProps<{ error?: string | null; testId: string }>();

const MAX = 20;
const draft = ref('');
const local = ref<string | null>(null);
const full = computed(() => model.value.length >= MAX);

function add(): void {
    const value = draft.value.trim();
    if (value === '') return;
    if (model.value.some((alias) => alias.toLocaleLowerCase('de') === value.toLocaleLowerCase('de'))) {
        local.value = trans('catalog.aliases.duplicate', { alias: value });
        return;
    }
    if (full.value) {
        local.value = trans('catalog.aliases.full', { max: String(MAX) });
        return;
    }
    model.value = [...model.value, value];
    draft.value = '';
    local.value = null;
}

function remove(alias: string): void {
    model.value = model.value.filter((a) => a !== alias);
}
</script>

<template>
    <div class="flex flex-col gap-8" :data-testid="testId">
        <Field :label="trans('catalog.aliases.label')" :hint="trans('catalog.aliases.hint')" :error="local ?? props.error ?? null" optional>
            <span class="flex items-center gap-8">
                <Input v-model="draft" maxlength="120" autocomplete="off" :disabled="full" @keydown.enter.prevent="add" />
                <Button variant="secondary" :icon="PhPlus" :disabled="draft.trim() === '' || full" class="shrink-0" @click="add">{{ trans('catalog.aliases.add_short') }}</Button>
            </span>
        </Field>
        <ul v-if="model.length > 0" class="flex flex-wrap gap-8" :aria-label="trans('catalog.aliases.list')">
            <li v-for="alias in model" :key="alias" class="inline-flex h-32 items-center gap-2 rounded-xs border border-line pl-8 text-admin-base text-ink">
                <span class="sc-key">{{ alias }}</span>
                <button type="button" :class="[focusRing, 'inline-flex size-32 items-center justify-center rounded-xs text-ink-3 hover:text-ink']" :aria-label="trans('catalog.aliases.remove', { alias })" @click="remove(alias)">
                    <PhX :size="16" aria-hidden="true" />
                </button>
            </li>
        </ul>
    </div>
</template>
