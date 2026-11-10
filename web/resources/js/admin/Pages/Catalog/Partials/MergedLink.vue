<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { focusRing } from '../../../Components/ui/styles';

/** "in Mercedes-Benz" next to the Zusammengeführt pill, linked to the survivor's record (DQ-608). */
defineProps<{ name: string; href: string }>();
</script>

<template>
    <span class="whitespace-nowrap text-caption text-ink-3">
        {{ trans('catalog.status.merged_in') }}
        <Link :href="href" :class="[focusRing, 'rounded-xs text-ink-2 underline hover:text-ink']">{{ name }}</Link>
    </span>
</template>
