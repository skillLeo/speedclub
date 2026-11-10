<script setup lang="ts">
import { PhMoon, PhSun } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed } from 'vue';
import IconButton from '../ui/IconButton.vue';
import { theme, toggleTheme } from '../../lib/theme';

const label = computed(() => (theme.value === 'carbon' ? trans('shell.theme.to_light') : trans('shell.theme.to_carbon')));
</script>

<template>
    <IconButton :icon="theme === 'carbon' ? PhSun : PhMoon" :label="label" data-testid="shell.theme" @click="toggleTheme" />
</template>
