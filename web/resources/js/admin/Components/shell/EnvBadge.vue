<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import Badge, { type Tone } from '../ui/Badge.vue';

/** LOCAL / STAGING / PROD in status colours (03 §14), so nobody mistakes production for a test system. */
const page = usePage();
const env = computed(() => {
    const value = page.props.app.env;
    if (value === 'production') return { key: 'prod', tone: 'danger' as Tone };
    if (value === 'staging') return { key: 'staging', tone: 'warning' as Tone };
    return { key: 'local', tone: 'info' as Tone };
});
</script>

<template>
    <Badge :tone="env.tone" :title="trans(`shell.env.${env.key}_title`)" data-testid="shell.env">{{ trans(`shell.env.${env.key}`) }}</Badge>
</template>
