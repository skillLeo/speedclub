<script setup lang="ts">
import { trans } from 'laravel-vue-i18n';
import { nextTick, ref, watch } from 'vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';

/**
 * The server's answer to a catalogue form that was not saved (a refusal in words, or a failure), at the top of the drawer, scrolled into
 * view when it appears, so a long sheet never hides it. Field errors stay at their fields.
 */
const props = defineProps<{ message: string | null; testId?: string }>();
const root = ref<HTMLElement | null>(null);
watch(
    () => props.message,
    (value) => {
        if (value) void nextTick(() => root.value?.scrollIntoView({ block: 'nearest' }));
    },
);
</script>

<template>
    <div v-if="message" ref="root" role="alert">
        <StateBlock kind="error" :retryable="false" :title="trans('catalog.errors.not_saved')" :body="message" :test-id="testId" />
    </div>
</template>
