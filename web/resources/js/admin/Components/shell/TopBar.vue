<script setup lang="ts">
import { PhList, PhMagnifyingGlass } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import IconButton from '../ui/IconButton.vue';
import Kbd from '../ui/Kbd.vue';
import { focusRing } from '../ui/styles';
import EnvBadge from './EnvBadge.vue';
import LocaleToggle from './LocaleToggle.vue';
import StaffMenu from './StaffMenu.vue';
import ThemeToggle from './ThemeToggle.vue';

/** Top bar (03 §14): menu (below 1024), global search opening the palette, environment, theme, language, staff menu. */
defineProps<{ shortcut: string }>();
const emit = defineEmits<{ menu: []; search: [] }>();
</script>

<template>
    <header class="flex h-56 shrink-0 items-center gap-12 border-b border-line-subtle bg-surface px-16 tablet:px-24">
        <IconButton class="shell:hidden" :icon="PhList" :label="trans('shell.menu')" data-testid="shell.menu" @click="emit('menu')" />
        <button
            type="button"
            :class="[focusRing, 'flex h-32 w-full max-w-400 min-w-0 items-center gap-8 rounded-search border border-line-control bg-raised px-12 text-left text-supporting text-ink-3 hover:border-line-strong']"
            aria-haspopup="dialog"
            data-testid="shell.search"
            @click="emit('search')"
        >
            <PhMagnifyingGlass :size="16" class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate" :title="trans('shell.search.placeholder')">{{ trans('shell.search.placeholder') }}</span>
            <Kbd class="hidden tablet:inline-flex">{{ shortcut }}</Kbd>
        </button>
        <div class="ml-auto flex shrink-0 items-center gap-8">
            <EnvBadge />
            <ThemeToggle />
            <LocaleToggle class="hidden tablet:flex" />
            <StaffMenu />
        </div>
    </header>
</template>
