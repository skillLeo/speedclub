<script setup lang="ts">
import { PhList, PhMagnifyingGlass } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import IconButton from '../ui/IconButton.vue';
import Kbd from '../ui/Kbd.vue';
import { focusRing } from '../ui/styles';
import DensityToggle from './DensityToggle.vue';
import EnvBadge from './EnvBadge.vue';
import LocaleToggle from './LocaleToggle.vue';
import StaffMenu from './StaffMenu.vue';
import ThemeToggle from './ThemeToggle.vue';

/** Top bar (03 §14, 09 §10.1): menu (below 1024), global search opening the palette, environment, density (from tablet), theme, language, staff menu. */
defineProps<{ shortcut: string }>();
const emit = defineEmits<{ menu: []; search: [] }>();
</script>

<template>
    <header class="flex h-56 shrink-0 items-center gap-12 border-b border-line-subtle bg-surface px-16 tablet:px-24">
        <IconButton class="shell:hidden" :icon="PhList" :label="trans('shell.menu')" data-testid="shell.menu" @click="emit('menu')" />
        <button
            type="button"
            :class="[
                focusRing,
                // Phone: a square search button, so the right-hand group (environment, theme, staff menu) never squeezes it into its
                // neighbours; from tablet the full field.
                'flex size-32 shrink-0 items-center justify-center rounded-sm border border-line-control bg-raised text-admin-base text-ink-3 hover:border-line-strong tablet:h-32 tablet:w-full tablet:max-w-400 tablet:min-w-0 tablet:shrink tablet:justify-start tablet:gap-8 tablet:px-12 tablet:text-left',
            ]"
            :aria-keyshortcuts="shortcut.startsWith('⌘') ? 'Meta+K' : 'Control+K'"
            aria-haspopup="dialog"
            data-testid="shell.search"
            @click="emit('search')"
        >
            <!-- The name is the visible text (WCAG 2.5.3, axe label-content-name-mismatch): the placeholder and the shortcut as shown, no
                 aria-label that leaves the shortcut out. On phones only the screen-reader copy names the square button. -->
            <PhMagnifyingGlass :size="16" class="shrink-0" aria-hidden="true" />
            <span class="sr-only tablet:hidden">{{ trans('shell.search.placeholder') }}</span>
            <span class="hidden min-w-0 flex-1 truncate tablet:block" :title="trans('shell.search.placeholder')">{{ trans('shell.search.placeholder') }}</span>
            <!-- Kbd sets its own display, which beat a `hidden` on it: the wrapper hides the shortcut on phones (no keyboard there). -->
            <span class="hidden tablet:inline-flex"><Kbd>{{ shortcut }}</Kbd></span>
        </button>
        <div class="ml-auto flex shrink-0 items-center gap-8">
            <EnvBadge />
            <DensityToggle class="hidden tablet:inline-flex" />
            <ThemeToggle />
            <LocaleToggle class="hidden tablet:flex" />
            <StaffMenu />
        </div>
    </header>
</template>
