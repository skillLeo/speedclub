<script setup lang="ts">
import { PhRows } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import IconButton from '../ui/IconButton.vue';
import { density, toggleDensity } from '../../lib/density';

/** Table density (09 §10.2): pressed = Kompakt (32 px rows), released = Komfortabel (40 px). Kept per staff member in this browser. */
</script>

<template>
    <IconButton :icon="PhRows" :label="trans('shell.density.compact')" :pressed="density === 'compact'" data-testid="shell.density" @click="toggleDensity" />
</template>
