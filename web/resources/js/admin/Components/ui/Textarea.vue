<script setup lang="ts">
import { computed } from 'vue';
import { trans } from 'laravel-vue-i18n';
import { useField } from './field';
import { controlBase } from './styles';
import { formatNumber } from '../../lib/format';

defineOptions({ name: 'UiTextarea', inheritAttrs: false });

const model = defineModel<string>({ default: '' });
const props = withDefaults(defineProps<{ id?: string; rows?: number; invalid?: boolean; disabled?: boolean; maxlength?: number; showCount?: boolean }>(), {
    id: undefined,
    rows: 4,
    invalid: false,
    disabled: false,
    maxlength: undefined,
    showCount: false,
});

const field = useField(props);
const count = computed(() => model.value.length);
</script>

<template>
    <div class="flex flex-col gap-4">
        <textarea
            :id="field.id.value"
            v-model="model"
            v-bind="$attrs"
            :rows="rows"
            :maxlength="maxlength"
            :disabled="disabled"
            :required="field.required.value || undefined"
            :aria-invalid="field.invalid.value ? 'true' : undefined"
            :aria-describedby="field.describedBy.value"
            :class="[controlBase, 'min-h-80 resize-y border-line-control px-12 py-8 text-admin-base']"
        />
        <p v-if="showCount && maxlength" class="self-end text-caption text-ink-3 tabular-nums" aria-live="polite">
            {{ trans('ui.field.count', { count: formatNumber(count), max: formatNumber(maxlength) }) }}
        </p>
    </div>
</template>
