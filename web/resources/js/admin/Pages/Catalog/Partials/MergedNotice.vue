<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { PhArrowsMerge } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { focusRing } from '../../../Components/ui/styles';

/** A merged entry is an alias (ADR-234): it says where its builds went, and links there. */
defineProps<{ name: string; href: string; testId: string }>();
</script>

<template>
    <div class="flex items-start gap-12 rounded-sm border border-line bg-raised px-16 py-12" role="status" :data-testid="testId">
        <PhArrowsMerge :size="20" class="mt-2 shrink-0 text-info" aria-hidden="true" />
        <p class="text-supporting text-ink-2">
            {{ trans('catalog.merged_notice.body') }}
            <Link :href="href" :class="[focusRing, 'rounded-xs text-ink underline']">{{ name }}</Link>
        </p>
    </div>
</template>
