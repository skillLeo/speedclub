<script setup lang="ts">
import { computed, useId } from 'vue';
import { trans } from 'laravel-vue-i18n';
import { provideField } from './field';

defineOptions({ name: 'UiField' });

/** Label, control (default slot), hint and error. The control inside takes id, aria-describedby and aria-invalid from here. */
const props = withDefaults(
    defineProps<{ label: string; id?: string; hint?: string; error?: string | null; required?: boolean; optional?: boolean; hideLabel?: boolean }>(),
    { id: undefined, hint: undefined, error: null, required: false, optional: false, hideLabel: false },
);

const generated = useId();
const id = computed(() => props.id ?? `field-${generated}`);
const describedBy = computed(() => {
    const ids = [props.hint ? `${id.value}-hint` : null, props.error ? `${id.value}-error` : null].filter((v): v is string => v !== null);
    return ids.length > 0 ? ids.join(' ') : undefined;
});

provideField({
    id,
    describedBy,
    invalid: computed(() => Boolean(props.error)),
    required: computed(() => props.required),
});
</script>

<template>
    <div class="flex flex-col gap-4">
        <label :for="id" class="flex items-baseline gap-4 text-admin-base-strong text-ink" :class="hideLabel ? 'sr-only' : ''">
            {{ label }}
            <span v-if="optional" class="text-admin-base text-ink-3">{{ trans('ui.field.optional') }}</span>
        </label>
        <slot :id="id" :described-by="describedBy" :invalid="Boolean(error)" />
        <p v-if="hint && !error" :id="`${id}-hint`" class="text-admin-base text-ink-3">{{ hint }}</p>
        <p v-if="error" :id="`${id}-error`" class="text-admin-base text-danger" role="alert">{{ error }}</p>
    </div>
</template>
